//! One-shot animations (port of web/src/anim/actions.js, same timings).
//! Each frame the rig resets an [`Overrides`] table; every running action writes into
//! it and may drive the FX (water jet, paper strips) directly.
use crate::paper::PaperStrip;
use crate::util::smooth;
use crate::water::WaterJet;
use glam::Vec3;
use std::f32::consts::PI;

#[derive(Clone, Copy, Debug)]
pub struct Overrides {
    pub mouth: Option<f32>,
    pub head_pitch: f32,
    pub head_yaw: f32,
    pub lift: f32,
    pub shake: f32,
    pub squash: f32,
    pub eye_scale: f32,
    pub swirl: f32,
    pub handle: f32,
    pub blink: Option<f32>,
    pub look: Option<(f32, f32)>,
    pub flip: f32,
    pub flip_lift: f32,
    pub spin: f32,
}

impl Default for Overrides {
    fn default() -> Self {
        Self {
            mouth: None, head_pitch: 0.0, head_yaw: 0.0, lift: 0.0, shake: 0.0, squash: 0.0,
            eye_scale: 1.0, swirl: 0.0, handle: 0.0, blink: None, look: None, flip: 0.0,
            flip_lift: 0.0, spin: 0.0,
        }
    }
}

/// What actions are allowed to touch besides the overrides.
pub struct Fx<'a> {
    pub jet: &'a mut WaterJet,
    pub paper: &'a mut PaperStrip,
    pub torn: &'a mut PaperStrip,
    pub paper_out_dir: Vec3,
    pub events: &'a mut Vec<String>,
}

impl Fx<'_> {
    fn emit(&mut self, e: &str) {
        self.events.push(e.to_string());
    }
    /// tb.tearPaper(): fallback tear (copy everything into the torn piece)
    fn tear_paper(&mut self) {
        self.torn.copy_from(self.paper);
        self.torn.fade = 1.0;
        let a = self.paper.anchor;
        self.paper.reset(a);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Flush,
    Paper,
    Gargle,
    Backflip,
    Blink,
    Jump,
    No,
}

impl Kind {
    pub fn parse(name: &str) -> Option<Kind> {
        Some(match name {
            "flush" => Kind::Flush,
            "paper" => Kind::Paper,
            "gargle" => Kind::Gargle,
            "backflip" => Kind::Backflip,
            "blink" => Kind::Blink,
            "jump" => Kind::Jump,
            "no" => Kind::No,
            _ => return None,
        })
    }
    pub fn duration(self) -> f32 {
        match self {
            Kind::Flush => 5.2,
            Kind::Paper => 4.4,
            Kind::Gargle => 2.2,
            Kind::Backflip => 1.55,
            Kind::Blink => 0.16,
            Kind::Jump => 1.0,
            Kind::No => 1.1,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Action {
    pub kind: Kind,
    pub t: f32,
    flag_a: bool, // spewing / torn / whoosh
    flag_b: bool, // dripped / landed
}

impl Action {
    pub fn new(kind: Kind) -> Self {
        Self { kind, t: 0.0, flag_a: false, flag_b: false }
    }

    pub fn start(&mut self, fx: &mut Fx) {
        match self.kind {
            Kind::Flush => fx.emit("flush"),
            Kind::Paper => fx.emit("paper"),
            Kind::Gargle => fx.emit("gargle"),
            Kind::Backflip | Kind::Jump => fx.emit("boing"),
            Kind::Blink | Kind::No => {}
        }
    }

    pub fn finished(&self) -> bool {
        self.t >= self.kind.duration()
    }

    pub fn update(&mut self, t: f32, _dt: f32, fx: &mut Fx, o: &mut Overrides) {
        match self.kind {
            Kind::Flush => {
                o.handle = if t < 0.6 { smooth(0.0, 0.18, t) } else { 1.0 - smooth(0.6, 0.9, t) };
                let gurgle = smooth(0.3, 1.2, t) * (1.0 - smooth(1.45, 1.65, t));
                fx.jet.gurgle = gurgle;
                o.swirl = 14.0 * smooth(0.3, 1.2, t) * (1.0 - smooth(3.6, 4.6, t));
                o.shake = if t < 1.65 { smooth(0.35, 1.5, t) } else { 0.25 * (1.0 - smooth(1.65, 3.3, t)) };
                o.eye_scale = 1.0 + 0.2 * smooth(0.5, 1.3, t) * (1.0 - smooth(3.5, 4.3, t));
                if t < 1.5 {
                    o.mouth = Some(gurgle * (0.05 + 0.12 * (t * 19.0).sin().abs()));
                    o.squash = -0.06 * smooth(0.9, 1.5, t);
                }
                let spew = t > 1.6 && t < 3.4;
                if (1.5..3.5).contains(&t) {
                    o.mouth = Some(1.0);
                    let surge = 0.5 + 0.5 * (((t - 1.6) * PI * 2.0) / 0.9).cos();
                    o.head_pitch = -0.26 - 0.08 * surge;
                    o.lift = 0.03 + 0.02 * surge;
                    o.squash = 0.04 * surge - 0.02;
                    fx.jet.speed = 2.9 + 0.7 * surge;
                    fx.jet.rate = 520.0 * (0.6 + 0.4 * surge) * (1.0 - smooth(2.95, 3.4, t));
                } else if (3.5..4.6).contains(&t) {
                    o.mouth = Some(0.0); // slam shut (the lip bounces)
                }
                if spew && !self.flag_a {
                    fx.emit("splash");
                }
                self.flag_a = spew;
                fx.jet.emitting = spew;
                if t > 3.45 && !self.flag_b {
                    self.flag_b = true;
                    fx.jet.drips = 1.6;
                }
                o.look = if t > 1.6 && t < 3.4 { Some((0.0, 0.6)) } else { None };
            }
            Kind::Paper => {
                if t < 2.5 {
                    fx.paper.target_len = 3.4;
                    fx.paper.feed_speed = 1.7 * smooth(0.0, 0.35, t) * (1.0 - 0.3 * smooth(1.8, 2.5, t));
                    // gentle breeze along his forward (the roll faces the camera): the paper
                    // streams out over the lid and piles on the floor in front of the bowl
                    let w = 12.0 * smooth(0.0, 0.45, t) * (1.0 - smooth(1.8, 2.5, t));
                    fx.paper.wind = fx.paper_out_dir * w;
                    fx.paper.wind.y = w * 0.2;
                } else {
                    fx.paper.wind = Vec3::ZERO;
                    fx.paper.target_len = fx.paper.length(); // stop feeding, let it settle
                    if !self.flag_a && t > 3.0 {
                        self.flag_a = true;
                        let ok = fx.paper.tear_into(fx.torn);
                        if !ok {
                            fx.tear_paper();
                        }
                        fx.emit("rip");
                    }
                }
                // the roll is on his own tank front (left, below the eye): a small turn and a
                // look down at it, then down at the paper piling in front of the bowl
                o.head_yaw = -0.05 * smooth(0.0, 0.3, t) * (1.0 - smooth(2.6, 3.2, t));
                o.look = if t < 2.6 {
                    Some((-0.12, -0.55))
                } else if t < 3.4 {
                    Some((-0.12, -0.85))
                } else {
                    None
                };
                o.mouth = if t < 2.4 { Some(0.3 + 0.15 * (t * 20.0).sin()) } else { None };
            }
            Kind::Gargle => {
                let g = smooth(0.0, 0.3, t) * (1.0 - smooth(1.8, 2.2, t));
                fx.jet.gurgle = g;
                o.mouth = Some(g * (0.1 + 0.2 * (t * 23.0).sin().abs()));
                o.head_pitch = -0.15 * g;
                o.look = Some((0.0, 0.5 * g));
                o.shake = 0.15 * g;
            }
            Kind::Backflip => {
                let (t0, t1) = (0.28, 1.12);
                if t < t0 {
                    o.squash = -0.16 * smooth(0.0, t0, t);
                    o.look = Some((0.0, -0.4));
                    return;
                }
                if t < t1 {
                    let u = (t - t0) / (t1 - t0);
                    o.flip = -PI * 2.0 * smooth(0.05, 0.95, u);
                    o.flip_lift = 0.95 * 4.0 * u * (1.0 - u);
                    o.squash = 0.06 * (u * PI).sin();
                    o.mouth = Some(0.75);
                    o.eye_scale = 1.2;
                    o.look = Some((0.0, 0.9));
                    if !self.flag_a && u > 0.2 {
                        self.flag_a = true;
                        fx.emit("whoosh");
                    }
                    return;
                }
                if !self.flag_b {
                    self.flag_b = true;
                    fx.emit("clack:9");
                }
                o.squash = -0.14 * (1.0 - smooth(t1, 1.55, t));
                o.head_pitch = 0.15 * (1.0 - smooth(t1, 1.5, t));
            }
            Kind::Blink => o.blink = Some(((t / 0.16) * PI).sin()),
            Kind::Jump => {
                if t < 0.22 {
                    o.squash = -0.12 * smooth(0.0, 0.22, t);
                } else if t < 0.78 {
                    let u = (t - 0.22) / 0.56;
                    o.lift = 0.35 * 4.0 * u * (1.0 - u);
                    o.squash = 0.08 * (1.0 - u);
                    o.mouth = Some(0.5);
                } else {
                    o.squash = -0.1 * (1.0 - smooth(0.78, 1.0, t));
                }
            }
            Kind::No => o.head_yaw = (t * 16.0).sin() * 0.35 * (1.0 - smooth(0.6, 1.1, t)),
        }
    }

    pub fn end(&mut self, fx: &mut Fx) {
        match self.kind {
            Kind::Flush => {
                fx.jet.emitting = false;
                fx.jet.gurgle = 0.0;
                fx.jet.speed = 3.2;
                fx.jet.rate = 400.0;
            }
            Kind::Paper => {
                fx.paper.wind = Vec3::ZERO;
                fx.paper.feed_speed = 0.6;
                fx.paper.target_len = 0.24;
            }
            Kind::Gargle => fx.jet.gurgle = 0.0,
            _ => {}
        }
    }
}
