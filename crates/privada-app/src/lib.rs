//! Privada Tuber desktop app (Tauri v2). See docs/app-contract.md.
//!
//! Windows:
//!   `avatar`  the character: by default a NORMAL window ("Privada Tuber", taskbar + alt-tab,
//!             movable/resizable, transparent-capable, size/position remembered). Optional scene
//!             mode `overlay`: fullscreen click-through desktop overlay.
//!             The character window IS the OBS source ("Captura de janela").
//!   `splash`  small loading screen shown while the pages build (closed when the avatar is ready)
//!   `control` control panel (opens on start unless settings.openPanelOnStart == false)
//! Every window is created hidden with its final background colour and shown when its page calls
//! `page_ready` (fallback 15 s), so there is no white flash.
//! Closing avatar/control only hides them; quit from the tray ("Sair").
//! Everything native keeps running while the app is unfocused / behind other windows.

pub mod cache;
pub mod config;
pub mod cursor;
pub mod hotkeys;
pub mod mic;
pub mod nominimize;
pub mod single_instance;
pub mod webview2;
pub mod winstate;

pub use privada_core::dsp;

use cursor::{ClickMode, Pointer, Rect};
use hotkeys::{Binding, Hotkeys, SetResult};
use mic::{AudioCfg, Mic};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use std::sync::Mutex;
use std::time::Duration;
use tauri::window::Color;
use winstate::{SavedRect, WinState};

/// Same args for every webview (WebView2 requires identical args per environment):
/// Tauri's defaults + never throttle when hidden/occluded (the avatar lives behind games / in OBS).
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
--autoplay-policy=no-user-gesture-required";

/// Panel / splash background (matches their CSS) so nothing flashes white before the page paints.
const DARK: Color = Color(0x10, 0x11, 0x14, 0xff);
const CLEAR: Color = Color(0, 0, 0, 0);
const READY_FALLBACK: Duration = Duration::from_secs(15);

/// Which pages reported `page_ready` (windows stay hidden until then).
#[derive(Default)]
struct Ready {
    avatar: Mutex<bool>,
    control: Mutex<bool>,
    /// the control window should take focus when it becomes ready (opened by the user)
    focus_control: Mutex<bool>,
}

/// Every window: hidden at creation, unthrottled, same browser args.
fn builder<'a>(app: &'a AppHandle, label: &'a str, url: &str) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .additional_browser_args(BROWSER_ARGS)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .visible(false)
}

/// Show `label` after READY_FALLBACK if its page never called `page_ready` (e.g. a JS error).
fn ready_fallback(app: &AppHandle, label: &'static str) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(READY_FALLBACK);
        let r = app.state::<Ready>();
        let done = match label {
            "avatar" => *r.avatar.lock().unwrap(),
            "control" => *r.control.lock().unwrap(),
            _ => true,
        };
        if !done {
            log::warn!("{label}: page_ready not received in time, showing anyway");
            mark_ready(&app, label);
        }
    });
}

/// A page finished building: show its window (and close the splash once the character is up).
fn mark_ready(app: &AppHandle, label: &str) {
    let r = app.state::<Ready>();
    match label {
        "avatar" => {
            *r.avatar.lock().unwrap() = true;
            if let Some(w) = app.get_webview_window("avatar") {
                let _ = w.show();
            }
            if let Some(s) = app.get_webview_window("splash") {
                let _ = s.destroy();
            }
        }
        "control" => {
            *r.control.lock().unwrap() = true;
            if let Some(w) = app.get_webview_window("control") {
                let _ = w.show();
                if std::mem::take(&mut *r.focus_control.lock().unwrap()) {
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
        }
        "splash" => {
            if let Some(w) = app.get_webview_window("splash") {
                let _ = w.show();
            }
        }
        _ => {}
    }
}

fn create_splash(app: &AppHandle) -> tauri::Result<()> {
    let w = builder(app, "splash", "splash.html")
        .title("Privada Tuber")
        .inner_size(380.0, 220.0)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .shadow(true)
        .focused(false)
        .center()
        .background_color(DARK)
        .build()?;
    // the splash page is tiny; show it quickly even if it never reports ready
    let w2 = w.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        let _ = w2.show();
    });
    Ok(())
}

fn primary_monitor_rect(app: &AppHandle) -> (PhysicalPosition<i32>, PhysicalSize<u32>, f64) {
    match app.primary_monitor().ok().flatten() {
        Some(m) => (*m.position(), *m.size(), m.scale_factor()),
        None => (PhysicalPosition::new(0, 0), PhysicalSize::new(1920, 1080), 1.0),
    }
}

const DEFAULT_W: f64 = 720.0;
const DEFAULT_H: f64 = 900.0;

/// true if the saved rect's top-left area is visible on some monitor
fn rect_on_screen(app: &AppHandle, r: &SavedRect) -> bool {
    app.available_monitors()
        .map(|ms| {
            ms.iter().any(|m| {
                let (p, sz) = (m.position(), m.size());
                r.x + 40 >= p.x && r.y + 10 >= p.y && r.x + 40 < p.x + sz.width as i32 && r.y + 10 < p.y + sz.height as i32
            })
        })
        .unwrap_or(false)
}

/// Put the avatar window back to its remembered (or default) normal-window rect.
fn restore_window_rect(app: &AppHandle, w: &WebviewWindow, size: Option<(f64, f64)>) -> tauri::Result<()> {
    let saved = *app.state::<WinState>().rect.lock().unwrap();
    match (size, saved) {
        (Some((wd, ht)), _) => {
            w.set_size(tauri::LogicalSize::new(wd, ht))?;
            w.center()?;
        }
        (None, Some(r)) if rect_on_screen(app, &r) => {
            w.set_size(PhysicalSize::new(r.w, r.h))?;
            w.set_position(PhysicalPosition::new(r.x, r.y))?;
        }
        _ => {
            w.set_size(tauri::LogicalSize::new(DEFAULT_W, DEFAULT_H))?;
            w.center()?;
        }
    }
    Ok(())
}

fn create_avatar(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    *app.state::<WinState>().mode.lock().unwrap() = "window".into();
    let w = builder(app, "avatar", "avatar.html")
        .title("Privada Tuber")
        .transparent(true)
        .decorations(false) // borderless: the page has a drag strip + invisible resize edges
        .shadow(false)
        .minimizable(false) // minimized windows stop rendering -> OBS goes blank (see nominimize.rs)
        .resizable(true)
        .skip_taskbar(false)
        .always_on_top(false)
        .inner_size(DEFAULT_W, DEFAULT_H)
        .min_inner_size(240.0, 300.0)
        .focused(false)
        .background_color(CLEAR)
        .build()?;
    restore_window_rect(app, &w, None)?;
    nominimize::install(&w); // minimize -> send to back instead (keeps rendering for OBS)
    ready_fallback(app, "avatar"); // shown by page_ready("avatar")
    Ok(w)
}

/// Show + unminimize + bring the character to the front (tray "Mostrar personagem").
fn show_avatar_window(app: &AppHandle) -> tauri::Result<()> {
    let w = match app.get_webview_window("avatar") {
        Some(w) => w,
        None => create_avatar(app)?,
    };
    w.show()?;
    w.unminimize()?;
    w.set_focus()?;
    Ok(())
}

/// Open the panel. `focus`: bring it to the front (user action); false at startup.
fn open_control_window_with(app: &AppHandle, focus: bool) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("control") {
        if *app.state::<Ready>().control.lock().unwrap() {
            w.show()?;
            w.unminimize()?;
            if focus {
                w.set_focus()?;
            }
        } else {
            *app.state::<Ready>().focus_control.lock().unwrap() |= focus;
        }
        return Ok(());
    }
    *app.state::<Ready>().focus_control.lock().unwrap() = focus;
    builder(app, "control", "control.html")
        .title("Privada Tuber — Painel")
        .inner_size(1100.0, 760.0)
        .min_inner_size(720.0, 480.0)
        .background_color(DARK)
        .build()?;
    ready_fallback(app, "control"); // shown by page_ready("control")
    Ok(())
}

fn open_control_window(app: &AppHandle) -> tauri::Result<()> {
    open_control_window_with(app, true)
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

/// erros do JavaScript das janelas (para o crash.log; o JS já limita a quantidade)
#[tauri::command]
fn log_js(label: String, msg: String) -> bool {
    let msg: String = msg.chars().take(2000).collect();
    crash_log(&format!("JS[{label}] {msg}"));
    true
}

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
async fn set_avatar_mode(app: AppHandle, mode: String, width: Option<f64>, height: Option<f64>, always_on_top: Option<bool>) -> Result<bool, String> {
    apply_avatar_mode(&app, AvatarMode { mode, width, height, always_on_top }).map_err(|e| e.to_string())?;
    Ok(true)
}

fn apply_avatar_mode(app: &AppHandle, m: AvatarMode) -> tauri::Result<()> {
    let w = match app.get_webview_window("avatar") {
        Some(w) => w,
        None => create_avatar(app)?,
    };
    // set the mode first so Moved/Resized while switching aren't remembered as the window rect
    let was = std::mem::replace(&mut *app.state::<WinState>().mode.lock().unwrap(), m.mode.clone());
    if m.mode == "overlay" {
        let (pos, size, _) = primary_monitor_rect(app);
        w.set_decorations(false)?;
        w.set_shadow(false)?;
        w.set_resizable(false)?;
        w.set_skip_taskbar(true)?;
        w.set_position(pos)?;
        w.set_size(size)?;
        let ptr = app.state::<Pointer>();
        let mut cm = ptr.mode.lock().unwrap();
        if *cm == ClickMode::Off {
            *cm = ClickMode::Auto;
        }
    } else {
        // só chama o que mudou: cada set_* força o Windows a recompor a janela (travadinha na troca de cena)
        if was != "window" {
            w.set_ignore_cursor_events(false)?;
            w.set_decorations(false)?;
            w.set_shadow(false)?;
            w.set_skip_taskbar(false)?;
        }
        if !w.is_resizable().unwrap_or(false) {
            w.set_resizable(true)?;
        }
        let size = m.width.zip(m.height);
        if was != "window" || size.is_some() {
            restore_window_rect(app, &w, size)?;
        }
    }
    let aot = m.always_on_top.unwrap_or(false);
    if w.is_always_on_top().unwrap_or(!aot) != aot {
        w.set_always_on_top(aot)?;
    }
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
async fn get_monitor(app: AppHandle) -> MonitorInfo {
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
async fn open_control(app: AppHandle) -> Result<bool, String> {
    open_control_window(&app).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Send the character window to the bottom of the z-order: out of the way, still rendering for OBS.
#[tauri::command]
async fn send_to_back(app: AppHandle) -> Result<bool, String> {
    let w = app.get_webview_window("avatar").ok_or("no avatar window")?;
    nominimize::send_to_back(&w)?;
    Ok(true)
}

/// Resize the borderless character window from an edge/corner hit zone of the page.
/// direction: n s e w ne nw se sw (or north/south/east/west/northEast/... names)
#[tauri::command]
async fn start_resize(app: AppHandle, direction: String) -> Result<bool, String> {
    use tauri_runtime::ResizeDirection as D;
    let d = match direction.to_ascii_lowercase().replace(['-', '_'], "").as_str() {
        "n" | "north" | "top" => D::North,
        "s" | "south" | "bottom" => D::South,
        "e" | "east" | "right" => D::East,
        "w" | "west" | "left" => D::West,
        "ne" | "northeast" | "topright" => D::NorthEast,
        "nw" | "northwest" | "topleft" => D::NorthWest,
        "se" | "southeast" | "bottomright" => D::SouthEast,
        "sw" | "southwest" | "bottomleft" => D::SouthWest,
        other => return Err(format!("unknown resize direction {other:?}")),
    };
    let w = app.get_webview_window("avatar").ok_or("no avatar window")?.as_ref().window();
    w.start_resize_dragging(d).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Window/webview background behind the page: "transparent" or "#rrggbb" / "#rrggbbaa"
/// (set it to the scene background so nothing white can ever show around the canvas).
#[tauri::command]
async fn set_window_background(app: AppHandle, color: String, label: Option<String>) -> Result<bool, String> {
    let c = parse_color(&color).ok_or_else(|| format!("bad color {color:?}"))?;
    let w = app.get_webview_window(label.as_deref().unwrap_or("avatar")).ok_or("no such window")?;
    w.set_background_color(Some(c)).map_err(|e| e.to_string())?;
    Ok(true)
}

fn parse_color(s: &str) -> Option<Color> {
    let s = s.trim();
    if s.eq_ignore_ascii_case("transparent") {
        return Some(CLEAR);
    }
    let h = s.strip_prefix('#')?;
    let byte = |i: usize| u8::from_str_radix(h.get(i..i + 2)?, 16).ok();
    match h.len() {
        6 => Some(Color(byte(0)?, byte(2)?, byte(4)?, 0xff)),
        8 => Some(Color(byte(0)?, byte(2)?, byte(4)?, byte(6)?)),
        _ => None,
    }
}

/// A page finished building (avatar / control / splash): its window is shown now.
#[tauri::command]
async fn page_ready(app: AppHandle, label: String) -> bool {
    mark_ready(&app, &label);
    true
}

/// Compatibility: the character window itself is the OBS source, so this just shows it.
#[tauri::command]
async fn open_output(app: AppHandle) -> Result<bool, String> {
    show_avatar_window(&app).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Compatibility no-op (there is no separate OBS window anymore).
#[tauri::command]
async fn close_output() -> bool {
    true
}

/// Compatibility no-op (the character window is shown/hidden with show_avatar / closing it).
#[tauri::command]
async fn set_overlay_visible() -> bool {
    true
}

#[derive(Serialize)]
struct AvatarWin {
    mode: String,
    visible: bool,
}
#[derive(Serialize)]
struct WindowsInfo {
    avatar: AvatarWin,
}

#[tauri::command]
async fn get_windows(app: AppHandle) -> WindowsInfo {
    let mode = app.state::<WinState>().mode.lock().unwrap().clone();
    let visible = app.get_webview_window("avatar").and_then(|w| w.is_visible().ok()).unwrap_or(false);
    WindowsInfo {
        avatar: AvatarWin { mode, visible },
    }
}

#[tauri::command]
async fn show_avatar(app: AppHandle) -> Result<bool, String> {
    show_avatar_window(&app).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Open privada-data (config.json, window.json) in Explorer.
#[tauri::command]
async fn open_data_dir() -> Result<bool, String> {
    let dir = config::data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn quit(app: AppHandle) {
    app.exit(0);
}

/* ----------------------------------------------------------------- tray */

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Mostrar personagem", true, None::<&str>)?;
    let back = MenuItem::with_id(app, "back", "Mandar para trás (continua no OBS)", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Abrir painel", true, None::<&str>)?;
    let click = CheckMenuItem::with_id(app, "click", "Clicar através (sempre)", true, false, None::<&str>)?;
    let micm = CheckMenuItem::with_id(app, "mic", "Microfone", true, true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &back, &open, &click, &micm, &sep, &quit])?;
    let mut tb = TrayIconBuilder::with_id("privada")
        .tooltip("Privada Tuber")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, ev| match ev.id().as_ref() {
            "show" => {
                let _ = show_avatar_window(app);
            }
            "back" => {
                if let Some(w) = app.get_webview_window("avatar") {
                    let _ = nominimize::send_to_back(&w);
                }
            }
            "open" => {
                let _ = open_control_window(app);
            }
            "click" => native_action(app, "toggle", Some(&Value::String("clickthrough".into()))),
            "mic" => native_action(app, "toggle", Some(&Value::String("mic".into()))),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = ev {
                let app = tray.app_handle();
                let _ = show_avatar_window(app);
                let _ = open_control_window(app);
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
/// Append a line to `<exe dir>/privada-data/crash.log` (panics and fatal errors, for diagnosing lives).
pub fn crash_log(msg: &str) {
    use std::io::Write;
    let dir = config::data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("crash.log");
    if std::fs::metadata(&path).map(|m| m.len() > 512 * 1024).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("crash.old.log"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "[{t}] v{} {msg}", env!("CARGO_PKG_VERSION"));
    }
}

pub fn run() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let th = std::thread::current();
        crash_log(&format!("PANIC thread '{}': {info}\n{}", th.name().unwrap_or("?"), std::backtrace::Backtrace::force_capture()));
        prev(info);
    }));
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, sc, ev| hotkeys::on_shortcut(app, sc, ev))
                .build(),
        )
        .manage(Pointer::default())
        .manage(Hotkeys::default())
        .manage(WinState::default())
        .manage(Ready::default())
        .manage(cache::Preloaded::default())
        .invoke_handler(tauri::generate_handler![
            log_js,
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
            show_avatar,
            page_ready,
            start_resize,
            send_to_back,
            set_window_background,
            cache::cache_get,
            cache::cache_put,
            cache::thumb_get,
            cache::thumb_put,
            cache::cache_clear,
            cache::cache_stats,
            open_data_dir,
            quit
        ])
        .on_window_event(|window, event| match event {
            // closing the character or the panel only hides it; quit from the tray
            WindowEvent::CloseRequested { api, .. } if matches!(window.label(), "avatar" | "control") => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Moved(_) | WindowEvent::Resized(_) if window.label() == "avatar" => {
                let ws = window.state::<WinState>();
                if ws.is_window_mode() && !window.is_minimized().unwrap_or(false) {
                    if let (Ok(p), Ok(s)) = (window.outer_position(), window.inner_size()) {
                        if s.width > 0 && s.height > 0 {
                            ws.record(SavedRect { x: p.x, y: p.y, w: s.width, h: s.height });
                        }
                    }
                }
            }
            _ => {}
        })
        .setup(|app| {
            let handle = app.handle().clone();
            // another launch was attempted (see main.rs): bring the character and the panel up
            {
                let h = handle.clone();
                single_instance::listen(move || {
                    let h2 = h.clone();
                    let _ = h.run_on_main_thread(move || {
                        let _ = show_avatar_window(&h2);
                        let _ = open_control_window(&h2);
                    });
                });
            }
            app.manage(Mic::start(handle.clone()));
            cursor::start(handle.clone());
            // warm the active outfit's mesh cache while the splash is up
            {
                let h = handle.clone();
                std::thread::spawn(move || {
                    let n = cache::preload(&h.state::<cache::Preloaded>());
                    log::info!("preloaded {n} cached meshes");
                });
            }
            build_tray(&handle)?;
            create_splash(&handle)?;
            create_avatar(&handle)?;
            let open_panel = config::load()
                .and_then(|c| c.pointer("/settings/openPanelOnStart").and_then(Value::as_bool))
                .unwrap_or(true);
            if open_panel {
                open_control_window_with(&handle, false)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Privada Tuber");
}
