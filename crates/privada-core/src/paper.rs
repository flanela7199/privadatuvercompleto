//! Toilet-paper strip (port of web/src/fx/paperStrip.js): verlet chain pinned to the roll,
//! output as a twisting ribbon with perforation lines.
//!
//! Render outputs: `pos` (MAX_PTS*2 x 3), `uv` (MAX_PTS*2 x 2), `count` (points; draw
//! `(count-1)*6` indices), `perf` (MAX_PERF*2 segments x 2 points x 3), `perf_count`
//! (segments), `opacity`, `perf_opacity`.
use glam::Vec3;
use std::collections::HashMap;

pub const SEG: f32 = 0.025;
/// segments per sheet -> 10 cm sheets
pub const SHEET: u32 = 4;
pub const MAX_PTS: usize = 150;
pub const MAX_PERF: usize = MAX_PTS / SHEET as usize + 3;

#[derive(Clone, Copy, Debug)]
pub struct Pt {
    pub p: Vec3,
    pub q: Vec3,
    pub id: u32,
    pub tw: f32,
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
    pub uv: Vec<f32>,
    pub count: usize,
    pub perf: Vec<f32>,
    pub perf_count: usize,
    pub opacity: f32,
    pub perf_opacity: f32,
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
            uv: vec![0.0; MAX_PTS * 4],
            count: 0,
            perf: vec![0.0; MAX_PERF * 12],
            perf_count: 0,
            opacity: 1.0,
            perf_opacity: 0.9,
        }
    }

    fn new_point(&mut self, p: Vec3, q: Vec3) -> Pt {
        let id = self.serial;
        self.serial += 1;
        Pt { p, q, id, tw: 0.0 }
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
            if o.p.y > 0.03 {
                o.q = o.p - t;
            }
        }
        self.pts.truncate(k + 1);
        self.fed = 0.0;
        true
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
            let w = i as f32 / n as f32;
            let turb = wind_amt * 14.0 * w + if free && o.p.y > 0.03 { 3.0 } else { 0.0 };
            let fi = i as f32;
            let fx = self.wind.x * w + turb * (t * 7.1 + fi * 0.53 + 1.3).sin();
            let fy = self.wind.y * w + turb * (t * 5.3 + fi * 0.71).sin() * 0.8;
            let fz = self.wind.z * w + turb * (t * 6.7 + fi * 0.41 + 2.1).sin() * 0.6;
            o.p.x += v.x + fx * dt * dt;
            o.p.y += v.y + g + fy * dt * dt;
            o.p.z += v.z + fz * dt * dt;
        }

        // constraints: length, bending stiffness, floor pile
        for _ in 0..10 {
            for i in 0..n.saturating_sub(1) {
                let (a, b) = (self.pts[i].p, self.pts[i + 1].p);
                let dv = b - a;
                let d = dv.length().max(1e-6);
                let diff = (d - SEG) / d;
                let pinned = self.anchored && i == 0;
                let (ka, kb) = if pinned { (0.0, 1.0) } else { (0.5, 0.5) };
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
                    o.q.x = o.p.x * 0.55 + o.q.x * 0.45;
                    o.q.z = o.p.z * 0.55 + o.q.z * 0.45;
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
            o.tw += (target - o.tw) * (dt * 6.0).min(1.0);
        }

        self.write(n);
    }

    fn write(&mut self, n: usize) {
        let hw = self.width / 2.0;
        let wd = self.width_dir;
        let mut np = 0;
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
        self.count = n;
        self.perf_count = np;
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
}
