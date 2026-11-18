# source tools/env.sh  -> Rust + Node toolchains on D: (C: is nearly full)
export RUSTUP_HOME='D:\tools\rust\rustup' CARGO_HOME='D:\tools\rust\cargo'
# gnullvm toolchain + llvm-mingw (clang/lld/llvm-dlltool). The plain windows-gnu toolchain with
# WinLibs ld produced a broken import (crash in RegGetValueW at window creation), so don't use it.
export RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnullvm
export PATH="/d/tools/llvm-mingw-20261104-ucrt-x86_64/bin:/d/tools/rust/cargo/bin:/d/tools/node/node-v22.11.0-win-x64:$PATH"
export npm_config_cache='D:\tools\npm-cache'
