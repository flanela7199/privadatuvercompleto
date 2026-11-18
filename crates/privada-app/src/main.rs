// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // FIRST: if Privada Tuber is already running, wake it (show character + panel) and leave.
    if !privada_app_lib::single_instance::acquire_or_signal() {
        std::process::exit(0);
    }
    privada_app_lib::webview2::use_fixed_runtime();
    privada_app_lib::run();
}
