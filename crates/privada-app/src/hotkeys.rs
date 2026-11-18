//! Global hotkeys (work while the app is in the background): accelerator -> { action, arg }
//! emitted as the `hotkey` event to every window. Some actions are handled natively too.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Binding {
    pub action: String,
    #[serde(default)]
    pub arg: Option<serde_json::Value>,
}

#[derive(Default)]
pub struct Hotkeys {
    /// shortcut id -> binding
    pub map: Mutex<HashMap<u32, Binding>>,
}

#[derive(Serialize)]
pub struct SetResult {
    pub ok: Vec<String>,
    pub failed: Vec<String>,
}

pub fn set(app: &AppHandle, bindings: HashMap<String, Binding>) -> SetResult {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let state = app.state::<Hotkeys>();
    let mut map = state.map.lock().unwrap();
    map.clear();
    let mut res = SetResult { ok: vec![], failed: vec![] };
    for (accel, b) in bindings {
        match accel.parse::<Shortcut>() {
            Ok(sc) => match gs.register(sc) {
                Ok(()) => {
                    map.insert(sc.id(), b);
                    res.ok.push(accel);
                }
                Err(e) => {
                    log::warn!("hotkey {accel}: {e}");
                    res.failed.push(accel);
                }
            },
            Err(e) => {
                log::warn!("hotkey {accel}: {e}");
                res.failed.push(accel);
            }
        }
    }
    res
}

/// Global-shortcut plugin handler.
pub fn on_shortcut(app: &AppHandle, sc: &Shortcut, ev: ShortcutEvent) {
    if ev.state() != ShortcutState::Pressed {
        return;
    }
    let b = app.state::<Hotkeys>().map.lock().unwrap().get(&sc.id()).cloned();
    if let Some(b) = b {
        crate::native_action(app, &b.action, b.arg.as_ref());
        let _ = app.emit("hotkey", b);
    }
}
