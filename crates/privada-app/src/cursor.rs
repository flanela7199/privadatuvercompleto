//! Global cursor polling (60 Hz, works while unfocused/occluded) + click-through for the
//! desktop overlay: in `auto` mode the overlay ignores the mouse except over the character's
//! hit rectangle (reported by the page), toggled only when the state changes.
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ClickMode {
    #[default]
    Auto,
    On,
    Off,
}

#[derive(Default)]
pub struct Pointer {
    pub hit_rect: Mutex<Option<Rect>>,
    pub mode: Mutex<ClickMode>,
}

#[derive(Serialize, Clone, Copy, PartialEq)]
struct CursorEvent {
    x: i32,
    y: i32,
}

#[cfg(windows)]
fn cursor_pos() -> Option<(i32, i32)> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT { x: 0, y: 0 };
    // SAFETY: GetCursorPos writes into a valid POINT.
    let ok = unsafe { GetCursorPos(&mut p) };
    (ok != 0).then_some((p.x, p.y))
}

#[cfg(not(windows))]
fn cursor_pos() -> Option<(i32, i32)> {
    None
}

pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("privada-cursor".into())
        .spawn(move || {
            let mut last: Option<CursorEvent> = None;
            let mut ignoring: Option<bool> = None;
            let mut since_emit = 0u32;
            loop {
                if let Some((x, y)) = cursor_pos() {
                    let ev = CursorEvent { x, y };
                    since_emit += 1;
                    // emit on movement, and at least ~2x/s so late listeners get a value
                    if last != Some(ev) || since_emit >= 30 {
                        let _ = app.emit("cursor", ev);
                        last = Some(ev);
                        since_emit = 0;
                    }
                    update_click_through(&app, x, y, &mut ignoring);
                }
                std::thread::sleep(Duration::from_millis(16));
            }
        })
        .expect("cursor thread");
}

fn update_click_through(app: &AppHandle, x: i32, y: i32, ignoring: &mut Option<bool>) {
    let Some(win) = app.get_webview_window("avatar") else { return };
    let ptr = app.state::<Pointer>();
    let mode = *ptr.mode.lock().unwrap();
    let want = match mode {
        ClickMode::On => true,
        ClickMode::Off => false,
        ClickMode::Auto => {
            let rect = *ptr.hit_rect.lock().unwrap();
            match (rect, win.outer_position(), win.scale_factor()) {
                (Some(r), Ok(pos), Ok(scale)) => {
                    // hit rect is logical px inside the window
                    let lx = (x - pos.x) as f64 / scale;
                    let ly = (y - pos.y) as f64 / scale;
                    !(lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h)
                }
                _ => true, // no character on screen yet: let clicks through
            }
        }
    };
    if *ignoring != Some(want) {
        if win.set_ignore_cursor_events(want).is_ok() {
            *ignoring = Some(want);
            let _ = app.emit("click-through", want);
        }
    }
}
