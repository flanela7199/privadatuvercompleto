//! Avatar window state: current mode and the remembered window rectangle (window mode),
//! persisted to `<exe dir>/privada-data/window.json` (separate from the pages' config.json so
//! the two never overwrite each other).
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Instant;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct SavedRect {
    /// outer position, physical px (virtual desktop)
    pub x: i32,
    pub y: i32,
    /// inner (client) size, physical px
    pub w: u32,
    pub h: u32,
}

pub struct WinState {
    /// "window" (default, normal app window) | "overlay" (fullscreen click-through desktop overlay)
    pub mode: Mutex<String>,
    pub rect: Mutex<Option<SavedRect>>,
    pub dirty_since: Mutex<Option<Instant>>,
}

impl Default for WinState {
    fn default() -> Self {
        Self { mode: Mutex::new("window".into()), rect: Mutex::new(load()), dirty_since: Mutex::new(None) }
    }
}

impl WinState {
    pub fn is_window_mode(&self) -> bool {
        *self.mode.lock().unwrap() == "window"
    }
    pub fn record(&self, r: SavedRect) {
        let mut cur = self.rect.lock().unwrap();
        if *cur != Some(r) {
            *cur = Some(r);
            *self.dirty_since.lock().unwrap() = Some(Instant::now());
        }
    }
    /// Save if the rect changed and has been stable for 0.5 s (called from the 60 Hz thread).
    pub fn flush_if_due(&self) {
        let mut d = self.dirty_since.lock().unwrap();
        if let Some(t) = *d {
            if t.elapsed().as_millis() >= 500 {
                *d = None;
                if let Some(r) = *self.rect.lock().unwrap() {
                    save(&r);
                }
            }
        }
    }
}

fn path() -> std::path::PathBuf {
    crate::config::data_dir().join("window.json")
}

pub fn load() -> Option<SavedRect> {
    serde_json::from_str(&std::fs::read_to_string(path()).ok()?).ok()
}

fn save(r: &SavedRect) {
    if std::fs::create_dir_all(crate::config::data_dir()).is_ok() {
        if let Ok(t) = serde_json::to_string(r) {
            let _ = std::fs::write(path(), t);
        }
    }
}
