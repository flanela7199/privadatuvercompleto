//! The head + neck sculpt: an SDF (smooth unions / subtractions) meshed with surface nets.
//!
//! Space: metres, y up, +z = his forward (toward the camera), origin between the ears at
//! eye height. **L = the -x side** (same convention as the toilet's `eye_L`).
//!
//! The mouth is sculpted slightly OPEN (a lens-shaped gap, so the isosurface resolves both
//! lips) and then closed by [`close_warp`]: every vertex keeps its sculpt position `p0`
//! (used to classify upper / lower lip, masks, colours, morph fields) next to its rest
//! position.
use super::iso;
use super::sdf::*;
use glam::Vec3;

/* ------------------------------------------------------------------ landmarks */
/// eyeball centre (+x side; mirror x for the other) and radius
pub const EYE: Vec3 = Vec3::new(0.0318, 0.0100, 0.0668);
pub const EYE_R: f32 = 0.0124;
/// eye opening (almond): half width, upper / lower height, shear (outer corner up)
pub const LID_W: f32 = 0.0140;
pub const LID_UP: f32 = 0.0058;
pub const LID_LOW: f32 = 0.0042;
pub const LID_SHEAR: f32 = 0.05;
pub const LID_DY: f32 = 0.0006;
/// jaw hinge (x-axis through this point)
pub const HINGE: Vec3 = Vec3::new(0.0, -0.020, -0.008);
/// mouth: lip line y at the centre, half width, corner z
pub const MOUTH_Y: f32 = -0.0625;
pub const MOUTH_W: f32 = 0.0245;
pub const MOUTH_GAP: f32 = 0.0030;
/// bind positions of the neck / head bones (model space); the rest of the skeleton is in body.rs
pub const NECK_POS: Vec3 = Vec3::new(0.0, -0.155, -0.034);
pub const HEAD_POS: Vec3 = Vec3::new(0.0, -0.072, -0.022);
/// where the neck skin ends (hidden inside the collar)
pub const NECK_CUT: f32 = -0.204;
/// centre used to project hair roots onto the scalp
pub const SKULL_C: Vec3 = Vec3::new(0.0, 0.030, -0.012);

/// lip line height at x (corners slightly up: friendly)
#[inline]
pub fn lip_line(x: f32) -> f32 {
    MOUTH_Y + 2.2 * x * x
}
/// half height of the sculpted mouth gap at x
#[inline]
pub fn lip_gap(x: f32) -> f32 {
    let t = 1.0 - (x / MOUTH_W) * (x / MOUTH_W);
    if t <= 0.0 { 0.0 } else { MOUTH_GAP * t.sqrt() }
}

/// eye-opening coordinates of a mirrored point: (lx, ly) with the shear removed
#[inline]
pub fn eye_local(q: Vec3) -> (f32, f32) {
    let lx = q.x - EYE.x;
    (lx, q.y - EYE.y - LID_DY - LID_SHEAR * lx)
}
/// upper / lower lid curve heights (in `eye_local` y) at lx; both 0 outside the opening
#[inline]
pub fn lid_curves(lx: f32) -> (f32, f32) {
    if lx.abs() >= LID_W {
        return (0.0, 0.0);
    }
    let ru = (LID_W * LID_W + LID_UP * LID_UP) / (2.0 * LID_UP);
    let rl = (LID_W * LID_W + LID_LOW * LID_LOW) / (2.0 * LID_LOW);
    ((LID_UP - ru) + (ru * ru - lx * lx).sqrt(), (rl - LID_LOW) - (rl * rl - lx * lx).sqrt())
}
fn almond(q: Vec3) -> f32 {
    let (lx, ly) = eye_local(q);
    let ru = (LID_W * LID_W + LID_UP * LID_UP) / (2.0 * LID_UP);
    let rl = (LID_W * LID_W + LID_LOW * LID_LOW) / (2.0 * LID_LOW);
    let du = (lx * lx + (ly - (LID_UP - ru)).powi(2)).sqrt() - ru;
    let dl = (lx * lx + (ly - (rl - LID_LOW)).powi(2)).sqrt() - rl;
    du.max(dl)
}

/* ------------------------------------------------------------------ sculpt */
const M: f32 = MOUTH_Y;
/// the lips (vermilion) alone: used for the lip colour mask and the beard exclusion
pub fn lips_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let up = ellipsoid(q, v(0.0075, M + 0.0056, 0.0915), v(0.0138, 0.0040, 0.0068));
    let up = smin(up, ellipsoid(q, v(0.0, M + 0.0048, 0.0932), v(0.0060, 0.0038, 0.0056)), 0.004);
    let low = ellipsoid(q, v(0.0, M - 0.0064, 0.0924), v(0.0170, 0.0052, 0.0074));
    up.min(low)
}

/// skull + face without ears / neck (the scalp the hair grows on)
pub fn skull_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let mut d = ellipsoid(q, SKULL_C, v(0.0800, 0.0915, 0.0970));
    // face block, jaw, chin
    d = smin(d, ellipsoid(q, v(0.0, -0.030, 0.020), v(0.0612, 0.0710, 0.0700)), 0.030);
    d = smin(d, capsule2(q, v(0.0550, -0.060, -0.002), v(0.0230, -0.0935, 0.0640), 0.0200, 0.0172), 0.024);
    d = smin(d, ellipsoid(q, v(0.0, -0.0930, 0.0725), v(0.0255, 0.0195, 0.0200)), 0.020);
    // cheekbones
    d = smin(d, ellipsoid(q, v(0.0455, -0.0130, 0.0500), v(0.0215, 0.0145, 0.0220)), 0.022);
    d
}

/// head + neck before the eye openings and the mouth are cut (sculpt space)
pub fn head_core(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let mut d = skull_sdf(p);
    // brow ridge
    d = smin(d, capsule2(q, v(0.0090, 0.0300, 0.0800), v(0.0500, 0.0305, 0.0610), 0.0090, 0.0075), 0.016);
    // orbital hollow, then the eyelids = a shell around the eyeball
    d = smax(d, -ellipsoid(q, v(0.0330, 0.0090, 0.0905), v(0.0195, 0.0120, 0.0150)), 0.010);
    d = smin(d, sphere(q, EYE, EYE_R + 0.0020), 0.0050);
    // muzzle (the area that carries the lips) + lips
    d = smin(d, ellipsoid(q, v(0.0, M - 0.0020, 0.0680), v(0.0330, 0.0220, 0.0290)), 0.016);
    d = smin(d, lips_sdf(p), 0.0040);
    // nose: bridge, tip, wings, columella, nostrils
    d = smin(d, capsule2(q, v(0.0, 0.0170, 0.0850), v(0.0, -0.0240, 0.1035), 0.0068, 0.0082), 0.013);
    d = smin(d, sphere(q, v(0.0, -0.0300, 0.1078), 0.0086), 0.008);
    d = smin(d, ellipsoid(q, v(0.0102, -0.0345, 0.0972), v(0.0066, 0.0060, 0.0084)), 0.006);
    d = smin(d, capsule(q, v(0.0, -0.0360, 0.1040), v(0.0, -0.0415, 0.0950), 0.0040), 0.004);
    d = smax(d, -ellipsoid(q, v(0.0068, -0.0415, 0.0995), v(0.0038, 0.0030, 0.0060)), 0.002);
    // philtrum, nasolabial fold, groove under the lower lip
    d = smax(d, -capsule(q, v(0.0, -0.0445, 0.1000), v(0.0, -0.0500, 0.1020), 0.0024), 0.004);
    d = smax(d, -capsule(q, v(0.0185, -0.0370, 0.0925), v(0.0325, -0.0610, 0.0850), 0.0022), 0.008);
    d = smax(d, -ellipsoid(q, v(0.0, M - 0.0165, 0.1000), v(0.0170, 0.0042, 0.0070)), 0.008);
    // ears
    d = smin(d, ear_sdf(q), 0.005);
    // neck
    d = smin(d, capsule2(p, v(0.0, -0.075, -0.024), v(0.0, -0.220, -0.040), 0.0490, 0.0565), 0.030);
    d = smin(d, sphere(p, v(0.0, -0.140, 0.0210), 0.0110), 0.022);
    d.max(-(p.y - NECK_CUT))
}

/// signed distance to the mouth gap between the lips (sculpt space)
pub fn mouth_gap(p: Vec3) -> f32 {
    ((p.y - lip_line(p.x)).abs() - lip_gap(p.x)).max(0.060 - p.z)
}

/// full head + neck in sculpt space (mouth gap open)
pub fn head_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let mut d = head_core(p);
    // eye opening: an almond cut down to just under the eyeball surface
    // (the floor of the cut stays well behind the concave iris, or skin shows through the pupil)
    let open = almond(q).max(EYE.z + 0.0015 - q.z).max(-sphere(q, EYE, EYE_R - 0.0048));
    d = d.max(-open);
    // mouth: cavity + the lens-shaped gap between the lips
    d = d.max(-mouth_cavity(p));
    d.max(-mouth_gap(p))
}

pub fn mouth_cavity(p: Vec3) -> f32 {
    ellipsoid(p, v(0.0, M - 0.0010, 0.0560), v(0.0225, 0.0145, 0.0270))
}

/// 1 on surfaces created by the cuts (mouth walls / cavity, eye dents), 0 on the outer skin
pub fn cut_wall(p: Vec3) -> f32 {
    sstep(-0.0006, -0.0022, head_core(p))
}

fn ear_sdf(q: Vec3) -> f32 {
    let c = v(0.0760, -0.0120, -0.0140);
    let l = rot_x(rot_y(q, c, 0.38), c, -0.18);
    let mut d = ellipsoid(l, c, v(0.0062, 0.0300, 0.0165));
    d = smax(d, -ellipsoid(l, c + v(0.0062, 0.0030, 0.0010), v(0.0058, 0.0205, 0.0100)), 0.003);
    d = smin(d, sphere(l, c + v(0.0005, -0.0265, 0.0020), 0.0072), 0.006);
    d
}

/// sculpt position -> rest position (closes the mouth gap)
pub fn close_warp(p: Vec3) -> Vec3 {
    let g = lip_gap(p.x);
    if g <= 0.0 || p.z < 0.056 {
        return p;
    }
    let u = p.y - lip_line(p.x);
    let zone = sstep(0.056, 0.068, p.z);
    let shift = u.abs().min(g) * (-(u.abs() - g).max(0.0) / 0.0075).exp() * zone;
    v(p.x, p.y - u.signum() * shift, p.z)
}

/* ------------------------------------------------------------------ masks */
/// (chest, neck, head) skin weights; sum = 1
pub fn skin_weights(p: Vec3) -> [f32; 3] {
    let wh = sstep(-0.140, -0.088, p.y + 0.5 * (p.z - 0.01).max(0.0));
    let wt = sstep(-0.200, -0.150, p.y).max(wh);
    [1.0 - wt, wt - wh, wh]
}

/// > 0 inside the scalp-hair region (metres-ish)
pub fn hair_region(p: Vec3) -> f32 {
    let ax = p.x.abs();
    let front = p.y - (0.0740 - 4.0 * ax * ax);
    let side = (0.020 + 0.30 * p.y.clamp(-0.05, 0.09)) - p.z;
    let low = p.y - mix(-0.085, -0.030, sstep(-0.035, 0.0, p.z));
    front.max(side.min(low))
}

/// 0..1 beard + mustache coverage (sculpt space)
pub fn beard_mask(p: Vec3) -> f32 {
    // cheek line: from the nose base near the mouth (so the mustache connects) up to the sideburn
    let line = mix(-0.0405, -0.0060, sstep(0.090, 0.018, p.z).powf(1.3));
    let mut m = sstep(line + 0.003, line - 0.003, p.y);
    // neckline, sideburn back edge; not on the lips or on the cut surfaces (inside the mouth)
    let nl = mix(-0.0990, -0.1260, sstep(0.0, 0.070, p.z));
    m *= sstep(nl - 0.009, nl + 0.007, p.y);
    // back edge: follows the jaw toward the ear, fading out
    let back = mix(-0.006, 0.006, sstep(-0.085, -0.030, p.y));
    m *= sstep(back - 0.010, back + 0.010, p.z);
    m *= sstep(0.0003, 0.0040, lips_sdf(p));
    m * (1.0 - cut_wall(p))
}

/// eyebrow centre line (y at |x|) and half height
pub fn brow_line(ax: f32) -> (f32, f32) {
    let t = ((ax - 0.0085) / (0.0540 - 0.0085)).clamp(0.0, 1.0);
    let y = 0.0302 + 0.0034 * (t * 1.9).min(1.0).powf(0.8) - 0.0055 * sstep(0.62, 1.0, t);
    let hh = mix(0.0044, 0.0038, t) * sstep(1.0, 0.72, t).max(0.25) * sstep(0.0, 0.06, t).max(0.55);
    (y, hh)
}
pub fn brow_mask(p: Vec3) -> f32 {
    let ax = p.x.abs();
    let (y, hh) = brow_line(ax);
    sstep(hh + 0.0008, hh - 0.0008, (p.y - y).abs()) * sstep(0.0075, 0.0095, ax) * sstep(0.0550, 0.0530, ax) * sstep(0.045, 0.055, p.z)
}

/// linear-rgb vertex colour of the head (skin tones, lips, mouth interior, shadow under hair/beard)
pub fn color(p: Vec3) -> Vec3 {
    color_ao(p, None)
}
/// colour with baked ambient occlusion (`n` = the surface normal): creases, sockets and nostrils get darker and warmer
pub fn color_ao(p: Vec3, n: Option<Vec3>) -> Vec3 {
    let q = v(p.x.abs(), p.y, p.z);
    let mut c = srgb(226, 176, 146);
    // blotchy, low-frequency tone variation (never a flat plastic colour)
    let blotch = (61.0 * p.x + 13.0 * p.y).sin() * (47.0 * p.y - 29.0 * p.z).sin() + 0.6 * (131.0 * p.x - 87.0 * p.y + 59.0 * p.z).sin();
    c = c.lerp(srgb(214, 150, 124), 0.10 + 0.06 * blotch);
    // warmth: cheeks, nose, ears, chin; paler forehead; darker under the eyes
    let rosy = srgb(214, 132, 112);
    c = c.lerp(rosy, 0.42 * gauss(q, v(0.043, -0.026, 0.068), v(0.022, 0.017, 0.03)));
    c = c.lerp(rosy, 0.40 * gauss(q, v(0.0, -0.030, 0.106), v(0.014, 0.013, 0.014)));
    c = c.lerp(rosy, 0.50 * sstep(0.070, 0.078, q.x) * sstep(0.01, -0.005, q.z));
    c = c.lerp(srgb(236, 196, 166), 0.30 * gauss(q, v(0.0, 0.058, 0.080), v(0.045, 0.022, 0.03)));
    c = c.lerp(srgb(176, 124, 112), 0.30 * gauss(q, v(0.030, -0.004, 0.078), v(0.014, 0.005, 0.012)));
    // caruncle (inner corner of the eye)
    c = c.lerp(srgb(206, 122, 116), 0.8 * gauss(q, v(EYE.x - LID_W + 0.0008, EYE.y - 0.0006, EYE.z + EYE_R - 0.002), v(0.0022, 0.0018, 0.004)));
    // lips
    let wall = cut_wall(p);
    let lip = sstep(0.0014, 0.0002, lips_sdf(p)) * (1.0 - wall);
    c = c.lerp(srgb(128, 56, 60), 0.90 * lip);
    // the line where the lips meet
    let crease = sstep(0.0016, 0.0002, mouth_gap(p)) * sstep(MOUTH_W + 0.002, MOUTH_W - 0.004, q.x) * (1.0 - wall);
    c = c.lerp(srgb(96, 44, 44), 0.75 * crease);
    // lid rim / lash line
    let (lx, ly) = eye_local(q);
    let (yu, yl) = lid_curves(lx);
    let near = sstep(EYE_R + 0.006, EYE_R + 0.003, (q - EYE).length());
    if lx.abs() < LID_W + 0.001 {
        let lash = sstep(0.0022, 0.0004, (ly - yu).abs()) * near * sstep(-0.001, 0.0005, ly - yu + 0.001);
        c = c.lerp(srgb(84, 56, 46), 0.40 * lash);
        let low = sstep(0.0016, 0.0003, (ly - yl).abs()) * near;
        c = c.lerp(srgb(214, 150, 140), 0.55 * low);
    }
    // socket shading
    c *= 1.0 - 0.14 * gauss(q, v(0.0318, 0.017, 0.078), v(0.018, 0.008, 0.012));
    // skin under brows / beard / scalp hair: dark, so gaps between strands never show pink
    c = c.lerp(srgb(120, 88, 70), 0.40 * brow_mask(p));
    c = c.lerp(srgb(60, 43, 34), 0.82 * beard_mask(p));
    // stubble shadow just outside the beard outline
    c = c.lerp(srgb(150, 112, 96), 0.35 * sstep(0.0, 0.3, beard_mask(p + v(0.0, -0.004, 0.0))) * (1.0 - beard_mask(p)));
    let scalp = sstep(0.0, 0.006, hair_region(p)) * sstep(0.004, -0.002, skull_sdf(p));
    c = c.lerp(srgb(44, 30, 23), 0.9 * scalp);
    // baked occlusion: how open the surface is 5 / 14 mm above itself
    if let Some(n) = n {
        let open = |d: f32| (head_sdf(p + n * d) / d).clamp(0.0, 1.0);
        let ao = 0.55 * open(0.005) + 0.45 * open(0.014);
        let k = 1.0 - ao;
        c = c * v(1.0 - 0.42 * k, 1.0 - 0.58 * k, 1.0 - 0.62 * k);
    }
    // mouth interior (walls of the gap + cavity)
    let inside = wall * sstep(0.034, 0.030, q.x) * sstep(0.030, 0.026, (p.y - M).abs()) * sstep(0.020, 0.030, p.z);
    c = c.lerp(srgb(38, 9, 12), inside);
    // the throat goes to black: nothing behind the tongue is visible even with the jaw wide open
    c = c.lerp(srgb(6, 2, 2), inside * sstep(0.070, 0.044, p.z));
    c
}

/* ------------------------------------------------------------------ mesh */
pub struct Surf {
    /// sculpt-space positions (mouth gap open): input of masks and morph fields
    pub p0: Vec<Vec3>,
    /// rest positions
    pub pos: Vec<Vec3>,
    pub nrm: Vec<Vec3>,
    pub idx: Vec<u32>,
}

impl Surf {
    pub fn tri_count(&self) -> usize {
        self.idx.len() / 3
    }
    /// area-weighted vertex normals of `pos`
    pub fn geometric_normals(&self) -> Vec<Vec3> {
        let mut n = vec![Vec3::ZERO; self.pos.len()];
        for t in self.idx.chunks_exact(3) {
            let (a, b, c) = (t[0] as usize, t[1] as usize, t[2] as usize);
            let f = (self.pos[b] - self.pos[a]).cross(self.pos[c] - self.pos[a]);
            n[a] += f;
            n[b] += f;
            n[c] += f;
        }
        n.iter().map(|x| x.normalize_or_zero()).collect()
    }
}

/// `detail` scales the sampling density (1 = default, ~80k triangles; 0.5 for quick tests)
pub fn build_head(detail: f32) -> Surf {
    let s = 1.0 / detail.clamp(0.25, 2.0);
    let xs = iso::axis(-0.100, 0.100, |x| s * mix(0.0023, 0.0034, sstep(0.050, 0.070, x.abs())) * mix(0.70, 1.0, sstep(0.0, 0.006, (x.abs() - EYE.x).abs() - 0.016)));
    let ys = iso::axis(-0.232, 0.132, |y| s * mix(0.0022, 0.0037, sstep(0.0, 0.025, (y + 0.035).abs() - 0.080)) * mix(0.62, 1.0, sstep(0.0, 0.005, (y - EYE.y).abs() - 0.009)));
    let zs = iso::axis(-0.122, 0.128, |z| s * mix(0.0040, 0.0022, sstep(0.030, 0.055, z)));
    let m = iso::surface_nets(&head_sdf, &xs, &ys, &zs, 1.7);
    let pos: Vec<Vec3> = m.positions.iter().map(|&p| close_warp(p)).collect();
    let mut surf = Surf { p0: m.positions, pos, nrm: m.normals, idx: m.indices };
    // the warped lip zone gets geometric normals
    let g = surf.geometric_normals();
    for i in 0..surf.pos.len() {
        let moved = (surf.pos[i] - surf.p0[i]).length();
        if moved > 1e-6 {
            let t = (moved / 0.0006).min(1.0);
            surf.nrm[i] = surf.nrm[i].lerp(g[i], t).normalize_or(surf.nrm[i]);
        }
    }
    surf
}
