//! Blend shapes of the human head as displacement FIELDS: `delta(m, p0, rest)` gives the
//! offset of a point whose sculpt position is `p0` and rest position `rest`. The head mesh
//! samples them per vertex; beard / brows interpolate the head's deltas at their roots, so
//! everything attached to the skin follows it exactly.
//!
//! L = the -x side (like the toilet's `eye_L`).
use super::head::*;
use super::sdf::*;
use crate::rig::{Mouth, STANDARD_VISEMES};
use glam::Vec3;

pub const N: usize = 24;
pub const MORPH_NAMES: [&str; N] = [
    "jaw_open", "pucker", "wide_L", "wide_R", "smile_L", "smile_R", "frown_L", "frown_R", "upper_raise", "lower_down",
    "press", "tuck", "cheek_puff", "brow_up_L", "brow_up_R", "brow_down_L", "brow_down_R", "blink_L", "blink_R",
    "squint_L", "squint_R", "jaw_left", "jaw_right", "jaw_fwd",
];
pub mod m {
    pub const JAW_OPEN: usize = 0;
    pub const PUCKER: usize = 1;
    pub const WIDE_L: usize = 2;
    pub const WIDE_R: usize = 3;
    pub const SMILE_L: usize = 4;
    pub const SMILE_R: usize = 5;
    pub const FROWN_L: usize = 6;
    pub const FROWN_R: usize = 7;
    pub const UPPER_RAISE: usize = 8;
    pub const LOWER_DOWN: usize = 9;
    pub const PRESS: usize = 10;
    pub const TUCK: usize = 11;
    pub const CHEEK_PUFF: usize = 12;
    pub const BROW_UP_L: usize = 13;
    pub const BROW_UP_R: usize = 14;
    pub const BROW_DOWN_L: usize = 15;
    pub const BROW_DOWN_R: usize = 16;
    pub const BLINK_L: usize = 17;
    pub const BLINK_R: usize = 18;
    pub const SQUINT_L: usize = 19;
    pub const SQUINT_R: usize = 20;
    pub const JAW_LEFT: usize = 21;
    pub const JAW_RIGHT: usize = 22;
    pub const JAW_FWD: usize = 23;
}
/// jaw rotation (rad) at jaw_open = 1 = 36 deg, the wide "blargh" / spit pose (the `jaw` bone turns by weight * this)
pub const JAW_MAX: f32 = 0.63;
/// jaw_open weight of a fully open SPEECH mouth (`open` = 1 -> ~20 deg)
pub const SPEECH_JAW: f32 = 0.57;

/// how much a point belongs to the mandible (0..1)
pub fn jaw_weight(p0: Vec3) -> f32 {
    let ax = p0.x.abs();
    let u = p0.y - lip_line(p0.x);
    let yline = MOUTH_Y + 0.042 * sstep(0.078, 0.0, p0.z);
    let soft = sstep(-0.016, 0.022, yline - p0.y);
    let inside = cut_wall(p0) * sstep(0.034, 0.030, ax) * sstep(0.030, 0.026, (p0.y - MOUTH_Y).abs());
    let c = (sstep(0.029, 0.013, ax) * sstep(0.045, 0.060, p0.z)).max(inside);
    let w = if u < 0.0 { mix(soft, 1.0, c) } else { mix(soft, 0.0, c) };
    w * skin_weights(p0)[2] * sstep(-0.035, -0.005, p0.z)
}

/// 1 on the requested side (-1 = L / -x, 1 = R / +x), soft across the middle
#[inline]
fn side_w(x: f32, side: f32) -> f32 {
    sstep(-0.007, 0.007, x * side)
}
fn corner(p0: Vec3, side: f32) -> f32 {
    let u = p0.y - lip_line(p0.x);
    let q = v(p0.x - side * MOUTH_W, u, p0.z - 0.086);
    (-(q / v(0.017, 0.017, 0.024)).length_squared()).exp() * sstep(0.040, 0.055, p0.z)
}
fn lip_zone(p0: Vec3, rx: f32, ry: f32) -> f32 {
    let u = p0.y - lip_line(p0.x);
    (-((p0.x / rx).powi(2) + (u / ry).powi(2))).exp() * sstep(0.050, 0.068, p0.z)
}
fn upper(p0: Vec3) -> f32 {
    if p0.y - lip_line(p0.x) > 0.0 { 1.0 } else { 0.0 }
}

fn blink(p0: Vec3, side: f32, amount: f32, lower: f32) -> Vec3 {
    if p0.x * side <= 0.0 {
        return Vec3::ZERO;
    }
    let q = v(p0.x.abs(), p0.y, p0.z);
    let rel = q - EYE;
    let dist = rel.length();
    let wr = sstep(EYE_R + 0.0115, EYE_R + 0.0050, dist) * sstep(-0.006, 0.0, rel.z);
    if wr <= 0.0 {
        return Vec3::ZERO;
    }
    let (lx, _) = eye_local(q);
    // slightly wider than the sculpted opening, so the corners close too
    let (yu, yl) = lid_curves(lx * (LID_W / (LID_W + 0.0035)));
    if yu - yl < 1e-5 {
        return Vec3::ZERO;
    }
    let rs = EYE_R + 0.0020;
    let off = LID_DY + LID_SHEAR * lx;
    let ang = |y: f32| ((y + off) / rs).clamp(-1.0, 1.0).asin();
    let (au, al) = (ang(yu), ang(yl));
    let phi = rel.y.atan2(rel.z);
    // upper lid comes down to `closed`; the lower lid rises a little (`lower`)
    let al2 = al + lower * (au - al);
    // the upper lid ends a little PAST the lower lid margin and slides over it (no white sliver)
    let closed = mix(au, al2 - 0.09, amount);
    let (top, bot) = (au + 0.50, al - 0.35);
    let np = if phi >= top || phi <= bot {
        phi
    } else if phi >= au {
        closed + (phi - au) * (top - closed) / (top - au)
    } else if phi > al {
        al2 + (phi - al) * (closed - al2) / (au - al)
    } else {
        bot + (phi - bot) * (al2 - bot) / (al - bot)
    };
    let d = (np - phi) * wr;
    let over = if phi > al { 0.0008 * amount * wr * sstep(0.0, 0.25, (phi - np).max(0.0)) } else { 0.0 };
    let rho = (rel.y * rel.y + rel.z * rel.z).sqrt() + over;
    let (s, c) = (phi + d).sin_cos();
    v(0.0, rho * s - rel.y, rho * c - rel.z)
}

/// displacement of morph `i` at full weight
pub fn delta(i: usize, p0: Vec3, rest: Vec3) -> Vec3 {
    let sx = if p0.x >= 0.0 { 1.0 } else { -1.0 };
    let q = v(p0.x.abs(), p0.y, p0.z);
    let side = |l: usize| if i == l { -1.0 } else { 1.0 };
    match i {
        m::JAW_OPEN => {
            let w = jaw_weight(p0);
            if w <= 0.0 {
                return Vec3::ZERO;
            }
            let hinge = v(rest.x, HINGE.y, HINGE.z);
            let mut d = (rot_x(rest, hinge, JAW_MAX) - rest) * w;
            // the corners come in a little as the mouth opens
            d.x -= 0.0035 * (corner(p0, 1.0) - corner(p0, -1.0));
            d
        }
        m::PUCKER => {
            let g = lip_zone(p0, 0.034, 0.017);
            let ud = if upper(p0) > 0.5 { 1.0 } else { -1.0 };
            v(-0.40 * p0.x * g, 0.0010 * ud * g, 0.0070 * g)
        }
        m::WIDE_L | m::WIDE_R => {
            let s = side(m::WIDE_L);
            let k = corner(p0, s);
            v(s * 0.0060 * k, 0.0005 * k, -0.0032 * k)
        }
        m::SMILE_L | m::SMILE_R => {
            let s = side(m::SMILE_L);
            let k = corner(p0, s);
            let cheek = gauss(q, v(0.042, -0.028, 0.068), v(0.022, 0.020, 0.030)) * side_w(p0.x, s);
            v(s * (0.0058 * k + 0.0010 * cheek), 0.0068 * k + 0.0030 * cheek, -0.0036 * k + 0.0020 * cheek)
        }
        m::FROWN_L | m::FROWN_R => {
            let s = side(m::FROWN_L);
            let k = corner(p0, s);
            v(s * 0.0015 * k, -0.0058 * k, -0.0010 * k)
        }
        m::UPPER_RAISE => {
            let g = lip_zone(p0, 0.023, 0.012) * upper(p0);
            let wing = gauss(q, v(0.013, -0.036, 0.098), v(0.010, 0.008, 0.010));
            v(0.0, 0.0040 * g + 0.0012 * wing, 0.0008 * g)
        }
        m::LOWER_DOWN => {
            let g = lip_zone(p0, 0.023, 0.013) * (1.0 - upper(p0));
            v(0.0, -0.0044 * g, 0.0012 * g)
        }
        m::PRESS => {
            let g = lip_zone(p0, 0.027, 0.0085);
            let ud = if upper(p0) > 0.5 { -1.0 } else { 1.0 };
            v(0.0, 0.0007 * ud * g, -0.0024 * g)
        }
        m::TUCK => {
            let lo = lip_zone(p0, 0.023, 0.012) * (1.0 - upper(p0));
            let up = lip_zone(p0, 0.023, 0.011) * upper(p0);
            v(0.0, 0.0030 * lo + 0.0016 * up, -0.0046 * lo)
        }
        m::CHEEK_PUFF => {
            let g = gauss(q, v(0.045, -0.050, 0.055), v(0.022, 0.022, 0.030));
            v(sx * 0.9, 0.0, 0.45) * (0.0085 * g)
        }
        m::BROW_UP_L | m::BROW_UP_R => {
            let s = side(m::BROW_UP_L);
            let g = gauss(q, v(0.032, 0.034, 0.075), v(0.030, 0.016, 0.030)) * side_w(p0.x, s);
            v(0.0, 0.0068 * g, 0.0006 * g)
        }
        m::BROW_DOWN_L | m::BROW_DOWN_R => {
            let s = side(m::BROW_DOWN_L);
            let g = gauss(q, v(0.030, 0.032, 0.075), v(0.030, 0.014, 0.030)) * side_w(p0.x, s);
            v(-s * 0.0022 * g, -0.0046 * g, 0.0010 * g)
        }
        m::BLINK_L | m::BLINK_R => blink(p0, side(m::BLINK_L), 1.0, 0.0),
        m::SQUINT_L | m::SQUINT_R => {
            let s = side(m::SQUINT_L);
            let cheek = gauss(q, v(0.036, -0.014, 0.074), v(0.020, 0.010, 0.020)) * side_w(p0.x, s);
            blink(p0, s, 0.30, 0.30) + v(0.0, 0.0016 * cheek, 0.0008 * cheek)
        }
        m::JAW_LEFT => v(-0.0050, 0.0, 0.0) * jaw_weight(p0),
        m::JAW_RIGHT => v(0.0050, 0.0, 0.0) * jaw_weight(p0),
        m::JAW_FWD => v(0.0, 0.0, 0.0050) * jaw_weight(p0),
        _ => Vec3::ZERO,
    }
}

/// mouth vector (our 10 channels + `lips`) -> morph weights (mouth morphs only)
pub fn mouth_to_morphs(mo: &Mouth) -> [f32; N] {
    let c = mo.clamped();
    let mut w = [0.0; N];
    // F/V = lips nearly closed + raised upper lip: the lower lip tucks under the teeth
    let tuck = (c.closed.min(c.upper_raise * 2.0) * 1.4).min(1.0);
    w[m::TUCK] = tuck;
    w[m::PRESS] = c.closed * (1.0 - tuck);
    w[m::JAW_OPEN] = SPEECH_JAW * c.open * (1.0 - 0.85 * c.closed) + 0.03 * c.sib;
    w[m::PUCKER] = c.round;
    let wide = 0.75 * c.wide + 0.30 * c.sib;
    w[m::WIDE_L] = wide;
    w[m::WIDE_R] = wide;
    w[m::SMILE_L] = c.corner_l.max(0.0) + 0.25 * c.wide;
    w[m::SMILE_R] = c.corner_r.max(0.0) + 0.25 * c.wide;
    w[m::FROWN_L] = (-c.corner_l).max(0.0);
    w[m::FROWN_R] = (-c.corner_r).max(0.0);
    w[m::UPPER_RAISE] = 0.9 * c.upper_raise * (1.0 - tuck) + 0.35 * c.sib + 0.12 * c.open + 0.10 * c.lips;
    w[m::LOWER_DOWN] = 0.35 * c.open + 0.45 * c.sib + 0.20 * c.lips;
    w[m::JAW_LEFT] = (-c.jaw_side).max(0.0);
    w[m::JAW_RIGHT] = c.jaw_side.max(0.0);
    w[m::JAW_FWD] = c.jaw_fwd;
    for x in &mut w {
        *x = x.clamp(0.0, 1.0);
    }
    w
}

/// morph weights of the standard visemes (rest + the 16 of `rig::STANDARD_VISEMES`),
/// with per-viseme touches the plain channel mapping cannot express
pub fn viseme_table() -> Vec<(&'static str, [f32; N])> {
    STANDARD_VISEMES
        .iter()
        .map(|(name, ch)| {
            let mut w = mouth_to_morphs(&Mouth::from_channels(*ch));
            match *name {
                "FV" => {
                    w[m::TUCK] = 0.9;
                    w[m::PRESS] = 0.0;
                    w[m::UPPER_RAISE] = 0.35;
                }
                "M_P_B" => {
                    w[m::PRESS] = 1.0;
                    w[m::JAW_OPEN] = 0.0;
                }
                "CH_J_SH" => w[m::PUCKER] = 0.55,
                "L" => w[m::UPPER_RAISE] = 0.35,
                "AA" => w[m::LOWER_DOWN] = 0.5,
                _ => {}
            }
            (*name, w)
        })
        .collect()
}

pub fn viseme_weights(name: &str) -> Option<[f32; N]> {
    viseme_table().into_iter().find(|(n, _)| *n == name).map(|(_, w)| w)
}
