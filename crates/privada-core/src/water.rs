//! Flush water FX (port of web/src/fx/waterJet.js), world space.
//!
//! Bowl gurgle bubbles, a coherent ballistic water column, spray droplets with motion
//! stretch, crown splashes, foam, ripple rings, rim drips and an irregular puddle.
//!
//! Render outputs (all f32, ready to copy into three.js buffers):
//! * `drops_m`  : DROPS  x 16 column-major instance matrices (zero matrix = hidden)
//! * `foam_m`   : FOAM   x 16
//! * `stream_pos`: (STREAM_SEG+1)*(STREAM_RAD+1) x 3, `stream_nrm` x 3, `stream_uv` x 2, `stream_visible`
//! * `ripples`  : RIPPLES x [x, z, scale, opacity, visible]
//! * `puddle`   : [x, z, sx, sz, opacity], `puddle_radial` (PUDDLE_SEG+1 factors, ring vertices 1..), `puddle_version`
use crate::util::Rng;
use glam::{Mat4, Quat, Vec3};
use std::f32::consts::PI;

const G: f32 = -9.8;
pub const DROPS: usize = 900;
pub const FOAM: usize = 360;
pub const STREAM_SEG: usize = 48;
pub const STREAM_RAD: usize = 12;
pub const RIPPLES: usize = 18;
pub const PUDDLE_SEG: usize = 120;

#[derive(Clone)]
struct Pool {
    max: usize,
    p: Vec<f32>,
    v: Vec<f32>,
    life: Vec<f32>,
    age: Vec<f32>,
    size: Vec<f32>,
    kind: Vec<u8>,
    next: usize,
    m: Vec<f32>,
}

impl Pool {
    fn new(max: usize) -> Self {
        Self {
            max,
            p: vec![0.0; max * 3],
            v: vec![0.0; max * 3],
            life: vec![0.0; max],
            age: vec![0.0; max],
            size: vec![0.0; max],
            kind: vec![0; max],
            next: 0,
            m: vec![0.0; max * 16],
        }
    }
    #[allow(clippy::too_many_arguments)]
    fn spawn(&mut self, x: f32, y: f32, z: f32, vx: f32, vy: f32, vz: f32, life: f32, size: f32, kind: u8) {
        let i = self.next;
        self.next = (i + 1) % self.max;
        let o = i * 3;
        self.p[o] = x;
        self.p[o + 1] = y;
        self.p[o + 2] = z;
        self.v[o] = vx;
        self.v[o + 1] = vy;
        self.v[o + 2] = vz;
        self.life[i] = life;
        self.age[i] = 0.0;
        self.size[i] = size;
        self.kind[i] = kind;
    }
    fn kill(&mut self, i: usize) {
        self.life[i] = 0.0;
        self.m[i * 16..i * 16 + 16].fill(0.0);
    }
    fn set(&mut self, i: usize, m: Mat4) {
        self.m[i * 16..i * 16 + 16].copy_from_slice(&m.to_cols_array());
    }
}

#[derive(Clone, Copy, Default)]
struct Ripple {
    x: f32,
    z: f32,
    age: f32,
    life: f32,
    max: f32,
    visible: bool,
    scale: f32,
    opacity: f32,
}

#[derive(Default, Clone, Copy)]
struct Acc {
    spray: f32,
    mouth: f32,
    splash: f32,
    foam: f32,
    bubble: f32,
    drip: f32,
    ripple: f32,
}

#[derive(Clone)]
pub struct WaterJet {
    // contract with the rig (set every frame)
    pub origin: Vec3,
    pub mouth: Vec3,
    pub mouth_width: f32,
    pub dir: Vec3,
    pub side: Vec3,
    // controls (set by actions)
    pub emitting: bool,
    pub rate: f32,
    pub speed: f32,
    pub gurgle: f32,
    pub drips: f32,
    pub level_offset: f32,
    // outputs for the rig
    pub bowl_rise: f32,
    pub bowl_slosh: f32,
    /// number of splashes since the last `take_splashes()` (rig turns some into "drip" sfx)
    pub splashes: u32,

    time: f32,
    speed_now: f32,
    acc: Acc,
    drain_t: f32,
    was_emitting: bool,
    drops: Pool,
    foam: Pool,
    stream_on: bool,
    t_front: f32,
    t_back: f32,
    amt: f32,
    landed: bool,
    v0: Vec3,
    // puddle
    vol: f32,
    wx: f32,
    wz: f32,
    wsum: f32,
    dry: f32,
    pud_x: f32,
    pud_z: f32,
    pud_sx: f32,
    pud_opacity: f32,
    ripples: [Ripple; RIPPLES],
    next_ripple: usize,
    rng: Rng,

    pub stream_pos: Vec<f32>,
    pub stream_nrm: Vec<f32>,
    pub stream_uv: Vec<f32>,
    pub stream_visible: bool,
    pub ripples_out: Vec<f32>,
    pub puddle_out: [f32; 5],
    pub puddle_radial: Vec<f32>,
    pub puddle_version: u32,
}

impl WaterJet {
    pub fn new(seed: u64) -> Self {
        let nv = (STREAM_SEG + 1) * (STREAM_RAD + 1);
        let mut w = Self {
            origin: Vec3::ZERO,
            mouth: Vec3::ZERO,
            mouth_width: 0.13,
            dir: Vec3::Y,
            side: Vec3::X,
            emitting: false,
            rate: 400.0,
            speed: 3.2,
            gurgle: 0.0,
            drips: 0.0,
            level_offset: 0.0,
            bowl_rise: 0.0,
            bowl_slosh: 0.0,
            splashes: 0,
            time: 0.0,
            speed_now: 3.2,
            acc: Acc::default(),
            drain_t: 0.0,
            was_emitting: false,
            drops: Pool::new(DROPS),
            foam: Pool::new(FOAM),
            stream_on: false,
            t_front: 0.0,
            t_back: 0.0,
            amt: 0.0,
            landed: false,
            v0: Vec3::ZERO,
            vol: 0.0,
            wx: 0.0,
            wz: 0.0,
            wsum: 0.0,
            dry: 0.0,
            pud_x: 0.0,
            pud_z: 0.0,
            pud_sx: 0.001,
            pud_opacity: 0.0,
            ripples: [Ripple::default(); RIPPLES],
            next_ripple: 0,
            rng: Rng::new(seed),
            stream_pos: vec![0.0; nv * 3],
            stream_nrm: vec![0.0; nv * 3],
            stream_uv: vec![0.0; nv * 2],
            stream_visible: false,
            ripples_out: vec![0.0; RIPPLES * 5],
            puddle_out: [0.0, 0.0, 0.001, 0.00085, 0.0],
            puddle_radial: vec![1.0; PUDDLE_SEG + 1],
            puddle_version: 0,
        };
        w.reshape_puddle();
        w
    }

    pub fn drops_matrices(&self) -> &[f32] {
        &self.drops.m
    }
    pub fn foam_matrices(&self) -> &[f32] {
        &self.foam.m
    }
    pub fn live_drops(&self) -> usize {
        self.drops.life.iter().filter(|l| **l > 0.0).count()
    }

    fn rnd(&mut self, a: f32, b: f32) -> f32 {
        self.rng.range(a, b)
    }

    fn reshape_puddle(&mut self) {
        let f1 = self.rnd(0.0, 6.28);
        let f2 = self.rnd(0.0, 6.28);
        let f3 = self.rnd(0.0, 6.28);
        let f4 = self.rnd(0.0, 6.28);
        for i in 0..=PUDDLE_SEG {
            // CircleGeometry ring vertex i+1 at theta = i/seg * 2pi, then rotateX(-pi/2): z = -sin(theta)
            let th = i as f32 / PUDDLE_SEG as f32 * 2.0 * PI;
            let a = (-th.sin()).atan2(th.cos());
            self.puddle_radial[i] = 1.0
                + 0.13 * (3.0 * a + f1).sin()
                + 0.08 * (5.0 * a + f2).sin()
                + 0.045 * (9.0 * a + f3).sin()
                + 0.025 * (17.0 * a + f4).sin();
        }
        self.puddle_version = self.puddle_version.wrapping_add(1);
    }

    fn wet(&mut self, x: f32, z: f32, amount: f32) {
        if self.vol <= 0.0001 {
            self.reshape_puddle();
            self.wx = 0.0;
            self.wz = 0.0;
            self.wsum = 0.0;
        }
        self.vol += amount;
        self.wx += x * amount;
        self.wz += z * amount;
        self.wsum += amount;
        self.dry = 0.0;
    }

    fn ripple(&mut self, x: f32, z: f32, max_r: f32, life: f32) {
        let r = &mut self.ripples[self.next_ripple];
        self.next_ripple = (self.next_ripple + 1) % RIPPLES;
        *r = Ripple { x, z, age: 0.0, life, max: max_r, visible: true, scale: 0.02, opacity: 0.45 };
    }

    fn ground_time(y0: f32, vy: f32) -> f32 {
        let h = (y0 - 0.006).max(0.01);
        (vy + (vy * vy + 2.0 * -G * h).sqrt()) / -G
    }

    fn arc_point(&self, t: f32) -> Vec3 {
        let mut o = self.mouth + self.v0 * t;
        o.y = self.mouth.y + self.v0.y * t + 0.5 * G * t * t;
        o
    }

    pub fn update(&mut self, dt: f32) {
        if dt <= 0.0 {
            return;
        }
        self.time += dt;
        let mut fwd = Vec3::new(self.dir.x, 0.0, self.dir.z);
        if fwd.length_squared() < 1e-6 {
            fwd = Vec3::Z;
        }
        let fwd = fwd.normalize();

        // bowl level: rises with the gurgle, full while spewing, drains after
        if self.was_emitting && !self.emitting {
            self.drain_t = 1.4;
        }
        self.was_emitting = self.emitting;
        self.drain_t = (self.drain_t - dt).max(0.0);
        let target = if self.emitting { 1.0 } else if self.drain_t > 0.0 { -0.2 } else { self.gurgle * 0.55 };
        self.bowl_rise += (target - self.bowl_rise) * (dt * 2.5).min(1.0);
        self.bowl_slosh = (self.time * 11.0).sin() * (self.gurgle * 0.6 + if self.emitting { 0.4 } else { 0.0 }).min(1.0);
        let level_y = self.origin.y + self.level_offset + self.bowl_rise * 0.12;

        // bubbles in the bowl
        if self.gurgle > 0.01 {
            self.acc.bubble += self.gurgle * 90.0 * dt;
            while self.acc.bubble >= 1.0 {
                self.acc.bubble -= 1.0;
                let rr = self.rng.next().sqrt() * 0.19;
                let a = self.rnd(0.0, PI * 2.0);
                let x = self.origin.x + self.side.x * a.cos() * rr + fwd.x * a.sin() * rr * 1.2;
                let z = self.origin.z + self.side.z * a.cos() * rr + fwd.z * a.sin() * rr * 1.2;
                let y = level_y - self.rnd(0.03, 0.08);
                let vy = self.rnd(0.15, 0.3);
                let sz = self.rnd(0.25, 0.6);
                self.foam.spawn(x, y, z, 0.0, vy, 0.0, 1.2, sz, 1);
            }
        }

        self.update_stream(dt);

        // mouth spray (wide, broken water right at the lid)
        if self.emitting {
            self.acc.mouth += self.rate * 0.45 * dt;
            while self.acc.mouth >= 1.0 {
                self.acc.mouth -= 1.0;
                let j = self.rnd(-1.0, 1.0);
                let sp = self.speed_now * self.rnd(0.65, 1.15);
                let (m, s, d, mw) = (self.mouth, self.side, self.dir, self.mouth_width);
                let y = m.y + self.rnd(-0.01, 0.02);
                let vx = d.x * sp + s.x * j * 1.1 + self.rnd(-0.2, 0.2);
                let vy = d.y * sp + self.rnd(-0.2, 0.6);
                let vz = d.z * sp + s.z * j * 1.1 + self.rnd(-0.2, 0.2);
                let size = self.rnd(0.45, 1.05);
                self.drops.spawn(m.x + s.x * j * mw, y, m.z + s.z * j * mw, vx, vy, vz, 2.5, size, 0);
            }
            self.acc.foam += 70.0 * dt;
            while self.acc.foam >= 1.0 {
                self.acc.foam -= 1.0;
                let j = self.rnd(-1.0, 1.0);
                let sp = self.speed_now * self.rnd(0.2, 0.55);
                let (m, s, d, mw) = (self.mouth, self.side, self.dir, self.mouth_width);
                let life = self.rnd(0.25, 0.45);
                let size = self.rnd(0.5, 1.1);
                self.foam.spawn(
                    m.x + s.x * j * mw * 0.8, m.y + 0.01, m.z + s.z * j * mw * 0.8,
                    d.x * sp + s.x * j * 0.5, d.y * sp, d.z * sp + s.z * j * 0.5,
                    life, size, 0,
                );
            }
        }

        // drips from the front rim after the spew
        if self.drips > 0.0 {
            self.drips -= dt;
            self.acc.drip += 7.0 * dt;
            while self.acc.drip >= 1.0 {
                self.acc.drip -= 1.0;
                let j = self.rnd(-1.0, 1.0) * 0.25;
                let (m, s) = (self.mouth, self.side);
                let size = self.rnd(0.5, 0.7);
                self.drops.spawn(m.x + s.x * j, m.y - 0.005, m.z + s.z * j, 0.0, -0.1, 0.0, 2.0, size, 2);
            }
        }

        self.update_drops(dt);
        self.update_foam(dt, level_y);
        self.update_ripples(dt);
        self.update_puddle(dt);
    }

    fn update_stream(&mut self, dt: f32) {
        self.speed_now += (self.speed - self.speed_now) * (dt * 6.0).min(1.0);
        self.v0 = self.dir.normalize_or_zero() * self.speed_now;
        let tt = Self::ground_time(self.mouth.y, self.v0.y);
        if self.emitting {
            if !self.stream_on {
                self.stream_on = true;
                self.t_front = 0.0;
                self.amt = 0.0;
            }
            self.t_back = 0.0;
            self.amt += (1.0 - self.amt) * (dt * 8.0).min(1.0);
        } else if self.stream_on {
            self.t_back += dt; // column detaches and falls along the arc
        }
        if !self.stream_on {
            self.stream_visible = false;
            self.landed = false;
            return;
        }
        self.t_front = (self.t_front + dt).min(tt);
        if self.t_back >= self.t_front - 1e-3 {
            self.stream_on = false;
            self.stream_visible = false;
            self.landed = false;
            self.amt = 0.0;
            return;
        }
        self.stream_visible = true;
        let (t0, t1) = (self.t_back, self.t_front);
        self.landed = t1 >= tt - 1e-4;
        let time = self.time;
        for i in 0..=STREAM_SEG {
            let u = i as f32 / STREAM_SEG as f32;
            let t = t0 + (t1 - t0) * u;
            let p = self.arc_point(t);
            let tan = Vec3::new(self.v0.x, self.v0.y + G * t, self.v0.z).normalize_or_zero();
            let b1 = (self.side - tan * self.side.dot(tan)).normalize_or_zero();
            let b2 = tan.cross(b1);
            let mut r = 0.036 * self.amt * (0.7 + 0.75 * (t / tt));
            if !self.landed {
                r *= ((t1 - t) / 0.06).min(1.0).max(0.0).sqrt();
            }
            if t0 > 0.0 {
                r *= ((t - t0) / 0.06).min(1.0).max(0.0).sqrt();
            }
            let wob = 1.0 + 0.16 * (time * 31.0 - t * 60.0).sin() + 0.08 * (time * 17.0 + t * 23.0).sin();
            for j in 0..=STREAM_RAD {
                let a = j as f32 / STREAM_RAD as f32 * PI * 2.0;
                let rr = r * wob * (1.0 + 0.08 * (3.0 * a + time * 13.0 + t * 30.0).sin());
                let (ca, sa) = (a.cos() * rr, a.sin() * rr);
                let k = i * (STREAM_RAD + 1) + j;
                let q = p + b1 * ca + b2 * sa;
                self.stream_pos[k * 3] = q.x;
                self.stream_pos[k * 3 + 1] = q.y;
                self.stream_pos[k * 3 + 2] = q.z;
                self.stream_uv[k * 2] = j as f32 / STREAM_RAD as f32;
                self.stream_uv[k * 2 + 1] = t * 6.0 - time * 4.0;
            }
        }

        // column normals (index layout of waterJet.js: a,b,a+1 / b,b+1,a+1)
        let cols = STREAM_RAD + 1;
        let tris = (0..STREAM_SEG).flat_map(move |i| {
            (0..STREAM_RAD).flat_map(move |j| {
                let a = i * cols + j;
                let b = a + cols;
                [[a, b, a + 1], [b, b + 1, a + 1]]
            })
        });
        crate::util::vertex_normals(&self.stream_pos, &mut self.stream_nrm, (STREAM_SEG + 1) * cols, tris);

        // spray shed from the column surface
        if self.emitting || t0 > 0.0 {
            self.acc.spray += self.rate * 0.55 * dt * self.amt;
            while self.acc.spray >= 1.0 {
                self.acc.spray -= 1.0;
                let t = self.rnd(t0, t1);
                let p = self.arc_point(t);
                let s = self.rnd(0.85, 1.05);
                let sp = 0.45;
                let v0 = self.v0;
                let x = p.x + self.rnd(-0.03, 0.03);
                let y = p.y + self.rnd(-0.03, 0.03);
                let z = p.z + self.rnd(-0.03, 0.03);
                let vx = v0.x * s + self.rnd(-sp, sp);
                let vy = (v0.y + G * t) * s + self.rnd(-sp, sp);
                let vz = v0.z * s + self.rnd(-sp, sp);
                let size = self.rnd(0.35, 0.9);
                self.drops.spawn(x, y, z, vx, vy, vz, 2.5, size, 0);
            }
        }

        // column hitting the floor: crown splash, foam, ripples, puddle volume
        if self.landed {
            let l = self.arc_point(tt);
            let vin = Vec3::new(self.v0.x, 0.0, self.v0.z);
            self.acc.splash += 170.0 * self.amt * dt;
            while self.acc.splash >= 1.0 {
                self.acc.splash -= 1.0;
                let a = self.rnd(0.0, PI * 2.0);
                let hs = self.rnd(0.35, 1.3);
                let vy = self.rnd(0.6, 1.7);
                let size = self.rnd(0.3, 0.6);
                self.drops.spawn(
                    l.x + a.cos() * 0.03, 0.02, l.z + a.sin() * 0.03,
                    a.cos() * hs + vin.x * 0.35, vy, a.sin() * hs + vin.z * 0.35,
                    1.2, size, 1,
                );
            }
            self.acc.foam += 30.0 * self.amt * dt;
            while self.acc.foam >= 1.0 {
                self.acc.foam -= 1.0;
                let a = self.rnd(0.0, PI * 2.0);
                let rr = self.rnd(0.0, 0.08);
                let life = self.rnd(0.5, 0.9);
                let size = self.rnd(0.8, 1.6);
                self.foam.spawn(l.x + a.cos() * rr, 0.01, l.z + a.sin() * rr, a.cos() * 0.2, 0.0, a.sin() * 0.2, life, size, 2);
            }
            self.acc.ripple += dt;
            if self.acc.ripple > 0.09 {
                self.acc.ripple = 0.0;
                let x = l.x + self.rnd(-0.05, 0.05);
                let z = l.z + self.rnd(-0.05, 0.05);
                let mr = self.rnd(0.25, 0.45);
                let lf = self.rnd(0.8, 1.3);
                self.ripple(x, z, mr, lf);
            }
            self.wet(l.x, l.z, 2.5 * self.amt * dt);
        }
    }

    fn update_drops(&mut self, dt: f32) {
        let drag = 1.0 - 0.15 * dt;
        for i in 0..DROPS {
            if self.drops.life[i] <= 0.0 {
                continue;
            }
            let o = i * 3;
            self.drops.age[i] += dt;
            self.drops.life[i] -= dt;
            {
                let v = &mut self.drops.v;
                v[o + 1] += G * dt;
                v[o] *= drag;
                v[o + 1] *= drag;
                v[o + 2] *= drag;
            }
            let (vx, vy, vz) = (self.drops.v[o], self.drops.v[o + 1], self.drops.v[o + 2]);
            self.drops.p[o] += vx * dt;
            self.drops.p[o + 1] += vy * dt;
            self.drops.p[o + 2] += vz * dt;
            if self.drops.p[o + 1] < 0.012 {
                let kind = self.drops.kind[i];
                let (x, z, sz) = (self.drops.p[o], self.drops.p[o + 2], self.drops.size[i]);
                self.drops.kill(i);
                if kind == 0 {
                    let n = 1 + (self.rng.next() * 3.0) as usize; // little crown splash
                    for _ in 0..n {
                        let a = self.rnd(0.0, PI * 2.0);
                        let hs = self.rnd(0.25, 0.8);
                        let vy2 = self.rnd(0.4, 1.1);
                        let s2 = sz * self.rnd(0.35, 0.5);
                        self.drops.spawn(x, 0.015, z, a.cos() * hs + vx * 0.2, vy2, a.sin() * hs + vz * 0.2, 0.8, s2, 1);
                    }
                    self.wet(x, z, 0.004);
                    if self.rng.next() < 0.05 {
                        let mr = self.rnd(0.08, 0.16);
                        self.ripple(x, z, mr, 0.7);
                    }
                    self.splashes += 1;
                } else if kind == 1 {
                    self.wet(x, z, 0.001);
                } else {
                    self.wet(x, z, 0.002);
                    if self.rng.next() < 0.6 {
                        let mr = self.rnd(0.06, 0.12);
                        self.ripple(x, z, mr, 0.8);
                    }
                    self.splashes += 1;
                }
                continue;
            }
            if self.drops.life[i] <= 0.0 {
                self.drops.kill(i);
                continue;
            }
            let p = Vec3::new(self.drops.p[o], self.drops.p[o + 1], self.drops.p[o + 2]);
            let d = Vec3::new(vx, vy, vz);
            let speed = d.length();
            let q = if speed > 1e-4 { Quat::from_rotation_arc(Vec3::Y, d / speed) } else { Quat::IDENTITY };
            let sc = self.drops.size[i] * (self.drops.life[i] * 4.0).min(1.0) * (0.4 + self.drops.age[i] * 12.0).min(1.0);
            let m = Mat4::from_scale_rotation_translation(Vec3::new(sc, sc * (1.0 + speed * 0.22), sc), q, p);
            self.drops.set(i, m);
        }
    }

    fn update_foam(&mut self, dt: f32, level_y: f32) {
        for i in 0..FOAM {
            if self.foam.life[i] <= 0.0 {
                continue;
            }
            let o = i * 3;
            let kind = self.foam.kind[i];
            self.foam.age[i] += dt;
            self.foam.life[i] -= dt;
            let age = self.foam.age[i];
            let mut flat = 1.0;
            let sc;
            if kind == 1 {
                // bubble rising in the bowl, pops at the surface
                self.foam.p[o] += (age * 20.0 + i as f32).sin() * 0.002;
                self.foam.p[o + 1] += self.foam.v[o + 1] * dt;
                self.foam.p[o + 2] += (age * 17.0 + i as f32).cos() * 0.002;
                if self.foam.p[o + 1] >= level_y {
                    let (x, z, s) = (self.foam.p[o], self.foam.p[o + 2], self.foam.size[i]);
                    self.foam.kill(i);
                    if self.rng.next() < 0.3 {
                        let vx = self.rnd(-0.1, 0.1);
                        let vy = self.rnd(0.2, 0.5);
                        let vz = self.rnd(-0.1, 0.1);
                        self.foam.spawn(x, level_y, z, vx, vy, vz, 0.2, s * 0.6, 0);
                    }
                    continue;
                }
                sc = self.foam.size[i] * (0.5 + age * 0.8);
            } else if kind == 0 {
                // froth at the mouth: decelerates, grows, fades
                let k = 1.0 - (4.0 * dt).min(1.0);
                let v = &mut self.foam.v;
                v[o] *= k;
                v[o + 1] = v[o + 1] * k + G * 0.2 * dt;
                v[o + 2] *= k;
                let (vx, vy, vz) = (v[o], v[o + 1], v[o + 2]);
                self.foam.p[o] += vx * dt;
                self.foam.p[o + 1] += vy * dt;
                self.foam.p[o + 2] += vz * dt;
                sc = self.foam.size[i] * (0.6 + age * 1.5) * (self.foam.life[i] * 5.0).min(1.0);
            } else {
                // floor foam: spreads, flattens, fades
                let (vx, vz) = (self.foam.v[o], self.foam.v[o + 2]);
                self.foam.p[o] += vx * dt;
                self.foam.p[o + 2] += vz * dt;
                let k = 1.0 - (2.0 * dt).min(1.0);
                self.foam.v[o] *= k;
                self.foam.v[o + 2] *= k;
                sc = self.foam.size[i] * (0.5 + age * 1.2) * (self.foam.life[i] * 2.0).min(1.0);
                flat = 0.3;
            }
            if self.foam.life[i] <= 0.0 {
                self.foam.kill(i);
                continue;
            }
            let p = Vec3::new(self.foam.p[o], self.foam.p[o + 1], self.foam.p[o + 2]);
            let m = Mat4::from_scale_rotation_translation(Vec3::new(sc, sc * flat, sc), Quat::IDENTITY, p);
            self.foam.set(i, m);
        }
    }

    fn update_ripples(&mut self, dt: f32) {
        for (i, r) in self.ripples.iter_mut().enumerate() {
            if r.visible {
                r.age += dt;
                let k = r.age / r.life;
                if k >= 1.0 {
                    r.visible = false;
                } else {
                    r.scale = 0.02 + r.max * (1.0 - (1.0 - k) * (1.0 - k));
                    r.opacity = 0.45 * (1.0 - k);
                }
            }
            let o = &mut self.ripples_out[i * 5..i * 5 + 5];
            o.copy_from_slice(&[r.x, r.z, r.scale, r.opacity, if r.visible { 1.0 } else { 0.0 }]);
        }
    }

    fn update_puddle(&mut self, dt: f32) {
        if self.vol > 0.0 {
            self.dry += dt;
            let r = (0.08 + self.vol.sqrt() * 0.21).min(0.9);
            let s = self.pud_sx + (r - self.pud_sx) * (dt * 3.0).min(1.0);
            self.pud_sx = s;
            if self.wsum > 0.0 {
                let k = (dt * 4.0).min(1.0);
                self.pud_x += (self.wx / self.wsum - self.pud_x) * k;
                self.pud_z += (self.wz / self.wsum - self.pud_z) * k;
            }
            if self.dry < 3.0 {
                self.pud_opacity = (self.pud_opacity + dt * 3.0).min(0.7);
            } else {
                self.pud_opacity -= dt * 0.3;
                self.vol *= 1.0 - dt * 0.08; // shrinks a little while drying
                if self.pud_opacity <= 0.0 {
                    self.pud_opacity = 0.0;
                    self.vol = 0.0;
                    self.wx = 0.0;
                    self.wz = 0.0;
                    self.wsum = 0.0;
                    self.pud_sx = 0.001;
                }
            }
        }
        self.puddle_out = [self.pud_x, self.pud_z, self.pud_sx, self.pud_sx * 0.85, self.pud_opacity];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn jet_spews_lands_and_makes_a_puddle() {
        let mut w = WaterJet::new(1);
        w.origin = Vec3::new(0.0, 0.465, 0.0);
        w.mouth = Vec3::new(0.0, 0.69, 0.43);
        w.dir = Vec3::new(0.0, 0.42, 0.9).normalize();
        w.emitting = true;
        for _ in 0..120 {
            w.update(1.0 / 60.0);
        }
        assert!(w.stream_visible, "column should be visible while emitting");
        assert!(w.live_drops() > 50, "spray droplets alive");
        assert!(w.puddle_out[4] > 0.1, "puddle visible");
        assert!(w.bowl_rise > 0.5);
        w.emitting = false;
        for _ in 0..600 {
            w.update(1.0 / 60.0);
        }
        assert!(!w.stream_visible);
        assert!(w.drops_matrices().iter().all(|x| x.is_finite()));
    }
}
