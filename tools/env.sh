# source tools/env.sh  -> Rust toolchain on D: (C: is nearly full)
export RUSTUP_HOME='D:\tools\rust\rustup' CARGO_HOME='D:\tools\rust\cargo'
export PATH="/d/tools/rust/cargo/bin:/d/tools/node/node-v22.11.0-win-x64:$PATH"
# dlltool for the windows-gnu toolchain (raw-dylib in windows-sys): llvm-dlltool from llvm-mingw, isolated so rustc keeps its own bundled gcc linker
export PATH="/d/tools/dlltool:$PATH"
