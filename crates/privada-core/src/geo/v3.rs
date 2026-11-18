//! f64 vector math that replicates three.js `Vector3` / `Matrix4` operation order
//! exactly (JS numbers are f64), so meshes built here match the JS builders.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct V3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[inline]
pub const fn v3(x: f64, y: f64, z: f64) -> V3 {
    V3 { x, y, z }
}

impl V3 {
    #[inline]
    pub fn sub(self, b: V3) -> V3 {
        v3(self.x - b.x, self.y - b.y, self.z - b.z)
    }
    #[inline]
    pub fn add(self, b: V3) -> V3 {
        v3(self.x + b.x, self.y + b.y, self.z + b.z)
    }
    /// `this.addScaledVector(v, s)`
    #[inline]
    pub fn add_scaled(self, v: V3, s: f64) -> V3 {
        v3(self.x + v.x * s, self.y + v.y * s, self.z + v.z * s)
    }
    #[inline]
    pub fn scale(self, s: f64) -> V3 {
        v3(self.x * s, self.y * s, self.z * s)
    }
    #[inline]
    pub fn dot(self, v: V3) -> f64 {
        self.x * v.x + self.y * v.y + self.z * v.z
    }
    #[inline]
    pub fn length_sq(self) -> f64 {
        self.x * self.x + self.y * self.y + self.z * self.z
    }
    #[inline]
    pub fn length(self) -> f64 {
        self.length_sq().sqrt()
    }
    /// `normalize()` = `divideScalar(length() || 1)` = `multiplyScalar(1 / s)`
    #[inline]
    pub fn normalize(self) -> V3 {
        let l = self.length();
        let s = if l == 0.0 || l.is_nan() { 1.0 } else { l };
        self.scale(1.0 / s)
    }
    /// `crossVectors(a, b)`
    #[inline]
    pub fn cross(a: V3, b: V3) -> V3 {
        v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
    }
    /// `this.distanceToSquared(v)`
    #[inline]
    pub fn dist_sq(self, v: V3) -> f64 {
        let dx = self.x - v.x;
        let dy = self.y - v.y;
        let dz = self.z - v.z;
        dx * dx + dy * dy + dz * dz
    }
    #[inline]
    pub fn dist(self, v: V3) -> f64 {
        self.dist_sq(v).sqrt()
    }
    /// `this.applyMatrix4(m)` with column-major elements (three.js layout)
    #[inline]
    pub fn apply_m4(self, e: &[f64; 16]) -> V3 {
        let (x, y, z) = (self.x, self.y, self.z);
        let w = 1.0 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
        v3(
            (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
            (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
            (e[2] * x + e[6] * y + e[10] * z + e[14]) * w,
        )
    }
}

/// `Matrix4.makeRotationAxis(axis, angle)` (axis assumed normalized), column-major.
pub fn rotation_axis(axis: V3, angle: f64) -> [f64; 16] {
    let c = angle.cos();
    let s = angle.sin();
    let t = 1.0 - c;
    let (x, y, z) = (axis.x, axis.y, axis.z);
    let tx = t * x;
    let ty = t * y;
    // set(n11..n44) row-major -> te column-major
    let (n11, n12, n13, n14) = (tx * x + c, tx * y - s * z, tx * z + s * y, 0.0);
    let (n21, n22, n23, n24) = (tx * y + s * z, ty * y + c, ty * z - s * x, 0.0);
    let (n31, n32, n33, n34) = (tx * z - s * y, ty * z + s * x, t * z * z + c, 0.0);
    let (n41, n42, n43, n44) = (0.0, 0.0, 0.0, 1.0);
    [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44]
}

/// `MathUtils.clamp`
#[inline]
pub fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    lo.max(hi.min(v))
}

/// JS `Math.round` for finite values (round half toward +inf)
#[inline]
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// V8's `Math.hypot` (Kahan-compensated sum of squares of x/max, then sqrt * max)
pub fn js_hypot(vals: &[f64]) -> f64 {
    let mut max = 0.0f64;
    for &v in vals {
        let a = v.abs();
        if a.is_nan() {
            return f64::NAN;
        }
        if a > max {
            max = a;
        }
    }
    if max == 0.0 {
        return 0.0;
    }
    if max.is_infinite() {
        return f64::INFINITY;
    }
    let mut sum = 0.0f64;
    let mut comp = 0.0f64;
    for &v in vals {
        let n = v.abs() / max;
        let summand = n * n - comp;
        let pre = sum + summand;
        comp = (pre - sum) - summand;
        sum = pre;
    }
    sum.sqrt() * max
}

/// The accessory PRNG from web/src/accessories/index.js (`rng(seed)`, mulberry32 variant).
pub struct JsRng {
    seed: u32,
}

impl JsRng {
    pub fn new(seed: i64) -> Self {
        JsRng { seed: (seed as i32) as u32 }
    }
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f64 {
        self.seed = self.seed.wrapping_add(0x6d2b79f5);
        let s = self.seed;
        let mut t = (s ^ (s >> 15)).wrapping_mul(1 | s);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}
