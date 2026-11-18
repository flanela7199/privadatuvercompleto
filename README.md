# Privada Tuber 🚽👑

3D vtuber character: a real porcelain toilet with googly eyes, mustache and crown.
It follows the mouse and opens its lid (the mouth, which bends like a lip) with the microphone.
Web preview first (three.js); the Rust desktop app comes next and reuses the same themes and the exported GLB.

## Run the preview

```sh
cd D:\flanelil
python -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765
```

Keys: **F** flush (spits water) · **P** toilet paper · **J** jump · **N** "no" · **B** blink · **Space** mouth · **H** hide panel.
URL params: `?theme=soviet`, `?play=flush`, `?look=0.3,0.1`, `?mouth=0.7`, `?ui=0`, `?ao=0`.

## Layout

| Path | What |
|---|---|
| `src/rig/ToiletTuber.js` | The character: named rig, sockets, springs, lip-lid + collision clamp, per-frame update |
| `src/rig/geo.js` | Shape helpers (egg bowl, seat/lid revolve profiles, tapered tubes, stars) |
| `src/rig/materials.js`, `textures.js` | Theme material specs → MeshPhysicalMaterial, procedural textures by name |
| `src/accessories/index.js` | Accessory registry + crown, mustaches, ushanka, star |
| `src/accessories/extra.js` | Big accessory pack (hats, glasses, props…) |
| `src/accessories/glb.js` | Any user `.glb` model as an accessory |
| `src/anim/actions.js` | One-shot animations (flush, paper, jump, no, blink) |
| `src/fx/` | Water jet / puddle, paper strip physics |
| `src/editor.js` | Wardrobe: add/remove/move/recolor accessories, import .glb, save looks |
| `themes/*.json` | Themes (`extends` another theme; materials merge per key, slots replace per socket) |

## Add a theme

Create `themes/my_theme.json` and add its id to `themes/index.json`:

```json
{ "id": "pirate", "extends": "base", "name": "Pirata",
  "materials": { "seat": { "color": "#3b2a1a" } },
  "slots": { "head_top": [{ "id": "pirate_hat" }], "eyes": [{ "id": "eyepatch" }] } }
```

Or build one in the **Guarda-roupa** panel and press *Salvar visual* / *⬇ .json*.

## Add an accessory

```js
registerAccessory('my_hat', ({ mats }, params) => {
  const g = new THREE.Group();
  // ... meshes using mats.get('felt', { color: '#222', roughness: 0.9 })
  g.userData.update = (st) => { /* st.mouth, st.headYawVel, st.dt ... */ };
  return g;
});
```

Sockets: `head_top, eyes, tank_front, face, lid_top, body_front, side_right, back, floor_left, floor_right`.

## Rig node names (for the Rust app)

`body` (yaw/pitch) → `bowl`, `water`, `seat_pivot/seat`, `lid_pivot/lid` (SkinnedMesh, bones `lid_bone_0..5`),
`neck_pipe`, `socket_*`, `head` (tank) → `tank`, `tank_lid`, `eye_L/R` → `pupil_L/R`, `flush_handle`, `paper_holder/paper_roll`.

## Roadmap: Rust app

- Bevy (wgpu) with a transparent, borderless, always-on-top window (OBS-friendly) or a chroma background.
- Load the exported GLB and drive nodes by name, using the same springs (port `Spring`).
- Mouse: global cursor position relative to the window. Mic: `cpal` RMS → gate → mouth (same as `src/input/mic.js`).
- Themes: same JSON; accessories as GLB parts per id.
- Hotkeys for actions (global shortcuts), plus effects as particles.
