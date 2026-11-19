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
//! | 0 | pose | `node_order()` (25 nodes: root pelvis spine1 spine2 chest neck head jaw eye_L eye_R, clavicle / upperarm / forearm / hand L+R, thigh / shin / foot L+R, plug) x [px,py,pz, qx,qy,qz,qw, sx,sy,sz] local TRS (`plug`: root space) |
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

/// procedural RGBA eye texture (sRGB bytes, `size` x `size`) for the planar UVs of the `eye` part
#[wasm_bindgen]
pub fn human_eye_texture(size: u32) -> Vec<u8> {
    human::parts::eye_texture(size.clamp(16, 2048) as usize)
}

/// procedural RGBA hair-card texture (`w` across, `h` along; alpha = strands, rgb = strand brightness)
#[wasm_bindgen]
pub fn human_hair_texture(w: u32, h: u32) -> Vec<u8> {
    human::parts::hair_texture(w.clamp(8, 2048) as usize, h.clamp(8, 4096) as usize)
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
    /// seat height above the floor (m) used by the `sit` action / `set_sit` (default 0.45)
    pub fn set_seat_height(&mut self, h: f32) {
        self.inner.set_seat_height(h)
    }
    /// 0 = standing .. 1 = seated (persistent)
    pub fn set_sit(&mut self, v: f32) {
        self.inner.set_sit(v)
    }
    pub fn is_sitting(&self) -> bool {
        self.inner.is_sitting()
    }
    /// external body overrides added to the running actions (same meaning as the toilet `o.*`):
    /// lift (m), flip (rad, backward somersault), spin (rad), squash (0..1)
    pub fn set_body_override(&mut self, lift: f32, flip: f32, spin: f32, squash: f32) {
        self.inner.ext.lift = lift;
        self.inner.ext.flip = flip;
        self.inner.ext.spin = spin;
        self.inner.ext.squash = squash;
    }
    /// external mouth override: opening 0..1 of the FULL jaw range (1 = 36 deg spit pose); negative = none
    pub fn set_mouth_override(&mut self, open: f32) {
        self.inner.ext.mouth = if open >= 0.0 { Some(open.min(1.0)) } else { None };
    }
    /// where a water jet leaves the mouth: [px, py, pz, dx, dy, dz] in rig-root space
    pub fn spout(&self) -> Vec<f32> {
        self.inner.spout().to_vec()
    }
    /// rig-root matrix of a skeleton node by index in `node_order()` (16 floats, column-major)
    pub fn node_matrix(&self, index: u32) -> Vec<f32> {
        let i = (index as usize).min(rig::NODES - 1);
        privada_core::glam::Mat4::from(self.inner.world(i)).to_cols_array().to_vec()
    }
    /// laugh | nod | no | surprise | wink | blink | jump | backflip | gargle | blargh (spit) | sit | stand
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
        human::body::SKELETON.iter().map(|b| b.0).collect::<Vec<_>>().join(",")
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
