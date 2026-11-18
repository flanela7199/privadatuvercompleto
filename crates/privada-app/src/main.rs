// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    privada_app_lib::webview2::use_fixed_runtime();
    privada_app_lib::run();
}
