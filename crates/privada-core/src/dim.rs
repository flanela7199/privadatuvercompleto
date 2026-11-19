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
/// Eye styles (`theme.body.eyes.style`), mirror of `DIM.eyeStyles` in ToiletTuber.js. `classico` (default) =
/// the reference image: flat white disc, thick black outline, medium pupil + highlight, calm pupils;
/// `googly` = 3D dome + big jiggly pupil; `desenho` = cartoon oval, big solid pupil, no outline;
/// `serio` = classico + a porcelain upper eyelid (JS mesh); `sticker` = flat printed, drifting pupils.
#[derive(Clone, Copy, Debug)]
pub struct EyeStyle {
    pub name: &'static str,
    pub flat: bool,
    pub outline: f32,
    pub pupil: f32,
    pub oval: f32,
    pub pupil_z: f32,
    pub damp: f32,
    pub drift: bool,
}
pub const EYE_STYLES: [EyeStyle; 5] = [
    EyeStyle { name: "classico", flat: true, outline: 0.12, pupil: 0.38, oval: 1.0, pupil_z: 0.002, damp: 16.0, drift: false },
    EyeStyle { name: "googly", flat: false, outline: 0.0, pupil: 0.44, oval: 1.0, pupil_z: 0.03, damp: 9.0, drift: false },
    EyeStyle { name: "desenho", flat: true, outline: 0.0, pupil: 0.42, oval: 1.15, pupil_z: 0.0005, damp: 14.0, drift: false },
    EyeStyle { name: "serio", flat: true, outline: 0.12, pupil: 0.38, oval: 1.0, pupil_z: 0.002, damp: 16.0, drift: false },
    EyeStyle { name: "sticker", flat: true, outline: 0.11, pupil: 0.3, oval: 1.1, pupil_z: 0.0005, damp: 9.0, drift: true },
];
/// eye style `sticker`: size / spacing factors (the other styles use EYE_SIZE_DEFAULT / EYE_SPACING_DEFAULT)
pub const STICKER_SIZE: f32 = 1.15;
pub const STICKER_SPACING: f32 = 0.97;
pub const STICKER_OUTLINE: f32 = 0.11;
pub const STICKER_PUPIL: f32 = 0.3;
pub const STICKER_OVAL: f32 = 1.1;

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
/// `theme.body.mouth.lower = "bowl"`: the whole upper bowl is the lower JAW. It turns about a pivot at
/// the back of the bowl (hinge side, behind the pedestal top), front down by up to `BOWL_JAW_OPEN` rad
/// on open vowels (+ a forward slide), up by `BOWL_JAW_PRESS` on M/B/P; the pedestal stays rigid
/// (the bowl mesh blends from rigid to the jaw between `BOWL_JAW_SKIN` heights). The seat rides on the
/// rim with its own roll scaled by `BOWL_SEAT_ROLL`.
pub const BOWL_JAW_PIVOT: [f32; 3] = [0.0, 0.5, -0.47];
/// default max jaw opening (rad), theme `body.mouth.bowlOpen` 0.05..0.35
pub const BOWL_JAW_OPEN: f32 = 0.18;
pub const BOWL_JAW_PRESS: f32 = 0.04;
pub const BOWL_JAW_SLIDE: f32 = 0.04;
pub const BOWL_JAW_SKIN: [f32; 2] = [0.28, 0.42];
pub const BOWL_SEAT_ROLL: f32 = 0.35;
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
/// side-mount roll height above the tank bottom (fixed: a taller tank grows above it)
pub const ROLL_SIDE_UP: f32 = 0.34;
pub const ROLL_SIDE_FWD: f32 = 0.02;
/// front mount: roll x as a fraction of the tank width, height above the tank bottom, gap to the tank face
pub const ROLL_X_F: f32 = -0.3 / 0.95;
pub const ROLL_ABOVE_BOTTOM: f32 = 0.06;
pub const ROLL_GAP: f32 = 0.025;

/// flush handle position in head space
pub const HANDLE: [f32; 3] = [0.34, TANK_Y + 0.17, TANK_FRONT + 0.005];

/// Pillow tank defaults (`theme.body.tank`): corner radius (m), face bulge (m), bottom width factor,
/// tank-lid edge radius (m)
/// Defaults measured on the reference image of the original character: tank height/width 0.76
/// (height factor 1.38, grows upward from the fixed bottom), slight taper, corner radius ~11% of
/// the width, thick rounded tank lid (17% of the width) overhanging ~5% of the width all around.
pub const TANK_H_DEFAULT: f32 = 1.38;
pub const TANK_ROUND: f32 = 0.10;
pub const TANK_BULGE: f32 = 0.02;
pub const TANK_TAPER: f32 = 0.93;
pub const TANK_LID_ROUND: f32 = 0.035;
pub const TANK_LID_THICK: f32 = 0.14;
pub const TANK_LID_OVER: f32 = 0.045;
/// the tank lid's top is slightly domed (m at its centre)
pub const TANK_LID_DOME: f32 = 0.012;
/// corner radius at the top / bottom as a factor of `round` (bottom corners slightly rounder)
pub const TANK_ROUND_TOP: f32 = 0.9;
pub const TANK_ROUND_BOTTOM: f32 = 1.15;
/// default googly eyes on the taller face: radius ~0.167 and centre spacing ~0.35 of the tank width,
/// at mid height; default neck a bit shorter so the taller head stays in frame
pub const EYE_SIZE_DEFAULT: f32 = 1.13;
pub const EYE_SPACING_DEFAULT: f32 = 0.97;
pub const NECK_DEFAULT: f32 = 0.9;
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
    /// corner radius at the top / bottom (blends smoothly with height)
    pub r_top: f32,
    pub r_bot: f32,
    pub bulge: f32,
    pub taper: f32,
}

impl TankShape {
    pub fn new(w: f32, h: f32, d: f32, round: f32, bulge: f32, taper: f32) -> Self {
        let (hx, hy, hz) = (w / 2.0, h / 2.0, d / 2.0);
        let lim = |r: f32| r.min(hx.min(hy).min(hz) - 0.005).max(0.005);
        Self { hx, hy, hz, r_top: lim(round * TANK_ROUND_TOP), r_bot: lim(round * TANK_ROUND_BOTTOM), bulge, taper }
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
    /// corner radius at box height `y` (smoothstep from the bottom to the top radius)
    pub fn radius(&self, y: f32) -> f32 {
        let t = ((y + self.hy) / (2.0 * self.hy)).clamp(0.0, 1.0);
        self.r_bot + (self.r_top - self.r_bot) * t * t * (3.0 - 2.0 * t)
    }
    /// box-surface point `q` -> rounded-box point + normal
    fn rounded(&self, q: Vec3) -> (Vec3, Vec3) {
        let h = Vec3::new(self.hx, self.hy, self.hz);
        let r = self.radius(q.y);
        let inner = h - Vec3::splat(r);
        let c = q.clamp(-inner, inner);
        let d = q - c;
        let n = if d.length() < 1e-7 {
            let a = (q / h).abs();
            if a.x >= a.y && a.x >= a.z { Vec3::X * q.x.signum() } else if a.y >= a.z { Vec3::Y * q.y.signum() } else { Vec3::Z * q.z.signum() }
        } else {
            d.normalize()
        };
        (c + n * r, n)
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
    /// tank lid slab thickness / overhang per side (m) and its domed top (head space y)
    pub tank_lid_thick: f32,
    pub tank_lid_over: f32,
    pub lid_top: f32,
    /// lowest / highest point of the tank (head space y)
    pub tank_bottom: f32,
    pub tank_top: f32,
    /// right eye centre on the curved front face (the left one mirrors x) and its surface normal
    pub eye_x: f32,
    pub eye_y: f32,
    pub eye_z: f32,
    pub eye_n: [f32; 3],
    pub eye_r: f32,
    /// eye style: flat sticker (default) or 3D googly; outline / pupil (fractions of the radius),
    /// vertical oval factor, pupil height above the eye centre and its max travel (x; y = x * oval)
    pub eye_sticker: bool,
    /// eye style (`EYE_STYLES` name) and the pupil spring damping (classico/serio are calmer than googly)
    pub eye_style: &'static str,
    pub pupil_damp: f32,
    pub eye_outline: f32,
    pub eye_pupil: f32,
    pub eye_oval: f32,
    pub pupil_z: f32,
    pub pupil_travel: f32,
    /// paper roll centre (head space), its holder on the tank surface, and the mount (false = side, true = front)
    pub roll: [f32; 3],
    pub roll_holder: [f32; 3],
    pub roll_front: bool,
    /// lower lip = the whole bowl (jaw) instead of only the seat (`theme.body.mouth.lower`)
    pub mouth_bowl: bool,
    /// bowl mode: max jaw opening (rad)
    pub bowl_open: f32,
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
    /// the defaults of `theme.body` (an empty block)
    fn default() -> Self {
        Self::from_json("{}")
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
            tank_lid_thick: TANK_LID_THICK,
            tank_lid_over: TANK_LID_OVER,
            lid_top: 0.0,
            tank_bottom: 0.0,
            tank_top: 0.0,
            eye_x: 0.0,
            eye_y: 0.0,
            eye_z: 0.0,
            eye_n: [0.0, 0.0, 1.0],
            eye_r: EYE_R * es,
            eye_sticker: false,
            eye_style: "googly",
            pupil_damp: 9.0,
            eye_outline: 0.0,
            eye_pupil: 0.44,
            eye_oval: 1.0,
            pupil_z: 0.03,
            pupil_travel: EYE_R * es * 0.5,
            roll: [0.0; 3],
            roll_holder: [0.0; 3],
            roll_front: false,
            mouth_bowl: false,
            bowl_open: BOWL_JAW_OPEN,
            handle: [0.0; 3],
            handle_n: [0.0, 0.0, 1.0],
            eye_base: [EYE_X * esp * w, tank_y + ey],
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
    /// tank lid slab thickness 0.04..0.2 m and overhang per side 0..0.08 m (non-finite -> default)
    pub fn with_lid(mut self, thick: f32, over: f32) -> Self {
        let f = |v: f32, a: f32, b: f32, d: f32| if v.is_finite() { v.clamp(a, b) } else { d };
        self.tank_lid_thick = f(thick, 0.04, 0.2, TANK_LID_THICK);
        self.tank_lid_over = f(over, 0.0, 0.08, TANK_LID_OVER);
        self.attach();
        self
    }
    /// Eye style (unknown -> `classico`) + optional overrides outline 0..0.2, pupil 0.2..0.5,
    /// oval 0.9..1.3 (non-finite -> the style's value). Flat styles: pupil travel = radius - pupil - outline.
    pub fn with_eye_style(mut self, style: &str, outline: f32, pupil: f32, oval: f32) -> Self {
        let st = EYE_STYLES.iter().find(|s| s.name == style).unwrap_or(&EYE_STYLES[0]);
        let f = |v: f32, a: f32, b: f32, d: f32| if v.is_finite() { v.clamp(a, b) } else { d };
        self.eye_style = st.name;
        self.eye_sticker = st.drift;
        self.pupil_damp = st.damp;
        if st.flat {
            self.eye_outline = f(outline, 0.0, 0.2, st.outline);
            self.eye_pupil = f(pupil, 0.2, 0.5, st.pupil);
            self.eye_oval = f(oval, 0.9, 1.3, st.oval);
            self.pupil_z = st.pupil_z;
            self.pupil_travel = self.eye_r * (1.0 - self.eye_pupil - self.eye_outline);
        } else {
            (self.eye_outline, self.eye_pupil, self.eye_oval, self.pupil_z, self.pupil_travel) = (0.0, st.pupil, 1.0, st.pupil_z, self.eye_r * 0.5);
        }
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
        self.lid_top = self.tank_top - 0.006 + self.tank_lid_thick + TANK_LID_DOME;
        let (p, n) = sh.front(self.eye_base[0], self.eye_base[1] - self.tank_y);
        let e = p + c;
        (self.eye_x, self.eye_y, self.eye_z, self.eye_n) = (e.x, e.y, e.z + 0.004, n.to_array());
        let (p, n) = sh.front(self.handle_base[0], self.handle_base[1] - self.tank_y);
        self.handle = (p + c + n * 0.005).to_array();
        self.handle_n = n.to_array();
        if self.roll_front {
            let (p, _) = sh.front(ROLL_X_F * self.tank_w, TANK_BOTTOM + ROLL_ABOVE_BOTTOM - self.tank_y);
            let hp = p + c;
            self.roll_holder = hp.to_array();
            self.roll = [hp.x, hp.y, hp.z + ROLL_R + ROLL_GAP];
        } else {
            let (p, _) = sh.side(-1.0, (TANK_BOTTOM + ROLL_SIDE_UP - self.tank_y).min(sh.hy - sh.r_top), ROLL_SIDE_FWD);
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
        let style = e.map_or("classico", |e| e.s("style", "classico"));
        let sticker = style == "sticker";
        let (ds, dsp) = if sticker { (STICKER_SIZE as f64, STICKER_SPACING as f64) } else { (EYE_SIZE_DEFAULT as f64, EYE_SPACING_DEFAULT as f64) };
        let front = j.get("roll").is_some_and(|r| r.s("mount", "side") == "front");
        let g = |o: Option<&Json>, k: &str, d: f64| o.map_or(d, |o| o.f(k, d)) as f32;
        Self::new(g(t, "w", 1.0), g(t, "h", TANK_H_DEFAULT as f64), g(t, "d", 1.0), g(e, "size", ds), g(e, "spacing", dsp), g(e, "y", 0.0))
            .with_eye_style(style, g(e, "outline", nan), g(e, "pupil", nan), g(e, "oval", nan))
            .with_neck(g(n, "length", NECK_DEFAULT as f64))
            .with_lid(g(t, "lidThick", nan), g(t, "lidOver", nan))
            .with_tank_shape(g(t, "round", nan), g(t, "bulge", nan), g(t, "taper", nan), g(t, "lidRound", nan))
            .with_roll_mount(front)
            .with_mouth_bowl(j.get("mouth").is_some_and(|m| m.s("lower", "seat") == "bowl"), g(j.get("mouth"), "bowlOpen", nan))
    }
    /// lower lip = the whole bowl (jaw) instead of only the seat; max jaw opening 0.05..0.35 rad
    /// (non-finite -> default)
    pub fn with_mouth_bowl(mut self, bowl: bool, open: f32) -> Self {
        self.mouth_bowl = bowl;
        self.bowl_open = if open.is_finite() { open.clamp(0.05, 0.35) } else { BOWL_JAW_OPEN };
        self
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
        // reference proportions: tank height/width 0.76, bottom fixed, eyes at mid height, thick lid
        assert!(((d.tank_h / d.tank_w) - 0.755).abs() < 0.01 && (d.tank_y - d.tank_h / 2.0 - TANK_BOTTOM).abs() < 1e-6 && (d.tank_z - 0.14).abs() < 1e-6);
        assert!((d.eye_y - d.tank_y).abs() < 0.01 && (d.front() - TANK_FRONT - TANK_BULGE).abs() < 1e-6);
        assert!(((d.eye_r / d.tank_w) - 0.167).abs() < 0.003 && ((2.0 * d.eye_x / d.tank_w) - 0.35).abs() < 0.02, "{d:?}");
        assert!((d.lid_top - d.tank_top - TANK_LID_THICK - TANK_LID_DOME + 0.006).abs() < 1e-6 && (d.head_y - (NECK_BASE_Y + 0.38 * NECK_DEFAULT)).abs() < 1e-5);
        // the eyes sit on the bulged front face, slightly in front of the flat box
        assert!(d.eye_z > TANK_FRONT + 0.01 && d.eye_z < d.front() + 0.005 && d.eye_n[2] > 0.95, "{d:?}");
        // side mount: holder on the curved left side face, roll 12.5 cm out
        assert!(d.roll_holder[0] < -TANK_W / 2.0 && d.roll_holder[0] > -TANK_W / 2.0 - TANK_BULGE - 1e-4 && !d.roll_front);
        assert!((d.roll[0] - d.roll_holder[0] + ROLL_SIDE_OUT).abs() < 1e-6);
        let fr = BodyDims::from_json(r#"{"roll":{"mount":"front"}}"#);
        assert!(fr.roll_front && (fr.roll[0] - fr.roll_holder[0]).abs() < 1e-6 && (fr.roll[2] - fr.roll_holder[2] - ROLL_R - ROLL_GAP).abs() < 1e-6);
        // flat, hard box = the old geometry
        let flat = BodyDims::from_json(r#"{"tank":{"round":0.02,"bulge":0,"taper":1},"eyes":{"spacing":1}}"#);
        // default eyes: flat stickers; googly = the old 3D look
        // default eyes = classico (flat disc, outline 0.12, pupil 0.38, calm pupils)
        assert!(d.eye_style == "classico" && (d.eye_r - EYE_R * EYE_SIZE_DEFAULT).abs() < 1e-6 && (d.pupil_travel - d.eye_r * 0.5).abs() < 1e-6 && d.pupil_damp == 16.0);
        let gg = BodyDims::from_json(r#"{"eyes":{"style":"googly"}}"#);
        assert!(gg.eye_style == "googly" && (gg.pupil_travel - gg.eye_r * 0.5).abs() < 1e-6 && gg.pupil_z == 0.03 && gg.pupil_damp == 9.0);
        let ds = BodyDims::from_json(r#"{"eyes":{"style":"desenho"}}"#);
        assert!(ds.eye_outline == 0.0 && (ds.eye_oval - 1.15).abs() < 1e-6 && (ds.pupil_travel - ds.eye_r * 0.58).abs() < 1e-6);
        assert_eq!(BodyDims::from_json(r#"{"eyes":{"style":"nope"}}"#).eye_style, "classico");
        let ss = BodyDims::from_json(r#"{"eyes":{"style":"sticker"}}"#);
        assert!(ss.eye_sticker && (ss.eye_r - EYE_R * STICKER_SIZE).abs() < 1e-6 && (ss.pupil_travel - ss.eye_r * 0.59).abs() < 1e-6);
        let st = BodyDims::from_json(r#"{"eyes":{"style":"sticker","outline":0.5,"pupil":0.25,"oval":1.2}}"#);
        assert!((st.eye_outline - 0.2).abs() < 1e-6 && (st.eye_pupil - 0.25).abs() < 1e-6 && (st.eye_oval - 1.2).abs() < 1e-6);
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
        assert!((n.head_y - (NECK_BASE_Y + 0.38 * 1.5)).abs() < 1e-5 && (BodyDims::default().head_y - (NECK_BASE_Y + 0.38 * NECK_DEFAULT)).abs() < 1e-6);
    }
}
