//! Small shared helpers: damped spring, deterministic RNG, easing.

/// Damped spring: the source of every smooth / bouncy motion in the rig
/// (same integration as web/src/anim/spring.js).
#[derive(Clone, Copy, Debug)]
pub struct Spring {
    pub k: f32,
    pub d: f32,
    pub x: f32,
    pub v: f32,
    pub target: f32,
}

impl Spring {
    pub const fn new(k: f32, d: f32) -> Self {
        Self { k, d, x: 0.0, v: 0.0, target: 0.0 }
    }
    pub const fn at(k: f32, d: f32, x: f32) -> Self {
        Self { k, d, x, v: 0.0, target: x }
    }
    #[inline]
    pub fn step(&mut self, dt: f32) -> f32 {
        let a = self.k * (self.target - self.x) - self.d * self.v;
        self.v += a * dt;
        self.x += self.v * dt;
        self.x
    }
}

/// Deterministic xorshift RNG (same seed => same simulation on every machine).
#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    /// uniform in [0, 1)
    #[inline]
    pub fn next(&mut self) -> f32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        ((x >> 40) as f32) / ((1u64 << 24) as f32)
    }
    #[inline]
    pub fn range(&mut self, a: f32, b: f32) -> f32 {
        a + self.next() * (b - a)
    }
}

#[inline]
pub fn clamp(x: f32, a: f32, b: f32) -> f32 {
    x.max(a).min(b)
}

/// smoothstep from a to b (same as geo.js `smooth`)
#[inline]
pub fn smooth(a: f32, b: f32, x: f32) -> f32 {
    let t = clamp((x - a) / (b - a), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spring_converges() {
        let mut s = Spring::new(120.0, 14.0);
        s.target = 1.0;
        for _ in 0..600 {
            s.step(1.0 / 120.0);
        }
        assert!((s.x - 1.0).abs() < 1e-3);
    }
    #[test]
    fn rng_is_deterministic_and_in_range() {
        let mut a = Rng::new(7);
        let mut b = Rng::new(7);
        for _ in 0..1000 {
            let x = a.next();
            assert_eq!(x, b.next());
            assert!((0.0..1.0).contains(&x));
        }
    }
}
