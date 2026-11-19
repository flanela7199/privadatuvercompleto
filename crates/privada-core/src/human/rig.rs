//! Per-frame logic of the human character ("Chratos"), full-body skeleton (body.rs):
//! look springs spread over spine / chest / neck / head, eyes that lead with saccades, auto
//! blink, breathing, idle sway, mouth vector -> smoothed blend-shape weights, sitting, the
//! headphone cable (verlet rope) and one-shot actions.
//!
//! Actions use the SAME engine shape as the toilet (`crate::actions`): every frame an
//! [`Over`] table is reset, each running action writes into it (`lift`, `flip`, `spin`,
//! `squash`, `look`, `mouth`, ...) and the rig applies it, so Privada's timelines can be ported
//! 1:1. The mouth opens up to [`JAW_MAX`] (36 deg) for a spit / vomit pose; normal speech uses
//! [`SPEECH_JAW`] of that. `spout()` gives the point + direction a water jet leaves the mouth.
//!
//! Output: `pose()` = `body::SKELETON` order x [px,py,pz, qx,qy,qz,qw, sx,sy,sz] (local TRS;
//! `plug` is in root space), `morphs()` = weights in `morph::MORPH_NAMES` order,
//! `cable_pos()/cable_nrm()` = tube vertices (root space) for `cable_indices()`.
use super::body::{bind, bind_local, node, FLOOR, SKELETON};
use super::head::{HEAD_POS, MOUTH_Y};
use super::iso;
use super::morph::{self, m, JAW_MAX, N};
use super::parts::{torso_sdf, CABLE_END, CABLE_TOP};
use crate::rig::Mouth;
use crate::util::{smooth, Rng, Spring};
use glam::{Affine3A, Quat, Vec3};
use std::f32::consts::{PI, TAU};

pub const NODES: usize = SKELETON.len();
pub const STRIDE: usize = 10;
pub const CABLE_PTS: usize = 20;
pub const CABLE_SIDES: usize = 6;
pub const CABLE_RADIUS: f32 = 0.0019;
const PLUG_AT: usize = 6;
/// where a water jet leaves the mouth (model space, bind pose)
pub const SPOUT: Vec3 = Vec3::new(0.0, MOUTH_Y - 0.004, 0.084);

/// Per-frame overrides written by the actions (same fields / meaning as `actions::Overrides`
/// of the toilet, plus blend-shape weights).
#[derive(Clone, Copy, Debug)]
pub struct Over {
    /// mouth opening 0..1 of the FULL jaw range (1 = 36 deg, the spit pose); None = speech
    pub mouth: Option<f32>,
    pub head_pitch: f32,
    pub head_yaw: f32,
    pub head_roll: f32,
    /// metres above the floor
    pub lift: f32,
    pub shake: f32,
    /// 0..1: flattens the body toward the floor (and bends the knees)
    pub squash: f32,
    pub blink: Option<f32>,
    pub look: Option<(f32, f32)>,
    /// radians, backward somersault around the pelvis
    pub flip: f32,
    pub flip_lift: f32,
    /// radians around the vertical axis
    pub spin: f32,
    pub sit_to: Option<f32>,
    pub impact: f32,
    /// extra blend-shape weights
    pub morph: [f32; N],
}
impl Default for Over {
    fn default() -> Self {
        Over { mouth: None, head_pitch: 0.0, head_yaw: 0.0, head_roll: 0.0, lift: 0.0, shake: 0.0, squash: 0.0, blink: None, look: None, flip: 0.0, flip_lift: 0.0, spin: 0.0, sit_to: None, impact: 0.0, morph: [0.0; N] }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Laugh,
    Nod,
    No,
    Surprise,
    Wink,
    Blink,
    Jump,
    Backflip,
    Gargle,
    Blargh,
    Sit,
    Stand,
}
impl Kind {
    pub fn parse(name: &str) -> Option<Kind> {
        Some(match name {
            "laugh" => Kind::Laugh,
            "nod" | "yes" => Kind::Nod,
            "no" => Kind::No,
            "surprise" => Kind::Surprise,
            "wink" => Kind::Wink,
            "blink" => Kind::Blink,
            "jump" => Kind::Jump,
            "backflip" => Kind::Backflip,
            "gargle" => Kind::Gargle,
            "blargh" | "spit" => Kind::Blargh,
            "sit" => Kind::Sit,
            "stand" => Kind::Stand,
            _ => return None,
        })
    }
    /// same durations as the toilet where the action exists there
    pub fn duration(self) -> f32 {
        match self {
            Kind::Laugh => 1.7,
            Kind::Nod => 0.9,
            Kind::No => 1.1,
            Kind::Surprise => 1.3,
            Kind::Wink => 0.6,
            Kind::Blink => 0.16,
            Kind::Jump => 1.0,
            Kind::Backflip => 1.55,
            Kind::Gargle => 2.2,
            Kind::Blargh => 2.4,
            Kind::Sit | Kind::Stand => 0.9,
        }
    }
    /// writes this action's contribution at time `t` into `o`
    fn apply(self, t: f32, o: &mut Over, events: &mut Vec<String>, started: bool) {
        let u = (t / self.duration()).clamp(0.0, 1.0);
        let e = env(u);
        match self {
            Kind::Laugh => {
                if started {
                    events.push("laugh".into());
                }
                let ha = (TAU * 5.5 * t).sin();
                o.head_pitch -= 0.17 * e;
                o.lift += 0.004 * e * ha.max(0.0);
                o.shake += 0.3 * e * ha;
                o.morph[m::SMILE_L] += 0.95 * e;
                o.morph[m::SMILE_R] += 0.95 * e;
                o.mouth = Some(e * (0.24 + 0.12 * ha));
                o.morph[m::SQUINT_L] += 0.8 * e;
                o.morph[m::SQUINT_R] += 0.8 * e;
                o.morph[m::UPPER_RAISE] += 0.5 * e;
                o.morph[m::BROW_UP_L] += 0.25 * e;
                o.morph[m::BROW_UP_R] += 0.25 * e;
            }
            Kind::Nod => o.head_pitch += 0.20 * e * (1.0 - (2.0 * TAU * u).cos()) * 0.5,
            Kind::No => {
                o.head_yaw += 0.30 * e * (TAU * 2.5 * u).sin();
                o.morph[m::BROW_DOWN_L] += 0.35 * e;
                o.morph[m::BROW_DOWN_R] += 0.35 * e;
                o.morph[m::FROWN_L] += 0.3 * e;
                o.morph[m::FROWN_R] += 0.3 * e;
            }
            Kind::Surprise => {
                if started {
                    events.push("gasp".into());
                }
                let e = (u * 6.0).min(1.0) * (1.0 - ((u - 0.7) / 0.3).clamp(0.0, 1.0));
                o.head_pitch -= 0.07 * e;
                o.morph[m::BROW_UP_L] += e;
                o.morph[m::BROW_UP_R] += e;
                o.mouth = Some(0.26 * e);
                o.morph[m::PUCKER] += 0.25 * e;
            }
            Kind::Wink => {
                o.head_roll -= 0.07 * e;
                o.morph[m::BLINK_L] += (e * 1.6).min(1.0);
                o.morph[m::SQUINT_L] += 0.6 * e;
                o.morph[m::SMILE_L] += 0.7 * e;
                o.morph[m::SMILE_R] += 0.25 * e;
            }
            Kind::Blink => o.blink = Some((PI * u).sin()),
            Kind::Jump => {
                // crouch 0..0.25, airborne 0.25..0.8 (parabola), land + settle
                if started {
                    events.push("boing".into());
                }
                let crouch = smooth(0.0, 0.2, u) * (1.0 - smooth(0.2, 0.3, u));
                let air = ((u - 0.25) / 0.55).clamp(0.0, 1.0);
                o.lift += 0.42 * 4.0 * air * (1.0 - air);
                let land = smooth(0.80, 0.86, u) * (1.0 - smooth(0.86, 1.0, u));
                o.squash += 0.16 * crouch + 0.12 * land;
                o.head_pitch += 0.10 * crouch - 0.08 * (air * PI).sin();
                o.morph[m::BROW_UP_L] += 0.6 * (air * PI).sin();
                o.morph[m::BROW_UP_R] += 0.6 * (air * PI).sin();
                if u > 0.80 && u < 0.84 {
                    o.impact = 1.0;
                }
            }
            Kind::Backflip => {
                if started {
                    events.push("whoosh".into());
                }
                let crouch = smooth(0.0, 0.16, u) * (1.0 - smooth(0.16, 0.26, u));
                let air = ((u - 0.20) / 0.62).clamp(0.0, 1.0);
                o.lift += 0.62 * 4.0 * air * (1.0 - air);
                o.flip = TAU * smooth(0.0, 1.0, air);
                let land = smooth(0.82, 0.88, u) * (1.0 - smooth(0.88, 1.0, u));
                o.squash += 0.20 * crouch + 0.14 * land;
                o.mouth = Some(0.22 * (air * PI).sin());
                if u > 0.82 && u < 0.86 {
                    o.impact = 1.4;
                }
            }
            Kind::Gargle => {
                if started {
                    events.push("gargle".into());
                }
                o.head_pitch -= 0.42 * e;
                o.mouth = Some(e * (0.34 + 0.05 * (TAU * 9.0 * t).sin()));
                o.morph[m::CHEEK_PUFF] += e * (0.55 + 0.35 * (TAU * 7.0 * t).sin());
                o.shake += 0.25 * e;
                o.blink = Some(0.8 * e);
            }
            Kind::Blargh => {
                // wind up (cheeks full, head back), then the wide-open spit pose
                if started {
                    events.push("blargh".into());
                }
                let wind = smooth(0.0, 0.18, u) * (1.0 - smooth(0.22, 0.32, u));
                let spew = smooth(0.24, 0.36, u) * (1.0 - smooth(0.84, 1.0, u));
                o.head_pitch += -0.22 * wind + 0.16 * spew;
                o.mouth = Some(spew);
                o.morph[m::CHEEK_PUFF] += 0.9 * wind;
                o.morph[m::PRESS] += 0.8 * wind;
                o.morph[m::LOWER_DOWN] += spew;
                o.morph[m::UPPER_RAISE] += 0.8 * spew;
                o.morph[m::WIDE_L] += 0.5 * spew;
                o.morph[m::WIDE_R] += 0.5 * spew;
                o.morph[m::BROW_DOWN_L] += 0.6 * spew;
                o.morph[m::BROW_DOWN_R] += 0.6 * spew;
                o.morph[m::SQUINT_L] += 0.7 * spew;
                o.morph[m::SQUINT_R] += 0.7 * spew;
                o.shake += 0.35 * spew;
            }
            Kind::Sit | Kind::Stand => {
                // crouch, small hop, land (like the toilet's sit)
                let hop = ((u - 0.25) / 0.5).clamp(0.0, 1.0);
                o.lift += 0.10 * 4.0 * hop * (1.0 - hop);
                o.squash += 0.10 * smooth(0.0, 0.2, u) * (1.0 - smooth(0.2, 0.35, u));
                if u > 0.3 {
                    o.sit_to = Some(if self == Kind::Sit { 1.0 } else { 0.0 });
                }
                if u > 0.75 && u < 0.80 {
                    o.impact = 0.5;
                }
            }
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
    sit: Spring,
    sit_target: f32,
    seat_height: f32,
    sacc: (f32, f32),
    sacc_t: f32,
    /// seconds until the next automatic blink (set > 1e8 to disable, like the toilet's `blinkTimer`)
    pub blink_timer: f32,
    blink_t: f32,
    blink_again: bool,
    talk: f32,
    /// resting smile 0..1 (friendly default)
    pub rest_smile: f32,
    /// external overrides added on top of the actions (for porting / scripting): lift, flip, spin, squash
    pub ext: Over,
    w: [f32; N],
    actions: Vec<(Kind, f32)>,
    pose: [f32; NODES * STRIDE],
    world: [Affine3A; NODES],
    events: Vec<String>,
    rope: [Vec3; CABLE_PTS],
    rope_prev: [Vec3; CABLE_PTS],
    rope_seg: f32,
    cable_pos: Vec<f32>,
    cable_nrm: Vec<f32>,
}

/// integrate a spring over `dt` in sub-steps of at most 1/120 s (stiff springs stay stable at any frame rate)
fn step(s: &mut Spring, dt: f32) {
    let n = (dt * 120.0).ceil().max(1.0);
    for _ in 0..n as usize {
        s.step(dt / n);
    }
}

fn env(u: f32) -> f32 {
    (PI * u.clamp(0.0, 1.0)).sin().max(0.0).powf(0.6)
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
            sit: Spring::new(110.0, 21.0),
            sit_target: 0.0,
            seat_height: 0.45,
            sacc: (0.0, 0.0),
            sacc_t: 0.8,
            blink_timer,
            blink_t: -1.0,
            blink_again: false,
            talk: 0.0,
            rest_smile: 0.30,
            ext: Over::default(),
            w: [0.0; N],
            actions: Vec::new(),
            pose: [0.0; NODES * STRIDE],
            world: [Affine3A::IDENTITY; NODES],
            events: Vec::new(),
            rope: [Vec3::ZERO; CABLE_PTS],
            rope_prev: [Vec3::ZERO; CABLE_PTS],
            rope_seg: 0.0,
            cable_pos: vec![0.0; CABLE_PTS * CABLE_SIDES * 3],
            cable_nrm: vec![0.0; CABLE_PTS * CABLE_SIDES * 3],
        };
        // rope at rest: a slightly slack line between the anchors
        let len = (CABLE_TOP - CABLE_END).length() * 1.02;
        r.rope_seg = len / (CABLE_PTS - 1) as f32;
        for i in 0..CABLE_PTS {
            let t = i as f32 / (CABLE_PTS - 1) as f32;
            r.rope[i] = CABLE_TOP.lerp(CABLE_END, t) + Vec3::new(-0.01, 0.0, 0.03) * (PI * t).sin();
        }
        r.rope_prev = r.rope;
        r.update(0.0, (0.0, 0.0), Mouth::default());
        for _ in 0..90 {
            r.step_rope(1.0 / 60.0);
        }
        r.write_cable();
        r
    }

    /// total look range in radians (spine + chest + neck + head + eyes), same API as the toilet rig
    pub fn set_look_limits(&mut self, max_yaw: f32, max_pitch: f32) {
        self.max_yaw = max_yaw.clamp(0.0, 1.6);
        self.max_pitch = max_pitch.clamp(0.0, 0.9);
    }
    pub fn look_limits(&self) -> (f32, f32) {
        (self.max_yaw, self.max_pitch)
    }
    /// seat height above the floor (m) used by `sit`; 0 = sit on the floor
    pub fn set_seat_height(&mut self, h: f32) {
        self.seat_height = h.clamp(0.0, 1.2);
    }
    pub fn seat_height(&self) -> f32 {
        self.seat_height
    }
    /// 0 = standing .. 1 = seated (persistent; the `sit` / `stand` actions set it)
    pub fn set_sit(&mut self, v: f32) {
        self.sit_target = v.clamp(0.0, 1.0);
    }
    pub fn is_sitting(&self) -> bool {
        self.sit_target > 0.5
    }
    /// laugh nod no surprise wink blink jump backflip gargle blargh(spit) sit stand -> false if unknown
    pub fn play(&mut self, name: &str) -> bool {
        let Some(k) = Kind::parse(name) else { return false };
        self.actions.retain(|(a, _)| *a != k);
        self.actions.push((k, -1.0)); // -1 = not started yet
        true
    }
    pub fn is_playing(&self) -> bool {
        !self.actions.is_empty()
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
    /// yaw / pitch / roll of the look chain this frame (radians, whole chain)
    pub fn head_angles(&self) -> (f32, f32, f32) {
        (self.yaw.x, self.pitch.x, self.roll.x)
    }
    /// root-space matrix of a skeleton node (after `update`)
    pub fn world(&self, n: usize) -> Affine3A {
        self.world[n]
    }
    /// world (rig root) matrix of the head bone, column-major 16 floats
    pub fn head_matrix(&self) -> [f32; 16] {
        glam::Mat4::from(self.world[node::HEAD]).to_cols_array()
    }
    /// where a water jet leaves the mouth: [px, py, pz, dx, dy, dz] in rig-root space
    /// (+z of the head, tilted down with half the jaw angle)
    pub fn spout(&self) -> [f32; 6] {
        let h = self.world[node::HEAD];
        let p = h.transform_point3(SPOUT - HEAD_POS);
        let d = h.transform_vector3(Quat::from_rotation_x(0.5 * self.w[m::JAW_OPEN] * JAW_MAX) * Vec3::Z).normalize_or(Vec3::Z);
        [p.x, p.y, p.z, d.x, d.y, d.z]
    }

    pub fn update(&mut self, dt: f32, look: (f32, f32), mouth: Mouth) {
        let dt = if dt.is_finite() { dt.clamp(0.0, 0.05) } else { 0.0 };
        self.time += dt;
        let t = self.time;
        let mo = mouth.clamped();

        /* ---- actions -> overrides (same engine shape as the toilet) */
        let mut o = self.ext;
        let mut k = 0;
        while k < self.actions.len() {
            let (kind, at) = self.actions[k];
            let started = at < 0.0;
            let at = at.max(0.0) + dt;
            kind.apply(at, &mut o, &mut self.events, started);
            if at >= kind.duration() {
                self.actions.remove(k);
            } else {
                self.actions[k].1 = at;
                k += 1;
            }
        }
        if let Some(s) = o.sit_to {
            self.sit_target = s;
        }
        if o.impact > 0.0 {
            self.events.push(format!("clack:{:.2}", 3.0 * o.impact));
        }
        self.sit.target = self.sit_target;
        step(&mut self.sit, dt);
        let sit = self.sit.x.clamp(0.0, 1.1);

        /* ---- look: the chain follows with springs, the eyes lead */
        let (lx, ly) = o.look.unwrap_or(look);
        let lx = if lx.is_finite() { lx.clamp(-1.0, 1.0) } else { 0.0 };
        let ly = if ly.is_finite() { ly.clamp(-1.0, 1.0) } else { 0.0 };
        let total_yaw = lx * self.max_yaw;
        let total_pitch = -ly * self.max_pitch; // + = nose down (rotation about +x)
        self.talk += (mo.open.max(mo.lips * 0.6) - self.talk) * (1.0 - (-dt * 6.0).exp());
        let shake = o.shake * (TAU * 11.0 * t).sin();
        let idle_yaw = 0.014 * (0.31 * t).sin() + 0.008 * (0.83 * t + 1.3).sin();
        let idle_pitch = 0.010 * (0.23 * t + 0.7).sin() + 0.018 * self.talk * (7.3 * t).sin();
        let idle_roll = 0.014 * (0.17 * t + 2.1).sin() + 0.010 * self.talk * (5.1 * t + 0.5).sin();
        self.yaw.target = 0.80 * total_yaw + idle_yaw + o.head_yaw + 0.03 * shake;
        self.pitch.target = 0.75 * total_pitch + idle_pitch + o.head_pitch;
        self.roll.target = -0.12 * self.yaw.x + idle_roll + o.head_roll + 0.02 * shake;
        step(&mut self.yaw, dt);
        step(&mut self.pitch, dt);
        step(&mut self.roll, dt);
        self.sacc_t -= dt;
        if self.sacc_t <= 0.0 {
            self.sacc_t = self.rng.range(0.5, 2.6);
            self.sacc = (self.rng.range(-0.035, 0.035), self.rng.range(-0.020, 0.020));
        }
        let micro = (0.004 * (13.0 * t).sin(), 0.003 * (11.0 * t + 1.0).sin());
        self.eye_yaw.target = (total_yaw - self.yaw.x + o.head_yaw).clamp(-0.50, 0.50) + self.sacc.0 + micro.0;
        self.eye_pitch.target = (total_pitch - self.pitch.x + o.head_pitch).clamp(-0.30, 0.32) + self.sacc.1 + micro.1;
        step(&mut self.eye_yaw, dt);
        step(&mut self.eye_pitch, dt);
        // whatever happens, the irises stay inside the lids
        self.eye_yaw.x = self.eye_yaw.x.clamp(-0.62, 0.62);
        self.eye_pitch.x = self.eye_pitch.x.clamp(-0.40, 0.42);

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
            blink = if b < 0.07 { smooth(0.0, 0.07, b) } else if b < 0.09 { 1.0 } else { 1.0 - smooth(0.09, 0.22, b) };
            if b >= 0.22 {
                self.blink_t = if self.blink_again { 0.0 } else { -1.0 };
                self.blink_again = false;
            }
        }
        let blink = blink.max(o.blink.unwrap_or(0.0));
        // the upper lids follow the gaze down
        let gaze_lid = (self.eye_pitch.x * 1.4).clamp(0.0, 0.35);

        /* ---- morph weights */
        let mut target = morph::mouth_to_morphs(&mo);
        if let Some(open) = o.mouth {
            target[m::JAW_OPEN] = target[m::JAW_OPEN].max(open);
        }
        let calm = (1.0 - target[m::PUCKER]) * (1.0 - target[m::FROWN_L].max(target[m::FROWN_R])) * (1.0 - 0.5 * target[m::PRESS]) * (1.0 - target[m::JAW_OPEN]);
        target[m::SMILE_L] += self.rest_smile * calm;
        target[m::SMILE_R] += self.rest_smile * calm;
        target[m::BROW_UP_L] += 0.15 * self.talk;
        target[m::BROW_UP_R] += 0.15 * self.talk;
        for i in 0..N {
            let tg = (target[i] + o.morph[i]).clamp(0.0, 1.0);
            let rate = if tg > self.w[i] { 32.0 } else { 20.0 };
            self.w[i] += (tg - self.w[i]) * (1.0 - (-dt * rate).exp());
        }
        // squint already brings both lids toward each other: blink only closes what is left
        self.w[m::BLINK_L] = blink.max(o.morph[m::BLINK_L]).max(gaze_lid).min(1.0 - 0.6 * self.w[m::SQUINT_L]);
        self.w[m::BLINK_R] = blink.max(o.morph[m::BLINK_R]).max(gaze_lid).min(1.0 - 0.6 * self.w[m::SQUINT_R]);

        /* ---- pose */
        let breath = (TAU * 0.24 * t).sin();
        let (yaw, pitch, roll) = (self.yaw.x, self.pitch.x, self.roll.x);
        let rot = |fy: f32, fp: f32, fr: f32| Quat::from_rotation_y(yaw * fy) * Quat::from_rotation_x(pitch * fp) * Quat::from_rotation_z(roll * fr);
        for i in 0..NODES {
            self.set(i, bind_local(i), Quat::IDENTITY, Vec3::ONE);
        }
        // root: lift, squash toward the floor, somersault around the pelvis, spin
        let sq = o.squash.clamp(0.0, 0.6);
        let scale = Vec3::new(1.0 + 0.5 * sq, 1.0 - sq, 1.0 + 0.5 * sq);
        let floor = Vec3::new(0.0, FLOOR, 0.0);
        let rq = Quat::from_rotation_y(o.spin) * Quat::from_rotation_x(-o.flip);
        let pivot = bind(node::PELVIS) * scale + (floor - floor * scale);
        let sway = Vec3::new(0.004 * (0.27 * t).sin() * (1.0 - sit), 0.0, 0.0);
        let root_pos = (floor - floor * scale) + (pivot - rq * pivot) + Vec3::new(0.0, o.lift + o.flip_lift, 0.0) + sway;
        self.set(node::ROOT, root_pos, rq, scale);
        // sitting: the pelvis goes to the seat, hips and knees fold, the hands rest on the thighs
        let seat_y = FLOOR + self.seat_height + 0.105;
        let pelvis = bind(node::PELVIS);
        let hip = (PI * 0.5 - 0.12) * sit.min(1.0) * if self.seat_height < 0.2 { 0.75 } else { 1.0 };
        let knee = hip * if self.seat_height < 0.2 { 0.35 } else { 1.0 };
        self.set(node::PELVIS, Vec3::new(pelvis.x, pelvis.y + (seat_y - pelvis.y).min(0.0) * sit.min(1.0), pelvis.z - 0.03 * sit), Quat::from_rotation_x(-0.06 * sit), Vec3::ONE);
        self.rotate(node::SPINE1, rot(0.05, 0.04, 0.05) * Quat::from_rotation_x(0.05 * sit));
        self.rotate(node::SPINE2, rot(0.07, 0.05, 0.05));
        self.set(node::CHEST, bind_local(node::CHEST) + Vec3::new(0.0, 0.0015 * breath, 0.0), rot(0.08, 0.06, 0.05), Vec3::new(1.0 + 0.004 * breath, 1.0, 1.0 + 0.012 * breath));
        self.rotate(node::NECK, rot(0.30, 0.30, 0.30));
        self.rotate(node::HEAD, rot(0.50, 0.55, 0.55));
        let jaw_shift = Vec3::new(0.005 * (self.w[m::JAW_RIGHT] - self.w[m::JAW_LEFT]), 0.0, 0.005 * self.w[m::JAW_FWD]);
        self.set(node::JAW, bind_local(node::JAW) + jaw_shift, Quat::from_rotation_x(self.w[m::JAW_OPEN] * JAW_MAX), Vec3::ONE);
        let eye_q = |toe: f32| Quat::from_rotation_y(self.eye_yaw.x + toe) * Quat::from_rotation_x(self.eye_pitch.x);
        let (ql, qr) = (eye_q(0.03), eye_q(-0.03));
        self.rotate(node::EYE_L, ql);
        self.rotate(node::EYE_R, qr);
        // shoulders breathe, arms hang with a little life; in the air they fly up a bit
        let air = (o.lift * 2.2).min(1.0);
        for (side, cl, ua, fa, th, sh) in [
            (-1.0f32, node::CLAVICLE_L, node::UPPERARM_L, node::FOREARM_L, node::THIGH_L, node::SHIN_L),
            (1.0, node::CLAVICLE_R, node::UPPERARM_R, node::FOREARM_R, node::THIGH_R, node::SHIN_R),
        ] {
            self.rotate(cl, Quat::from_rotation_z(side * (0.012 * breath + 0.10 * air)));
            let swing = 0.025 * (0.9 * t + side).sin() * (1.0 - sit);
            self.rotate(ua, Quat::from_rotation_x(swing - 0.22 * sit) * Quat::from_rotation_z(side * (0.02 + 0.55 * air + 0.10 * sit)));
            self.rotate(fa, Quat::from_rotation_x(-0.10 - 0.72 * sit - 0.3 * air) * Quat::from_rotation_y(-side * 0.25 * sit));
            self.rotate(th, Quat::from_rotation_x(-hip - 0.55 * sq) * Quat::from_rotation_z(side * 0.06 * sit));
            self.rotate(sh, Quat::from_rotation_x(knee + 1.1 * sq));
        }
        self.rotate(node::FOOT_L, Quat::from_rotation_x(-0.55 * sq));
        self.rotate(node::FOOT_R, Quat::from_rotation_x(-0.55 * sq));
        // world matrices (parents come first in SKELETON)
        for i in 0..NODES - 1 {
            let l = self.local(i);
            self.world[i] = if SKELETON[i].1 < 0 { l } else { self.world[SKELETON[i].1 as usize] * l };
        }

        /* ---- cable */
        if dt > 0.0 {
            self.step_rope(dt);
        }
        self.write_cable();
    }

    fn set(&mut self, n: usize, p: Vec3, q: Quat, s: Vec3) {
        self.pose[n * STRIDE..(n + 1) * STRIDE].copy_from_slice(&[p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]);
    }
    fn rotate(&mut self, n: usize, q: Quat) {
        self.pose[n * STRIDE + 3..n * STRIDE + 7].copy_from_slice(&[q.x, q.y, q.z, q.w]);
    }
    fn local(&self, n: usize) -> Affine3A {
        let p = &self.pose[n * STRIDE..(n + 1) * STRIDE];
        Affine3A::from_scale_rotation_translation(Vec3::new(p[7], p[8], p[9]), Quat::from_xyzw(p[3], p[4], p[5], p[6]), Vec3::new(p[0], p[1], p[2]))
    }

    fn step_rope(&mut self, dt: f32) {
        let (chest, head) = (self.world[node::SPINE2], self.world[node::HEAD]);
        let top = head.transform_point3(CABLE_TOP - HEAD_POS);
        let end = chest.transform_point3(CABLE_END - bind(node::SPINE2));
        let g = Vec3::new(0.0, -9.8, 0.0) * dt * dt;
        for i in 1..CABLE_PTS - 1 {
            let p = self.rope[i];
            let vel = (p - self.rope_prev[i]) * 0.94;
            self.rope_prev[i] = p;
            self.rope[i] = p + vel.clamp_length_max(0.05) + g;
        }
        // a flip / jump moves the anchors far in one frame: carry the rope along
        let jump = top - self.rope[0];
        if jump.length() > 0.08 {
            for i in 1..CABLE_PTS - 1 {
                self.rope[i] += jump;
                self.rope_prev[i] += jump;
            }
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
                // keep it on top of the hoodie (torso SDF in the upper-spine space)
                for i in 1..CABLE_PTS - 1 {
                    let pm = inv.transform_point3(self.rope[i]) + bind(node::SPINE2);
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
                let a = k as f32 / CABLE_SIDES as f32 * TAU;
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
            idx.extend_from_slice(&[a, d, b, a, c, d]);
        }
    }
    idx
}
