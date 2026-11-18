//! Privada Tuber core: ALL per-frame logic of the character, platform independent.
//! Used natively by the app (privada-app, e.g. `dsp` for the microphone) and inside the
//! webview through `privada-wasm` (rig, actions, FX, toss).
//!
//! * [`rig`]   — springs, look, blink, googly eyes, lip (lid bones + morphs), seat, lid collision, body/head
//! * [`actions`] — flush, paper, jump, backflip, no, gargle, blink (same timings as web/src/anim/actions.js)
//! * [`water`] — flush water jet / drops / foam / puddle / ripples
//! * [`paper`] — toilet-paper verlet strip with perforations and tearing
//! * [`toss`]  — overlay drag / throw / bounce physics (screen space)
//! * [`dsp`]   — microphone FFT -> mouth vector (owned by the app worker)
pub mod dim;
pub mod dsp;
pub mod geo;
pub mod paper;
pub mod util;
pub mod water;
pub mod actions;
pub mod rig;
pub mod toss;
