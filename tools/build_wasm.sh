#!/bin/sh
# Build the Rust core for the webview: crates/privada-wasm -> web/pkg (wasm-bindgen --target web)
set -e
cd "$(dirname "$0")/.."
. tools/env.sh
# WASM_SIMD=1 sh tools/build_wasm.sh  -> build with simd128
[ "${WASM_SIMD:-0}" = 1 ] && export RUSTFLAGS="${RUSTFLAGS:-} -C target-feature=+simd128"
cargo build -p privada-wasm --target wasm32-unknown-unknown --release
WB=$(ls -d /d/tools/wasm-bindgen/*/wasm-bindgen.exe 2>/dev/null | head -1)
"${WB:-wasm-bindgen}" --target web --out-dir web/pkg --no-typescript target/wasm32-unknown-unknown/release/privada_wasm.wasm
# optional: wasm-opt -O3 if binaryen is installed
if command -v wasm-opt >/dev/null 2>&1; then wasm-opt -O3 web/pkg/privada_wasm_bg.wasm -o web/pkg/privada_wasm_bg.wasm; fi
ls -la web/pkg
