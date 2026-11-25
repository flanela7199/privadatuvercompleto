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
    let mut cfg: Value = serde_json::from_str(&text).ok()?;
    if migrate(&mut cfg) {
        let _ = save(&cfg);
    }
    Some(cfg)
}

/// One-time upgrades of saved configs. Runs here (not in a page) so the avatar and the panel both
/// start from the same migrated file. Returns true when something changed.
fn migrate(cfg: &mut Value) -> bool {
    let Some(obj) = cfg.as_object_mut() else { return false };
    let mut mudou = false;
    // 0.4.5: nova cena "Ilha tropical 3D" (cópia da cena da sala, com o fundo da ilha)
    if obj.get("migr045").and_then(Value::as_bool) != Some(true) {
        obj.insert("migr045".into(), Value::Bool(true));
        mudou = true;
        if let Some(scenes) = obj.get_mut("scenes").and_then(Value::as_array_mut) {
            let tem_ilha = scenes.iter().any(|s| s.get("background").and_then(Value::as_str) == Some("ilha"));
            let sala = scenes.iter().find(|s| s.get("background").and_then(Value::as_str) == Some("sala")).cloned();
            if let (false, Some(mut nova)) = (tem_ilha, sala) {
                if let Some(n) = nova.as_object_mut() {
                    n.insert("name".into(), "Ilha tropical 3D".into());
                    n.insert("background".into(), "ilha".into());
                }
                scenes.push(nova);
            }
        }
    }
    if obj.get("migr044").and_then(Value::as_bool) == Some(true) {
        return mudou;
    }
    obj.insert("migr044".into(), Value::Bool(true));
    // 0.4.4: the transparent "gameplay" scene puts the character small in the bottom-right corner of
    // a 1920x1080 window (same size as the room scene, so the transition between them is seamless).
    if let Some(scenes) = obj.get_mut("scenes").and_then(Value::as_array_mut) {
        let tem_sala = scenes.iter().any(|s| s.get("background").and_then(Value::as_str) == Some("sala"));
        for s in scenes.iter_mut() {
            let Some(s) = s.as_object_mut() else { continue };
            let bg = s.get("background").and_then(Value::as_str).unwrap_or("").to_string();
            let modo = s.get("mode").and_then(Value::as_str).unwrap_or("window").to_string();
            let nome = s.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            if bg == "sala" && s.get("winSize").and_then(Value::as_str).unwrap_or("").is_empty() {
                s.insert("winSize".into(), "1920x1080".into());
            }
            if tem_sala && bg == "transparent" && modo == "window" && nome == "Janela transparente" {
                s.insert("winSize".into(), "1920x1080".into());
                s.insert("x".into(), serde_json::json!(0.91));
                s.insert("y".into(), serde_json::json!(0.975));
                s.insert("scale".into(), serde_json::json!(1.05));
                s.insert("name".into(), "Gameplay (vaso no canto)".into());
            }
        }
    }
    true
}

pub fn save(cfg: &Value) -> Result<(), String> {
    std::fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let tmp = path().with_extension("json.tmp");
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path()).map_err(|e| e.to_string())
}
