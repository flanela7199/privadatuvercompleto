//! wasm bindings of privada_core::human (the "Chratos" character).
//!
//! Meshes: `build_mesh_prvm("human_<part>", params)` (see geo.rs: kinds starting with `human_`
//! are routed here, so web/src/rig/geocache.js caches them like any other mesh) or
//! `human_build(params)` with `{"part": "head", "detail": 1, "attr"?: "color"|"skin"|"morph", "morph"?: name}`.
//!
//! Rig: `HumanRig` — `set_input` / `set_input_ext` (same mouth vector as the toilet `Rig`),
//! `update(dt)`, zero-copy buffers through `buf_ptr(id)` / `buf_len(id)`:
//!
//! | id | buffer | layout |
//! |---|---|---|
//! | 0 | pose | `node_order()` (root chest neck head jaw eye_L eye_R plug) x [px,py,pz, qx,qy,qz,qw, sx,sy,sz] local TRS (`plug`: root space) |
//! | 1 | morphs | 24 weights, names in `morph_names()` |
//! | 2 | cable positions | 20 rings x 6 vertices x 3 (root space), triangles = `human_cable_indices()` |
//! | 3 | cable normals | same layout |
use crate::geo::MeshBuf;
use privada_core::geo::Json;
use privada_core::human::{self, morph, rig};
use privada_core::rig::Mouth;
use wasm_bindgen::prelude::*;

/// one part of the character as typed arrays (`params.part`, default "head")
#[wasm_bindgen]
pub fn human_build(params_json: &str) -> Result<MeshBuf, JsValue> {
    let part = Json::parse(params_json).map_err(|e| JsValue::from_str(&e))?.s("part", "head").to_string();
    human::build(&format!("human_{part}"), params_json).map(MeshBuf::from_mesh).map_err(|e| JsValue::from_str(&e))
}

/// `{"verts","tris","skinned","morphs":[names]}` of `human_<part>` (builds it if needed)
#[wasm_bindgen]
pub fn human_part_info(kind: &str, params_json: &str) -> Result<String, JsValue> {
    human::part_info(kind, params_json).map_err(|e| JsValue::from_str(&e))
}

/// static rig description: parts, nodes, morph names, bind positions, sockets, cable layout (JSON)
#[wasm_bindgen]
pub fn human_rig_info() -> String {
    human::rig_info()
}

/// morph weights of rest + the 16 standard visemes (JSON)
#[wasm_bindgen]
pub fn human_visemes() -> String {
    human::visemes_json()
}

#[wasm_bindgen]
pub fn human_version() -> u32 {
    human::HUMAN_VERSION
}

/// triangle indices of the cable tube
#[wasm_bindgen]
pub fn human_cable_indices() -> Vec<u32> {
    rig::cable_indices()
}

/// drop the model kept in wasm memory while the parts are being fetched
#[wasm_bindgen]
pub fn human_free() {
    human::free()
}

#[wasm_bindgen]
pub struct HumanRig {
    inner: rig::HumanRig,
    look: (f32, f32),
    mouth: Mouth,
}

#[wasm_bindgen]
impl HumanRig {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: Option<u32>) -> HumanRig {
        HumanRig { inner: rig::HumanRig::new(seed.unwrap_or(1) as u64), look: (0.0, 0.0), mouth: Mouth::default() }
    }
    /// look -1..1 (x right, y up) and the mouth vector (all 0..1)
    #[allow(clippy::too_many_arguments)]
    pub fn set_input(&mut self, look_x: f32, look_y: f32, open: f32, round: f32, wide: f32, closed: f32, sib: f32) {
        self.look = (look_x, look_y);
        self.mouth = Mouth { open, round, wide, closed, sib, ..self.mouth };
    }
    /// extra mouth channels (kept until changed): corners -1..1 (L = -x), jaw side -1..1, jaw forward, upper-lip raise, lips
    pub fn set_input_ext(&mut self, corner_l: f32, corner_r: f32, jaw_side: f32, jaw_fwd: f32, upper_raise: f32, lips: Option<f32>) {
        self.mouth = Mouth { corner_l, corner_r, jaw_side, jaw_fwd, upper_raise, lips: lips.unwrap_or(0.0), ..self.mouth };
    }
    /// total look range in radians (chest + neck + head; the eyes lead)
    pub fn set_look_limits(&mut self, max_yaw_rad: f32, max_pitch_rad: f32) {
        self.inner.set_look_limits(max_yaw_rad, max_pitch_rad);
    }
    /// seconds until the next automatic blink (> 1e8 = never)
    pub fn set_blink_timer(&mut self, t: f32) {
        self.inner.blink_timer = t;
    }
    pub fn blink_timer(&self) -> f32 {
        self.inner.blink_timer
    }
    /// resting smile 0..1 (default 0.30)
    pub fn set_rest_smile(&mut self, v: f32) {
        self.inner.rest_smile = v.clamp(0.0, 1.0);
    }
    /// laugh | nod | no | surprise | wink | blink
    pub fn play(&mut self, name: &str) -> bool {
        self.inner.play(name)
    }
    pub fn is_playing(&self) -> bool {
        self.inner.is_playing()
    }
    pub fn update(&mut self, dt: f32) {
        self.inner.update(dt, self.look, self.mouth);
    }
    pub fn node_order(&self) -> String {
        rig::NODES.join(",")
    }
    pub fn morph_names(&self) -> String {
        morph::MORPH_NAMES.join(",")
    }
    pub fn pose(&self) -> Vec<f32> {
        self.inner.pose().to_vec()
    }
    pub fn morphs(&self) -> Vec<f32> {
        self.inner.morphs().to_vec()
    }
    /// world (rig root) matrix of the head bone (16 floats, column-major)
    pub fn head_matrix(&self) -> Vec<f32> {
        self.inner.head_matrix().to_vec()
    }
    pub fn pending_events(&self) -> u32 {
        self.inner.pending_events() as u32
    }
    /// events since the last call, '\n'-separated (laugh, gasp)
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

impl HumanRig {
    fn slice(&self, id: u32) -> &[f32] {
        match id {
            0 => self.inner.pose(),
            1 => self.inner.morphs(),
            2 => self.inner.cable_pos(),
            3 => self.inner.cable_nrm(),
            _ => &[],
        }
    }
}
