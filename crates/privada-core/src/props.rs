//! Rigid-body props: accessories standing on the floor / the tank (toilet-paper stack, spray,
//! rubber duck, plunger, brush holder, ...) that get knocked over when something HITS them.
//!
//! * A prop is registered with a box / cylinder collider, a mass and its rest pose (world =
//!   rig-root matrix of the accessory, re-sent every frame because the sockets move with him).
//! * At rest it is attached (state [`REST`]): water drops, the water column, the paper strip and
//!   other bodies only accumulate impulse on it; past a small threshold it wakes up ([`DYNAMIC`])
//!   with that impulse (and so does the rest of its `group`, e.g. the rolls of a paper stack).
//! * Dynamic bodies: gravity 9.8, floor y = 0, the character as static colliders (bowl + closed
//!   lid via `rig::push_out_of_bowl`, neck pipe capsule, tank box), sequential impulses at sample
//!   points (box corners + edge midpoints, cylinder rims) with restitution ~0.25 and friction ~0.6,
//!   angular damping, sleeping on the floor ([`SETTLED`]). Stable stacking is not a goal.
//! * After resting `reset_after` seconds (0 = never) a group flies back to its sockets ([`RETURNING`],
//!   eased with a little pop) and is attached again.
//! * The character is a KINEMATIC collider: its surface velocity (from last frame's matrices) pushes
//!   bodies and wakes attached floor props it bumps into (flips / jumps / shakes push things).
//! * A `seat` prop (furniture on `floor_under`) is what he sits on: the rig nudges it (flush recoil,
//!   turning), wobbles it on landings and kicks it away on a backflip ([`Props::launch`]).
//! * Events: `prop_hit:<id>:<speed>` (impacts, for a thud sfx), `prop_reset:<id>`.
//!
//! Output (`out`, [`PROP_STRIDE`] floats per slot): `[state, px, py, pz, qx, qy, qz, qw, sx, sy, sz,
//! speed]` = the accessory ORIGIN's world (rig-root) TRS; state -1 = empty slot, 4 = attached but nudged.
//! Deterministic: no randomness, fixed sub-steps.
use crate::geo::Json;
use crate::paper::PaperStrip;
use crate::water::{DropHash, StreamSample, WaterJet};
use glam::{Mat3, Mat4, Quat, Vec3};

pub const MAX_PROPS: usize = 32;
pub const PROP_STRIDE: usize = 12;
pub const EMPTY: f32 = -1.0;
pub const REST: f32 = 0.0;
pub const DYNAMIC: f32 = 1.0;
pub const SETTLED: f32 = 2.0;
pub const RETURNING: f32 = 3.0;
/// attached, but pushed a little off its socket (pose output only; see [`Props::nudge`])
pub const NUDGED: f32 = 4.0;

const G: f32 = 9.8;
const RESTITUTION: f32 = 0.25;
const FRICTION: f32 = 0.6;
/// a resting prop wakes when the accumulated impulse would give it this speed (m/s) / spin (rad/s)
const WAKE_DV: f32 = 0.15;
const WAKE_DW: f32 = 2.5;
/// kg of water per unit of drop size (drops are ~0.35..1.05)
pub const DROP_MASS: f32 = 0.002;
/// kg/s carried by the coherent column at full flow
pub const STREAM_MDOT: f32 = 0.8;
/// stylized mass (kg) a paper strip point pushes props with (paper wraps around them, the strip pulls)
pub const PAPER_PUSH_MASS: f32 = 0.008;
const SUBSTEPS: usize = 2;
const RETURN_TIME: f32 = 0.7;
const SLEEP_TIME: f32 = 0.5;
const HIT_EVENT_SPEED: f32 = 0.5;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Shape {
    /// half extents
    Box(Vec3),
    /// radius, height (axis = local Y)
    Cyl(f32, f32),
}

impl Shape {
    /// Point (shape-local, centred) vs the shape inflated by `margin`: outward normal + depth when inside.
    #[inline]
    pub fn contact(&self, p: Vec3, margin: f32) -> Option<(Vec3, f32)> {
        match *self {
            Shape::Box(h) => {
                let d = h + Vec3::splat(margin) - p.abs();
                if d.x <= 0.0 || d.y <= 0.0 || d.z <= 0.0 {
                    return None;
                }
                Some(if d.x < d.y && d.x < d.z {
                    (Vec3::new(p.x.signum(), 0.0, 0.0), d.x)
                } else if d.y < d.z {
                    (Vec3::new(0.0, p.y.signum(), 0.0), d.y)
                } else {
                    (Vec3::new(0.0, 0.0, p.z.signum()), d.z)
                })
            }
            Shape::Cyl(r, h) => {
                let (rr, hh) = (r + margin, h * 0.5 + margin);
                let rad2 = p.x * p.x + p.z * p.z;
                if rad2 >= rr * rr || p.y.abs() >= hh {
                    return None;
                }
                let rad = rad2.sqrt();
                let (dr, dy) = (rr - rad, hh - p.y.abs());
                Some(if dr < dy {
                    let n = if rad > 1e-6 { Vec3::new(p.x / rad, 0.0, p.z / rad) } else { Vec3::X };
                    (n, dr)
                } else {
                    (Vec3::new(0.0, p.y.signum(), 0.0), dy)
                })
            }
        }
    }
    /// local half extents of the bounding box
    pub fn half(&self) -> Vec3 {
        match *self {
            Shape::Box(h) => h,
            Shape::Cyl(r, h) => Vec3::new(r, h * 0.5, r),
        }
    }
    fn scaled(&self, s: Vec3) -> Shape {
        let s = s.abs();
        match *self {
            Shape::Box(h) => Shape::Box(h * s),
            Shape::Cyl(r, h) => Shape::Cyl(r * s.x.max(s.z), h * s.y),
        }
    }
    /// diagonal inertia tensor about the centre
    fn inertia(&self, m: f32) -> Vec3 {
        match *self {
            Shape::Box(h) => {
                let h2 = h * h;
                Vec3::new(h2.y + h2.z, h2.x + h2.z, h2.x + h2.y) * (m / 3.0)
            }
            Shape::Cyl(r, h) => {
                let a = m * (3.0 * r * r + h * h) / 12.0;
                Vec3::new(a, m * r * r * 0.5, a)
            }
        }
    }
    /// contact sample points (shape-local): box corners + edge midpoints, cylinder rims + cap centres
    fn samples(&self, out: &mut Vec<Vec3>) {
        out.clear();
        match *self {
            Shape::Box(h) => {
                for i in 0..27 {
                    let (a, b, c) = ((i % 3) as f32 - 1.0, ((i / 3) % 3) as f32 - 1.0, (i / 9) as f32 - 1.0);
                    let zeros = [a, b, c].iter().filter(|v| **v == 0.0).count();
                    if zeros <= 1 {
                        out.push(Vec3::new(a * h.x, b * h.y, c * h.z));
                    }
                }
            }
            Shape::Cyl(r, h) => {
                const N: usize = 12;
                for y in [-0.5f32, 0.5] {
                    for k in 0..N {
                        let a = k as f32 / N as f32 * std::f32::consts::TAU;
                        out.push(Vec3::new(a.cos() * r, y * h, a.sin() * r));
                    }
                    out.push(Vec3::new(0.0, y * h, 0.0));
                }
            }
        }
    }
}

/// Static colliders of the character for this frame (all in rig-root space).
#[derive(Clone, Copy, Debug)]
pub struct Env {
    /// false = floor only (tests / no character)
    pub character: bool,
    pub body: Mat4,
    pub body_inv: Mat4,
    pub head: Mat4,
    pub head_inv: Mat4,
    /// tank (+ tank lid) box in head space
    pub tank_c: Vec3,
    pub tank_h: Vec3,
    /// neck pipe capsule in body space
    pub pipe_a: Vec3,
    pub pipe_b: Vec3,
    pub pipe_r: f32,
    /// puddle [x, z, sx, sz, opacity] (the duck floats in it)
    pub puddle: [f32; 5],
    /// world bounding boxes of the bowl, the pipe and the tank (see [`Env::with_bounds`])
    pub bounds: [(Vec3, Vec3); 3],
    /// last frame's body / head matrices and 1/dt: the colliders' surface velocity (kinematic body)
    pub body_prev: Mat4,
    pub head_prev: Mat4,
    pub inv_dt: f32,
    /// extra kinematic capsules in rig-root space (the human character's body): `caps[..ncaps]`
    pub caps: [EnvCapsule; MAX_CAPS],
    pub ncaps: usize,
    /// world box around all capsules (set by [`Env::with_capsules`])
    pub caps_box: (Vec3, Vec3),
}

pub const MAX_CAPS: usize = 16;
/// a moving capsule: end points, radius and the velocity of each end (m/s)
#[derive(Clone, Copy, Debug, Default)]
pub struct EnvCapsule {
    pub a: Vec3,
    pub b: Vec3,
    pub r: f32,
    pub va: Vec3,
    pub vb: Vec3,
}

/// a contact with the floor / the character: outward normal, depth, surface velocity
#[derive(Clone, Copy, Debug)]
pub struct EnvHit {
    pub n: Vec3,
    pub d: f32,
    pub v: Vec3,
}

const BOWL: u8 = 1;
const PIPE: u8 = 2;
const TANK: u8 = 4;
const CAPS: u8 = 8;

/// world AABB of a local box under `m`
fn world_box(m: Mat4, lo: Vec3, hi: Vec3) -> (Vec3, Vec3) {
    let c = m.transform_point3((lo + hi) * 0.5);
    let h = (hi - lo) * 0.5;
    let e = m.x_axis.truncate().abs() * h.x + m.y_axis.truncate().abs() * h.y + m.z_axis.truncate().abs() * h.z;
    (c - e, c + e)
}

impl Env {
    pub fn floor_only() -> Self {
        Self {
            character: false,
            body: Mat4::IDENTITY,
            body_inv: Mat4::IDENTITY,
            head: Mat4::IDENTITY,
            head_inv: Mat4::IDENTITY,
            tank_c: Vec3::ZERO,
            tank_h: Vec3::ZERO,
            pipe_a: Vec3::ZERO,
            pipe_b: Vec3::ZERO,
            pipe_r: 0.0,
            puddle: [0.0; 5],
            bounds: [(Vec3::ZERO, Vec3::ZERO); 3],
            body_prev: Mat4::IDENTITY,
            head_prev: Mat4::IDENTITY,
            inv_dt: 0.0,
            caps: [EnvCapsule { a: Vec3::ZERO, b: Vec3::ZERO, r: 0.0, va: Vec3::ZERO, vb: Vec3::ZERO }; MAX_CAPS],
            ncaps: 0,
            caps_box: (Vec3::ZERO, Vec3::ZERO),
        }
    }
    /// floor + a capsule body (the human): `caps` in rig-root space with their end velocities
    pub fn with_capsules(caps: &[EnvCapsule], puddle: [f32; 5], inv_dt: f32) -> Self {
        let mut e = Self::floor_only();
        e.puddle = puddle;
        e.inv_dt = inv_dt;
        let (mut lo, mut hi) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN));
        for (i, c) in caps.iter().take(MAX_CAPS).enumerate() {
            e.caps[i] = *c;
            lo = lo.min(c.a.min(c.b) - Vec3::splat(c.r + 0.02));
            hi = hi.max(c.a.max(c.b) + Vec3::splat(c.r + 0.02));
            e.ncaps = i + 1;
        }
        e.caps_box = (lo, hi);
        e
    }
    /// deepest contact with the capsules: (outward normal, depth, surface velocity)
    fn cap_contact(&self, p: Vec3) -> Option<(Vec3, f32, Vec3)> {
        let mut best: Option<(Vec3, f32, Vec3)> = None;
        for c in &self.caps[..self.ncaps] {
            let ab = c.b - c.a;
            let t = ((p - c.a).dot(ab) / ab.length_squared().max(1e-9)).clamp(0.0, 1.0);
            let off = p - (c.a + ab * t);
            let l = off.length();
            if l < c.r && l > 1e-6 && best.is_none_or(|b| c.r - l > b.1) {
                let v = c.va.lerp(c.vb, t);
                let sp = v.length();
                best = Some((off / l, c.r - l, if sp > 8.0 { v * (8.0 / sp) } else { v }));
            }
        }
        best
    }
    /// velocity of the character's surface at world point `p` (moving with matrix `m`, last frame `prev`)
    #[inline]
    fn surf_vel(&self, m_inv: &Mat4, prev: &Mat4, p: Vec3) -> Vec3 {
        let v = (p - prev.transform_point3(m_inv.transform_point3(p))) * self.inv_dt;
        let l = v.length();
        if l > 8.0 { v * (8.0 / l) } else { v }
    }
    /// fill `bounds` from the matrices / sizes (call once per frame after building the Env)
    pub fn with_bounds(mut self) -> Self {
        let m = 0.02;
        self.bounds[0] = world_box(self.body, Vec3::new(-0.44, -0.01, -0.56), Vec3::new(0.44, crate::rig::PAPER_TOP + 0.02, 0.54));
        let (a, b) = (self.pipe_a.min(self.pipe_b), self.pipe_a.max(self.pipe_b));
        self.bounds[1] = world_box(self.body, a - Vec3::splat(self.pipe_r + m), b + Vec3::splat(self.pipe_r + m));
        self.bounds[2] = world_box(self.head, self.tank_c - self.tank_h - Vec3::splat(m), self.tank_c + self.tank_h + Vec3::splat(m));
        self
    }
    /// which character colliders a world box can touch (bit mask)
    #[inline]
    fn mask(&self, lo: Vec3, hi: Vec3) -> u8 {
        let mut k = 0;
        if self.ncaps > 0 && hi.cmpge(self.caps_box.0).all() && lo.cmple(self.caps_box.1).all() {
            k |= CAPS;
        }
        if !self.character {
            return k;
        }
        for (i, (blo, bhi)) in self.bounds.iter().enumerate() {
            if hi.cmpge(*blo).all() && lo.cmple(*bhi).all() {
                k |= 1 << i;
            }
        }
        k
    }
    /// deepest contact of a world point with the floor or the character: (outward normal, depth)
    #[inline]
    fn contact(&self, p: Vec3, mask: u8) -> Option<EnvHit> {
        let floor = (p.y < 0.0).then_some(EnvHit { n: Vec3::Y, d: -p.y, v: Vec3::ZERO });
        let mask = mask & self.mask(p, p);
        if mask == 0 {
            return floor;
        }
        let mut best: Option<(Vec3, f32, bool)> = floor.map(|h| (h.n, h.d, false));
        let mut take = |c: (Vec3, f32), head: bool| {
            if best.is_none_or(|b| c.1 > b.1) {
                best = Some((c.0, c.1, head));
            }
        };
        let b = self.body_inv.transform_point3(p);
        // the pedestal's sole (whatever he stands / sits on is pushed down out of it)
        if mask & BOWL != 0 && (0.0..0.03).contains(&b.y) && crate::rig::bowl_r(b.x, b.z) < 0.3 {
            let n = self.body.transform_vector3(Vec3::NEG_Y).normalize_or_zero();
            let v = self.surf_vel(&self.body_inv, &self.body_prev, p);
            let d = b.y + 0.001;
            return Some(match best {
                Some((bn, bd, _)) if bd > d => EnvHit { n: bn, d: bd, v: Vec3::ZERO },
                _ => EnvHit { n, d, v },
            });
        }
        if mask & BOWL != 0 {
            if let Some(nb) = crate::rig::push_out_of_bowl(b) {
                let d = self.body.transform_point3(nb) - p;
                let l = d.length();
                if l > 1e-6 {
                    take((d / l, l), false);
                }
            }
        }
        // neck pipe
        if mask & PIPE != 0 {
            let ab = self.pipe_b - self.pipe_a;
            let t = ((b - self.pipe_a).dot(ab) / ab.length_squared().max(1e-9)).clamp(0.0, 1.0);
            let off = b - (self.pipe_a + ab * t);
            let l = off.length();
            if l < self.pipe_r && l > 1e-6 {
                take((self.body.transform_vector3(off / l).normalize_or_zero(), self.pipe_r - l), false);
            }
        }
        // tank box (head space)
        if mask & TANK != 0 {
            let h = self.head_inv.transform_point3(p) - self.tank_c;
            if let Some((n, d)) = Shape::Box(self.tank_h).contact(h, 0.0) {
                take((self.head.transform_vector3(n).normalize_or_zero(), d), true);
            }
        }
        if mask & CAPS != 0 {
            if let Some((cn, cd, cv)) = self.cap_contact(p) {
                if best.is_none_or(|b| cd > b.1) {
                    return Some(EnvHit { n: cn, d: cd, v: cv });
                }
            }
        }
        let (n, d, head) = best?;
        let v = if n == Vec3::Y && floor.is_some_and(|f| f.d == d) {
            Vec3::ZERO
        } else if head {
            self.surf_vel(&self.head_inv, &self.head_prev, p)
        } else {
            self.surf_vel(&self.body_inv, &self.body_prev, p)
        };
        Some(EnvHit { n, d, v })
    }
}

/// Prop description from `register_prop` (object-local = the accessory's own space).
#[derive(Clone, Debug, PartialEq)]
pub struct PropDef {
    pub shape: Shape,
    pub mass: f32,
    /// collider centre and centre of mass (object-local)
    pub center: Vec3,
    pub com: Vec3,
    /// props of one group wake / return together (e.g. the rolls of a paper stack); "" = alone
    pub group: String,
    /// rubber duck: water makes it spin and bob, it floats in the puddle
    pub buoyant: bool,
    /// furniture he sits on (socket floor_under)
    pub seat: bool,
    /// attached to his body (head / lid sockets): no kinematic pushes while attached
    pub on_body: bool,
}

impl PropDef {
    /// `{"kind":"box"|"cylinder", "size":[x,y,z] | {"r","h"} | [r,h], "mass", "com":[x,y,z],
    /// "center":[x,y,z], "group":"..", "buoyant":bool}` (size = full extents; center defaults to com,
    /// com to center, both to the origin)
    pub fn from_json(s: &str) -> Result<PropDef, String> {
        let j = Json::parse(s)?;
        let v3 = |k: &str| -> Option<Vec3> {
            let a = j.get(k)?.arr()?;
            Some(Vec3::new(a.first()?.num()? as f32, a.get(1)?.num()? as f32, a.get(2)?.num()? as f32))
        };
        let kind = j.s("kind", j.s("shape", "box"));
        let size = j.get("size");
        let shape = match kind {
            "cylinder" | "cyl" => {
                let (r, h) = match size {
                    Some(Json::Arr(a)) if a.len() == 2 => (a[0].num().unwrap_or(0.05) as f32, a[1].num().unwrap_or(0.1) as f32),
                    Some(Json::Arr(a)) if a.len() >= 3 => {
                        let n = |k: usize| a[k].num().unwrap_or(0.1) as f32;
                        (n(0).max(n(2)) * 0.5, n(1))
                    }
                    Some(o) => (o.f("r", 0.05) as f32, o.f("h", 0.1) as f32),
                    None => (0.05, 0.1),
                };
                Shape::Cyl(r.max(0.005), h.max(0.005))
            }
            "box" => {
                let s = v3("size").unwrap_or(Vec3::splat(0.1));
                Shape::Box((s * 0.5).max(Vec3::splat(0.0025)))
            }
            k => return Err(format!("unknown prop kind '{k}'")),
        };
        let center = v3("center").or(v3("com")).unwrap_or(Vec3::ZERO);
        let com = v3("com").unwrap_or(center);
        let mass = (j.f("mass", 0.3) as f32).clamp(0.005, 50.0);
        let group = j.s("group", "").to_string();
        let flag = |k: &str| matches!(j.get(k), Some(Json::Bool(true)));
        let (buoyant, seat, on_body) = (flag("buoyant"), flag("seat"), flag("onBody"));
        if !(center.is_finite() && com.is_finite() && mass.is_finite()) {
            return Err("non-finite prop".into());
        }
        Ok(PropDef { shape, mass, center, com, group, buoyant, seat, on_body })
    }
}

#[derive(Clone)]
struct Prop {
    id: String,
    def: PropDef,
    state: f32,
    rest: Mat4,
    // simulation (scaled by the rest scale at wake time)
    sh: Shape,
    /// collider centre relative to the centre of mass (body frame, scaled)
    c_off: Vec3,
    /// object origin relative to the centre of mass (body frame, scaled)
    o_off: Vec3,
    scale: Vec3,
    inv_m: f32,
    inv_i: Vec3,
    /// world inverse inertia (R diag(inv_i) R^T), refreshed whenever `q` changes
    iw_m: Mat3,
    pts: Vec<Vec3>,
    x: Vec3,
    q: Quat,
    v: Vec3,
    w: Vec3,
    // impulse gathered while attached
    acc_j: Vec3,
    acc_l: Vec3,
    slow_t: f32,
    hit_cd: f32,
    hit_max: f32,
    on_floor: bool,
    // return flight
    ret_t: f32,
    ret_p: Vec3,
    ret_q: Quat,
    ret_s: Vec3,
    /// sample points of the attached collider (object-local), for kinematic pushes
    rest_pts: Vec<Vec3>,
    /// small offset from the socket while attached (world translation, yaw about the rest com)
    nudge_p: Vec3,
    nudge_yaw: f32,
    nudge_t: f32,
    /// he sits on it: water / paper / bumps leave it alone
    occupied: bool,
    /// seconds left ignoring the character's colliders (just kicked out from under him)
    ghost: f32,
}

/// world-space view of a collider for hit tests
#[derive(Clone, Copy)]
struct Frame {
    fwd: Mat4,
    inv: Mat4,
    shape: Shape,
    /// world units per local unit (depth conversion)
    s: f32,
    lo: Vec3,
    hi: Vec3,
}

impl Frame {
    fn new(fwd: Mat4, shape: Shape, s: f32) -> Frame {
        let h = shape.half();
        let c = fwd.w_axis.truncate();
        let e = fwd.x_axis.truncate().abs() * h.x + fwd.y_axis.truncate().abs() * h.y + fwd.z_axis.truncate().abs() * h.z;
        Frame { fwd, inv: fwd.inverse(), shape, s, lo: c - e, hi: c + e }
    }
    /// rotation + translation only (dynamic bodies): cheap inverse
    fn rigid(q: Quat, t: Vec3, shape: Shape) -> Frame {
        let fwd = Mat4::from_rotation_translation(q, t);
        let qi = q.inverse();
        let inv = Mat4::from_rotation_translation(qi, -(qi * t));
        let h = shape.half();
        let e = fwd.x_axis.truncate().abs() * h.x + fwd.y_axis.truncate().abs() * h.y + fwd.z_axis.truncate().abs() * h.z;
        Frame { fwd, inv, shape, s: 1.0, lo: t - e, hi: t + e }
    }
    /// world point inside the collider (+ margin in world units) -> (world normal, world depth)
    #[inline]
    fn contact(&self, p: Vec3, margin: f32) -> Option<(Vec3, f32)> {
        if p.cmplt(self.lo - Vec3::splat(margin)).any() || p.cmpgt(self.hi + Vec3::splat(margin)).any() {
            return None;
        }
        let (n, d) = self.shape.contact(self.inv.transform_point3(p), margin / self.s)?;
        Some((self.fwd.transform_vector3(n).normalize_or_zero(), d * self.s))
    }
}

impl Prop {
    fn rest_com(&self) -> Vec3 {
        self.rest.transform_point3(self.def.com)
    }
    #[inline]
    fn iw(&self, v: Vec3) -> Vec3 {
        self.iw_m * v
    }
    fn refresh_iw(&mut self) {
        let r = Mat3::from_quat(self.q);
        self.iw_m = r * Mat3::from_diagonal(self.inv_i) * r.transpose();
    }
    #[inline]
    fn vel_at(&self, r: Vec3) -> Vec3 {
        if self.state == DYNAMIC || self.state == SETTLED {
            self.v + self.w.cross(r)
        } else {
            Vec3::ZERO
        }
    }
    #[inline]
    fn apply(&mut self, j: Vec3, r: Vec3) {
        self.v += j * self.inv_m;
        self.w += self.iw(r.cross(j));
    }
    fn frame(&self) -> Frame {
        if self.state == REST {
            let m = &self.rest;
            let s = (m.x_axis.truncate().length() + m.y_axis.truncate().length() + m.z_axis.truncate().length()) / 3.0;
            Frame::new(*m * Mat4::from_translation(self.def.center), self.def.shape, s.max(1e-4))
        } else {
            Frame::rigid(self.q, self.x + self.q * self.c_off, self.sh)
        }
    }
    /// impulse `j` at world point `at` from water / paper / another body
    fn hit(&mut self, j: Vec3, at: Vec3) {
        if self.state == REST {
            let c = self.rest_com();
            self.acc_j += j;
            self.acc_l += (at - c).cross(j);
        } else if self.state == DYNAMIC || self.state == SETTLED {
            let r = at - self.x;
            self.apply(j, r);
            if self.state == SETTLED && (j.length() * self.inv_m > 0.05) {
                self.state = DYNAMIC;
                self.slow_t = 0.0;
            }
        }
    }
    /// pure angular impulse (about the centre of mass)
    fn spin(&mut self, l: Vec3) {
        if self.state == REST {
            self.acc_l += l;
        } else if self.state == DYNAMIC || self.state == SETTLED {
            self.w += self.iw(l);
        }
    }
    /// attached -> simulated, from the rest pose
    fn wake(&mut self) {
        let (s, r, _) = self.rest.to_scale_rotation_translation();
        let s = if s.is_finite() && s.min_element().abs() > 1e-4 { s } else { Vec3::ONE };
        self.scale = s;
        self.sh = self.def.shape.scaled(s);
        self.c_off = (self.def.center - self.def.com) * s;
        self.o_off = -self.def.com * s;
        self.x = self.rest_com();
        self.q = r.normalize();
        self.inv_m = 1.0 / self.def.mass;
        self.inv_i = self.sh.inertia(self.def.mass).recip();
        self.q = r.normalize();
        self.refresh_iw();
        let mut pts = std::mem::take(&mut self.pts);
        self.sh.samples(&mut pts);
        for p in pts.iter_mut() {
            *p += self.c_off;
        }
        self.pts = pts;
        self.v = Vec3::ZERO;
        self.w = Vec3::ZERO;
        let (j, l) = (self.acc_j, self.acc_l);
        self.acc_j = Vec3::ZERO;
        self.acc_l = Vec3::ZERO;
        self.v += j * self.inv_m;
        self.w += self.iw(l);
        self.state = DYNAMIC;
        self.slow_t = 0.0;
        self.on_floor = false;
        self.nudge_p = Vec3::ZERO;
        self.nudge_yaw = 0.0;
    }
    /// world matrix of the object origin now
    fn pose(&self) -> (Vec3, Quat, Vec3) {
        if self.state == REST {
            let (s, r, t) = self.rest.to_scale_rotation_translation();
            (t, r, s)
        } else if self.state == RETURNING {
            let (s1, r1, t1) = self.rest.to_scale_rotation_translation();
            let u = self.ret_t.clamp(0.0, 1.0);
            let e = u * u * (3.0 - 2.0 * u);
            // a little hop on the way back (small for short returns, e.g. a chair that only slid a bit)
            let hop = (u * std::f32::consts::PI).sin() * (self.ret_p.distance(t1) * 0.5).min(0.12);
            let pop = 1.0 + 0.18 * crate::util::smooth(0.7, 0.85, u) * (1.0 - crate::util::smooth(0.85, 1.0, u));
            (self.ret_p.lerp(t1, e) + Vec3::Y * hop, self.ret_q.slerp(r1, e), self.ret_s.lerp(s1, e) * pop)
        } else {
            (self.x + self.q * self.o_off, self.q, self.scale)
        }
    }
}

/// one contact of a body with the static world
#[derive(Clone, Copy)]
struct Contact {
    r: Vec3,
    n: Vec3,
    /// surface velocity (kinematic character)
    vs: Vec3,
    /// normal effective mass^-1, target separating speed (restitution)
    k: f32,
    kt: f32,
    bounce: f32,
    jn: f32,
    jt: Vec3,
}

const SOLVER_ITERS: usize = 4;
const MAX_CONTACTS: usize = 24;
/// penetration left alone by the position correction (no jitter / energy gain on resting contact)
const SLOP: f32 = 0.0015;

/// Sequential impulses with accumulated, clamped normal + friction impulses (stable resting contact).
/// Returns the highest approach speed.
fn solve_static(b: &mut Prop, cs: &mut [Contact]) -> f32 {
    let mut impact = 0.0f32;
    for c in cs.iter_mut() {
        let vn = (b.v + b.w.cross(c.r) - c.vs).dot(c.n);
        c.k = b.inv_m + c.n.dot(b.iw(c.r.cross(c.n)).cross(c.r));
        // tangential effective mass ~ the mean over directions (close enough for friction)
        c.kt = b.inv_m + 0.5 * (b.iw_m.x_axis.x + b.iw_m.y_axis.y + b.iw_m.z_axis.z) * c.r.length_squared() * (2.0 / 3.0);
        c.bounce = if -vn > 0.6 { -vn * RESTITUTION } else { 0.0 };
        impact = impact.max(-vn);
    }
    for _ in 0..SOLVER_ITERS {
        for c in cs.iter_mut() {
            let vp = b.v + b.w.cross(c.r) - c.vs;
            let vn = vp.dot(c.n);
            let dj = (c.bounce - vn) / c.k;
            let jn = (c.jn + dj).max(0.0);
            let dj = jn - c.jn;
            c.jn = jn;
            b.apply(c.n * dj, c.r);
            // friction (clamped to the friction cone of the accumulated normal impulse)
            let vp = b.v + b.w.cross(c.r) - c.vs;
            let vt = vp - c.n * vp.dot(c.n);
            let lt = vt.length();
            if lt > 1e-7 {
                let t = vt / lt;
                let mut jt = c.jt - t * (lt / c.kt);
                let lim = FRICTION * c.jn;
                if jt.length() > lim {
                    jt = jt.normalize_or_zero() * lim;
                }
                let d = jt - c.jt;
                c.jt = jt;
                b.apply(d, c.r);
            }
        }
    }
    impact
}

pub struct Props {
    slots: Vec<Option<Prop>>,
    /// rest matrices (column-major, MAX_PROPS x 16): JS may write them directly every frame
    pub rest_buf: Vec<f32>,
    /// MAX_PROPS x PROP_STRIDE, see the module docs
    pub out: Vec<f32>,
    /// seconds a knocked-over group rests before it flies back (0 = never)
    pub reset_after: f32,
    /// false = props stay attached (no hits)
    pub enabled: bool,
    pub events: Vec<String>,
    time: f32,
    stream: [StreamSample; 16],
    tmp_frames: Vec<Option<Frame>>,
}

impl Default for Props {
    fn default() -> Self {
        Self::new()
    }
}

impl Props {
    pub fn new() -> Self {
        let mut out = vec![0.0; MAX_PROPS * PROP_STRIDE];
        for k in 0..MAX_PROPS {
            out[k * PROP_STRIDE] = EMPTY;
        }
        let mut rest_buf = vec![0.0; MAX_PROPS * 16];
        for k in 0..MAX_PROPS {
            rest_buf[k * 16..k * 16 + 16].copy_from_slice(&Mat4::IDENTITY.to_cols_array());
        }
        Self {
            slots: Vec::new(),
            rest_buf,
            out,
            reset_after: 8.0,
            enabled: true,
            events: Vec::new(),
            time: 0.0,
            stream: [StreamSample::default(); 16],
            tmp_frames: Vec::new(),
        }
    }

    /// register (or replace) a prop; returns its slot, or -1 (bad shape / full)
    pub fn register(&mut self, id: &str, def: PropDef, rest: Mat4) -> i32 {
        let slot = match self.index(id) {
            Some(k) => k,
            None => match self.slots.iter().position(|s| s.is_none()) {
                Some(k) => k,
                None if self.slots.len() < MAX_PROPS => {
                    self.slots.push(None);
                    self.slots.len() - 1
                }
                None => return -1,
            },
        };
        let rest = if rest.is_finite() { rest } else { Mat4::IDENTITY };
        self.slots[slot] = Some(Prop {
            id: id.to_string(),
            def: def.clone(),
            state: REST,
            rest,
            sh: def.shape,
            c_off: Vec3::ZERO,
            o_off: Vec3::ZERO,
            scale: Vec3::ONE,
            inv_m: 1.0 / def.mass,
            inv_i: Vec3::ONE,
            iw_m: Mat3::IDENTITY,
            pts: Vec::with_capacity(22),
            x: Vec3::ZERO,
            q: Quat::IDENTITY,
            v: Vec3::ZERO,
            w: Vec3::ZERO,
            acc_j: Vec3::ZERO,
            acc_l: Vec3::ZERO,
            slow_t: 0.0,
            hit_cd: 0.0,
            hit_max: 0.0,
            on_floor: false,
            ret_t: 0.0,
            ret_p: Vec3::ZERO,
            ret_q: Quat::IDENTITY,
            ret_s: Vec3::ONE,
            rest_pts: {
                let mut v = Vec::new();
                def.shape.samples(&mut v);
                v.iter().map(|p| *p + def.center).collect()
            },
            nudge_p: Vec3::ZERO,
            nudge_yaw: 0.0,
            nudge_t: 0.0,
            occupied: false,
            ghost: 0.0,
        });
        self.rest_buf[slot * 16..slot * 16 + 16].copy_from_slice(&rest.to_cols_array());
        self.write_out();
        slot as i32
    }
    pub fn unregister(&mut self, id: &str) -> bool {
        let Some(k) = self.index(id) else { return false };
        self.slots[k] = None;
        while self.slots.last().is_some_and(|s| s.is_none()) {
            self.slots.pop();
        }
        self.write_out();
        true
    }
    pub fn clear(&mut self) {
        self.slots.clear();
        self.write_out();
    }
    pub fn index(&self, id: &str) -> Option<usize> {
        self.slots.iter().position(|s| s.as_ref().is_some_and(|p| p.id == id))
    }
    /// slots in use (highest used slot + 1); `out` is valid for `0..count()`
    /* ------------------------------------------------------------ furniture he sits on */
    /// slot of the first `seat` prop (furniture on floor_under)
    pub fn seat(&self) -> Option<usize> {
        self.slots.iter().position(|s| s.as_ref().is_some_and(|p| p.def.seat))
    }
    /// attached to its socket (rest or nudged): he can sit on it
    pub fn is_free(&self, slot: usize) -> bool {
        self.slots.get(slot).and_then(|s| s.as_ref()).is_some_and(|p| p.state == REST)
    }
    pub fn mass(&self, slot: usize) -> f32 {
        self.slots.get(slot).and_then(|s| s.as_ref()).map_or(1.0, |p| p.def.mass)
    }
    pub fn id(&self, slot: usize) -> Option<&str> {
        self.slots.get(slot).and_then(|s| s.as_ref()).map(|p| p.id.as_str())
    }
    /// he sits on it (true): water / paper / bumps leave it alone, nudges do not ease back
    pub fn set_occupied(&mut self, slot: usize, on: bool) {
        if let Some(Some(p)) = self.slots.get_mut(slot) {
            p.occupied = on;
        }
    }
    /// shift an attached prop a little off its socket (world translation + yaw about its centre)
    pub fn nudge(&mut self, slot: usize, dp: Vec3, dyaw: f32) {
        if let Some(Some(p)) = self.slots.get_mut(slot) {
            if p.state == REST {
                p.nudge_p += Vec3::new(dp.x, 0.0, dp.z);
                p.nudge_yaw += dyaw;
                p.nudge_t = 0.0;
            }
        }
    }
    /// throw a prop: wakes it (and its group) and sets its velocity / spin (world)
    pub fn launch(&mut self, slot: usize, v: Vec3, w: Vec3) {
        let Some(Some(p)) = self.slots.get(slot) else { return };
        if p.state == REST {
            self.wake_group(slot);
        }
        if let Some(Some(p)) = self.slots.get_mut(slot) {
            if p.state == DYNAMIC || p.state == SETTLED {
                p.state = DYNAMIC;
                p.v = v;
                p.w = w;
                p.slow_t = 0.0;
                p.ghost = 0.3;
                if p.hit_cd <= 0.0 {
                    self.events.push(format!("prop_hit:{}:{:.2}", p.id, v.length()));
                    p.hit_cd = 0.15;
                }
            }
        }
    }

    /// world box around every prop as of the last step (+ margin): what water / paper could hit
    pub fn bounds(&self) -> Option<(Vec3, Vec3)> {
        let mut b: Option<(Vec3, Vec3)> = None;
        for f in self.tmp_frames.iter().flatten() {
            b = Some(match b {
                Some((lo, hi)) => (lo.min(f.lo), hi.max(f.hi)),
                None => (f.lo, f.hi),
            });
        }
        if b.is_none() && !self.slots.is_empty() {
            return Some((Vec3::splat(-1e6), Vec3::splat(1e6)));
        }
        b.map(|(lo, hi)| (lo - Vec3::splat(0.3), hi + Vec3::splat(0.3)))
    }
    pub fn count(&self) -> usize {
        self.slots.len()
    }
    /// props that are not attached (dynamic, resting on the floor or flying back)
    pub fn active(&self) -> usize {
        self.slots.iter().flatten().filter(|p| p.state != REST).count()
    }
    pub fn state(&self, slot: usize) -> f32 {
        self.slots.get(slot).and_then(|s| s.as_ref()).map_or(EMPTY, |p| p.state)
    }
    pub fn set_rest(&mut self, slot: usize, m: &[f32]) {
        if slot < MAX_PROPS && m.len() >= 16 {
            self.rest_buf[slot * 16..slot * 16 + 16].copy_from_slice(&m[..16]);
        }
    }
    /// `{"resetAfter": s, "enabled": bool}` (missing keys keep their value)
    pub fn configure(&mut self, json: &str) {
        let Ok(j) = Json::parse(json) else { return };
        if let Some(v) = j.opt_f("resetAfter") {
            self.reset_after = if v.is_finite() { (v as f32).max(0.0) } else { 8.0 };
        }
        if let Some(Json::Bool(b)) = j.get("enabled") {
            self.enabled = *b;
        }
    }
    /// debug / tests: push a prop with an impulse (N s) at its centre of mass (+ an offset)
    pub fn kick(&mut self, slot: usize, j: Vec3, offset: Vec3) {
        if let Some(Some(p)) = self.slots.get_mut(slot) {
            let at = if p.state == REST { p.rest_com() } else { p.x } + offset;
            p.hit(j, at);
            if p.state == REST {
                self.wake_group(slot);
            }
        }
    }

    fn wake_group(&mut self, slot: usize) {
        let Some(Some(p)) = self.slots.get_mut(slot) else { return };
        p.wake();
        let g = p.def.group.clone();
        if g.is_empty() {
            return;
        }
        for q in self.slots.iter_mut().flatten() {
            if q.state == REST && q.def.group == g {
                q.wake();
            }
        }
    }

    /// One frame: hits (drops, column, paper strips, bodies), wake-ups, dynamics, settle / return.
    pub fn step(&mut self, dt: f32, env: &Env, jet: &mut WaterJet, hash: &mut DropHash, strips: [&mut PaperStrip; 2]) {
        if self.slots.is_empty() || dt <= 0.0 {
            return;
        }
        self.time += dt;
        for (k, s) in self.slots.iter_mut().enumerate() {
            if let Some(p) = s {
                let m = Mat4::from_cols_slice(&self.rest_buf[k * 16..k * 16 + 16]);
                if m.is_finite() {
                    p.rest = m;
                    if p.nudge_p != Vec3::ZERO || p.nudge_yaw != 0.0 {
                        let c = m.transform_point3(p.def.com);
                        p.rest = Mat4::from_translation(p.nudge_p + c) * Mat4::from_rotation_y(p.nudge_yaw) * Mat4::from_translation(-c) * m;
                    }
                }
                p.hit_cd -= dt;
                p.hit_max = 0.0;
            }
        }
        if self.enabled {
            self.hits(dt, jet, hash, strips);
            self.bumps(env);
            // wake-ups from gathered impulse
            for k in 0..self.slots.len() {
                let wake = match &mut self.slots[k] {
                    Some(p) if p.state == REST => {
                        let inv_i = p.def.shape.inertia(p.def.mass).recip();
                        let (_, r, _) = p.rest.to_scale_rotation_translation();
                        let dw = r * (inv_i * (r.inverse() * p.acc_l));
                        let w = p.acc_j.length() / p.def.mass > WAKE_DV || dw.length() > WAKE_DW;
                        if !w {
                            let k = (-3.0 * dt).exp();
                            p.acc_j *= k;
                            p.acc_l *= k;
                        }
                        w
                    }
                    _ => false,
                };
                if wake {
                    self.wake_group(k);
                }
            }
            let h = dt / SUBSTEPS as f32;
            for i in 0..SUBSTEPS {
                self.substep(h, env, i + 1 == SUBSTEPS);
            }
        }
        self.settle(dt, env);
        self.write_out();
    }

    fn hits(&mut self, dt: f32, jet: &mut WaterJet, hash: &mut DropHash, strips: [&mut PaperStrip; 2]) {
        let ns = jet.stream_samples(&mut self.stream);
        let mdot = STREAM_MDOT * jet.stream_amount();
        self.tmp_frames.clear();
        for s in self.slots.iter() {
            self.tmp_frames.push(s.as_ref().filter(|p| p.state != RETURNING).map(|p| p.frame()));
        }
        for k in 0..self.slots.len() {
            let Some(p) = self.slots[k].as_mut() else { continue };
            let Some(f) = self.tmp_frames[k] else { continue };
            if p.occupied && p.state == REST {
                continue;
            }
            // drops: bounce off, push
            if hash.overlaps(f.lo, f.hi) {
                hash.query(f.lo - Vec3::splat(0.01), f.hi + Vec3::splat(0.01), |i| {
                    let Some((dp, dv, size)) = jet.drop_state(i) else { return };
                    let Some((n, d)) = f.contact(dp, 0.004) else { return };
                    let rel = dv - p.vel_at(dp - p.x);
                    let vn = rel.dot(n);
                    if vn >= 0.0 {
                        return;
                    }
                    let vt = rel - n * vn;
                    let dvel = -n * (1.2 * vn) - vt * 0.3;
                    let mut j = -dvel * (DROP_MASS * size);
                    if p.def.buoyant {
                        j.y += j.length() * 0.4;
                    }
                    p.hit(j, dp);
                    if p.def.buoyant {
                        p.spin(Vec3::Y * (j.length() * 0.04));
                    }
                    jet.set_drop(i, dp + n * d, dv + dvel);
                });
            }
            // the water column: the first sample that hits takes the whole flow (the prop is in the way),
            // scaled by how much of the column's width it covers
            for s in &self.stream[..ns] {
                if s.p.cmplt(f.lo - Vec3::splat(s.r)).any() || s.p.cmpgt(f.hi + Vec3::splat(s.r)).any() {
                    continue;
                }
                if let Some((n, _)) = f.contact(s.p, s.r) {
                    let rel = s.v - p.vel_at(s.p - p.x);
                    if rel.dot(n) < 0.0 {
                        let e = f.hi - f.lo;
                        let cover = (e.x.min(e.z) / (2.0 * s.r).max(1e-3)).min(1.0);
                        let mut j = rel * (mdot * cover * dt);
                        if p.def.buoyant {
                            j.y += j.length() * 0.3;
                            p.spin(Vec3::Y * (j.length() * 0.04));
                        }
                        p.hit(j, s.p);
                        break;
                    }
                }
            }
        }
        // paper strip points: pushed out of the prop, and push it with their momentum
        for strip in strips {
            let n = strip.pts.len();
            if n < 2 {
                continue;
            }
            let start = usize::from(strip.anchored);
            let (lo, hi) = strip.pts[start..].iter().fold((Vec3::splat(f32::MAX), Vec3::splat(f32::MIN)), |(a, b), o| (a.min(o.p), b.max(o.p)));
            for k in 0..self.slots.len() {
                let Some(p) = self.slots[k].as_mut() else { continue };
                let Some(f) = self.tmp_frames[k] else { continue };
                if hi.cmplt(f.lo - Vec3::splat(0.01)).any() || lo.cmpgt(f.hi + Vec3::splat(0.01)).any() {
                    continue;
                }
                for o in strip.pts[start..].iter_mut() {
                    let Some((mut nrm, mut d)) = f.contact(o.p, 0.006) else { continue };
                    if nrm.y < -0.3 && o.p.y < 0.08 {
                        // never push paper down into the floor under the prop: out sideways instead
                        let c = (f.lo + f.hi) * 0.5;
                        let side = Vec3::new(o.p.x - c.x, 0.0, o.p.z - c.z);
                        nrm = if side.length_squared() > 1e-8 { side.normalize() } else { Vec3::X };
                        let ext = (f.hi - f.lo) * 0.5;
                        d = 0.0;
                        for _ in 0..8 {
                            if f.contact(o.p + nrm * d, 0.006).is_none() {
                                break;
                            }
                            d += ext.x.max(ext.z) * 0.25;
                        }
                    }
                    let vp = (o.p - o.q) / dt;
                    let vb = p.vel_at(o.p - p.x);
                    let rel = vp - vb;
                    let vn = rel.dot(nrm);
                    o.p += nrm * d;
                    if vn < 0.0 {
                        let vt = rel - nrm * vn;
                        let m = PAPER_PUSH_MASS * (1.0 + 2.0 * o.wet);
                        p.hit((nrm * vn + vt * 0.3) * m, o.p);
                        let v2 = vb + vt * 0.7;
                        o.q = o.p - v2 * dt;
                    } else {
                        o.q += nrm * d;
                    }
                }
            }
        }
    }

    /// the moving character bumps attached floor props (kinematic push from its surface velocity)
    fn bumps(&mut self, env: &Env) {
        if !(env.character || env.ncaps > 0) || env.inv_dt <= 0.0 {
            return;
        }
        for k in 0..self.slots.len() {
            let Some(p) = self.slots[k].as_mut() else { continue };
            // furniture overlaps him by design (he stands / sits where it is): only the rig moves it while attached
            if p.state != REST || p.def.on_body || p.occupied || p.def.seat {
                continue;
            }
            let Some(f) = self.tmp_frames.get(k).copied().flatten() else { continue };
            let mask = env.mask(f.lo, f.hi);
            if mask == 0 {
                continue;
            }
            let (mut best, mut at, mut n) = (0.0f32, Vec3::ZERO, Vec3::ZERO);
            let mut vt = Vec3::ZERO;
            for lp in &p.rest_pts {
                let pw = p.rest.transform_point3(*lp);
                let Some(h) = env.contact(pw, mask) else { continue };
                let vn = h.v.dot(h.n);
                if vn > best {
                    best = vn;
                    at = pw;
                    n = h.n;
                    vt = h.v - h.n * vn;
                }
            }
            if best > 0.05 {
                let m = p.def.mass;
                p.hit((n * (best * (1.0 + RESTITUTION)) + vt * FRICTION) * m, at);
                p.hit_max = p.hit_max.max(best);
            }
        }
    }

    fn substep(&mut self, h: f32, env: &Env, pairs: bool) {
        let n = self.slots.len();
        // integrate + floor / character
        for p in self.slots.iter_mut().flatten() {
            if p.state != DYNAMIC {
                continue;
            }
            p.v.y -= G * h;
            p.x += p.v * h;
            let wq = Quat::from_xyzw(p.w.x, p.w.y, p.w.z, 0.0) * p.q;
            p.q = Quat::from_xyzw(p.q.x + wq.x * 0.5 * h, p.q.y + wq.y * 0.5 * h, p.q.z + wq.z * 0.5 * h, p.q.w + wq.w * 0.5 * h).normalize();
            p.refresh_iw();
            let mut corr = Vec3::ZERO;
            let mut nc = 0;
            let mut floor = false;
            let mut cs = [Contact { r: Vec3::ZERO, n: Vec3::Y, vs: Vec3::ZERO, k: 1.0, kt: 1.0, bounce: 0.0, jn: 0.0, jt: Vec3::ZERO }; MAX_CONTACTS];
            let f = Frame::rigid(p.q, p.x + p.q * p.c_off, p.sh);
            let near = if p.ghost > 0.0 { 0 } else { env.mask(f.lo, f.hi) };
            if near == 0 && f.lo.y > 0.0 {
                // in the air, away from him: nothing to touch
                p.on_floor = false;
                p.w *= 1.0 / (1.0 + 0.6 * h);
                continue;
            }
            for i in 0..p.pts.len() {
                let r = p.q * p.pts[i];
                let pw = p.x + r;
                let c = if near != 0 { env.contact(pw, near) } else { (pw.y < 0.0).then_some(EnvHit { n: Vec3::Y, d: -pw.y, v: Vec3::ZERO }) };
                let Some(EnvHit { n: nrm, d, v: vs }) = c else { continue };
                if nc < MAX_CONTACTS {
                    cs[nc].r = r;
                    cs[nc].n = nrm;
                    cs[nc].vs = vs;
                }
                corr += nrm * (d - SLOP).max(0.0);
                nc += 1;
                floor |= nrm.y > 0.7 && pw.y < 0.02;
            }
            if nc > 0 {
                let s = solve_static(p, &mut cs[..nc.min(MAX_CONTACTS)]);
                p.hit_max = p.hit_max.max(s);
                p.x += corr / nc as f32 * 0.5;
                // rolling resistance
                p.w *= 1.0 / (1.0 + if p.v.length() < 0.2 { 10.0 } else { 3.0 } * h);
            }
            p.on_floor = floor;
            if floor && p.v.length() < 0.06 && p.w.length() < 0.8 && !(p.def.buoyant && env.puddle[4] > 0.1) {
                // low-speed rolling / sliding friction: come to rest instead of creeping forever
                p.v *= 1.0 / (1.0 + 12.0 * h);
                p.w *= 1.0 / (1.0 + 18.0 * h);
            }
            p.w *= 1.0 / (1.0 + 0.6 * h);
            // the duck floats and turns in the puddle
            if p.def.buoyant && floor && env.puddle[4] > 0.1 {
                let (ux, uz) = ((p.x.x - env.puddle[0]) / env.puddle[2].max(1e-3), (p.x.z - env.puddle[1]) / env.puddle[3].max(1e-3));
                if ux * ux + uz * uz < 1.0 {
                    let a = env.puddle[4];
                    p.w.y += (1.6 * a - p.w.y) * (2.0 * h).min(1.0);
                    p.v.y += (self.time * 5.0).sin().max(0.0) * 1.2 * a * h;
                }
            }
        }
        // body vs body
        if !pairs || !self.slots.iter().flatten().any(|p| p.state == DYNAMIC) {
            return;
        }
        // body vs body once per frame. Collider frames: attached ones come from hits() (rest poses do not change within a frame),
        // the moving ones are refreshed every sub-step
        self.tmp_frames.resize(n, None);
        for (k, s) in self.slots.iter().enumerate() {
            self.tmp_frames[k] = match s {
                Some(p) if p.state == RETURNING => None,
                Some(p) if p.state != REST || self.tmp_frames[k].is_none() => Some(p.frame()),
                Some(_) => self.tmp_frames[k],
                None => None,
            };
        }
        for a in 0..n {
            for b in a + 1..n {
                let (Some(fa), Some(fb)) = (self.tmp_frames[a], self.tmp_frames[b]) else { continue };
                if fa.hi.cmplt(fb.lo).any() || fb.hi.cmplt(fa.lo).any() {
                    continue;
                }
                let (left, right) = self.slots.split_at_mut(b);
                let (Some(pa), Some(pb)) = (left[a].as_mut(), right[0].as_mut()) else { continue };
                let dyn_a = pa.state == DYNAMIC || pa.state == SETTLED;
                let dyn_b = pb.state == DYNAMIC || pb.state == SETTLED;
                if !(pa.state == DYNAMIC || pb.state == DYNAMIC) {
                    continue;
                }
                if dyn_a {
                    pair(pa, pb, &fb, dyn_b);
                }
                if dyn_b {
                    pair(pb, pa, &fa, dyn_a);
                }
            }
        }
    }

    fn settle(&mut self, dt: f32, _env: &Env) {
        let reset = self.reset_after;
        for p in self.slots.iter_mut().flatten() {
            p.ghost = (p.ghost - dt).max(0.0);
            if p.hit_max > HIT_EVENT_SPEED && p.hit_cd <= 0.0 {
                self.events.push(format!("prop_hit:{}:{:.2}", p.id, p.hit_max));
                p.hit_cd = 0.15;
            }
            match p.state {
                s if s == DYNAMIC || s == SETTLED => {
                    let spin = if p.def.buoyant { Vec3::new(p.w.x, 0.0, p.w.z).length() } else { p.w.length() };
                    if p.v.length() < 0.08 && spin < 0.5 {
                        p.slow_t += dt;
                    } else {
                        p.slow_t = 0.0;
                    }
                    if p.state == DYNAMIC && p.on_floor && p.slow_t > SLEEP_TIME && p.v.length() < 0.04 && p.w.length() < 0.3 {
                        p.state = SETTLED;
                        p.v = Vec3::ZERO;
                        p.w = Vec3::ZERO;
                    }
                    // lost (fell off the world / blown away): straight back
                    if !p.x.is_finite() || p.x.y < -1.0 || p.x.length() > 25.0 {
                        if !p.x.is_finite() {
                            p.x = p.rest_com();
                            p.q = Quat::IDENTITY;
                            p.refresh_iw();
                        }
                        p.slow_t = f32::MAX;
                    }
                    if p.state == SETTLED {
                        // asleep: small nudges do not accumulate
                        p.v = Vec3::ZERO;
                        p.w = Vec3::ZERO;
                    }
                }
                s if s == REST => {
                    // a nudge eases back to the socket after resting `reset_after` s (not while he sits on it)
                    if p.nudge_p != Vec3::ZERO || p.nudge_yaw != 0.0 {
                        p.nudge_t += dt;
                        if reset > 0.0 && p.nudge_t > reset && !p.occupied {
                            let k = 1.0 - (3.0 * dt).min(1.0);
                            p.nudge_p *= k;
                            p.nudge_yaw *= k;
                            if p.nudge_p.length() < 1e-4 && p.nudge_yaw.abs() < 1e-3 {
                                p.nudge_p = Vec3::ZERO;
                                p.nudge_yaw = 0.0;
                            }
                        }
                    }
                }
                s if s == RETURNING => {
                    p.ret_t += dt / RETURN_TIME;
                    if p.ret_t >= 1.0 {
                        p.state = REST;
                        p.acc_j = Vec3::ZERO;
                        p.acc_l = Vec3::ZERO;
                        self.events.push(format!("prop_reset:{}", p.id));
                    }
                }
                _ => {}
            }
        }
        // groups fly back together once every loose member has rested long enough (reset 0: only lost ones)
        let n = self.slots.len();
        for k in 0..n {
            let ready = |p: &Prop| p.slow_t >= if reset > 0.0 { reset } else { f32::MAX };
            let Some(p) = self.slots[k].as_ref() else { continue };
            if !(p.state == DYNAMIC || p.state == SETTLED) || !ready(p) {
                continue;
            }
            let g = p.def.group.clone();
            let all = g.is_empty()
                || self.slots.iter().flatten().filter(|q| q.def.group == g && (q.state == DYNAMIC || q.state == SETTLED)).all(ready)
                || p.slow_t == f32::MAX;
            if !all {
                continue;
            }
            for (i, q) in self.slots.iter_mut().enumerate() {
                let Some(q) = q else { continue };
                let same = i == k || (!g.is_empty() && q.def.group == g);
                if same && (q.state == DYNAMIC || q.state == SETTLED) {
                    let (t, r, s) = q.pose();
                    q.ret_p = t;
                    q.ret_q = r;
                    q.ret_s = s;
                    q.ret_t = 0.0;
                    q.state = RETURNING;
                    q.nudge_p = Vec3::ZERO;
                    q.nudge_yaw = 0.0;
                    q.v = Vec3::ZERO;
                    q.w = Vec3::ZERO;
                }
            }
        }
    }

    fn write_out(&mut self) {
        for k in 0..MAX_PROPS {
            let o = &mut self.out[k * PROP_STRIDE..(k + 1) * PROP_STRIDE];
            match self.slots.get(k).and_then(|s| s.as_ref()) {
                None => {
                    o.fill(0.0);
                    o[0] = EMPTY;
                }
                Some(p) => {
                    let (t, r, s) = p.pose();
                    let sp = if p.state == DYNAMIC { p.v.length() } else { 0.0 };
                    let st = if p.state == REST && (p.nudge_p != Vec3::ZERO || p.nudge_yaw != 0.0) { NUDGED } else { p.state };
                    o.copy_from_slice(&[st, t.x, t.y, t.z, r.x, r.y, r.z, r.w, s.x, s.y, s.z, sp]);
                }
            }
        }
    }

    /// world-space centre of mass of a slot (tests / debug)
    pub fn com(&self, slot: usize) -> Option<Vec3> {
        let p = self.slots.get(slot)?.as_ref()?;
        Some(if p.state == REST { p.rest_com() } else { p.x })
    }
    /// world up axis of a slot's body (tests / debug)
    pub fn up(&self, slot: usize) -> Option<Vec3> {
        let p = self.slots.get(slot)?.as_ref()?;
        Some(if p.state == REST { p.rest.transform_vector3(Vec3::Y).normalize() } else { p.q * Vec3::Y })
    }
}

/// `a`'s sample points against `b`'s collider `fb`; `b` moves too when `b_dyn`, else it only gathers
/// the impulse (it may wake up next frame)
fn pair(a: &mut Prop, b: &mut Prop, fb: &Frame, b_dyn: bool) {
    let mut corr = Vec3::ZERO;
    let mut nc = 0;
    for i in 0..a.pts.len() {
        let ra = a.q * a.pts[i];
        let pw = a.x + ra;
        let Some((n, d)) = fb.contact(pw, 0.0) else { continue };
        let rb = pw - b.x;
        let vb = if b_dyn { b.v + b.w.cross(rb) } else { Vec3::ZERO };
        let rel = a.v + a.w.cross(ra) - vb;
        let vn = rel.dot(n);
        nc += 1;
        corr += n * d;
        if vn >= 0.0 {
            continue;
        }
        let mut k = a.inv_m + n.dot(a.iw(ra.cross(n)).cross(ra));
        if b_dyn {
            k += b.inv_m + n.dot(b.iw(rb.cross(n)).cross(rb));
        }
        let e = if -vn > 0.6 { RESTITUTION } else { 0.0 };
        let j = -(1.0 + e) * vn / k;
        let mut imp = n * j;
        let vt = rel - n * vn;
        let lt = vt.length();
        if lt > 1e-6 {
            imp -= vt / lt * (lt / k).min(FRICTION * j * 0.8);
        }
        a.apply(imp, ra);
        if b_dyn {
            b.apply(-imp, rb);
        } else {
            b.hit(-imp, pw);
        }
        a.hit_max = a.hit_max.max(-vn);
        b.hit_max = b.hit_max.max(-vn);
    }
    if nc > 0 {
        let c = corr / nc as f32 * 0.6;
        if b_dyn {
            let wa = a.inv_m / (a.inv_m + b.inv_m);
            a.x += c * wa;
            b.x -= c * (1.0 - wa);
        } else {
            a.x += c;
        }
        if a.state == SETTLED && a.v.length() > 0.05 {
            a.state = DYNAMIC;
            a.slow_t = 0.0;
        }
        if b.state == SETTLED && b.v.length() > 0.05 {
            b.state = DYNAMIC;
            b.slow_t = 0.0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const DT: f32 = 1.0 / 60.0;

    fn cyl_def(mass: f32) -> PropDef {
        PropDef::from_json(&format!(r#"{{"kind":"cylinder","size":{{"r":0.035,"h":0.17}},"mass":{mass},"com":[0,0.085,0]}}"#)).unwrap()
    }
    fn box_def(mass: f32) -> PropDef {
        PropDef::from_json(&format!(r#"{{"kind":"box","size":[0.12,0.12,0.12],"mass":{mass},"center":[0,0.06,0]}}"#)).unwrap()
    }
    fn step(props: &mut Props, jet: &mut WaterJet, hash: &mut DropHash, a: &mut PaperStrip, b: &mut PaperStrip) {
        jet.update(DT);
        hash.build(jet);
        props.step(DT, &Env::floor_only(), jet, hash, [a, b]);
    }
    fn empty_strips() -> (PaperStrip, PaperStrip) {
        let (mut a, mut b) = (PaperStrip::new(0.18), PaperStrip::new(0.18));
        a.pts.clear();
        b.pts.clear();
        (a, b)
    }

    #[test]
    fn json_shapes() {
        let c = cyl_def(0.25);
        assert_eq!(c.shape, Shape::Cyl(0.035, 0.17));
        assert_eq!(c.center, Vec3::new(0.0, 0.085, 0.0));
        let b = PropDef::from_json(r#"{"kind":"box","size":[0.2,0.1,0.3],"mass":2,"com":[0,0.03,0],"center":[0,0.05,0],"group":"s","buoyant":true}"#).unwrap();
        assert_eq!(b.shape, Shape::Box(Vec3::new(0.1, 0.05, 0.15)));
        assert!(b.buoyant && b.group == "s" && b.com.y == 0.03 && b.center.y == 0.05);
        assert!(PropDef::from_json(r#"{"kind":"sphere"}"#).is_err());
        assert!(PropDef::from_json("nope").is_err());
    }

    #[test]
    fn drop_stream_knocks_over_a_standing_cylinder() {
        let mut props = Props::new();
        let rest = Mat4::from_translation(Vec3::new(0.0, 0.0, 1.0));
        let k = props.register("spray", cyl_def(0.25), rest) as usize;
        let mut jet = WaterJet::new(5);
        jet.origin = Vec3::new(0.0, -1.0, 0.0);
        jet.mouth = Vec3::new(0.0, 0.5, 0.0);
        jet.dir = Vec3::new(0.0, 0.1, 1.0).normalize();
        jet.speed = 3.2;
        jet.emitting = true;
        let mut hash = DropHash::new(0.1);
        let (mut a, mut b) = empty_strips();
        let mut woke = false;
        for i in 0..240 {
            if i == 60 {
                jet.emitting = false;
            }
            step(&mut props, &mut jet, &mut hash, &mut a, &mut b);
            woke |= props.state(k) != REST;
        }
        assert!(woke, "the water woke it");
        let up = props.up(k).unwrap();
        let c = props.com(k).unwrap();
        assert!(up.y < 0.5, "tipped over: up {up}");
        assert!(c.y < 0.06 && c.y > 0.0, "lying on the floor: com {c}");
        assert!(c.z > 1.0, "pushed away from the jet: {c}");
        assert!(props.out[k * PROP_STRIDE..(k + 1) * PROP_STRIDE].iter().all(|v| v.is_finite()));
        // a dry, untouched cylinder elsewhere never moves
        let mut p2 = Props::new();
        let k2 = p2.register("still", cyl_def(0.25), Mat4::from_translation(Vec3::new(3.0, 0.0, 0.0))) as usize;
        let mut jet2 = WaterJet::new(5);
        jet2.origin = Vec3::new(0.0, -1.0, 0.0);
        jet2.mouth = Vec3::new(0.0, 0.5, 0.0);
        jet2.dir = Vec3::new(0.0, 0.1, 1.0).normalize();
        jet2.emitting = true;
        for _ in 0..120 {
            step(&mut p2, &mut jet2, &mut hash, &mut a, &mut b);
        }
        assert_eq!(p2.state(k2), REST);
    }

    #[test]
    fn paper_strip_sweeping_a_box_pushes_it() {
        let mut props = Props::new();
        let k = props.register("stack", box_def(0.15), Mat4::IDENTITY) as usize;
        let mut strip = PaperStrip::new(0.18);
        strip.anchored = false;
        strip.pts.clear();
        let v = Vec3::new(2.5, 0.0, 0.0);
        for i in 0..30 {
            let p = Vec3::new(-0.2, 0.07, -0.37 + i as f32 * 0.025);
            strip.pts.push(crate::paper::Pt { p, q: p - v * DT, id: i, tw: 0.0, wet: 0.0 });
        }
        let mut jet = WaterJet::new(1);
        let mut hash = DropHash::new(0.1);
        let mut torn = PaperStrip::new(0.18);
        torn.pts.clear();
        let x0 = props.com(k).unwrap();
        for _ in 0..60 {
            strip.update(DT);
            step(&mut props, &mut jet, &mut hash, &mut strip, &mut torn);
        }
        assert_ne!(props.state(k), REST, "woken by the paper");
        let x1 = props.com(k).unwrap();
        assert!(x1.x - x0.x > 0.02, "pushed along the sweep: {x0} -> {x1}");
        assert!(x1.y > 0.04, "still on the floor, not sunk: {x1}");
        // the paper does not pass through it
        assert!(strip.pts.iter().all(|o| Shape::Box(Vec3::splat(0.03)).contact(o.p - x1, 0.0).is_none()));
    }

    #[test]
    fn settled_bodies_reset_to_their_socket() {
        let mut props = Props::new();
        props.configure(r#"{"resetAfter": 1.0}"#);
        let rest = Mat4::from_rotation_translation(Quat::from_rotation_y(0.4), Vec3::new(0.5, 0.0, 0.2));
        let k = props.register("brush", box_def(0.3), rest) as usize;
        props.kick(k, Vec3::new(0.25, 0.1, 0.0), Vec3::new(0.0, 0.05, 0.0));
        assert_eq!(props.state(k), DYNAMIC);
        let mut jet = WaterJet::new(1);
        let mut hash = DropHash::new(0.1);
        let (mut a, mut b) = empty_strips();
        let mut moved = 0.0f32;
        let mut settled = false;
        let mut t = 0;
        while props.state(k) != REST && t < 900 {
            step(&mut props, &mut jet, &mut hash, &mut a, &mut b);
            moved = moved.max(props.com(k).unwrap().distance(rest.transform_point3(Vec3::new(0.0, 0.06, 0.0))));
            settled |= props.state(k) == SETTLED;
            t += 1;
        }
        assert!(moved > 0.05, "it moved: {moved}");
        assert!(settled, "it went to sleep on the floor");
        assert_eq!(props.state(k), REST, "back at rest after {} frames", t);
        assert!(props.events.iter().any(|e| e == "prop_reset:brush"), "{:?}", props.events);
        let o = &props.out[k * PROP_STRIDE..];
        assert!((Vec3::new(o[1], o[2], o[3]) - Vec3::new(0.5, 0.0, 0.2)).length() < 1e-4);
        // resetAfter 0: never comes back
        let mut p2 = Props::new();
        p2.configure(r#"{"resetAfter": 0}"#);
        let k2 = p2.register("b", box_def(0.3), rest) as usize;
        p2.kick(k2, Vec3::new(0.25, 0.1, 0.0), Vec3::ZERO);
        for _ in 0..900 {
            step(&mut p2, &mut jet, &mut hash, &mut a, &mut b);
        }
        assert_eq!(p2.state(k2), SETTLED);
    }

    #[test]
    fn group_wakes_together_and_deterministic() {
        let run = || {
            let mut props = Props::new();
            let d = |y: f32| {
                let mut d = PropDef::from_json(r#"{"kind":"cylinder","size":{"r":0.06,"h":0.105},"mass":0.1,"com":[0,0.0525,0],"group":"stack"}"#).unwrap();
                d.center.y += y;
                d.com.y += y;
                d
            };
            for (i, (x, y)) in [(-0.125, 0.0), (0.0, 0.0), (0.125, 0.0), (-0.0625, 0.105), (0.0625, 0.105), (0.0, 0.21)].iter().enumerate() {
                props.register(&format!("r{i}"), d(*y), Mat4::from_translation(Vec3::new(*x, 0.0, 0.0)));
            }
            props.kick(1, Vec3::new(0.0, 0.0, 0.08), Vec3::ZERO);
            assert!((0..6).all(|k| props.state(k) == DYNAMIC));
            let mut jet = WaterJet::new(1);
            let mut hash = DropHash::new(0.1);
            let (mut a, mut b) = empty_strips();
            for _ in 0..180 {
                step(&mut props, &mut jet, &mut hash, &mut a, &mut b);
            }
            assert!((0..6).all(|k| props.com(k).unwrap().y > 0.0 && props.com(k).unwrap().y < 0.4));
            props.out.clone()
        };
        let (a, b) = (run(), run());
        assert_eq!(a, b, "same inputs -> same result");
        assert!(a.iter().all(|v| v.is_finite()));
    }
}
