//! Config persistence: `<exe dir>/privada-data/config.json` (portable, stays on the same drive as the exe).
use serde_json::Value;
use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("privada-data")
}

pub fn path() -> PathBuf {
    data_dir().join("config.json")
}

/// `None` when there is no config yet (pages then use DEFAULT_CONFIG).
pub fn load() -> Option<Value> {
    let text = std::fs::read_to_string(path()).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save(cfg: &Value) -> Result<(), String> {
    std::fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let tmp = path().with_extension("json.tmp");
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path()).map_err(|e| e.to_string())
}
