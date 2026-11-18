//! Native single-instance guard (runs at the very start of main(), before WebView2 / Tauri / windows).
//!
//! The first process creates the named mutex `Local\PrivadaTuber-com.flanela.privadatuber` and an
//! auto-reset event `Local\PrivadaTuber-activate`, and keeps both handles for its whole lifetime.
//! Any later process sees ERROR_ALREADY_EXISTS on the mutex, sets the event (the running instance then
//! shows the character + panel) and exits immediately: no window, no webview. Spam-launching is safe.

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::{CreateEventW, CreateMutexW, OpenEventW, SetEvent, WaitForSingleObject, EVENT_MODIFY_STATE, INFINITE};

    const MUTEX_NAME: &str = "Local\\PrivadaTuber-com.flanela.privadatuber";
    const EVENT_NAME: &str = "Local\\PrivadaTuber-activate";

    /// handles kept alive (never closed) for the process lifetime
    static MUTEX: AtomicIsize = AtomicIsize::new(0);
    static EVENT: AtomicIsize = AtomicIsize::new(0);

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// true = this is the primary instance (continue starting); false = another one is running.
    pub fn acquire_or_signal() -> bool {
        let mname = wide(MUTEX_NAME);
        let ename = wide(EVENT_NAME);
        // SAFETY: plain Win32 calls with valid NUL-terminated names; handles are leaked on purpose.
        unsafe {
            let m = CreateMutexW(std::ptr::null(), 0, mname.as_ptr());
            let err = GetLastError(); // capture immediately
            if m.is_null() {
                return true; // cannot guard (very unusual): just start
            }
            if err == ERROR_ALREADY_EXISTS {
                let ev = OpenEventW(EVENT_MODIFY_STATE, 0, ename.as_ptr());
                if !ev.is_null() {
                    SetEvent(ev);
                }
                return false;
            }
            MUTEX.store(m as isize, Ordering::SeqCst);
            let ev = CreateEventW(std::ptr::null(), 0, 0, ename.as_ptr()); // auto-reset, non-signaled
            EVENT.store(ev as isize, Ordering::SeqCst);
        }
        true
    }

    /// Primary instance: call `on_activate` every time another launch is attempted.
    pub fn listen(on_activate: impl Fn() + Send + 'static) {
        let ev = EVENT.load(Ordering::SeqCst);
        if ev == 0 {
            return;
        }
        std::thread::Builder::new()
            .name("privada-single-instance".into())
            .spawn(move || loop {
                // SAFETY: waiting on our own event handle, which is never closed.
                let r = unsafe { WaitForSingleObject(ev as _, INFINITE) };
                if r != 0 {
                    break; // WAIT_OBJECT_0 == 0; anything else: stop listening
                }
                on_activate();
            })
            .ok();
    }
}

#[cfg(windows)]
pub use imp::{acquire_or_signal, listen};

#[cfg(not(windows))]
pub fn acquire_or_signal() -> bool {
    true
}
#[cfg(not(windows))]
pub fn listen(_on_activate: impl Fn() + Send + 'static) {}
