//! Per-frame logic of the human character ("Chratos"), full-body skeleton (body.rs):
//! look springs spread over spine / chest / neck / head, eyes that lead with saccades, auto
//! blink, breathing, idle sway, mouth vector -> smoothed blend-shape weights, sitting on
//! furniture, the headphone cable (verlet rope), one-shot actions and the SAME FX as the
//! toilet: water jet from the mouth (`crate::water`), toilet-paper strip from the right hand
//! (`crate::paper`) and rigid props (`crate::props`) pushed by his body (13 capsules), the
//! water and the paper.
//!
//! Actions use the same engine shape as the toilet (`crate::actions`): every frame an
//! [`Over`] table is reset, each running action writes into it (`lift`, `flip`, `spin`,
//! `squash`, `look`, `mouth`, ...) and may drive the FX; same names, durations and sound
//! events (`flush splash paper rip gargle boing whoosh drip clack:<v> prop_hit:.. prop_reset:..`).
//!
//! Space: the rig ROOT space has the floor at y = 0 (model space + 1.63 m), like the toilet,
//! so the FX / props simulations run unchanged. Output: `pose()` = `body::SKELETON` order x
//! [px,py,pz, qx,qy,qz,qw, sx,sy,sz] (local TRS; `plug` is in root space), `morphs()`,
//! `scalars()` (toilet `rig::sc` indices + [`sc_h`]), cable tube, and the jet / paper / props
//! buffers of the embedded simulations.
use super::body::{bind, bind_local, node, torso_proxy_sdf as torso_sdf, COLLIDERS, FINGERS_L, FINGERS_R, FLOOR, SKELETON};
use super::head::{HEAD_POS, MOUTH_Y};
use super::iso;
use super::morph::{self, m, JAW_MAX, N};
use super::parts::{CABLE_END, CABLE_TOP};
use crate::paper::PaperStrip;
use crate::props::{Env, EnvCapsule, Props};
use crate::rig::{sc, Mouth};
use crate::util::{smooth, Rng, Spring};
use crate::water::{DropHash, StreamSample, WaterJet};
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
/// palm of the right hand (model space, bind pose): the paper roll is held here
pub const PALM_R: Vec3 = Vec3::new(0.262, -0.862, -0.004);
/// toilet-paper width / roll radius in his hand (m)
pub const PAPER_W: f32 = 0.10;
pub const ROLL_R: f32 = 0.052;
/// extra scalars after the toilet's `rig::sc` ones
pub mod sc_h {
    /// 0..1: the paper roll is in his right hand
    pub const ROLL: usize = super::sc::LEN;
    /// 0..1 seated
    pub const SIT: usize = super::sc::LEN + 1;
    /// roll spin (rad)
    pub const ROLL_ROT: usize = super::sc::LEN + 2;
    pub const LEN: usize = super::sc::LEN + 3;
}

/// Per-frame overrides written by the actions (same fields / meaning as `actions::Overrides`
/// of the toilet, plus blend-shape weights and a few body poses).
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
    /// 0..1 knees to the chest, arms in (somersault tuck)
    pub tuck: f32,
    /// spine pitch (rad, + = leaning forward)
    pub lean: f32,
    /// 0..1 right arm stretched forward (holding the paper roll); `reach_shake` -1..1 waves it
    pub reach: f32,
    pub reach_shake: f32,
    /// 0..1 back of the right hand to the mouth
    pub wipe: f32,
    /// extra blend-shape weights
    pub morph: [f32; N],
}
impl Default for Over {
    fn default() -> Self {
        Over {
            mouth: None, head_pitch: 0.0, head_yaw: 0.0, head_roll: 0.0, lift: 0.0, shake: 0.0, squash: 0.0, blink: None, look: None, flip: 0.0,
            flip_lift: 0.0, spin: 0.0, sit_to: None, impact: 0.0, tuck: 0.0, lean: 0.0, reach: 0.0, reach_shake: 0.0, wipe: 0.0, morph: [0.0; N],
        }
    }
}

/// what the actions may touch besides the overrides (like `actions::Fx`)
pub struct Fx<'a> {
    pub jet: &'a mut WaterJet,
    pub paper: &'a mut PaperStrip,
    pub torn: &'a mut PaperStrip,
    pub paper_out_dir: Vec3,
    pub events: &'a mut Vec<String>,
    pub roll: &'a mut f32,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Flush,
    Paper,
    Gargle,
    Backflip,
    Blink,
    Jump,
    No,
    Sit,
    Stand,
    Laugh,
    Nod,
    Surprise,
    Wink,
    Blargh,
}
impl Kind {
    pub fn parse(name: &str) -> Option<Kind> {
        Some(match name {
            "flush" | "spit" | "vomit" => Kind::Flush,
            "paper" => Kind::Paper,
            "gargle" => Kind::Gargle,
            "backflip" => Kind::Backflip,
            "blink" => Kind::Blink,
            "jump" => Kind::Jump,
            "no" => Kind::No,
            "sit" => Kind::Sit,
            "stand" => Kind::Stand,
            "laugh" => Kind::Laugh,
            "nod" | "yes" => Kind::Nod,
            "surprise" => Kind::Surprise,
            "wink" => Kind::Wink,
            "blargh" => Kind::Blargh,
            _ => return None,
        })
    }
    /// same durations as the toilet where the action exists there
    pub fn duration(self) -> f32 {
        match self {
            Kind::Flush => 5.2,
            Kind::Paper => 4.4,
            Kind::Gargle => 2.2,
            Kind::Backflip => 1.55,
            Kind::Blink => 0.16,
            Kind::Jump => 1.0,
            Kind::No => 1.1,
            Kind::Sit | Kind::Stand => 0.9,
            Kind::Laugh => 1.7,
            Kind::Nod => 0.9,
            Kind::Surprise => 1.3,
            Kind::Wink => 0.6,
            Kind::Blargh => 2.4,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Action {
    kind: Kind,
    t: f32,
    started: bool,
    flag_a: bool,
    flag_b: bool,
    hold: f32,
}
const HOLD_MAX: f32 = 3.0;

impl Action {
    fn new(kind: Kind) -> Self {
        Action { kind, t: 0.0, started: false, flag_a: false, flag_b: false, hold: 0.0 }
    }
    /// writes this action's contribution at its time `t` into `o` / the FX
    fn update(&mut self, dt: f32, o: &mut Over, fx: &mut Fx) {
        let t = self.t;
        let u = (t / self.kind.duration()).clamp(0.0, 1.0);
        let e = env(u);
        let first = !self.started;
        self.started = true;
        match self.kind {
            Kind::Flush => {
                // gurgle (cheeks full, head back, throat working) -> lean in, jaw to 36 deg, water -> wipe the mouth
                if first {
                    fx.events.push("flush".into());
                }
                let gurgle = smooth(0.3, 1.2, t) * (1.0 - smooth(1.45, 1.65, t));
                o.shake += if t < 1.65 { smooth(0.35, 1.5, t) } else { 0.25 * (1.0 - smooth(1.65, 3.3, t)) };
                if t < 1.5 {
                    o.mouth = Some(gurgle * (0.03 + 0.05 * (t * 19.0).sin().abs()));
                    o.morph[m::CHEEK_PUFF] += gurgle * (0.65 + 0.30 * (t * 23.0).sin());
                    o.morph[m::PRESS] += 0.7 * gurgle;
                    o.morph[m::BROW_UP_L] += 0.7 * gurgle;
                    o.morph[m::BROW_UP_R] += 0.7 * gurgle;
                    o.head_pitch -= 0.20 * gurgle;
                    o.lean -= 0.10 * gurgle;
                    o.squash += 0.03 * smooth(0.9, 1.5, t);
                }
                let spew = t > 1.6 && t < 3.4;
                if (1.5..3.5).contains(&t) {
                    let k = smooth(1.5, 1.7, t) * (1.0 - smooth(3.35, 3.5, t));
                    let surge = 0.5 + 0.5 * (((t - 1.6) * PI * 2.0) / 0.9).cos();
                    o.mouth = Some(k);
                    o.head_pitch += k * (0.10 + 0.06 * surge);
                    o.lean += k * (0.26 + 0.06 * surge);
                    o.morph[m::LOWER_DOWN] += k;
                    o.morph[m::UPPER_RAISE] += 0.8 * k;
                    o.morph[m::WIDE_L] += 0.5 * k;
                    o.morph[m::WIDE_R] += 0.5 * k;
                    o.morph[m::BROW_DOWN_L] += 0.6 * k;
                    o.morph[m::BROW_DOWN_R] += 0.6 * k;
                    o.morph[m::SQUINT_L] += 0.8 * k;
                    o.morph[m::SQUINT_R] += 0.8 * k;
                    fx.jet.speed = 2.9 + 0.7 * surge;
                    fx.jet.rate = 520.0 * (0.6 + 0.4 * surge) * (1.0 - smooth(2.95, 3.4, t));
                    o.look = Some((0.0, -0.15));
                } else if (3.5..4.9).contains(&t) {
                    o.mouth = Some(0.0);
                    o.wipe = smooth(3.55, 3.9, t) * (1.0 - smooth(4.4, 4.85, t));
                    o.head_yaw += 0.12 * o.wipe * ((t - 3.9) * 7.0).sin();
                    o.morph[m::PRESS] += 0.6 * o.wipe;
                    o.morph[m::SQUINT_R] += 0.5 * o.wipe;
                }
                if spew && !self.flag_a {
                    fx.events.push("splash".into());
                }
                self.flag_a = spew;
                fx.jet.emitting = spew;
                if t > 3.45 && !self.flag_b {
                    self.flag_b = true;
                    fx.jet.drips = 1.6;
                }
            }
            Kind::Paper => {
                // goofy: the roll comes out in his right hand, he shakes the arm and the strip streams forward,
                // then a yank tears it. While a flush spews the paper keeps streaming through the water.
                if first {
                    fx.events.push("paper".into());
                    let a = fx.paper.anchor;
                    fx.paper.reset(a);
                    fx.paper.new_roll();
                    fx.paper.fade = 1.0;
                }
                if fx.jet.emitting && (1.6..2.0).contains(&t) && self.hold < HOLD_MAX {
                    self.hold += dt;
                    self.t -= dt;
                }
                *fx.roll = smooth(0.0, 0.25, t) * (1.0 - smooth(3.9, 4.3, t));
                o.reach = smooth(0.05, 0.45, t) * (1.0 - smooth(3.7, 4.3, t));
                if t < 2.5 {
                    o.reach_shake = (t * 17.0).sin() * smooth(0.3, 0.6, t);
                    fx.paper.target_len = 3.0;
                    fx.paper.feed_speed = 1.7 * smooth(0.25, 0.6, t) * (1.0 - 0.3 * smooth(1.8, 2.5, t));
                    let w = 12.0 * smooth(0.25, 0.7, t) * (1.0 - smooth(1.8, 2.5, t));
                    fx.paper.wind = fx.paper_out_dir * w;
                    fx.paper.wind.y = w * 0.2;
                } else {
                    fx.paper.wind = Vec3::ZERO;
                    fx.paper.target_len = fx.paper.length();
                    // the yank
                    o.reach_shake = -1.6 * smooth(2.85, 3.0, t) * (1.0 - smooth(3.0, 3.3, t));
                    if !self.flag_a && t > 3.0 {
                        self.flag_a = true;
                        if !fx.paper.tear_into(fx.torn) {
                            fx.torn.copy_from(fx.paper);
                            fx.torn.fade = 1.0;
                            let a = fx.paper.anchor;
                            fx.paper.reset(a);
                        }
                        fx.events.push("rip".into());
                    }
                }
                if !fx.jet.emitting {
                    o.look = Some(if t < 2.6 { (0.30, -0.35) } else { (0.20, -0.75) });
                }
                o.morph[m::SMILE_L] += 0.8 * e;
                o.morph[m::SMILE_R] += 0.8 * e;
                o.morph[m::BROW_UP_L] += 0.5 * e;
                o.morph[m::BROW_UP_R] += 0.5 * e;
                o.mouth = if t < 2.4 { Some(0.12 + 0.06 * (t * 20.0).sin()) } else { None };
                if t + dt >= self.kind.duration() {
                    let a = fx.paper.anchor;
                    fx.paper.reset(a);
                    *fx.roll = 0.0;
                }
            }
            Kind::Gargle => {
                if first {
                    fx.events.push("gargle".into());
                }
                let g = smooth(0.0, 0.3, t) * (1.0 - smooth(1.8, 2.2, t));
                o.head_pitch -= 0.45 * g;
                o.lean -= 0.08 * g;
                o.mouth = Some(g * (0.34 + 0.05 * (TAU * 9.0 * t).sin()));
                o.morph[m::CHEEK_PUFF] += g * (0.55 + 0.35 * (TAU * 7.0 * t).sin());
                o.shake += 0.25 * g;
                o.blink = Some(0.8 * g);
            }
            Kind::Backflip => {
                // crouch, jump, tuck (knees to the chest), open, land with a squash
                if first {
                    fx.events.push("boing".into());
                }
                let crouch = smooth(0.0, 0.16, u) * (1.0 - smooth(0.16, 0.26, u));
                let air = ((u - 0.20) / 0.62).clamp(0.0, 1.0);
                if air > 0.0 && !self.flag_a {
                    self.flag_a = true;
                    fx.events.push("whoosh".into());
                }
                o.flip_lift += 0.48 * 4.0 * air * (1.0 - air);
                o.flip = TAU * smooth(0.0, 1.0, air);
                o.tuck = smooth(0.08, 0.35, air) * (1.0 - smooth(0.70, 0.95, air));
                let land = smooth(0.82, 0.88, u) * (1.0 - smooth(0.88, 1.0, u));
                o.squash += 0.20 * crouch + 0.14 * land;
                o.mouth = Some(0.22 * (air * PI).sin());
                if u > 0.82 && !self.flag_b {
                    self.flag_b = true;
                    o.impact = 1.4;
                }
            }
            Kind::Blink => o.blink = Some((PI * u).sin()),
            Kind::Jump => {
                if first {
                    fx.events.push("boing".into());
                }
                let crouch = smooth(0.0, 0.2, u) * (1.0 - smooth(0.2, 0.3, u));
                let air = ((u - 0.25) / 0.55).clamp(0.0, 1.0);
                o.lift += 0.42 * 4.0 * air * (1.0 - air);
                let land = smooth(0.80, 0.86, u) * (1.0 - smooth(0.86, 1.0, u));
                o.squash += 0.16 * crouch + 0.12 * land;
                o.tuck = 0.25 * (air * PI).sin();
                o.head_pitch += 0.10 * crouch - 0.08 * (air * PI).sin();
                o.morph[m::BROW_UP_L] += 0.6 * (air * PI).sin();
                o.morph[m::BROW_UP_R] += 0.6 * (air * PI).sin();
                if u > 0.80 && !self.flag_b {
                    self.flag_b = true;
                    o.impact = 1.0;
                }
            }
            Kind::No => {
                o.head_yaw += 0.30 * e * (TAU * 2.5 * u).sin();
                o.morph[m::BROW_DOWN_L] += 0.35 * e;
                o.morph[m::BROW_DOWN_R] += 0.35 * e;
                o.morph[m::FROWN_L] += 0.3 * e;
                o.morph[m::FROWN_R] += 0.3 * e;
            }
            Kind::Sit | Kind::Stand => {
                if first {
                    fx.events.push("boing".into());
                }
                let hop = ((u - 0.25) / 0.5).clamp(0.0, 1.0);
                o.lift += 0.10 * 4.0 * hop * (1.0 - hop);
                o.squash += 0.10 * smooth(0.0, 0.2, u) * (1.0 - smooth(0.2, 0.35, u));
                if u > 0.3 {
                    o.sit_to = Some(if self.kind == Kind::Sit { 1.0 } else { 0.0 });
                }
                if u > 0.75 && !self.flag_b {
                    self.flag_b = true;
                    o.impact = 0.35;
                }
            }
            Kind::Laugh => {
                if first {
                    fx.events.push("laugh".into());
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
            Kind::Surprise => {
                if first {
                    fx.events.push("gasp".into());
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
            Kind::Blargh => {
                // the spit pose without water (debug / expression)
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
    /// external overrides added on top of the actions (for porting / scripting): lift, flip, spin, squash, mouth
    pub ext: Over,
    w: [f32; N],
    actions: Vec<Action>,
    pose: [f32; NODES * STRIDE],
    world: [Affine3A; NODES],
    events: Vec<String>,
    rope: [Vec3; CABLE_PTS],
    rope_prev: [Vec3; CABLE_PTS],
    rope_seg: f32,
    cable_pos: Vec<f32>,
    cable_nrm: Vec<f32>,
    // FX + props (the toilet's simulations)
    pub jet: WaterJet,
    pub paper: PaperStrip,
    pub torn: PaperStrip,
    pub props: Props,
    drop_hash: DropHash,
    stream_samples: [StreamSample; 12],
    paper_out_dir: Vec3,
    roll_amt: f32,
    roll_rot: f32,
    /// finger curl 0..1 of the left / right hand (smoothed)
    grip: [f32; 2],
    /// external grip targets (holding props): negative = automatic
    pub grip_ext: [f32; 2],
    caps_prev: [(Vec3, Vec3); COLLIDERS.len()],
    caps_valid: bool,
    scalars: [f32; sc_h::LEN],
    // the chair he sits on (same behaviour as the toilet's `furniture`)
    flip_kicked: bool,
    sit_drop_t: f32,
    resit: bool,
    prev_seat_state: f32,
    pub wet_tears: u32,
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
        let mut jet = WaterJet::new(seed ^ 0xA5A5);
        jet.mouth_width = 0.016;
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
            seat_height: 0.0,
            sacc: (0.0, 0.0),
            sacc_t: 0.8,
            blink_timer,
            blink_t: -1.0,
            blink_again: false,
            talk: 0.0,
            rest_smile: 0.40,
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
            jet,
            paper: PaperStrip::new(PAPER_W),
            torn: PaperStrip::new(PAPER_W),
            props: Props::new(),
            drop_hash: DropHash::new(0.1),
            stream_samples: [StreamSample::default(); 12],
            paper_out_dir: Vec3::Z,
            roll_amt: 0.0,
            roll_rot: 0.0,
            grip: [0.12, 0.12],
            grip_ext: [-1.0, -1.0],
            caps_prev: [(Vec3::ZERO, Vec3::ZERO); COLLIDERS.len()],
            caps_valid: false,
            scalars: [0.0; sc_h::LEN],
            flip_kicked: false,
            sit_drop_t: -1.0,
            resit: false,
            prev_seat_state: 0.0,
            wet_tears: 0,
        };
        r.torn.anchored = false;
        r.torn.fade = 0.0;
        // rope at rest: a slightly slack line between the anchors (root space: floor at y = 0)
        let up = Vec3::new(0.0, -FLOOR, 0.0);
        let len = (CABLE_TOP - CABLE_END).length() * 1.02;
        r.rope_seg = len / (CABLE_PTS - 1) as f32;
        for i in 0..CABLE_PTS {
            let t = i as f32 / (CABLE_PTS - 1) as f32;
            r.rope[i] = up + CABLE_TOP.lerp(CABLE_END, t) + Vec3::new(-0.01, 0.0, 0.03) * (PI * t).sin();
        }
        r.rope_prev = r.rope;
        r.update(0.0, (0.0, 0.0), Mouth::default());
        let a = r.paper.anchor;
        r.paper.reset(a);
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
    /// seat height above the floor (m) of the furniture on `floor_under`; 0 = none (he stands up)
    pub fn set_seat_height(&mut self, h: f32) {
        self.seat_height = h.clamp(0.0, 1.2);
        if self.seat_height <= 0.0 {
            self.sit_target = 0.0;
            self.resit = false;
        }
    }
    pub fn seat_height(&self) -> f32 {
        self.seat_height
    }
    /// 0 = standing .. 1 = seated (persistent; the `sit` / `stand` actions set it)
    pub fn set_sit(&mut self, v: f32) {
        self.sit_target = v.clamp(0.0, 1.0);
    }
    /// finger curl of the left / right hand right now (0 = open .. 1 = fist)
    pub fn grip(&self) -> [f32; 2] {
        self.grip
    }
    pub fn is_sitting(&self) -> bool {
        self.sit_target > 0.5
    }
    /// flush(spit) paper gargle backflip blink jump no sit stand laugh nod surprise wink blargh -> false if unknown
    pub fn play(&mut self, name: &str) -> bool {
        let Some(k) = Kind::parse(name) else { return false };
        if k == Kind::Sit && self.seat_height <= 0.0 {
            return true; // nothing to sit on
        }
        self.actions.retain(|a| a.kind != k);
        self.actions.push(Action::new(k));
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
    pub fn scalars(&self) -> &[f32] {
        &self.scalars
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
    /// the 13 body capsules in root space: (a, b, radius)
    pub fn capsules(&self) -> [(Vec3, Vec3, f32); COLLIDERS.len()] {
        let mut out = [(Vec3::ZERO, Vec3::ZERO, 0.0); COLLIDERS.len()];
        for (i, (n, a, b, r)) in COLLIDERS.iter().enumerate() {
            let w = self.world[*n];
            out[i] = (w.transform_point3(Vec3::from_array(*a) - bind(*n)), w.transform_point3(Vec3::from_array(*b) - bind(*n)), *r);
        }
        out
    }

    pub fn update(&mut self, dt: f32, look: (f32, f32), mouth: Mouth) {
        let dt = if dt.is_finite() { dt.clamp(0.0, 0.05) } else { 0.0 };
        self.time += dt;
        let t = self.time;
        let mo = mouth.clamped();

        /* ---- actions -> overrides + FX (same engine shape as the toilet) */
        let mut o = self.ext;
        self.jet.emitting = false;
        self.jet.rate = 0.0;
        self.paper.wind = Vec3::ZERO;
        self.paper.feed_speed = 0.0;
        self.paper.target_len = self.paper.length();
        let mut roll = if self.actions.iter().any(|a| a.kind == Kind::Paper) { self.roll_amt } else { 0.0 };
        {
            let mut fx = Fx { jet: &mut self.jet, paper: &mut self.paper, torn: &mut self.torn, paper_out_dir: self.paper_out_dir, events: &mut self.events, roll: &mut roll };
            let mut k = 0;
            while k < self.actions.len() {
                let mut a = self.actions[k];
                a.t += dt;
                a.update(dt, &mut o, &mut fx);
                if a.t >= a.kind.duration() {
                    self.actions.remove(k);
                } else {
                    self.actions[k] = a;
                    k += 1;
                }
            }
        }
        self.roll_amt = roll;
        if let Some(s) = o.sit_to {
            self.sit_target = if s > 0.5 && self.seat_height > 0.0 { 1.0 } else { 0.0 };
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
        // a relaxed, friendly eye: slightly narrowed with the resting smile
        target[m::SQUINT_L] += 0.6 * self.rest_smile * calm;
        target[m::SQUINT_R] += 0.6 * self.rest_smile * calm;
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
        // root: lift, squash toward the floor, somersault around the pelvis, spin. Root space has the floor at y = 0.
        let sq = o.squash.clamp(0.0, 0.6);
        let scale = Vec3::new(1.0 + 0.5 * sq, 1.0 - sq, 1.0 + 0.5 * sq);
        let floor = Vec3::new(0.0, FLOOR, 0.0);
        let rq = Quat::from_rotation_y(o.spin) * Quat::from_rotation_x(-o.flip);
        let pivot = bind(node::PELVIS) * scale + (floor - floor * scale) + Vec3::new(0.0, 0.10 * o.tuck, 0.0);
        let sway = Vec3::new(0.004 * (0.27 * t).sin() * (1.0 - sit), 0.0, 0.0);
        let root_pos = (floor - floor * scale) + (pivot - rq * pivot) + Vec3::new(0.0, o.lift + o.flip_lift, 0.0) + sway - floor;
        self.set(node::ROOT, root_pos, rq, scale);
        // sitting: the pelvis goes to the seat, hips and knees fold, the hands rest on the thighs
        let seat_y = FLOOR + self.seat_height + 0.105;
        let pelvis = bind(node::PELVIS);
        let low = self.seat_height < 0.2;
        let hip = (PI * 0.5 - 0.12) * sit.min(1.0) * if low { 0.75 } else { 1.0 };
        let knee = hip * if low { 0.35 } else { 1.0 };
        let lean = o.lean;
        self.set(node::PELVIS, Vec3::new(pelvis.x, pelvis.y + (seat_y - pelvis.y).min(0.0) * sit.min(1.0), pelvis.z - 0.03 * sit), Quat::from_rotation_x(-0.06 * sit + 0.25 * lean), Vec3::ONE);
        self.rotate(node::SPINE1, rot(0.05, 0.04, 0.05) * Quat::from_rotation_x(0.05 * sit + 0.25 * lean + 0.35 * o.tuck));
        self.rotate(node::SPINE2, rot(0.07, 0.05, 0.05) * Quat::from_rotation_x(0.25 * lean + 0.25 * o.tuck));
        self.set(node::CHEST, bind_local(node::CHEST) + Vec3::new(0.0, 0.0015 * breath, 0.0), rot(0.08, 0.06, 0.05) * Quat::from_rotation_x(0.25 * lean), Vec3::new(1.0 + 0.004 * breath, 1.0, 1.0 + 0.012 * breath));
        self.rotate(node::NECK, rot(0.30, 0.30, 0.30));
        self.rotate(node::HEAD, rot(0.50, 0.55, 0.55));
        let jaw_shift = Vec3::new(0.005 * (self.w[m::JAW_RIGHT] - self.w[m::JAW_LEFT]), 0.0, 0.005 * self.w[m::JAW_FWD]);
        self.set(node::JAW, bind_local(node::JAW) + jaw_shift, Quat::from_rotation_x(self.w[m::JAW_OPEN] * JAW_MAX), Vec3::ONE);
        let eye_q = |toe: f32| Quat::from_rotation_y(self.eye_yaw.x + toe) * Quat::from_rotation_x(self.eye_pitch.x);
        let (ql, qr) = (eye_q(0.03), eye_q(-0.03));
        self.rotate(node::EYE_L, ql);
        self.rotate(node::EYE_R, qr);
        // shoulders breathe, arms hang with a little life; in the air they fly up a bit; tuck hugs the knees
        let air = ((o.lift + o.flip_lift) * 2.2).min(1.0) * (1.0 - o.tuck);
        let tk = o.tuck;
        for (side, cl, ua, fa, th, sh) in [
            (-1.0f32, node::CLAVICLE_L, node::UPPERARM_L, node::FOREARM_L, node::THIGH_L, node::SHIN_L),
            (1.0, node::CLAVICLE_R, node::UPPERARM_R, node::FOREARM_R, node::THIGH_R, node::SHIN_R),
        ] {
            self.rotate(cl, Quat::from_rotation_z(side * (0.012 * breath + 0.10 * air)));
            let swing = 0.025 * (0.9 * t + side).sin() * (1.0 - sit);
            // right arm: reach forward with the paper roll / wipe the mouth
            let (reach, wipe) = if side > 0.0 { (o.reach, o.wipe) } else { (0.0, 0.0) };
            let ua_x = swing - 0.22 * sit - 0.9 * tk - reach * (0.98 + 0.16 * o.reach_shake) - 0.95 * wipe;
            let ua_z = side * (0.02 + 0.55 * air + 0.10 * sit - 0.15 * reach - 0.45 * wipe);
            self.rotate(ua, Quat::from_rotation_x(ua_x) * Quat::from_rotation_z(ua_z));
            let fa_x = -0.10 - 0.72 * sit - 0.3 * air - 1.3 * tk - reach * (0.18 + 0.40 * o.reach_shake) - 2.0 * wipe;
            self.rotate(fa, Quat::from_rotation_x(fa_x) * Quat::from_rotation_y(-side * (0.25 * sit + 0.6 * wipe)));
            self.rotate(th, Quat::from_rotation_x(-hip - 0.55 * sq - 1.75 * tk) * Quat::from_rotation_z(side * 0.06 * sit));
            self.rotate(sh, Quat::from_rotation_x(knee + 1.1 * sq + 2.2 * tk));
        }
        // hands: relaxed curl, a fist around the paper roll, loose on the thighs when seated, open in the air
        let auto = [0.14 + 0.10 * sit + 0.5 * tk - 0.10 * air, (0.14 + 0.10 * sit + 0.5 * tk - 0.10 * air).max(0.80 * self.roll_amt).max(0.55 * o.wipe)];
        for (h, first, side) in [(0usize, FINGERS_L, -1.0f32), (1, FINGERS_R, 1.0)] {
            let tg = if self.grip_ext[h] >= 0.0 { self.grip_ext[h].min(1.0) } else { auto[h].clamp(0.0, 1.0) };
            self.grip[h] += (tg - self.grip[h]) * (1.0 - (-dt * 14.0).exp());
            let g = self.grip[h];
            // thumb: swings across the palm and bends
            self.rotate(first, Quat::from_rotation_y(side * 0.55 * g) * Quat::from_rotation_z(-side * 0.35 * g));
            self.rotate(first + 1, Quat::from_rotation_z(-side * 0.55 * g) * Quat::from_rotation_x(0.25 * g));
            self.rotate(first + 2, Quat::from_rotation_z(-side * 0.70 * g));
            // fingers curl toward the palm (the bind pose already has a relaxed curl); the little ones close first
            for f in 0..4 {
                let lead = 1.0 + 0.10 * f as f32;
                let n = first + 3 + f * 3;
                self.rotate(n, Quat::from_rotation_z(-side * 1.25 * g * lead));
                self.rotate(n + 1, Quat::from_rotation_z(-side * 1.45 * g * lead));
                self.rotate(n + 2, Quat::from_rotation_z(-side * 0.95 * g * lead));
            }
        }
        self.rotate(node::FOOT_L, Quat::from_rotation_x(-0.55 * sq));
        self.rotate(node::FOOT_R, Quat::from_rotation_x(-0.55 * sq));
        // world matrices (parents come first in SKELETON)
        for i in 0..NODES - 1 {
            let l = self.local(i);
            self.world[i] = if SKELETON[i].1 < 0 { l } else { self.world[SKELETON[i].1 as usize] * l };
        }

        /* ---- cable, FX, props */
        if dt > 0.0 {
            self.step_rope(dt);
        }
        self.write_cable();
        self.update_fx(dt, &o);

        let s = &mut self.scalars;
        s[sc::ST_MOUTH] = self.w[m::JAW_OPEN];
        s[sc::ST_TALK] = mo.open;
        s[sc::HEAD_YAW_VEL] = self.yaw.v;
        s[sc::HEAD_PITCH_VEL] = self.pitch.v;
        s[sc::ST_LIFT] = o.lift + o.flip_lift;
        s[sc::TIME] = self.time;
        s[sc::DT] = dt;
        s[sc::STREAM_VISIBLE] = if self.jet.stream_visible { 1.0 } else { 0.0 };
        s[sc::PAPER_COUNT] = self.paper.count as f32;
        s[sc::PAPER_PERF] = self.paper.perf_count as f32;
        s[sc::PAPER_OPACITY] = self.paper.opacity;
        s[sc::TORN_COUNT] = self.torn.count as f32;
        s[sc::TORN_PERF] = self.torn.perf_count as f32;
        s[sc::TORN_OPACITY] = self.torn.opacity;
        s[sc::PUDDLE_VERSION] = self.jet.puddle_version as f32;
        s[sc::PAPER_WET] = self.paper.max_wet;
        s[sc::TORN_WET] = self.torn.max_wet;
        s[sc::PROP_COUNT] = self.props.count() as f32;
        s[sc::PROPS_ACTIVE] = self.props.active() as f32;
        s[sc_h::ROLL] = self.roll_amt;
        s[sc_h::SIT] = sit.min(1.0);
        s[sc_h::ROLL_ROT] = self.roll_rot;
    }

    /// water jet from the mouth, paper strip from the right hand, wet paper, props, the chair
    fn update_fx(&mut self, dt: f32, o: &Over) {
        // paper: anchored at the roll in his right palm, streaming along his forward
        let hand = self.world[node::HAND_R];
        let rootq = Quat::from_affine3(&self.world[node::ROOT]);
        let mut fwd = rootq * Vec3::Z;
        fwd.y = 0.0;
        let fwd = fwd.normalize_or(Vec3::Z);
        self.paper_out_dir = fwd;
        let palm = hand.transform_point3(PALM_R - bind(node::HAND_R));
        self.paper.anchor = palm + fwd * ROLL_R + Vec3::Y * 0.01;
        self.paper.width_dir = fwd.cross(Vec3::Y).normalize_or(Vec3::X);
        self.paper.emit_dir = (fwd * 0.5 + Vec3::NEG_Y).normalize();
        if self.paper.length() < self.paper.target_len {
            self.roll_rot += self.paper.feed_speed / (ROLL_R * self.paper.roll_radius_scale.max(0.2)) * dt;
        }
        // the jet drags the air with it: airborne paper is drawn toward the column and gets soaked
        let n = self.jet.stream_samples(&mut self.stream_samples);
        let k = 30.0 * self.jet.stream_amount();
        for p in [&mut self.paper, &mut self.torn] {
            p.attract.clear();
            p.attract.extend(self.stream_samples[..n].iter().map(|s| s.p));
            p.attract_k = k;
        }
        self.paper.update(dt);
        if let Some(k) = self.paper.tear_request.take() {
            if self.torn.fade <= 0.4 && self.paper.tear_at(k, &mut self.torn, false) {
                self.events.push("rip".into());
                self.wet_tears += 1;
            }
        }
        if self.torn.fade > 0.0 {
            self.torn.update(dt);
            self.torn.fade -= dt * 0.5;
            if self.torn.fade <= 0.0 {
                self.torn.pts.clear();
                self.torn.update(0.0);
            }
        }
        // water: out of the mouth along the spout
        let sp = self.spout();
        let head = self.world[node::HEAD];
        self.jet.mouth = Vec3::new(sp[0], sp[1], sp[2]);
        self.jet.dir = Vec3::new(sp[3], sp[4], sp[5]);
        self.jet.side = head.transform_vector3(Vec3::X).normalize_or(Vec3::X);
        let rp = self.world[node::ROOT].translation;
        self.jet.origin = Vec3::new(rp.x, sp[1], rp.z);
        self.jet.gurgle = 0.0;
        self.jet.update(dt);
        self.furniture(dt, o, fwd);
        self.interact(dt);
        let splashes = std::mem::take(&mut self.jet.splashes);
        for _ in 0..splashes {
            if self.rng.next() < 0.05 {
                self.events.push("drip".into());
            }
        }
    }

    /// The chair he sits on reacts like the toilet's: a backflip kicks it away (he lands on the floor and sits
    /// again once it is back), landings wobble it, the spit recoil pushes it back.
    fn furniture(&mut self, dt: f32, o: &Over, fwd: Vec3) {
        let flipping = o.flip_lift > 0.0 || o.flip != 0.0;
        let Some(k) = self.props.seat() else {
            self.flip_kicked = flipping;
            return;
        };
        let sitting = self.sit_target > 0.01;
        let st = self.props.state(k);
        let free = self.props.is_free(k);
        let side = Vec3::Y.cross(fwd);
        let mass = self.props.mass(k);
        self.props.set_occupied(k, sitting && free);
        if flipping {
            if !self.flip_kicked && sitting && st != crate::props::RETURNING {
                self.props.set_occupied(k, false);
                let v = -fwd * 2.6 + Vec3::Y * 2.2 + side * (self.rng.next() - 0.5) * 0.6;
                self.props.launch(k, v, side * -7.0 + Vec3::Y * (self.rng.next() - 0.5) * 3.0);
                self.sit_drop_t = 0.3;
                self.resit = true;
            }
            self.flip_kicked = true;
        } else {
            self.flip_kicked = false;
        }
        if self.sit_drop_t >= 0.0 {
            self.sit_drop_t -= dt;
            if self.sit_drop_t < 0.0 {
                self.sit_target = 0.0;
            }
            self.prev_seat_state = st;
            return;
        }
        let sitting = self.sit_target > 0.01;
        if o.impact > 0.0 && sitting && free {
            let a = self.rng.next() * TAU;
            let dir = side * a.cos() + fwd * a.sin();
            if o.impact < 0.6 {
                self.props.nudge(k, dir * (0.012 * o.impact / 0.35), (self.rng.next() - 0.5) * 0.06);
            } else {
                self.props.set_occupied(k, false);
                self.props.kick(k, (Vec3::NEG_Y * 0.8 + dir * 0.45) * (mass * o.impact), Vec3::Y * (self.seat_height * 0.5) + dir * 0.1);
            }
        }
        if sitting && free && self.jet.emitting {
            self.props.nudge(k, -fwd * (0.03 * dt), 0.0);
        }
        if sitting && !free {
            let bt = self.world[node::ROOT].translation;
            let gone = self.props.com(k).is_some_and(|c| Vec3::new(c.x - bt.x, 0.0, c.z - bt.z).length() > 0.25) || self.props.up(k).is_some_and(|u| u.y < 0.85);
            if gone {
                self.sit_target = 0.0;
                self.resit = true;
            }
        }
        if self.resit && free && st == crate::props::REST && self.prev_seat_state != crate::props::REST && self.seat_height > 0.0 {
            self.resit = false;
            self.play("sit");
        }
        self.prev_seat_state = st;
    }

    /// water x paper x props (props are hit by drops / the column / the paper / each other / his body capsules)
    fn interact(&mut self, dt: f32) {
        let paper_out = self.paper.pts.len() > 1 || self.torn.pts.len() > 1;
        let has_props = self.props.count() > 0;
        let caps = self.capsules();
        if !paper_out && !has_props {
            for (i, c) in caps.iter().enumerate() {
                self.caps_prev[i] = (c.0, c.1);
            }
            self.caps_valid = true;
            return;
        }
        let (dlo, dhi) = (self.jet.drops_lo - Vec3::splat(0.15), self.jet.drops_hi + Vec3::splat(0.15));
        let touches = |lo: Vec3, hi: Vec3| hi.cmpge(dlo).all() && lo.cmple(dhi).all();
        let strip_box = |s: &PaperStrip| (s.pts.len() > 1).then(|| s.pts.iter().fold((Vec3::splat(f32::MAX), Vec3::splat(f32::MIN)), |(a, b), o| (a.min(o.p), b.max(o.p))));
        let near = self.jet.live_count > 0
            && (strip_box(&self.paper).is_some_and(|(a, b)| touches(a, b))
                || (self.torn.fade > 0.0 && strip_box(&self.torn).is_some_and(|(a, b)| touches(a, b)))
                || self.props.bounds().is_some_and(|(a, b)| touches(a, b)));
        if near {
            self.drop_hash.build(&self.jet);
        } else {
            self.drop_hash.clear();
        }
        let ns = self.jet.stream_samples(&mut self.stream_samples);
        let puddle = self.jet.puddle_out;
        if paper_out {
            let st = &self.stream_samples[..ns];
            self.paper.soak(dt, &mut self.jet, &mut self.drop_hash, st, puddle);
            if self.torn.fade > 0.0 {
                self.torn.soak(dt, &mut self.jet, &mut self.drop_hash, st, puddle);
            }
        }
        if has_props {
            let inv_dt = 1.0 / dt.max(1e-4);
            let mut ec = [EnvCapsule::default(); COLLIDERS.len()];
            for (i, c) in caps.iter().enumerate() {
                let (pa, pb) = if self.caps_valid { self.caps_prev[i] } else { (c.0, c.1) };
                ec[i] = EnvCapsule { a: c.0, b: c.1, r: c.2, va: (c.0 - pa) * inv_dt, vb: (c.1 - pb) * inv_dt };
            }
            let env = Env::with_capsules(&ec, puddle, inv_dt);
            self.props.step(dt, &env, &mut self.jet, &mut self.drop_hash, [&mut self.paper, &mut self.torn]);
            self.events.append(&mut self.props.events);
        }
        for (i, c) in caps.iter().enumerate() {
            self.caps_prev[i] = (c.0, c.1);
        }
        self.caps_valid = true;
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
        if jump.length() > 0.004 {
            // (most of the anchor's motion: it swings a little but never stretches behind him)
            let carry = jump * if jump.length() > 0.08 { 1.0 } else { 0.85 };
            for i in 1..CABLE_PTS - 1 {
                self.rope[i] += carry;
                self.rope_prev[i] += carry;
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
