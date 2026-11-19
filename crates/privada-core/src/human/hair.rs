//! Hair: scalp cap + wavy clumps (volume on top, swept up/back, short sides), the beard +
//! mustache (dark shell + dense short strands) and the eyebrows. Beard and brows are rooted
//! on head triangles, so they take the head's morph deltas and skin weights.
use super::head::*;
use super::iso;
use super::morph;
use super::parts::{hp_pad_sdf, hp_shell_sdf, Part};
use super::sdf::*;
use glam::Vec3;

/* ------------------------------------------------------------------ scalp hair */
fn cap_thickness(p: Vec3) -> f32 {
    let t = mix(0.0040, 0.0190, sstep(0.040, 0.095, p.y)) + 0.012 * gauss(p, v(0.010, 0.105, 0.045), v(0.055, 0.030, 0.045));
    // thins out toward the hairline
    t * mix(0.12, 1.0, sstep(0.0, 0.026, hair_region(p)))
}
/// solid under-volume: gives the hair its mass and guarantees no scalp shows between the locks
pub fn hair_cap_sdf(p: Vec3) -> f32 {
    let d = skull_sdf(p) - cap_thickness(p);
    // the headband presses into it
    let d = smax(d, -(hp_pad_sdf(p) - 0.0015), 0.006);
    smax(d, -hair_region(p), 0.004)
}

fn hair_base(seed: u32) -> Vec3 {
    srgb(45, 30, 22) * (0.80 + 0.45 * hash(seed))
}

pub fn hair(detail: f32) -> Part {
    let c = 0.0048 / detail.clamp(0.25, 2.0);
    let m = iso::surface_nets(&hair_cap_sdf, &iso::uniform(-0.104, 0.104, c), &iso::uniform(-0.100, 0.165, c), &iso::uniform(-0.130, 0.125, c), 1.7);
    let mut part = Part::from_iso(m, |_, _| srgb(38, 26, 19));
    let skull: &dyn Fn(Vec3) -> f32 = &skull_sdf;
    let total = (1350.0 * detail.clamp(0.25, 2.0)) as u32;
    let ga = std::f32::consts::PI * (3.0 - 5f32.sqrt());
    const K: usize = 8;
    for i in 0..total {
        // fibonacci direction, then onto the scalp
        let yy = 1.0 - 2.0 * (i as f32 + 0.5) / total as f32;
        let rr = (1.0 - yy * yy).sqrt();
        let a = ga * i as f32;
        let dir = v(rr * a.cos(), yy, rr * a.sin());
        let (mut lo, mut hi) = (0.03, 0.17);
        for _ in 0..22 {
            let mid = 0.5 * (lo + hi);
            if skull_sdf(SKULL_C + dir * mid) < 0.0 { lo = mid } else { hi = mid }
        }
        let root = SKULL_C + dir * lo;
        if hair_region(root) < 0.002 {
            continue;
        }
        let (r1, r2, r3) = (hash(i * 3 + 1), hash(i * 3 + 2), hash(i * 3 + 3));
        let top = sstep(0.040, 0.080, root.y);
        // the quiff: the rows near the forehead hairline stand up before they sweep back
        let front = sstep(0.020, 0.065, root.z) * top;
        let len = mix(0.020, mix(0.066, 0.098, front), top) * (0.80 + 0.40 * r1);
        let lift = mix(0.05, mix(0.18, 1.05, front), top);
        // swept up and back, a little toward +x; the sides comb down / back
        let flow_top = v(0.32 + 1.6 * root.x, 0.05, -1.0).normalize();
        let flow = v(0.0, -1.0, -0.30).normalize().lerp(flow_top, top).normalize();
        let amp = mix(0.10, 0.62, top);
        let phase = 6.0 * root.x + 4.0 * root.z + 0.35 * r2;
        let n0 = iso::gradient(skull, root, 0.002);
        let ride = 0.80 + 0.35 * r3; // how high on the hair mass this lock lies (layers)
        let mut p = root + n0 * (cap_thickness(root) * 0.55);
        let mut pts = vec![p];
        let mut frame = vec![n0];
        for k in 0..K {
            let s = (k + 1) as f32 / K as f32;
            let n = iso::gradient(skull, p, 0.002);
            let ft = (flow - n * flow.dot(n)).normalize_or(flow);
            let b = n.cross(ft);
            let w = std::f32::consts::TAU * (s * 1.35 + phase);
            let d = n * (lift * (1.0 - s).powf(1.5)) + ft * (0.55 + s) + b * (amp * w.sin());
            p += d.normalize_or(ft) * (len / K as f32);
            // ride on the mass with a wave, then dive back into it at the tip
            let want = cap_thickness(p) * ride * (1.0 + 0.22 * w.cos()) * (1.0 - 0.55 * sstep(0.70, 1.0, s)) + 0.0015;
            let h = skull_sdf(p);
            let floor = want.max(0.0025);
            if h < floor {
                p += n * (floor - h);
            } else if front < 0.2 && h > floor + 0.004 {
                p -= n * (0.5 * (h - floor - 0.004));
            }
            // squeezed under the headband / cushions
            for _ in 0..10 {
                if hp_pad_sdf(p).min(hp_shell_sdf(p)) > 0.0040 || skull_sdf(p) < 0.002 {
                    break;
                }
                p -= n * 0.0025;
            }
            pts.push(p);
            frame.push(n);
        }
        let r0 = mix(0.0036, 0.0086, top) * (0.80 + 0.4 * r1);
        let base = hair_base(i);
        part.tube(&pts, &frame, 5, |t| {
            let r = r0 * sstep(-0.05, 0.14, t) * (1.0 - 0.80 * sstep(0.55, 1.0, t)) + 0.0002;
            (r, r * 0.42)
        }, |t| base * mix(0.72, 1.15, t));
    }
    part
}

/* ------------------------------------------------------------------ skin-rooted hair */
struct Rooted {
    part: Part,
    acc: Vec<Vec<Vec3>>,
}
impl Rooted {
    fn new() -> Self {
        Rooted { part: Part::default(), acc: vec![Vec::new(); morph::N] }
    }
    fn finish(mut self) -> Part {
        for (i, a) in self.acc.into_iter().enumerate() {
            if a.iter().any(|d| d.length_squared() > 1e-12) {
                self.part.morphs.push((i, a));
            }
        }
        self.part
    }
}

/// head triangles under `mask`, pushed out along the normal: the dark base under the strands
fn shell(out: &mut Rooted, head: &Surf, hm: &[Vec<Vec3>], mask: &dyn Fn(Vec3) -> f32, thresh: f32, offset: f32, color: Vec3) -> Vec<[u32; 3]> {
    let mv: Vec<f32> = head.p0.iter().map(|&p| mask(p)).collect();
    let mut map = vec![u32::MAX; head.pos.len()];
    let mut tris = Vec::new();
    for t in head.idx.chunks_exact(3) {
        if t.iter().all(|&i| mv[i as usize] > thresh) {
            for &i in t {
                let i = i as usize;
                if map[i] == u32::MAX {
                    map[i] = out.part.pos.len() as u32;
                    let w = sstep(thresh, (thresh + 0.45).min(1.0), mv[i]);
                    out.part.pos.push(head.pos[i] + head.nrm[i] * (offset * w));
                    out.part.nrm.push(head.nrm[i]);
                    out.part.col.push(color);
                    out.part.skin.push(skin_weights(head.p0[i]));
                    for (k, a) in out.acc.iter_mut().enumerate() {
                        a.push(hm[k][i]);
                    }
                }
                out.part.idx.push(map[i]);
            }
            tris.push([t[0], t[1], t[2]]);
        }
    }
    tris
}

struct Root {
    p0: Vec3,
    pos: Vec3,
    nrm: Vec3,
    mask: f32,
    seed: u32,
}

/// scatter `target` strands over the shell triangles; `make` returns the polyline, radius and colour
#[allow(clippy::too_many_arguments)]
fn strands(out: &mut Rooted, head: &Surf, hm: &[Vec<Vec3>], tris: &[[u32; 3]], mask: &dyn Fn(Vec3) -> f32, target: f32, lift: f32, make: &dyn Fn(&Root) -> (Vec<Vec3>, f32, Vec3)) {
    let area = |t: &[u32; 3]| {
        let (a, b, c) = (head.pos[t[0] as usize], head.pos[t[1] as usize], head.pos[t[2] as usize]);
        0.5 * (b - a).cross(c - a).length()
    };
    let total: f32 = tris.iter().map(area).sum();
    if total <= 0.0 {
        return;
    }
    let density = target / total;
    for (ti, t) in tris.iter().enumerate() {
        let want = area(t) * density;
        let n = want.floor() as u32 + (hash(ti as u32 * 7 + 11) < want.fract()) as u32;
        for s in 0..n {
            let seed = (ti as u32).wrapping_mul(131).wrapping_add(s * 17 + 5);
            let (mut u, mut w) = (hash(seed), hash(seed + 1));
            if u + w > 1.0 {
                u = 1.0 - u;
                w = 1.0 - w;
            }
            let bary = [1.0 - u - w, u, w];
            let at = |a: &[Vec3]| a[t[0] as usize] * bary[0] + a[t[1] as usize] * bary[1] + a[t[2] as usize] * bary[2];
            let p0 = at(&head.p0);
            let nrm = at(&head.nrm).normalize_or(Vec3::Z);
            let root = Root { p0, pos: at(&head.pos) + nrm * lift, nrm, mask: mask(p0), seed };
            let (pts, radius, col) = make(&root);
            let frame = vec![nrm; pts.len()];
            let before = out.part.pos.len();
            out.part.tube(&pts, &frame, 3, |t| {
                let r = radius * (1.0 - 0.8 * t * t);
                (r, r)
            }, |t| col * mix(0.75, 1.35, t));
            let added = out.part.pos.len() - before;
            let sk = skin_weights(p0);
            out.part.skin.extend(std::iter::repeat(sk).take(added));
            for (k, a) in out.acc.iter_mut().enumerate() {
                let d = at(&hm[k]);
                a.extend(std::iter::repeat(d).take(added));
            }
        }
    }
}

fn jitter(seed: u32) -> Vec3 {
    v(hash(seed + 31) - 0.5, hash(seed + 32) - 0.5, hash(seed + 33) - 0.5) * 2.0
}

/// beard + connected mustache
pub fn beard(head: &Surf, hm: &[Vec<Vec3>], detail: f32) -> Part {
    let mut out = Rooted::new();
    let mask: &dyn Fn(Vec3) -> f32 = &beard_mask;
    let tris = shell(&mut out, head, hm, mask, 0.30, 0.0030, srgb(38, 26, 19));
    let make = |r: &Root| {
        let sx = if r.p0.x >= 0.0 { 1.0 } else { -1.0 };
        let ax = r.p0.x.abs();
        let mustache = r.p0.y > lip_line(r.p0.x) && ax < 0.036 && r.p0.z > 0.070;
        let chin = sstep(0.030, 0.012, ax) * sstep(-0.075, -0.085, r.p0.y);
        let grain = if mustache {
            v(sx * 0.85 * sstep(0.0, 0.006, ax), -0.55, 0.12)
        } else {
            v(sx * 0.14 * (ax / 0.05).min(1.2), -1.0, 0.20).lerp(v(0.0, -0.80, 0.55), chin)
        }
        .normalize();
        let j = jitter(r.seed);
        let len = if mustache { 0.0050 } else { 0.0056 * (1.0 + 0.35 * chin) } * (0.70 + 0.60 * hash(r.seed + 2)) * r.mask.sqrt();
        let d0 = (r.nrm * 0.75 + grain * 0.60 + j * 0.28).normalize();
        let d1 = (r.nrm * 0.25 + grain * 1.00 + j * 0.28).normalize();
        let p1 = r.pos + d0 * (len * 0.5);
        (vec![r.pos, p1, p1 + d1 * (len * 0.5)], 0.00085, hair_base(r.seed) * 0.92)
    };
    strands(&mut out, head, hm, &tris, mask, 3000.0 * detail.clamp(0.25, 2.0), 0.0018, &make);
    out.finish()
}

/// thick, dark, straight-ish eyebrows
pub fn brows(head: &Surf, hm: &[Vec<Vec3>], detail: f32) -> Part {
    let mut out = Rooted::new();
    let mask: &dyn Fn(Vec3) -> f32 = &brow_mask;
    let tris = shell(&mut out, head, hm, mask, 0.35, 0.0013, srgb(36, 24, 18));
    let make = |r: &Root| {
        let sx = if r.p0.x >= 0.0 { 1.0 } else { -1.0 };
        let t = ((r.p0.x.abs() - 0.0085) / 0.0455).clamp(0.0, 1.0);
        let grain = v(sx, mix(0.75, -0.22, sstep(0.0, 0.55, t)), 0.0).normalize();
        let j = jitter(r.seed);
        let len = 0.0072 * (0.7 + 0.6 * hash(r.seed + 2));
        let d0 = (r.nrm * 0.45 + grain + j * 0.18).normalize();
        let d1 = (r.nrm * 0.05 + grain + j * 0.18).normalize();
        let p1 = r.pos + d0 * (len * 0.5);
        (vec![r.pos, p1, p1 + d1 * (len * 0.5)], 0.00062, hair_base(r.seed) * 0.8)
    };
    strands(&mut out, head, hm, &tris, mask, 520.0 * detail.clamp(0.25, 2.0), 0.0008, &make);
    out.finish()
}
