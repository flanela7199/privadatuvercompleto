//! The character window must NEVER really minimize: Windows stops rendering minimized windows,
//! so OBS ("Windows 10 (1903+)" window capture) would show nothing.
//!
//! A Win32 window subclass turns every minimize into "send to the back":
//!   * WM_SYSCOMMAND/SC_MINIMIZE (taskbar click on the active window, Alt+Space > Minimize, Win+Down)
//!     is swallowed and the window goes to the bottom of the z-order instead;
//!   * if it gets minimized anyway (ShowWindow(SW_MINIMIZE): Win+M, Win+D "show desktop", tools),
//!     WM_SIZE/SIZE_MINIMIZED posts a private message that restores it WITHOUT activating it and
//!     puts it at the bottom.
//! `send_to_back` (tray "Mandar para trás", panel button) does the same on demand.
use tauri::WebviewWindow;

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        PostMessageW, SetWindowPos, ShowWindow, HWND_BOTTOM, SC_MINIMIZE, SIZE_MINIMIZED, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SW_SHOWNOACTIVATE, WM_APP, WM_SIZE, WM_SYSCOMMAND,
    };

    const SUBCLASS_ID: usize = 0x5052_5644; // "PRVD"
    const WM_PRIVADA_UNMINIMIZE: u32 = WM_APP + 0x51;

    pub fn send_back(hwnd: HWND) {
        // SAFETY: plain Win32 call on a window handle owned by this process.
        unsafe {
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
        }
    }

    unsafe extern "system" fn subclass_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        match msg {
            WM_SYSCOMMAND if (wparam & 0xFFF0) == SC_MINIMIZE as usize => {
                send_back(hwnd);
                0 // swallowed: never minimize
            }
            WM_SIZE if wparam == SIZE_MINIMIZED as usize => {
                let r = DefSubclassProc(hwnd, msg, wparam, lparam);
                PostMessageW(hwnd, WM_PRIVADA_UNMINIMIZE, 0, 0);
                r
            }
            WM_PRIVADA_UNMINIMIZE => {
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                send_back(hwnd);
                0
            }
            _ => DefSubclassProc(hwnd, msg, wparam, lparam),
        }
    }

    pub fn install(hwnd: HWND) -> bool {
        // SAFETY: the subclass proc only calls Win32 on its own window; comctl32 v6 is in the manifest.
        unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0) != 0 }
    }
}

/// Install the never-minimize subclass on the character window.
pub fn install(w: &WebviewWindow) {
    #[cfg(windows)]
    match w.hwnd() {
        Ok(h) => {
            if !imp::install(h.0 as _) {
                log::warn!("nominimize: SetWindowSubclass failed");
            }
        }
        Err(e) => log::warn!("nominimize: no hwnd: {e}"),
    }
    #[cfg(not(windows))]
    let _ = w;
}

/// Push the window to the bottom of the z-order (out of the way, still rendering for OBS).
pub fn send_to_back(w: &WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        let h = w.hwnd().map_err(|e| e.to_string())?;
        imp::send_back(h.0 as _);
    }
    #[cfg(not(windows))]
    let _ = w;
    Ok(())
}
