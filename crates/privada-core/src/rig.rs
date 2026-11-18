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

/// Animated nodes, in pose-buffer order. Each entry is 10 floats of LOCAL transform:
/// `[px, py, pz, qx, qy, qz, qw, sx, sy, sz]`.
pub const NODE_ORDER: [&str; 19] = [
    "body", "head", "lid_pivot", "lid_bone_1", "lid_bone_2", "lid_bone_3", "lid_bone_4",
    "lid_bone_5", "lid_bone_6", "lid_bone_7", "seat_pivot", "eye_L", "eye_R", "pupil_L",
    "pupil_R", "flush_handle", "paper_roll", "water", "water_swirl",
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

#[derive(Clone, Copy, Debug, Default)]
pub struct Mouth {
    pub open: f32,
    pub round: f32,
    pub wide: f32,
    pub closed: f32,
    pub sib: f32,
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
        }
    }
    /// same order as `for (const k in S)` in the JS rig
    fn step_all(&mut self, h: f32) {
        for s in [
            &mut self.yaw, &mut self.pitch, &mut self.h_yaw, &mut self.h_pitch, &mut self.h_roll,
            &mut self.lid, &mut self.seat, &mut self.px, &mut self.py, &mut self.lift,
            &mut self.squash, &mut self.eye_scale, &mut self.handle, &mut self.smile,
            &mut self.pucker, &mut self.arch,
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

pub struct Rig {
    s: Springs,
    lip: Vec<Spring>,
    time: f32,
    active: Vec<Action>,
    mouth: Mouth,
    talk_amt: f32,
    pub rest_open: f32,
    blink_timer: f32,
    blink_t: f32,
    swirl_speed: f32,
    swirl_rot: f32,
    water_tex_offset: f32,
    roll_rot: f32,
    lid_touching: bool,
    hinge: f32,
    rng: Rng,
    // nodes (local transforms)
    body: Trs,
    head: Trs,
    lid_pivot: Trs,
    bones: [Trs; LID_BONES],
    seat_pivot: Trs,
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
    morphs: [f32; 3],
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
            b.p.z = if i == 0 { -0.01 } else { LID_SEG };
        }
        let roll_w = ROLL_LEN * 0.96;
        let mut r = Self {
            s: Springs::new(),
            lip: (0..LID_BONES - 1).map(|i| Spring::new(300.0 - i as f32 * 28.0, 8.0 + i as f32 * 0.8)).collect(),
            time: 0.0,
            active: Vec::new(),
            mouth: Mouth::default(),
            talk_amt: 0.0,
            rest_open: MOUTH_REST,
            blink_timer,
            blink_t: -1.0,
            swirl_speed: 0.0,
            swirl_rot: 0.0,
            water_tex_offset: 0.0,
            roll_rot: 0.0,
            lid_touching: false,
            hinge: 0.0,
            rng,
            body: Trs::ID,
            head: Trs::at(Vec3::new(0.0, HEAD_Y, PIPE_Z)),
            lid_pivot: Trs::at(Vec3::from(LID_PIVOT)),
            bones,
            seat_pivot: Trs::at(Vec3::new(0.0, RIM_Y, HINGE_Z)),
            eyes: [
                Trs::at(Vec3::new(-EYE_X, EYE_Y, TANK_FRONT + 0.004)),
                Trs::at(Vec3::new(EYE_X, EYE_Y, TANK_FRONT + 0.004)),
            ],
            pupils: [Trs { p: Vec3::new(0.0, 0.0, 0.03), q: pupil_q, s: Vec3::ONE }; 2],
            handle: Trs::at(Vec3::from(HANDLE)),
            roll: Trs::at(Vec3::new(ROLL_X + TANK_W / 2.0, 0.0, 0.0)),
            water: Trs::at(Vec3::new(0.0, WATER_Y, 0.0)),
            swirl: Trs::at(Vec3::new(0.0, WATER_Y + 0.002, 0.0)),
            jet: WaterJet::new(seed ^ 0xA5A5),
            paper: PaperStrip::new(roll_w),
            torn: PaperStrip::new(roll_w),
            paper_out_dir: Vec3::NEG_X,
            events: Vec::new(),
            pose: vec![0.0; NODE_ORDER.len() * POSE_STRIDE],
            scalars: [0.0; sc::LEN],
            morphs: [0.0; 3],
        };
        r.torn.anchored = false;
        r.torn.fade = 0.0;
        r.jet.level_offset = 0.0;
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
    pub fn drain_events(&mut self) -> Vec<String> {
        std::mem::take(&mut self.events)
    }
    pub fn pose(&self) -> &[f32] {
        &self.pose
    }
    pub fn scalars(&self) -> &[f32; sc::LEN] {
        &self.scalars
    }
    /// lid blend shapes `[smile, pucker, arch]`
    pub fn morphs(&self) -> [f32; 3] {
        self.morphs
    }
    pub fn hinge(&self) -> f32 {
        self.hinge
    }

    /* ----------------------------------------------- transform helpers */
    fn body_m(&self) -> Mat4 {
        self.body.mat()
    }
    fn head_m(&self) -> Mat4 {
        self.body_m() * self.head.mat()
    }

    fn update_paper_anchor(&mut self) {
        let hm = self.head_m();
        let (_, hq, _) = hm.to_scale_rotation_translation();
        let roll_world = hm.transform_point3(Vec3::new(ROLL_X, ROLL_Y, ROLL_Z));
        let left = hq * Vec3::NEG_X;
        let rs = self.paper.roll_radius_scale;
        self.roll.s = Vec3::new(rs, rs, 1.0);
        self.paper.anchor = roll_world + left * ROLL_R * rs;
        self.paper.width_dir = hq * Vec3::Z;
        self.paper.emit_dir = hq * Vec3::NEG_Y;
        self.paper_out_dir = left;
    }

    /// lid bone world matrices for a given hinge (current bone rotations)
    fn bone_worlds(&self, hinge: f32) -> [Mat4; LID_BONES] {
        let mut piv = self.lid_pivot;
        piv.q = Quat::from_rotation_x(-hinge);
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
        let front = TANK_Z + TANK_D / 2.0 + 0.07; // eyes/handle stick out in front
        let n = LID_BONES;
        for i in 1..=n {
            let b = bw[i.min(n - 1)];
            for f in [0.0f32, 0.5, 1.0] {
                if i == n && f > 0.0 {
                    break;
                }
                let local = Vec3::new(0.0, LID_DEPTH + LID_DOME + 0.01, if i == n { 0.0 } else { -LID_SEG * (1.0 - f) });
                let p = head_inv.transform_point3(b.transform_point3(local));
                if p.y > TANK_Y - TANK_H / 2.0 - mm
                    && p.y < TANK_Y + TANK_H / 2.0 + 0.1
                    && p.z > TANK_Z - TANK_D / 2.0 - mm
                    && p.z < front
                    && p.x.abs() < TANK_W / 2.0 + mm
                {
                    return true;
                }
            }
        }
        // never fold back through the neck pipe
        let p = self.body_m().inverse().transform_point3(bw[1].transform_point3(Vec3::new(0.0, 0.0, LID_SEG)));
        p.z < PIPE_Z + 0.06
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
            s.target = lift + sag + pout + tense + flap + if open > 1.2 { -0.12 * w } else { 0.0 };
            for _ in 0..3 {
                s.step(dt / 3.0);
            }
            self.bones[i + 1].q = Quat::from_rotation_x(-s.x);
        }
        let mut hinge = open.max(0.0).max(self.s.seat.x + 0.006).min(LID_MAX_HINGE);
        if hinge > 0.3 && self.lid_hits_head(hinge) {
            let (mut lo, mut hi) = (0.0f32, hinge);
            for _ in 0..7 {
                let mid = (lo + hi) / 2.0;
                if self.lid_hits_head(mid) {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            hinge = lo;
            if !self.lid_touching && self.s.lid.v > 2.0 {
                self.events.push(format!("clack:{:.2}", self.s.lid.v * 0.5));
            }
            self.lid_touching = true;
        } else {
            self.lid_touching = false;
        }
        self.lid_pivot.q = Quat::from_rotation_x(-hinge);
        self.hinge = hinge;
        self.morphs = [self.s.smile.x, self.s.pucker.x, self.s.arch.x];
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
            None => Mouth {
                open: clamp(mouth_in.open, 0.0, 1.0),
                round: clamp(mouth_in.round, 0.0, 1.0),
                wide: clamp(mouth_in.wide, 0.0, 1.0),
                closed: clamp(mouth_in.closed, 0.0, 1.0),
                sib: clamp(mouth_in.sib, 0.0, 1.0),
            },
        };
        self.mouth = m;
        self.talk_amt = m.open.max(m.round).max(m.wide).max(m.sib);
        let rest = if o.mouth.is_some() { 0.0 } else { self.rest_open * (1.0 - m.closed) };
        let full = o.mouth.is_some_and(|v| v > 0.9);

        let s = &mut self.s;
        s.yaw.target = lx * 0.5;
        s.pitch.target = -ly * 0.1;
        s.h_yaw.target = lx * 0.28 + o.head_yaw;
        s.h_pitch.target = -ly * 0.22 + o.head_pitch;
        s.h_roll.target = -lx * 0.06;
        s.lid.target = if full { 1.45 } else { (rest + m.open * 0.9 + m.round * 0.12 + m.sib * 0.04).max(0.0) };
        s.smile.target = m.wide * 0.9 - m.round * 0.3;
        s.pucker.target = m.round;
        s.arch.target = clamp(m.open * 1.1 + m.round * 0.5 + m.sib * 0.3 + if full { 0.6 } else { 0.0 } - m.wide * 0.35, 0.0, 1.3);
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
            s.seat.target = m.closed * 0.045 + m.round * 0.035 + m.sib * 0.012 + s.lid.x.min(0.3) * 0.03;
            s.h_roll.target += -s.h_yaw.v * 0.002;
        }

        // body
        let breath = (self.time * 2.2).sin() * 0.012;
        let talk = clamp(s.lid.x, 0.0, 1.6);
        let sq = s.squash.x + breath + talk * 0.015;
        self.body.s = Vec3::new(1.0 - sq * 0.5, 1.0 + sq, 1.0 - sq * 0.5);
        self.body.q = euler_xyz(s.pitch.x + o.flip, s.yaw.x + o.spin, 0.0);
        let cm = 0.75;
        let (fy, fz) = (cm - cm * o.flip.cos(), -cm * o.flip.sin());
        let flipping = o.flip != 0.0;
        self.body.p = Vec3::new(
            (self.time * 63.0).sin() * 0.008 * o.shake,
            s.lift.x + if flipping { fy + o.flip_lift } else { 0.0 },
            (self.time * 51.0).cos() * 0.005 * o.shake + if flipping { fz } else { 0.0 },
        );

        // head
        self.head.q = euler_xyz(
            s.h_pitch.x - talk * 0.1 + (self.time * 70.0).sin() * 0.02 * o.shake,
            s.h_yaw.x,
            s.h_roll.x + (self.time * 1.3).sin() * 0.015,
        );
        self.head.p.y = HEAD_Y + talk * 0.025;

        // mouth
        self.apply_lid(dt, talk);
        let s = &mut self.s;
        self.seat_pivot.q = Quat::from_rotation_x(-s.seat.x.max(0.0));

        // eyes (googly: springy pupils that sag a bit with gravity)
        s.px.target = lx * 0.9 - s.h_yaw.v * 0.05;
        s.py.target = ly * 0.9 - 0.15 + s.h_pitch.v * 0.05 - s.lift.v * 0.3;
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
        let max_off = EYE_R * 0.5;
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
        self.roll.q = Quat::from_rotation_z(self.roll_rot);
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
        let nodes: [Trs; 19] = [
            self.body, self.head, self.lid_pivot, self.bones[1], self.bones[2], self.bones[3],
            self.bones[4], self.bones[5], self.bones[6], self.bones[7], self.seat_pivot,
            self.eyes[0], self.eyes[1], self.pupils[0], self.pupils[1], self.handle, self.roll,
            self.water, self.swirl,
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
}
