//! Mustache hair strands, bowl surface fit and the 12 built-in mustache styles
//! (ports of hairStrands / bowlSurface / mustacheHalves in web/src/accessories/index.js).
use super::curve::CatmullRom;
use super::mesh::Mesh;
use super::shapes::tapered_tube;
use super::v3::{js_hypot, js_round, v3, JsRng, V3};
use std::f64::consts::PI;

#[derive(Clone, Debug)]
pub struct HairOpts {
    pub count: usize,
    pub seg: usize,
    pub radial: usize,
    pub thick: f64,
    pub start: [f64; 2],
    pub len: [f64; 2],
    pub cover: [f64; 2],
    pub twist: f64,
    pub frizz: f64,
    pub droop: f64,
    pub seed: i64,
    pub trim_y: Option<f64>,
}

impl Default for HairOpts {
    fn default() -> Self {
        HairOpts {
            count: 800, seg: 9, radial: 3, thick: 0.0018, start: [0.0, 0.2], len: [0.45, 1.0],
            cover: [0.65, 1.0], twist: 0.8, frizz: 0.0012, droop: 0.0, seed: 1, trim_y: None,
        }
    }
}

#[inline]
fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// `hairStrands(curve, radiusFn, o)`
pub fn hair_strands(curve: &CatmullRom, radius: &dyn Fn(f64) -> f64, o: &HairOpts) -> Mesh {
    let mut rng = JsRng::new(o.seed);
    const FS: usize = 200;
    let (normals, binormals) = curve.frenet(FS);
    let (seg, radial) = (o.seg, o.radial);
    let nv = o.count * (seg + 1) * radial;
    let mut pos = vec![0f32; nv * 3];
    let mut nor = vec![0f32; nv * 3];
    let mut uv = vec![0f32; nv * 2];
    let mut idx: Vec<u32> = Vec::with_capacity(o.count * seg * radial * 6);
    let mut pts = vec![V3::default(); seg + 1];
    let up = v3(0.0, 1.0, 0.0);
    let xv = v3(1.0, 0.0, 0.0);
    let mut v = 0usize;
    for _ in 0..o.count {
        let t0 = lerp(o.start[0], o.start[1], rng.next());
        let t1 = 1f64.min(t0 + lerp(o.len[0], o.len[1], rng.next()));
        let a0 = rng.next() * PI * 2.0;
        let f = lerp(o.cover[0], o.cover[1], rng.next().sqrt());
        let tw = (rng.next() * 2.0 - 1.0) * o.twist * PI;
        let th = o.thick * lerp(0.6, 1.4, rng.next());
        let dr = o.droop * rng.next();
        let fx = (rng.next() - 0.5) * o.frizz;
        let fy = (rng.next() - 0.5) * o.frizz;
        let fz = (rng.next() - 0.5) * o.frizz;
        for (k, pk) in pts.iter_mut().enumerate() {
            let u = k as f64 / seg as f64;
            let t = lerp(t0, t1, u);
            let fi = js_round(t * FS as f64) as usize;
            let p = curve.point_at(t);
            let r = radius(t) * f * (1.0 - 0.2 * u * u);
            let a = a0 + tw * u;
            let mut q = p.add_scaled(normals[fi], a.cos() * r).add_scaled(binormals[fi], a.sin() * r);
            q.x += fx * u * u;
            q.y += fy * u * u - dr * u * u;
            q.z += fz * u * u;
            if let Some(ty) = o.trim_y {
                if q.y < ty {
                    q.y = ty;
                }
            }
            *pk = q;
        }
        let base = v as u32;
        for k in 0..=seg {
            let u = k as f64 / seg as f64;
            let tdir = pts[(k + 1).min(seg)].sub(pts[k.saturating_sub(1)]).normalize();
            let a = V3::cross(tdir, if tdir.y.abs() < 0.9 { up } else { xv }).normalize();
            let b = V3::cross(tdir, a);
            let rr = th * (1.0 - 0.9 * u) + 0.00015;
            for j in 0..radial {
                let ang = (j as f64 / radial as f64) * PI * 2.0;
                let (ca, sa) = (ang.cos(), ang.sin());
                let n = v3(a.x * ca + b.x * sa, a.y * ca + b.y * sa, a.z * ca + b.z * sa);
                let pk = pts[k];
                pos[v * 3] = (pk.x + n.x * rr) as f32;
                pos[v * 3 + 1] = (pk.y + n.y * rr) as f32;
                pos[v * 3 + 2] = (pk.z + n.z * rr) as f32;
                nor[v * 3] = n.x as f32;
                nor[v * 3 + 1] = n.y as f32;
                nor[v * 3 + 2] = n.z as f32;
                uv[v * 2] = (j as f64 / radial as f64) as f32;
                uv[v * 2 + 1] = u as f32;
                v += 1;
            }
        }
        let r32 = radial as u32;
        for k in 0..seg as u32 {
            for j in 0..r32 {
                let a = base + k * r32 + j;
                let b = base + k * r32 + ((j + 1) % r32);
                idx.extend_from_slice(&[a, a + r32, b, b, a + r32, b + r32]);
            }
        }
    }
    Mesh { positions: pos, normals: nor, uvs: uv, indices: idx }
}

/* ------------------------------------------------------- bowl surface */

pub const FACE_Y: f64 = 0.5;
pub const FACE_Z: f64 = 0.464;

pub fn default_bowl_profile() -> Vec<[f64; 2]> {
    vec![
        [0.001, 0.0], [0.3, 0.0], [0.312, 0.012], [0.3, 0.035], [0.25, 0.1], [0.225, 0.2], [0.24, 0.3],
        [0.3, 0.39], [0.36, 0.47], [0.395, 0.55], [0.41, 0.6], [0.412, 0.622], [0.402, 0.636], [0.37, 0.638],
    ]
}

pub struct BowlSurface {
    outer: Vec<[f64; 2]>,
    sz: f64,
    k: f64,
}

impl BowlSurface {
    pub fn new(prof: &[[f64; 2]], sz: f64, k: f64) -> Self {
        let mut top = 1;
        for i in 1..prof.len() {
            if prof[i][1] >= prof[top][1] {
                top = i;
            } else {
                break;
            }
        }
        BowlSurface { outer: prof[1..=top].to_vec(), sz, k }
    }
    fn r_at(&self, y: f64) -> f64 {
        let o = &self.outer;
        if y <= o[0][1] {
            return o[0][0];
        }
        for i in 1..o.len() {
            if y <= o[i][1] {
                let [r0, y0] = o[i - 1];
                let [r1, y1] = o[i];
                let d = y1 - y0;
                return r0 + ((r1 - r0) * (y - y0)) / (if d == 0.0 { 1.0 } else { d });
            }
        }
        o[o.len() - 1][0]
    }
    fn at(&self, r: f64, phi: f64) -> (f64, f64) {
        let xs = r * phi.sin();
        let zs = self.sz * r * phi.cos();
        let h = js_hypot(&[xs, zs]);
        (xs * (1.0 - (self.k * zs) / (if h == 0.0 { 1.0 } else { h })), zs)
    }
    /// z of the bowl's front glaze at socket-space (x, y), relative to the socket
    pub fn surf(&self, x: f64, y: f64) -> f64 {
        let r = self.r_at(FACE_Y + y);
        let ax = x.abs();
        let mut z = 0.0;
        if ax < r {
            let (mut lo, mut hi) = (0.0, PI / 2.0);
            for _ in 0..28 {
                let mid = (lo + hi) / 2.0;
                if self.at(r, mid).0 < ax {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            z = self.at(r, (lo + hi) / 2.0).1;
        }
        z - FACE_Z
    }
}

/* ------------------------------------------------------- mustache styles */

pub struct Style {
    pub pts: Vec<[f64; 2]>,
    pub radius: fn(f64) -> f64,
    pub knot: f64,
    pub hug_x: f64,
    pub hang_from: Option<f64>,
    pub trim_y: Option<f64>,
    pub mid: usize,
    pub hair: HairOpts,
}

fn ho(count: usize, seg: usize, thick: f64, start: [f64; 2], len: [f64; 2], cover: [f64; 2], twist: f64, frizz: f64, droop: f64) -> HairOpts {
    HairOpts { count, seg, thick, start, len, cover, twist, frizz, droop, ..HairOpts::default() }
}

/// The built-in styles, identical to the registerMustache(...) specs in accessories/index.js.
pub fn style(id: &str) -> Option<Style> {
    let base = |pts: Vec<[f64; 2]>, radius: fn(f64) -> f64, knot: f64, hair: HairOpts| Style {
        pts, radius, knot, hug_x: 0.26, hang_from: None, trim_y: None, mid: 220, hair,
    };
    Some(match id {
        "mustache_handlebar" => base(
            vec![[-0.015, 0.0], [0.05, -0.006], [0.11, -0.02], [0.17, -0.028], [0.215, -0.016], [0.243, 0.012], [0.248, 0.045], [0.228, 0.064], [0.205, 0.054]],
            |t| 0.004 + 0.034 * (1.0 - t).powf(1.15), 0.03,
            ho(1100, 10, 0.0016, [0.0, 0.25], [0.35, 1.0], [0.72, 1.0], 0.7, 0.0015, 0.0),
        ),
        "mustache_walrus" => base(
            vec![[-0.02, 0.01], [0.06, 0.0], [0.13, -0.03], [0.185, -0.075], [0.215, -0.12], [0.225, -0.15]],
            |t| 0.018 + 0.05 * (1.0 - t).powf(0.8), 0.055,
            ho(1500, 9, 0.002, [0.0, 0.35], [0.3, 0.9], [0.6, 1.08], 0.35, 0.008, 0.012),
        ),
        "mustache_chevron" => base(
            vec![[-0.015, 0.01], [0.06, 0.006], [0.12, -0.008], [0.17, -0.032], [0.2, -0.058]],
            |t| 0.02 + 0.03 * (1.0 - t).powf(0.6), 0.05,
            ho(900, 8, 0.0019, [0.0, 0.3], [0.4, 0.9], [0.65, 1.03], 0.25, 0.004, 0.006),
        ),
        "mustache_pencil" => Style {
            mid: 80,
            ..base(
                vec![[-0.01, 0.0], [0.06, -0.003], [0.12, -0.008], [0.17, -0.012], [0.205, -0.011]],
                |t| 0.003 + 0.007 * (1.0 - t).powf(0.5), 0.009,
                ho(420, 8, 0.0009, [0.0, 0.25], [0.4, 1.0], [0.6, 1.0], 0.2, 0.0006, 0.0),
            )
        },
        "mustache_fu_manchu" => Style {
            hang_from: Some(-0.06),
            mid: 120,
            ..base(
                vec![[-0.01, 0.0], [0.06, -0.008], [0.11, -0.03], [0.13, -0.08], [0.135, -0.16], [0.14, -0.26], [0.145, -0.36]],
                |t| 0.004 + 0.012 * (1.0 - t).powf(0.7), 0.016,
                ho(600, 12, 0.0012, [0.0, 0.15], [0.5, 1.0], [0.6, 1.0], 0.45, 0.003, 0.0),
            )
        },
        "mustache_horseshoe" => base(
            vec![[-0.01, 0.0], [0.07, -0.005], [0.13, -0.015], [0.17, -0.05], [0.185, -0.12], [0.19, -0.2]],
            |t| 0.026 - 0.012 * t, 0.03,
            ho(800, 10, 0.0017, [0.0, 0.2], [0.4, 1.0], [0.65, 1.02], 0.2, 0.003, 0.0),
        ),
        "mustache_english" => Style {
            hug_x: 0.22,
            ..base(
                vec![[-0.01, 0.0], [0.07, -0.004], [0.14, -0.006], [0.21, -0.004], [0.28, 0.0], [0.33, 0.004]],
                |t| 0.002 + 0.03 * (1.0 - t).powf(1.3), 0.028,
                ho(700, 10, 0.0015, [0.0, 0.2], [0.45, 1.0], [0.75, 1.0], 0.5, 0.001, 0.0),
            )
        },
        "mustache_dali" => Style {
            mid: 100,
            ..base(
                vec![[-0.01, 0.0], [0.04, -0.004], [0.075, -0.01], [0.1, 0.0], [0.113, 0.04], [0.122, 0.09], [0.128, 0.14]],
                |t| 0.0012 + 0.012 * (1.0 - t).powf(1.2), 0.014,
                ho(600, 10, 0.0011, [0.0, 0.2], [0.5, 1.0], [0.75, 1.0], 0.9, 0.0005, 0.0),
            )
        },
        "mustache_imperial" => base(
            vec![[-0.015, 0.005], [0.06, 0.0], [0.12, -0.012], [0.17, -0.008], [0.2, 0.02], [0.215, 0.06], [0.215, 0.095]],
            |t| 0.008 + 0.04 * (1.0 - t).powf(0.9), 0.045,
            ho(860, 9, 0.0019, [0.0, 0.3], [0.4, 1.0], [0.62, 1.05], 0.5, 0.005, 0.0),
        ),
        "mustache_lampshade" => Style {
            trim_y: Some(-0.02),
            hug_x: 0.3,
            ..base(
                vec![[-0.01, 0.0], [0.06, 0.0], [0.11, -0.004], [0.155, -0.01]],
                |t| 0.032 - 0.012 * t, 0.024,
                ho(900, 8, 0.0017, [0.0, 0.4], [0.4, 0.8], [0.65, 1.0], 0.15, 0.002, 0.01),
            )
        },
        "mustache_pancho" => Style {
            hang_from: Some(-0.12),
            ..base(
                vec![[-0.02, 0.01], [0.07, 0.0], [0.14, -0.035], [0.19, -0.09], [0.215, -0.16], [0.22, -0.22]],
                |t| 0.02 + 0.05 * (1.0 - t).powf(0.8), 0.06,
                ho(860, 9, 0.0021, [0.0, 0.35], [0.35, 0.95], [0.6, 1.08], 0.3, 0.007, 0.02),
            )
        },
        "mustache_curly" => {
            let mut pts = vec![[-0.01, 0.0], [0.06, -0.008], [0.12, -0.016], [0.16, -0.019]];
            for i in 0..=16 {
                let a = -PI / 2.0 + (i as f64 / 16.0) * PI * 4.0;
                let rr = 0.038 * (1.0 - (i as f64 / 16.0) * 0.8);
                pts.push([0.19 + a.cos() * rr, 0.02 + a.sin() * rr]);
            }
            Style {
                hug_x: 0.3,
                ..base(pts, |t| 0.0025 + 0.025 * (1.0 - t), 0.028,
                    ho(550, 14, 0.0015, [0.0, 0.15], [0.5, 1.0], [0.72, 1.0], 0.6, 0.001, 0.0))
            }
        }
        _ => return None,
    })
}

pub const STYLE_IDS: [&str; 12] = [
    "mustache_handlebar", "mustache_walrus", "mustache_chevron", "mustache_pencil", "mustache_fu_manchu",
    "mustache_horseshoe", "mustache_english", "mustache_dali", "mustache_imperial", "mustache_lampshade",
    "mustache_pancho", "mustache_curly",
];

pub struct MustacheCtx<'a> {
    pub st: &'a Style,
    pub surf: BowlSurface,
    pub l: f64,
    pub th: f64,
}

impl MustacheCtx<'_> {
    fn radius(&self, t: f64) -> f64 {
        (self.st.radius)(t) * self.th
    }
    fn z_of(&self, x: f64, y: f64, r: f64) -> f64 {
        let mut z = self.surf.surf(x, y);
        let hug = self.st.hug_x;
        if x > hug {
            let z0 = self.surf.surf(hug, y);
            let z1 = self.surf.surf(hug - 0.01, y);
            z = z.max(z0 + ((z0 - z1) / 0.01) * 0.5 * (x - hug));
        }
        if let Some(h) = self.st.hang_from {
            if y < h {
                z = z.max(self.surf.surf(x, h));
            }
        }
        z + 0.008 + r * 0.55
    }
    fn half_points(&self, side: f64) -> Vec<V3> {
        let n = self.st.pts.len();
        self.st
            .pts
            .iter()
            .enumerate()
            .map(|(i, &[x, y])| {
                let (xx, yy) = (x * self.l, y * self.l);
                v3(xx * side, yy, self.z_of(xx, yy, self.radius(i as f64 / (n - 1) as f64)))
            })
            .collect()
    }
    /// dark core tube of one half (with the lampshade trim + recomputed normals)
    pub fn core(&self, side: f64) -> Mesh {
        let pts = self.half_points(side);
        let mut m = tapered_tube(&pts, &|t| self.radius(t) * 0.78, 96, 12);
        if let Some(ty) = self.st.trim_y {
            for i in 0..m.vertex_count() {
                if (m.positions[i * 3 + 1] as f64) < ty {
                    m.positions[i * 3 + 1] = ty as f32;
                }
            }
            m.compute_vertex_normals();
        }
        m
    }
    /// hair strands of one half (si = 0 for the right half, 1 for the left)
    pub fn hair(&self, side: f64, si: i64) -> Mesh {
        let curve = CatmullRom::new(self.half_points(side));
        let mut o = self.st.hair.clone();
        o.trim_y = self.st.trim_y;
        o.seed = 11 + si * 101;
        hair_strands(&curve, &|t| self.radius(t), &o)
    }
    /// short hairs over the centre join
    pub fn mid(&self) -> Mesh {
        let kr = self.st.knot * self.th;
        let pts: Vec<V3> = [-0.03f64, 0.0, 0.03]
            .iter()
            .map(|&x| v3(x, if x != 0.0 { 0.0 } else { -0.002 }, self.z_of(x.abs(), 0.0, kr)))
            .collect();
        let curve = CatmullRom::new(pts);
        let o = HairOpts {
            count: self.st.mid, seg: 6, start: [0.0, 0.4], len: [0.4, 0.7], twist: 0.3,
            thick: self.st.hair.thick, trim_y: self.st.trim_y, seed: 5, ..HairOpts::default()
        };
        hair_strands(&curve, &|_| kr * 0.95, &o)
    }
    /// knot sphere z (socket space) so JS can place its SphereGeometry
    pub fn knot_z(&self) -> f64 {
        let kr = self.st.knot * self.th;
        self.z_of(0.0, 0.0, kr)
    }
}

/// shared by tests: does |a - b| stay tiny
#[allow(dead_code)]
pub(crate) fn approx(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-9
}
