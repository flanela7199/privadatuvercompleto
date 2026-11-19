//! Everything that is not the head skin: eyes, teeth + tongue, hoodie torso, headphones,
//! cable plug, chair headrest. All in model space (see head.rs) unless noted.
use super::head::*;
use super::iso;
use super::sdf::*;
use glam::Vec3;

/// A renderable piece: geometry + linear-rgb vertex colours (+ optional skin weights and morphs).
#[derive(Default, Clone)]
pub struct Part {
    pub pos: Vec<Vec3>,
    pub nrm: Vec<Vec3>,
    pub col: Vec<Vec3>,
    pub idx: Vec<u32>,
    /// (chest, neck, head) weights per vertex; empty = rigid
    pub skin: Vec<[f32; 3]>,
    /// (morph index, per-vertex deltas): only the morphs that move this part
    pub morphs: Vec<(usize, Vec<Vec3>)>,
}

impl Part {
    pub fn tri_count(&self) -> usize {
        self.idx.len() / 3
    }
    pub fn from_iso(m: iso::Iso, color: impl Fn(Vec3, Vec3) -> Vec3) -> Part {
        let col = m.positions.iter().zip(&m.normals).map(|(&p, &n)| color(p, n)).collect();
        Part { pos: m.positions, nrm: m.normals, col, idx: m.indices, ..Default::default() }
    }
    /// append another rigid part
    pub fn append(&mut self, o: &Part) {
        let base = self.pos.len() as u32;
        self.pos.extend_from_slice(&o.pos);
        self.nrm.extend_from_slice(&o.nrm);
        self.col.extend_from_slice(&o.col);
        self.idx.extend(o.idx.iter().map(|i| i + base));
    }
    /// Sweep a tube along `pts`. `frame[i]` = a normal hint per point, `radius(t)` = (across, along-normal)
    /// half sizes at t = 0..1, `color(t)`; the tip closes when the radius reaches ~0.
    pub fn tube(&mut self, pts: &[Vec3], frame: &[Vec3], sides: usize, radius: impl Fn(f32) -> (f32, f32), color: impl Fn(f32) -> Vec3) -> usize {
        let n = pts.len();
        let base = self.pos.len();
        for i in 0..n {
            let t = i as f32 / (n - 1) as f32;
            let tan = (pts[(i + 1).min(n - 1)] - pts[i.saturating_sub(1)]).normalize_or(Vec3::Y);
            let mut nn = frame[i] - tan * frame[i].dot(tan);
            if nn.length_squared() < 1e-8 {
                nn = tan.any_orthogonal_vector();
            }
            let nn = nn.normalize();
            let b = tan.cross(nn);
            let (rb, rn) = radius(t);
            let c = color(t);
            for k in 0..sides {
                let a = k as f32 / sides as f32 * std::f32::consts::TAU;
                let (s, co) = a.sin_cos();
                self.pos.push(pts[i] + b * (co * rb) + nn * (s * rn));
                self.nrm.push((b * (co * rn.max(1e-6)) + nn * (s * rb.max(1e-6))).normalize_or(nn));
                self.col.push(c);
            }
        }
        for i in 0..n - 1 {
            for k in 0..sides {
                let a = (base + i * sides + k) as u32;
                let b = (base + i * sides + (k + 1) % sides) as u32;
                let c = (base + (i + 1) * sides + k) as u32;
                let d = (base + (i + 1) * sides + (k + 1) % sides) as u32;
                self.idx.extend_from_slice(&[a, b, d, a, d, c]);
            }
        }
        base
    }
}

/// where the bust is cut (model space y)
pub const BUST_BOTTOM: f32 = -0.420;

/* ------------------------------------------------------------------ eyes */
pub const IRIS_R: f32 = 0.0088;
pub const PUPIL_R: f32 = 0.0033;

fn lathe_z(profile: &[(f32, f32, Vec3, Vec3)], seg: usize) -> Part {
    // profile: (radius, z, colour, normal as (radial, _, z))
    let mut p = Part::default();
    for &(r, z, c, n) in profile {
        for k in 0..=seg {
            let a = k as f32 / seg as f32 * std::f32::consts::TAU;
            let (s, co) = a.sin_cos();
            p.pos.push(v(r * co, r * s, z));
            p.nrm.push(v(n.x * co, n.x * s, n.z).normalize_or(Vec3::Z));
            p.col.push(c);
        }
    }
    let w = (seg + 1) as u32;
    for i in 0..profile.len() as u32 - 1 {
        for k in 0..seg as u32 {
            let (a, b, c, d) = (i * w + k, i * w + k + 1, (i + 1) * w + k, (i + 1) * w + k + 1);
            // rings run from the back pole to the front: keep the outside CCW
            p.idx.extend_from_slice(&[a, c, d, a, d, b]);
        }
    }
    p
}

/// eyeball in eye-local space (origin = centre, +z = gaze): sclera + concave iris + pupil
pub fn eye() -> Part {
    let r = EYE_R;
    let white = srgb(238, 232, 226);
    let mut prof = Vec::new();
    let tl = (IRIS_R / r).asin();
    let steps = 22;
    for i in 0..=steps {
        let th = std::f32::consts::PI + (tl - std::f32::consts::PI) * i as f32 / steps as f32;
        let (s, c) = th.sin_cos();
        // a little pink toward the back / corners
        let col = white.lerp(srgb(226, 178, 168), 0.5 * sstep(0.45, 1.0, th / std::f32::consts::PI));
        prof.push((r * s, r * c, col, v(s, 0.0, c)));
    }
    let zl = r * tl.cos();
    let depth = 0.0017;
    let limbal = srgb(38, 24, 16);
    let outer = srgb(92, 56, 30);
    let inner = srgb(150, 96, 48);
    let iris_n = v(-0.30, 0.0, 1.0);
    let ring = |f: f32, c: Vec3| (IRIS_R * f, zl - depth * (1.0 - f), c, iris_n);
    prof.push(ring(1.0, limbal));
    prof.push(ring(0.90, limbal.lerp(outer, 0.7)));
    prof.push(ring(0.74, outer));
    prof.push(ring(0.52, inner));
    let pf = PUPIL_R / IRIS_R;
    prof.push(ring(pf + 0.04, inner.lerp(limbal, 0.4)));
    let black = v(0.004, 0.003, 0.003);
    prof.push(ring(pf, black));
    prof.push(ring(0.0, black));
    lathe_z(&prof, 40)
}

/// transparent cornea dome over the iris (eye-local)
pub fn cornea() -> Part {
    let r = EYE_R;
    let tl = (IRIS_R * 1.06 / r).asin();
    let zl = r * tl.cos() - 0.0002;
    let apex = r + 0.0012;
    let mut prof = Vec::new();
    let steps = 8;
    for i in 0..=steps {
        let t = std::f32::consts::FRAC_PI_2 * (1.0 - i as f32 / steps as f32);
        let (s, c) = t.sin_cos();
        let rr = IRIS_R * 1.06;
        prof.push((rr * s, zl + (apex - zl) * c, Vec3::ONE, v(s * (apex - zl), 0.0, c * rr)));
    }
    lathe_z(&prof, 40)
}

/* ------------------------------------------------------------------ teeth + tongue */
fn arch(p: Vec3, cz: f32, rx: f32, rz: f32, y: f32, r: Vec3, n: usize, k: f32) -> f32 {
    let mut d = f32::MAX;
    for i in 0..n {
        let a = (i as f32 + 0.5 - n as f32 / 2.0) * (2.7 / n as f32);
        let (s, c) = a.sin_cos();
        let ctr = v(rx * s, y, cz + rz * c);
        // tooth frame: tangent along the arch, radial outward
        let tan = v(rx * c, 0.0, -rz * s).normalize();
        let rad = v(tan.z, 0.0, -tan.x);
        let l = p - ctr;
        let q = v(l.dot(tan), l.y, l.dot(rad));
        d = smin(d, ellipsoid(q, Vec3::ZERO, r), k);
    }
    d
}
const M: f32 = MOUTH_Y;
fn upper_teeth_sdf(p: Vec3) -> f32 {
    let t = arch(p, 0.0520, 0.0205, 0.0242, M + 0.0035, v(0.0041, 0.0050, 0.0026), 12, 0.0010);
    smin(t, arch(p, 0.0515, 0.0205, 0.0242, M + 0.0100, v(0.0046, 0.0042, 0.0036), 12, 0.0035), 0.0015)
}
fn tongue_sdf(p: Vec3) -> f32 {
    smin(ellipsoid(p, v(0.0, M - 0.0110, 0.0500), v(0.0150, 0.0050, 0.0190)), ellipsoid(p, v(0.0, M - 0.0115, 0.0380), v(0.0165, 0.0062, 0.0120)), 0.006)
}
fn lower_teeth_sdf(p: Vec3) -> f32 {
    let t = arch(p, 0.0500, 0.0190, 0.0232, M - 0.0078, v(0.0035, 0.0047, 0.0024), 12, 0.0010);
    let g = arch(p, 0.0495, 0.0190, 0.0232, M - 0.0136, v(0.0042, 0.0038, 0.0034), 12, 0.0035);
    smin(t, g, 0.0015).min(tongue_sdf(p))
}
fn tooth_color(p: Vec3, upper: bool) -> Vec3 {
    let enamel = srgb(240, 234, 222);
    let gum = srgb(196, 104, 108);
    if upper {
        enamel.lerp(gum, sstep(M + 0.0068, M + 0.0084, p.y))
    } else {
        enamel.lerp(gum, sstep(M - 0.0110, M - 0.0126, p.y)).lerp(srgb(198, 96, 104), sstep(0.0012, 0.0, tongue_sdf(p)))
    }
}
pub fn mouth_upper() -> Part {
    let c = 0.0012;
    let m = iso::surface_nets(&upper_teeth_sdf, &iso::uniform(-0.028, 0.028, c), &iso::uniform(M - 0.005, M + 0.018, c), &iso::uniform(0.020, 0.084, c), 1.6);
    Part::from_iso(m, |p, _| tooth_color(p, true))
}
pub fn mouth_lower() -> Part {
    let c = 0.0012;
    let m = iso::surface_nets(&lower_teeth_sdf, &iso::uniform(-0.026, 0.026, c), &iso::uniform(M - 0.023, M + 0.001, c), &iso::uniform(0.018, 0.080, c), 1.6);
    Part::from_iso(m, |p, _| tooth_color(p, false))
}

/* ------------------------------------------------------------------ hoodie torso */
const TORSO_UP: f32 = 0.058;
const TORSO_SX: f32 = 0.86;
fn collar_sdf(p: Vec3) -> f32 {
    torus(p, v(0.0, -0.224, -0.030), v(0.0, 1.0, 0.30).normalize(), 0.0690, 0.0135)
}
/// the hoodie in its own proportions (before it is raised / narrowed to fit the stylized head)
fn hoodie(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let mut d = ellipsoid(q, v(0.0, -0.430, -0.030), v(0.168, 0.200, 0.108));
    d = smin(d, capsule(q, v(0.0, -0.292, -0.038), v(0.150, -0.300, -0.040), 0.060), 0.050);
    d = smin(d, sphere(q, v(0.186, -0.325, -0.040), 0.068), 0.040);
    d = smin(d, capsule(q, v(0.196, -0.330, -0.040), v(0.216, -0.620, -0.020), 0.059), 0.030);
    d = smin(d, capsule(q, v(0.035, -0.238, -0.050), v(0.130, -0.276, -0.045), 0.036), 0.040);
    // hood bunched behind the neck + its sides coming forward
    d = smin(d, ellipsoid(q, v(0.0, -0.232, -0.108), v(0.088, 0.046, 0.046)), 0.030);
    d = smin(d, ellipsoid(q, v(0.060, -0.243, -0.070), v(0.046, 0.034, 0.052)), 0.026);
    d = smin(d, capsule(q, v(0.000, -0.215, -0.118), v(0.075, -0.228, -0.085), 0.020), 0.014);
    // ribbed collar ring, tilted forward
    d = smin(d, collar_sdf(p), 0.012);
    // cloth folds
    d += 0.0016 * (52.0 * p.x + 17.0 * p.y).sin() * (38.0 * p.y - 23.0 * p.z + 3.0 * p.x).sin() * sstep(-0.26, -0.33, p.y);
    d += 0.0020 * (60.0 * q.x + 30.0 * p.z).sin() * sstep(0.02, 0.0, (p.y + 0.235).abs() - 0.02) * sstep(-0.05, -0.08, p.z);
    d
}
pub fn torso_sdf(p: Vec3) -> f32 {
    let d = hoodie(v(p.x / TORSO_SX, p.y - TORSO_UP, p.z)) * TORSO_SX;
    // neck hole, soft bottom cut
    let d = smax(d, -capsule(p, v(0.0, -0.090, -0.026), v(0.0, NECK_CUT - 0.004, -0.040), 0.0615), 0.006);
    smax(d, -(p.y - BUST_BOTTOM), 0.012)
}
pub fn torso(detail: f32) -> Part {
    let c = 0.0056 / detail.clamp(0.25, 2.0);
    let m = iso::surface_nets(&torso_sdf, &iso::uniform(-0.270, 0.270, c), &iso::uniform(-0.520, -0.110, c), &iso::uniform(-0.175, 0.115, c), 1.7);
    let cloth = srgb(26, 26, 30);
    let mut part = Part::from_iso(m, |p, _| {
        let rib = sstep(0.004, 0.0, collar_sdf(v(p.x / TORSO_SX, p.y - TORSO_UP, p.z)));
        cloth * (1.0 + 0.25 * rib)
    });
    // drawstrings
    for s in [-1.0f32, 1.0] {
        let pts: Vec<Vec3> = (0..9)
            .map(|i| {
                let t = i as f32 / 8.0;
                v(s * (0.027 + 0.006 * t), -0.210 - 0.105 * t, 0.046 + 0.030 * t - 0.022 * t * t + 0.004)
            })
            .collect();
        let pts: Vec<Vec3> = pts.iter().map(|&p| project_out(&torso_sdf, p, 0.0035)).collect();
        let frame = vec![Vec3::Z; pts.len()];
        part.tube(&pts, &frame, 6, |t| if t > 0.93 { (0.0030, 0.0030) } else { (0.0022, 0.0022) }, |t| if t > 0.9 { srgb(150, 150, 155) } else { srgb(64, 64, 70) });
    }
    part
}

/// push `p` out along the SDF gradient until it floats `gap` above the surface
pub fn project_out(f: &dyn Fn(Vec3) -> f32, mut p: Vec3, gap: f32) -> Vec3 {
    for _ in 0..6 {
        let d = f(p);
        if (d - gap).abs() < 1e-4 {
            break;
        }
        p += iso::gradient(f, p, 0.002) * (gap - d);
    }
    p
}

/* ------------------------------------------------------------------ headphones */
pub const CUP: Vec3 = Vec3::new(0.0925, -0.012, -0.010);
const BAND_O: Vec3 = Vec3::new(0.0, 0.044, -0.011);
const BAND_R: f32 = 0.1035;
const BAND_TILT: f32 = 0.14;
/// where the cable leaves the -x cup (head space)
pub const CABLE_TOP: Vec3 = Vec3::new(-0.0940, -0.0600, -0.006);
/// where the cable disappears at the bottom of the bust (chest space = model space at rest)
pub const CABLE_END: Vec3 = Vec3::new(-0.052, BUST_BOTTOM + 0.004, 0.074);

/// headband coordinates: (radial offset from the arc, across the band, height in the band plane, arc angle)
fn band_coords(p: Vec3) -> (f32, f32, f32, f32) {
    let (s, c) = BAND_TILT.sin_cos();
    let rel = p - BAND_O;
    let (u, vv, w) = (rel.x, rel.y * c - rel.z * s, rel.y * s + rel.z * c);
    ((u * u + vv * vv).sqrt() - BAND_R, w, vv, vv.atan2(u.abs()))
}
fn box2(a: f32, b: f32, ha: f32, hb: f32, r: f32) -> f32 {
    let (qa, qb) = (a.abs() - (ha - r), b.abs() - (hb - r));
    (qa.max(0.0).powi(2) + qb.max(0.0).powi(2)).sqrt() + qa.max(qb).min(0.0) - r
}
/// hard plastic: cups, yokes, headband outer
pub fn hp_shell_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let l = q - CUP;
    let e = ((l.y / 0.047).powi(2) + (l.z / 0.039).powi(2)).sqrt();
    let mut d = box2((e - 1.0) * 0.039 + 0.02, l.x, 0.02, 0.0135, 0.0055);
    d = smin(d, ellipsoid(q, CUP + v(0.0105, 0.0, 0.0), v(0.0085, 0.0405, 0.0335)), 0.004);
    d = smax(d, -torus(q, CUP + v(0.0180, 0.0, 0.0), Vec3::X, 0.0270, 0.0017), 0.001);
    // yoke: half ring around the cup + pivots
    let yc = CUP + v(0.0100, 0.0, 0.0);
    let yoke = torus(q, yc, Vec3::X, 0.0500, 0.0040).max(-(q.y - CUP.y));
    d = smin(d, yoke, 0.002);
    d = smin(d, capsule(v(q.x, q.y, (q.z - CUP.z).abs()), yc + v(0.0, 0.0, 0.0500) - v(0.0, 0.0, CUP.z), yc + v(-0.004, 0.0, 0.0370) - v(0.0, 0.0, CUP.z), 0.0042), 0.002);
    d = smin(d, sphere(q, yc + v(0.0, 0.0500, 0.0), 0.0075), 0.003);
    // headband
    let (rho, w, vv, _) = band_coords(p);
    let band = box2(rho, w, 0.0028, 0.0155, 0.0024).max(0.010 - vv);
    smin(d, band, 0.003)
}
/// soft parts: ear cushions + headband pad
pub fn hp_pad_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let l = q - v(0.0765, CUP.y, CUP.z);
    let ring = (((l.y / 0.0390).powi(2) + (l.z / 0.0310).powi(2)).sqrt() - 1.0) * 0.0310;
    let cushion = (ring * ring + l.x * l.x).sqrt() - 0.0122;
    let (rho, w, vv, ang) = band_coords(p);
    let quilt = 0.0011 * (ang * 30.0).cos();
    let pad = box2(rho + 0.0078 + quilt, w, 0.0058, 0.0168, 0.0050).max(0.058 - vv);
    cushion.min(pad)
}
/// metal: slider stems + cup accent discs
pub fn hp_metal_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let (s, c) = BAND_TILT.sin_cos();
    let end_v = 0.012;
    let end_u = (BAND_R * BAND_R - end_v * end_v).sqrt();
    let end = BAND_O + v(end_u, end_v * c, -end_v * s);
    let top = CUP + v(0.0100, 0.0500, 0.0);
    let stem = round_box(q, (end + top) * 0.5, v(0.0022, (end.y - top.y) * 0.5 + 0.006, 0.0075), 0.0018);
    let l = q - (CUP + v(0.0182, 0.0, 0.0));
    let disc = box2((l.y * l.y + l.z * l.z).sqrt(), l.x, 0.0205, 0.0020, 0.0012);
    stem.min(disc)
}
fn hp_grid(detail: f32) -> (Vec<f32>, Vec<f32>, Vec<f32>) {
    let c = 0.0024 / detail.clamp(0.25, 2.0);
    (iso::uniform(-0.126, 0.126, c), iso::uniform(-0.072, 0.158, c), iso::uniform(-0.068, 0.050, c))
}
pub fn hp_shell(detail: f32) -> Part {
    let (xs, ys, zs) = hp_grid(detail);
    Part::from_iso(iso::surface_nets(&hp_shell_sdf, &xs, &ys, &zs, 1.8), |_, _| srgb(24, 24, 27))
}
pub fn hp_pad(detail: f32) -> Part {
    let (xs, ys, zs) = hp_grid(detail);
    Part::from_iso(iso::surface_nets(&hp_pad_sdf, &xs, &ys, &zs, 1.8), |_, _| srgb(34, 34, 38))
}
pub fn hp_metal(detail: f32) -> Part {
    let (xs, ys, zs) = hp_grid(detail * 1.3);
    Part::from_iso(iso::surface_nets(&hp_metal_sdf, &xs, &ys, &zs, 1.8), |p, _| {
        if (p.x.abs() - (CUP.x + 0.0182)).abs() < 0.004 && (p.y - CUP.y).abs() < 0.03 { srgb(74, 76, 84) } else { srgb(150, 152, 158) }
    })
}

/// the inline plug on the cable: gold barrel with a red ring; local space, axis = +y, centred
pub fn plug() -> Part {
    let f = |p: Vec3| {
        let r = (p.x * p.x + p.z * p.z).sqrt();
        let barrel = box2(r, p.y, 0.0036, 0.0120, 0.0010);
        let ring = box2(r, p.y - 0.0030, 0.0043, 0.0022, 0.0008);
        let tip = box2(r, p.y + 0.0150, 0.0022, 0.0050, 0.0008);
        barrel.min(ring).min(tip)
    };
    let c = 0.0007;
    let m = iso::surface_nets(&f, &iso::uniform(-0.006, 0.006, c), &iso::uniform(-0.022, 0.014, c), &iso::uniform(-0.006, 0.006, c), 1.6);
    Part::from_iso(m, |p, _| {
        let r = (p.x * p.x + p.z * p.z).sqrt();
        if (p.y - 0.0030).abs() < 0.0024 && r > 0.0037 { srgb(190, 30, 34) } else if p.y < -0.0118 { srgb(170, 172, 178) } else { srgb(214, 168, 62) }
    })
}

/* ------------------------------------------------------------------ chair headrest */
pub fn chair_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let mut d = round_box(q, v(0.0, -0.130, -0.205), v(0.132, 0.330, 0.040), 0.035);
    // side wings + headrest pillow
    d = smin(d, round_box(q, v(0.142, -0.250, -0.180), v(0.048, 0.200, 0.050), 0.035), 0.030);
    d = smin(d, round_box(q, v(0.0, 0.070, -0.170), v(0.105, 0.060, 0.030), 0.028), 0.012);
    d.max(-(p.y - BUST_BOTTOM))
}
pub fn chair(detail: f32) -> Part {
    let c = 0.0085 / detail.clamp(0.25, 2.0);
    let m = iso::surface_nets(&chair_sdf, &iso::uniform(-0.230, 0.230, c), &iso::uniform(-0.520, 0.215, c), &iso::uniform(-0.260, -0.110, c), 1.7);
    Part::from_iso(m, |p, _| {
        let stripe = sstep(0.006, 0.003, (p.x.abs() - 0.100).abs()) * sstep(-0.19, -0.18, p.z);
        srgb(30, 30, 34).lerp(srgb(120, 24, 28), stripe)
    })
}
