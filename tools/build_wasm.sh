#!/bin/sh
# Build the Rust core for the webview: crates/privada-wasm -> web/pkg (wasm-bindgen --target web)
set -e
cd "$(dirname "$0")/.."
. tools/env.sh
cargo build -p privada-wasm --target wasm32-unknown-unknown --release
WB=$(ls -d /d/tools/wasm-bindgen/*/wasm-bindgen.exe 2>/dev/null | head -1)
"${WB:-wasm-bindgen}" --target web --out-dir web/pkg --no-typescript target/wasm32-unknown-unknown/release/privada_wasm.wasm
ls -la web/pkg
