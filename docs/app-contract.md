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
| `avatar` | avatar.html | **default: a normal window** titled "Privada Tuber" (BORDERLESS, no shadow: moved by the page's `data-tauri-drag-region` strip and resized via invisible edge zones calling `start_resize`; taskbar + alt-tab, movable/resizable, default 720×900, transparent-capable for `background: 'transparent'` scenes). Its size/position are remembered in `privada-data/window.json`. Optional scene mode **overlay** (`set_avatar_mode`): borderless, covers the primary monitor, skip taskbar, click-through except over the character (`auto`). Always-on-top is per scene (`scene.alwaysOnTop`, default false). Closing it only hides it (tray "Mostrar personagem" / `show_avatar` brings it back). |
| `control` | control.html | normal decorated window 1100×760, opened from tray / hotkey / right-click on the character |

All webviews run with `--disable-background-timer-throttling --disable-renderer-backgrounding
--disable-backgrounding-occluded-windows` (identical args are required by WebView2), so the avatar keeps
rendering at full fps when unfocused, behind other windows or captured by OBS. Cursor polling, mic and
global hotkeys are native threads and never pause. Windows are created/shown without stealing focus
(except the control panel when explicitly opened). Extra Rust → page events: `click-through` (bool, the
overlay's current ignore-mouse state), `click-mode` (`auto`/`on`), `mic-enabled` (bool), `mic-error` (string),
There is NO separate OBS window: the character window itself is the OBS source ("Captura de janela").

**No white flash / splash.** Every window is created hidden with its final background colour
(character: transparent; panel and splash: `#101114`) and is shown only when its page calls
`invoke('page_ready', { label })` (fallback: shown anyway after 15 s). A small borderless `splash`
window (`splash.html`, centered, on top) shows a progress bar driven by the `loading` event and closes
when the character page reports ready (the panel may finish later).

## Events (bridge.listen / bridge.emit)

| event | direction | payload |
|---|---|---|
| `cursor` | Rust → all, 60 Hz (on change, else ~2/s) | `{ x, y, win }`: global cursor in **virtual-desktop physical px** (all monitors) + the avatar window rect `win: { x, y, w, h, scale, ix, iy, iw, ih } \| null` (outer x/y/w/h and client ix/iy/iw/ih, physical px) |
| `mouth` | Rust → avatar, ~60 Hz | `{ open, round, wide, closed, sib, level }` all 0..1 (same meaning as src/input/visemes.js) |
| `hotkey` | Rust → all | `{ action, arg }` (see Actions) |
| `command` | control → avatar | `{ action, arg }` (same shape as hotkey) |
| `state` | control → avatar | full `Config` (avatar applies outfit/scene/settings) |
| `avatar-status` | avatar → control, ~4 Hz | `{ fps, hitRect, outfitId, sceneId, clickThrough }` |
| `loading` | pages → splash (bridge.emit) | `{ progress: 0..1, text }` e.g. avatar "carregando modelo…", panel "gerando miniaturas…" (progress never goes backwards on the splash) |

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
| `page_ready` | `{ label: 'avatar' \| 'control' \| 'splash' }` | `true`: shows that window; `avatar` also closes the splash |
| `open_output` | – | `true` (compatibility: just `show_avatar`; the character window is the OBS source) |
| `close_output` | – | `true` (compatibility no-op) |
| `set_overlay_visible` | – | `true` (compatibility no-op) |
| `get_windows` | – | `{ avatar: { mode, visible } }` |
| `start_resize` | `{ direction: n\|s\|e\|w\|ne\|nw\|se\|sw }` | `true` (native resize drag of the borderless character window) |
| `set_window_background` | `{ color: 'transparent' \| '#rrggbb' \| '#rrggbbaa', label? }` (label default `avatar`) | `true` (window/webview background behind the page = scene background) |
| `cache_get` | `{ key }` | **raw** `ArrayBuffer` of `privada-data/cache/<key>.bin`; **empty = miss** |
| `cache_put` | raw bytes body + header `x-key`: `invoke('cache_put', bytes, { headers: { 'x-key': key } })` | `true` |
| `thumb_get` / `thumb_put` | same as cache_get / cache_put, stored as `<key>.png` (keys like `thumb_<id>_<ver>`) | ArrayBuffer / `true` |
| `cache_clear` | – | `true` (deletes cached .bin/.png) |
| `cache_stats` | – | `{ files, bytes }` |
| `show_avatar` | – | `true` (show + unminimize + bring the character window to the front) |
| `open_data_dir` | – | `true` (opens `privada-data/` in Explorer) |
| `quit` | – | – |

## Actions (hotkeys, commands, tray)

`play:<flush|paper|jump|backflip|no|blink|gargle>` · `outfit:<id>` · `scene:<index>` ·
`viseme:<A|E|I|O|U|M|F|S>` · `toggle:clickthrough` · `toggle:follow` · `toggle:mic` · `reset:position` · `open:control`

Startup: the character window opens, and the control panel too unless `config.settings.openPanelOnStart === false`.
Closing the panel only hides it; the app quits only from the tray ("Sair") or `quit`.

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


## Cache files (Rust side)

`<exe dir>/privada-data/cache/`: keys must match `[a-z0-9_-]{1,96}`; all reads/writes run off the main
thread. `manifest.json` (written by the page via `cache_put` key `manifest`) is `{ version, outfits: { outfitId: [keys] } }` (a flat `{ outfitId: [keys] }` is accepted too); at startup, while the splash is
visible, Rust reads the active outfit's `.bin` files into memory and the first `cache_get` of each key is
served from RAM. The mesh binary layout (`PRVM`) is defined in the "Mesh cache" section (worker geo).

OBS: capture the character window with "Captura de janela", method **"Windows 10 (1903+)"** (BitBlt captures WebView2/GPU windows as black).

## Mesh cache (worker geo)

Heavy procedural meshes are generated in Rust (`crates/privada-core/src/geo`, exposed by privada-wasm) and
cached by `web/src/rig/geocache.js`. Output is identical to the old JS builders (checked array by array by
`web/tests/bench/geo_bench.mjs`; a few mustache arrays differ by < 3e-10 because of libm `pow` rounding).

| kind | used by | params |
|---|---|---|
| `mustache` | the 12 built-in mustache styles (`part` core/hair/mid, `side` ±1) | `{style, part, side, length, thickness, bowl?: {profile, scaleZ, egg}}` |
| `egg_revolve` | seat + lid (geo.js `eggRevolve`) | `{rx, rz, k, seg, profile: [[s,y]..] \| {lid:[rx,depth,dome,e]} \| {seat:[rx,s0,h]}}` |
| `crown_shell` | crown band | `{R, H, band, n, th?, cols?, rows?}` |
| `rounded_box` | ushanka fur (three.js RoundedBoxGeometry, non-indexed) | `{w, h, d, segments, radius}` |
| `lathe` | (available: bowl = Lathe -> scale z -> eggify) | `{points, segments, scaleZ?, egg?}` |

JS API (`geocache.js`): `getMesh(kind, params)` -> fresh `THREE.BufferGeometry` or `null` (no wasm -> JS builders),
`preload(theme, dim?)` / `preloadTheme` (build + persist every heavy mesh of a theme, yields between meshes),
`warmOutfit(outfitId)` (pull that outfit's persisted meshes into memory — call before building the character),
`warm(kind, params)`, `cacheKey(kind, params)`, `stats`. `?nogeo` / `globalThis.PRIVADA_NO_GEO` disables it.

Cache key: `<kind>-<fnv1a64(kind | stable-sorted params JSON | GEO_VERSION) as 16 hex>`, matches `[a-z0-9_-]`.

Binary layout **PRVM** (little-endian, 4-byte aligned), same bytes in memory, in `cache/<key>.bin` and from `build_mesh_prvm`:

| offset | type | field |
|---|---|---|
| 0 | 4 bytes | magic `PRVM` |
| 4 | u32 | format = 1 |
| 8 | u32 | GEO_VERSION (stale files are ignored) |
| 12 | u32 | flags: 1 normals, 2 uvs, 4 indices |
| 16 | u32 | vertex count |
| 20 | u32 | index count |
| 24, 28 | u32 | reserved (0) |
| 32 | f32[vc*3] | positions, then normals f32[vc*3]?, uvs f32[vc*2]?, indices u32[ic]? |

Persistence: Tauri `cache_get({key})` -> ArrayBuffer (empty = miss) / `cache_put(bytes, {headers:{'x-key': key}})`;
browser: IndexedDB `privada-geo/meshes`. The page writes the per-outfit key list with key **`manifest`**
(UTF-8 JSON `{ outfitId: [keys] }`) — the app must store that key as `cache/manifest.json` (what its startup preload reads).
