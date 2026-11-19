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
'-separated sfx: flush splash paper rip gargle boing whoosh drip clack:<v> prop_hit:<id>:<speed> prop_reset:<id>
```
NODE_ORDER: `body head lid_pivot lid_bone_1..7 seat_pivot eye_L eye_R pupil_L pupil_R flush_handle paper_roll water water_swirl seat_bone_1..7` (see "Mouth rig").
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
| `mouth` | Rust → all, ~60 Hz | `{ open, round, wide, closed, sib, level }` all 0..1 (same meaning as src/input/visemes.js) + meter `{ db, peakDb, floorDb }` (dB after gain, auto-level peak, noise floor) |
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
| `send_to_back` | – | `true`: puts the character window at the bottom of the z-order (out of the way, keeps rendering for OBS). Also in the tray: "Mandar para trás (continua no OBS)" |
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

`play:<flush|paper|jump|backflip|no|blink|gargle|sit|stand>` · `outfit:<id>` · `scene:<index>` ·
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

## Body proportions + mouth limits (2026-11-18, from Flanela's feedback)

Theme JSON may carry a `body` block (all optional, defaults = 1 / 0):

```jsonc
"body": {
  "tank": { "w": 1.0, "h": 1.38, "d": 1.0,          // head (tank) scale factors, 0.6..1.6 (bottom + back stay put; h 1.38 = height/width 0.76 like the original)
            "round": 0.10, "bulge": 0.02,           // soft "pillow" tank: corner radius 0.02..0.16 m (bottom corners x1.15, top x0.9), face bulge 0..0.06 m,
            "taper": 0.93, "lidRound": 0.035,       // bottom width factor 0.7..1.15, tank-lid edge radius 0.01..0.05 m,
            "lidThick": 0.14, "lidOver": 0.045 },   // tank-lid slab thickness 0.04..0.2 m (slightly domed top) and overhang per side 0..0.08 m
  "eyes": { "style": "classico",                      // classico (flat disc, thick outline, pupil 0.38 + highlight, calm pupils) | googly (3D dome)
                                                      // | desenho (oval 1.15, no outline, pupil 0.42) | serio (classico + porcelain upper eyelid, lowers on M/blink) | sticker
            "size": 1.13, "spacing": 0.97, "y": 0.0,  // eye radius factor 0.5..1.8, spacing factor 0.6..1.6, vertical offset from mid height in m (-0.12..0.12)
            "outline": null, "pupil": null, "oval": null }, // optional overrides of the style: 0..0.2 / 0.2..0.5 / 0.9..1.3 (fractions of the radius)
  "neck": { "length": 0.9 },                          // neck pipe above the bowl, 0.6..1.6 (moves the head up/down)
  "roll": { "mount": "side" }                         // paper roll: "side" (default, holder on the tank's left side face,
                                                      // roll axis Z) | "front" (tank front-left below the eye, axis X)
}
```
The panel edits it on the active outfit (forking built-ins into custom like other edits). JS `ToiletTuber` (`bodyDims()`) and
the Rust rig (`set_body_dims(json)`, called by `setTheme`) both apply it: eyes, handle, sockets, the lid-vs-tank collision box
and the paper roll position follow the tank size and its curved surface (pillow mesh: web/src/rig/tank.js, same surface math as
`privada_core::dim::TankShape`; eyes and the flush handle sit flush on the bulged front face, turned to its normal; the paper
holder sits on the curved front / left side face). On both roll mounts the `paper` action streams the strip FORWARD (his +z,
toward the camera; small head turn) and it piles on the floor in front of the bowl; paper rests on the lid / drapes off the
bowl instead of passing through it.

### Mouth rig (lid = upper lip, seat = lower lip)

* Input vector (visemes.js / `set_input` + `set_input_ext`): `open round wide closed sib` (0..1) plus optional
  `cornerL cornerR` (-1 down .. 1 up; **L = the -x side, same side as `eye_L`**), `jawSide` (-1..1, also purses the lips
  that way), `jawFwd` (0..1), `upperRaise` (0..1) and `lips` (0..1, lip activity from avatar.js `shapeMouth`: the lips fold
  and chatter even when `open` is capped). `STANDARD_VISEMES` (visemes.js, mirrored in `privada_core::rig`) maps the 15
  standard vtuber visemes (AA AH AO AW_OW CH_J_SH EH_AE EY FV IH_AY L M_P_B N_NG_DH OY_UH_UW R_ER W Y_IY) + rest.
* Lower lip: on speech the seat front rolls OUT and DOWN over the bowl's front (never into the bowl: clamp against the rim,
  opening and outer wall), presses up/in on M/B/P and tucks under the upper lip on F/V. Upper lip: the lid front third folds
  up/out on O/U, down on open vowels; pucker pushes it forward. The lid hinge never goes below the (curled) seat.
* `NODE_ORDER` (26): `body head lid_pivot lid_bone_1..7 seat_pivot eye_L eye_R pupil_L pupil_R flush_handle paper_roll water
  water_swirl seat_bone_1..7` (seat bones appended; the seat is a SkinnedMesh `seat` with `seat_bone_0..7` hinge -> front;
  bones carry full TRS: they slide and lift, not only rotate).
* `BUF.MORPHS` (16 weights, `morph_names()`): lid `smile pucker arch corner_L_up corner_L_down corner_R_up corner_R_down
  pucker_L pucker_R`, then seat `seat_corner_L_up seat_corner_L_down seat_corner_R_up seat_corner_R_down seat_pucker_L
  seat_pucker seat_pucker_R` (ToiletTuber builds the targets from the same formulas, `lidMorph` / `seatMorph`).
* Extra wasm API: `set_input_ext(cornerL, cornerR, jawSide, jawFwd, upperRaise, lips)`, `lip_upper_matrix()` (16 floats,
  world matrix of the `lip_upper` socket), `lip_metrics()` ([seat front travel m, seat roll deg, lid curl deg, lid forward m]),
  `seat_front()`, `standard_visemes()` (JSON), `morph_names()`.

`config.settings.mouth = { maxOpen: 0.65, curve: 1.6 }` — maxOpen scales the mic/viseme `open` channel (0..1) before the rig
(1 = old behaviour), curve > 1 makes quiet speech open less (open' = maxOpen * open^curve). Applied in avatar.js before tuber.update.

New default socket `lip_upper` on the lid's front edge (child of `lid_bone_7`, origin = the lid's front point on its underside,
body (0, 0.677, 0.49) with the lid closed, +z out, +y up; moves with the upper lip in JS and Rust mode): mustaches attach there by
default; old themes/configs with mustaches on `face` are migrated to `lip_upper` when loaded.
Lower-lip sockets (children of `seat_bone_6`, so they move with the lower lip in JS and Rust mode): `mouth` = centre of the lip gap
at the seat's top front edge, body (0, 0.673, 0.495) at rest, +z out, +y up; `mouth_corner` = the character's right (+x) mouth
corner on the seat's outer outline, body (0.17, 0.673, 0.442) at rest, turned 25° outward (yaw +25°).

**The character window never minimizes** (a minimized window stops rendering and OBS shows nothing).
It is created with `minimizable(false)`, and a Win32 subclass turns every minimize into "send to back":
`WM_SYSCOMMAND/SC_MINIMIZE` (taskbar click, Alt+Space, Win+Down) is swallowed; `SIZE_MINIMIZED`
(Win+M, Win+D "show desktop", other tools) is undone immediately (restored without activation, then
placed at the bottom). It stays in the taskbar (OBS window capture lists it).

**Single instance.** `main()` first creates the named mutex `Local\PrivadaTuber-com.flanela.privadatuber`
(before WebView2/Tauri/windows). A second launch finds it, sets the auto-reset event
`Local\PrivadaTuber-activate` and exits with code 0 (no window). The running instance waits on that event
and shows the character + panel. (tauri-plugin-single-instance was removed.)

## Props physics, wet paper, sitting on furniture (worker physics, 2026-11-18)

Everything below runs in Rust (`crates/privada-core/src/props.rs`, hooks in `water.rs` / `paper.rs` / `rig.rs`),
deterministic (seeded RNG, fixed 2 sub-steps). **JS fallback (`?nowasm`, no `web/pkg`): props stay attached and the
paper never gets wet** (sitting / `sit` / `stand` work in both paths; there the chair never moves).

### Wet paper
Water (live drops via a spatial hash, the coherent column, the puddle under paper lying on the floor) soaks the paper
strip / hanging flap / torn piece / floor pile **per point** (`wet` 0..1; drops that hit the paper are absorbed).
Wet paper: darker + translucent (per-vertex RGBA), heavier (gravity × (1 + 2·wet), heavier points move less in the
length constraints), barely moved by wind / turbulence, sticks to the floor (friction 0.55 → 1), and a wet perforation
gives way under the weight hanging below it (`load > 0.3 + 4·(1−wet)²` m of dry-equivalent paper, only where wet > 0.35;
dry paper never tears by itself) → the wet part drops off (`rip` sfx). Dries linearly in 20 s.
So that "spit while the paper is out" reliably wets it (also with the default side roll): while he spews, ~20 % extra
water dribbles over the lower lip and lands 0.2–0.9 m in front of the bowl, 30 % of the landing splash is thrown back
toward the bowl, the puddle creeps toward the bowl while it is fed, the column drags the air so airborne paper within
1.2 m is drawn toward the nearest point of the arc (up to 18 m/s²), and the `paper` action keeps streaming (its windy
phase pauses, max 3 s) while a flush is gurgling / spewing, with the flush deciding where he looks (the jet keeps its aim).
Paper alone or flush alone look as before. Test `paper_then_flush_soaks_the_strip_with_the_default_side_roll`
(paper, flush 1 s later): mean strip wetness 0.59, 2 weight tears. Paper strip points also push props
(and are pushed out of them).
JS: `BUF.PAPER_COL` / `BUF.TORN_COL` (MAX_PTS·2 × RGBA) → the strip geometry's `color` attribute (itemSize 4,
`material.vertexColors = true`), uploaded only while `SC.PAPER_WET` / `SC.TORN_WET` (max wetness) > 0.

### Rigid-body props
Accessories with `ACCESSORY_INFO[id].physics` (extra.js: `toilet_paper_stack` = 6 roll bodies in one group,
`air_freshener`, `rubber_duck` (buoyant), `plunger`, `toilet_brush_holder`), a slot entry `physics: {...}` /
`physical: true` (`physics: false` opts out), and furniture on `floor_under` (seat) become rigid bodies when HIT:

* attached (`state 0`) until the gathered impulse would give it 0.15 m/s or 2.5 rad/s: water drops (bounce off,
  impulse ∝ drop momentum, 2 g per unit drop size), the column (0.8 kg/s × its flow while it is in the way), paper strip
  points (8 g stylized push mass × (1 + 2·wet)), other bodies, and **the character itself** (kinematic collider: bowl +
  closed lid, pedestal sole, neck pipe capsule, tank + tank-lid box; surface velocity from last frame's matrices, so
  flips / jumps / shakes push things; props on body/head sockets (`onBody`) are not bumped while attached);
* dynamic (`1`): gravity 9.8, floor y = 0, box / cylinder colliders with inertia tensors, sequential impulses with
  accumulated clamped normal + friction impulses (restitution 0.25 above 0.6 m/s, friction 0.6), angular / rolling
  damping, body–body contacts (AABB broadphase), rubber duck spins / bobs when hit by water and floats in the puddle;
* sleeps on the floor (`2`); after `config.settings.props.resetAfter` s at rest (default **8**, 0 = never) the whole
  group flies back to its sockets with an eased hop + pop (`3`, 0.7 s, `prop_reset:<id>` → sfx `pop`), then `0` again;
* `4` = attached but nudged off the socket (furniture pushed by the flush recoil / turning; eases back after resetAfter).

Events: `prop_hit:<id>:<speed>` (impacts > 0.5 m/s, ≤ 1 per 0.15 s per body) → ToiletTuber emits
`sfx {type:'thud', v: speed, id}` (new `thud` sound in `web/src/audio/sfx.js`).

wasm (`Rig`): `register_prop(id, shape_json, rest16) -> slot|-1` with
`shape_json = {"kind":"box"|"cylinder", "size":[x,y,z] | {"r","h"}, "mass", "center":[x,y,z], "com":[x,y,z], "group", "buoyant", "seat", "onBody"}`
(object-local, size = full extents, ≤ 32 props), `unregister_prop(id)`, `clear_props()`, `prop_index(id)`, `prop_count()`,
`set_prop_rest(id, m16)` / `set_prop_rest_slot(slot, m16)` (or write `BUF.PROP_REST` = 32 × 16 directly; ToiletTuber
does, every frame, since sockets move), `prop_poses()` (copy) / `BUF.PROP_POSES` (32 × 12:
`[state, px,py,pz, qx,qy,qz,qw, sx,sy,sz, speed]` = rig-root TRS of the accessory origin; −1 = empty slot),
`set_props_config('{"resetAfter":8,"enabled":true}')`, `prop_kick(id, jx, jy, jz)` (debug), `paper_wetness()`.
Scalars: `SC.PAPER_WET` 20, `SC.TORN_WET` 21, `SC.PROP_COUNT` 22, `SC.PROPS_ACTIVE` 23.

JS (`ToiletTuber`): `registerProps()` runs after every `buildAccessories()`: collider = Box3 of the built accessory in
the wrapper's space (`fit: true`, follows params like `x` / `scale`) or the metadata size; parts (`parts: {...}`) = one
body per child (the stack's rolls). Each frame: rest matrices → Rust, `r.update`, then non-rest poses drive the
wrapper / part (world pose → its parent space); back at rest the original local transform is restored.
`tb.setPropSettings({ resetAfter, enabled })` (avatar.js applies `config.settings.props`), `tb.kickProp(id, x, y, z)`.

### Sitting on furniture
* Socket **`floor_under`**: root space, on the floor right under the pedestal (+z = his forward); not moved by yaw,
  wobble, squash or flips.
* `FURNITURE_INFO[id].seatHeight` (m; `web/src/accessories/furniture.js`, loaded lazily, optional;
  `registerFurnitureInfo(info)` from ToiletTuber.js adds entries and re-registers the rigs' props; a slot entry may set
  `seatHeight` too) → `tb.seatHeight()` = seatHeight × params.scale / seatScale (seatHeight is given at the default
  seatScale) × the slot's transform scale (+ its y offset), synced every frame to Rust `set_seat_height(h)`.
* Persistent sit height: Rust `set_sit_height(h)` / `sit_height()` / `is_sitting()`, JS `tb.sitHeight` (get/set),
  `tb.isSitting`: raises the whole body base by h (spring k 110, d 21 ≈ 0.3 s). Seated, body pitch / lean are scaled by
  0.35 (`SEAT_TILT`; the head takes the rest of the pitch) and the body is lifted by the tilted sole's drop, so it pivots
  on its lowest edge and the pedestal never dips into the seat (test: look ±1 both axes + mouth open, ≥ seat − 5 mm). FX floor stays y = 0 (water and paper fall
  to the floor), lid / lip / look / flip unchanged.
* Actions `sit` (0.9 s: crouch, hop, land with squash + `clack:4`; base → seat height) and `stand` (base → 0).
  The avatar calls `play('sit')` when a chair is equipped.
* The chair is a `seat` prop (box from the floor up to the seat; the backrest does not collide). While he sits on it,
  water / paper / bumps leave it alone, and it reacts to his animations (Rust, `Rig::furniture`):
  **backflip** kicks it backward (2.6 m/s back + 2.2 up + tumble; it ignores his colliders for 0.3 s), he lands on the
  FLOOR, and when the chair is back on `floor_under` (after resetAfter) he hops onto it again (`sit`) by himself;
  **jump** landing wobbles / slides it a little (a gentle landing like the sit hop only nudges it);
  **flush** recoil pushes it back ~3 cm/s while spewing; body turns / the `no` shake twist a light chair (state 4).
  If the chair ends up away from under him (> 0.25 m or tipped) he drops to the floor and sits again when it is back.
  JS fallback: no chair physics (a backflip lands back on the seat).

Tests: `cargo test -p privada-core` (props: drop stream knocks over a standing cylinder, paper strip sweeping a box
pushes it, settled bodies reset, group wake + determinism; paper: wetness rises under spray and decays, wet perforations
tear / dry hold / wet paper sticks; rig: flush knocks over a prop in its path, flush + paper wets the paper, sit raises
the base smoothly and keeps the lid clamp, backflip from the chair sends it ≥ 0.5 m and he sits again, jump wobbles /
flush pushes the chair), `node tests/props_smoke.mjs` (wasm, through ToiletTuber), `node tests/sit_smoke_js.mjs`
(JS fallback), bench `node --expose-gc tests/bench/props_bench.mjs` (20 bodies + flush + paper vs the same
accessories with physics off: ≈ +30 µs mean / +45 µs p95 per frame; JS side ≈ 2.5 µs rest upload + 5–8 µs pose apply).

## Microphone loudness (AudioCfg)

`set_audio({ audio: { enabled, device, gateDb, rangeDb, hold, gainDb, autoLevel } })`
(same fields in `config.audio`; the JS fallback `web/src/input/mic.js` behaves identically):

| field | range / default | meaning |
|---|---|---|
| `gainDb` | −30..+20, 0 | input gain applied to the measured level |
| `autoLevel` | bool, **true** | AUTO-LEVEL: tracks the speaker's peak (attack 50 ms, release 4 s, only while voice) and the noise floor (fast down, +1.5 dB/s up); `x = (db − floor − 6) / max(12, peak − floor − 6)`, soft knee `0.68·x + 1.6·max(0, x−1)` → normal speech ≈ 0.5–0.7, only shouting reaches 1. Fixes a loud/close mic pinning the mouth open |
| `gateDb` | −90..0, −50 | absolute floor: below it the mouth is closed (both modes) |
| `rangeDb` | 10..60, 28 | manual mode only: `loud = (db − gate) / range` |
| `hold` | 0..1 s, 0.14 | keep the shape between syllables |

Measured (unit tests, synthetic speech): −6 dBFS loud speech → mean open 0.59, never pinned (manual mode: 1.0);
−40 dBFS quiet speech → mean open 0.55 after adaptation; silence → closed.
