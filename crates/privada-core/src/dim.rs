//! Rig proportions: mirror of `DIM` in web/src/rig/ToiletTuber.js (meters, origin on the floor).
//! Tank / eyes / paper roll / handle can be resized per theme (`theme.body`, see [`BodyDims`]);
//! the `TANK_*` / `EYE_*` / `HANDLE` constants are the defaults (factors 1, offset 0).
use crate::geo::Json;
use glam::{Mat3, Vec3};

pub const RIM_Y: f32 = 0.637;
pub const HINGE_Z: f32 = -0.45;
pub const WATER_Y: f32 = 0.465;
pub const PIPE_Z: f32 = -0.56;
pub const HEAD_Y: f32 = 1.0;
/// the neck pipe turns into the bowl here; `theme.body.neck.length` scales the part above
pub const NECK_BASE_Y: f32 = 0.62;
/// elongated bowl: lathe z scale, then the front gets narrower by `EGG` (geo.js eggify)
pub const BOWL_SCALE_Z: f32 = 1.22;
pub const EGG: f32 = 0.08;
/// highest point of the bowl rim glaze (bowl profile) and its outer radius (lathe units)
pub const RIM_TOP: f32 = 0.638;
pub const RIM_OUTER_R: f32 = 0.414;

pub const TANK_W: f32 = 0.95;
pub const TANK_H: f32 = 0.52;
pub const TANK_D: f32 = 0.36;
/// tank bottom (head space) stays put when the tank is resized; the back face too
pub const TANK_BOTTOM: f32 = 0.04;
pub const TANK_BACK: f32 = -0.04;
pub const TANK_Y: f32 = TANK_BOTTOM + TANK_H / 2.0;
pub const TANK_Z: f32 = TANK_BACK + TANK_D / 2.0;
pub const TANK_FRONT: f32 = TANK_Z + TANK_D / 2.0;

pub const EYE_X: f32 = 0.172;
pub const EYE_Y: f32 = 0.33;
pub const EYE_R: f32 = 0.14;

/// seat (= lower lip): egg ring rx/rz, hole radius factor, height
pub const SEAT_RX: f32 = 0.405;
pub const SEAT_RZ: f32 = 0.495;
pub const SEAT_HOLE: f32 = 0.62;
pub const SEAT_H: f32 = 0.03;
/// seat geometry offset in seat-pivot space (the seat centre sits over the bowl centre)
pub const SEAT_Y0: f32 = 0.006;
pub const SEAT_ZC: f32 = -HINGE_Z;
/// seat bone chain hinge -> front (seat_bone_0 at z = SEAT_Z0, then SEAT_SEG apart)
pub const SEAT_BONES: usize = 8;
pub const SEAT_Z0: f32 = 0.03;
pub const SEAT_SEG: f32 = (2.0 * SEAT_RZ + 0.02) / (SEAT_BONES as f32 - 1.0);
/// sanity limit only: the lower lip may roll out and down OVER the bowl's front (never into it)
pub const SEAT_MAX_DROP: f32 = 0.15;
/// Lower lip, per bone (1..7):
/// * `SEAT_DROP_ANG` front-down roll (rad) per unit of `drop` (bone 7 < 0 = the edge droops further),
/// * `SEAT_PRESS_ANG` front-up (rad) per unit of `press` (M/B/P),
/// * `SEAT_SLIDE` forward slide (m) per unit of `drop`: pushes the front out over the bowl's front,
/// * `SEAT_LIFT` lift (m) per unit of `drop`: the roll starts above the rim,
/// * `SEAT_PRESS_SLIDE` / `SEAT_TUCK_SLIDE` backward slide (m) on press (M/B/P) / tuck (F/V, under the upper lip).
pub const SEAT_DROP_ANG: [f32; SEAT_BONES - 1] = [0.0, 0.0, 0.0, 0.0, 0.0, 1.0, -0.3];
pub const SEAT_PRESS_ANG: [f32; SEAT_BONES - 1] = [0.0, 0.0, 0.0, 0.0, -0.06, -0.2, -0.08];
pub const SEAT_SLIDE: [f32; SEAT_BONES - 1] = [0.0, 0.0, 0.0, 0.02, 0.03, 0.045, 0.0];
pub const SEAT_LIFT: [f32; SEAT_BONES - 1] = [0.0, 0.0, 0.0, 0.0, 0.0, 0.03, 0.0];
pub const SEAT_PRESS_SLIDE: [f32; SEAT_BONES - 1] = [0.0, 0.0, 0.0, 0.0, -0.015, -0.02, 0.0];
pub const SEAT_TUCK_SLIDE: [f32; SEAT_BONES - 1] = [0.0, 0.0, 0.0, 0.0, -0.02, -0.025, 0.0];
/// Upper lip (lid bones 1..7): share of the front curl per bone (sums to 1: the front third folds),
/// full curl up/out (rad, O/U pucker) and down (rad, open vowels), forward slide (m) per unit of pucker.
pub const LID_CURL_W: [f32; LID_BONES - 1] = [0.0, 0.0, 0.0, 0.1, 0.25, 0.3, 0.35];
pub const LID_CURL_UP: f32 = 1.0;
pub const LID_CURL_DOWN: f32 = 0.6;
pub const LID_POUT_SLIDE: [f32; LID_BONES - 1] = [0.0, 0.0, 0.0, 0.01, 0.03, 0.035, 0.02];

pub const MOUTH_REST: f32 = 0.05;
pub const SPOUT: [f32; 3] = [0.0, 0.69, 0.43];
pub const SPOUT_DIR: [f32; 3] = [0.0, 0.42, 0.9];

pub const LID_RX: f32 = 0.4;
pub const LID_RZ: f32 = 0.49;
/// thick, soft upper lip: slab depth, dome, rounded edge radius
pub const LID_DEPTH: f32 = 0.036;
pub const LID_DOME: f32 = 0.02;
pub const LID_EDGE: f32 = 0.02;
/// permanent gentle arch (blend-shape weight added to `arch`) and front droop (rad per bone, x w^2)
pub const ARCH_REST: f32 = 0.18;
pub const LID_REST_CURL: f32 = -0.03;
/// the head tilts back with the opening (rad per rad of hinge) so the open mouth reads from the front
pub const HEAD_TALK_TILT: f32 = 0.15;
/// jaw (lid + seat assembly): max yaw (rad) for jaw_side = 1, forward shift (m) for jaw_fwd = 1
pub const JAW_YAW: f32 = 0.1;
pub const JAW_FWD: f32 = 0.025;
pub const LID_BONES: usize = 8;
pub const LID_MAX_HINGE: f32 = 1.45;
/// lid_bone_0 z in lid-pivot space; bone spacing along the lid (hinge -> front edge)
pub const LID_Z0: f32 = -0.01;
pub const LID_SEG: f32 = (2.0 * LID_RZ + 0.02) / (LID_BONES as f32 - 1.0);
/// lid pivot position in body space
pub const LID_PIVOT: [f32; 3] = [0.0, RIM_Y + SEAT_Y0 + SEAT_H + 0.004, HINGE_Z - 0.004];
/// lid centre / front outline point in lid-pivot space (lid geometry is shifted by -HINGE_Z + 0.004)
pub const LID_ZC: f32 = -HINGE_Z + 0.004;
pub const LID_FRONT_Z: f32 = LID_RZ + LID_ZC;
/// socket `lip_upper`: child of lid_bone_7, at the lid's front point on its underside
pub const LIP_UPPER: [f32; 3] = [0.0, 0.0, LID_FRONT_Z - (LID_Z0 + (LID_BONES as f32 - 1.0) * LID_SEG)];

/// paper roll: radius, length. Two mounts (`theme.body.roll.mount`):
/// * `side` (default): holder on the tank's left side face, roll axis along Z;
/// * `front`: tank front-left below the eye, roll axis along X (faces the camera).
pub const ROLL_R: f32 = 0.085;
pub const ROLL_LEN: f32 = 0.19;
/// side mount: roll centre beyond the side face / above the tank centre / ahead of its centre
pub const ROLL_SIDE_OUT: f32 = 0.125;
pub const ROLL_SIDE_UP: f32 = 0.08;
pub const ROLL_SIDE_FWD: f32 = 0.02;
/// front mount: roll x as a fraction of the tank width, height above the tank bottom, gap to the tank face
pub const ROLL_X_F: f32 = -0.3 / 0.95;
pub const ROLL_ABOVE_BOTTOM: f32 = 0.06;
pub const ROLL_GAP: f32 = 0.025;

/// flush handle position in head space
pub const HANDLE: [f32; 3] = [0.34, TANK_Y + 0.17, TANK_FRONT + 0.005];

/// Pillow tank defaults (`theme.body.tank`): corner radius (m), face bulge (m), bottom width factor,
/// tank-lid edge radius (m)
pub const TANK_ROUND: f32 = 0.11;
pub const TANK_BULGE: f32 = 0.025;
pub const TANK_TAPER: f32 = 0.9;
pub const TANK_LID_ROUND: f32 = 0.035;
/// top/bottom faces bulge less than the sides (fraction of `bulge`)
pub const TANK_BULGE_Y: f32 = 0.4;

/// The tank as a soft "pillow": a rounded box (corner radius `r`) tapered toward the bottom
/// (`taper` = bottom width factor; depth tapers half as much) with outward-bulging faces.
/// Tank-local coordinates (origin = tank centre). Mirror of web/src/rig/tank.js (`tankShape`),
/// which builds the mesh from the same math.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TankShape {
    pub hx: f32,
    pub hy: f32,
    pub hz: f32,
    pub r: f32,
    pub bulge: f32,
    pub taper: f32,
}

impl TankShape {
    pub fn new(w: f32, h: f32, d: f32, round: f32, bulge: f32, taper: f32) -> Self {
        let (hx, hy, hz) = (w / 2.0, h / 2.0, d / 2.0);
        let r = round.min(hx.min(hy).min(hz) - 0.005).max(0.005);
        Self { hx, hy, hz, r, bulge, taper }
    }
    /// taper + face bulge of a point on the rounded box
    pub fn deform(&self, p: Vec3) -> Vec3 {
        let ty = ((p.y + self.hy) / (2.0 * self.hy)).clamp(0.0, 1.0);
        let s = self.taper + (1.0 - self.taper) * ty;
        let sz = (1.0 + s) / 2.0;
        let (ux, uy, uz) = ((p.x / self.hx).clamp(-1.0, 1.0), (p.y / self.hy).clamp(-1.0, 1.0), (p.z / self.hz).clamp(-1.0, 1.0));
        let b = self.bulge;
        Vec3::new(
            p.x * s + b * ux * (1.0 - uy * uy) * (1.0 - uz * uz),
            p.y + b * TANK_BULGE_Y * uy * (1.0 - ux * ux) * (1.0 - uz * uz),
            p.z * sz + b * uz * (1.0 - ux * ux) * (1.0 - uy * uy),
        )
    }
    /// normal after the deformation: J^-T n (numeric Jacobian)
    fn deform_normal(&self, p: Vec3, n: Vec3) -> Vec3 {
        let e = 1e-3;
        let col = |a: Vec3| (self.deform(p + a * e) - self.deform(p - a * e)) / (2.0 * e);
        let j = Mat3::from_cols(col(Vec3::X), col(Vec3::Y), col(Vec3::Z));
        (j.inverse().transpose() * n).normalize()
    }
    /// box-surface point `q` -> rounded-box point + normal
    fn rounded(&self, q: Vec3) -> (Vec3, Vec3) {
        let h = Vec3::new(self.hx, self.hy, self.hz);
        let inner = h - Vec3::splat(self.r);
        let c = q.clamp(-inner, inner);
        let d = q - c;
        let n = if d.length() < 1e-7 {
            let a = (q / h).abs();
            if a.x >= a.y && a.x >= a.z { Vec3::X * q.x.signum() } else if a.y >= a.z { Vec3::Y * q.y.signum() } else { Vec3::Z * q.z.signum() }
        } else {
            d.normalize()
        };
        (c + n * self.r, n)
    }
    /// box-surface point `q` -> pillow surface point + outward normal (tank-local)
    pub fn surface(&self, q: Vec3) -> (Vec3, Vec3) {
        let (p, n) = self.rounded(q);
        (self.deform(p), self.deform_normal(p, n))
    }
    pub fn front(&self, x: f32, y: f32) -> (Vec3, Vec3) {
        self.surface(Vec3::new(x, y, self.hz))
    }
    pub fn side(&self, sx: f32, y: f32, z: f32) -> (Vec3, Vec3) {
        self.surface(Vec3::new(sx * self.hx, y, z))
    }
    /// extents of the deformed shape
    pub fn front_max(&self) -> f32 {
        self.hz + self.bulge
    }
    pub fn top_max(&self) -> f32 {
        self.hy + self.bulge * TANK_BULGE_Y
    }
    pub fn half_w(&self) -> f32 {
        self.hx + self.bulge
    }
}

/// Body proportions of one theme (`theme.body`): tank scale + pillow shape, eyes, neck, roll
/// mount. Everything that sits on the tank (eyes, handle, paper holder, sockets) follows its
/// curved surface. Mirror of `bodyDims()` in ToiletTuber.js.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyDims {
    pub tank_w: f32,
    pub tank_h: f32,
    pub tank_d: f32,
    /// tank centre (head space)
    pub tank_y: f32,
    pub tank_z: f32,
    /// pillow shape: corner radius, face bulge, bottom width factor, tank-lid edge radius
    pub tank_round: f32,
    pub tank_bulge: f32,
    pub tank_taper: f32,
    pub tank_lid_round: f32,
    /// lowest / highest point of the tank (head space y)
    pub tank_bottom: f32,
    pub tank_top: f32,
    /// right eye centre on the curved front face (the left one mirrors x) and its surface normal
    pub eye_x: f32,
    pub eye_y: f32,
    pub eye_z: f32,
    pub eye_n: [f32; 3],
    pub eye_r: f32,
    /// paper roll centre (head space), its holder on the tank surface, and the mount (false = side, true = front)
    pub roll: [f32; 3],
    pub roll_holder: [f32; 3],
    pub roll_front: bool,
    /// flush handle on the front face + its surface normal
    pub handle: [f32; 3],
    pub handle_n: [f32; 3],
    /// requested (flat-box) eye and handle positions, head space x/y
    pub eye_base: [f32; 2],
    pub handle_base: [f32; 2],
    /// neck length factor (0.6..1.6) and the resulting head pivot height (body space)
    pub neck: f32,
    pub head_y: f32,
}

impl Default for BodyDims {
    fn default() -> Self {
        Self::new(1.0, 1.0, 1.0, 1.0, 1.0, 0.0)
    }
}

impl BodyDims {
    /// tank w/h/d factors (0.6..1.6), eye size (0.5..1.8) / spacing (0.6..1.6) factors,
    /// eye vertical offset in m (-0.12..0.12); out-of-range values are clamped.
    pub fn new(w: f32, h: f32, d: f32, eye_size: f32, eye_spacing: f32, eye_y: f32) -> Self {
        let f = |v: f32, a: f32, b: f32| if v.is_finite() { v.clamp(a, b) } else { 1.0 };
        let (w, h, d) = (f(w, 0.6, 1.6), f(h, 0.6, 1.6), f(d, 0.6, 1.6));
        let (es, esp) = (f(eye_size, 0.5, 1.8), f(eye_spacing, 0.6, 1.6));
        let ey = if eye_y.is_finite() { eye_y.clamp(-0.12, 0.12) } else { 0.0 };
        let (tw, th, td) = (TANK_W * w, TANK_H * h, TANK_D * d);
        let tank_y = TANK_BOTTOM + th / 2.0;
        let tank_z = TANK_BACK + td / 2.0;
        let mut b = Self {
            tank_w: tw,
            tank_h: th,
            tank_d: td,
            tank_y,
            tank_z,
            tank_round: TANK_ROUND,
            tank_bulge: TANK_BULGE,
            tank_taper: TANK_TAPER,
            tank_lid_round: TANK_LID_ROUND,
            tank_bottom: 0.0,
            tank_top: 0.0,
            eye_x: 0.0,
            eye_y: 0.0,
            eye_z: 0.0,
            eye_n: [0.0, 0.0, 1.0],
            eye_r: EYE_R * es,
            roll: [0.0; 3],
            roll_holder: [0.0; 3],
            roll_front: false,
            handle: [0.0; 3],
            handle_n: [0.0, 0.0, 1.0],
            eye_base: [EYE_X * esp * w, tank_y + (EYE_Y - TANK_Y) * h + ey],
            handle_base: [HANDLE[0] * w, tank_y + (HANDLE[1] - TANK_Y) * h],
            neck: 1.0,
            head_y: HEAD_Y,
        };
        b.attach();
        b
    }
    /// the tank's pillow shape
    pub fn shape(&self) -> TankShape {
        TankShape::new(self.tank_w, self.tank_h, self.tank_d, self.tank_round, self.tank_bulge, self.tank_taper)
    }
    /// pillow shape: corner radius 0.02..0.16 m, face bulge 0..0.06 m, bottom width factor 0.7..1.15,
    /// tank-lid edge radius 0.01..0.05 m (non-finite -> default)
    pub fn with_tank_shape(mut self, round: f32, bulge: f32, taper: f32, lid_round: f32) -> Self {
        let f = |v: f32, a: f32, b: f32, d: f32| if v.is_finite() { v.clamp(a, b) } else { d };
        self.tank_round = f(round, 0.02, 0.16, TANK_ROUND);
        self.tank_bulge = f(bulge, 0.0, 0.06, TANK_BULGE);
        self.tank_taper = f(taper, 0.7, 1.15, TANK_TAPER);
        self.tank_lid_round = f(lid_round, 0.01, 0.05, TANK_LID_ROUND);
        self.attach();
        self
    }
    /// paper roll mount: side face (default) or tank front-left
    pub fn with_roll_mount(mut self, front: bool) -> Self {
        self.roll_front = front;
        self.attach();
        self
    }
    /// put eyes, handle and the paper holder on the curved tank surface
    fn attach(&mut self) {
        let sh = self.shape();
        let c = Vec3::new(0.0, self.tank_y, self.tank_z);
        self.tank_bottom = self.tank_y - sh.top_max();
        self.tank_top = self.tank_y + sh.top_max();
        let (p, n) = sh.front(self.eye_base[0], self.eye_base[1] - self.tank_y);
        let e = p + c;
        (self.eye_x, self.eye_y, self.eye_z, self.eye_n) = (e.x, e.y, e.z + 0.004, n.to_array());
        let (p, n) = sh.front(self.handle_base[0], self.handle_base[1] - self.tank_y);
        self.handle = (p + c + n * 0.005).to_array();
        self.handle_n = n.to_array();
        let h = self.tank_h / TANK_H;
        if self.roll_front {
            let (p, _) = sh.front(ROLL_X_F * self.tank_w, TANK_BOTTOM + ROLL_ABOVE_BOTTOM - self.tank_y);
            let hp = p + c;
            self.roll_holder = hp.to_array();
            self.roll = [hp.x, hp.y, hp.z + ROLL_R + ROLL_GAP];
        } else {
            let (p, _) = sh.side(-1.0, ROLL_SIDE_UP * h, ROLL_SIDE_FWD);
            let hp = p + c;
            self.roll_holder = hp.to_array();
            self.roll = [hp.x - ROLL_SIDE_OUT, hp.y, hp.z];
        }
    }
    /// neck length factor (pipe above the bowl), 0.6..1.6
    pub fn with_neck(mut self, length: f32) -> Self {
        self.neck = if length.is_finite() { length.clamp(0.6, 1.6) } else { 1.0 };
        self.head_y = NECK_BASE_Y + (HEAD_Y - NECK_BASE_Y) * self.neck;
        self
    }
    /// `{"tank":{"w","h","d"},"eyes":{"size","spacing","y"},"neck":{"length"},"roll":{"mount":"side"|"front"}}`
    /// (all optional); bad JSON -> defaults
    pub fn from_json(s: &str) -> Self {
        let j = Json::parse(s).unwrap_or(Json::Null);
        let (t, e, n) = (j.get("tank"), j.get("eyes"), j.get("neck"));
        let nan = f64::NAN;
        let front = j.get("roll").is_some_and(|r| r.s("mount", "side") == "front");
        let g = |o: Option<&Json>, k: &str, d: f64| o.map_or(d, |o| o.f(k, d)) as f32;
        Self::new(g(t, "w", 1.0), g(t, "h", 1.0), g(t, "d", 1.0), g(e, "size", 1.0), g(e, "spacing", 1.0), g(e, "y", 0.0))
            .with_neck(g(n, "length", 1.0))
            .with_tank_shape(g(t, "round", nan), g(t, "bulge", nan), g(t, "taper", nan), g(t, "lidRound", nan))
            .with_roll_mount(front)
    }
    /// frontmost z of the (bulged) tank front face (head space)
    pub fn front(&self) -> f32 {
        self.tank_z + self.shape().front_max()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn body_dims_defaults_and_json() {
        let d = BodyDims::default();
        assert!((d.tank_y - 0.3).abs() < 1e-6 && (d.tank_z - 0.14).abs() < 1e-6);
        assert!((d.eye_y - EYE_Y).abs() < 0.01 && (d.front() - TANK_FRONT - TANK_BULGE).abs() < 1e-6);
        // the eyes sit on the bulged front face, slightly in front of the flat box
        assert!(d.eye_z > TANK_FRONT + 0.01 && d.eye_z < d.front() + 0.005 && d.eye_n[2] > 0.95, "{d:?}");
        // side mount: holder on the curved left side face, roll 12.5 cm out
        assert!(d.roll_holder[0] < -TANK_W / 2.0 && d.roll_holder[0] > -TANK_W / 2.0 - TANK_BULGE - 1e-4 && !d.roll_front);
        assert!((d.roll[0] - d.roll_holder[0] + ROLL_SIDE_OUT).abs() < 1e-6);
        let fr = BodyDims::from_json(r#"{"roll":{"mount":"front"}}"#);
        assert!(fr.roll_front && (fr.roll[0] - fr.roll_holder[0]).abs() < 1e-6 && (fr.roll[2] - fr.roll_holder[2] - ROLL_R - ROLL_GAP).abs() < 1e-6);
        // flat, hard box = the old geometry
        let flat = BodyDims::from_json(r#"{"tank":{"round":0.02,"bulge":0,"taper":1}}"#);
        assert!((flat.eye_z - TANK_FRONT - 0.004).abs() < 1e-5 && (flat.eye_x - EYE_X).abs() < 1e-5 && (flat.front() - TANK_FRONT).abs() < 1e-6);
        let sh = BodyDims::default().shape();
        for q in [Vec3::new(0.3, 0.1, sh.hz), Vec3::new(sh.hx, 0.2, 0.15), Vec3::new(-0.1, sh.hy, -0.17)] {
            let (p, n) = sh.surface(q);
            assert!(p.is_finite() && (n.length() - 1.0).abs() < 1e-4 && n.dot(q) > 0.0, "{q} -> {p} {n}");
        }
        let j = BodyDims::from_json(r#"{"tank":{"w":1.2,"h":0.8},"eyes":{"size":1.5,"y":0.05,"spacing":9}}"#);
        assert!((j.tank_w - 1.14).abs() < 1e-5 && (j.tank_d - TANK_D).abs() < 1e-6);
        assert!((j.eye_r - 0.21).abs() < 1e-5 && (j.eye_base[0] - EYE_X * 1.6 * 1.2).abs() < 1e-5 && (j.eye_x - j.eye_base[0]).abs() < 0.04);
        assert_eq!(BodyDims::from_json("not json"), BodyDims::default());
        assert_eq!(BodyDims::from_json(""), BodyDims::default());
        let n = BodyDims::from_json(r#"{"neck":{"length":1.5}}"#);
        assert!((n.head_y - (NECK_BASE_Y + 0.38 * 1.5)).abs() < 1e-5 && (BodyDims::default().head_y - HEAD_Y).abs() < 1e-6);
    }
}
