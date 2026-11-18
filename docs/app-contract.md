# Privada Tuber desktop app: contract (Rust ⇄ pages)

ADR summary (lead decision 2026-11-18): **Rust + the same model.** A Tauri v2 app (Rust) owns the
OS-level work: transparent always-on-top windows, global cursor, global hotkeys, microphone + FFT
lip-sync, config/scenes on disk, tray. The character is rendered by the existing three.js code
(identical model, accessories, animations) on the GPU inside WebView2.

## Layout

```
Cargo.toml                      Rust workspace
crates/privada-core/            ALL logic in Rust: springs, rig pose, actions, lip/visemes + lid collision,
                                mic DSP (FFT -> mouth vector), water/paper FX sims, drag/throw physics
crates/privada-wasm/            wasm-bindgen bindings of privada-core -> web/pkg/ (runs inside the webview, no IPC)
crates/privada-app/             Tauri v2 app (created with `tauri init`): windows, cursor, hotkeys, native mic, tray, config
web/                            renderer + UI (frontendDist of the app, no server needed)
  index.html                    model preview / editor (browser)
  avatar.html                   the character window (transparent, no floor, no background)
  control.html                  control panel (wardrobe with previews, presets, scenes, hotkeys, mic)
  src/app/bridge.js             THE ONLY JS that talks to Tauri (browser fallback for testing)
  src/app/avatar.js, control.js page logic (thin: render + UI; logic lives in Rust)
  themes/, presets/             theme / outfit-preset JSON (read by JS and by Rust)
  pkg/                          wasm-pack/wasm-bindgen output (generated)
tools/                          env.sh (Rust/Node on D:), capture_server.py (video), scripts
```

Run: `source tools/env.sh && cd crates/privada-app && tauri dev` (Tauri CLI at D:/tools/tauri-cli). No local web server.

## Rust in the webview (privada-wasm)

All per-frame character logic is Rust (`crates/privada-core`): springs, look/head/body, blink,
googly pupils, mouth vector -> lid hinge + 7 lip-bone springs + smile/pucker/arch morphs + seat
lower lip, lid-vs-tank collision clamp (transform hierarchy), squash/breath/shake/flip, handle,
water level/swirl, actions (flush paper jump backflip no gargle blink), water FX (drops, foam,
column, ripples, puddle), paper strip (verlet, perforations, tear, roll shrink), and `Toss`.
JS (`web/src/rig/ToiletTuber.js`) only builds the three.js meshes/accessories and APPLIES results.
Build: `sh tools/build_wasm.sh` (cargo wasm32 release + wasm-bindgen --target web -> `web/pkg/`).

```js
import { loadWasm, WasmRig, BUF, SC } from './rig/wasmrig.js';   // ToiletTuber does this itself
const rig = new WasmRig(await loadWasm(), seed);  // rig.r = the wasm Rig, rig.order = NODE_ORDER
rig.r.set_input(lookX, lookY, open, round, wide, closed, sib);
rig.r.play('flush');                              // -> false if unknown
rig.r.update(dt);
rig.view(BUF.POSE)      // zero-copy Float32Array: NODE_ORDER x [px,py,pz, qx,qy,qz,qw, sx,sy,sz] (local)
rig.view(BUF.MORPHS)    // [smile, pucker, arch]
rig.view(BUF.SCALARS)   // SC.* : hinge, accessory state (mouth/talk/headYawVel/headPitchVel/lift/time/dt), swirl, FX counts
rig.view(BUF.DROPS)     // 900 x 16 instance matrices; FOAM 360 x 16; STREAM_POS/UV; RIPPLES 18 x 5; PUDDLE 5; PUDDLE_RADIAL 121
rig.view(BUF.PAPER_POS) // + PAPER_UV / PAPER_PERF and TORN_* (counts in SC.PAPER_COUNT ...)
rig.r.drain_events()    // '
'-separated sfx: flush splash paper rip gargle boing whoosh drip clack:<v>
```
NODE_ORDER: `body head lid_pivot lid_bone_1..7 seat_pivot eye_L eye_R pupil_L pupil_R flush_handle paper_roll water water_swirl`.
Full buffer table: `crates/privada-wasm/src/lib.rs`. `?nowasm` or a missing `web/pkg/` -> the pure-JS rig runs instead.

### Toss (overlay drag / throw / bounce, screen px; mirrors JsToss in avatar.js)

```js
const toss = new pkg.Toss();
toss.set_rest(x, y);          // resting point (x = center, y = feet), snaps there when at rest
toss.set_size(w, h);          // character box, so wall/ceiling bounces respect his size
toss.grab(x, y); toss.drag(x, y, t); toss.release(t);   // t in seconds; throw velocity from the last 6 samples
toss.update(dt, W, H)         // -> [x, y, angle, squash]; states rest -> held -> fly -> ground -> hop -> rest
toss.take_impact()            // max impact speed (px/s) since last call (dizzy eyes + clack); 900 on landing the hop
toss.reset(); toss.is_held(); toss.is_busy();
```

## Windows

| label | page | default |
|---|---|---|
| `avatar` | avatar.html | desktop **overlay**: borderless, transparent, covers the primary monitor, skip taskbar, click-through except over the character (`auto`); always-on-top is per scene (`scene.alwaysOnTop`, default false). Can switch to **window mode** (`set_avatar_mode`) or be hidden (`set_overlay_visible`). |
| `output` | avatar.html?output=1&bg=… | **OBS window** ("Captura de janela"): borderless, resizable, default 1280×720, in the taskbar, not on top; the page draws the background (chroma / solid / real transparent). Opened with `open_output`. |
| `control` | control.html | normal decorated window 1100×760, opened from tray / hotkey / right-click on the character |

All webviews run with `--disable-background-timer-throttling --disable-renderer-backgrounding
--disable-backgrounding-occluded-windows` (identical args are required by WebView2), so the avatar keeps
rendering at full fps when unfocused, behind other windows or captured by OBS. Cursor polling, mic and
global hotkeys are native threads and never pause. Windows are created/shown without stealing focus
(except the control panel when explicitly opened). Extra Rust → page events: `click-through` (bool, the
overlay's current ignore-mouse state), `click-mode` (`auto`/`on`), `mic-enabled` (bool), `mic-error` (string),
`output-background` (string, to the `output` window when `open_output` is called again).

## Events (bridge.listen / bridge.emit)

| event | direction | payload |
|---|---|---|
| `cursor` | Rust → all, 60 Hz | `{ x, y }` global cursor, **physical** screen px |
| `mouth` | Rust → avatar, ~60 Hz | `{ open, round, wide, closed, sib, level }` all 0..1 (same meaning as src/input/visemes.js) |
| `hotkey` | Rust → all | `{ action, arg }` (see Actions) |
| `command` | control → avatar | `{ action, arg }` (same shape as hotkey) |
| `state` | control → avatar | full `Config` (avatar applies outfit/scene/settings) |
| `avatar-status` | avatar → control, ~4 Hz | `{ fps, hitRect, outfitId, sceneId, clickThrough }` |

## Commands (bridge.invoke)

| command | args | returns |
|---|---|---|
| `load_config` | – | `Config` |
| `save_config` | `{ config }` | `true` |
| `set_hotkeys` | `{ bindings: { [accelerator]: { action, arg } } }` | `{ ok: string[], failed: string[] }` |
| `audio_devices` | – | `string[]` |
| `set_audio` | `{ audio: AudioCfg }` | `true` |
| `set_hit_rect` | `{ rect: {x,y,w,h} \| null }` logical px inside the avatar window | `true` |
| `set_click_through` | `{ mode: 'auto' \| 'on' \| 'off' }` | `true` |
| `set_avatar_mode` | `{ mode: 'overlay' \| 'window', width?, height?, alwaysOnTop? }` (alwaysOnTop default false) | `true` |
| `get_monitor` | – | `{ x, y, width, height, scale }` of the avatar window's monitor (physical px) |
| `open_control` | – | `true` |
| `open_output` | `{ width?, height?, background? }` (background e.g. `chroma`, `#00ff00`, `transparent`) | `true` |
| `close_output` | – | `true` |
| `set_overlay_visible` | `{ visible }` | `true` |
| `get_windows` | – | `{ avatar: { mode, visible }, output: { open } }` |
| `quit` | – | – |

## Actions (hotkeys, commands, tray)

`play:<flush|paper|jump|backflip|no|blink|gargle>` · `outfit:<id>` · `scene:<index>` ·
`viseme:<A|E|I|O|U|M|F|S>` · `toggle:clickthrough` · `toggle:follow` · `toggle:mic` · `reset:position` · `open:control`

## Config (JSON, saved next to the exe in `privada-data/config.json`)

```jsonc
{
  "version": 1,
  "activeOutfit": "base",
  "outfits": { /* custom outfits: id -> theme JSON (same format as themes/*.json) */ },
  "activeScene": 0,
  "scenes": [
    { "name": "Desktop", "mode": "overlay", "outfit": null, "x": 0.82, "y": 0.78, "scale": 1.0,
      "background": "transparent", "bgColor": "#00ff00", "follow": true, "mic": true, "clickThrough": "auto" }
  ],
  "hotkeys": { "Ctrl+Alt+F": { "action": "play", "arg": "flush" } },
  "audio": { "enabled": true, "device": null, "gateDb": -50, "rangeDb": 28, "hold": 0.14 },
  "render": { "fps": 60, "pixelRatio": 1.5, "ao": false }
}
```
Scene `x`, `y` are the character's resting point as a fraction of the monitor (overlay mode) or window.
Default hotkeys are in `src/app/defaults.js` (`DEFAULT_CONFIG`), the one source for both Rust (receives it via `set_hotkeys`) and the pages.
