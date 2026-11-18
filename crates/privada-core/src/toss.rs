//! Overlay drag / throw / bounce physics in screen pixels (port of `JsToss` in
//! web/src/app/avatar.js, same semantics): rest -> held (dangles) -> fly (gravity,
//! wall/ceiling/floor bounces with restitution and spin) -> ground (rolls upright) ->
//! hop (arcs back to the rest point) -> rest.
//!
//! `y` is the character's feet (bottom) in px, `x` its center; `set_size` is the
//! character box so bounces respect his size.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Rest,
    Held,
    Fly,
    Ground,
    Hop,
}

#[derive(Clone, Debug)]
pub struct Toss {
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
    pub angle: f32,
    pub spin: f32,
    pub squash: f32,
    sv: f32,
    pub rest_x: f32,
    pub rest_y: f32,
    pub w: f32,
    pub h: f32,
    pub state: State,
    t: f32,
    hist: Vec<[f32; 3]>,
    off_x: f32,
    off_y: f32,
    impact: f32,
    hop: [f32; 4], // x0, y0, t, a0
}

impl Default for Toss {
    fn default() -> Self {
        Self::new()
    }
}

#[inline]
fn clamp(x: f32, a: f32, b: f32) -> f32 {
    x.max(a).min(b)
}

impl Toss {
    pub fn new() -> Self {
        Self {
            x: 0.0, y: 0.0, vx: 0.0, vy: 0.0, angle: 0.0, spin: 0.0, squash: 0.0, sv: 0.0,
            rest_x: 0.0, rest_y: 0.0, w: 100.0, h: 100.0, state: State::Rest, t: 0.0,
            hist: Vec::with_capacity(8), off_x: 0.0, off_y: 0.0, impact: 0.0, hop: [0.0; 4],
        }
    }
    pub fn set_rest(&mut self, x: f32, y: f32) {
        self.rest_x = x;
        self.rest_y = y;
        if self.state == State::Rest {
            self.x = x;
            self.y = y;
        }
    }
    pub fn set_size(&mut self, w: f32, h: f32) {
        self.w = w;
        self.h = h;
    }
    pub fn reset(&mut self) {
        self.state = State::Rest;
        self.x = self.rest_x;
        self.y = self.rest_y;
        self.vx = 0.0;
        self.vy = 0.0;
        self.spin = 0.0;
        self.angle = 0.0;
    }
    pub fn grab(&mut self, x: f32, y: f32) {
        self.state = State::Held;
        self.off_x = self.x - x;
        self.off_y = self.y - y;
        self.hist.clear();
        self.spin = 0.0;
    }
    pub fn drag(&mut self, x: f32, y: f32, t: f32) {
        self.x = x + self.off_x;
        self.y = y + self.off_y;
        self.hist.push([self.x, self.y, t]);
        while self.hist.len() > 6 {
            self.hist.remove(0);
        }
    }
    pub fn release(&mut self, _t: f32) {
        if self.hist.len() >= 2 {
            let (a, b) = (self.hist[0], self.hist[self.hist.len() - 1]);
            let dt = (b[2] - a[2]).max(0.008);
            self.vx = clamp((b[0] - a[0]) / dt, -4500.0, 4500.0);
            self.vy = clamp((b[1] - a[1]) / dt, -4500.0, 4500.0);
        } else {
            self.vx = 0.0;
            self.vy = 0.0;
        }
        self.spin = self.vx * 0.004;
        self.state = State::Fly;
    }
    pub fn is_held(&self) -> bool {
        self.state == State::Held
    }
    pub fn is_busy(&self) -> bool {
        self.state != State::Rest
    }
    /// impact speed (px/s) since the last call (for dizzy eyes + clack)
    pub fn take_impact(&mut self) -> f32 {
        std::mem::take(&mut self.impact)
    }

    fn hit(&mut self, v: f32) {
        self.impact = self.impact.max(v.abs());
        self.squash = clamp(v.abs() / 6000.0, 0.0, 0.25);
    }

    /// -> [x, y, angle, squash]
    pub fn update(&mut self, dt: f32, ww: f32, hh: f32) -> [f32; 4] {
        let half_w = self.w * 0.5;
        let top = self.h;
        self.sv += (-self.squash * 300.0 - self.sv * 14.0) * dt;
        self.squash += self.sv * dt;
        match self.state {
            State::Held => {
                let vx = if self.hist.len() >= 2 {
                    let (a, b) = (self.hist[0], self.hist[self.hist.len() - 1]);
                    (b[0] - a[0]) / (b[2] - a[2]).max(0.01)
                } else {
                    0.0
                };
                self.angle += (clamp(-vx * 0.0004, -0.6, 0.6) - self.angle) * (dt * 10.0).min(1.0); // dangles
            }
            State::Fly => {
                self.vy += 2600.0 * dt;
                self.x += self.vx * dt;
                self.y += self.vy * dt;
                self.angle += self.spin * dt;
                if self.x < half_w {
                    self.x = half_w;
                    self.hit(self.vx);
                    self.vx = -self.vx * 0.55;
                    self.spin = -self.spin * 0.7;
                }
                if self.x > ww - half_w {
                    self.x = ww - half_w;
                    self.hit(self.vx);
                    self.vx = -self.vx * 0.55;
                    self.spin = -self.spin * 0.7;
                }
                if self.y < top {
                    self.y = top;
                    self.hit(self.vy);
                    self.vy = -self.vy * 0.4;
                }
                if self.y > hh {
                    self.y = hh;
                    if self.vy.abs() > 250.0 {
                        self.hit(self.vy);
                    }
                    self.vy = -self.vy * 0.45;
                    self.vx *= 0.8;
                    self.spin *= 0.6;
                    if self.vy.abs() < 220.0 {
                        self.vy = 0.0;
                        self.state = State::Ground;
                        self.t = 0.0;
                    }
                }
            }
            State::Ground => {
                self.t += dt;
                self.vx *= (-dt * 6.0).exp();
                self.x += self.vx * dt;
                let tau = std::f32::consts::PI * 2.0;
                let up = (self.angle / tau).round() * tau; // roll upright
                self.angle += (up - self.angle) * (dt * 6.0).min(1.0);
                if self.t > 0.7 {
                    self.state = State::Hop;
                    self.hop = [self.x, self.y, 0.0, self.angle - up];
                }
            }
            State::Hop => {
                self.hop[2] += dt;
                let u = clamp(self.hop[2] / 0.75, 0.0, 1.0);
                let e = u * u * (3.0 - 2.0 * u);
                self.x = self.hop[0] + (self.rest_x - self.hop[0]) * e;
                self.y = self.hop[1] + (self.rest_y - self.hop[1]) * e - (u * std::f32::consts::PI).sin() * 140.0;
                self.angle = self.hop[3] * (1.0 - e);
                if u >= 1.0 {
                    self.state = State::Rest;
                    self.angle = 0.0;
                    self.squash = 0.12;
                    self.impact = 900.0;
                }
            }
            State::Rest => {
                let k = (dt * 8.0).min(1.0);
                self.x += (self.rest_x - self.x) * k;
                self.y += (self.rest_y - self.y) * k;
            }
        }
        [self.x, self.y, self.angle, self.squash]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn throw_bounces_off_wall_lands_and_hops_home() {
        let mut t = Toss::new();
        t.set_size(200.0, 300.0);
        t.set_rest(1500.0, 900.0);
        t.grab(1500.0, 800.0);
        for i in 0..6 {
            t.drag(1500.0 - i as f32 * 60.0, 800.0 - i as f32 * 20.0, i as f32 / 60.0);
        }
        t.release(0.1);
        assert_eq!(t.state, State::Fly);
        assert!(t.vx < -1000.0);
        let mut hit_wall = false;
        for _ in 0..60 * 8 {
            let [x, y, _, _] = t.update(1.0 / 60.0, 1920.0, 1080.0);
            assert!(x >= 100.0 - 1e-3 && x <= 1820.0 + 1e-3, "inside walls");
            assert!(y <= 1080.0 + 1e-3);
            if t.take_impact() > 0.0 {
                hit_wall = true;
            }
        }
        assert!(hit_wall);
        assert_eq!(t.state, State::Rest, "back at rest after flying");
        assert!((t.x - 1500.0).abs() < 1.0 && (t.y - 900.0).abs() < 1.0);
        assert!(t.angle.abs() < 1e-3);
    }
    #[test]
    fn rest_follows_rest_point() {
        let mut t = Toss::new();
        t.set_rest(10.0, 20.0);
        assert_eq!((t.x, t.y), (10.0, 20.0));
        t.reset();
        assert!(!t.is_busy());
    }
}
