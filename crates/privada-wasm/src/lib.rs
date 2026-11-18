//! wasm-bindgen bindings of privada-core, loaded by web/src/rig/wasmrig.js.
//!
//! Zero-copy outputs: `buf_ptr(id)` / `buf_len(id)` give f32 views into wasm memory
//! (`new Float32Array(wasm.memory.buffer, ptr, len)`), ids in [`Buf`]:
//!
//! | id | buffer | layout |
//! |---|---|---|
//! | 0 | pose | NODE_ORDER x [px,py,pz,qx,qy,qz,qw,sx,sy,sz] (local TRS) |
//! | 1 | drops | 900 x 16 column-major instance matrices (zero = hidden) |
//! | 2 | foam | 360 x 16 |
//! | 3 | stream_pos | 49*13 x 3 |
//! | 4 | stream_uv | 49*13 x 2 |
//! | 5 | ripples | 18 x [x, z, scale, opacity, visible] |
//! | 6 | puddle | [x, z, sx, sz, opacity] |
//! | 7 | puddle_radial | 121 radial factors for CircleGeometry(1,120) ring vertices 1..121 |
//! | 8/9/10 | paper pos / uv / perf | 150*2 x 3 / 150*2 x 2 / 41*2 segments x 6 |
//! | 11/12/13 | torn pos / uv / perf | same |
//! | 14 | scalars | see privada_core::rig::sc (hinge, accessory state, counts...) |
//! | 15 | morphs | [smile, pucker, arch] |
use privada_core::rig::{self, Mouth, NODE_ORDER};
use privada_core::toss;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Rig {
    inner: rig::Rig,
    look: (f32, f32),
    mouth: Mouth,
    morphs: [f32; 3],
}

#[wasm_bindgen]
impl Rig {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: Option<u32>) -> Rig {
        let inner = rig::Rig::new(seed.unwrap_or(1) as u64);
        Rig { inner, look: (0.0, 0.0), mouth: Mouth::default(), morphs: [0.0; 3] }
    }
    /// look -1..1 (x right, y up) and the mouth vector (all 0..1)
    #[allow(clippy::too_many_arguments)]
    pub fn set_input(&mut self, look_x: f32, look_y: f32, open: f32, round: f32, wide: f32, closed: f32, sib: f32) {
        self.look = (look_x, look_y);
        self.mouth = Mouth { open, round, wide, closed, sib };
    }
    /// lips slightly apart at rest (default 0.05 rad)
    pub fn set_rest(&mut self, v: f32) {
        self.inner.rest_open = v;
    }
    /// flush | paper | jump | backflip | no | gargle | blink
    pub fn play(&mut self, name: &str) -> bool {
        self.inner.play(name)
    }
    pub fn is_playing(&self) -> bool {
        self.inner.is_playing()
    }
    pub fn update(&mut self, dt: f32) {
        self.inner.update(dt, self.look, self.mouth);
        self.morphs = self.inner.morphs();
    }
    pub fn node_order(&self) -> String {
        NODE_ORDER.join(",")
    }
    pub fn hinge(&self) -> f32 {
        self.inner.hinge()
    }
    pub fn pose(&self) -> Vec<f32> {
        self.inner.pose().to_vec()
    }
    pub fn morphs(&self) -> Vec<f32> {
        self.morphs.to_vec()
    }
    pub fn scalars(&self) -> Vec<f32> {
        self.inner.scalars().to_vec()
    }
    /// sound events since the last call, '\n'-separated ("flush", "clack:4.20", ...)
    pub fn drain_events(&mut self) -> String {
        self.inner.drain_events().join("\n")
    }
    pub fn buf_ptr(&self, id: u32) -> u32 {
        self.slice(id).as_ptr() as u32
    }
    pub fn buf_len(&self, id: u32) -> u32 {
        self.slice(id).len() as u32
    }
}

impl Rig {
    fn slice(&self, id: u32) -> &[f32] {
        let r = &self.inner;
        match id {
            0 => r.pose(),
            1 => r.jet.drops_matrices(),
            2 => r.jet.foam_matrices(),
            3 => &r.jet.stream_pos,
            4 => &r.jet.stream_uv,
            5 => &r.jet.ripples_out,
            6 => &r.jet.puddle_out,
            7 => &r.jet.puddle_radial,
            8 => &r.paper.pos,
            9 => &r.paper.uv,
            10 => &r.paper.perf,
            11 => &r.torn.pos,
            12 => &r.torn.uv,
            13 => &r.torn.perf,
            14 => r.scalars(),
            15 => &self.morphs,
            _ => &[],
        }
    }
}

/// Overlay drag / throw / bounce physics (screen px), see privada_core::toss.
#[wasm_bindgen]
pub struct Toss(toss::Toss);

#[wasm_bindgen]
impl Toss {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Toss {
        Toss(toss::Toss::new())
    }
    pub fn set_rest(&mut self, x: f32, y: f32) {
        self.0.set_rest(x, y)
    }
    pub fn set_size(&mut self, w: f32, h: f32) {
        self.0.set_size(w, h)
    }
    pub fn reset(&mut self) {
        self.0.reset()
    }
    pub fn grab(&mut self, x: f32, y: f32) {
        self.0.grab(x, y)
    }
    pub fn drag(&mut self, x: f32, y: f32, t: f32) {
        self.0.drag(x, y, t)
    }
    pub fn release(&mut self, t: f32) {
        self.0.release(t)
    }
    pub fn is_held(&self) -> bool {
        self.0.is_held()
    }
    pub fn is_busy(&self) -> bool {
        self.0.is_busy()
    }
    pub fn take_impact(&mut self) -> f32 {
        self.0.take_impact()
    }
    /// -> [x, y, angle, squash]
    pub fn update(&mut self, dt: f32, w: f32, h: f32) -> Vec<f32> {
        self.0.update(dt, w, h).to_vec()
    }
}

impl Default for Toss {
    fn default() -> Self {
        Self::new()
    }
}
