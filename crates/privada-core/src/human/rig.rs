//! Per-frame logic of the human character ("Chratos"): look springs (chest / neck / head),
//! eyes that lead with saccades, auto blink, breathing, idle sway, mouth vector -> smoothed
//! blend-shape weights, actions (laugh, nod, no, surprise, wink, blink) and the headphone
//! cable (verlet rope from the left cup to the chest). Deterministic for a given seed.
//!
//! Output: `pose()` = NODES x [px,py,pz, qx,qy,qz,qw, sx,sy,sz] (local TRS; `plug` is in root
//! space), `morphs()` = weights in `morph::MORPH_NAMES` order, `cable_pos()/cable_nrm()` =
//! tube vertices (root space) for `cable_indices()`.
use super::head::{CHEST_POS, EYE, HEAD_POS, HINGE, NECK_POS};
use super::morph::{self, m, JAW_MAX, N};
use super::parts::{torso_sdf, CABLE_END, CABLE_TOP};
use super::iso;
use crate::rig::Mouth;
use crate::util::{Rng, Spring};
use glam::{Affine3A, Quat, Vec3};

pub const NODES: [&str; 8] = ["root", "chest", "neck", "head", "jaw", "eye_L", "eye_R", "plug"];
pub const STRIDE: usize = 10;
pub const CABLE_PTS: usize = 20;
pub const CABLE_SIDES: usize = 6;
pub const CABLE_RADIUS: f32 = 0.0019;
const PLUG_AT: usize = 6;
mod node {
    pub const ROOT: usize = 0;
    pub const CHEST: usize = 1;
    pub const NECK: usize = 2;
    pub const HEAD: usize = 3;
    pub const JAW: usize = 4;
    pub const EYE_L: usize = 5;
    pub const EYE_R: usize = 6;
    pub const PLUG: usize = 7;
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Action {
    Laugh,
    Nod,
    No,
    Surprise,
    Wink,
}
impl Action {
    fn duration(self) -> f32 {
        match self {
            Action::Laugh => 1.7,
            Action::Nod => 0.9,
            Action::No => 1.1,
            Action::Surprise => 1.3,
            Action::Wink => 0.6,
        }
    }
}

pub struct HumanRig {
    rng: Rng,
    time: f32,
    max_yaw: f32,
    max_pitch: f32,
    yaw: Spring,
    pitch: Spring,
    roll: Spring,
    eye_yaw: Spring,
    eye_pitch: Spring,
    sacc: (f32, f32),
    sacc_t: f32,
    /// seconds until the next automatic blink (set > 1e8 to disable, like the toilet's `blinkTimer`)
    pub blink_timer: f32,
    blink_t: f32,
    blink_again: bool,
    talk: f32,
    /// resting smile 0..1 (friendly default)
    pub rest_smile: f32,
    w: [f32; N],
    action: Option<(Action, f32)>,
    pose: [f32; NODES.len() * STRIDE],
    events: Vec<String>,
    rope: [Vec3; CABLE_PTS],
    rope_prev: [Vec3; CABLE_PTS],
    rope_seg: f32,
    cable_pos: Vec<f32>,
    cable_nrm: Vec<f32>,
}

fn env(u: f32) -> f32 {
    (std::f32::consts::PI * u.clamp(0.0, 1.0)).sin().max(0.0).powf(0.6)
}

impl HumanRig {
    pub fn new(seed: u64) -> Self {
        let mut rng = Rng::new(seed);
        let blink_timer = rng.range(1.5, 4.0);
        let mut r = HumanRig {
            rng,
            time: 0.0,
            max_yaw: 80f32.to_radians(),
            max_pitch: 35f32.to_radians(),
            yaw: Spring::new(70.0, 13.0),
            pitch: Spring::new(80.0, 14.0),
            roll: Spring::new(60.0, 12.0),
            eye_yaw: Spring::new(900.0, 48.0),
            eye_pitch: Spring::new(900.0, 48.0),
            sacc: (0.0, 0.0),
            sacc_t: 0.8,
            blink_timer,
            blink_t: -1.0,
            blink_again: false,
            talk: 0.0,
            rest_smile: 0.30,
            w: [0.0; N],
            action: None,
            pose: [0.0; NODES.len() * STRIDE],
            events: Vec::new(),
            rope: [Vec3::ZERO; CABLE_PTS],
            rope_prev: [Vec3::ZERO; CABLE_PTS],
            rope_seg: 0.0,
            cable_pos: vec![0.0; CABLE_PTS * CABLE_SIDES * 3],
            cable_nrm: vec![0.0; CABLE_PTS * CABLE_SIDES * 3],
        };
        // rope at rest: a slightly slack line between the anchors
        let len = (CABLE_TOP - CABLE_END).length() * 1.06;
        r.rope_seg = len / (CABLE_PTS - 1) as f32;
        for i in 0..CABLE_PTS {
            let t = i as f32 / (CABLE_PTS - 1) as f32;
            r.rope[i] = CABLE_TOP.lerp(CABLE_END, t) + Vec3::new(-0.01, 0.0, 0.03) * (std::f32::consts::PI * t).sin();
        }
        r.rope_prev = r.rope;
        r.update(0.0, (0.0, 0.0), Mouth::default());
        for _ in 0..90 {
            r.step_rope(1.0 / 60.0);
        }
        r.write_cable();
        r
    }

    /// total look range in radians (chest + neck + head + eyes), same API as the toilet rig
    pub fn set_look_limits(&mut self, max_yaw: f32, max_pitch: f32) {
        self.max_yaw = max_yaw.clamp(0.0, 1.6);
        self.max_pitch = max_pitch.clamp(0.0, 0.9);
    }
    pub fn look_limits(&self) -> (f32, f32) {
        (self.max_yaw, self.max_pitch)
    }
    /// laugh | nod | no | surprise | wink | blink -> false if unknown
    pub fn play(&mut self, name: &str) -> bool {
        let a = match name {
            "laugh" => Action::Laugh,
            "nod" | "yes" => Action::Nod,
            "no" => Action::No,
            "surprise" => Action::Surprise,
            "wink" => Action::Wink,
            "blink" => {
                self.blink_t = 0.0;
                return true;
            }
            _ => return false,
        };
        self.action = Some((a, 0.0));
        match a {
            Action::Laugh => self.events.push("laugh".into()),
            Action::Surprise => self.events.push("gasp".into()),
            _ => {}
        }
        true
    }
    pub fn is_playing(&self) -> bool {
        self.action.is_some()
    }
    pub fn pose(&self) -> &[f32] {
        &self.pose
    }
    pub fn morphs(&self) -> &[f32] {
        &self.w
    }
    pub fn cable_pos(&self) -> &[f32] {
        &self.cable_pos
    }
    pub fn cable_nrm(&self) -> &[f32] {
        &self.cable_nrm
    }
    pub fn pending_events(&self) -> usize {
        self.events.len()
    }
    pub fn drain_events(&mut self) -> Vec<String> {
        std::mem::take(&mut self.events)
    }
    /// head yaw / pitch / roll of this frame (radians, whole chain)
    pub fn head_angles(&self) -> (f32, f32, f32) {
        (self.yaw.x, self.pitch.x, self.roll.x)
    }

    pub fn update(&mut self, dt: f32, look: (f32, f32), mouth: Mouth) {
        let dt = if dt.is_finite() { dt.clamp(0.0, 0.05) } else { 0.0 };
        self.time += dt;
        let t = self.time;
        let lx = if look.0.is_finite() { look.0.clamp(-1.0, 1.0) } else { 0.0 };
        let ly = if look.1.is_finite() { look.1.clamp(-1.0, 1.0) } else { 0.0 };
        let mo = mouth.clamped();

        /* ---- action state */
        let mut act = [0.0f32; N];
        let (mut a_yaw, mut a_pitch, mut a_roll, mut a_bounce, mut a_back) = (0.0, 0.0, 0.0, 0.0, 0.0);
        if let Some((a, at)) = self.action {
            let at = at + dt;
            let u = at / a.duration();
            let e = env(u);
            match a {
                Action::Laugh => {
                    let ha = (std::f32::consts::TAU * 5.5 * at).sin();
                    a_pitch -= 0.17 * e;
                    a_bounce = 0.006 * e * ha;
                    act[m::SMILE_L] = 0.95 * e;
                    act[m::SMILE_R] = 0.95 * e;
                    act[m::JAW_OPEN] = e * (0.38 + 0.22 * ha);
                    act[m::SQUINT_L] = 0.8 * e;
                    act[m::SQUINT_R] = 0.8 * e;
                    act[m::UPPER_RAISE] = 0.5 * e;
                    act[m::BROW_UP_L] = 0.25 * e;
                    act[m::BROW_UP_R] = 0.25 * e;
                }
                Action::Nod => a_pitch += 0.20 * e * (1.0 - (2.0 * std::f32::consts::TAU * u).cos()) * 0.5,
                Action::No => {
                    a_yaw += 0.30 * e * (std::f32::consts::TAU * 2.5 * u).sin();
                    act[m::BROW_DOWN_L] = 0.35 * e;
                    act[m::BROW_DOWN_R] = 0.35 * e;
                    act[m::FROWN_L] = 0.3 * e;
                    act[m::FROWN_R] = 0.3 * e;
                }
                Action::Surprise => {
                    let e = (u * 6.0).min(1.0) * (1.0 - ((u - 0.7) / 0.3).clamp(0.0, 1.0));
                    a_pitch -= 0.07 * e;
                    a_back = 0.012 * e;
                    act[m::BROW_UP_L] = e;
                    act[m::BROW_UP_R] = e;
                    act[m::JAW_OPEN] = 0.42 * e;
                    act[m::PUCKER] = 0.25 * e;
                }
                Action::Wink => {
                    a_roll -= 0.07 * e;
                    act[m::BLINK_L] = (e * 1.6).min(1.0);
                    act[m::SQUINT_L] = 0.6 * e;
                    act[m::SMILE_L] = 0.7 * e;
                    act[m::SMILE_R] = 0.25 * e;
                }
            }
            self.action = if u >= 1.0 { None } else { Some((a, at)) };
        }

        /* ---- look: the chain (chest + neck + head) follows with springs, the eyes lead */
        let total_yaw = lx * self.max_yaw;
        let total_pitch = -ly * self.max_pitch; // + = nose down (rotation about +x)
        self.talk += (mo.open.max(mo.lips * 0.6) - self.talk) * (1.0 - (-dt * 6.0).exp());
        let idle_yaw = 0.014 * (0.31 * t).sin() + 0.008 * (0.83 * t + 1.3).sin();
        let idle_pitch = 0.010 * (0.23 * t + 0.7).sin() + 0.018 * self.talk * (7.3 * t).sin();
        let idle_roll = 0.014 * (0.17 * t + 2.1).sin() + 0.010 * self.talk * (5.1 * t + 0.5).sin();
        self.yaw.target = 0.80 * total_yaw + idle_yaw + a_yaw;
        self.pitch.target = 0.75 * total_pitch + idle_pitch + a_pitch;
        self.roll.target = -0.12 * self.yaw.x + idle_roll + a_roll;
        self.yaw.step(dt);
        self.pitch.step(dt);
        self.roll.step(dt);
        // saccades + micro motion
        self.sacc_t -= dt;
        if self.sacc_t <= 0.0 {
            self.sacc_t = self.rng.range(0.5, 2.6);
            self.sacc = (self.rng.range(-0.035, 0.035), self.rng.range(-0.020, 0.020));
        }
        let micro = (0.004 * (13.0 * t).sin(), 0.003 * (11.0 * t + 1.0).sin());
        self.eye_yaw.target = (total_yaw - self.yaw.x + a_yaw).clamp(-0.50, 0.50) + self.sacc.0 + micro.0;
        self.eye_pitch.target = (total_pitch - self.pitch.x + a_pitch).clamp(-0.30, 0.32) + self.sacc.1 + micro.1;
        self.eye_yaw.step(dt);
        self.eye_pitch.step(dt);

        /* ---- blink */
        self.blink_timer -= dt;
        if self.blink_timer <= 0.0 && self.blink_t < 0.0 {
            self.blink_t = 0.0;
            self.blink_again = self.rng.next() < 0.15;
            self.blink_timer = self.rng.range(1.8, 6.0);
        }
        let mut blink = 0.0;
        if self.blink_t >= 0.0 {
            self.blink_t += dt;
            let b = self.blink_t;
            blink = if b < 0.07 { crate::util::smooth(0.0, 0.07, b) } else if b < 0.09 { 1.0 } else { 1.0 - crate::util::smooth(0.09, 0.22, b) };
            if b >= 0.22 {
                self.blink_t = if self.blink_again { 0.0 } else { -1.0 };
                self.blink_again = false;
            }
        }
        // the upper lids follow the gaze down
        let gaze_lid = (self.eye_pitch.x * 1.4).clamp(0.0, 0.35);

        /* ---- morph weights */
        let mut target = morph::mouth_to_morphs(&mo);
        let calm = (1.0 - target[m::PUCKER]) * (1.0 - target[m::FROWN_L].max(target[m::FROWN_R])) * (1.0 - 0.5 * target[m::PRESS]);
        target[m::SMILE_L] += self.rest_smile * calm;
        target[m::SMILE_R] += self.rest_smile * calm;
        // talking lifts the brows a touch
        target[m::BROW_UP_L] += 0.15 * self.talk;
        target[m::BROW_UP_R] += 0.15 * self.talk;
        for i in 0..N {
            let tg = (target[i] + act[i]).clamp(0.0, 1.0);
            let rate = if tg > self.w[i] { 32.0 } else { 20.0 };
            self.w[i] += (tg - self.w[i]) * (1.0 - (-dt * rate).exp());
        }
        // squint already brings both lids toward each other: blink only closes what is left
        self.w[m::BLINK_L] = blink.max(act[m::BLINK_L]).max(gaze_lid).min(1.0 - 0.6 * self.w[m::SQUINT_L]);
        self.w[m::BLINK_R] = blink.max(act[m::BLINK_R]).max(gaze_lid).min(1.0 - 0.6 * self.w[m::SQUINT_R]);

        /* ---- pose */
        let breath = (std::f32::consts::TAU * 0.24 * t).sin();
        let (yaw, pitch, roll) = (self.yaw.x, self.pitch.x, self.roll.x);
        let rot = |fy: f32, fp: f32, fr: f32| Quat::from_rotation_y(yaw * fy) * Quat::from_rotation_x(pitch * fp) * Quat::from_rotation_z(roll * fr);
        let sway = Vec3::new(0.004 * (0.27 * t).sin(), 0.0018 * breath + a_bounce, -a_back);
        self.set(node::ROOT, sway, Quat::IDENTITY, Vec3::ONE);
        self.set(node::CHEST, CHEST_POS, rot(0.20, 0.15, 0.15), Vec3::new(1.0 + 0.004 * breath, 1.0, 1.0 + 0.012 * breath));
        self.set(node::NECK, NECK_POS - CHEST_POS, rot(0.30, 0.30, 0.30), Vec3::ONE);
        self.set(node::HEAD, HEAD_POS - NECK_POS, rot(0.50, 0.55, 0.55), Vec3::ONE);
        let jaw_shift = Vec3::new(0.005 * (self.w[m::JAW_RIGHT] - self.w[m::JAW_LEFT]), 0.0, 0.005 * self.w[m::JAW_FWD]);
        self.set(node::JAW, HINGE - HEAD_POS + jaw_shift, Quat::from_rotation_x(self.w[m::JAW_OPEN] * JAW_MAX), Vec3::ONE);
        let eye_q = |toe: f32| Quat::from_rotation_y(self.eye_yaw.x + toe) * Quat::from_rotation_x(self.eye_pitch.x);
        let (ql, qr) = (eye_q(0.03), eye_q(-0.03));
        self.set(node::EYE_L, Vec3::new(-EYE.x, EYE.y, EYE.z) - HEAD_POS, ql, Vec3::ONE);
        self.set(node::EYE_R, EYE - HEAD_POS, qr, Vec3::ONE);

        /* ---- cable */
        if dt > 0.0 {
            self.step_rope(dt);
        }
        self.write_cable();
    }

    fn set(&mut self, n: usize, p: Vec3, q: Quat, s: Vec3) {
        self.pose[n * STRIDE..(n + 1) * STRIDE].copy_from_slice(&[p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]);
    }
    fn local(&self, n: usize) -> Affine3A {
        let p = &self.pose[n * STRIDE..(n + 1) * STRIDE];
        Affine3A::from_scale_rotation_translation(Vec3::new(p[7], p[8], p[9]), Quat::from_xyzw(p[3], p[4], p[5], p[6]), Vec3::new(p[0], p[1], p[2]))
    }
    /// root-space matrices of chest and head
    fn chain(&self) -> (Affine3A, Affine3A) {
        let chest = self.local(node::ROOT) * self.local(node::CHEST);
        (chest, chest * self.local(node::NECK) * self.local(node::HEAD))
    }
    /// world (rig root) matrix of the head bone, column-major 16 floats
    pub fn head_matrix(&self) -> [f32; 16] {
        glam::Mat4::from(self.chain().1).to_cols_array()
    }

    fn step_rope(&mut self, dt: f32) {
        let (chest, head) = self.chain();
        let top = head.transform_point3(CABLE_TOP - HEAD_POS);
        let end = chest.transform_point3(CABLE_END - CHEST_POS);
        let g = Vec3::new(0.0, -9.8, 0.0) * dt * dt;
        for i in 1..CABLE_PTS - 1 {
            let p = self.rope[i];
            let vel = (p - self.rope_prev[i]) * 0.94;
            self.rope_prev[i] = p;
            self.rope[i] = p + vel.clamp_length_max(0.05) + g;
        }
        self.rope[0] = top;
        self.rope[CABLE_PTS - 1] = end;
        let inv = chest.inverse();
        let f: &dyn Fn(Vec3) -> f32 = &torso_sdf;
        for it in 0..6 {
            for i in 0..CABLE_PTS - 1 {
                let d = self.rope[i + 1] - self.rope[i];
                let l = d.length().max(1e-6);
                let corr = d * (0.5 * (l - self.rope_seg) / l);
                if i > 0 {
                    self.rope[i] += corr;
                }
                if i + 1 < CABLE_PTS - 1 {
                    self.rope[i + 1] -= corr;
                }
            }
            if it == 3 {
                // keep it on top of the hoodie (torso SDF in chest space)
                for i in 1..CABLE_PTS - 1 {
                    let pm = inv.transform_point3(self.rope[i]) + CHEST_POS;
                    let d = torso_sdf(pm);
                    if d < 0.004 {
                        let n = iso::gradient(f, pm, 0.003);
                        self.rope[i] += chest.transform_vector3(n) * (0.004 - d);
                    }
                }
            }
        }
        for p in &mut self.rope {
            if !p.is_finite() {
                *p = top;
            }
        }
    }

    fn write_cable(&mut self) {
        let mut nn = Vec3::Z;
        for i in 0..CABLE_PTS {
            let tan = (self.rope[(i + 1).min(CABLE_PTS - 1)] - self.rope[i.saturating_sub(1)]).normalize_or(Vec3::NEG_Y);
            nn = (nn - tan * nn.dot(tan)).normalize_or(tan.any_orthonormal_vector());
            let b = tan.cross(nn);
            for k in 0..CABLE_SIDES {
                let a = k as f32 / CABLE_SIDES as f32 * std::f32::consts::TAU;
                let n = b * a.cos() + nn * a.sin();
                let p = self.rope[i] + n * CABLE_RADIUS;
                let o = (i * CABLE_SIDES + k) * 3;
                self.cable_pos[o..o + 3].copy_from_slice(&[p.x, p.y, p.z]);
                self.cable_nrm[o..o + 3].copy_from_slice(&[n.x, n.y, n.z]);
            }
        }
        let dir = (self.rope[PLUG_AT - 1] - self.rope[PLUG_AT + 1]).normalize_or(Vec3::Y);
        self.set(node::PLUG, self.rope[PLUG_AT], Quat::from_rotation_arc(Vec3::Y, dir), Vec3::ONE);
    }
}

/// triangle indices of the cable tube (`CABLE_PTS` rings of `CABLE_SIDES` vertices)
pub fn cable_indices() -> Vec<u32> {
    let mut idx = Vec::with_capacity((CABLE_PTS - 1) * CABLE_SIDES * 6);
    let s = CABLE_SIDES as u32;
    for i in 0..CABLE_PTS as u32 - 1 {
        for k in 0..s {
            let (a, b, c, d) = (i * s + k, i * s + (k + 1) % s, (i + 1) * s + k, (i + 1) * s + (k + 1) % s);
            idx.extend_from_slice(&[a, b, d, a, d, c]);
        }
    }
    idx
}
