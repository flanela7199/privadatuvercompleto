//! Procedural meshes in Rust (same output as the JS builders) + a binary mesh format
//! used by the mesh cache (web/src/rig/geocache.js, privada-data/cache/*.bin).
//!
//! Kinds (`build(kind, params_json)`):
//!
//! | kind | params |
//! |---|---|
//! | `egg_revolve` | `{rx, rz, k, seg, profile: [[s,y],...] \| {lid:[rx,depth,dome,e]} \| {seat:[rx,s0,h]}}` |
//! | `lathe` | `{points: [[r,y],...], segments, scaleZ?, egg?}` (bowl: Lathe -> scale(1,1,sz) -> eggify) |
//! | `rounded_box` | `{w, h, d, segments, radius}` (three.js RoundedBoxGeometry, non-indexed) |
//! | `crown_shell` | `{R, H, band, n, th?, cols?, rows?}` |
//! | `mustache` | `{style, part: core\|hair\|mid, side: 1\|-1, length?, thickness?, bowl?: {profile, scaleZ, egg}}` |
//!
//! Binary mesh ("PRVM", little-endian, all sections 4-byte aligned):
//! `0 magic "PRVM" | 4 u32 format=1 | 8 u32 GEO_VERSION | 12 u32 flags (1 normals, 2 uvs, 4 indices)
//! | 16 u32 vertex_count | 20 u32 index_count | 24 u32 0 | 28 u32 0 | 32.. f32 positions[vc*3],
//! f32 normals[vc*3]?, f32 uvs[vc*2]?, u32 indices[ic]?`
pub mod crown;
pub mod curve;
pub mod hair;
pub mod json;
pub mod mesh;
pub mod shapes;
pub mod v3;

pub use json::Json;
pub use mesh::Mesh;

/// Bump when any builder's output changes (invalidates every cached mesh).
pub const GEO_VERSION: u32 = 4; // 4: mustaches fit the thick lid rim (lip_upper socket) + clear the seat
pub const FORMAT: u32 = 1;

pub fn build(kind: &str, params_json: &str) -> Result<Mesh, String> {
    let p = Json::parse(params_json)?;
    build_json(kind, &p)
}

fn need(p: &Json, k: &str) -> Result<f64, String> {
    p.opt_f(k).ok_or_else(|| format!("geo: missing number '{k}'"))
}

pub fn build_json(kind: &str, p: &Json) -> Result<Mesh, String> {
    match kind {
        "egg_revolve" => {
            let (rx, rz, k) = (need(p, "rx")?, need(p, "rz")?, p.f("k", 0.1));
            let seg = p.f("seg", 128.0) as usize;
            let prof = p.get("profile").ok_or("geo: missing profile")?;
            let profile = if let Some(v) = prof.pairs() {
                v
            } else if let Some(a) = prof.get("lid").and_then(|a| num_list(a)) {
                if a.len() < 4 {
                    return Err("geo: lid profile needs [rx, depth, dome, e]".into());
                }
                shapes::lid_profile(a[0], a[1], a[2], a[3])
            } else if let Some(a) = prof.get("seat").and_then(|a| num_list(a)) {
                if a.len() < 3 {
                    return Err("geo: seat profile needs [rx, s0, h]".into());
                }
                shapes::seat_profile(a[0], a[1], a[2])
            } else {
                return Err("geo: bad profile".into());
            };
            if profile.len() < 2 || seg == 0 {
                return Err("geo: profile too short".into());
            }
            Ok(shapes::egg_revolve(rx, rz, k, &profile, seg))
        }
        "lathe" => {
            let pts = p.get("points").and_then(Json::pairs).ok_or("geo: missing points")?;
            if pts.len() < 2 {
                return Err("geo: lathe needs 2+ points".into());
            }
            let mut m = shapes::lathe(&pts, p.f("segments", 12.0) as usize);
            if let Some(sz) = p.opt_f("scaleZ") {
                shapes::scale_z(&mut m, sz);
            }
            if let Some(k) = p.opt_f("egg") {
                shapes::eggify(&mut m, k);
            }
            Ok(m)
        }
        "rounded_box" => Ok(shapes::rounded_box(
            p.f("w", 1.0), p.f("h", 1.0), p.f("d", 1.0), p.f("segments", 2.0) as usize, p.f("radius", 0.1),
        )),
        "crown_shell" => Ok(crown::crown_shell(
            need(p, "R")?, need(p, "H")?, need(p, "band")?, need(p, "n")?, p.f("th", 0.006),
            p.f("cols", 256.0) as usize, p.f("rows", 8.0) as usize,
        )),
        "mustache" => {
            let id = p.s("style", "");
            let st = hair::style(id).ok_or_else(|| format!("geo: unknown mustache style '{id}'"))?;
            let ctx = mustache_ctx(&st, p);
            let side = if p.f("side", 1.0) < 0.0 { -1.0 } else { 1.0 };
            match p.s("part", "") {
                "core" => Ok(ctx.core(side)),
                "hair" => Ok(ctx.hair(side, if side > 0.0 { 0 } else { 1 })),
                "mid" => Ok(ctx.mid()),
                o => Err(format!("geo: unknown mustache part '{o}'")),
            }
        }
        _ => Err(format!("geo: unknown kind '{kind}'")),
    }
}

fn num_list(a: &Json) -> Option<Vec<f64>> {
    a.arr()?.iter().map(Json::num).collect()
}

fn mustache_ctx<'a>(st: &'a hair::Style, p: &Json) -> hair::MustacheCtx<'a> {
    let bowl = p.get("bowl");
    let prof = bowl.and_then(|b| b.get("profile")).and_then(Json::pairs).unwrap_or_else(hair::default_bowl_profile);
    let sz = bowl.map(|b| b.f("scaleZ", 1.22)).unwrap_or(1.22);
    let k = bowl.map(|b| b.f("egg", 0.08)).unwrap_or(0.08);
    hair::MustacheCtx { st, surf: hair::LipFront::new(&prof, sz, k), l: p.f("length", 1.0), th: p.f("thickness", 1.0) }
}

/// z of the mustache centre knot (socket space), for the JS SphereGeometry
pub fn mustache_knot_z(params_json: &str) -> Result<f64, String> {
    let p = Json::parse(params_json)?;
    let id = p.s("style", "");
    let st = hair::style(id).ok_or_else(|| format!("geo: unknown mustache style '{id}'"))?;
    Ok(mustache_ctx(&st, &p).knot_z())
}

/// stable cache key: `<kind>-<fnv1a64(kind, params, GEO_VERSION) hex>`
pub fn cache_key(kind: &str, params_json: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    let mut eat = |b: &[u8]| {
        for &c in b {
            h ^= c as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    };
    eat(kind.as_bytes());
    eat(&[1]);
    eat(params_json.as_bytes());
    eat(&[1]);
    eat(&GEO_VERSION.to_le_bytes());
    let safe: String = kind.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect();
    format!("{safe}-{h:016x}")
}

pub fn encode(m: &Mesh) -> Vec<u8> {
    let vc = m.vertex_count();
    let has_n = m.normals.len() == vc * 3 && vc > 0;
    let has_uv = m.uvs.len() == vc * 2 && vc > 0;
    let has_i = !m.indices.is_empty();
    let flags = (has_n as u32) | ((has_uv as u32) << 1) | ((has_i as u32) << 2);
    let mut out = Vec::with_capacity(32 + 4 * (vc * 8 + m.indices.len()));
    out.extend_from_slice(b"PRVM");
    for v in [FORMAT, GEO_VERSION, flags, vc as u32, m.indices.len() as u32, 0, 0] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    let mut f = |a: &[f32]| a.iter().for_each(|x| out.extend_from_slice(&x.to_le_bytes()));
    f(&m.positions);
    if has_n {
        f(&m.normals);
    }
    if has_uv {
        f(&m.uvs);
    }
    if has_i {
        m.indices.iter().for_each(|x| out.extend_from_slice(&x.to_le_bytes()));
    }
    out
}

pub fn decode(b: &[u8]) -> Result<Mesh, String> {
    if b.len() < 32 || &b[0..4] != b"PRVM" {
        return Err("prvm: bad magic".into());
    }
    let u = |o: usize| u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);
    if u(4) != FORMAT {
        return Err("prvm: unknown format".into());
    }
    if u(8) != GEO_VERSION {
        return Err("prvm: stale geo version".into());
    }
    let (flags, vc, ic) = (u(12), u(16) as usize, u(20) as usize);
    let need = 32 + 4 * (vc * 3 + if flags & 1 != 0 { vc * 3 } else { 0 } + if flags & 2 != 0 { vc * 2 } else { 0 } + if flags & 4 != 0 { ic } else { 0 });
    if b.len() < need {
        return Err("prvm: truncated".into());
    }
    let mut o = 32;
    let mut fl = |n: usize| {
        let v: Vec<f32> = (0..n).map(|i| f32::from_le_bytes(b[o + i * 4..o + i * 4 + 4].try_into().unwrap())).collect();
        o += n * 4;
        v
    };
    let positions = fl(vc * 3);
    let normals = if flags & 1 != 0 { fl(vc * 3) } else { Vec::new() };
    let uvs = if flags & 2 != 0 { fl(vc * 2) } else { Vec::new() };
    let indices = if flags & 4 != 0 {
        (0..ic).map(|i| u(o + i * 4)).collect()
    } else {
        Vec::new()
    };
    Ok(Mesh { positions, normals, uvs, indices })
}

#[cfg(test)]
mod tests;
