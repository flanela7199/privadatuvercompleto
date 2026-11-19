//! The full body below the neck: skeleton (bind pose), hoodie sleeves / pants / shoes / hands
//! and automatic skin weights. Model space as in head.rs (origin between the ears, metres),
//! so the floor is at [`FLOOR`]. **L = -x**. Bind pose: standing, arms hanging slightly out.
use super::head::{HEAD_POS, HINGE, NECK_POS, EYE};
use super::iso;
use super::parts::Part;
use super::sdf::*;
use glam::Vec3;

/// floor height in model space (he is ~1.76 m tall with the hair)
pub const FLOOR: f32 = -1.630;

/// (name, parent index or -1, bind position in model space). `plug` lives in root space.
pub const SKELETON: [(&str, i32, [f32; 3]); 25] = [
    ("root", -1, [0.0, 0.0, 0.0]),
    ("pelvis", 0, [0.0, -0.720, -0.030]),
    ("spine1", 1, [0.0, -0.620, -0.030]),
    ("spine2", 2, [0.0, -0.500, -0.030]),
    ("chest", 3, [0.0, -0.370, -0.030]),
    ("neck", 4, [NECK_POS.x, NECK_POS.y, NECK_POS.z]),
    ("head", 5, [HEAD_POS.x, HEAD_POS.y, HEAD_POS.z]),
    ("jaw", 6, [HINGE.x, HINGE.y, HINGE.z]),
    ("eye_L", 6, [-EYE.x, EYE.y, EYE.z]),
    ("eye_R", 6, [EYE.x, EYE.y, EYE.z]),
    ("clavicle_L", 4, [-0.025, -0.235, -0.030]),
    ("upperarm_L", 10, [-0.182, -0.268, -0.038]),
    ("forearm_L", 11, [-0.234, -0.560, -0.035]),
    ("hand_L", 12, [-0.258, -0.800, -0.012]),
    ("clavicle_R", 4, [0.025, -0.235, -0.030]),
    ("upperarm_R", 14, [0.182, -0.268, -0.038]),
    ("forearm_R", 15, [0.234, -0.560, -0.035]),
    ("hand_R", 16, [0.258, -0.800, -0.012]),
    ("thigh_L", 1, [-0.092, -0.790, -0.030]),
    ("shin_L", 18, [-0.100, -1.170, -0.022]),
    ("foot_L", 19, [-0.100, -1.555, -0.035]),
    ("thigh_R", 1, [0.092, -0.790, -0.030]),
    ("shin_R", 21, [0.100, -1.170, -0.022]),
    ("foot_R", 22, [0.100, -1.555, -0.035]),
    ("plug", 0, [0.0, 0.0, 0.0]),
];
pub mod node {
    pub const ROOT: usize = 0;
    pub const PELVIS: usize = 1;
    pub const SPINE1: usize = 2;
    pub const SPINE2: usize = 3;
    pub const CHEST: usize = 4;
    pub const NECK: usize = 5;
    pub const HEAD: usize = 6;
    pub const JAW: usize = 7;
    pub const EYE_L: usize = 8;
    pub const EYE_R: usize = 9;
    pub const CLAVICLE_L: usize = 10;
    pub const UPPERARM_L: usize = 11;
    pub const FOREARM_L: usize = 12;
    pub const HAND_L: usize = 13;
    pub const CLAVICLE_R: usize = 14;
    pub const UPPERARM_R: usize = 15;
    pub const FOREARM_R: usize = 16;
    pub const HAND_R: usize = 17;
    pub const THIGH_L: usize = 18;
    pub const SHIN_L: usize = 19;
    pub const FOOT_L: usize = 20;
    pub const THIGH_R: usize = 21;
    pub const SHIN_R: usize = 22;
    pub const FOOT_R: usize = 23;
    pub const PLUG: usize = 24;
}
/// bones that deform meshes, in skin-index order (indices into [`SKELETON`])
pub const SKIN_BONES: [usize; 20] = [1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
/// skin indices of chest / neck / head (what `head::skin_weights` refers to)
pub const SKIN_CHEST_NECK_HEAD: [u8; 3] = [3, 4, 5];

pub fn bind(i: usize) -> Vec3 {
    Vec3::from_array(SKELETON[i].2)
}
/// bind position relative to the parent
pub fn bind_local(i: usize) -> Vec3 {
    let p = SKELETON[i].1;
    if p < 0 { bind(i) } else { bind(i) - bind(p as usize) }
}

/* ------------------------------------------------------------------ automatic skin weights */
/// (skin index of the +x / centre bone, skin index of its -x twin, from, to, radius the bone "owns")
const SEGS: [(u8, u8, [f32; 3], [f32; 3], f32); 12] = [
    (0, 0, [0.0, -0.720, -0.030], [0.0, -0.800, -0.030], 0.120),   // pelvis
    (1, 1, [0.0, -0.620, -0.030], [0.0, -0.540, -0.030], 0.120),   // spine1
    (2, 2, [0.0, -0.500, -0.030], [0.0, -0.410, -0.030], 0.120),   // spine2
    (3, 3, [0.0, -0.370, -0.030], [0.0, -0.230, -0.035], 0.120),   // chest
    (10, 6, [0.040, -0.238, -0.030], [0.170, -0.262, -0.036], 0.050), // clavicle
    (11, 7, [0.182, -0.268, -0.038], [0.234, -0.560, -0.035], 0.050), // upper arm
    (12, 8, [0.234, -0.560, -0.035], [0.258, -0.800, -0.012], 0.042), // forearm
    (13, 9, [0.258, -0.800, -0.012], [0.262, -0.970, 0.000], 0.030),  // hand
    (17, 14, [0.092, -0.790, -0.030], [0.100, -1.170, -0.022], 0.080), // thigh
    (18, 15, [0.100, -1.170, -0.022], [0.100, -1.555, -0.035], 0.055), // shin
    (19, 16, [0.100, -1.555, -0.035], [0.100, -1.600, 0.110], 0.050),  // foot
    (4, 4, [0.0, -0.200, -0.036], [0.0, -0.100, -0.026], 0.050),    // neck (collar / hood)
];

/// up to three (skin index, weight) influences of a body point
pub fn auto_skin(p: Vec3) -> ([u8; 3], [f32; 3]) {
    let q = v(p.x.abs(), p.y, p.z);
    let mut best: [(u8, f32); 3] = [(0, 0.0); 3];
    for &(right, left, a, b, r) in &SEGS {
        let d = (capsule(q, Vec3::from_array(a), Vec3::from_array(b), r)).max(0.0) + 0.008;
        let w = 1.0 / (d * d * d * d);
        let idx = if p.x >= 0.0 { right } else { left };
        // insert into the top three
        if w > best[2].1 {
            best[2] = (idx, w);
            if best[2].1 > best[1].1 {
                best.swap(1, 2);
            }
            if best[1].1 > best[0].1 {
                best.swap(0, 1);
            }
        }
    }
    let sum: f32 = best.iter().map(|b| b.1).sum();
    let mut w = [best[0].1 / sum, best[1].1 / sum, best[2].1 / sum];
    // drop tiny influences
    for x in w.iter_mut().skip(1) {
        if *x < 0.03 {
            *x = 0.0;
        }
    }
    let s = w[0] + w[1] + w[2];
    ([best[0].0, best[1].0, best[2].0], [w[0] / s, w[1] / s, w[2] / s])
}

pub fn skin_part(part: &mut Part) {
    let (idx, w): (Vec<[u8; 3]>, Vec<[f32; 3]>) = part.pos.iter().map(|&p| auto_skin(p)).unzip();
    part.skin_idx = idx;
    part.skin = w;
}

/* ------------------------------------------------------------------ meshes */
/// hoodie sleeves (upper arm, forearm, cuff), mirrored
pub fn sleeves_sdf(q: Vec3) -> f32 {
    let mut d = capsule2(q, v(0.184, -0.272, -0.038), v(0.234, -0.560, -0.035), 0.061, 0.051);
    d = smin(d, capsule2(q, v(0.234, -0.560, -0.035), v(0.257, -0.785, -0.013), 0.050, 0.041), 0.012);
    d = smin(d, capsule(q, v(0.2565, -0.772, -0.014), v(0.2585, -0.800, -0.012), 0.0435), 0.006);
    d + 0.0014 * (70.0 * q.y + 25.0 * q.x).sin() * (45.0 * q.z + 30.0 * q.y).sin()
}

pub fn pants_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let mut d = ellipsoid(q, v(0.0, -0.775, -0.030), v(0.160, 0.105, 0.108));
    d = smin(d, capsule2(q, v(0.092, -0.800, -0.030), v(0.100, -1.170, -0.022), 0.088, 0.062), 0.035);
    d = smin(d, capsule2(q, v(0.100, -1.170, -0.022), v(0.100, -1.545, -0.035), 0.060, 0.047), 0.020);
    d += 0.0016 * (48.0 * p.y + 20.0 * q.x).sin() * (36.0 * p.z - 22.0 * p.y).sin();
    d.max(p.y + 0.690)
}
pub fn pants(detail: f32) -> Part {
    let c = 0.0095 / detail.clamp(0.25, 2.0);
    let m = iso::surface_nets(&pants_sdf, &iso::uniform(-0.24, 0.24, c), &iso::uniform(-1.62, -0.67, c), &iso::uniform(-0.17, 0.11, c), 1.7);
    let mut p = Part::from_iso(m, |q, _| srgb(44, 47, 58) * (0.92 + 0.16 * hash((q.y * 900.0) as i32 as u32)));
    skin_part(&mut p);
    p
}

pub fn shoes_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let mut d = ellipsoid(q, v(0.100, -1.585, 0.030), v(0.050, 0.050, 0.122));
    d = smin(d, sphere(q, v(0.100, -1.588, -0.045), 0.046), 0.020);
    d = smin(d, capsule(q, v(0.100, -1.560, -0.035), v(0.100, -1.530, -0.035), 0.052), 0.010);
    d.max(FLOOR - p.y)
}
pub fn shoes(detail: f32) -> Part {
    let c = 0.0070 / detail.clamp(0.25, 2.0);
    let m = iso::surface_nets(&shoes_sdf, &iso::uniform(-0.17, 0.17, c), &iso::uniform(FLOOR - 0.01, -1.50, c), &iso::uniform(-0.11, 0.17, c), 1.7);
    let mut p = Part::from_iso(m, |q, _| if q.y < FLOOR + 0.020 { srgb(226, 224, 218) } else { srgb(28, 28, 32) });
    skin_part(&mut p);
    p
}

pub fn hands_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let mut d = ellipsoid(q, v(0.2620, -0.862, -0.004), v(0.0150, 0.0470, 0.0400));
    d = smin(d, capsule(q, v(0.2580, -0.785, -0.012), v(0.2610, -0.832, -0.008), 0.0250), 0.012);
    for (z, len) in [(0.0285f32, 0.066f32), (0.0095, 0.078), (-0.0095, 0.072), (-0.0280, 0.057)] {
        let a = v(0.2640, -0.898, z);
        let mid = a + v(-0.002, -len * 0.55, 0.0);
        let tip = mid + v(-0.010, -len * 0.45, 0.002);
        d = smin(d, capsule2(q, a, mid, 0.0090, 0.0082), 0.006);
        d = smin(d, capsule2(q, mid, tip, 0.0082, 0.0070), 0.003);
    }
    d = smin(d, capsule2(q, v(0.2580, -0.840, 0.030), v(0.2540, -0.878, 0.052), 0.0125, 0.0100), 0.008);
    d = smin(d, capsule2(q, v(0.2540, -0.878, 0.052), v(0.2500, -0.910, 0.058), 0.0100, 0.0086), 0.003);
    d.max(p.y + 0.778)
}
pub fn hands(detail: f32) -> Part {
    let c = 0.0036 / detail.clamp(0.25, 2.0);
    let m = iso::surface_nets(&hands_sdf, &iso::uniform(-0.30, 0.30, c), &iso::uniform(-0.99, -0.77, c), &iso::uniform(-0.06, 0.08, c), 1.7);
    let f: &dyn Fn(Vec3) -> f32 = &hands_sdf;
    let mut p = Part::from_iso(m, |q, n| {
        let open = (f(q + n * 0.006) / 0.006).clamp(0.0, 1.0);
        let k = 1.0 - open;
        let c = srgb(224, 174, 144).lerp(srgb(210, 140, 120), 0.25 + 0.2 * (90.0 * q.y).sin());
        c * v(1.0 - 0.40 * k, 1.0 - 0.55 * k, 1.0 - 0.60 * k)
    });
    skin_part(&mut p);
    p
}

/// capsules for props physics: (node index, a, b in MODEL space at bind, radius)
pub const COLLIDERS: [(usize, [f32; 3], [f32; 3], f32); 13] = [
    (node::HEAD, [0.0, 0.030, -0.010], [0.0, -0.050, 0.020], 0.092),
    (node::NECK, [0.0, -0.100, -0.026], [0.0, -0.200, -0.036], 0.060),
    (node::CHEST, [-0.090, -0.330, -0.035], [0.090, -0.330, -0.035], 0.125),
    (node::SPINE1, [0.0, -0.480, -0.030], [0.0, -0.660, -0.030], 0.135),
    (node::PELVIS, [-0.060, -0.770, -0.030], [0.060, -0.770, -0.030], 0.115),
    (node::UPPERARM_L, [-0.184, -0.272, -0.038], [-0.234, -0.560, -0.035], 0.058),
    (node::UPPERARM_R, [0.184, -0.272, -0.038], [0.234, -0.560, -0.035], 0.058),
    (node::FOREARM_L, [-0.234, -0.560, -0.035], [-0.262, -0.930, -0.004], 0.046),
    (node::FOREARM_R, [0.234, -0.560, -0.035], [0.262, -0.930, -0.004], 0.046),
    (node::THIGH_L, [-0.092, -0.800, -0.030], [-0.100, -1.170, -0.022], 0.085),
    (node::THIGH_R, [0.092, -0.800, -0.030], [0.100, -1.170, -0.022], 0.085),
    (node::SHIN_L, [-0.100, -1.170, -0.022], [-0.100, -1.600, 0.010], 0.058),
    (node::SHIN_R, [0.100, -1.170, -0.022], [0.100, -1.600, 0.010], 0.058),
];
