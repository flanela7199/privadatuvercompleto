//! wasm bindings for privada_core::geo: build heavy procedural meshes in Rust.
//!
//! JS: `const b = build_mesh_prvm(kind, paramsJson)` -> Uint8Array in the PRVM format
//! (see privada_core::geo docs) — the same bytes are stored in the persistent mesh cache,
//! so a cache hit and a fresh build decode the same way.
use privada_core::{geo, human};
use wasm_bindgen::prelude::*;

/// kinds starting with `human_` are built by privada_core::human (same PRVM bytes / cache)
fn build_any(kind: &str, params_json: &str) -> Result<geo::Mesh, String> {
    if kind.starts_with("human_") { human::build(kind, params_json) } else { geo::build(kind, params_json) }
}

/// Mesh in the PRVM binary layout (positions/normals/uvs f32, indices u32).
#[wasm_bindgen]
pub fn build_mesh_prvm(kind: &str, params_json: &str) -> Result<Vec<u8>, JsValue> {
    build_any(kind, params_json).map(|m| geo::encode(&m)).map_err(|e| JsValue::from_str(&e))
}

/// Mesh as separate typed arrays.
#[wasm_bindgen]
pub struct MeshBuf {
    m: geo::Mesh,
}

impl MeshBuf {
    pub(crate) fn from_mesh(m: geo::Mesh) -> MeshBuf {
        MeshBuf { m }
    }
}

#[wasm_bindgen]
impl MeshBuf {
    pub fn positions(&self) -> Vec<f32> {
        self.m.positions.clone()
    }
    pub fn normals(&self) -> Vec<f32> {
        self.m.normals.clone()
    }
    pub fn uvs(&self) -> Vec<f32> {
        self.m.uvs.clone()
    }
    pub fn indices(&self) -> Vec<u32> {
        self.m.indices.clone()
    }
    pub fn vertex_count(&self) -> usize {
        self.m.vertex_count()
    }
    pub fn encode(&self) -> Vec<u8> {
        geo::encode(&self.m)
    }
}

#[wasm_bindgen]
pub fn build_mesh(kind: &str, params_json: &str) -> Result<MeshBuf, JsValue> {
    build_any(kind, params_json).map(|m| MeshBuf { m }).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn mesh_cache_key(kind: &str, params_json: &str) -> String {
    geo::cache_key(kind, params_json)
}

#[wasm_bindgen]
pub fn geo_version() -> u32 {
    geo::GEO_VERSION
}

/// z of the mustache centre knot in socket space (params like kind `mustache`)
#[wasm_bindgen]
pub fn mustache_knot_z(params_json: &str) -> Result<f64, JsValue> {
    geo::mustache_knot_z(params_json).map_err(|e| JsValue::from_str(&e))
}

/// ids of the mustache styles implemented in Rust
#[wasm_bindgen]
pub fn mustache_styles() -> String {
    geo::hair::STYLE_IDS.join(",")
}
