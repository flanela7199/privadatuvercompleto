# source tools/env.sh  -> Rust toolchain on D: (C: is nearly full)
export RUSTUP_HOME='D:\tools\rust\rustup' CARGO_HOME='D:\tools\rust\cargo'
export PATH="/d/tools/rust/cargo/bin:/d/tools/node/node-v22.11.0-win-x64:$PATH"
# MinGW-w64 (WinLibs gcc 16, msvcrt, binutils dlltool+as) for the windows-gnu toolchain
export PATH="/d/tools/winlibs/mingw64/bin:$PATH"
# NOTE: D:/tools/winlibs/.../x86_64-w64-mingw32/lib/default-manifest.o was renamed to *.disabled so the
# exe only carries Tauri's manifest (Common-Controls v6); otherwise ld drops one ("multiple non-default manifests").
