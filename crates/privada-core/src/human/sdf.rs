//! Signed-distance primitives + smooth boolean ops used to sculpt the human character.
//! Distances are metres; negative = inside.
use glam::Vec3;

#[inline]
pub fn v(x: f32, y: f32, z: f32) -> Vec3 {
    Vec3::new(x, y, z)
}
/// polynomial smooth minimum (union), `k` = blend width in metres
#[inline]
pub fn smin(a: f32, b: f32, k: f32) -> f32 {
    if k <= 0.0 {
        return a.min(b);
    }
    let h = (k - (a - b).abs()).max(0.0) / k;
    a.min(b) - h * h * k * 0.25
}
/// smooth maximum (intersection); `smax(d, -c, k)` = smooth subtraction of `c`
#[inline]
pub fn smax(a: f32, b: f32, k: f32) -> f32 {
    -smin(-a, -b, k)
}
#[inline]
pub fn sphere(p: Vec3, c: Vec3, r: f32) -> f32 {
    (p - c).length() - r
}
/// ellipsoid (first-order distance bound, exact on the surface)
#[inline]
pub fn ellipsoid(p: Vec3, c: Vec3, r: Vec3) -> f32 {
    let q = p - c;
    let k0 = (q / r).length();
    let k1 = (q / (r * r)).length();
    if k1 < 1e-9 {
        -r.min_element()
    } else {
        k0 * (k0 - 1.0) / k1
    }
}
#[inline]
pub fn capsule(p: Vec3, a: Vec3, b: Vec3, r: f32) -> f32 {
    let (pa, ba) = (p - a, b - a);
    let h = (pa.dot(ba) / ba.length_squared()).clamp(0.0, 1.0);
    (pa - ba * h).length() - r
}
/// capsule whose radius goes from `ra` (at a) to `rb` (at b)
#[inline]
pub fn capsule2(p: Vec3, a: Vec3, b: Vec3, ra: f32, rb: f32) -> f32 {
    let (pa, ba) = (p - a, b - a);
    let h = (pa.dot(ba) / ba.length_squared()).clamp(0.0, 1.0);
    (pa - ba * h).length() - (ra + (rb - ra) * h)
}
/// torus around `axis` (unit) through `c`: ring radius `rr`, tube radius `r`
#[inline]
pub fn torus(p: Vec3, c: Vec3, axis: Vec3, rr: f32, r: f32) -> f32 {
    let q = p - c;
    let h = q.dot(axis);
    let rad = (q - axis * h).length() - rr;
    (rad * rad + h * h).sqrt() - r
}
/// box with rounded edges: `half` = half extents (including the rounding `r`)
#[inline]
pub fn round_box(p: Vec3, c: Vec3, half: Vec3, r: f32) -> f32 {
    let q = (p - c).abs() - (half - Vec3::splat(r));
    q.max(Vec3::ZERO).length() + q.max_element().min(0.0) - r
}
/// rotate `p` around the x axis through `c` by `a` radians (right-handed)
#[inline]
pub fn rot_x(p: Vec3, c: Vec3, a: f32) -> Vec3 {
    let (s, co) = a.sin_cos();
    let q = p - c;
    v(q.x, q.y * co - q.z * s, q.y * s + q.z * co) + c
}
#[inline]
pub fn rot_y(p: Vec3, c: Vec3, a: f32) -> Vec3 {
    let (s, co) = a.sin_cos();
    let q = p - c;
    v(q.x * co + q.z * s, q.y, -q.x * s + q.z * co) + c
}
#[inline]
pub fn rot_z(p: Vec3, c: Vec3, a: f32) -> Vec3 {
    let (s, co) = a.sin_cos();
    let q = p - c;
    v(q.x * co - q.y * s, q.x * s + q.y * co, q.z) + c
}
#[inline]
pub fn sstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
#[inline]
pub fn mix(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
/// gaussian falloff around `c` with per-axis radii
#[inline]
pub fn gauss(p: Vec3, c: Vec3, r: Vec3) -> f32 {
    let q = (p - c) / r;
    (-q.length_squared()).exp()
}
/// cheap deterministic hash -> [0, 1)
#[inline]
pub fn hash(n: u32) -> f32 {
    let mut x = n.wrapping_mul(0x9E37_79B9) ^ 0x85EB_CA6B;
    x ^= x >> 15;
    x = x.wrapping_mul(0x2C1B_3C6D);
    x ^= x >> 12;
    x = x.wrapping_mul(0x297A_2D39);
    x ^= x >> 15;
    (x >> 8) as f32 / (1u32 << 24) as f32
}
/// sRGB 0..255 -> linear rgb
pub fn srgb(r: u8, g: u8, b: u8) -> Vec3 {
    let f = |c: u8| {
        let x = c as f32 / 255.0;
        if x <= 0.04045 { x / 12.92 } else { ((x + 0.055) / 1.055).powf(2.4) }
    };
    v(f(r), f(g), f(b))
}
