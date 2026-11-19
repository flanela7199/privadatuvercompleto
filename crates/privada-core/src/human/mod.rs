//! The human character ("Chratos"): a stylized bust sculpted procedurally.
//!
//! * [`sdf`] / [`iso`] — signed-distance primitives and surface nets (isosurface -> mesh)
//! * [`head`]  — head + neck sculpt, skin weights, masks (beard, brows, scalp), vertex colours
//! * [`morph`] — 24 blend shapes as displacement fields + the viseme table
//! * [`hair`]  — scalp hair (cap + wavy clumps), beard + mustache, eyebrows
//! * [`parts`] — eyes, teeth + tongue, hoodie torso, headphones, plug, chair headrest
//! * [`rig`]   — per-frame logic ([`rig::HumanRig`]): look, eyes, blink, breathing, mouth, actions, cable
//!
//! Meshes go through the same PRVM mesh cache as `geo` (web/src/rig/geocache.js) with kinds
//! `human_<part>` and params `{ "detail": 1, "v": HUMAN_VERSION, "attr"?: "color" | "skin" |
//! "morph" | "meta", "morph"?: "<name>" }`. With `attr`, the returned mesh's POSITIONS hold that
//! attribute (rgb linear colour / chest-neck-head weights / morph deltas), 3 floats per vertex.
//! Space: metres, y up, +z forward, origin between the ears; **L = -x**.
pub mod hair;
pub mod head;
pub mod iso;
pub mod morph;
pub mod parts;
pub mod rig;
pub mod sdf;

use crate::geo::{Json, Mesh};
use glam::Vec3;
use parts::Part;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// bump when any mesh changes (part of the cache key through the `v` param)
pub const HUMAN_VERSION: u32 = 1;
pub const PARTS: [&str; 14] = [
    "head", "beard", "brows", "hair", "eye", "cornea", "mouth_upper", "mouth_lower", "torso", "hp_shell", "hp_pad", "hp_metal", "plug", "chair",
];

struct HeadData {
    surf: head::Surf,
    morphs: Vec<Vec<Vec3>>,
}

#[derive(Default)]
struct Model {
    detail: f32,
    head: Option<Rc<HeadData>>,
    parts: HashMap<String, Rc<Part>>,
}

thread_local! {
    static MODEL: RefCell<Model> = RefCell::new(Model::default());
}

/// drop the cached model (call after all meshes were fetched)
pub fn free() {
    MODEL.with(|m| *m.borrow_mut() = Model::default());
}

fn head_data(m: &mut Model) -> Rc<HeadData> {
    if let Some(h) = &m.head {
        return h.clone();
    }
    let surf = head::build_head(m.detail);
    let morphs = (0..morph::N).map(|i| surf.p0.iter().zip(&surf.pos).map(|(&p0, &p)| morph::delta(i, p0, p)).collect()).collect();
    let h = Rc::new(HeadData { surf, morphs });
    m.head = Some(h.clone());
    h
}

/// build (or fetch from the per-thread cache) one part at `detail`
pub fn part(name: &str, detail: f32) -> Result<Rc<Part>, String> {
    MODEL.with(|cell| {
        let mut m = cell.borrow_mut();
        if m.detail != detail {
            *m = Model { detail, ..Default::default() };
        }
        if let Some(p) = m.parts.get(name) {
            return Ok(p.clone());
        }
        let p = match name {
            "head" => {
                let h = head_data(&mut m);
                let s = &h.surf;
                Part {
                    pos: s.pos.clone(),
                    nrm: s.nrm.clone(),
                    col: s.p0.iter().map(|&p| head::color(p)).collect(),
                    idx: s.idx.clone(),
                    skin: s.p0.iter().map(|&p| head::skin_weights(p)).collect(),
                    morphs: h.morphs.iter().cloned().enumerate().collect(),
                }
            }
            "beard" => {
                let h = head_data(&mut m);
                hair::beard(&h.surf, &h.morphs, detail)
            }
            "brows" => {
                let h = head_data(&mut m);
                hair::brows(&h.surf, &h.morphs, detail)
            }
            "hair" => hair::hair(detail),
            "eye" => parts::eye(),
            "cornea" => parts::cornea(),
            "mouth_upper" => parts::mouth_upper(),
            "mouth_lower" => parts::mouth_lower(),
            "torso" => parts::torso(detail),
            "hp_shell" => parts::hp_shell(detail),
            "hp_pad" => parts::hp_pad(detail),
            "hp_metal" => parts::hp_metal(detail),
            "plug" => parts::plug(),
            "chair" => parts::chair(detail),
            o => return Err(format!("human: unknown part '{o}'")),
        };
        let p = Rc::new(p);
        m.parts.insert(name.to_string(), p.clone());
        Ok(p)
    })
}

fn flat(v: &[Vec3]) -> Vec<f32> {
    v.iter().flat_map(|p| [p.x, p.y, p.z]).collect()
}

fn part_name(kind: &str) -> Result<&str, String> {
    kind.strip_prefix("human_").ok_or_else(|| format!("human: unknown kind '{kind}'"))
}

/// `kind` = `human_<part>`; see the module docs for params
pub fn build(kind: &str, params_json: &str) -> Result<Mesh, String> {
    let name = part_name(kind)?;
    let p = Json::parse(params_json)?;
    let part = part(name, p.f("detail", 1.0) as f32)?;
    match p.s("attr", "") {
        "" => {
            let uvs = part.pos.iter().flat_map(|q| [q.x.atan2(q.z) / std::f32::consts::TAU + 0.5, q.y * 2.0 + 0.6]).collect();
            Ok(Mesh { positions: flat(&part.pos), normals: flat(&part.nrm), uvs, indices: part.idx.clone() })
        }
        "color" => Ok(Mesh { positions: flat(&part.col), ..Default::default() }),
        "skin" => {
            if part.skin.is_empty() {
                return Err(format!("human: part '{name}' is rigid"));
            }
            Ok(Mesh { positions: part.skin.iter().flat_map(|w| *w).collect(), ..Default::default() })
        }
        "morph" => {
            let want = p.s("morph", "");
            let i = morph::MORPH_NAMES.iter().position(|n| *n == want).ok_or_else(|| format!("human: unknown morph '{want}'"))?;
            let d = part.morphs.iter().find(|(k, _)| *k == i).ok_or_else(|| format!("human: part '{name}' has no morph '{want}'"))?;
            Ok(Mesh { positions: flat(&d.1), ..Default::default() })
        }
        // [skinned, triangles, vertices, has_morph_0 .. has_morph_23] (so a cached model needs no rebuild to be described)
        "meta" => {
            let mut f = vec![(!part.skin.is_empty()) as u32 as f32, part.tri_count() as f32, part.pos.len() as f32];
            f.extend((0..morph::N).map(|i| part.morphs.iter().any(|(k, _)| *k == i) as u32 as f32));
            Ok(Mesh { positions: f, ..Default::default() })
        }
        o => Err(format!("human: unknown attr '{o}'")),
    }
}

/// `{"verts":n,"tris":n,"skinned":bool,"morphs":["jaw_open",...]}` of one part
pub fn part_info(kind: &str, params_json: &str) -> Result<String, String> {
    let name = part_name(kind)?;
    let p = Json::parse(params_json)?;
    let part = part(name, p.f("detail", 1.0) as f32)?;
    let morphs: Vec<String> = part.morphs.iter().map(|(i, _)| format!("\"{}\"", morph::MORPH_NAMES[*i])).collect();
    Ok(format!("{{\"verts\":{},\"tris\":{},\"skinned\":{},\"morphs\":[{}]}}", part.pos.len(), part.tri_count(), !part.skin.is_empty(), morphs.join(",")))
}

/// static description of the rig for the renderer (bind positions in model space, names, cable)
pub fn rig_info() -> String {
    let v3 = |p: Vec3| format!("[{},{},{}]", p.x, p.y, p.z);
    let names = |a: &[&str]| a.iter().map(|n| format!("\"{n}\"")).collect::<Vec<_>>().join(",");
    format!(
        "{{\"version\":{},\"bottom\":{},\"top\":0.165,\"parts\":[{}],\"nodes\":[{}],\"morphs\":[{}],\"bind\":{{\"chest\":{},\"neck\":{},\"head\":{},\"jaw\":{},\"eye\":{}}},\"eyeRadius\":{},\"cable\":{{\"points\":{},\"sides\":{}}},\"sockets\":{{\"head_top\":{},\"eyes\":{},\"mouth\":{}}}}}",
        HUMAN_VERSION,
        parts::BUST_BOTTOM,
        names(&PARTS),
        names(&rig::NODES),
        names(&morph::MORPH_NAMES),
        v3(head::CHEST_POS),
        v3(head::NECK_POS),
        v3(head::HEAD_POS),
        v3(head::HINGE),
        v3(head::EYE),
        head::EYE_R,
        rig::CABLE_PTS,
        rig::CABLE_SIDES,
        v3(Vec3::new(0.0, 0.150, -0.010)),
        v3(Vec3::new(0.0, head::EYE.y, head::EYE.z + head::EYE_R + 0.012)),
        v3(Vec3::new(0.0, head::MOUTH_Y, 0.104)),
    )
}

/// the viseme table as JSON `{ "AA": {"jaw_open":1,...}, ... }`
pub fn visemes_json() -> String {
    let all: Vec<String> = morph::viseme_table()
        .iter()
        .map(|(n, w)| {
            let kv: Vec<String> = morph::MORPH_NAMES.iter().zip(w).filter(|(_, x)| **x != 0.0).map(|(k, x)| format!("\"{k}\":{x}")).collect();
            format!("\"{n}\":{{{}}}", kv.join(","))
        })
        .collect();
    format!("{{{}}}", all.join(","))
}

#[cfg(test)]
mod tests;
