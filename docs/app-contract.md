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

JS ToiletTuber keeps building the three.js meshes; per frame it calls the Rust rig and only APPLIES results:

```js
import init, { Rig, Toss } from '../pkg/privada_wasm.js';
const rig = new Rig();                       // dims identical to DIM in ToiletTuber.js
rig.set_input(lookX, lookY, open, round, wide, closed, sib);
rig.play('flush');                           // actions: flush paper jump backflip no gargle blink
rig.update(dt);
rig.pose()        // Float32Array, NODE_ORDER x [px,py,pz, qx,qy,qz,qw, sx,sy,sz]
rig.node_order()  // string[] node names (body, head, lid_pivot, lid_bone_1.., seat_pivot, eye_L, pupil_L, ...)
rig.morphs()      // Float32Array [smile, pucker, arch]
rig.fx()          // Float32Array: water drops (instance TRS), stream points, puddle, paper strip points (layout in core docs)
rig.drain_events()// string[] sfx events ("flush", "clack:4.2", ...)
const toss = new Toss();                     // drag / throw / bounce physics for the overlay
toss.grab(x, y); toss.drag(x, y, t); toss.release(t); toss.update(dt, w, h) -> [x, y, angle, squash]
```
If `web/pkg/` is missing (plain browser), the existing JS code path keeps working.

## Windows

| label | page | default |
|---|---|---|
| `avatar` | avatar.html | **overlay mode**: borderless, transparent, always on top, covers the primary monitor, skip taskbar, click-through except over the character (`auto`). **window mode** (for OBS): normal 1280×720 borderless window with a solid/chroma background. |
| `control` | control.html | normal decorated window 1100×760, opened from tray / hotkey / right-click on the character |

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
| `set_avatar_mode` | `{ mode: 'overlay' \| 'window', width?, height? }` | `true` |
| `get_monitor` | – | `{ x, y, width, height, scale }` of the avatar window's monitor (physical px) |
| `open_control` | – | `true` |
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
