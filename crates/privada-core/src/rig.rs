//! The character's per-frame logic (port of `ToiletTuber.update` in
//! web/src/rig/ToiletTuber.js). The renderer builds the meshes and only APPLIES the pose.
//!
//! Inputs: look (-1..1), mouth vector {open, round, wide, closed, sib}, one-shot actions.
//! Outputs (see [`NODE_ORDER`], [`Rig::pose`], [`Rig::scalars`], FX buffers):
//! local TRS per animated node, lid morph weights, accessory state, water/paper FX buffers
//! and sound events.
use crate::actions::{Action, Fx, Kind, Overrides};
use crate::dim::*;
use crate::paper::PaperStrip;
use crate::util::{clamp, Rng, Spring};
use crate::water::WaterJet;
use glam::{Mat4, Quat, Vec3};

/// Default look range: 80° yaw, 35° pitch (body + head together).
pub const DEFAULT_MAX_YAW: f32 = 80.0 * std::f32::consts::PI / 180.0;
pub const DEFAULT_MAX_PITCH: f32 = 35.0 * std::f32::consts::PI / 180.0;
/// share of the yaw / pitch done by the body (the head does the rest)
pub const BODY_YAW_SHARE: f32 = 0.55;
pub const BODY_PITCH_SHARE: f32 = 0.3;

/// Animated nodes, in pose-buffer order. Each entry is 10 floats of LOCAL transform:
/// `[px, py, pz, qx, qy, qz, qw, sx, sy, sz]`. The seat (lower lip) bones were appended at
/// the end so the older indices stay valid.
pub const NODE_ORDER: [&str; 26] = [
    "body", "head", "lid_pivot", "lid_bone_1", "lid_bone_2", "lid_bone_3", "lid_bone_4",
    "lid_bone_5", "lid_bone_6", "lid_bone_7", "seat_pivot", "eye_L", "eye_R", "pupil_L",
    "pupil_R", "flush_handle", "paper_roll", "water", "water_swirl", "seat_bone_1",
    "seat_bone_2", "seat_bone_3", "seat_bone_4", "seat_bone_5", "seat_bone_6", "seat_bone_7",
];
pub const POSE_STRIDE: usize = 10;

/// Scalars buffer layout (see [`Rig::scalars`]).
pub mod sc {
    pub const HINGE: usize = 0;
    /// accessory state `st.mouth` (lid opening 0..1.4)
    pub const ST_MOUTH: usize = 1;
    pub const ST_TALK: usize = 2;
    pub const HEAD_YAW_VEL: usize = 3;
    pub const HEAD_PITCH_VEL: usize = 4;
    pub const ST_LIFT: usize = 5;
    pub const TIME: usize = 6;
    pub const SWIRL_OPACITY: usize = 7;
    pub const SWIRL_ROT: usize = 8;
    pub const WATER_TEX_OFFSET: usize = 9;
    pub const DT: usize = 10;
    pub const STREAM_VISIBLE: usize = 11;
    pub const PAPER_COUNT: usize = 12;
    pub const PAPER_PERF: usize = 13;
    pub const PAPER_OPACITY: usize = 14;
    pub const TORN_COUNT: usize = 15;
    pub const TORN_PERF: usize = 16;
    pub const TORN_OPACITY: usize = 17;
    pub const PUDDLE_VERSION: usize = 18;
    pub const BOWL_RISE: usize = 19;
    pub const LEN: usize = 20;
}

/// Mouth input vector. The first five channels are 0..1 (see web/src/input/visemes.js);
/// the extended ones are optional (default 0): corners -1 (down) .. 1 (up), L = the -x side
/// (like eye_L); jaw_side -1..1 (also purses the lips to that side), jaw_fwd 0..1,
/// upper_raise 0..1 (upper lip / lid front lifts).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Mouth {
    pub open: f32,
    pub round: f32,
    pub wide: f32,
    pub closed: f32,
    pub sib: f32,
    pub corner_l: f32,
    pub corner_r: f32,
    pub jaw_side: f32,
    pub jaw_fwd: f32,
    pub upper_raise: f32,
}

/// channel order of [`Mouth::from_channels`] / [`STANDARD_VISEMES`]
pub const MOUTH_CHANNELS: [&str; 10] = ["open", "round", "wide", "closed", "sib", "cornerL", "cornerR", "jawSide", "jawFwd", "upperRaise"];

impl Mouth {
    pub fn from_channels(c: [f32; 10]) -> Mouth {
        Mouth { open: c[0], round: c[1], wide: c[2], closed: c[3], sib: c[4], corner_l: c[5], corner_r: c[6], jaw_side: c[7], jaw_fwd: c[8], upper_raise: c[9] }
    }
    pub fn channels(&self) -> [f32; 10] {
        [self.open, self.round, self.wide, self.closed, self.sib, self.corner_l, self.corner_r, self.jaw_side, self.jaw_fwd, self.upper_raise]
    }
    /// every channel clamped to its range
    pub fn clamped(&self) -> Mouth {
        let u = |v: f32| clamp(v, 0.0, 1.0);
        let sg = |v: f32| clamp(v, -1.0, 1.0);
        Mouth {
            open: u(self.open), round: u(self.round), wide: u(self.wide), closed: u(self.closed), sib: u(self.sib),
            corner_l: sg(self.corner_l), corner_r: sg(self.corner_r), jaw_side: sg(self.jaw_side), jaw_fwd: u(self.jaw_fwd), upper_raise: u(self.upper_raise),
        }
    }
}

/// The 15 standard vtuber visemes (+ rest) as channel values [`MOUTH_CHANNELS`].
/// Mirror of `STANDARD_VISEMES` in web/src/input/visemes.js.
pub const STANDARD_VISEMES: [(&str, [f32; 10]); 17] = [
    ("rest", [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
    ("AA", [1.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
    ("AH", [0.75, 0.0, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1]),
    ("AO", [0.8, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0]),
    ("AW_OW", [0.6, 0.85, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.2, 0.0]),
    ("CH_J_SH", [0.25, 0.5, 0.0, 0.0, 0.8, 0.0, 0.0, 0.0, 0.4, 0.3]),
    ("EH_AE", [0.55, 0.0, 0.7, 0.0, 0.0, 0.1, 0.1, 0.0, 0.0, 0.1]),
    ("EY", [0.45, 0.0, 0.85, 0.0, 0.0, 0.15, 0.15, 0.0, 0.0, 0.0]),
    ("FV", [0.08, 0.0, 0.3, 0.6, 0.0, 0.0, 0.0, 0.0, 0.0, 0.4]),
    ("IH_AY", [0.35, 0.0, 0.8, 0.0, 0.0, 0.1, 0.1, 0.0, 0.0, 0.0]),
    ("L", [0.4, 0.0, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.15]),
    ("M_P_B", [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
    ("N_NG_DH", [0.25, 0.0, 0.35, 0.0, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0]),
    ("OY_UH_UW", [0.3, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.3, 0.0]),
    ("R_ER", [0.3, 0.55, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0]),
    ("W", [0.15, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.4, 0.0]),
    ("Y_IY", [0.25, 0.0, 1.0, 0.0, 0.0, 0.2, 0.2, 0.0, 0.0, 0.0]),
];

/// mouth vector of a standard viseme (`AA`, `M_P_B`, ...)
pub fn viseme(name: &str) -> Option<Mouth> {
    STANDARD_VISEMES.iter().find(|(n, _)| *n == name).map(|(_, c)| Mouth::from_channels(*c))
}

/// Blend shapes, in MORPHS-buffer order: the lid (upper lip) first, then the seat (lower lip).
/// L = the -x side (like eye_L).
pub const LID_MORPHS: usize = 9;
pub const SEAT_MORPHS: usize = 7;
pub const MORPHS: usize = LID_MORPHS + SEAT_MORPHS;
pub const MORPH_NAMES: [&str; MORPHS] = [
    "smile", "pucker", "arch", "corner_L_up", "corner_L_down", "corner_R_up", "corner_R_down", "pucker_L", "pucker_R",
    "seat_corner_L_up", "seat_corner_L_down", "seat_corner_R_up", "seat_corner_R_down", "seat_pucker_L", "seat_pucker", "seat_pucker_R",
];

/// lips pursed toward `side` (-1 = L / -x, 1 = R / +x): push up/out around u = 0.4 side,
/// the front centre shifts that way
fn side_pucker(u: f32, v: f32, side: f32, amp: [f32; 4]) -> Vec3 {
    let c = 0.4 * side;
    let w = (1.0 - ((u - c) / 0.7).powi(2)).max(0.0);
    let v2 = v * v;
    Vec3::new(amp[0] * side * (1.0 - u * u) * v2 - amp[1] * (u - c) * w * v2, amp[2] * w * v2, amp[3] * w * v2)
}

/// Lid blend shape `k` (0..LID_MORPHS) at a rest point of the lid mesh (lid-pivot space:
/// x, z measured from the hinge), as a position delta. ToiletTuber.js builds the morph targets
/// from the same formulas (`lidMorph`).
pub fn lid_morph(k: usize, x: f32, z: f32) -> Vec3 {
    let u = clamp(x / LID_RX, -1.0, 1.0);
    let v = clamp(z / (2.0 * LID_RZ), 0.0, 1.0);
    let (ul, ur) = ((-u).max(0.0), u.max(0.0));
    let fv = v.powf(1.5);
    let mid = 1.0 - u * u;
    match k {
        // smile: corners lift, centre tenses (E, I)
        0 => Vec3::new(0.0, 0.05 * u * u * fv - 0.012 * mid * v, 0.0),
        // pucker: centre front pushes up/out, corners pull in (O, U)
        1 => Vec3::new(-0.05 * u * v * v, 0.035 * mid * v * v, 0.03 * mid * v * v),
        // arch: the upper-lip curve seen from the front - corners fold down, middle stays up
        2 => {
            let vv = v.powf(1.6);
            Vec3::new(-0.025 * u * u.abs() * vv, -0.11 * u.abs().powf(2.2) * vv + 0.02 * mid * vv, 0.0)
        }
        3 => Vec3::new(0.0, 0.045 * ul.powf(2.2) * fv, 0.0),
        4 => Vec3::new(-0.012 * ul * ul * fv, -0.06 * ul.powf(2.2) * fv, 0.0),
        5 => Vec3::new(0.0, 0.045 * ur.powf(2.2) * fv, 0.0),
        6 => Vec3::new(0.012 * ur * ur * fv, -0.06 * ur.powf(2.2) * fv, 0.0),
        7 => side_pucker(u, v, -1.0, [0.035, 0.03, 0.032, 0.026]),
        8 => side_pucker(u, v, 1.0, [0.035, 0.03, 0.032, 0.026]),
        _ => Vec3::ZERO,
    }
}

/// Seat blend shape `k` (0..SEAT_MORPHS) at a rest point of the seat mesh (seat-pivot space).
/// The seat lies on the rim, so no seat shape ever moves down (dy >= 0).
pub fn seat_morph(k: usize, x: f32, z: f32) -> Vec3 {
    let u = clamp(x / SEAT_RX, -1.0, 1.0);
    let v = clamp((z - SEAT_ZC + SEAT_RZ) / (2.0 * SEAT_RZ), 0.0, 1.0);
    let (ul, ur) = ((-u).max(0.0), u.max(0.0));
    let fv = v.powf(1.5);
    let (mid, v2) = (1.0 - u * u, v * v);
    match k {
        // corner up: the lower-lip corner rises (smile)
        0 => Vec3::new(0.0, 0.03 * ul * ul * fv, 0.0),
        // corner down (frown): the lower lip pouts up next to that corner, the corner stays
        1 => Vec3::new(0.0, 0.018 * mid * (1.0 - 0.5 * u) * v2, 0.008 * mid * v2),
        2 => Vec3::new(0.0, 0.03 * ur * ur * fv, 0.0),
        3 => Vec3::new(0.0, 0.018 * mid * (1.0 + 0.5 * u) * v2, 0.008 * mid * v2),
        4 => side_pucker(u, v, -1.0, [0.03, 0.025, 0.018, 0.022]),
        5 => Vec3::new(-0.03 * u * v2, 0.02 * mid * v2, 0.025 * mid * v2),
        6 => side_pucker(u, v, 1.0, [0.03, 0.025, 0.018, 0.022]),
        _ => Vec3::ZERO,
    }
}

#[derive(Clone)]
struct Springs {
    yaw: Spring,
    pitch: Spring,
    h_yaw: Spring,
    h_pitch: Spring,
    h_roll: Spring,
    lid: Spring,
    seat: Spring,
    px: Spring,
    py: Spring,
    lift: Spring,
    squash: Spring,
    eye_scale: Spring,
    handle: Spring,
    smile: Spring,
    pucker: Spring,
    arch: Spring,
    lean: Spring,
    /// lower lip drop (0..1): slides the seat front out over the bowl and curls it down
    drop: Spring,
    corner_l: Spring,
    corner_r: Spring,
    jaw_side: Spring,
    jaw_fwd: Spring,
    upper_raise: Spring,
}

impl Springs {
    fn new() -> Self {
        Self {
            yaw: Spring::new(60.0, 11.0),
            pitch: Spring::new(60.0, 11.0),
            h_yaw: Spring::new(110.0, 9.0),
            h_pitch: Spring::new(110.0, 9.0),
            h_roll: Spring::new(90.0, 7.0),
            lid: Spring::new(260.0, 15.0),
            seat: Spring::new(180.0, 10.0),
            px: Spring::new(320.0, 9.0),
            py: Spring::new(320.0, 9.0),
            lift: Spring::new(200.0, 18.0),
            squash: Spring::new(260.0, 10.0),
            // three.js Spring(200,12) starts at x=0; eyes scale 0->1 at boot like the JS rig
            eye_scale: Spring::new(200.0, 12.0),
            handle: Spring::new(400.0, 20.0),
            smile: Spring::new(220.0, 18.0),
            pucker: Spring::new(220.0, 18.0),
            arch: Spring::new(200.0, 14.0),
            lean: Spring::new(60.0, 11.0),
            drop: Spring::new(200.0, 16.0),
            corner_l: Spring::new(220.0, 18.0),
            corner_r: Spring::new(220.0, 18.0),
            jaw_side: Spring::new(160.0, 16.0),
            jaw_fwd: Spring::new(160.0, 16.0),
            upper_raise: Spring::new(220.0, 18.0),
        }
    }
    /// same order as `for (const k in S)` in the JS rig
    fn step_all(&mut self, h: f32) {
        for s in [
            &mut self.yaw, &mut self.pitch, &mut self.h_yaw, &mut self.h_pitch, &mut self.h_roll,
            &mut self.lid, &mut self.seat, &mut self.px, &mut self.py, &mut self.lift,
            &mut self.squash, &mut self.eye_scale, &mut self.handle, &mut self.smile,
            &mut self.pucker, &mut self.arch, &mut self.lean, &mut self.drop, &mut self.corner_l,
            &mut self.corner_r, &mut self.jaw_side, &mut self.jaw_fwd, &mut self.upper_raise,
        ] {
            s.step(h);
        }
    }
}

#[derive(Clone, Copy)]
struct Trs {
    p: Vec3,
    q: Quat,
    s: Vec3,
}

impl Trs {
    const ID: Trs = Trs { p: Vec3::ZERO, q: Quat::IDENTITY, s: Vec3::ONE };
    fn at(p: Vec3) -> Trs {
        Trs { p, ..Trs::ID }
    }
    fn mat(&self) -> Mat4 {
        Mat4::from_scale_rotation_translation(self.s, self.q, self.p)
    }
}

/// three.js Euler 'XYZ' -> quaternion (qx * qy * qz)
fn euler_xyz(x: f32, y: f32, z: f32) -> Quat {
    Quat::from_rotation_x(x) * Quat::from_rotation_y(y) * Quat::from_rotation_z(z)
}

/// geo.js `eggPoint`: egg outline point (x, z) at angle `th`
fn egg_point(th: f32, rx: f32, rz: f32, k: f32) -> (f32, f32) {
    let s = th.sin();
    (rx * th.cos() * (1.0 - k * s), rz * s)
}

/// Radius of a body-space point in bowl-lathe units (undo eggify + the z scale).
pub fn bowl_r(x: f32, z: f32) -> f32 {
    let r = x.hypot(z);
    let x0 = if r > 1e-5 { x / (1.0 - EGG * z / r) } else { x };
    x0.hypot(z / BOWL_SCALE_Z)
}

/// Seat bone matrices in seat-pivot space (the seat SkinnedMesh is identity under seat_pivot):
/// bone 0 at z = SEAT_Z0, bone i = SEAT_SEG (+ slide) ahead of bone i-1, rotated by angle * gain
/// about X (positive = front down).
fn seat_chain(ang: &[f32; SEAT_BONES], slide: &[f32; SEAT_BONES], gain: f32) -> [Mat4; SEAT_BONES] {
    let mut m = Mat4::IDENTITY;
    let mut out = [Mat4::IDENTITY; SEAT_BONES];
    for i in 0..SEAT_BONES {
        let z = if i == 0 { SEAT_Z0 } else { SEAT_SEG + slide[i] };
        m = m * Mat4::from_translation(Vec3::new(0.0, 0.0, z)) * Mat4::from_rotation_x(ang[i] * gain);
        out[i] = m;
    }
    out
}

/// Linear-blend skinning of a rest-pose point along a bone chain bound at z0 + i*seg with
/// the same weights as the meshes (ToiletTuber.js: 2 bones per vertex, linear in z).
fn skin(chain: &[Mat4], z0: f32, seg: f32, v: Vec3) -> Vec3 {
    let n = chain.len();
    let f = clamp(v.z - z0, 0.0, seg * (n - 1) as f32 - 1e-4) / seg;
    let b = (f.floor() as usize).min(n - 2);
    let t = f - b as f32;
    let at = |i: usize| chain[i].transform_point3(v - Vec3::new(0.0, 0.0, z0 + i as f32 * seg));
    at(b) * (1.0 - t) + at(b + 1) * t
}

/// Seat underside points (seat-pivot space) over the front half of the ring, for the rim clamp.
/// y = the lowest underside height (conservative).
fn seat_under_samples() -> Vec<Vec3> {
    let mut v = Vec::with_capacity(99);
    for j in 0..11 {
        let th = 0.2 + j as f32 * (std::f32::consts::PI - 0.4) / 10.0;
        let (ex, ez) = egg_point(th, SEAT_RX, SEAT_RZ, EGG);
        for s in SEAT_UNDER_S {
            v.push(Vec3::new(ex * s, SEAT_Y0, ez * s + SEAT_ZC));
        }
    }
    v
}
/// ring radius factors of the underside samples (dense at the front edge, which curls down)
const SEAT_UNDER_S: [f32; 9] = [SEAT_HOLE, 0.715, 0.81, 0.86, 0.9, 0.93, 0.955, 0.978, 1.0];
/// the clamp keeps this extra radial margin from the rim (covers the gaps between samples)
const SEAT_RIM_MARGIN: f32 = 0.004;
/// seat top samples (rest x, centred z) over the front ring, for the lid-above-seat floor
static SEAT_TOP_XZ: std::sync::LazyLock<Vec<(f32, f32)>> = std::sync::LazyLock::new(|| {
    let mut v = Vec::with_capacity(15);
    for d in [-0.7f32, -0.35, 0.0, 0.35, 0.7] {
        let (ex, ez) = egg_point(std::f32::consts::FRAC_PI_2 + d, SEAT_RX, SEAT_RZ, EGG);
        for s in [0.7f32, 0.85, 1.0] {
            v.push((ex * s, ez * s));
        }
    }
    v
});

/// lid top height used by the paper collision (closed lid), and the margin paper keeps
pub const PAPER_TOP: f32 = 0.735;
const PAPER_MARGIN: f32 = 0.012;
/// outer bowl radius (lathe units) by height: the outside of the bowl profile
const BOWL_OUTER: [(f32, f32); 11] = [
    (0.0, 0.30), (0.012, 0.312), (0.035, 0.3), (0.1, 0.25), (0.2, 0.225), (0.3, 0.24),
    (0.39, 0.3), (0.47, 0.36), (0.55, 0.395), (0.6, 0.41), (0.622, 0.412),
];
fn bowl_outer_r(y: f32) -> f32 {
    if y >= 0.622 {
        return 0.415;
    }
    for w in BOWL_OUTER.windows(2) {
        let ((y0, r0), (y1, r1)) = (w[0], w[1]);
        if y <= y1 {
            return r0 + (r1 - r0) * clamp((y - y0) / (y1 - y0), 0.0, 1.0);
        }
    }
    0.415
}
/// body-space point inside the bowl / closed-lid volume -> pushed out (up onto the lid, or
/// radially out of the bowl wall, whichever is shorter)
pub fn push_out_of_bowl(b: Vec3) -> Option<Vec3> {
    if b.y < 0.0 || b.y > PAPER_TOP + PAPER_MARGIN {
        return None;
    }
    let r = bowl_r(b.x, b.z);
    let rw = bowl_outer_r(b.y) + PAPER_MARGIN;
    if r >= rw {
        return None;
    }
    let up = PAPER_TOP + PAPER_MARGIN - b.y;
    if up <= (rw - r) * BOWL_SCALE_Z || r < 1e-4 {
        Some(Vec3::new(b.x, PAPER_TOP + PAPER_MARGIN, b.z))
    } else {
        let k = rw / r;
        Some(Vec3::new(b.x * k, b.y, b.z * k))
    }
}
/// Paper rests on the lid / drapes over the bowl instead of passing through it.
fn collide_paper(strip: &mut PaperStrip, bm: Mat4, inv: Mat4) {
    let start = usize::from(strip.anchored);
    for o in strip.pts.iter_mut().skip(start) {
        if let Some(nb) = push_out_of_bowl(inv.transform_point3(o.p)) {
            let np = bm.transform_point3(nb);
            let d = np - o.p;
            o.p = np;
            o.q = (o.q + d) * 0.45 + np * 0.55; // friction
        }
    }
}

pub struct Rig {
    s: Springs,
    lip: Vec<Spring>,
    /// lower lip (seat) bone springs, bones 1..7 (front-down angle)
    seat_lip: Vec<Spring>,
    /// theme.body: tank / eyes / roll / handle positions
    dims: BodyDims,
    /// seat bone angles / slides of this frame (before the rim clamp) and the clamp factor
    seat_ang: [f32; SEAT_BONES],
    seat_slide: [f32; SEAT_BONES],
    seat_gain: f32,
    /// lowest lid hinge that keeps the lid above the (curled) seat
    seat_floor: f32,
    /// seat underside sample points (seat-pivot space) for the rim clamp
    seat_under: Vec<Vec3>,
    time: f32,
    active: Vec<Action>,
    mouth: Mouth,
    talk_amt: f32,
    pub rest_open: f32,
    /// total look range (body + head), radians; see [`Rig::set_look_limits`]
    max_yaw: f32,
    max_pitch: f32,
    blink_timer: f32,
    blink_t: f32,
    swirl_speed: f32,
    swirl_rot: f32,
    water_tex_offset: f32,
    roll_rot: f32,
    lid_touching: bool,
    hinge: f32,
    /// head euler (x, y, z) of this frame, before the head-vs-lid guard
    head_e: (f32, f32, f32),
    rng: Rng,
    // nodes (local transforms)
    body: Trs,
    head: Trs,
    lid_pivot: Trs,
    bones: [Trs; LID_BONES],
    seat_pivot: Trs,
    seat_bones: [Trs; SEAT_BONES],
    eyes: [Trs; 2],
    pupils: [Trs; 2],
    handle: Trs,
    roll: Trs,
    water: Trs,
    swirl: Trs,
    // fx
    pub jet: WaterJet,
    pub paper: PaperStrip,
    pub torn: PaperStrip,
    paper_out_dir: Vec3,
    events: Vec<String>,
    // outputs
    pose: Vec<f32>,
    scalars: [f32; sc::LEN],
    morphs: [f32; MORPHS],
    /// jaw (lid + seat assembly) yaw and forward shift of this frame
    jaw_yaw: f32,
    jaw_fwd: f32,
}

impl Default for Rig {
    fn default() -> Self {
        Self::new(1)
    }
}

impl Rig {
    pub fn new(seed: u64) -> Self {
        let mut rng = Rng::new(seed);
        let blink_timer = 2.0 + rng.next() * 3.0;
        let pupil_q = Quat::from_rotation_x(std::f32::consts::FRAC_PI_2);
        let mut bones = [Trs::ID; LID_BONES];
        for (i, b) in bones.iter_mut().enumerate() {
            b.p.z = if i == 0 { LID_Z0 } else { LID_SEG };
        }
        let mut seat_bones = [Trs::ID; SEAT_BONES];
        for (i, b) in seat_bones.iter_mut().enumerate() {
            b.p.z = if i == 0 { SEAT_Z0 } else { SEAT_SEG };
        }
        let roll_w = ROLL_LEN * 0.96;
        let dims = BodyDims::default();
        let mut r = Self {
            s: Springs::new(),
            lip: (0..LID_BONES - 1).map(|i| Spring::new(300.0 - i as f32 * 28.0, 8.0 + i as f32 * 0.8)).collect(),
            seat_lip: (0..SEAT_BONES - 1).map(|i| Spring::new(260.0 - i as f32 * 18.0, 13.0 + i as f32 * 0.5)).collect(),
            dims,
            seat_ang: [0.0; SEAT_BONES],
            seat_slide: [0.0; SEAT_BONES],
            seat_gain: 1.0,
            seat_floor: 0.0,
            seat_under: seat_under_samples(),
            time: 0.0,
            active: Vec::new(),
            mouth: Mouth::default(),
            talk_amt: 0.0,
            rest_open: MOUTH_REST,
            max_yaw: DEFAULT_MAX_YAW,
            max_pitch: DEFAULT_MAX_PITCH,
            blink_timer,
            blink_t: -1.0,
            swirl_speed: 0.0,
            swirl_rot: 0.0,
            water_tex_offset: 0.0,
            roll_rot: 0.0,
            lid_touching: false,
            hinge: 0.0,
            head_e: (0.0, 0.0, 0.0),
            rng,
            body: Trs::ID,
            head: Trs::at(Vec3::new(0.0, HEAD_Y, PIPE_Z)),
            lid_pivot: Trs::at(Vec3::from(LID_PIVOT)),
            bones,
            seat_pivot: Trs::at(Vec3::new(0.0, RIM_Y, HINGE_Z)),
            seat_bones,
            eyes: [Trs::ID; 2],
            pupils: [Trs { p: Vec3::new(0.0, 0.0, 0.03), q: pupil_q, s: Vec3::ONE }; 2],
            handle: Trs::ID,
            roll: Trs::ID,
            water: Trs::at(Vec3::new(0.0, WATER_Y, 0.0)),
            swirl: Trs::at(Vec3::new(0.0, WATER_Y + 0.002, 0.0)),
            jet: WaterJet::new(seed ^ 0xA5A5),
            paper: PaperStrip::new(roll_w),
            torn: PaperStrip::new(roll_w),
            paper_out_dir: Vec3::NEG_X,
            events: Vec::new(),
            pose: vec![0.0; NODE_ORDER.len() * POSE_STRIDE],
            scalars: [0.0; sc::LEN],
            morphs: [0.0; MORPHS],
            jaw_yaw: 0.0,
            jaw_fwd: 0.0,
        };
        r.torn.anchored = false;
        r.torn.fade = 0.0;
        r.jet.level_offset = 0.0;
        r.place_body_nodes();
        r.update_paper_anchor();
        let a = r.paper.anchor;
        r.paper.reset(a);
        r.write_pose();
        r
    }

    /* ------------------------------------------------------ public API */
    pub fn play(&mut self, name: &str) -> bool {
        let Some(kind) = Kind::parse(name) else { return false };
        self.active.retain(|a| a.kind != kind);
        let mut a = Action::new(kind);
        let out = self.paper_out_dir;
        let mut fx = Fx { jet: &mut self.jet, paper: &mut self.paper, torn: &mut self.torn, paper_out_dir: out, events: &mut self.events };
        a.start(&mut fx);
        self.active.push(a);
        true
    }
    pub fn is_playing(&self) -> bool {
        !self.active.is_empty()
    }
    pub fn pending_events(&self) -> usize {
        self.events.len()
    }
    pub fn drain_events(&mut self) -> Vec<String> {
        std::mem::take(&mut self.events)
    }
    pub fn pose(&self) -> &[f32] {
        &self.pose
    }
    pub fn scalars(&self) -> &[f32; sc::LEN] {
        &self.scalars
    }
    /// blend-shape weights, see [`MORPH_NAMES`] (lid first, then the seat)
    pub fn morphs(&self) -> [f32; MORPHS] {
        self.morphs
    }
    pub fn hinge(&self) -> f32 {
        self.hinge
    }
    /// Total look range in radians (body + head). Body takes ~55% of the yaw and ~30% of
    /// the pitch, the head the rest; the pupils lead and saturate first.
    pub fn set_look_limits(&mut self, max_yaw: f32, max_pitch: f32) {
        self.max_yaw = max_yaw.clamp(0.0, 1.6);
        self.max_pitch = max_pitch.clamp(0.0, 0.9);
    }
    pub fn look_limits(&self) -> (f32, f32) {
        (self.max_yaw, self.max_pitch)
    }
    /// theme.body (tank scale + eyes): moves eyes, handle, paper roll and the lid-vs-tank
    /// collision box. The meshes are rebuilt by the renderer (ToiletTuber.build).
    pub fn set_body_dims(&mut self, d: BodyDims) {
        self.dims = d;
        self.place_body_nodes();
        self.update_paper_anchor();
        if self.paper.pts.len() <= 1 {
            let a = self.paper.anchor;
            self.paper.reset(a);
        }
        self.write_pose();
    }
    pub fn body_dims(&self) -> BodyDims {
        self.dims
    }
    /// World (rig root) matrix of the `lip_upper` socket: child of lid_bone_7 at the lid's
    /// front point (lid underside), +z out of the mouth, +y up. Column-major.
    pub fn lip_upper_matrix(&self) -> Mat4 {
        let mut m = self.body_m() * self.lid_pivot.mat();
        for b in &self.bones {
            m *= b.mat();
        }
        m * Mat4::from_translation(Vec3::from(LIP_UPPER))
    }
    /// Lower lip state: (drop below rest of the front centre underside in m (>0 = lower),
    /// forward slide of the front edge in m), in body space.
    pub fn seat_front(&self) -> (f32, f32) {
        let chain = seat_chain(&self.seat_ang, &self.seat_slide, self.seat_gain);
        let v = self.seat_morphed(Vec3::new(0.0, SEAT_Y0, SEAT_ZC + SEAT_RZ));
        let p = self.seat_pivot.mat().transform_point3(skin(&chain, SEAT_Z0, SEAT_SEG, v));
        (RIM_Y + SEAT_Y0 - p.y, p.z - (HINGE_Z + SEAT_ZC + SEAT_RZ))
    }

    /* ----------------------------------------------- transform helpers */
    fn body_m(&self) -> Mat4 {
        self.body.mat()
    }
    fn head_m(&self) -> Mat4 {
        self.body_m() * self.head.mat()
    }

    /// eyes / handle / roll rest positions from the body dims (head space)
    fn place_body_nodes(&mut self) {
        let d = self.dims;
        let ez = d.front() + 0.004;
        self.eyes[0].p = Vec3::new(-d.eye_x, d.eye_y, ez);
        self.eyes[1].p = Vec3::new(d.eye_x, d.eye_y, ez);
        self.handle.p = Vec3::from(d.handle);
        self.head.p.y = d.head_y;
        // paper_holder sits on the tank face at (roll x, roll y, front); the roll in front of it
        self.roll.p = Vec3::new(0.0, 0.0, d.roll[2] - d.front());
    }

    /// The roll faces the camera (axis along X, in front of the tank face): the paper leaves
    /// from the roll's front, falls down toward the viewer and the paper action blows it forward.
    fn update_paper_anchor(&mut self) {
        let hm = self.head_m();
        let (_, hq, _) = hm.to_scale_rotation_translation();
        let roll_world = hm.transform_point3(Vec3::from(self.dims.roll));
        let fwd = hq * Vec3::Z;
        let rs = self.paper.roll_radius_scale;
        self.roll.s = Vec3::new(1.0, rs, rs);
        self.paper.anchor = roll_world + fwd * ROLL_R * rs;
        self.paper.width_dir = hq * Vec3::X;
        self.paper.emit_dir = hq * Vec3::NEG_Y;
        self.paper_out_dir = fwd;
    }

    /// lid bone world matrices for a given hinge (current bone rotations)
    /// lid pivot rotation: jaw yaw, then the hinge about the (yawed) hinge axis
    fn lid_q(&self, hinge: f32) -> Quat {
        Quat::from_rotation_y(self.jaw_yaw) * Quat::from_rotation_x(-hinge)
    }

    fn bone_worlds(&self, hinge: f32) -> [Mat4; LID_BONES] {
        let mut piv = self.lid_pivot;
        piv.q = self.lid_q(hinge);
        let mut m = self.body_m() * piv.mat(); // lid mesh is identity under the pivot
        let mut out = [Mat4::IDENTITY; LID_BONES];
        for (i, b) in self.bones.iter().enumerate() {
            m *= b.mat();
            out[i] = m;
        }
        out
    }

    fn lid_hits_head(&self, hinge: f32) -> bool {
        let bw = self.bone_worlds(hinge);
        let head_inv = self.head_m().inverse();
        let mm = 0.035;
        let d = &self.dims;
        let (tank_y, tank_h, tank_z, tank_d, tank_w) = (d.tank_y, d.tank_h, d.tank_z, d.tank_d, d.tank_w);
        let front = d.front() + 0.07; // eyes/handle stick out in front
        // the paper roll + holder in front of the tank face
        let [rx, ry, rz] = d.roll;
        let (rlo, rhi) = (Vec3::new(rx - ROLL_LEN / 2.0 - 0.05, ry - ROLL_R - 0.03, d.front() - 0.01), Vec3::new(rx + ROLL_LEN / 2.0 + 0.05, ry + ROLL_R + 0.03, rz + ROLL_R + 0.03));
        let n = LID_BONES;
        for i in 1..=n {
            let b = bw[i.min(n - 1)];
            for f in [0.0f32, 0.5, 1.0] {
                if i == n && f > 0.0 {
                    break;
                }
                let local = Vec3::new(0.0, LID_DEPTH + LID_DOME + 0.01, if i == n { 0.0 } else { -LID_SEG * (1.0 - f) });
                let p = head_inv.transform_point3(b.transform_point3(local));
                if p.y > tank_y - tank_h / 2.0 - mm
                    && p.y < tank_y + tank_h / 2.0 + 0.1
                    && p.z > tank_z - tank_d / 2.0 - mm
                    && p.z < front
                    && p.x.abs() < tank_w / 2.0 + mm
                {
                    return true;
                }
                if p.cmpgt(rlo).all() && p.cmplt(rhi).all() {
                    return true;
                }
            }
        }
        // never fold back through the neck pipe
        let p = self.body_m().inverse().transform_point3(bw[1].transform_point3(Vec3::new(0.0, 0.0, LID_SEG)));
        p.z < PIPE_Z + 0.06
    }

    /// true if the (deformed) seat underside enters the bowl rim or drops more than
    /// SEAT_MAX_DROP below rest, with the seat bone angles scaled by `gain`
    /// seat rest point + this frame's seat blend shapes
    fn seat_morphed(&self, v: Vec3) -> Vec3 {
        let w = &self.morphs[LID_MORPHS..];
        (0..SEAT_MORPHS).filter(|&k| w[k] != 0.0).fold(v, |a, k| a + seat_morph(k, v.x, v.z) * w[k])
    }
    /// lid rest point + this frame's lid blend shapes
    fn lid_morphed(&self, v: Vec3) -> Vec3 {
        let w = &self.morphs[..LID_MORPHS];
        (0..LID_MORPHS).filter(|&k| w[k] != 0.0).fold(v, |a, k| a + lid_morph(k, v.x, v.z) * w[k])
    }

    fn seat_hits_bowl(&self, gain: f32) -> bool {
        let chain = seat_chain(&self.seat_ang, &self.seat_slide, gain);
        let pm = self.seat_pivot.mat();
        let min_y = RIM_Y + SEAT_Y0 - SEAT_MAX_DROP;
        self.seat_under.iter().any(|v| {
            let p = pm.transform_point3(skin(&chain, SEAT_Z0, SEAT_SEG, self.seat_morphed(*v)));
            p.y < min_y || (p.y < RIM_TOP + 0.002 && bowl_r(p.x, p.z) < RIM_OUTER_R + SEAT_RIM_MARGIN)
        })
    }

    /// Seat = LOWER LIP: open vowels slide its front out over the bowl's front edge and curl
    /// it down (max SEAT_MAX_DROP), M/B/P/F press it up toward the lid; a clamp keeps it out
    /// of the bowl rim (binary search on the curl).
    fn apply_seat(&mut self, dt: f32) {
        let m = self.mouth;
        let drop = self.s.drop.x.max(0.0);
        let press = clamp(m.closed + 0.2 * m.sib, 0.0, 1.0);
        // the front slides out first (ease-out), so even a small drop clears the rim
        let slide = drop * (2.0 - drop.min(1.0));
        let n = self.seat_lip.len();
        for i in 0..n {
            let flap = if i >= 5 { (self.time * 14.0 - i as f32 * 0.9 + 2.0).sin() * 0.05 * self.talk_amt } else { 0.0 };
            let s = &mut self.seat_lip[i];
            s.target = SEAT_DROP_ANG[i] * drop + SEAT_PRESS_ANG[i] * press + flap;
            for _ in 0..3 {
                s.step(dt / 3.0);
            }
            self.seat_ang[i + 1] = s.x;
            self.seat_slide[i + 1] = SEAT_SLIDE[i] * slide;
        }
        let mut gain = 1.0;
        if self.seat_hits_bowl(1.0) {
            let (mut lo, mut hi) = (0.0f32, 1.0f32);
            for _ in 0..7 {
                let mid = (lo + hi) / 2.0;
                if self.seat_hits_bowl(mid) {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            gain = lo;
        }
        self.seat_gain = gain;
        for i in 1..SEAT_BONES {
            self.seat_bones[i].p.z = SEAT_SEG + self.seat_slide[i];
            self.seat_bones[i].q = Quat::from_rotation_x(self.seat_ang[i] * gain);
        }
    }

    /// Lowest lid hinge that keeps the lid underside above the seat top (both curled and
    /// morphed, jaw included): for seat-top points over the front ring, compare their angle
    /// around the lid hinge with the lid underside at the same rest x (and z +- 5 cm).
    fn seat_lid_floor(&self) -> f32 {
        let chain = seat_chain(&self.seat_ang, &self.seat_slide, self.seat_gain);
        let mut lid0 = self.lid_pivot;
        lid0.q = self.lid_q(0.0);
        let to_lid = lid0.mat().inverse() * self.seat_pivot.mat();
        let mut m = Mat4::IDENTITY;
        let mut lc = [Mat4::IDENTITY; LID_BONES];
        for (i, b) in self.bones.iter().enumerate() {
            m *= b.mat();
            lc[i] = m;
        }
        let mut floor = f32::MIN;
        for &(x, zc) in SEAT_TOP_XZ.iter() {
            let sv = self.seat_morphed(Vec3::new(x, SEAT_Y0 + SEAT_H, zc + SEAT_ZC));
            let ps = to_lid.transform_point3(skin(&chain, SEAT_Z0, SEAT_SEG, sv));
            let a_seat = ps.y.atan2(ps.z);
            let mut a_lid = f32::MAX;
            for dz in [-0.05f32, 0.0, 0.05] {
                let lv = self.lid_morphed(Vec3::new(x, 0.0, zc + LID_ZC + dz));
                let pl = skin(&lc, LID_Z0, LID_SEG, lv);
                a_lid = a_lid.min(pl.y.atan2(pl.z));
            }
            floor = floor.max(a_seat - a_lid);
        }
        floor + 0.004
    }

    fn apply_lid(&mut self, dt: f32, open: f32) {
        let n = self.lip.len();
        let m = self.mouth;
        for i in 0..n {
            let w = i as f32 / (n as f32 - 1.0);
            let lift = if i == 0 { 0.1 * m.open } else { 0.0 };
            let sag = -0.32 * w.powi(3) * m.open;
            let pout = 0.3 * w * w * m.round;
            let tense = -0.06 * w * (m.wide + m.sib);
            let flap = (self.time * 14.0 - i as f32 * 0.9).sin() * 0.04 * w * self.talk_amt;
            let s = &mut self.lip[i];
            // rest: the front droops a little (thick upper lip); upper_raise curls it up
            let shape = LID_REST_CURL * w * w + 0.3 * w * w * m.upper_raise;
            s.target = lift + sag + pout + tense + flap + shape + if open > 1.2 { -0.12 * w } else { 0.0 };
            for _ in 0..3 {
                s.step(dt / 3.0);
            }
            self.bones[i + 1].q = Quat::from_rotation_x(-s.x);
        }
        // never below the seat (lower lip): rigid seat lift + its curl
        let floor = self.seat_lid_floor().max(self.s.seat.x + 0.006).max(0.0);
        self.seat_floor = floor;
        let mut hinge = open.max(floor).min(LID_MAX_HINGE);
        if self.lid_hits_head(hinge) {
            let (mut lo, mut hi) = (floor.min(hinge), hinge);
            for _ in 0..7 {
                let mid = (lo + hi) / 2.0;
                if self.lid_hits_head(mid) {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            hinge = lo;
            if self.lid_hits_head(hinge) {
                // even (nearly) closed the lid touches: the head is tilted onto it
                // (extreme look down / sideways). Ease the head's forward pitch until clear.
                let (hx, hy, hz) = self.head_e;
                let (mut lo_f, mut hi_f) = (0.0f32, 1.0f32);
                for _ in 0..8 {
                    let f = (lo_f + hi_f) / 2.0;
                    self.head.q = euler_xyz(hx.min(0.0) + (hx - hx.min(0.0)) * f, hy, hz);
                    if self.lid_hits_head(hinge) { hi_f = f } else { lo_f = f }
                }
                self.head.q = euler_xyz(hx.min(0.0) + (hx - hx.min(0.0)) * lo_f, hy, hz);
            }
            if !self.lid_touching && self.s.lid.v > 2.0 {
                self.events.push(format!("clack:{:.2}", self.s.lid.v * 0.5));
            }
            self.lid_touching = true;
        } else {
            self.lid_touching = false;
        }
        self.lid_pivot.q = self.lid_q(hinge);
        self.hinge = hinge;
    }

    /* ----------------------------------------------------------- update */
    pub fn update(&mut self, dt_raw: f32, look: (f32, f32), mouth_in: Mouth) {
        let dt = dt_raw.min(1.0 / 20.0);
        self.time += dt;
        let mut o = Overrides::default();
        {
            let out = self.paper_out_dir;
            let mut fx = Fx { jet: &mut self.jet, paper: &mut self.paper, torn: &mut self.torn, paper_out_dir: out, events: &mut self.events };
            for a in self.active.iter_mut() {
                a.t += dt;
                let t = a.t.min(a.kind.duration());
                a.update(t, dt, &mut fx, &mut o);
            }
            for a in self.active.iter_mut() {
                if a.finished() {
                    a.end(&mut fx);
                }
            }
        }
        self.active.retain(|a| !a.finished());

        let (lx, ly) = o.look.unwrap_or(look);
        let (lx, ly) = (clamp(lx, -1.0, 1.0), clamp(ly, -1.0, 1.0));
        let m = match o.mouth {
            Some(v) => Mouth { open: v, ..Default::default() },
            None => mouth_in.clamped(),
        };
        self.mouth = m;
        self.talk_amt = m.open.max(m.round).max(m.wide).max(m.sib);
        let rest = if o.mouth.is_some() { 0.0 } else { self.rest_open * (1.0 - m.closed) };
        let full = o.mouth.is_some_and(|v| v > 0.9);

        let (my, mp) = (self.max_yaw, self.max_pitch);
        let s = &mut self.s;
        // body turns first part of the way, the head does the rest (lags via springs)
        s.yaw.target = lx * my * BODY_YAW_SHARE;
        s.pitch.target = -ly * mp * BODY_PITCH_SHARE;
        s.h_yaw.target = lx * my * (1.0 - BODY_YAW_SHARE) + o.head_yaw;
        s.h_pitch.target = -ly * mp * (1.0 - BODY_PITCH_SHARE) + o.head_pitch;
        // near the extremes he leans / tilts toward the side he looks at
        let side = crate::util::smooth(0.55, 1.0, lx.abs()) * lx.signum();
        s.lean.target = -side * 0.07;
        s.h_roll.target = -lx * 0.06 - side * 0.05;
        s.lid.target = if full { 1.45 } else { (rest + m.open * 0.9 + m.round * 0.12 + m.sib * 0.04 + m.upper_raise * 0.06).max(0.0) };
        s.smile.target = m.wide * 0.9 - m.round * 0.3;
        s.pucker.target = m.round;
        s.arch.target = clamp(m.open * 1.1 + m.round * 0.5 + m.sib * 0.3 + if full { 0.6 } else { 0.0 } - m.wide * 0.35, 0.0, 1.3);
        // lower lip: open vowels drop it (O/U pout it out a little), M/B/P closes it
        s.drop.target = clamp(1.3 * m.open + 0.3 * m.round - 0.8 * m.closed, 0.0, 1.0);
        s.corner_l.target = m.corner_l;
        s.corner_r.target = m.corner_r;
        s.jaw_side.target = m.jaw_side;
        s.jaw_fwd.target = m.jaw_fwd;
        s.upper_raise.target = m.upper_raise;
        s.lift.target = o.lift;
        s.squash.target = o.squash;
        s.eye_scale.target = o.eye_scale;
        s.handle.target = o.handle;

        let n = 3;
        let h = dt / n as f32;
        for _ in 0..n {
            s.step_all(h);
            if s.lid.x < 0.0 {
                // lid hits the seat: bounce + clack
                if s.lid.v < -2.5 {
                    self.events.push(format!("clack:{:.2}", -s.lid.v));
                }
                s.lid.x = 0.0;
                s.lid.v = -s.lid.v * 0.3;
            }
            // lower lip (seat) rises to meet the upper lip on M/B/P, F/V (a bit on S)
            s.seat.target = m.closed * 0.035 + m.sib * 0.01;
            s.h_roll.target += -s.h_yaw.v * 0.002;
        }

        // body
        let breath = (self.time * 2.2).sin() * 0.012;
        let talk = clamp(s.lid.x, 0.0, 1.6);
        let sq = s.squash.x + breath + talk * 0.015;
        self.body.s = Vec3::new(1.0 - sq * 0.5, 1.0 + sq, 1.0 - sq * 0.5);
        self.body.q = euler_xyz(s.pitch.x + o.flip, s.yaw.x + o.spin, s.lean.x);
        let cm = 0.75;
        let (fy, fz) = (cm - cm * o.flip.cos(), -cm * o.flip.sin());
        let flipping = o.flip != 0.0;
        self.body.p = Vec3::new(
            (self.time * 63.0).sin() * 0.008 * o.shake,
            s.lift.x + if flipping { fy + o.flip_lift } else { 0.0 },
            (self.time * 51.0).cos() * 0.005 * o.shake + if flipping { fz } else { 0.0 },
        );

        // head
        self.head_e = (
            s.h_pitch.x - talk * HEAD_TALK_TILT + (self.time * 70.0).sin() * 0.02 * o.shake,
            s.h_yaw.x,
            s.h_roll.x + (self.time * 1.3).sin() * 0.015,
        );
        self.head.q = euler_xyz(self.head_e.0, self.head_e.1, self.head_e.2);
        self.head.p.y = self.dims.head_y + talk * 0.025;

        // mouth blend shapes (lid, then seat); L/R corners are signed (up / down)
        let s = &self.s;
        let side = clamp(s.jaw_side.x, -1.0, 1.0);
        let (pk, (cl, cr)) = (s.pucker.x, (s.corner_l.x, s.corner_r.x));
        let (pl, pm, pr) = (pk * (-side).max(0.0), pk * (1.0 - side.abs()), pk * side.max(0.0));
        self.morphs = [
            s.smile.x, pm, s.arch.x + ARCH_REST, cl.max(0.0), (-cl).max(0.0), cr.max(0.0), (-cr).max(0.0), pl, pr,
            cl.max(0.0), (-cl).max(0.0), cr.max(0.0), (-cr).max(0.0), pl * 0.8, pm * 0.8, pr * 0.8,
        ];
        // jaw: the lid + seat assembly yaws to the side and slides forward together
        self.jaw_yaw = JAW_YAW * side;
        self.jaw_fwd = JAW_FWD * clamp(s.jaw_fwd.x, 0.0, 1.0);
        self.seat_pivot.p = Vec3::new(0.0, RIM_Y, HINGE_Z + self.jaw_fwd);
        self.lid_pivot.p = Vec3::new(LID_PIVOT[0], LID_PIVOT[1], LID_PIVOT[2] + self.jaw_fwd);
        // mouth: lower lip first (the lid stays above it), then the lid
        self.seat_pivot.q = Quat::from_rotation_y(self.jaw_yaw) * Quat::from_rotation_x(-self.s.seat.x.max(0.0));
        self.apply_seat(dt);
        self.apply_lid(dt, talk);
        let s = &mut self.s;

        // eyes (googly: springy pupils lead the turn and saturate early, sag with gravity)
        let lead = |v: f32| (v * 2.2).tanh() / 2.2f32.tanh();
        s.px.target = lead(lx) * 0.95 - s.h_yaw.v * 0.05;
        s.py.target = lead(ly) * 0.9 - 0.15 + s.h_pitch.v * 0.05 - s.lift.v * 0.3;
        let blink = match o.blink {
            Some(b) => b,
            None => {
                self.blink_timer -= dt;
                if self.blink_timer < 0.0 {
                    self.blink_t = 0.0;
                    self.blink_timer = 1.8 + self.rng.next() * 4.5;
                }
                if self.blink_t >= 0.0 {
                    self.blink_t += dt;
                    let b = ((self.blink_t / 0.15).min(1.0) * std::f32::consts::PI).sin();
                    if self.blink_t > 0.15 {
                        self.blink_t = -1.0;
                    }
                    b
                } else {
                    0.0
                }
            }
        };
        let max_off = self.dims.eye_r * 0.5;
        let (mut px, mut py) = (s.px.x, s.py.x);
        let len = px.hypot(py);
        if len > 1.0 {
            px /= len;
            py /= len;
        }
        let es = s.eye_scale.x;
        for i in 0..2 {
            self.pupils[i].p.x = px * max_off;
            self.pupils[i].p.y = py * max_off;
            self.eyes[i].s = Vec3::new(es, es * (1.0 - 0.92 * blink), es);
        }

        // water & handle
        self.swirl_speed += (o.swirl - self.swirl_speed) * (dt * 3.0).min(1.0);
        self.water_tex_offset += 0.02 * dt;
        self.swirl_rot += (self.swirl_speed + 0.3) * dt;
        let swirl_opacity = clamp(self.swirl_speed / 14.0, 0.0, 1.0) * 0.55;
        let rise = self.jet.bowl_rise;
        let ws = 1.0 + rise.max(0.0) * 0.28;
        self.water.p.y = WATER_Y + rise * 0.12 + self.jet.bowl_slosh * 0.004 + (self.time * 12.0).sin() * 0.004 * talk;
        self.water.s = Vec3::new(ws, 1.0, ws);
        self.swirl.p.y = self.water.p.y + 0.002;
        self.swirl.s = self.water.s;
        self.handle.q = Quat::from_rotation_z(s.handle.x * 0.6);

        let (hyv, hpv, liftv, lid_x) = (s.h_yaw.v, s.h_pitch.v, s.lift.v, s.lid.x);

        // fx
        self.update_paper_anchor();
        let feeding = self.paper.length() < self.paper.target_len;
        if feeding {
            self.roll_rot += (self.paper.feed_speed / (ROLL_R * self.paper.roll_radius_scale)) * dt;
        }
        // the roll's axis is X: its front turns down while the paper feeds
        self.roll.q = Quat::from_rotation_x(self.roll_rot);
        self.paper.update(dt);
        if self.torn.fade > 0.0 {
            self.torn.update(dt);
            self.torn.fade -= dt * 0.5;
            if self.torn.fade <= 0.0 {
                self.torn.pts.clear();
                self.torn.update(0.0);
            }
        }
        let bm = self.body_m();
        let binv = bm.inverse();
        collide_paper(&mut self.paper, bm, binv);
        collide_paper(&mut self.torn, bm, binv);
        let (_, bq, _) = bm.to_scale_rotation_translation();
        self.jet.origin = bm.transform_point3(Vec3::new(0.0, WATER_Y, 0.0));
        self.jet.mouth = bm.transform_point3(Vec3::from(SPOUT));
        self.jet.dir = bq * Vec3::from(SPOUT_DIR).normalize();
        self.jet.side = bq * Vec3::X;
        self.jet.update(dt);
        let splashes = std::mem::take(&mut self.jet.splashes);
        for _ in 0..splashes {
            if self.rng.next() < 0.05 {
                self.events.push("drip".into());
            }
        }

        let sc = &mut self.scalars;
        sc[sc::HINGE] = self.hinge;
        sc[sc::ST_MOUTH] = clamp(lid_x / 1.15, 0.0, 1.4);
        sc[sc::ST_TALK] = clamp(m.open, 0.0, 1.0);
        sc[sc::HEAD_YAW_VEL] = hyv;
        sc[sc::HEAD_PITCH_VEL] = hpv;
        sc[sc::ST_LIFT] = liftv * 0.05;
        sc[sc::TIME] = self.time;
        sc[sc::SWIRL_OPACITY] = swirl_opacity;
        sc[sc::SWIRL_ROT] = self.swirl_rot;
        sc[sc::WATER_TEX_OFFSET] = self.water_tex_offset;
        sc[sc::DT] = dt;
        sc[sc::STREAM_VISIBLE] = if self.jet.stream_visible { 1.0 } else { 0.0 };
        sc[sc::PAPER_COUNT] = self.paper.count as f32;
        sc[sc::PAPER_PERF] = self.paper.perf_count as f32;
        sc[sc::PAPER_OPACITY] = self.paper.opacity;
        sc[sc::TORN_COUNT] = self.torn.count as f32;
        sc[sc::TORN_PERF] = self.torn.perf_count as f32;
        sc[sc::TORN_OPACITY] = self.torn.opacity;
        sc[sc::PUDDLE_VERSION] = self.jet.puddle_version as f32;
        sc[sc::BOWL_RISE] = self.jet.bowl_rise;
        self.write_pose();
    }

    fn write_pose(&mut self) {
        let sb = &self.seat_bones;
        let nodes: [Trs; NODE_ORDER.len()] = [
            self.body, self.head, self.lid_pivot, self.bones[1], self.bones[2], self.bones[3],
            self.bones[4], self.bones[5], self.bones[6], self.bones[7], self.seat_pivot,
            self.eyes[0], self.eyes[1], self.pupils[0], self.pupils[1], self.handle, self.roll,
            self.water, self.swirl, sb[1], sb[2], sb[3], sb[4], sb[5], sb[6], sb[7],
        ];
        for (i, t) in nodes.iter().enumerate() {
            let o = &mut self.pose[i * POSE_STRIDE..(i + 1) * POSE_STRIDE];
            o.copy_from_slice(&[t.p.x, t.p.y, t.p.z, t.q.x, t.q.y, t.q.z, t.q.w, t.s.x, t.s.y, t.s.z]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const DT: f32 = 1.0 / 60.0;

    fn run(rig: &mut Rig, frames: usize, look: (f32, f32), m: Mouth) {
        for _ in 0..frames {
            rig.update(DT, look, m);
        }
    }

    #[test]
    fn rest_mouth_is_slightly_open_and_all_finite() {
        let mut r = Rig::new(3);
        run(&mut r, 120, (0.0, 0.0), Mouth::default());
        assert!((r.hinge() - MOUTH_REST).abs() < 0.01, "rest hinge {}", r.hinge());
        assert!(r.pose().iter().all(|x| x.is_finite()));
    }

    #[test]
    fn visemes_shape_the_lip() {
        let mut r = Rig::new(3);
        run(&mut r, 60, (0.0, 0.0), Mouth { open: 1.0, wide: 0.15, ..Default::default() });
        let a = r.hinge();
        assert!(a > 0.6, "A opens wide: {a}");
        run(&mut r, 60, (0.0, 0.0), Mouth { open: 0.3, round: 1.0, ..Default::default() });
        assert!(r.morphs()[1] > 0.9, "U puckers");
        run(&mut r, 60, (0.0, 0.0), Mouth { closed: 1.0, ..Default::default() });
        assert!(r.hinge() < 0.07, "M closes: {}", r.hinge());
    }

    #[test]
    fn lid_never_enters_the_head() {
        let mut r = Rig::new(5);
        for i in 0..400 {
            let look = ((i as f32 / 15.0).sin(), -1.0);
            r.update(DT, look, Mouth { open: 1.0, ..Default::default() });
            assert!(!r.lid_hits_head(r.hinge()), "frame {i}");
        }
        r.play("flush");
        for i in 0..330 {
            r.update(DT, (0.0, -1.0), Mouth::default());
            assert!(!r.lid_hits_head(r.hinge()), "flush frame {i}");
        }
    }

    #[test]
    fn lid_clamp_holds_at_extreme_look_angles() {
        let mut r = Rig::new(8);
        r.set_look_limits(1.6, 0.9); // beyond the defaults (clamped max)
        let open = Mouth { open: 1.0, round: 1.0, ..Default::default() };
        for (lx, ly) in [(1.0, 1.0), (-1.0, 1.0), (1.0, -1.0), (-1.0, -1.0), (0.0, -1.0), (0.0, 1.0)] {
            for i in 0..240 {
                r.update(DT, (lx, ly), open);
                assert!(!r.lid_hits_head(r.hinge()), "look ({lx},{ly}) frame {i}");
            }
        }
        r.play("flush");
        for i in 0..330 {
            r.update(DT, (1.0, -1.0), Mouth::default());
            assert!(!r.lid_hits_head(r.hinge()), "flush at extreme, frame {i}");
        }
        assert!(r.pose().iter().all(|x| x.is_finite()));
    }

    #[test]
    fn look_range_is_configurable_and_split_body_head() {
        let mut r = Rig::new(4);
        run(&mut r, 300, (1.0, 0.0), Mouth::default());
        let total = r.s.yaw.x + r.s.h_yaw.x;
        assert!((total - DEFAULT_MAX_YAW).abs() < 0.05, "total yaw {total}");
        assert!(r.s.yaw.x > r.s.h_yaw.x, "body does ~55%");
        assert!(r.s.lean.x < -0.05, "leans toward the side");
        r.set_look_limits(0.5, 0.2);
        run(&mut r, 300, (1.0, 0.0), Mouth::default());
        assert!((r.s.yaw.x + r.s.h_yaw.x - 0.5).abs() < 0.03);
    }

    #[test]
    fn every_action_runs_and_ends() {
        let mut r = Rig::new(9);
        for a in ["flush", "paper", "jump", "backflip", "no", "gargle", "blink"] {
            assert!(r.play(a));
            run(&mut r, 360, (0.3, 0.1), Mouth::default());
            assert!(!r.is_playing(), "{a} finished");
            assert!(r.pose().iter().all(|x| x.is_finite()), "{a} finite");
        }
        assert!(!r.play("nope"));
        let ev = r.drain_events();
        for e in ["flush", "splash", "paper", "rip", "boing", "whoosh", "gargle"] {
            assert!(ev.iter().any(|x| x == e), "event {e} in {ev:?}");
        }
    }

    #[test]
    fn flush_spews_from_the_mouth_and_paper_tears() {
        let mut r = Rig::new(11);
        r.play("flush");
        let mut saw_stream = false;
        for _ in 0..200 {
            r.update(DT, (0.0, 0.0), Mouth::default());
            saw_stream |= r.scalars()[sc::STREAM_VISIBLE] > 0.5;
        }
        assert!(saw_stream);
        assert!(r.jet.live_drops() > 0);
        r.play("paper");
        run(&mut r, 200, (0.0, 0.0), Mouth::default());
        assert!(r.torn.fade > 0.0 || r.torn.count > 0, "torn piece falling");
        assert!(r.paper.roll_radius_scale < 1.0);
    }

    #[test]
    fn backflip_turns_around() {
        let mut r = Rig::new(2);
        r.play("backflip");
        let mut max_y: f32 = 0.0;
        for _ in 0..93 {
            r.update(DT, (0.0, 0.0), Mouth::default());
            max_y = max_y.max(r.pose()[1]);
        }
        assert!(max_y > 0.5, "body flies up during the flip: {max_y}");
    }

    /// independent dense check (finer than the clamp samples): deepest point of the seat
    /// front ring underside below the rim top, inside the rim's outer radius
    fn seat_rim_penetration(r: &Rig) -> f32 {
        let chain = seat_chain(&r.seat_ang, &r.seat_slide, r.seat_gain);
        let pm = r.seat_pivot.mat();
        let mut worst = f32::MIN;
        for j in 0..=40 {
            let th = j as f32 / 40.0 * std::f32::consts::PI;
            let (ex, ez) = egg_point(th, SEAT_RX, SEAT_RZ, EGG);
            for k in 0..=30 {
                let s = SEAT_HOLE + (1.0 - SEAT_HOLE) * k as f32 / 30.0;
                let p = pm.transform_point3(skin(&chain, SEAT_Z0, SEAT_SEG, r.seat_morphed(Vec3::new(ex * s, SEAT_Y0, ez * s + SEAT_ZC))));
                if bowl_r(p.x, p.z) < RIM_OUTER_R {
                    worst = worst.max(RIM_TOP - p.y);
                }
            }
        }
        worst
    }

    #[test]
    fn lower_lip_drops_presses_and_never_enters_the_bowl() {
        let mut r = Rig::new(21);
        let a = Mouth { open: 1.0, wide: 0.15, ..Default::default() };
        run(&mut r, 60, (0.0, 0.0), a);
        let (drop, slide) = r.seat_front();
        assert!(drop > 0.02 && drop <= SEAT_MAX_DROP + 1e-3, "A drops the lower lip: {drop}");
        assert!(slide > 0.04, "A pushes it out over the bowl front: {slide}");
        run(&mut r, 60, (0.0, 0.0), Mouth { open: 0.65, round: 1.0, ..Default::default() });
        assert!(r.seat_front().0 > 0.02, "O drops it too: {:?}", r.seat_front());
        run(&mut r, 60, (0.0, 0.0), Mouth { closed: 1.0, ..Default::default() });
        assert!(r.seat_front().0 < -0.02, "M presses it up: {:?}", r.seat_front());
        assert!(r.hinge() < 0.07 && r.hinge() >= r.seat_lid_floor() - 1e-5, "lips closed, lid above the seat: {}", r.hinge());
        // random talking + looking + every action: never inside the rim, lid never below the seat
        let mut rng = Rng::new(5);
        let mut m = Mouth::default();
        for f in 0..2400 {
            if f % 9 == 0 {
                m = Mouth {
                    open: rng.next(),
                    round: rng.next() * rng.next(),
                    wide: rng.next() * rng.next(),
                    closed: (rng.next() - 0.6).max(0.0) * 2.5,
                    sib: (rng.next() - 0.7).max(0.0) * 3.0,
                    corner_l: rng.next() * 2.0 - 1.0,
                    corner_r: rng.next() * 2.0 - 1.0,
                    jaw_side: (rng.next() * 2.0 - 1.0) * rng.next(),
                    jaw_fwd: rng.next() * rng.next(),
                    upper_raise: (rng.next() - 0.5).max(0.0) * 2.0,
                };
            }
            if f % 400 == 0 {
                r.play(["flush", "paper", "jump", "gargle", "backflip", "no"][f / 400]);
            }
            let look = ((f as f32 / 37.0).sin(), (f as f32 / 53.0).cos());
            r.update(DT, look, m);
            let pen = seat_rim_penetration(&r);
            assert!(pen <= 0.0, "frame {f}: seat {pen} m inside the rim");
            assert!(r.seat_front().0 <= SEAT_MAX_DROP + 1e-3, "frame {f}: drop {:?}", r.seat_front());
            assert!(r.hinge() >= r.seat_lid_floor() - 1e-5 || r.hinge() >= LID_MAX_HINGE - 1e-5, "frame {f}: lid below the seat");
            assert!(!r.lid_hits_head(r.hinge()), "frame {f}: lid in the head");
        }
        assert!(r.pose().iter().all(|x| x.is_finite()));
    }

    /// head-space anchor vs the roll: (|distance from the roll axis - radius|, distance past the roll ends)
    fn anchor_on_roll(r: &Rig) -> (f32, f32) {
        let a = r.head_m().inverse().transform_point3(r.paper.anchor);
        let [rx, ry, rz] = r.dims.roll;
        let rad = ROLL_R * r.paper.roll_radius_scale;
        (((a.y - ry).hypot(a.z - rz) - rad).abs(), ((a.x - rx).abs() - ROLL_LEN / 2.0).max(0.0))
    }

    #[test]
    fn paper_roll_faces_the_front_and_the_anchor_stays_on_the_roll() {
        let mut r = Rig::new(13);
        let check = |r: &Rig, tag: &str| {
            let (d, past) = anchor_on_roll(r);
            assert!(d < 1e-3 && past == 0.0, "{tag}: anchor off the roll ({d}, {past})");
            let a = r.head_m().inverse().transform_point3(r.paper.anchor);
            assert!(a.z > r.dims.front() + ROLL_R, "{tag}: anchor in front of the tank face");
            let (_, hq, _) = r.head_m().to_scale_rotation_translation();
            assert!(r.paper_out_dir.dot(hq * Vec3::Z) > 0.999, "{tag}: paper blows forward");
            assert!(r.paper.width_dir.dot(hq * Vec3::X) > 0.999, "{tag}: roll axis along X");
        };
        check(&r, "new");
        r.play("paper");
        let mut max_yaw = 0.0f32;
        for f in 0..300 {
            r.update(DT, (0.0, 0.0), Mouth::default());
            check(&r, &format!("paper frame {f}"));
            max_yaw = max_yaw.max((r.s.yaw.x + r.s.h_yaw.x).abs());
        }
        assert!(max_yaw < 0.35, "turns only a little toward the roll: {max_yaw}");
        // the paper ends on the floor in front of the bowl, never inside the bowl/lid
        let binv = r.body_m().inverse();
        let floor: Vec<Vec3> = r.torn.pts.iter().chain(r.paper.pts.iter()).map(|o| o.p).filter(|p| p.y < 0.1).collect();
        assert!(!floor.is_empty(), "paper piled on the floor");
        let mz = floor.iter().map(|p| p.z).sum::<f32>() / floor.len() as f32;
        assert!(mz > 0.3, "pile in front of the bowl: mean z {mz}");
        for o in r.torn.pts.iter().chain(r.paper.pts.iter()) {
            let b = binv.transform_point3(o.p);
            if let Some(nb) = push_out_of_bowl(b) {
                assert!((nb - b).length() < 2e-3, "paper inside the bowl at {b}");
            }
        }
        // resized tank: the roll follows and the anchor is still on its surface
        r.set_body_dims(BodyDims::new(1.5, 0.7, 1.4, 1.0, 1.0, 0.0));
        assert!((r.dims.roll[0] + 0.3 * 1.5).abs() < 1e-5);
        check(&r, "resized");
        r.play("paper");
        for f in 0..120 {
            r.update(DT, (0.4, -0.3), Mouth::default());
            check(&r, &format!("resized frame {f}"));
        }
    }

    #[test]
    fn body_dims_move_eyes_and_the_lid_collision() {
        let mut r = Rig::new(17);
        r.set_body_dims(BodyDims::from_json(r#"{"tank":{"w":1.6,"h":1.6,"d":1.6},"eyes":{"size":1.8,"spacing":1.6,"y":0.12}}"#));
        let d = r.body_dims();
        let eye_l = &r.pose()[11 * POSE_STRIDE..11 * POSE_STRIDE + 3];
        assert!((eye_l[0] + d.eye_x).abs() < 1e-6 && (eye_l[1] - d.eye_y).abs() < 1e-6 && (eye_l[2] - d.front() - 0.004).abs() < 1e-6);
        for i in 0..400 {
            let look = ((i as f32 / 15.0).sin(), -1.0);
            r.update(DT, look, Mouth { open: 1.0, ..Default::default() });
            assert!(!r.lid_hits_head(r.hinge()), "big tank, frame {i}");
        }
        r.set_body_dims(BodyDims::new(0.6, 0.6, 0.6, 0.5, 0.6, -0.12));
        run(&mut r, 120, (0.0, 0.0), Mouth { open: 1.0, ..Default::default() });
        assert!(r.pose().iter().all(|x| x.is_finite()));
    }

    #[test]
    fn lip_upper_socket_follows_the_lid() {
        let mut r = Rig::new(4);
        run(&mut r, 90, (0.0, 0.0), Mouth { closed: 1.0, ..Default::default() });
        let c = r.lip_upper_matrix().transform_point3(Vec3::ZERO);
        let body = r.body_m().inverse().transform_point3(c);
        assert!(body.x.abs() < 1e-4 && (body.z - 0.49).abs() < 0.01 && (body.y - LID_PIVOT[1]).abs() < 0.05, "closed: {body}");
        run(&mut r, 90, (0.0, 0.0), Mouth { open: 1.0, ..Default::default() });
        let o = r.body_m().inverse().transform_point3(r.lip_upper_matrix().transform_point3(Vec3::ZERO));
        assert!(o.y > body.y + 0.3 && o.z < body.z - 0.1, "opens with the lid: {o}");
    }

    #[test]
    fn standard_visemes_corners_and_jaw() {
        assert_eq!(STANDARD_VISEMES.len(), 17);
        assert_eq!(viseme("M_P_B").unwrap().closed, 1.0);
        assert!(viseme("nope").is_none());
        let mut r = Rig::new(6);
        for (name, _) in STANDARD_VISEMES {
            run(&mut r, 30, (0.0, 0.0), viseme(name).unwrap());
            assert!(r.pose().iter().all(|x| x.is_finite()), "{name}");
        }
        // asymmetric smile: left corner up, right corner down, on the lid and on the seat
        run(&mut r, 60, (0.0, 0.0), Mouth { corner_l: 1.0, corner_r: -1.0, ..Default::default() });
        let w = r.morphs();
        assert!(w[3] > 0.9 && w[4] < 1e-3 && w[6] > 0.9 && w[5] < 1e-3, "lid corners {w:?}");
        assert!(w[9] > 0.9 && w[12] > 0.9, "seat corners {w:?}");
        assert!(lid_morph(3, -0.38, 0.9).y > 0.02 && lid_morph(3, 0.38, 0.9).y.abs() < 1e-6, "corner_L_up is on the -x side");
        for k in 0..SEAT_MORPHS {
            for (x, z) in [(0.0, 0.9), (-0.3, 0.7), (0.35, 0.6), (0.1, 0.0)] {
                assert!(seat_morph(k, x, z).y >= 0.0, "seat shape {k} never goes down");
            }
        }
        // jaw to the side purses the lips that way and yaws the lid + seat together
        run(&mut r, 60, (0.0, 0.0), Mouth { round: 1.0, jaw_side: 1.0, jaw_fwd: 1.0, ..Default::default() });
        let w = r.morphs();
        assert!(w[8] > 0.9 && w[7] < 1e-3 && w[1] < 0.05, "pucker_R {w:?}");
        let yaw = |q: &[f32]| 2.0 * q[1].atan2(q[3]); // small: ~ the y component
        let lid_q = &r.pose()[2 * POSE_STRIDE + 3..2 * POSE_STRIDE + 7];
        let seat_q = &r.pose()[10 * POSE_STRIDE + 3..10 * POSE_STRIDE + 7];
        assert!(yaw(lid_q) > 0.08 && yaw(seat_q) > 0.08, "jaw yaw {lid_q:?} {seat_q:?}");
        assert!(r.pose()[10 * POSE_STRIDE + 2] > HINGE_Z + 0.02, "jaw forward");
        // neck length moves the head
        r.set_body_dims(BodyDims::from_json(r#"{"neck":{"length":1.4}}"#));
        run(&mut r, 30, (0.0, 0.0), Mouth::default());
        assert!(r.pose()[POSE_STRIDE + 1] > HEAD_Y + 0.14, "longer neck: head y {}", r.pose()[POSE_STRIDE + 1]);
    }
}

