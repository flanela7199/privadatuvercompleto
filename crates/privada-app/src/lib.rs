//! Privada Tuber desktop app (Tauri v2). See docs/app-contract.md.
//!
//! Windows:
//!   `avatar`  desktop overlay: transparent, borderless, covers the monitor, click-through except
//!             over the character, skip taskbar; optional always-on-top (per scene)
//!   `output`  OBS window: borderless, resizable, in the taskbar ("Captura de janela")
//!   `control` control panel
//! Everything native keeps running while the app is unfocused / behind other windows.

pub mod config;
pub mod cursor;
pub mod hotkeys;
pub mod mic;
pub mod webview2;

pub use privada_core::dsp;

use cursor::{ClickMode, Pointer, Rect};
use hotkeys::{Binding, Hotkeys, SetResult};
use mic::{AudioCfg, Mic};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Same args for every webview (WebView2 requires identical args per environment):
/// Tauri's defaults + never throttle when hidden/occluded (the avatar lives behind games / in OBS).
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
--autoplay-policy=no-user-gesture-required";

#[derive(Default)]
struct WinState {
    mode: Mutex<String>, // "overlay" | "window"
    overlay_visible: Mutex<bool>,
}

fn builder<'a>(app: &'a AppHandle, label: &'a str, url: &str) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .additional_browser_args(BROWSER_ARGS)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
}

fn primary_monitor_rect(app: &AppHandle) -> (PhysicalPosition<i32>, PhysicalSize<u32>, f64) {
    match app.primary_monitor().ok().flatten() {
        Some(m) => (*m.position(), *m.size(), m.scale_factor()),
        None => (PhysicalPosition::new(0, 0), PhysicalSize::new(1920, 1080), 1.0),
    }
}

fn create_avatar(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let (pos, size, _) = primary_monitor_rect(app);
    let w = builder(app, "avatar", "avatar.html")
        .title("Privada Tuber")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(false)
        .focused(false)
        .visible(false)
        .build()?;
    w.set_position(pos)?;
    w.set_size(size)?;
    w.show()?;
    *app.state::<WinState>().mode.lock().unwrap() = "overlay".into();
    *app.state::<WinState>().overlay_visible.lock().unwrap() = true;
    Ok(w)
}

fn open_control_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("control") {
        w.show()?;
        w.unminimize()?;
        w.set_focus()?;
        return Ok(());
    }
    builder(app, "control", "control.html")
        .title("Privada Tuber — Painel")
        .inner_size(1100.0, 760.0)
        .min_inner_size(720.0, 480.0)
        .build()?;
    Ok(())
}

/// Actions that Rust handles itself (they are also broadcast to the pages).
pub fn native_action(app: &AppHandle, action: &str, arg: Option<&Value>) {
    let arg = arg.and_then(|v| v.as_str().map(str::to_string).or_else(|| Some(v.to_string())));
    match (action, arg.as_deref()) {
        ("toggle", Some("clickthrough")) => {
            let ptr = app.state::<Pointer>();
            let mut m = ptr.mode.lock().unwrap();
            *m = if *m == ClickMode::On { ClickMode::Auto } else { ClickMode::On };
            let _ = app.emit("click-mode", *m);
        }
        ("toggle", Some("mic")) => {
            let mic = app.state::<Mic>();
            let on = !mic.cfg.lock().unwrap().enabled;
            mic.set_enabled(on);
            let _ = app.emit("mic-enabled", on);
        }
        ("open", Some("control")) => {
            let _ = open_control_window(app);
        }
        _ => {}
    }
}

/* ------------------------------------------------------------- commands */

#[tauri::command]
fn load_config() -> Option<Value> {
    config::load()
}

#[tauri::command]
fn save_config(config: Value) -> Result<bool, String> {
    config::save(&config).map(|_| true)
}

#[tauri::command]
fn set_hotkeys(app: AppHandle, bindings: HashMap<String, Binding>) -> SetResult {
    hotkeys::set(&app, bindings)
}

#[tauri::command]
fn audio_devices() -> Vec<String> {
    mic::device_names()
}

#[tauri::command]
fn set_audio(app: AppHandle, audio: AudioCfg) -> bool {
    app.state::<Mic>().configure(audio);
    true
}

#[tauri::command]
fn set_hit_rect(app: AppHandle, rect: Option<Rect>) -> bool {
    *app.state::<Pointer>().hit_rect.lock().unwrap() = rect;
    true
}

#[tauri::command]
fn set_click_through(app: AppHandle, mode: ClickMode) -> bool {
    *app.state::<Pointer>().mode.lock().unwrap() = mode;
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AvatarMode {
    mode: String,
    width: Option<f64>,
    height: Option<f64>,
    always_on_top: Option<bool>,
}

#[tauri::command]
fn set_avatar_mode(app: AppHandle, mode: String, width: Option<f64>, height: Option<f64>, always_on_top: Option<bool>) -> Result<bool, String> {
    apply_avatar_mode(&app, AvatarMode { mode, width, height, always_on_top }).map_err(|e| e.to_string())?;
    Ok(true)
}

fn apply_avatar_mode(app: &AppHandle, m: AvatarMode) -> tauri::Result<()> {
    let w = match app.get_webview_window("avatar") {
        Some(w) => w,
        None => create_avatar(app)?,
    };
    if m.mode == "window" {
        let ptr = app.state::<Pointer>();
        *ptr.mode.lock().unwrap() = ClickMode::Off;
        w.set_ignore_cursor_events(false)?;
        w.set_skip_taskbar(false)?;
        w.set_size(tauri::LogicalSize::new(m.width.unwrap_or(1280.0), m.height.unwrap_or(720.0)))?;
        w.set_resizable(true)?;
        w.center()?;
    } else {
        let (pos, size, _) = primary_monitor_rect(app);
        w.set_resizable(false)?;
        w.set_skip_taskbar(true)?;
        w.set_position(pos)?;
        w.set_size(size)?;
        let ptr = app.state::<Pointer>();
        let mut cm = ptr.mode.lock().unwrap();
        if *cm == ClickMode::Off {
            *cm = ClickMode::Auto;
        }
    }
    w.set_always_on_top(m.always_on_top.unwrap_or(false))?;
    *app.state::<WinState>().mode.lock().unwrap() = m.mode;
    Ok(())
}

#[derive(Serialize)]
struct MonitorInfo {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
}

#[tauri::command]
fn get_monitor(app: AppHandle) -> MonitorInfo {
    let mon = app
        .get_webview_window("avatar")
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    match mon {
        Some(m) => MonitorInfo { x: m.position().x, y: m.position().y, width: m.size().width, height: m.size().height, scale: m.scale_factor() },
        None => MonitorInfo { x: 0, y: 0, width: 1920, height: 1080, scale: 1.0 },
    }
}

#[tauri::command]
fn open_control(app: AppHandle) -> Result<bool, String> {
    open_control_window(&app).map_err(|e| e.to_string())?;
    Ok(true)
}

/// OBS window: label `output`, avatar.html?output=1 (the page picks chroma/solid/transparent background).
#[tauri::command]
fn open_output(app: AppHandle, width: Option<f64>, height: Option<f64>, background: Option<String>) -> Result<bool, String> {
    if let Some(w) = app.get_webview_window("output") {
        w.show().map_err(|e| e.to_string())?;
        if let (Some(wd), Some(ht)) = (width, height) {
            w.set_size(tauri::LogicalSize::new(wd, ht)).map_err(|e| e.to_string())?;
        }
        let _ = app.emit_to("output", "output-background", background);
        return Ok(true);
    }
    let bg = background.unwrap_or_else(|| "chroma".into());
    let url = format!("avatar.html?output=1&bg={}", urlencode(&bg));
    builder(&app, "output", &url)
        .title("Privada Tuber — OBS")
        .inner_size(width.unwrap_or(1280.0), height.unwrap_or(720.0))
        .transparent(true)
        .decorations(false)
        .resizable(true)
        .skip_taskbar(false)
        .always_on_top(false)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(true)
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[tauri::command]
fn close_output(app: AppHandle) -> bool {
    if let Some(w) = app.get_webview_window("output") {
        let _ = w.destroy();
    }
    true
}

#[tauri::command]
fn set_overlay_visible(app: AppHandle, visible: bool) -> Result<bool, String> {
    let w = match app.get_webview_window("avatar") {
        Some(w) => w,
        None if visible => create_avatar(&app).map_err(|e| e.to_string())?,
        None => return Ok(true),
    };
    if visible { w.show() } else { w.hide() }.map_err(|e| e.to_string())?;
    *app.state::<WinState>().overlay_visible.lock().unwrap() = visible;
    Ok(true)
}

#[derive(Serialize)]
struct AvatarWin {
    mode: String,
    visible: bool,
}
#[derive(Serialize)]
struct OutputWin {
    open: bool,
}
#[derive(Serialize)]
struct WindowsInfo {
    avatar: AvatarWin,
    output: OutputWin,
}

#[tauri::command]
fn get_windows(app: AppHandle) -> WindowsInfo {
    let ws = app.state::<WinState>();
    let visible = app.get_webview_window("avatar").and_then(|w| w.is_visible().ok()).unwrap_or(false);
    WindowsInfo {
        avatar: AvatarWin { mode: ws.mode.lock().unwrap().clone(), visible },
        output: OutputWin { open: app.get_webview_window("output").is_some() },
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/* ----------------------------------------------------------------- tray */

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir painel", true, None::<&str>)?;
    let obs = MenuItem::with_id(app, "obs", "Janela do OBS", true, None::<&str>)?;
    let click = CheckMenuItem::with_id(app, "click", "Clicar através (sempre)", true, false, None::<&str>)?;
    let micm = CheckMenuItem::with_id(app, "mic", "Microfone", true, true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &obs, &click, &micm, &sep, &quit])?;
    let mut tb = TrayIconBuilder::with_id("privada")
        .tooltip("Privada Tuber")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, ev| match ev.id().as_ref() {
            "open" => {
                let _ = open_control_window(app);
            }
            "obs" => {
                let _ = open_output(app.clone(), None, None, None);
            }
            "click" => native_action(app, "toggle", Some(&Value::String("clickthrough".into()))),
            "mic" => native_action(app, "toggle", Some(&Value::String("mic".into()))),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = ev {
                let _ = open_control_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tb = tb.icon(icon.clone());
    }
    tb.build(app)?;
    Ok(())
}

/* ------------------------------------------------------------------ run */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = open_control_window(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, sc, ev| hotkeys::on_shortcut(app, sc, ev))
                .build(),
        )
        .manage(Pointer::default())
        .manage(Hotkeys::default())
        .manage(WinState::default())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            set_hotkeys,
            audio_devices,
            set_audio,
            set_hit_rect,
            set_click_through,
            set_avatar_mode,
            get_monitor,
            open_control,
            open_output,
            close_output,
            set_overlay_visible,
            get_windows,
            quit
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(Mic::start(handle.clone()));
            cursor::start(handle.clone());
            build_tray(&handle)?;
            create_avatar(&handle)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Privada Tuber");
}
