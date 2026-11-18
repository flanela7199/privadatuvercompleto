//! Rig proportions: mirror of `DIM` in web/src/rig/ToiletTuber.js (meters, origin on the floor).

pub const RIM_Y: f32 = 0.637;
pub const HINGE_Z: f32 = -0.45;
pub const WATER_Y: f32 = 0.465;
pub const PIPE_Z: f32 = -0.56;
pub const HEAD_Y: f32 = 1.0;

pub const TANK_W: f32 = 0.95;
pub const TANK_H: f32 = 0.52;
pub const TANK_D: f32 = 0.36;
pub const TANK_Y: f32 = 0.3;
pub const TANK_Z: f32 = 0.14;
pub const TANK_FRONT: f32 = TANK_Z + TANK_D / 2.0;

pub const EYE_X: f32 = 0.172;
pub const EYE_Y: f32 = 0.33;
pub const EYE_R: f32 = 0.14;

pub const SEAT_H: f32 = 0.03;

pub const MOUTH_REST: f32 = 0.05;
pub const SPOUT: [f32; 3] = [0.0, 0.69, 0.43];
pub const SPOUT_DIR: [f32; 3] = [0.0, 0.42, 0.9];

pub const LID_RZ: f32 = 0.49;
pub const LID_DEPTH: f32 = 0.018;
pub const LID_DOME: f32 = 0.018;
pub const LID_BONES: usize = 8;
pub const LID_MAX_HINGE: f32 = 1.45;
/// bone spacing along the lid (hinge -> front edge)
pub const LID_SEG: f32 = (2.0 * LID_RZ + 0.02) / (LID_BONES as f32 - 1.0);
/// lid pivot position in body space
pub const LID_PIVOT: [f32; 3] = [0.0, RIM_Y + 0.006 + SEAT_H + 0.004, HINGE_Z - 0.004];

pub const ROLL_X: f32 = -0.6;
pub const ROLL_Y: f32 = 0.38;
pub const ROLL_Z: f32 = 0.16;
pub const ROLL_R: f32 = 0.085;
pub const ROLL_LEN: f32 = 0.19;

/// flush handle position in head space
pub const HANDLE: [f32; 3] = [0.34, TANK_Y + 0.17, TANK_FRONT + 0.005];
