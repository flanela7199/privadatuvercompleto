//! Hair: a dark scalp cap (the mass) covered by layered, alpha-textured hair CARDS (ribbons along
//! wavy lock paths: volume on top, swept up/back, short sides), the beard + mustache (dark shell +
//! thousands of fine single-hair ribbons), eyebrows and eyelashes. Beard, brows and lashes are
//! rooted on head triangles, so they take the head's morph deltas and skin weights.
//! All ribbons are meant to be rendered double sided.
use super::head::*;
use super::iso;
use super::morph;
use super::parts::{hp_pad_sdf, hp_shell_sdf, Part};
use super::sdf::*;
use glam::Vec3;

/* ------------------------------------------------------------------ scalp hair */
fn cap_thickness(p: Vec3) -> f32 {
    let t = mix(0.0040, 0.0180, sstep(0.040, 0.095, p.y)) + 0.011 * gauss(p, v(0.010, 0.105, 0.045), v(0.055, 0.030, 0.045));
    // thins out toward the hairline
    (t * sstep(0.0, 0.030, hair_region(p))).max(0.0030)
}
/// solid under-volume: gives the hair its mass and guarantees no scalp shows between the cards
pub fn hair_cap_sdf(p: Vec3) -> f32 {
    let d = skull_sdf(p) - cap_thickness(p);
    // the headband presses into it
    let d = smax(d, -(hp_pad_sdf(p) - 0.0015), 0.006);
    // the mass stops short of the hairline: fine hairs + the darker scalp skin make the soft edge
    smax(d, -(hair_region(p) - 0.010), 0.004)
}

fn hair_base(seed: u32) -> Vec3 {
    srgb(40, 27, 19) * (0.62 + 0.75 * hash(seed))
}
/// the dark hair mass under the cards (opaque, no texture)
pub fn hair_cap(detail: f32) -> Part {
    let c = 0.0042 / detail.clamp(0.25, 2.0);
    let m = iso::surface_nets(&hair_cap_sdf, &iso::uniform(-0.104, 0.104, c), &iso::uniform(-0.100, 0.165, c), &iso::uniform(-0.130, 0.125, c), 1.7);
    Part::from_iso(m, |p, _| srgb(34, 23, 16) * (0.70 + 0.5 * hash(((p.x * 420.0) as i32 as u32).wrapping_mul(31) ^ (p.z * 140.0) as i32 as u32)))
}

/// the hair cards: three stacked alpha-textured ribbons per wavy lock + fine hairs along the hairline
pub fn hair(detail: f32) -> Part {
    let mut part = Part::default();
    let skull: &dyn Fn(Vec3) -> f32 = &skull_sdf;
    let total = (2150.0 * detail.clamp(0.25, 2.0)) as u32;
    let ga = std::f32::consts::PI * (3.0 - 5f32.sqrt());
    const K: usize = 7;
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
        if hair_region(root) < 0.001 {
            continue;
        }
        let (r1, r2, r3) = (hash(i * 3 + 1), hash(i * 3 + 2), hash(i * 3 + 3));
        let top = sstep(0.040, 0.080, root.y);
        // the quiff: the rows near the forehead hairline stand up before they sweep back
        let front = sstep(0.020, 0.065, root.z) * top;
        let len = mix(0.022, mix(0.062, 0.095, front), top) * (0.80 + 0.40 * r1);
        let lift = mix(0.05, mix(0.18, 1.00, front), top);
        // swept up and back, a little toward +x; the sides comb down / back
        let flow_top = v(0.32 + 1.6 * root.x, 0.05, -1.0).normalize();
        let flow = v(0.0, -1.0, -0.30).normalize().lerp(flow_top, top).normalize();
        let amp = mix(0.10, 0.85, top) * (0.7 + 0.6 * r3);
        let phase = 6.0 * root.x + 4.0 * root.z + 0.35 * r2;
        let n0 = iso::gradient(skull, root, 0.002);
        let ride = 0.85 + 0.35 * r3; // how high on the hair mass this lock lies (layers)
        let mut p = root + n0 * (cap_thickness(root) * 0.55);
        let mut pts = vec![p];
        let mut frame = vec![n0];
        for k in 0..K {
            let s = (k + 1) as f32 / K as f32;
            let n = iso::gradient(skull, p, 0.002);
            let ft = (flow - n * flow.dot(n)).normalize_or(flow);
            let b = n.cross(ft);
            let w = std::f32::consts::TAU * (s * 1.7 + phase);
            let d = n * (lift * (1.0 - s).powf(1.5)) + ft * (0.55 + s) + b * (amp * w.sin());
            p += d.normalize_or(ft) * (len / K as f32);
            // ride on the mass with a wave, then settle back onto it at the tip
            let want = cap_thickness(p) * ride * (1.0 + 0.38 * w.cos()) * (1.0 - 0.35 * sstep(0.70, 1.0, s)) + 0.0015;
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
        let n = pts.len();
        let side: Vec<Vec3> = (0..n)
            .map(|k| {
                let tan = (pts[(k + 1).min(n - 1)] - pts[k.saturating_sub(1)]).normalize_or(Vec3::Y);
                tan.cross(frame[k]).normalize_or(Vec3::X)
            })
            .collect();
        // fine short hairs along the hairline: they start on the skin and hide the edge of the hair mass
        if hair_region(root) < 0.016 {
            let ft = (flow - n0 * flow.dot(n0)).normalize_or(flow);
            let b0 = n0.cross(ft);
            for j in 0..4u32 {
                let (h1, h2) = (hash(i * 29 + j * 7 + 1), hash(i * 29 + j * 7 + 2));
                let start = root + b0 * ((h1 - 0.5) * 0.016) - ft * (0.004 * h2);
                let l = mix(0.012, 0.024, h2) * mix(0.7, 1.4, top);
                let fine: Vec<Vec3> = (0..5)
                    .map(|k| {
                        let s = k as f32 / 4.0;
                        let q = start + ft * (l * s) + b0 * (0.003 * (h1 - 0.5) * s);
                        q + n0 * (0.0008 + (cap_thickness(q) * 0.9 + 0.002 * top) * sstep(0.0, 0.8, s) - skull_sdf(q))
                    })
                    .collect();
                let sd = vec![-b0; fine.len()];
                let nn = vec![n0; fine.len()];
                let base = hair_base(i * 5 + j);
                let u0 = hash(i * 31 + j);
                part.ribbon(&fine, &sd, &nn, |t| 0.0032 * (1.0 - 0.3 * t), |_| base * 0.8, Some((u0, u0 + 0.16)), 0.3);
                // these cards use the thin upper half of the strand texture: remap v to 0.45..1
                let nv = part.uv.len();
                for (k, uv) in part.uv[nv - fine.len() * 2..].iter_mut().enumerate() {
                    uv[1] = 0.40 + 0.60 * (k / 2) as f32 / 4.0;
                }
            }
        }
        let r0 = mix(0.0040, 0.0090, top) * (0.80 + 0.4 * r1);
        // three stacked cards per lock, each a different window of the strand texture
        for j in 0..3u32 {
            let hj = hash(i * 11 + j * 3 + 7);
            let lat = (j as f32 - 1.0) * r0 * 0.75 * (0.6 + 0.8 * hj);
            let up = j as f32 * 0.0013;
            let card: Vec<Vec3> = (0..n).map(|k| pts[k] + side[k] * lat + frame[k] * up).collect();
            let base = hair_base(i * 3 + j);
            let u0 = hash(i * 17 + j * 5 + 3);
            part.ribbon(&card, &side, &frame, |t| r0 * 1.25 * sstep(-0.10, 0.10, t) * (1.0 - 0.35 * sstep(0.6, 1.0, t)), |t| base * mix(0.62, 1.12, t), Some((u0, u0 + 0.42)), 0.45);
        }
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
#[allow(clippy::too_many_arguments)]
fn shell(out: &mut Rooted, head: &Surf, hm: &[Vec<Vec3>], mask: &dyn Fn(Vec3) -> f32, thresh: f32, offset: f32, color: Vec3, shell_dark: f32) -> Vec<[u32; 3]> {
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
                    out.part.col.push(color_ao(head.p0[i], Some(head.nrm[i])).lerp(color, sstep(0.0, 0.7, w) * shell_dark));
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

/// head triangles with at least one vertex under `mask` (no geometry added)
fn touching(head: &Surf, mask: &dyn Fn(Vec3) -> f32, thresh: f32) -> Vec<[u32; 3]> {
    head.idx.chunks_exact(3).filter(|t| t.iter().any(|&i| mask(head.p0[i as usize]) > thresh)).map(|t| [t[0], t[1], t[2]]).collect()
}

struct Root {
    p0: Vec3,
    pos: Vec3,
    nrm: Vec3,
    mask: f32,
    seed: u32,
}

/// Scatter `target` single hairs over `tris`; `make` returns the polyline, half width and colour
/// (None = no hair here). Each hair is a thin tapered ribbon lit with the skin normal.
#[allow(clippy::too_many_arguments)]
fn strands(out: &mut Rooted, head: &Surf, hm: &[Vec<Vec3>], tris: &[[u32; 3]], mask: &dyn Fn(Vec3) -> f32, target: f32, lift: f32, make: &dyn Fn(&Root) -> Option<(Vec<Vec3>, f32, Vec3)>) {
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
            let Some((pts, half, col)) = make(&root) else { continue };
            let np = pts.len();
            let side: Vec<Vec3> = (0..np)
                .map(|k| {
                    let tan = (pts[(k + 1).min(np - 1)] - pts[k.saturating_sub(1)]).normalize_or(Vec3::Y);
                    tan.cross(nrm).normalize_or(Vec3::X)
                })
                .collect();
            let shade: Vec<Vec3> = pts.iter().map(|_| nrm).collect();
            let before = out.part.pos.len();
            out.part.ribbon(&pts, &side, &shade, |t| half * (1.0 - 0.80 * t * t), |t| col * mix(0.80, 1.30, t), None, 0.0);
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
    let tris = shell(&mut out, head, hm, mask, 0.30, 0.0022, srgb(30, 20, 15), 1.0);
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
        // sparser + shorter toward the edge of the beard (soft outline)
        if hash(r.seed + 9) > r.mask * 1.6 {
            return None;
        }
        let len = if mustache { 0.0052 } else { 0.0060 * (1.0 + 0.35 * chin) } * (0.60 + 0.70 * hash(r.seed + 2)) * r.mask.sqrt();
        let d0 = (r.nrm * 0.70 + grain * 0.65 + j * 0.30).normalize();
        let d1 = (r.nrm * 0.20 + grain * 1.00 + j * 0.30).normalize();
        let p1 = r.pos + d0 * (len * 0.5);
        Some((vec![r.pos, p1, p1 + d1 * (len * 0.5)], 0.00034, hair_base(r.seed) * 0.95))
    };
    strands(&mut out, head, hm, &tris, mask, 9500.0 * detail.clamp(0.25, 2.0), 0.0012, &make);
    out.finish()
}

/// upper (1) / lower (-1) lash line: 0..1 near the lid margin on the outer skin
fn lash_mask(p: Vec3, upper: bool) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let (lx, ly) = eye_local(q);
    if lx.abs() > LID_W - 0.0012 || (q - EYE).length() > EYE_R + 0.0065 || q.z < EYE.z {
        return 0.0;
    }
    let (yu, yl) = lid_curves(lx);
    let d = if upper { ly - yu } else { yl - ly };
    sstep(-0.0012, -0.0002, d) * sstep(0.0022, 0.0010, d) * (1.0 - cut_wall(p))
}

/// thick, dark, straight-ish eyebrows + the eyelashes
pub fn brows(head: &Surf, hm: &[Vec<Vec3>], detail: f32) -> Part {
    let mut out = Rooted::new();
    let mask: &dyn Fn(Vec3) -> f32 = &brow_mask;
    let tris = shell(&mut out, head, hm, mask, 0.35, 0.0006, srgb(52, 36, 28), 0.30);
    let make = |r: &Root| {
        let sx = if r.p0.x >= 0.0 { 1.0 } else { -1.0 };
        let t = ((r.p0.x.abs() - 0.0085) / 0.0455).clamp(0.0, 1.0);
        if hash(r.seed + 9) > r.mask * 1.5 {
            return None;
        }
        let (by, _) = brow_line(r.p0.x.abs());
        // upper hairs comb down / out, lower ones up / out: they meet along the brow's spine
        let lean = mix(0.75, -0.25, sstep(0.0, 0.55, t)) - 55.0 * (r.p0.y - by);
        let grain = v(sx, lean, 0.0).normalize();
        let j = jitter(r.seed);
        let len = 0.0078 * (0.7 + 0.6 * hash(r.seed + 2));
        let d0 = (r.nrm * 0.40 + grain + j * 0.16).normalize();
        let d1 = (r.nrm * 0.02 + grain + j * 0.16).normalize();
        let p1 = r.pos + d0 * (len * 0.5);
        Some((vec![r.pos, p1, p1 + d1 * (len * 0.5)], 0.00018, hair_base(r.seed) * 0.90))
    };
    strands(&mut out, head, hm, &tris, mask, 1900.0 * detail.clamp(0.25, 2.0), 0.0005, &make);
    // eyelashes
    for upper in [true, false] {
        let lm = move |p: Vec3| lash_mask(p, upper);
        let lt = touching(head, &lm, 0.3);
        let lash = move |r: &Root| {
            if r.mask < 0.45 {
                return None;
            }
            let sx = if r.p0.x >= 0.0 { 1.0 } else { -1.0 };
            let (lx, _) = eye_local(v(r.p0.x.abs(), r.p0.y, r.p0.z));
            let fan = sx * lx / LID_W; // -1 inner corner .. 1 outer corner
            let edge = 1.0 - 0.45 * (lx / LID_W).abs().powi(2);
            let j = jitter(r.seed) * 0.12;
            let (d0, d1, len) = if upper {
                ((v(0.55 * fan, -0.25, 1.0) + j).normalize(), (v(0.75 * fan, 0.85, 0.55) + j).normalize(), 0.0058 * edge * (0.7 + 0.5 * hash(r.seed + 2)))
            } else {
                ((v(0.45 * fan, -0.55, 1.0) + j).normalize(), (v(0.60 * fan, -0.90, 0.45) + j).normalize(), 0.0028 * edge * (0.6 + 0.6 * hash(r.seed + 2)))
            };
            let p1 = r.pos + d0 * (len * 0.5);
            Some((vec![r.pos, p1, p1 + d1 * (len * 0.5)], 0.00012, srgb(30, 21, 16)))
        };
        strands(&mut out, head, hm, &lt, &lm, if upper { 900.0 } else { 160.0 } * detail.clamp(0.25, 2.0), 0.0002, &lash);
    }
    out.finish()
}
