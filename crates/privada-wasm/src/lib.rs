//! wasm-bindgen bindings of privada-core, loaded by web/src/rig/wasmrig.js.
//!
//! Zero-copy outputs: `buf_ptr(id)` / `buf_len(id)` give f32 views into wasm memory
//! (`new Float32Array(wasm.memory.buffer, ptr, len)`), ids in [`Buf`]:
//!
//! | id | buffer | layout |
//! |---|---|---|
//! | 0 | pose | NODE_ORDER (26 nodes, `seat_bone_1..7` last) x [px,py,pz,qx,qy,qz,qw,sx,sy,sz] (local TRS) |
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
//! | 15 | morphs | 16 blend-shape weights, names in `morph_names()`: lid [smile, pucker, arch, corner_L_up, corner_L_down, corner_R_up, corner_R_down, pucker_L, pucker_R], then seat [corner_L_up, corner_L_down, corner_R_up, corner_R_down, pucker_L, pucker, pucker_R] |
//! | 16 | stream_nrm | 49*13 x 3 (vertex normals, computed in Rust) |
//! | 17/18 | paper / torn nrm | 150*2 x 3 (only the first `count*2` vertices are valid) |
use privada_core::dim::BodyDims;
use privada_core::rig::{self, Mouth, MORPHS, MORPH_NAMES, MOUTH_CHANNELS, NODE_ORDER, STANDARD_VISEMES};
use privada_core::toss;
use wasm_bindgen::prelude::*;

mod geo;
#[allow(unused_imports)]
pub use geo::*;

#[wasm_bindgen]
pub struct Rig {
    inner: rig::Rig,
    look: (f32, f32),
    mouth: Mouth,
    morphs: [f32; MORPHS],
}

#[wasm_bindgen]
impl Rig {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: Option<u32>) -> Rig {
        let inner = rig::Rig::new(seed.unwrap_or(1) as u64);
        Rig { inner, look: (0.0, 0.0), mouth: Mouth::default(), morphs: [0.0; MORPHS] }
    }
    /// look -1..1 (x right, y up) and the mouth vector (all 0..1)
    #[allow(clippy::too_many_arguments)]
    pub fn set_input(&mut self, look_x: f32, look_y: f32, open: f32, round: f32, wide: f32, closed: f32, sib: f32) {
        self.look = (look_x, look_y);
        self.mouth = Mouth { open, round, wide, closed, sib, ..self.mouth };
    }
    /// optional extra mouth channels (default 0, kept until changed): corners -1 (down)..1 (up)
    /// (L = the -x side, like eye_L), jaw side -1..1, jaw forward 0..1, upper-lip raise 0..1
    pub fn set_input_ext(&mut self, corner_l: f32, corner_r: f32, jaw_side: f32, jaw_fwd: f32, upper_raise: f32) {
        self.mouth = Mouth { corner_l, corner_r, jaw_side, jaw_fwd, upper_raise, ..self.mouth };
    }
    /// comma-separated blend-shape names, in MORPHS-buffer order
    pub fn morph_names(&self) -> String {
        MORPH_NAMES.join(",")
    }
    /// the 15 standard visemes (+ rest) as JSON `{ "AA": {"open":1,...}, ... }` (mirror of visemes.js)
    pub fn standard_visemes(&self) -> String {
        let one = |c: &[f32; 10]| {
            let kv: Vec<String> = MOUTH_CHANNELS.iter().zip(c).filter(|(_, v)| **v != 0.0).map(|(k, v)| format!("\"{k}\":{v}")).collect();
            format!("{{{}}}", kv.join(","))
        };
        let all: Vec<String> = STANDARD_VISEMES.iter().map(|(n, c)| format!("\"{n}\":{}", one(c))).collect();
        format!("{{{}}}", all.join(","))
    }
    /// total look range in radians (body + head); default 80° yaw, 35° pitch
    pub fn set_look_limits(&mut self, max_yaw_rad: f32, max_pitch_rad: f32) {
        self.inner.set_look_limits(max_yaw_rad, max_pitch_rad);
    }
    /// lips slightly apart at rest (default 0.05 rad)
    pub fn set_rest(&mut self, v: f32) {
        self.inner.rest_open = v;
    }
    /// theme.body JSON `{"tank":{"w","h","d"},"eyes":{"size","spacing","y"}}` (all optional):
    /// eyes, handle, paper roll and the lid-vs-tank collision box follow the tank
    pub fn set_body_dims(&mut self, json: &str) {
        self.inner.set_body_dims(BodyDims::from_json(json));
    }
    /// world (rig root) matrix of the `lip_upper` socket (column-major 16 floats)
    pub fn lip_upper_matrix(&self) -> Vec<f32> {
        self.inner.lip_upper_matrix().to_cols_array().to_vec()
    }
    /// lower lip: [front drop below rest (m, > 0 = lower), forward slide (m)]
    pub fn seat_front(&self) -> Vec<f32> {
        let (d, s) = self.inner.seat_front();
        vec![d, s]
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
    /// number of queued sound events (check this first: no string alloc when 0)
    pub fn pending_events(&self) -> u32 {
        self.inner.pending_events() as u32
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
            16 => &r.jet.stream_nrm,
            17 => &r.paper.nrm,
            18 => &r.torn.nrm,
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
