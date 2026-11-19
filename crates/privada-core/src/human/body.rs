//! The body below the neck: skeleton (skeleton.rs, generated), anatomy under the clothes, the
//! hoodie (hood, drawstrings, kangaroo pocket, seams, ribbed cuffs + hem, folds), pants (joggers
//! or jeans), sneakers, hands (5 fingers x 3 phalanges, knuckles, nails), automatic skin weights,
//! cloth UVs + the procedural fabric normal texture, and the capsules for props physics.
//! Model space as in head.rs (origin between the ears, metres), so the floor is at [`FLOOR`].
//! **L = -x**. Bind pose: standing, arms hanging slightly out, palms toward the thighs.
use super::head::NECK_CUT;
use super::iso;
use super::parts::{project_out, Part};
use super::sdf::*;
pub use super::skeleton::{node, FINGERS_L, FINGERS_R, HAND_SEGS, SKELETON, SKIN_BONES, SKIN_CHEST_NECK_HEAD, SKIN_SEGS};
use glam::Vec3;

/// floor height in model space (he is ~1.79 m tall with the hair)
pub const FLOOR: f32 = -1.630;

pub fn bind(i: usize) -> Vec3 {
    Vec3::from_array(SKELETON[i].2)
}
/// bind position relative to the parent
pub fn bind_local(i: usize) -> Vec3 {
    let p = SKELETON[i].1;
    if p < 0 { bind(i) } else { bind(i) - bind(p as usize) }
}

/* ------------------------------------------------------------------ automatic skin weights */
/// up to three (skin index, weight) influences of a body point: inverse distance^4 to the capsule each
/// skin bone owns (smooth blends at shoulders / elbows / knees / knuckles, no bleed across limbs)
pub fn auto_skin(p: Vec3) -> ([u8; 3], [f32; 3]) {
    let mut best: [(u8, f32); 3] = [(0, 0.0); 3];
    for (i, (a, b, r)) in SKIN_SEGS.iter().enumerate() {
        // head / neck are weighted by head.rs for the head meshes; clothes only see the neck
        if i == SKIN_CHEST_NECK_HEAD[2] as usize {
            continue;
        }
        // a limb on the other side never pulls this side (arms next to the hips, legs together)
        if a[0] * p.x < -0.0004 && a[0].abs() > 0.03 {
            continue;
        }
        let d = capsule(p, Vec3::from_array(*a), Vec3::from_array(*b), *r).max(0.0) + if *r < 0.02 { 0.0022 } else { 0.008 };
        let w = 1.0 / (d * d * d * d);
        if w > best[2].1 {
            best[2] = (i as u8, w);
            if best[2].1 > best[1].1 {
                best.swap(1, 2);
            }
            if best[1].1 > best[0].1 {
                best.swap(0, 1);
            }
        }
    }
    let sum: f32 = best.iter().map(|b| b.1).sum();
    let mut w = [best[0].1 / sum, best[1].1 / sum, best[2].1 / sum];
    for x in w.iter_mut().skip(1) {
        if *x < 0.03 {
            *x = 0.0;
        }
    }
    let s = w[0] + w[1] + w[2];
    ([best[0].0, best[1].0, best[2].0], [w[0] / s, w[1] / s, w[2] / s])
}

pub fn skin_part(part: &mut Part) {
    let (idx, w): (Vec<[u8; 3]>, Vec<[f32; 3]>) = part.pos.iter().map(|&p| auto_skin(p)).unzip();
    part.skin_idx = idx;
    part.skin = w;
}

/// UVs for the tiling fabric texture: the vertex is projected along its dominant normal axis
/// (25 uv units per metre = a 4 cm tile)
pub fn cloth_uv(part: &mut Part) {
    part.uv = part
        .pos
        .iter()
        .zip(&part.nrm)
        .map(|(p, n)| {
            let a = n.abs();
            let (u, w) = if a.z >= a.x && a.z >= a.y { (p.x, p.y) } else if a.x >= a.y { (p.z, p.y) } else { (p.x, p.z) };
            [u * 25.0, w * 25.0]
        })
        .collect();
}

/// RGBA tangent-space NORMAL map of a fabric (rgb) + roughness variation (a), tiling, `size` x `size`.
/// kind 0 = knitted cotton fleece / jersey (rows of V stitches), 1 = denim twill (diagonal ribs).
pub fn fabric_texture(size: usize, kind: u32) -> Vec<u8> {
    let n = size.max(8);
    let height = |x: f32, y: f32| -> f32 {
        // x, y in tiles (0..1), periodic
        if kind == 1 {
            let d = (x + y) * 48.0;
            let rib = (d * std::f32::consts::TAU).sin();
            let weft = ((x - y) * 96.0 * std::f32::consts::TAU).sin() * 0.25;
            0.5 + 0.34 * rib + 0.12 * weft
        } else {
            let (cols, rows) = (30.0, 22.0);
            let (cx, cy) = (x * cols, y * rows);
            let fx = cx.fract() - 0.5;
            // each stitch is a little V: two diagonal strokes meeting at the bottom
            let v = (cy.fract() - 0.15 - fx.abs() * 1.1).abs();
            let stitch = (1.0 - (v / 0.22)).clamp(0.0, 1.0);
            let col = (1.0 - (fx.abs() / 0.5).powi(2)).max(0.0);
            0.25 + 0.55 * stitch * col.sqrt() + 0.12 * hash((cx.floor() as u32).wrapping_mul(131) ^ (cy.floor() as u32).wrapping_mul(7919))
        }
    };
    let mut out = vec![0u8; n * n * 4];
    let e = 1.0 / n as f32;
    for y in 0..n {
        for x in 0..n {
            let (u, vv) = (x as f32 * e, y as f32 * e);
            let h = height(u, vv);
            let (dx, dy) = (height((u + e).fract(), vv) - height((u - e + 1.0).fract(), vv), height(u, (vv + e).fract()) - height(u, (vv - e + 1.0).fract()));
            let nrm = v(-dx * 2.2, -dy * 2.2, 1.0).normalize();
            let o = (y * n + x) * 4;
            out[o] = ((nrm.x * 0.5 + 0.5) * 255.0) as u8;
            out[o + 1] = ((nrm.y * 0.5 + 0.5) * 255.0) as u8;
            out[o + 2] = ((nrm.z * 0.5 + 0.5) * 255.0) as u8;
            out[o + 3] = ((0.75 + 0.25 * h).clamp(0.0, 1.0) * 255.0) as u8;
        }
    }
    out
}

/// baked occlusion of a point on an SDF surface (1 = open, lower in creases / folds)
fn ao(f: &dyn Fn(Vec3) -> f32, p: Vec3, n: Vec3, d: f32) -> f32 {
    (0.5 * (f(p + n * d) / d).clamp(0.0, 1.0) + 0.5 * (f(p + n * d * 3.0) / (d * 3.0)).clamp(0.0, 1.0)).clamp(0.0, 1.0)
}
/// dashed stitch line: 1 on the thread, 0 elsewhere (`d` = distance to the seam line, `s` = arc position)
fn stitch(d: f32, s: f32) -> f32 {
    sstep(0.0016, 0.0006, d.abs()) * if (s * 260.0).sin() > -0.2 { 1.0 } else { 0.0 }
}

/* ------------------------------------------------------------------ hoodie */
/// the torso under the fleece (already includes the cloth thickness), mirrored point q = (|x|, y, z)
fn trunk(q: Vec3) -> f32 {
    let mut d = ellipsoid(q, v(0.0, -0.365, -0.028), v(0.172, 0.135, 0.118)); // ribcage
    d = smin(d, ellipsoid(q, v(0.078, -0.345, 0.040), v(0.080, 0.066, 0.052)), 0.040); // chest
    d = smin(d, ellipsoid(q, v(0.085, -0.390, -0.090), v(0.095, 0.125, 0.052)), 0.050); // upper back / lats
    d = smin(d, ellipsoid(q, v(0.0, -0.555, -0.002), v(0.160, 0.150, 0.128)), 0.070); // belly (a slight one)
    d = smin(d, ellipsoid(q, v(0.0, -0.690, -0.030), v(0.168, 0.105, 0.118)), 0.060); // hips
    d = smin(d, capsule2(q, v(0.030, -0.214, -0.046), v(0.172, -0.262, -0.040), 0.047, 0.040), 0.045); // trapezius slope
    smin(d, capsule(q, v(0.0, -0.262, -0.036), v(0.150, -0.272, -0.038), 0.058), 0.050) // shoulder girdle
}
/// the arm inside the sleeve: deltoid, biceps / triceps, elbow, forearm belly, wrist
fn arm(q: Vec3) -> f32 {
    let mut d = ellipsoid(q, v(0.200, -0.298, -0.038), v(0.064, 0.078, 0.068));
    d = smin(d, capsule2(q, v(0.203, -0.310, -0.037), v(0.236, -0.555, -0.035), 0.058, 0.049), 0.030);
    d = smin(d, ellipsoid(q, v(0.216, -0.425, -0.014), v(0.042, 0.088, 0.042)), 0.030);
    d = smin(d, ellipsoid(q, v(0.228, -0.440, -0.062), v(0.040, 0.095, 0.038)), 0.030);
    d = smin(d, capsule2(q, v(0.236, -0.555, -0.035), v(0.2565, -0.770, -0.014), 0.052, 0.041), 0.020);
    smin(d, ellipsoid(q, v(0.244, -0.628, -0.030), v(0.046, 0.088, 0.048)), 0.025)
}
const WRIST_A: Vec3 = Vec3::new(0.2562, -0.768, -0.014);
const WRIST_B: Vec3 = Vec3::new(0.2585, -0.801, -0.012);
const POCKET_Y: f32 = -0.632;
/// kangaroo pocket outline in the front plane: (signed distance, arc coordinate) at (|x|, y)
fn pocket_edge(q: Vec3) -> f32 {
    let w = mix(0.086, 0.124, sstep(-0.565, -0.700, q.y));
    (q.x - w).max((q.y - POCKET_Y).abs() - 0.068)
}
/// eyelet positions of the drawstrings (mirrored)
const EYELET: Vec3 = Vec3::new(0.026, -0.2270, 0.0560);

/// the whole hoodie (model space)
pub fn hoodie_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let mut d = smin(trunk(q), arm(q), 0.032);
    // folds: elbow, armpit, waist (bunched above the hem band), cloth in general
    let we = gauss(q, v(0.238, -0.560, -0.035), v(0.060, 0.045, 0.07));
    d += 0.0024 * we * ((q.y + 0.45 * q.z - 0.3 * q.x) * 140.0 + 1.5 * (q.z * 60.0).sin()).sin();
    // loose sleeve: a few long soft drapes along the forearm instead of rings
    d += 0.0016 * sstep(0.19, 0.22, q.x) * ((q.z * 0.9 + q.y * 0.25) * 95.0).sin() * sstep(-0.76, -0.70, q.y) * sstep(-0.40, -0.48, q.y);
    let wa = gauss(q, v(0.168, -0.338, -0.030), v(0.050, 0.065, 0.075));
    d += 0.0030 * wa * ((q.y + 0.9 * q.x) * 120.0).sin();
    let ww = sstep(-0.600, -0.690, p.y) * sstep(-0.748, -0.722, p.y);
    d += 0.0032 * ww * (p.y * 170.0 + 2.5 * (q.x * 22.0).sin() + 1.5 * (p.z * 30.0).sin()).sin();
    d += 0.0014 * (52.0 * p.x + 17.0 * p.y).sin() * (38.0 * p.y - 23.0 * p.z + 3.0 * p.x).sin();
    // set-in sleeve seam around the shoulder, side seams of the body
    let seam = (q - v(0.168, -0.262, -0.038)).dot(v(0.80, -0.60, 0.0));
    d += 0.0016 * (-(seam / 0.0030).powi(2)).exp() * sstep(0.110, 0.130, q.x) * sstep(-0.420, -0.380, q.y);
    d += 0.0012 * (-((q.z + 0.030) / 0.0028).powi(2)).exp() * sstep(0.120, 0.140, q.x) * sstep(-0.400, -0.440, q.y) * sstep(0.190, 0.170, q.x);
    // sleeve gathers above the ribbed cuff
    d = smin(d, ellipsoid(q, v(0.2555, -0.752, -0.015), v(0.051, 0.024, 0.051)), 0.010);
    d = d.max(-(q.y + 0.770) - 1.0 * sstep(0.20, 0.16, q.x)); // sleeves end at the cuff (the body does not)
    let ca = (q.z - WRIST_A.z).atan2(q.x - WRIST_A.x);
    let cuff = capsule(q, WRIST_A, WRIST_B, 0.0410) - 0.0010 * (ca * 34.0).cos();
    d = smin(d, cuff.max(q.y + 0.772).max(-(q.y + 0.803)), 0.004);
    // hem: the body blouses over a ribbed band
    d = d.max(-(p.y + 0.744) - 1.0 * sstep(0.17, 0.20, q.x));
    let ha = p.x.atan2(p.z + 0.030);
    let band = (ellipsoid(q, v(0.0, -0.760, -0.030), v(0.160, 0.200, 0.111)) - 0.0010 * (ha * 66.0).cos()).max((p.y + 0.762).abs() - 0.021);
    d = smin(d, band, 0.004);
    // kangaroo pocket: a raised panel on the belly, hand openings at its upper sides
    let belly = smin(ellipsoid(q, v(0.0, -0.555, -0.002), v(0.160, 0.150, 0.128)), ellipsoid(q, v(0.0, -0.690, -0.030), v(0.168, 0.105, 0.118)), 0.060);
    let pocket = smax(smax(belly - 0.0068, pocket_edge(q), 0.005), 0.030 - p.z, 0.005);
    d = smin(d, pocket, 0.0025);
    d = smax(d, -capsule(q, v(0.090, -0.578, 0.118), v(0.118, -0.655, 0.108), 0.0075), 0.004);
    // hood lying behind the neck (with its opening), its rim coming around the neck to a V at the front
    let hood = smin(ellipsoid(q, v(0.0, -0.232, -0.118), v(0.112, 0.078, 0.058)), ellipsoid(q, v(0.0, -0.305, -0.128), v(0.088, 0.075, 0.040)), 0.035);
    d = smin(d, hood, 0.030);
    d = smax(d, -ellipsoid(q, v(0.0, -0.186, -0.120), v(0.080, 0.052, 0.036)), 0.012);
    d += 0.0022 * (60.0 * q.x + 30.0 * p.z).sin() * sstep(0.02, 0.0, (p.y + 0.24).abs() - 0.03) * sstep(-0.06, -0.09, p.z);
    let mut rim = capsule(q, v(0.094, -0.204, -0.088), v(0.072, -0.203, -0.012), 0.0195);
    rim = smin(rim, capsule(q, v(0.072, -0.203, -0.012), v(0.031, -0.221, 0.050), 0.0180), 0.010);
    rim = smin(rim, capsule(q, v(0.031, -0.221, 0.050), v(0.0, -0.238, 0.057), 0.0165), 0.010);
    d = smin(d, rim, 0.012);
    // drawstring eyelets
    d = smin(d, torus(q, EYELET, Vec3::Z, 0.0046, 0.0014), 0.0012);
    // neck hole
    smax(d, -capsule(p, v(0.0, -0.090, -0.026), v(0.0, NECK_CUT - 0.004, -0.040), 0.0665), 0.006)
}

/// cheap stand-in for the hoodie (ribcage + belly) used by the cable collision every frame
pub fn torso_proxy_sdf(p: Vec3) -> f32 {
    smin(ellipsoid(p, v(0.0, -0.365, -0.028), v(0.172, 0.135, 0.118)), ellipsoid(p, v(0.0, -0.580, -0.006), v(0.162, 0.170, 0.126)), 0.07)
}

pub fn hoodie(detail: f32) -> Part {
    let c = 0.0054 / detail.clamp(0.25, 2.0);
    let f: &dyn Fn(Vec3) -> f32 = &hoodie_sdf;
    let m = iso::surface_nets(f, &iso::uniform(-0.335, 0.335, c), &iso::uniform(-0.800, -0.110, c), &iso::uniform(-0.200, 0.150, c), 1.7);
    let cloth = srgb(27, 27, 31);
    let thread = srgb(60, 60, 68);
    let mut part = Part::from_iso(m, |p, n| {
        let q = v(p.x.abs(), p.y, p.z);
        let mut col = cloth * (0.55 + 0.45 * ao(f, p, n, 0.006));
        // ribbed cuffs + hem read a touch lighter
        let rib = sstep(-0.742, -0.746, p.y).max(sstep(-0.770, -0.774, q.y) * sstep(0.20, 0.215, q.x));
        col *= 1.0 + 0.22 * rib;
        // stitching: around the pocket, above the hem band, above the cuffs, along the hood rim
        let front = sstep(0.03, 0.06, p.z);
        let mut st = stitch(pocket_edge(q) + 0.004, q.y + q.x) * front * sstep(-0.705, -0.690, p.y);
        st = st.max(stitch(p.y + 0.738, ha_len(p)) * sstep(0.20, 0.17, q.x));
        st = st.max(stitch(q.y + 0.766, (q.z - WRIST_A.z).atan2(q.x - WRIST_A.x) * 0.04) * sstep(0.205, 0.215, q.x));
        col = col.lerp(thread, 0.8 * st);
        // metal eyelets
        let ey = sstep(0.0012, 0.0002, torus(q, EYELET, Vec3::Z, 0.0046, 0.0014));
        col.lerp(srgb(176, 178, 184), ey)
    });
    // drawstrings: flat cords hanging from the eyelets, metal aglets at the ends
    for s in [-1.0f32, 1.0] {
        let pts: Vec<Vec3> = (0..11)
            .map(|i| {
                let t = i as f32 / 10.0;
                let p = v(s * (EYELET.x + 0.010 * t), EYELET.y - 0.004 - 0.135 * t, EYELET.z + 0.020 * t);
                project_out(f, p, 0.0030)
            })
            .collect();
        let frame = vec![Vec3::Z; pts.len()];
        part.tube(&pts, &frame, 6, |t| if t > 0.90 { (0.0027, 0.0027) } else { (0.0024, 0.0017) }, |t| if t > 0.90 { srgb(176, 178, 184) } else { srgb(52, 52, 58) });
    }
    skin_part(&mut part);
    cloth_uv(&mut part);
    part
}
fn ha_len(p: Vec3) -> f32 {
    p.x.atan2(p.z + 0.030) * 0.14
}

/* ------------------------------------------------------------------ pants */
fn leg(q: Vec3, jeans: bool) -> f32 {
    let mut d = ellipsoid(q, v(0.0, -0.775, -0.030), v(0.166, 0.105, 0.118)); // pelvis
    d = smin(d, ellipsoid(q, v(0.072, -0.815, -0.088), v(0.088, 0.090, 0.070)), 0.040); // glutes
    d = smin(d, capsule2(q, v(0.092, -0.800, -0.030), v(0.100, -1.165, -0.022), 0.094, 0.068), 0.035); // thigh
    d = smin(d, ellipsoid(q, v(0.098, -0.930, 0.004), v(0.070, 0.160, 0.062)), 0.030); // quadriceps
    d = smin(d, sphere(q, v(0.100, -1.170, -0.016), 0.066), 0.020); // knee
    if jeans {
        d = smin(d, capsule2(q, v(0.100, -1.170, -0.022), v(0.100, -1.580, -0.034), 0.066, 0.061), 0.020);
    } else {
        d = smin(d, capsule2(q, v(0.100, -1.170, -0.022), v(0.100, -1.500, -0.036), 0.064, 0.051), 0.020);
        d = smin(d, ellipsoid(q, v(0.100, -1.495, -0.036), v(0.062, 0.030, 0.063)), 0.012); // cloth stacking above the cuff
    }
    smin(d, ellipsoid(q, v(0.100, -1.300, -0.050), v(0.053, 0.100, 0.050)), 0.025) // calf
}
const PKT_A: Vec3 = Vec3::new(0.128, -0.742, 0.058);
const PKT_B: Vec3 = Vec3::new(0.166, -0.860, -0.008);
pub fn pants_sdf(p: Vec3, jeans: bool) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let mut d = leg(q, jeans);
    // folds: knees, crotch, ankles (joggers bunch up), general
    let wk = gauss(q, v(0.100, -1.170, -0.020), v(0.090, 0.060, 0.090));
    d += 0.0020 * wk * (p.y * 135.0 + 22.0 * p.z + 1.2 * (q.x * 50.0).sin()).sin();
    let wc = gauss(q, v(0.050, -0.845, 0.030), v(0.075, 0.060, 0.080));
    d += 0.0030 * wc * ((p.y - 0.8 * q.x) * 120.0).sin();
    let wa = sstep(-1.380, -1.480, p.y) * sstep(if jeans { -1.585 } else { -1.512 }, -1.500, p.y);
    d += if jeans { 0.0024 } else { 0.0028 } * wa * (p.y * 165.0 + 2.0 * (q.z * 40.0).sin()).sin();
    d += 0.0014 * (48.0 * p.y + 20.0 * q.x).sin() * (36.0 * p.z - 22.0 * p.y).sin();
    // side seams (outer + inner), slanted side pocket openings
    let leg_x = q.x - mix(0.092, 0.100, sstep(-0.80, -1.17, q.y));
    d += 0.0013 * (-((q.z + 0.026) / 0.0028).powi(2)).exp() * sstep(-0.86, -0.90, q.y) * sstep(0.030, 0.045, leg_x.abs());
    d += 0.0020 * (-(capsule(q, PKT_A, PKT_B, 0.0) / 0.0032).powi(2)).exp();
    if jeans {
        // fly + hem
        d += 0.0012 * (-((q.x - 0.014) / 0.0025).powi(2)).exp() * sstep(-0.86, -0.84, q.y) * sstep(0.0, 0.03, p.z);
        d = d.max(-(p.y + 1.585));
    } else {
        // ribbed ankle cuff
        let a = (p.z + 0.036).atan2(q.x - 0.100);
        let cuff = (capsule(q, v(0.100, -1.500, -0.036), v(0.100, -1.560, -0.036), 0.0455) - 0.0010 * (a * 30.0).cos()).max(-(p.y + 1.557)).max(p.y + 1.508);
        d = d.max(-(p.y + 1.512));
        d = smin(d, cuff, 0.004);
    }
    // waistband (ribbed, under the hoodie hem)
    d.max(p.y + 0.690)
}
fn pants_any(detail: f32, jeans: bool) -> Part {
    let c = 0.0068 / detail.clamp(0.25, 2.0);
    let f = move |p: Vec3| pants_sdf(p, jeans);
    let m = iso::surface_nets(&f, &iso::uniform(-0.25, 0.25, c), &iso::uniform(-1.60, -0.67, c), &iso::uniform(-0.19, 0.12, c), 1.7);
    let base = if jeans { srgb(40, 54, 88) } else { srgb(50, 52, 60) };
    let thread = if jeans { srgb(186, 140, 64) } else { srgb(86, 88, 98) };
    let mut part = Part::from_iso(m, |p, n| {
        let q = v(p.x.abs(), p.y, p.z);
        let mut col = base * (0.55 + 0.45 * ao(&f, p, n, 0.007));
        if jeans {
            // worn lighter on the thighs / knees / seat, dark in the folds
            let wear = gauss(q, v(0.098, -0.95, 0.060), v(0.06, 0.16, 0.05)).max(gauss(q, v(0.10, -1.17, 0.05), v(0.06, 0.07, 0.05))).max(0.7 * gauss(q, v(0.075, -0.82, -0.15), v(0.07, 0.07, 0.05)));
            col = col.lerp(srgb(92, 112, 150) * (0.6 + 0.4 * ao(&f, p, n, 0.007)), 0.55 * wear);
            // back pockets + fly + hem stitching in tobacco thread
            let bp = (q.x - 0.078).abs().max((p.y + 0.835 + 0.25 * (q.x - 0.078).abs()).abs()) - 0.052;
            let mut st = stitch(bp, q.x + p.y) * sstep(-0.10, -0.13, p.z);
            st = st.max(stitch(q.x - 0.020, p.y) * sstep(-0.86, -0.84, p.y) * sstep(0.02, 0.05, p.z));
            st = st.max(stitch(p.y + 1.572, q.x.atan2(p.z) * 0.06));
            st = st.max(stitch(capsule(q, PKT_A, PKT_B, 0.0) - 0.006, p.y));
            col = col.lerp(thread, 0.85 * st);
        } else {
            // heathered cotton, lighter ribbed cuff, pocket piping
            col *= 0.92 + 0.16 * hash(((p.x * 1700.0) as i32 as u32).wrapping_mul(73) ^ ((p.y * 2100.0) as i32 as u32).wrapping_mul(19) ^ (p.z * 1900.0) as i32 as u32);
            col *= 1.0 + 0.2 * sstep(-1.510, -1.514, p.y);
            col = col.lerp(thread, 0.7 * stitch(capsule(q, PKT_A, PKT_B, 0.0) - 0.006, p.y));
        }
        col
    });
    skin_part(&mut part);
    cloth_uv(&mut part);
    part
}
pub fn pants(detail: f32) -> Part {
    pants_any(detail, false)
}
pub fn pants_jeans(detail: f32) -> Part {
    pants_any(detail, true)
}

/* ------------------------------------------------------------------ sneakers */
const SHOE_Z: f32 = 0.0375; // centre of the shoe along its length (heel -0.105 .. toe 0.180)
const SHOE_HL: f32 = 0.1425;
/// shoe-local coordinates of a mirrored point: (across, height above the floor, along, normalized along -1..1)
fn shoe_local(q: Vec3) -> (f32, f32, f32, f32) {
    let z = q.z - SHOE_Z;
    (q.x - 0.100, q.y - FLOOR, z, z / SHOE_HL)
}
/// signed distance to the sole outline in plan (heel narrower than the ball of the foot)
fn shoe_plan(x: f32, z: f32) -> f32 {
    let zn = z / SHOE_HL;
    let wx = mix(0.041, 0.0525, sstep(-1.0, 0.25, zn)) * (1.0 - 0.10 * sstep(0.55, 1.0, zn));
    (((x / wx).powi(2) + zn * zn).sqrt() - 1.0) * wx
}
fn shoe_upper(x: f32, y: f32, z: f32) -> f32 {
    let p = v(x, y, z);
    let mut d = ellipsoid(p, v(0.0, 0.034, 0.088), v(0.047, 0.035, 0.072)); // toe box
    d = smin(d, ellipsoid(p, v(0.0, 0.050, 0.005), v(0.0465, 0.052, 0.092)), 0.030); // mid foot / instep
    d = smin(d, capsule(p, v(0.0, 0.046, -0.072), v(0.0, 0.098, -0.068), 0.0435), 0.030); // heel + ankle
    d.max(shoe_plan(x, z) + 0.0015).max(0.018 - y)
}
pub fn shoes_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    let (x, y0, z, zn) = shoe_local(q);
    // toe spring: the front of the sole curls up a little
    let y = y0 - 0.011 * sstep(0.45, 1.0, zn).powi(2);
    let plan = shoe_plan(x, z);
    // sole: outsole + midsole slab (thicker at the heel), flared a little
    let th = mix(0.030, 0.022, sstep(-0.6, 0.6, zn));
    let (qa, qb) = ((plan - 0.0025).max(0.0), ((y - th * 0.5).abs() - th * 0.5).max(0.0));
    let mut sole = (qa * qa + qb * qb).sqrt() + (plan - 0.0025).max((y - th * 0.5).abs() - th * 0.5).min(0.0) - 0.0025;
    // tread
    sole += 0.0022 * sstep(0.35, 0.15, ((z * 118.0 + x * 55.0).sin()).abs()) * sstep(0.006, 0.002, y);
    // midsole groove
    sole += 0.0010 * (-((y - th * 0.52) / 0.0016).powi(2)).exp();
    let mut d = shoe_upper(x, y, z);
    // panels: toe cap, eyestay, heel counter (raised a hair), stitch grooves between them
    d -= 0.0012 * sstep(0.070, 0.078, z) * sstep(0.050, 0.040, y);
    d -= 0.0014 * sstep(-0.050, -0.058, z);
    d += 0.0011 * (-((z - 0.074) / 0.0022).powi(2)).exp() + 0.0011 * (-((z + 0.054) / 0.0022).powi(2)).exp();
    // ankle opening with a padded collar, tongue
    d = smax(d, -capsule(v(x, y, z), v(0.0, 0.080, -0.064), v(0.0, 0.200, -0.058), 0.0345), 0.004);
    d = smax(d, -capsule(v(x, y, z), v(0.0, 0.098, -0.040), v(0.0, 0.110, 0.012), 0.0200), 0.004); // throat
    d = smin(d, torus(v(x, y, z), v(0.0, 0.104, -0.066), v(0.0, 1.0, 0.12).normalize(), 0.0400, 0.0075), 0.006);
    let tl = rot_x(v(x, y, z), v(0.0, 0.086, -0.012), 0.62);
    d = smin(d, ellipsoid(tl, v(0.0, 0.086, -0.012), v(0.0225, 0.0100, 0.045)), 0.004);
    smin(d, sole, 0.003).max(FLOOR - p.y)
}
pub fn shoes(detail: f32) -> Part {
    let c = 0.0040 / detail.clamp(0.25, 2.0);
    let f: &dyn Fn(Vec3) -> f32 = &shoes_sdf;
    let m = iso::surface_nets(f, &iso::uniform(-0.17, 0.17, c), &iso::uniform(FLOOR - 0.008, -1.485, c), &iso::uniform(-0.085, 0.195, c), 1.7);
    let upper = srgb(42, 44, 52);
    let mut part = Part::from_iso(m, |p, n| {
        let q = v(p.x.abs(), p.y, p.z);
        let (x, y0, z, zn) = shoe_local(q);
        let y = y0 - 0.011 * sstep(0.45, 1.0, zn).powi(2);
        let th = mix(0.030, 0.022, sstep(-0.6, 0.6, zn));
        let k = 0.55 + 0.45 * ao(f, p, n, 0.004);
        let mut col = upper;
        col *= 1.0 - 0.25 * sstep(0.070, 0.078, z) * sstep(0.050, 0.040, y); // toe cap a shade darker
        col *= 1.0 - 0.20 * sstep(-0.050, -0.058, z); // heel counter
        // stitching along the panels and the collar
        let mut st = stitch(z - 0.070, x).max(stitch(z + 0.050, y)).max(stitch(y - 0.092, x.atan2(z + 0.066) * 0.04) * sstep(-0.01, -0.03, z));
        st *= sstep(th + 0.004, th + 0.008, y);
        col = col.lerp(srgb(120, 122, 132), 0.8 * st);
        // tongue + lining inside the opening
        let inside = sstep(0.004, 0.0, capsule(v(x, y, z), v(0.0, 0.080, -0.064), v(0.0, 0.200, -0.058), 0.0345) - 0.002);
        col = col.lerp(srgb(22, 22, 26), inside);
        // midsole off-white, outsole dark rubber
        col = col.lerp(srgb(232, 229, 222), sstep(th + 0.0035, th + 0.0005, y));
        col = col.lerp(srgb(64, 64, 68), sstep(th * 0.50, th * 0.44, y));
        col * k
    });
    // laces: bars across the throat, crossing diagonals, a bow, on metal eyelets
    let lace = srgb(226, 226, 222);
    for s in [-1.0f32, 1.0] {
        let surf = |x: f32, z: f32| {
            // drop a point from above onto the upper
            let mut p = v(s * (0.100 + x), FLOOR + 0.150, SHOE_Z + z);
            for _ in 0..40 {
                let d = shoes_sdf(p);
                if d < 0.0022 {
                    break;
                }
                p.y -= d.min(0.004).max(0.0006);
            }
            p
        };
        let rows: Vec<f32> = (0..5).map(|i| 0.050 - 0.0165 * i as f32).collect();
        for (i, &z) in rows.iter().enumerate() {
            let w = 0.0185 + 0.0015 * i as f32;
            let bar: Vec<Vec3> = (0..7).map(|k| surf(-w + 2.0 * w * k as f32 / 6.0, z)).collect();
            let fr = vec![Vec3::Y; bar.len()];
            part.tube(&bar, &fr, 5, |_| (0.0026, 0.0014), |_| lace);
            if i + 1 < rows.len() {
                for sg in [-1.0f32, 1.0] {
                    let dg: Vec<Vec3> = (0..6).map(|k| { let t = k as f32 / 5.0; surf(sg * w * (1.0 - 2.0 * t) * 0.9, z - 0.0165 * t) + Vec3::Y * 0.0012 }).collect();
                    part.tube(&dg, &vec![Vec3::Y; dg.len()], 5, |_| (0.0024, 0.0013), |_| lace * 0.93);
                }
            }
            // eyelets
            for sg in [-1.0f32, 1.0] {
                let c0 = surf(sg * (w + 0.003), z);
                let ring: Vec<Vec3> = (0..9).map(|k| { let a = k as f32 / 8.0 * std::f32::consts::TAU; c0 + v(0.0032 * a.cos(), 0.0004, 0.0032 * a.sin()) }).collect();
                part.tube(&ring, &vec![Vec3::Y; ring.len()], 4, |_| (0.0009, 0.0009), |_| srgb(170, 172, 178));
            }
        }
        // the bow at the top of the tongue: two loops + two ends
        let knot = surf(0.0, rows[4] - 0.006) + Vec3::Y * 0.004;
        for sg in [-1.0f32, 1.0] {
            let lp: Vec<Vec3> = (0..11)
                .map(|k| {
                    let a = k as f32 / 10.0 * std::f32::consts::TAU;
                    knot + v(s * sg * (0.014 * (1.0 - a.cos())), 0.004 * a.sin().abs() + 0.002, 0.008 * a.sin() + 0.004 * (1.0 - a.cos()))
                })
                .collect();
            part.tube(&lp, &vec![Vec3::Y; lp.len()], 5, |_| (0.0024, 0.0014), |_| lace);
            let end: Vec<Vec3> = (0..6).map(|k| { let t = k as f32 / 5.0; surf(sg * (0.004 + 0.022 * t), rows[4] - 0.006 + 0.020 * t) + Vec3::Y * (0.003 * (1.0 - t) + 0.0012) }).collect();
            part.tube(&end, &vec![Vec3::Y; end.len()], 5, |t| if t > 0.85 { (0.0020, 0.0020) } else { (0.0024, 0.0013) }, |t| if t > 0.85 { srgb(60, 60, 64) } else { lace });
        }
    }
    skin_part(&mut part);
    part
}

/* ------------------------------------------------------------------ hands */
const PALM: Vec3 = Vec3::new(0.2615, -0.862, -0.002);
/// distance to the nail plates (dorsal side of the last phalanx of each finger), mirrored point
fn nails_sdf(q: Vec3) -> f32 {
    let mut d = f32::MAX;
    for k in 0..5 {
        let (a, b, _, rb) = HAND_SEGS[k * 3 + 2];
        let (a, b) = (Vec3::from_array(a), Vec3::from_array(b));
        let dir = (b - a).normalize();
        // dorsal = away from the palm: +x, made perpendicular to the finger
        let out = (Vec3::X - dir * dir.x).normalize();
        let side = dir.cross(out);
        let c = a.lerp(b, 0.62) + out * (rb * 0.92);
        let l = q - c;
        let loc = v(l.dot(side), l.dot(dir), l.dot(out));
        let w = if k == 0 { 0.0064 } else { 0.0054 };
        d = d.min(ellipsoid(loc, Vec3::ZERO, v(w, 0.0072, 0.0016)));
    }
    d
}
pub fn hands_sdf(p: Vec3) -> f32 {
    let q = v(p.x.abs(), p.y, p.z);
    // palm: a flat pad with the thenar / hypothenar eminences and the knuckle ridge
    let mut d = ellipsoid(q, PALM, v(0.0140, 0.0500, 0.0420));
    d = smin(d, ellipsoid(q, v(0.2565, -0.852, -0.030), v(0.0125, 0.0360, 0.0135)), 0.008);
    d = smin(d, capsule(q, v(0.2660, -0.902, 0.030), v(0.2650, -0.894, -0.028), 0.0100), 0.008);
    // wrist (wider than thick)
    let wq = v((q.x - 0.2590) * 1.45 + 0.2590, q.y, q.z);
    d = smin(d, capsule(wq, v(0.2585, -0.776, -0.012), v(0.2600, -0.835, -0.008), 0.0285), 0.012);
    // fingers: 3 phalanges each, knuckles a touch thicker
    let mut fingers = f32::MAX;
    for k in 0..5 {
        let mut fd = f32::MAX;
        for j in 0..3 {
            let (a, b, ra, rb) = HAND_SEGS[k * 3 + j];
            let (a, b) = (Vec3::from_array(a), Vec3::from_array(b));
            fd = smin(fd, capsule2(q, a, b, ra, rb), 0.0030);
            fd = smin(fd, sphere(q, a, ra + if j == 0 && k > 0 { 0.0012 } else { 0.0007 }), 0.0030);
        }
        if k == 0 {
            d = smin(d, fd, 0.010);
        } else {
            fingers = fingers.min(fd);
        }
    }
    d = smin(d, fingers, 0.0045);
    // palm creases (subtle) + nails
    d = smax(d, -capsule(q, v(0.2462, -0.884, 0.034), v(0.2468, -0.872, -0.030), 0.0016), 0.003);
    d = smax(d, -capsule(q, v(0.2462, -0.866, 0.036), v(0.2470, -0.840, -0.006), 0.0016), 0.003);
    d = smin(d, nails_sdf(q), 0.0009);
    d.max(p.y + 0.780)
}
pub fn hands(detail: f32) -> Part {
    let c = 0.0022 / detail.clamp(0.25, 2.0);
    let f: &dyn Fn(Vec3) -> f32 = &hands_sdf;
    let m = iso::surface_nets(f, &iso::uniform(-0.300, 0.300, c), &iso::uniform(-1.010, -0.772, c), &iso::uniform(-0.064, 0.112, c), 1.7);
    let mut part = Part::from_iso(m, |q0, n| {
        let q = v(q0.x.abs(), q0.y, q0.z);
        let k = 1.0 - ao(f, q0, n, 0.004);
        let mut c = srgb(222, 168, 140).lerp(srgb(232, 190, 168), sstep(0.2575, 0.250, q.x)); // paler palm side
        // knuckles and finger tips a little redder
        let mut red = 0.0f32;
        for s in HAND_SEGS.iter() {
            red = red.max((-((q - Vec3::from_array(s.0)).length() / 0.010).powi(2)).exp());
        }
        for kf in 0..5 {
            red = red.max(0.8 * (-((q - Vec3::from_array(HAND_SEGS[kf * 3 + 2].1)).length() / 0.010).powi(2)).exp());
        }
        c = c.lerp(srgb(208, 132, 116), 0.38 * red);
        c = c * v(1.0 - 0.42 * k, 1.0 - 0.56 * k, 1.0 - 0.60 * k);
        // nails
        let nail = sstep(0.0007, -0.0002, nails_sdf(q));
        c.lerp(srgb(236, 204, 194), 0.85 * nail)
    });
    skin_part(&mut part);
    part
}

/// capsules for props physics: (node index, a, b in MODEL space at bind, radius)
pub const COLLIDERS: [(usize, [f32; 3], [f32; 3], f32); 13] = [
    (node::HEAD, [0.0, 0.030, -0.010], [0.0, -0.050, 0.020], 0.092),
    (node::NECK, [0.0, -0.100, -0.026], [0.0, -0.200, -0.036], 0.060),
    (node::CHEST, [-0.090, -0.330, -0.035], [0.090, -0.330, -0.035], 0.125),
    (node::SPINE1, [0.0, -0.480, -0.030], [0.0, -0.660, -0.030], 0.135),
    (node::PELVIS, [-0.060, -0.770, -0.030], [0.060, -0.770, -0.030], 0.115),
    (node::UPPERARM_L, [-0.190, -0.272, -0.038], [-0.236, -0.558, -0.035], 0.058),
    (node::UPPERARM_R, [0.190, -0.272, -0.038], [0.236, -0.558, -0.035], 0.058),
    (node::FOREARM_L, [-0.236, -0.558, -0.035], [-0.262, -0.930, -0.004], 0.046),
    (node::FOREARM_R, [0.236, -0.558, -0.035], [0.262, -0.930, -0.004], 0.046),
    (node::THIGH_L, [-0.092, -0.800, -0.030], [-0.100, -1.170, -0.022], 0.085),
    (node::THIGH_R, [0.092, -0.800, -0.030], [0.100, -1.170, -0.022], 0.085),
    (node::SHIN_L, [-0.100, -1.170, -0.022], [-0.100, -1.600, 0.010], 0.058),
    (node::SHIN_R, [0.100, -1.170, -0.022], [0.100, -1.600, 0.010], 0.058),
];
