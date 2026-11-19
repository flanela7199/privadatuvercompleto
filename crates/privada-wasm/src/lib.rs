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
//! | 19 | prop poses | MAX_PROPS (32) x 12: [state, px,py,pz, qx,qy,qz,qw, sx,sy,sz, speed] (rig-root TRS of the accessory origin; state -1 empty, 0 rest, 1 dynamic, 2 on the floor, 3 flying back) |
//! | 20 | prop rest | MAX_PROPS x 16 column-major rest matrices (rig-root space): **JS may write this view** every frame (same as `set_prop_rest`) |
//! | 21/22 | paper / torn colour | 150*2 x 4 RGBA per vertex (wet = darker + translucent; 1 = dry) |
use privada_core::dim::BodyDims;
use privada_core::props::{PropDef, PROP_STRIDE};
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
    /// (L = the -x side, like eye_L), jaw side -1..1, jaw forward 0..1, upper-lip raise 0..1,
    /// lips 0..1 (lip activity from avatar.js shapeMouth: the lips fold even when `open` is capped)
    pub fn set_input_ext(&mut self, corner_l: f32, corner_r: f32, jaw_side: f32, jaw_fwd: f32, upper_raise: f32, lips: Option<f32>) {
        self.mouth = Mouth { corner_l, corner_r, jaw_side, jaw_fwd, upper_raise, lips: lips.unwrap_or(0.0), ..self.mouth };
    }
    /// headless lip measurements: [seat front travel (m), seat roll (deg, + = out/down),
    /// lid front-third curl (deg, + = up/out), lid front forward shift (m)]
    pub fn lip_metrics(&self) -> Vec<f32> {
        let l = self.inner.lip_metrics();
        vec![l.seat_travel, l.seat_roll, l.lid_curl, l.lid_fwd]
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
    /// theme.body JSON `{"tank":{"w","h","d"},"eyes":{"size","spacing","y"},"neck":{"length"},"roll":{"mount":"side"|"front"}}` (all optional):
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
    /// flush | paper | jump | backflip | no | gargle | blink | sit | stand
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
    /* ---------------------------------------------------------- sitting on furniture */
    /// persistent sit height (m): raises the whole body base, smoothly (~0.3 s); 0 = floor
    pub fn set_sit_height(&mut self, h: f32) {
        self.inner.set_sit_height(h)
    }
    /// current base height (m)
    pub fn sit_height(&self) -> f32 {
        self.inner.sit_height()
    }
    pub fn is_sitting(&self) -> bool {
        self.inner.is_sitting()
    }
    /// seat height of the chair on floor_under (0 = none): play("sit") hops up to it, play("stand") down
    pub fn set_seat_height(&mut self, h: f32) {
        self.inner.set_seat_height(h)
    }
    pub fn seat_height(&self) -> f32 {
        self.inner.seat_height()
    }

    /* ---------------------------------------------------------- props physics */
    /// Register (or replace) a physical prop. `shape_json`: `{"kind":"box"|"cylinder", "size":[x,y,z] | {"r","h"},
    /// "mass", "com":[x,y,z], "center":[x,y,z], "group":"..", "buoyant":bool}` (object-local: the accessory's own
    /// space, size = full extents); `rest` = its rest world (rig-root) matrix, 16 floats column-major.
    /// Returns the slot (index into the prop buffers) or -1 (bad shape / 32 props already).
    pub fn register_prop(&mut self, id: &str, shape_json: &str, rest: &[f32]) -> i32 {
        let Ok(def) = PropDef::from_json(shape_json) else { return -1 };
        let m = if rest.len() >= 16 { privada_core::glam::Mat4::from_cols_slice(&rest[..16]) } else { privada_core::glam::Mat4::IDENTITY };
        self.inner.props.register(id, def, m)
    }
    pub fn unregister_prop(&mut self, id: &str) -> bool {
        self.inner.props.unregister(id)
    }
    pub fn clear_props(&mut self) {
        self.inner.props.clear()
    }
    /// slot of a prop id, -1 if unknown
    pub fn prop_index(&self, id: &str) -> i32 {
        self.inner.props.index(id).map_or(-1, |k| k as i32)
    }
    /// slots in use (prop buffers are valid for 0..prop_count())
    pub fn prop_count(&self) -> u32 {
        self.inner.props.count() as u32
    }
    /// new rest world matrix of a prop (call every frame: the sockets move with him); see also buffer 20
    pub fn set_prop_rest(&mut self, id: &str, m: &[f32]) -> bool {
        match self.inner.props.index(id) {
            Some(k) => {
                self.inner.props.set_rest(k, m);
                true
            }
            None => false,
        }
    }
    /// same by slot (no string)
    pub fn set_prop_rest_slot(&mut self, slot: u32, m: &[f32]) {
        self.inner.props.set_rest(slot as usize, m);
    }
    /// writable pointer to the rest-matrix buffer (MAX_PROPS x 16 f32)
    pub fn prop_rest_ptr(&mut self) -> u32 {
        self.inner.props.rest_buf.as_mut_ptr() as u32
    }
    /// copy of the pose buffer for the used slots: prop_count() x 12 (see buffer 19)
    pub fn prop_poses(&self) -> Vec<f32> {
        self.inner.props.out[..self.inner.props.count() * PROP_STRIDE].to_vec()
    }
    /// `{"resetAfter": seconds (0 = never, default 8), "enabled": bool}`
    pub fn set_props_config(&mut self, json: &str) {
        self.inner.props.configure(json)
    }
    /// push a prop (impulse in N s, rig-root space) at its centre of mass: debug / "kick" buttons
    pub fn prop_kick(&mut self, id: &str, jx: f32, jy: f32, jz: f32) -> bool {
        match self.inner.props.index(id) {
            Some(k) => {
                self.inner.props.kick(k, privada_core::glam::Vec3::new(jx, jy, jz), privada_core::glam::Vec3::ZERO);
                true
            }
            None => false,
        }
    }
    /// per-point wetness 0..1 of the paper strip (debug)
    pub fn paper_wetness(&self) -> Vec<f32> {
        self.inner.paper.pts.iter().map(|o| o.wet).collect()
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
            19 => &r.props.out,
            20 => &r.props.rest_buf,
            21 => &r.paper.col,
            22 => &r.torn.col,
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
