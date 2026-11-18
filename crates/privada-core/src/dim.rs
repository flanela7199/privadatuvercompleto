//! Rig proportions: mirror of `DIM` in web/src/rig/ToiletTuber.js (meters, origin on the floor).
//! Tank / eyes / paper roll / handle can be resized per theme (`theme.body`, see [`BodyDims`]);
//! the `TANK_*` / `EYE_*` / `HANDLE` constants are the defaults (factors 1, offset 0).
use crate::geo::Json;

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

/// Body proportions of one theme (`theme.body`): tank scale and eyes. Everything that sits
/// on the tank (eyes, handle, paper roll, sockets) follows it. Mirror of `bodyDims()` in
/// ToiletTuber.js.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyDims {
    pub tank_w: f32,
    pub tank_h: f32,
    pub tank_d: f32,
    /// tank centre (head space)
    pub tank_y: f32,
    pub tank_z: f32,
    pub eye_x: f32,
    pub eye_y: f32,
    pub eye_r: f32,
    /// paper roll centre (head space) and its mount (false = side, true = front)
    pub roll: [f32; 3],
    pub roll_front: bool,
    pub handle: [f32; 3],
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
        let front = tank_z + td / 2.0;
        Self {
            tank_w: tw,
            tank_h: th,
            tank_d: td,
            tank_y,
            tank_z,
            eye_x: EYE_X * esp * w,
            eye_y: tank_y + (EYE_Y - TANK_Y) * h + ey,
            eye_r: EYE_R * es,
            roll: [-(tw / 2.0 + ROLL_SIDE_OUT), tank_y + ROLL_SIDE_UP * h, tank_z + ROLL_SIDE_FWD],
            roll_front: false,
            handle: [HANDLE[0] * w, tank_y + (HANDLE[1] - TANK_Y) * h, front + 0.005],
            neck: 1.0,
            head_y: HEAD_Y,
        }
    }
    /// paper roll mount: side face (default) or tank front-left
    pub fn with_roll_mount(mut self, front: bool) -> Self {
        let h = self.tank_h / TANK_H;
        self.roll_front = front;
        self.roll = if front {
            [ROLL_X_F * self.tank_w, TANK_BOTTOM + ROLL_ABOVE_BOTTOM, self.front() + ROLL_R + ROLL_GAP]
        } else {
            [-(self.tank_w / 2.0 + ROLL_SIDE_OUT), self.tank_y + ROLL_SIDE_UP * h, self.tank_z + ROLL_SIDE_FWD]
        };
        self
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
        let front = j.get("roll").is_some_and(|r| r.s("mount", "side") == "front");
        let g = |o: Option<&Json>, k: &str, d: f64| o.map_or(d, |o| o.f(k, d)) as f32;
        Self::new(g(t, "w", 1.0), g(t, "h", 1.0), g(t, "d", 1.0), g(e, "size", 1.0), g(e, "spacing", 1.0), g(e, "y", 0.0))
            .with_neck(g(n, "length", 1.0))
            .with_roll_mount(front)
    }
    /// tank front face z (head space)
    pub fn front(&self) -> f32 {
        self.tank_z + self.tank_d / 2.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn body_dims_defaults_and_json() {
        let d = BodyDims::default();
        assert!((d.tank_y - 0.3).abs() < 1e-6 && (d.tank_z - 0.14).abs() < 1e-6);
        assert!((d.eye_y - EYE_Y).abs() < 1e-6 && (d.front() - TANK_FRONT).abs() < 1e-6);
        assert!((d.roll[0] + 0.6).abs() < 1e-6 && (d.roll[1] - 0.38).abs() < 1e-6 && (d.roll[2] - 0.16).abs() < 1e-6 && !d.roll_front);
        let fr = BodyDims::from_json(r#"{"roll":{"mount":"front"}}"#);
        assert!(fr.roll_front && (fr.roll[0] + 0.3).abs() < 1e-6 && (fr.roll[2] - 0.43).abs() < 1e-6);
        let j = BodyDims::from_json(r#"{"tank":{"w":1.2,"h":0.8},"eyes":{"size":1.5,"y":0.05,"spacing":9}}"#);
        assert!((j.tank_w - 1.14).abs() < 1e-5 && (j.tank_d - TANK_D).abs() < 1e-6);
        assert!((j.eye_r - 0.21).abs() < 1e-5 && (j.eye_x - EYE_X * 1.6 * 1.2).abs() < 1e-5);
        assert_eq!(BodyDims::from_json("not json"), BodyDims::default());
        assert_eq!(BodyDims::from_json(""), BodyDims::default());
        let n = BodyDims::from_json(r#"{"neck":{"length":1.5}}"#);
        assert!((n.head_y - (NECK_BASE_Y + 0.38 * 1.5)).abs() < 1e-5 && (BodyDims::default().head_y - HEAD_Y).abs() < 1e-6);
    }
}
