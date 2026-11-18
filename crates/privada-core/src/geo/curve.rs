//! three.js `CatmullRomCurve3` (open, centripetal) + `Curve` arc-length helpers and
//! `computeFrenetFrames`, ported with the same arithmetic order.
use super::v3::{clamp, rotation_axis, v3, V3};

pub struct CatmullRom {
    pub points: Vec<V3>,
    lengths: Vec<f64>,
}

struct Poly {
    c0: f64,
    c1: f64,
    c2: f64,
    c3: f64,
}

impl Poly {
    fn nonuniform(x0: f64, x1: f64, x2: f64, x3: f64, dt0: f64, dt1: f64, dt2: f64) -> Poly {
        let mut t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
        let mut t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
        t1 *= dt1;
        t2 *= dt1;
        // init(x1, x2, t1, t2)
        Poly { c0: x1, c1: t1, c2: -3.0 * x1 + 3.0 * x2 - 2.0 * t1 - t2, c3: 2.0 * x1 - 2.0 * x2 + t1 + t2 }
    }
    fn calc(&self, t: f64) -> f64 {
        let t2 = t * t;
        let t3 = t2 * t;
        self.c0 + self.c1 * t + self.c2 * t2 + self.c3 * t3
    }
}

pub const ARC_DIVISIONS: usize = 200;

impl CatmullRom {
    pub fn new(points: Vec<V3>) -> Self {
        let mut c = CatmullRom { points, lengths: Vec::new() };
        // getLengths(200)
        let mut cache = Vec::with_capacity(ARC_DIVISIONS + 1);
        let mut last = c.point(0.0);
        let mut sum = 0.0;
        cache.push(0.0);
        for p in 1..=ARC_DIVISIONS {
            let cur = c.point(p as f64 / ARC_DIVISIONS as f64);
            sum += cur.dist(last);
            cache.push(sum);
            last = cur;
        }
        c.lengths = cache;
        c
    }

    /// `getPoint(t)` (curveType 'centripetal', closed = false)
    pub fn point(&self, t: f64) -> V3 {
        let pts = &self.points;
        let l = pts.len();
        let p = (l as f64 - 1.0) * t;
        let mut int_point = p.floor() as i64;
        let mut weight = p - int_point as f64;
        if weight == 0.0 && int_point == l as i64 - 1 {
            int_point = l as i64 - 2;
            weight = 1.0;
        }
        let ip = int_point as usize;
        // three reuses one `tmp` vector for both extrapolations (aliasing when l == 2)
        let mut tmp = V3::default();
        let p0_is_tmp;
        let mut p0 = V3::default();
        if int_point > 0 {
            p0 = pts[(ip - 1) % l];
            p0_is_tmp = false;
        } else {
            tmp = pts[0].sub(pts[1]).add(pts[0]);
            p0_is_tmp = true;
        }
        let p1 = pts[ip % l];
        let p2 = pts[(ip + 1) % l];
        let p3 = if ip + 2 < l {
            pts[(ip + 2) % l]
        } else {
            tmp = pts[l - 1].sub(pts[l - 2]).add(pts[l - 1]);
            tmp
        };
        if p0_is_tmp {
            p0 = tmp;
        }
        let pw = 0.25;
        let mut dt0 = p0.dist_sq(p1).powf(pw);
        let mut dt1 = p1.dist_sq(p2).powf(pw);
        let mut dt2 = p2.dist_sq(p3).powf(pw);
        if dt1 < 1e-4 {
            dt1 = 1.0;
        }
        if dt0 < 1e-4 {
            dt0 = dt1;
        }
        if dt2 < 1e-4 {
            dt2 = dt1;
        }
        let px = Poly::nonuniform(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2);
        let py = Poly::nonuniform(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2);
        let pz = Poly::nonuniform(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2);
        v3(px.calc(weight), py.calc(weight), pz.calc(weight))
    }

    /// `getUtoTmapping(u)`
    pub fn u_to_t(&self, u: f64) -> f64 {
        let a = &self.lengths;
        let il = a.len();
        let target = u * a[il - 1];
        let (mut low, mut high): (i64, i64) = (0, il as i64 - 1);
        while low <= high {
            let i = (low as f64 + ((high - low) as f64) / 2.0).floor() as i64;
            let cmp = a[i as usize] - target;
            if cmp < 0.0 {
                low = i + 1;
            } else if cmp > 0.0 {
                high = i - 1;
            } else {
                high = i;
                break;
            }
        }
        let i = high as usize;
        if a[i] == target {
            return i as f64 / (il - 1) as f64;
        }
        let before = a[i];
        let after = a[i + 1];
        let seg = after - before;
        let frac = (target - before) / seg;
        (i as f64 + frac) / (il - 1) as f64
    }

    pub fn point_at(&self, u: f64) -> V3 {
        self.point(self.u_to_t(u))
    }

    /// `getTangent(t)` (finite difference, delta 1e-4)
    pub fn tangent(&self, t: f64) -> V3 {
        let delta = 0.0001;
        let mut t1 = t - delta;
        let mut t2 = t + delta;
        if t1 < 0.0 {
            t1 = 0.0;
        }
        if t2 > 1.0 {
            t2 = 1.0;
        }
        let a = self.point(t1);
        let b = self.point(t2);
        b.sub(a).normalize()
    }

    pub fn tangent_at(&self, u: f64) -> V3 {
        self.tangent(self.u_to_t(u))
    }

    /// `computeFrenetFrames(segments, false)` -> (normals, binormals)
    pub fn frenet(&self, segments: usize) -> (Vec<V3>, Vec<V3>) {
        let tangents: Vec<V3> = (0..=segments).map(|i| self.tangent_at(i as f64 / segments as f64)).collect();
        let mut normals = Vec::with_capacity(segments + 1);
        let mut binormals = Vec::with_capacity(segments + 1);
        let mut min = f64::MAX;
        let t0 = tangents[0];
        let (tx, ty, tz) = (t0.x.abs(), t0.y.abs(), t0.z.abs());
        let mut normal = V3::default();
        if tx <= min {
            min = tx;
            normal = v3(1.0, 0.0, 0.0);
        }
        if ty <= min {
            min = ty;
            normal = v3(0.0, 1.0, 0.0);
        }
        if tz <= min {
            normal = v3(0.0, 0.0, 1.0);
        }
        let vec = V3::cross(t0, normal).normalize();
        let n0 = V3::cross(t0, vec);
        normals.push(n0);
        binormals.push(V3::cross(t0, n0));
        for i in 1..=segments {
            let mut n = normals[i - 1];
            let vec = V3::cross(tangents[i - 1], tangents[i]);
            if vec.length() > f64::EPSILON {
                let vec = vec.normalize();
                let theta = clamp(tangents[i - 1].dot(tangents[i]), -1.0, 1.0).acos();
                n = n.apply_m4(&rotation_axis(vec, theta));
            }
            normals.push(n);
            binormals.push(V3::cross(tangents[i], n));
        }
        (normals, binormals)
    }
}
