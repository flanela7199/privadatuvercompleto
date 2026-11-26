//! Global cursor polling (60 Hz, works while unfocused/occluded) in VIRTUAL-DESKTOP physical px,
//! sent together with the avatar window's rectangle so the page can aim across monitors:
//!   `cursor` { x, y, win: { x, y, w, h, scale, ix, iy, iw, ih } | null }
//!   (x,y,w,h = outer rect, ix,iy,iw,ih = client area; all physical px)
//! Also: click-through for the optional desktop overlay (`auto`: ignore the mouse except over the
//! character's hit rect), and debounced saving of the avatar window rect.
use crate::winstate::WinState;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

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
pub struct WinRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub scale: f64,
    pub ix: i32,
    pub iy: i32,
    pub iw: u32,
    pub ih: u32,
}

#[derive(Serialize, Clone, Copy, PartialEq)]
struct CursorEvent {
    x: i32,
    y: i32,
    win: Option<WinRect>,
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

pub fn win_rect(w: &WebviewWindow) -> Option<WinRect> {
    let op = w.outer_position().ok()?;
    let os = w.outer_size().ok()?;
    let ip = w.inner_position().ok()?;
    let is = w.inner_size().ok()?;
    Some(WinRect { x: op.x, y: op.y, w: os.width, h: os.height, scale: w.scale_factor().ok()?, ix: ip.x, iy: ip.y, iw: is.width, ih: is.height })
}

pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("privada-cursor".into())
        .spawn(move || {
            let mut last: Option<CursorEvent> = None;
            let mut ignoring: Option<bool> = None;
            let mut since_emit = 0u32;
            // the character window handle is looked up ONCE and reused: get_webview_window() clones a
            // struct of ~15 Arcs out of the webview manager; doing it 60x/s from this thread was where
            // the live crashes (0xC000001D, Arc refcount abort inside the clone) happened.
            let mut avatar: Option<WebviewWindow> = None;
            loop {
                if let Some((x, y)) = cursor_pos() {
                    if avatar.is_none() {
                        avatar = app.get_webview_window("avatar");
                    }
                    let win = avatar.as_ref().and_then(win_rect);
                    if avatar.is_some() && win.is_none() {
                        avatar = None; // window gone/recreated: look it up again next tick
                    }
                    let ev = CursorEvent { x, y, win };
                    since_emit += 1;
                    // emit on any change (cursor or window moved), and ~2x/s for late listeners
                    if last != Some(ev) || since_emit >= 30 {
                        // só a janela do personagem usa o cursor: não acorda o painel 60x/s
                        let _ = app.emit_to("avatar", "cursor", ev);
                        last = Some(ev);
                        since_emit = 0;
                    }
                    if let (Some(w), Some(r)) = (avatar.as_ref(), win) {
                        update_click_through(&app, w, x, y, r, &mut ignoring);
                    }
                }
                app.state::<WinState>().flush_if_due();
                std::thread::sleep(Duration::from_millis(16));
            }
        })
        .expect("cursor thread");
}

fn update_click_through(app: &AppHandle, win: &WebviewWindow, x: i32, y: i32, r: WinRect, ignoring: &mut Option<bool>) {
    let want = if app.state::<WinState>().is_window_mode() {
        false // a normal window always takes the mouse
    } else {
        let ptr = app.state::<Pointer>();
        let mode = *ptr.mode.lock().unwrap();
        match mode {
            ClickMode::On => true,
            ClickMode::Off => false,
            ClickMode::Auto => match *ptr.hit_rect.lock().unwrap() {
                // hit rect is logical px inside the client area
                Some(h) => {
                    let lx = (x - r.ix) as f64 / r.scale;
                    let ly = (y - r.iy) as f64 / r.scale;
                    !(lx >= h.x && lx <= h.x + h.w && ly >= h.y && ly <= h.y + h.h)
                }
                None => true, // no character on screen yet: let clicks through
            },
        }
    };
    if *ignoring != Some(want) && win.set_ignore_cursor_events(want).is_ok() {
        *ignoring = Some(want);
        let _ = app.emit("click-through", want);
    }
}
