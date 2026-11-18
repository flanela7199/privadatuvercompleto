//! WebView2 runtime selection. This machine (Windows 10 LTSC) has no Edge / evergreen
//! WebView2, so we ship/point to the *Fixed Version* runtime:
//!   1. `<exe dir>/webview2/` (portable distribution next to the exe)
//!   2. `D:\tools\webview2\Microsoft.WebView2.FixedVersionRuntime.*` (dev machine)
//! If neither exists the evergreen runtime (if installed) is used.
use std::path::{Path, PathBuf};

fn find_in(dir: &Path) -> Option<PathBuf> {
    if dir.join("msedgewebview2.exe").exists() {
        return Some(dir.to_path_buf());
    }
    let mut hits: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.join("msedgewebview2.exe").exists())
        .collect();
    hits.sort();
    hits.pop() // highest version
}

pub fn use_fixed_runtime() {
    if std::env::var_os("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER").is_some() {
        return;
    }
    let mut candidates = Vec::new();
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        candidates.push(exe_dir.join("webview2"));
    }
    candidates.push(PathBuf::from(r"D:\tools\webview2"));
    for c in candidates {
        if let Some(dir) = find_in(&c) {
            std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &dir);
            return;
        }
    }
}
