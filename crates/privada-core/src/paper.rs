//! Toilet-paper strip (port of web/src/fx/paperStrip.js): verlet chain pinned to the roll,
//! output as a twisting ribbon with perforation lines.
//!
//! Render outputs: `pos` (MAX_PTS*2 x 3), `nrm` (normals, same layout), `uv` (MAX_PTS*2 x 2), `count` (points; draw
//! `(count-1)*6` indices), `perf` (MAX_PERF*2 segments x 2 points x 3), `perf_count`
//! (segments), `opacity`, `perf_opacity`, `col` (per-vertex RGBA: wet paper is darker and more
//! translucent), `max_wet`.
//!
//! Wet paper (per-point `wet` 0..1, raised by [`PaperStrip::soak`] from drops / the water column /
//! the puddle, dries in ~[`DRY_TIME`] s): heavier (gravity x (1 + 2 wet)), less wind, sticks to the
//! floor, and a wet perforation tears under the weight of the paper hanging below it
//! (`tear_request`, handled by the rig).
use crate::water::{DropHash, StreamSample, WaterJet};
use glam::Vec3;
use std::collections::HashMap;

pub const SEG: f32 = 0.025;
/// segments per sheet -> 10 cm sheets
pub const SHEET: u32 = 4;
pub const MAX_PTS: usize = 150;
pub const MAX_PERF: usize = MAX_PTS / SHEET as usize + 3;
/// a perforation tears when the paper hanging below it (m of dry-equivalent paper, wet counts 3x)
/// exceeds TEAR_WET_LOAD + TEAR_DRY_LOAD * (1 - wet)^2 (dry paper never tears by itself)
pub const TEAR_WET_LOAD: f32 = 0.3;
pub const TEAR_DRY_LOAD: f32 = 4.0;
/// seconds for fully wet paper to dry
pub const DRY_TIME: f32 = 20.0;
/// mass of one strip point (kg, dry) for pushing props
pub const PT_MASS: f32 = 0.0025;

#[derive(Clone, Copy, Debug)]
pub struct Pt {
    pub p: Vec3,
    pub q: Vec3,
    pub id: u32,
    pub tw: f32,
    /// wetness 0..1
    pub wet: f32,
}

fn hash(n: u32) -> f32 {
    let s = ((n as f64) * 127.1 + 311.7).sin() * 43758.5453;
    (s - s.floor()) as f32
}

#[derive(Clone)]
pub struct PaperStrip {
    pub width: f32,
    pub pts: Vec<Pt>,
    pub anchored: bool,
    pub anchor: Vec3,
    pub width_dir: Vec3,
    pub emit_dir: Vec3,
    pub target_len: f32,
    pub feed_speed: f32,
    pub fed: f32,
    pub wind: Vec3,
    pub time: f32,
    pub fade: f32,
    pub serial: u32,
    pub total_fed: f32,
    pub roll_radius_scale: f32,
    cells: HashMap<i32, u32>,

    pub pos: Vec<f32>,
    pub nrm: Vec<f32>,
    pub uv: Vec<f32>,
    pub count: usize,
    pub perf: Vec<f32>,
    pub perf_count: usize,
    pub opacity: f32,
    pub perf_opacity: f32,
    /// per-vertex RGBA (MAX_PTS*2 x 4): 1 = dry
    pub col: Vec<f32>,
    /// highest wetness of the strip this frame
    pub max_wet: f32,
    /// set by `update`: a wet perforation gave way at this point index (the rig tears there)
    pub tear_request: Option<usize>,
    /// air dragged along by the water column: airborne points within 1.2 m accelerate toward the nearest
    /// of these column samples (attract_k m/s^2 per m of distance, capped at 18); empty = off
    pub attract: Vec<Vec3>,
    pub attract_k: f32,
}

impl PaperStrip {
    pub fn new(width: f32) -> Self {
        Self {
            width,
            pts: Vec::with_capacity(MAX_PTS),
            anchored: true,
            anchor: Vec3::ZERO,
            width_dir: Vec3::Z,
            emit_dir: Vec3::NEG_Y,
            target_len: 0.24,
            feed_speed: 0.6,
            fed: 0.0,
            wind: Vec3::ZERO,
            time: 0.0,
            fade: 1.0,
            serial: 0,
            total_fed: 0.0,
            roll_radius_scale: 1.0,
            cells: HashMap::new(),
            pos: vec![0.0; MAX_PTS * 6],
            nrm: vec![0.0; MAX_PTS * 6],
            uv: vec![0.0; MAX_PTS * 4],
            count: 0,
            perf: vec![0.0; MAX_PERF * 12],
            perf_count: 0,
            opacity: 1.0,
            perf_opacity: 0.9,
            col: vec![1.0; MAX_PTS * 8],
            max_wet: 0.0,
            tear_request: None,
            attract: Vec::with_capacity(12),
            attract_k: 0.0,
        }
    }

    fn new_point(&mut self, p: Vec3, q: Vec3) -> Pt {
        let id = self.serial;
        self.serial += 1;
        Pt { p, q, id, tw: 0.0, wet: 0.0 }
    }

    pub fn reset(&mut self, anchor: Vec3) {
        let pt = self.new_point(anchor, anchor);
        self.pts.clear();
        self.pts.push(pt);
        self.fed = 0.0;
    }

    pub fn copy_from(&mut self, other: &PaperStrip) {
        self.pts = other.pts.clone();
        self.width_dir = other.width_dir;
    }

    pub fn new_roll(&mut self) {
        self.total_fed = 0.0;
        self.roll_radius_scale = 1.0;
    }

    pub fn length(&self) -> f32 {
        self.pts.len().saturating_sub(1) as f32 * SEG
    }

    pub fn is_perf(&self, i: usize) -> bool {
        self.pts.get(i).is_some_and(|p| p.id % SHEET == 0)
    }

    /// Tear at the first perforation at least ~6 cm below the roll; the rest goes into
    /// `torn` (tumbles away and fades). Returns false if too short to tear.
    pub fn tear_into(&mut self, torn: &mut PaperStrip) -> bool {
        let n = self.pts.len();
        let mut k = None;
        if n >= 4 {
            for i in 2..n - 2 {
                if self.is_perf(i) && i as f32 * SEG >= 0.06 {
                    k = Some(i);
                    break;
                }
            }
        }
        let Some(k) = k else { return false };
        self.tear_at(k, torn, true)
    }

    /// Tear at point `k` (a perforation): points `k..` go into `torn`; `tumble` gives the piece a
    /// little spin (the paper action), otherwise it just drops (wet paper giving way).
    pub fn tear_at(&mut self, k: usize, torn: &mut PaperStrip, tumble: bool) -> bool {
        if k == 0 || k + 1 >= self.pts.len() {
            return false;
        }
        torn.pts = self.pts[k..].to_vec();
        torn.width_dir = self.width_dir;
        torn.anchored = false;
        torn.fade = 1.0;
        torn.time = 0.0;
        let c = torn.pts.iter().fold(Vec3::ZERO, |a, o| a + o.p) / torn.pts.len() as f32;
        let w = 2.2 / 60.0;
        for o in torn.pts.iter_mut() {
            let a = o.p - c;
            let t = self.width_dir.cross(a) * w + self.emit_dir * -0.01;
            if tumble && o.p.y > 0.03 {
                o.q = o.p - t;
            }
        }
        self.pts.truncate(k + 1);
        self.fed = 0.0;
        self.tear_request = None;
        true
    }

    /// Wet the strip where water hits it: live drops near a point soak in (and are absorbed),
    /// the coherent column soaks and pushes it, paper lying in the puddle soaks up from below.
    /// `hash` must be built from `jet` this frame.
    pub fn soak(&mut self, dt: f32, jet: &mut WaterJet, hash: &mut DropHash, stream: &[StreamSample], puddle: [f32; 5]) {
        if self.pts.len() < 2 || dt <= 0.0 {
            return;
        }
        let r = self.width * 0.45;
        let start = usize::from(self.anchored);
        let (plo, phi) = self.pts.iter().fold((Vec3::splat(f32::MAX), Vec3::splat(f32::MIN)), |(a, b), o| (a.min(o.p), b.max(o.p)));
        let drops = hash.overlaps(plo - Vec3::splat(r), phi + Vec3::splat(r));
        let (sx, sz) = (puddle[2].max(1e-3), puddle[3].max(1e-3));
        let pud = puddle[4] > 0.05 && plo.y < 0.03;
        // the column only matters if its box touches the strip's
        let stream = if stream.iter().any(|s| {
            let e = Vec3::splat(s.r + r);
            (s.p + e).cmpge(plo).all() && (s.p - e).cmple(phi).all()
        }) {
            stream
        } else {
            &[]
        };
        if !drops && !pud && stream.is_empty() {
            return;
        }
        for i in start..self.pts.len() {
            let p = self.pts[i].p;
            let mut wet = self.pts[i].wet;
            let mut dv = Vec3::ZERO;
            if drops {
                let pm = PT_MASS * (1.0 + 2.0 * wet);
                hash.query(p - Vec3::splat(r), p + Vec3::splat(r), |k| {
                    if let Some((dp, v, size)) = jet.drop_state(k) {
                        if dp.distance_squared(p) < r * r {
                            wet += 0.06 * size;
                            dv += v * (crate::props::DROP_MASS * size / pm) * 0.5;
                            jet.absorb_drop(k);
                        }
                    }
                });
            }
            for s in stream {
                let rr = s.r + r * 0.6;
                if s.p.distance_squared(p) < rr * rr {
                    wet += dt * 6.0;
                    let vp = (p - self.pts[i].q) / dt;
                    dv += (s.v - vp) * (dt * 8.0).min(1.0);
                }
            }
            if pud && p.y < 0.03 {
                let (ux, uz) = ((p.x - puddle[0]) / sx, (p.z - puddle[1]) / sz);
                if ux * ux + uz * uz < 1.0 && wet < 0.9 {
                    wet = (wet + dt * 1.5 * puddle[4]).min(0.9);
                }
            }
            let o = &mut self.pts[i];
            o.wet = wet.min(1.0);
            if dv != Vec3::ZERO {
                o.q -= dv * dt;
            }
        }
    }

    pub fn update(&mut self, dt: f32) {
        self.time += dt;
        if self.pts.is_empty() {
            self.count = 0;
            self.perf_count = 0;
            return;
        }
        if dt <= 0.0 {
            return;
        }
        let dry = dt / DRY_TIME;
        for o in self.pts.iter_mut() {
            o.wet = (o.wet - dry).max(0.0);
        }
        if self.anchored {
            // feed new paper out of the roll
            if self.length() < self.target_len && self.pts.len() < MAX_PTS {
                self.fed += self.feed_speed * dt;
                while self.fed >= SEG && self.pts.len() < MAX_PTS {
                    self.fed -= SEG;
                    let p = self.anchor + self.emit_dir * 0.002;
                    let q = p - self.emit_dir * self.feed_speed * dt;
                    let pt = self.new_point(p, q);
                    self.pts.insert(1, pt);
                    self.total_fed += SEG;
                }
                self.roll_radius_scale = (1.0 - self.total_fed * 0.02).max(0.55);
            }
            self.pts[0].p = self.anchor;
            self.pts[0].q = self.anchor;
        }

        // verlet integrate with wind turbulence
        let n = self.pts.len();
        let wind_amt = (self.wind.length() / 30.0).min(1.0);
        let free = !self.anchored;
        let damp = if free { 0.955 } else { 0.985 };
        let g = -9.8 * dt * dt * if free { 0.75 } else { 1.0 };
        let t = self.time;
        let start = if self.anchored { 1 } else { 0 };
        for i in start..n {
            let o = &mut self.pts[i];
            let v = (o.p - o.q) * damp;
            o.q = o.p;
            // wet paper: heavier, barely moved by the wind
            let dry = 1.0 - 0.8 * o.wet;
            let w = i as f32 / n as f32 * dry;
            let turb = (wind_amt * 14.0 * (i as f32 / n as f32) + if free && o.p.y > 0.03 { 3.0 } else { 0.0 }) * dry;
            let fi = i as f32;
            let fx = self.wind.x * w + turb * (t * 7.1 + fi * 0.53 + 1.3).sin();
            let fy = self.wind.y * w + turb * (t * 5.3 + fi * 0.71).sin() * 0.8;
            let fz = self.wind.z * w + turb * (t * 6.7 + fi * 0.41 + 2.1).sin() * 0.6;
            let mut pull = Vec3::ZERO;
            if !self.attract.is_empty() && o.p.y > 0.03 {
                let mut best = (f32::MAX, Vec3::ZERO);
                for a in &self.attract {
                    let d2 = a.distance_squared(o.p);
                    if d2 < best.0 {
                        best = (d2, *a);
                    }
                }
                let d = best.0.sqrt();
                if d < 1.2 && d > 1e-4 {
                    pull = (best.1 - o.p) / d * (d * self.attract_k).min(18.0);
                }
            }
            o.p.x += v.x + (fx + pull.x) * dt * dt;
            o.p.y += v.y + g * (1.0 + 2.0 * o.wet) + (fy + pull.y) * dt * dt;
            o.p.z += v.z + (fz + pull.z) * dt * dt;
        }

        // constraints: length, bending stiffness, floor pile
        for _ in 0..10 {
            for i in 0..n.saturating_sub(1) {
                let (a, b) = (self.pts[i].p, self.pts[i + 1].p);
                let dv = b - a;
                let d = dv.length().max(1e-6);
                let diff = (d - SEG) / d;
                let pinned = self.anchored && i == 0;
                let (ka, kb) = if pinned {
                    (0.0, 1.0)
                } else {
                    // heavier (wet) points move less
                    let (wa, wb) = (1.0 / (1.0 + 2.0 * self.pts[i].wet), 1.0 / (1.0 + 2.0 * self.pts[i + 1].wet));
                    (wa / (wa + wb), wb / (wa + wb))
                };
                self.pts[i].p += dv * diff * ka;
                self.pts[i + 1].p -= dv * diff * kb;
            }
            for i in 0..n.saturating_sub(2) {
                let min_d = if self.is_perf(i + 1) { 0.55 } else { 1.5 } * SEG;
                let (a, c) = (self.pts[i].p, self.pts[i + 2].p);
                let dv = c - a;
                let d = dv.length().max(1e-6);
                if d >= min_d {
                    continue;
                }
                let diff = ((d - min_d) / d) * 0.5;
                let pinned = self.anchored && i == 0;
                let (ka, kc) = if pinned { (0.0, 1.0) } else { (0.5, 0.5) };
                self.pts[i].p += dv * diff * ka;
                self.pts[i + 2].p -= dv * diff * kc;
            }
            // floor with a growing pile: points in a 4.5 cm cell sit on the ones below
            self.cells.clear();
            for i in (0..n).rev() {
                if self.anchored && i == 0 {
                    continue;
                }
                let o = &mut self.pts[i];
                if o.p.y > 0.12 {
                    continue;
                }
                let key = (((o.p.x / 0.045).floor() as i32 + 2048) << 12) | ((o.p.z / 0.045).floor() as i32 + 2048);
                let c = self.cells.entry(key).or_insert(0);
                let fl = 0.004 + (*c).min(12) as f32 * 0.0065;
                *c += 1;
                if o.p.y < fl {
                    o.p.y = fl;
                    o.q.y = o.q.y.min(o.p.y + 0.0005);
                    // friction; wet paper sticks to the floor
                    let k = 0.55 + 0.45 * o.wet;
                    o.q.x = o.p.x * k + o.q.x * (1.0 - k);
                    o.q.z = o.p.z * k + o.q.z * (1.0 - k);
                }
            }
        }

        // twist: flutter in the wind, crumple on the floor
        for i in 0..n {
            let fi = i as f32;
            let o = &mut self.pts[i];
            let target = if o.p.y < 0.09 {
                (hash(o.id) - 0.5) * 1.1
            } else if free {
                (t * 3.0 + fi * 0.2).sin() * 0.45
            } else {
                wind_amt * (0.35 * (t * 4.3 + fi * 0.37).sin() + 0.15 * (t * 1.7 + fi * 0.11).sin()) * (fi / n as f32)
            };
            let target = target * (1.0 - 0.6 * o.wet);
            o.tw += (target - o.tw) * (dt * 6.0).min(1.0);
        }

        // a wet perforation gives way under the weight hanging below it (paper on the floor carries none)
        self.tear_request = None;
        if self.anchored && n > 4 {
            let mut load = 0.0;
            for i in (2..n).rev() {
                let o = self.pts[i];
                load = if o.p.y < 0.03 { 0.0 } else { load + (1.0 + 2.0 * o.wet) * SEG };
                if o.id % SHEET == 0 && i + 2 < n {
                    let w = (self.pts[i - 1].wet + o.wet + self.pts[i + 1].wet) / 3.0;
                    if w > 0.35 && load > TEAR_DRY_LOAD * (1.0 - w) * (1.0 - w) + TEAR_WET_LOAD {
                        self.tear_request = Some(i);
                    }
                }
            }
        }

        self.write(n);
    }

    fn write(&mut self, n: usize) {
        let hw = self.width / 2.0;
        let wd = self.width_dir;
        let mut np = 0;
        let mut max_wet = 0.0f32;
        for i in 0..n {
            let o = self.pts[i];
            let p = o.p;
            let pa = self.pts[i.saturating_sub(1)].p;
            let pb = self.pts[(i + 1).min(n - 1)].p;
            let mut t = pb - pa;
            if t.length_squared() < 1e-10 {
                t = self.emit_dir;
            }
            let t = t.normalize_or_zero();
            let mut w = wd - t * wd.dot(t);
            if w.length_squared() < 1e-8 {
                w = wd;
            }
            let w0 = w.normalize_or_zero();
            let (cs, sn) = (o.tw.cos(), o.tw.sin());
            let nn = t.cross(w0);
            let w = w0 * cs + nn * sn;
            let nrm = t.cross(w);
            let a = p - w * hw;
            let b = p + w * hw;
            self.pos[i * 6..i * 6 + 6].copy_from_slice(&[a.x, a.y, a.z, b.x, b.y, b.z]);
            // wet: darker, a little cooler, more translucent
            let wt = o.wet;
            let c = [1.0 - 0.45 * wt, 1.0 - 0.42 * wt, 1.0 - 0.36 * wt, 1.0 - 0.5 * wt];
            self.col[i * 8..i * 8 + 4].copy_from_slice(&c);
            self.col[i * 8 + 4..i * 8 + 8].copy_from_slice(&c);
            max_wet = max_wet.max(wt);
            let v = o.id as f32 * 0.12; // texture travels with the paper
            self.uv[i * 4..i * 4 + 4].copy_from_slice(&[0.0, v, 1.0, v]);
            if i > 0 && o.id % SHEET == 0 && np + 2 <= MAX_PERF * 2 {
                for off in [0.0012f32, -0.0012] {
                    let k = np * 6;
                    let a = p - w * hw * 0.98 + nrm * off;
                    let b = p + w * hw * 0.98 + nrm * off;
                    self.perf[k..k + 6].copy_from_slice(&[a.x, a.y, a.z, b.x, b.y, b.z]);
                    np += 1;
                }
            }
        }
        // ribbon normals (same index layout as paperStrip.js: a,a+1,a+2 / a+1,a+3,a+2)
        let tris = (0..n.saturating_sub(1)).flat_map(|i| {
            let a = i * 2;
            [[a, a + 1, a + 2], [a + 1, a + 3, a + 2]]
        });
        crate::util::vertex_normals(&self.pos, &mut self.nrm, n * 2, tris);
        self.count = n;
        self.perf_count = np;
        self.max_wet = max_wet;
        let op = if self.anchored { self.fade } else { (self.fade * 2.5).clamp(0.0, 1.0) };
        self.opacity = op;
        self.perf_opacity = op * 0.9;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feeds_piles_and_tears_at_perforation() {
        let mut p = PaperStrip::new(0.18);
        p.anchor = Vec3::new(-0.7, 1.38, -0.4);
        p.reset(p.anchor);
        p.target_len = 3.0;
        p.feed_speed = 1.7;
        for _ in 0..240 {
            p.update(1.0 / 60.0);
        }
        assert!(p.length() > 2.0, "fed paper: {}", p.length());
        assert!(p.roll_radius_scale < 1.0);
        assert!(p.pts.iter().all(|o| o.p.y >= 0.003), "nothing below the floor");
        let mut torn = PaperStrip::new(0.18);
        assert!(p.tear_into(&mut torn));
        assert!(!torn.pts.is_empty() && !torn.anchored);
        assert!(p.pts.last().unwrap().id % SHEET == 0, "stub ends at a perforation");
        assert!(p.pos.iter().all(|x| x.is_finite()));
    }

    fn hanging(len: f32) -> PaperStrip {
        let mut p = PaperStrip::new(0.18);
        p.anchor = Vec3::new(0.0, 0.9, 1.0);
        p.reset(p.anchor);
        p.target_len = len;
        p.feed_speed = 1.5;
        for _ in 0..120 {
            p.update(1.0 / 60.0);
        }
        p
    }

    #[test]
    fn wetness_rises_under_spray_and_decays() {
        let dt = 1.0 / 60.0;
        let mut p = hanging(0.3);
        let mut jet = WaterJet::new(9);
        jet.origin = Vec3::new(0.0, -1.0, 0.0);
        jet.mouth = Vec3::new(0.0, 1.2, 0.0);
        jet.dir = Vec3::Z;
        jet.emitting = true;
        let mut hash = DropHash::new(0.1);
        let mut ss = [StreamSample::default(); 12];
        let mut live0 = 0;
        for i in 0..60 {
            p.update(dt);
            jet.update(dt);
            hash.build(&jet);
            if i == 59 {
                live0 = jet.live_count;
            }
            let n = jet.stream_samples(&mut ss);
            let pud = jet.puddle_out;
            p.soak(dt, &mut jet, &mut hash, &ss[..n], pud);
        }
        p.update(dt);
        assert!(p.max_wet > 0.5, "soaked: {}", p.max_wet);
        assert!(p.pts.iter().any(|o| o.wet < p.max_wet), "only where the water hits");
        assert!(live0 > 0);
        let alpha = (0..p.count * 2).map(|v| p.col[v * 4 + 3]).fold(1.0f32, f32::min);
        let dark = (0..p.count * 2).map(|v| p.col[v * 4]).fold(1.0f32, f32::min);
        assert!(alpha < 0.8 && dark < 0.8, "darker + translucent: rgb {dark} a {alpha}");
        jet.emitting = false;
        for _ in 0..(25 * 60) {
            p.update(dt);
        }
        assert!(p.max_wet < 0.02, "dried: {}", p.max_wet);
        assert!(p.col.iter().take(p.count * 8).all(|c| *c > 0.98));
    }

    #[test]
    fn wet_perforations_tear_dry_ones_hold() {
        let dt = 1.0 / 60.0;
        let mut dry = hanging(0.6);
        for _ in 0..120 {
            dry.update(dt);
            assert!(dry.tear_request.is_none(), "dry paper never tears by itself");
        }
        let mut wet = hanging(0.6);
        for o in wet.pts.iter_mut() {
            o.wet = 1.0;
        }
        let mut k = None;
        for _ in 0..30 {
            wet.update(dt);
            if wet.tear_request.is_some() {
                k = wet.tear_request;
                break;
            }
        }
        let k = k.expect("wet paper tears under its own weight");
        assert!(wet.is_perf(k));
        let mut torn = PaperStrip::new(0.18);
        let n = wet.pts.len();
        assert!(wet.tear_at(k, &mut torn, false));
        assert_eq!(wet.pts.len() + torn.pts.len(), n + 1);
        assert!(torn.pts.iter().all(|o| o.wet > 0.9), "the torn piece stays wet");
        // wet paper on the floor barely slides
        let mut f = PaperStrip::new(0.18);
        f.anchored = false;
        f.pts.clear();
        for i in 0..10u32 {
            let pp = Vec3::new(i as f32 * SEG, 0.004, 0.0);
            f.pts.push(Pt { p: pp, q: pp - Vec3::new(0.0, 0.0, 0.03), id: i, tw: 0.0, wet: 1.0 });
        }
        let mut g = f.clone();
        for o in g.pts.iter_mut() {
            o.wet = 0.0;
        }
        for _ in 0..30 {
            f.update(dt);
            g.update(dt);
        }
        let slide = |s: &PaperStrip| s.pts.iter().map(|o| o.p.z).sum::<f32>() / s.pts.len() as f32;
        assert!(slide(&f) < slide(&g) * 0.6, "wet sticks: {} vs dry {}", slide(&f), slide(&g));
    }
}
