//! Binary cache for generated meshes (layout 'PRVM', see docs/app-contract.md "Mesh cache") and
//! thumbnails: `<exe dir>/privada-data/cache/<key>.bin` / `<key>.png`.
//!
//! Raw bytes both ways (no JSON number arrays):
//!   cache_get({key})            -> ArrayBuffer (EMPTY = miss)
//!   cache_put(bytes, headers {'x-key': key}) -> true
//!   thumb_get / thumb_put       -> same, stored as .png
//! All file I/O happens off the main thread. At startup (while the splash shows) the files listed
//! for the active outfit in `cache/manifest.json` ({ outfitId: [keys] }) are read into memory so the
//! first `cache_get` of each is instant.
//! The key `manifest` is stored as `manifest.json` (cache_get/cache_put read/write that file).
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};

/// Bytes read ahead of time, handed out once by cache_get.
#[derive(Default)]
pub struct Preloaded(pub Mutex<HashMap<String, Vec<u8>>>);

pub fn dir() -> PathBuf {
    crate::config::data_dir().join("cache")
}

pub fn valid_key(k: &str) -> bool {
    (1..=96).contains(&k.len()) && k.bytes().all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-'))
}

fn file(key: &str, ext: &str) -> Result<PathBuf, String> {
    if !valid_key(key) {
        return Err(format!("invalid cache key {key:?} (allowed: [a-z0-9_-]{{1,96}})"));
    }
    // the outfit -> keys manifest is JSON (also read by the startup preload)
    let ext = if key == "manifest" && ext == "bin" { "json" } else { ext };
    Ok(dir().join(format!("{key}.{ext}")))
}

async fn get(key: String, ext: &'static str, pre: Option<Vec<u8>>) -> Result<Response, String> {
    if let Some(b) = pre {
        return Ok(Response::new(b));
    }
    let path = file(&key, ext)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path).unwrap_or_default())
        .await
        .map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

async fn put(request: &Request<'_>, ext: &'static str) -> Result<bool, String> {
    let key = request
        .headers()
        .get("x-key")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-key header")?
        .to_string();
    let path = file(&key, ext)?;
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        InvokeBody::Json(_) => return Err("send raw bytes: invoke('cache_put', bytes, { headers: { 'x-key': key } })".into()),
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
        let tmp = path.with_extension(format!("{ext}.tmp"));
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(true)
}

#[tauri::command]
pub async fn cache_get(pre: tauri::State<'_, Preloaded>, key: String) -> Result<Response, String> {
    let hit = pre.0.lock().unwrap().remove(&key);
    get(key, "bin", hit).await
}

#[tauri::command]
pub async fn cache_put(request: Request<'_>) -> Result<bool, String> {
    put(&request, "bin").await
}

#[tauri::command]
pub async fn thumb_get(key: String) -> Result<Response, String> {
    get(key, "png", None).await
}

#[tauri::command]
pub async fn thumb_put(request: Request<'_>) -> Result<bool, String> {
    put(&request, "png").await
}

#[tauri::command]
pub async fn cache_clear(pre: tauri::State<'_, Preloaded>) -> Result<bool, String> {
    pre.0.lock().unwrap().clear();
    tauri::async_runtime::spawn_blocking(|| {
        if let Ok(rd) = std::fs::read_dir(dir()) {
            for e in rd.flatten() {
                let p = e.path();
                if matches!(p.extension().and_then(|x| x.to_str()), Some("bin" | "png" | "tmp")) {
                    let _ = std::fs::remove_file(p);
                }
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(true)
}

#[derive(Serialize)]
pub struct Stats {
    files: u64,
    bytes: u64,
}

#[tauri::command]
pub async fn cache_stats() -> Result<Stats, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut s = Stats { files: 0, bytes: 0 };
        if let Ok(rd) = std::fs::read_dir(dir()) {
            for e in rd.flatten() {
                if let Ok(m) = e.metadata() {
                    if m.is_file() {
                        s.files += 1;
                        s.bytes += m.len();
                    }
                }
            }
        }
        s
    })
    .await
    .map_err(|e| e.to_string())
}

/// Startup: read the active outfit's cached meshes into memory (runs on a worker thread while the
/// splash is up). Missing manifest/config is fine (first run).
pub fn preload(pre: &Preloaded) -> usize {
    let outfit = crate::config::load()
        .and_then(|c| c.get("activeOutfit").and_then(|v| v.as_str()).map(str::to_string))
        .unwrap_or_else(|| "base".into());
    let Some(manifest) = std::fs::read_to_string(dir().join("manifest.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
    else {
        return 0;
    };
    let keys: Vec<String> = manifest
        .get(&outfit)
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|k| k.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    let mut n = 0;
    for k in keys.into_iter().filter(|k| valid_key(k)) {
        if let Ok(b) = std::fs::read(dir().join(format!("{k}.bin"))) {
            pre.0.lock().unwrap().insert(k, b);
            n += 1;
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::valid_key;
    #[test]
    fn keys() {
        assert!(valid_key("mesh_crown_v3"));
        assert!(valid_key("thumb_top-hat_2"));
        assert!(!valid_key(""));
        assert!(!valid_key("../x"));
        assert!(!valid_key("A"));
        assert!(!valid_key(&"a".repeat(97)));
    }
}
