// Avatar window: the vtuber character alone on a transparent (or chroma/color) canvas.
// Exactly the same model as the preview (ToiletTuber + themes + presets + accessories).
// Rust side (via bridge): global cursor on the whole virtual desktop, mic -> mouth, hotkeys,
// window modes. "Playing with the mouse" = he follows the mouse with BIG angles, on every monitor.
//   avatar.html            -> main avatar window (scene mode 'window' by default, or 'overlay')
//   avatar.html?output=1   -> OBS output window (label `output`): mirrors the avatar
//                             (outfit, actions, mouth, look) with its own framing/background.
import * as THREE from 'three';
import { createStage } from '../stage.js';
import { ToiletTuber } from '../rig/ToiletTuber.js';
import { loadThemes, mergeTheme } from '../themes.js';
import { FakeTalk, maxMouth, zeroMouth } from '../input/visemes.js';
import { sfx } from '../audio/sfx.js';
import '../accessories/extra.js';
import '../accessories/glb.js';
import { isTauri, invoke, invokeRaw, listen, emit } from './bridge.js';
import { outfitThumbKey, accThumbKey } from './thumbkeys.js';
import { buildAccessory, listAccessories } from '../accessories/index.js';
import { MaterialLib } from '../rig/materials.js';
import { DIM } from '../rig/ToiletTuber.js';
import { makeResolver, migrateOutfit } from './outfits.js';
import { DEFAULT_CONFIG } from './defaults.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const OUTPUT = new URLSearchParams(location.search).has('output');
const OUTPUT_DEFAULTS = { background: 'chroma', color: '#00ff00', scale: 1.3, x: 0.5, y: 0.82, follow: true };
const LOOK_DEFAULTS = { range: 1.0, reachPx: 1400, maxYawDeg: 80, maxPitchDeg: 35 };
const BASE_PX = 380;      // character height on screen (logical px) at scale 1
const CHAR_H = 1.8;       // model height in world units (floor -> crown)
const CENTER_Y = 0.85;
const FOV = 20;
// what the JS rig reaches on its own at |look| = 1 (body yaw 0.5 + head yaw 0.28; pitch 0.1 + 0.22)
const RIG_YAW = 0.78, RIG_PITCH = 0.32;

/* -------------------------------------------------------------- loading */
// windows start hidden behind a splash; we report progress and say when the first frame is on screen
const loading = (progress, text) => { try { emit('loading', { label: 'avatar', progress, text }); } catch { /* */ } };

/* --------------------------------------------------------------- config */
let config = (await invoke('load_config').catch(() => null)) || structuredClone(DEFAULT_CONFIG);
config = { ...structuredClone(DEFAULT_CONFIG), ...config };
const scene0 = () => config.scenes?.[clamp(config.activeScene | 0, 0, (config.scenes?.length || 1) - 1)] || DEFAULT_CONFIG.scenes[0];
const outCfg = () => ({ ...OUTPUT_DEFAULTS, ...(config.output || {}) });
const lookCfg = () => ({ ...LOOK_DEFAULTS, ...(config.look || {}) });
const settings = () => config.settings || {};
loading(0.1, 'lendo configuração…');

/* ---------------------------------------------------------------- stage */
const stage = createStage({
  pixelRatio: Math.min(devicePixelRatio, config.render?.pixelRatio ?? 1.5),
  floor: false, contact: false, shadows: !!config.render?.shadows, preserveDrawingBuffer: false,
});
const { renderer, scene, camera } = stage;
camera.fov = FOV;
camera.near = 0.1; camera.far = 200;
renderer.setClearColor(0x000000, 0);

// window mode: invisible drag strip on top (Tauri drag region) with a subtle handle on hover
const strip = document.createElement('div');
strip.id = 'drag';
strip.setAttribute('data-tauri-drag-region', '');
strip.innerHTML = '<span data-tauri-drag-region></span>';
document.body.append(strip);

/* ------------------------------------------------------------- outfits */
loading(0.3, 'carregando motor Rust…');
try { const pkg = await import('../../pkg/privada_wasm.js'); await pkg.default?.(); window.privadaWasm = pkg; } catch { /* wasm not built: JS path */ }
const themes = await loadThemes('./themes/');
async function loadPresets() {
  try {
    const ids = await (await fetch('./presets/index.json')).json();
    const raw = {};
    await Promise.all(ids.map(async (id) => { try { raw[id] = await (await fetch(`./presets/${id}.json`)).json(); } catch { /* skip */ } }));
    return raw;
  } catch { return {}; }
}
const presetRaw = await loadPresets();
const resolved = new Map();
// Same resolution as the panel (web/src/app/outfits.js): custom > presets > themes, `extends`
// merged, every raw outfit migrated (mustaches face -> lip_upper). Unknown id -> null.
function resolveOutfit(id) {
  if (!id) return null;
  if (resolved.has(id)) return resolved.get(id);
  const R = makeResolver({ themes, presets: presetRaw, outfits: config.outfits || {} });
  if (!R.raw(id)) return null;
  const out = R.resolve(id);
  resolved.set(id, out);
  return out;
}

// Warm the persisted Rust meshes of the active outfit BEFORE the first build (geocache by worker geo),
// then build the character once, directly in the active outfit.
let geocache = null;
try { geocache = await import('../rig/geocache.js'); } catch { /* not available: plain build */ }
const activeId = config.activeOutfit || 'base';
try { await geocache?.warmOutfit?.(activeId); } catch (e) { console.warn('[avatar] warmOutfit', e); }
const firstTheme = (config.outfitTheme && migrateOutfit(config.outfitTheme)) || resolveOutfit(activeId) || migrateOutfit(themes.base);
let outfitId = config.outfitTheme ? activeId : resolveOutfit(activeId) ? activeId : 'base';
let outfitKey = JSON.stringify(firstTheme);
const tuber = new ToiletTuber(firstTheme);
scene.add(tuber.root);
window.tuber = tuber;
tuber.on((type, d) => {
  const st = settings();
  if (type !== 'sfx' || st.soundsEnabled === false || config.sfx === false) return;
  typeof d === 'string' ? sfx.play(d) : sfx.play(d.type, d);
});

/** Wear a resolved theme (panel's outfitTheme) or an outfit id. Rebuilds only on change. */
function wear(theme, id) {
  if (!theme) return;
  const key = JSON.stringify(theme);
  if (key === outfitKey) return;
  outfitKey = key;
  outfitId = id || theme.id || outfitId;
  tuber.setTheme(theme);
  applyLookLimits();
  snapSoon();
}
function applyOutfit(id) {
  const t = resolveOutfit(id);
  if (!t) return console.warn('[avatar] unknown outfit', id);
  wear(t, id);
}
function applyConfigOutfit() {
  if (config.outfitTheme) wear(migrateOutfit(config.outfitTheme), config.activeOutfit);
  else applyOutfit(config.activeOutfit || 'base');
}

/* ----------------------------------------------------- look limits */
let rigHasLimits = false;
function applyLookLimits() {
  const L = lookCfg();
  const yaw = THREE.MathUtils.degToRad(L.maxYawDeg), pitch = THREE.MathUtils.degToRad(L.maxPitchDeg);
  // Rust rig (privada-core via wasm) or a JS rig that exposes it; otherwise we add the extra turn ourselves
  const fn = tuber.set_look_limits || tuber.setLookLimits || tuber.rust?.set_look_limits;
  rigHasLimits = typeof fn === 'function';
  if (rigHasLimits) fn.call(tuber.rust && tuber.rust.set_look_limits === fn ? tuber.rust : tuber, yaw, pitch);
}

/* ------------------------------------------------------------- scenes */
let follow = true, micOn = true, scale = 1, charPx = BASE_PX, mode = 'window';
function applySettings() {
  const st = settings();
  if (st.restOpen != null) tuber.restOpen = +st.restOpen;
  if (st.soundVolume != null) sfx.volume = +st.soundVolume;   // honoured if sfx.js supports a volume
  sfx.enabled = st.soundsEnabled !== false;
  const r = config.render || {};
  renderer.setPixelRatio(Math.min(devicePixelRatio, r.pixelRatio ?? 1.5));
  const sh = !!r.shadows;
  if (renderer.shadowMap.enabled !== sh) {
    renderer.shadowMap.enabled = sh;
    scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)); });
  }
  setTick();
}

function applyScene(i, { save = false } = {}) {
  if (config.scenes?.length) config.activeScene = clamp(i | 0, 0, config.scenes.length - 1);
  const sc = scene0();
  const st = settings();
  micOn = sc.mic !== false;
  if (sc.outfit) applyOutfit(sc.outfit);
  let solid, color;
  if (OUTPUT) {
    const o = outCfg();
    mode = 'output';
    scale = o.scale ?? 1.3;
    follow = o.follow ?? st.followDefault ?? true;
    solid = o.background !== 'transparent';
    color = o.color || '#00ff00';
  } else {
    mode = sc.mode || 'window';
    scale = sc.scale ?? 1;
    follow = sc.follow ?? st.followDefault ?? true;
    solid = sc.background === 'color' || sc.background === 'chroma';
    color = sc.bgColor || '#00ff00';
    invoke('set_avatar_mode', { mode, alwaysOnTop: !!sc.alwaysOnTop }).catch(() => {});
    if (mode === 'overlay') invoke('set_click_through', { mode: sc.clickThrough || 'auto' }).catch(() => {});
    else invoke('set_click_through', { mode: 'off' }).catch(() => {});
  }
  document.documentElement.style.background = document.body.style.background = solid ? color : 'transparent';
  renderer.setClearColor(solid ? color : 0x000000, solid ? 1 : 0);
  // native window background matches the page, so nothing white can show around the webview
  if (!OUTPUT) invoke('set_window_background', { color: solid ? color : 'transparent' }).catch(() => {});
  document.body.classList.toggle('windowed', mode !== 'overlay');
  document.body.classList.toggle('solidbg', !!solid);
  layout();
  snapSoon();
  if (save) saveSoon();
}

function layout() {
  charPx = BASE_PX * scale;
}
const restPoint = () => {
  const p = OUTPUT ? outCfg() : scene0();
  return [(p.x ?? 0.5) * innerWidth, (p.y ?? 0.82) * innerHeight];
};

let saveTimer = 0;
function saveSoon() {
  if (OUTPUT) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => invoke('save_config', { config }).catch(() => {}), 800);
}

/* -------------------------------------------------- camera placement */
// The character stays at the world origin (FX simulate in world space); the camera moves:
// its distance sets the on-screen size and a view offset puts the feet at (sx, sy).
function placeCamera(sx, sy) {
  const W = innerWidth, H = innerHeight;
  const halfH = (CHAR_H * H) / (2 * charPx);
  const dist = halfH / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  camera.aspect = W / H;
  camera.position.set(0, CENTER_Y, dist);
  camera.lookAt(0, CENTER_Y, 0);
  const cx = sx, cy = sy - (charPx * CENTER_Y) / CHAR_H;
  camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
  camera.updateProjectionMatrix();
}

/* -------------------------------------------------------------- input */
// cursor: { x, y, win?: { x, y, w, h, scale } } in virtual-desktop physical px (all monitors)
const cursor = { x: 0, y: 0, win: null, seen: false };
listen('cursor', (p) => {
  if (!p) return;
  cursor.x = p.x; cursor.y = p.y; cursor.win = p.win || null; cursor.seen = true;
});
if (!isTauri) addEventListener('pointermove', (e) => {
  const dpr = devicePixelRatio || 1;
  cursor.x = (window.screenX + e.clientX) * dpr; cursor.y = (window.screenY + e.clientY) * dpr;
  cursor.win = null; cursor.seen = true;
});

let rustMouth = zeroMouth(), rustMouthT = 0;
listen('mouth', (m) => { rustMouth = m; rustMouthT = performance.now(); });
const fake = new FakeTalk();
let browserMic = null;
async function toggleBrowserMic(on) {
  if (isTauri || OUTPUT) return;
  if (on && !browserMic) {
    const { Mic } = await import('../input/mic.js');
    browserMic = new Mic();
    try { await browserMic.start(); } catch (e) { console.warn('[avatar] mic', e); browserMic = null; }
  } else if (!on && browserMic) { browserMic.stop(); browserMic = null; }
}

/* ------------------------------------------------------------ actions */
function act(action, arg) {
  switch (action) {
    case 'play': tuber.play(arg); break;
    case 'outfit': config.outfitTheme = null; config.activeOutfit = arg; applyOutfit(arg); saveSoon(); break;
    case 'scene': applyScene(+arg, { save: true }); break;
    case 'viseme': fake.hold(arg, 0.6); break;
    case 'say': fake.say(arg || ''); break;
    case 'toggle':
      if (arg === 'clickthrough') {
        if (OUTPUT || mode !== 'overlay') break;
        const sc = scene0();
        sc.clickThrough = { auto: 'on', on: 'off', off: 'auto' }[sc.clickThrough || 'auto'] || 'auto';
        invoke('set_click_through', { mode: sc.clickThrough }).catch(() => {});
      } else if (arg === 'follow') follow = !follow;
      else if (arg === 'mic') {
        micOn = !micOn;
        if (isTauri) { if (!OUTPUT) invoke('set_audio', { audio: { ...config.audio, enabled: micOn } }).catch(() => {}); }
        else toggleBrowserMic(micOn);
      } else if (arg === 'sfx') config.sfx = config.sfx === false;
      break;
    case 'reset': break;   // no throwing anymore: he always sits on the scene point
    case 'open': if (!OUTPUT) invoke('open_control').catch(() => {}); break;
    default: console.warn('[avatar] unknown action', action, arg);
  }
}
listen('hotkey', (p) => { if (p && p.action && config.hotkeysEnabled !== false) act(p.action, p.arg); });
listen('command', (p) => { if (p && p.action) act(p.action, p.arg); });
listen('state', (cfg) => {
  if (!cfg) return;
  const outfitsChanged = JSON.stringify(cfg.outfits || {}) !== JSON.stringify(config.outfits || {});
  config = { ...structuredClone(DEFAULT_CONFIG), ...cfg };
  if (outfitsChanged) resolved.clear();
  applySettings();
  applyConfigOutfit();
  applyScene(config.activeScene);
  applyLookLimits();
});

// right-click opens the panel (window mode: anywhere; overlay: on the character)
const el = renderer.domElement;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
el.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (OUTPUT) return;
  if (mode === 'overlay') {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.intersectObject(tuber.body, true).length) return;
  }
  invoke('open_control').catch(() => {});
});

/* ---------------------------------------- hit rect (overlay click-through) */
const box = new THREE.Box3(), tmp = new THREE.Box3(), corner = new THREE.Vector3();
function computeHitRect() {
  box.makeEmpty();
  for (const c of tuber.root.children) if (c !== tuber.fx && c.visible) { tmp.setFromObject(c); box.union(tmp); }
  if (box.isEmpty()) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
    const px = ((corner.x + 1) / 2) * innerWidth, py = ((1 - corner.y) / 2) * innerHeight;
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  const pad = 8;
  return { x: Math.round(x0 - pad), y: Math.round(y0 - pad), w: Math.round(x1 - x0 + 2 * pad), h: Math.round(y1 - y0 + 2 * pad) };
}
let hitRect = null, frames = 0, fps = 0, fpsT = performance.now();
if (!OUTPUT) setInterval(() => {
  if (mode !== 'overlay') { if (hitRect) { hitRect = null; invoke('set_hit_rect', { rect: null }).catch(() => {}); } return; }
  hitRect = computeHitRect();
  invoke('set_hit_rect', { rect: hitRect }).catch(() => {});
}, 100);
if (!OUTPUT) setInterval(() => {
  emit('avatar-status', { fps, hitRect, outfitId, sceneId: config.activeScene, mode, follow, mic: micOn, rigHasLimits });
}, 250);

/* --------------------------------------------------------------- look */
// Vector from the character's head ON SCREEN (window rect + projected head) to the global
// cursor, mapped with a saturating curve so far monitors still give strong, smooth turns.
const head = new THREE.Vector3();
function computeLook() {
  tuber.head.getWorldPosition(head).project(camera);
  const hxL = ((head.x + 1) / 2) * innerWidth, hyL = ((1 - head.y) / 2) * innerHeight;   // logical px in window
  let hx, hy;
  const w = cursor.win;
  if (w) { const s = w.scale || devicePixelRatio || 1; hx = w.x + hxL * s; hy = w.y + hyL * s; }
  else { const s = devicePixelRatio || 1; hx = (window.screenX + hxL) * s; hy = (window.screenY + hyL) * s; }
  const L = lookCfg(), sens = settings().lookSensitivity ?? 1;
  const dx = cursor.x - hx, dy = cursor.y - hy;
  return {
    x: Math.tanh(dx / L.reachPx) * L.range * sens,
    y: Math.tanh(-dy / (L.reachPx * 0.8)) * L.range * sens,
  };
}
let remoteLook = null, remoteMouth = null, remoteT = 0, poseT = 0;
if (OUTPUT) listen('avatar-pose', (p) => { if (p && p.look) { remoteLook = p.look; remoteMouth = p.mouth || null; remoteT = performance.now(); } });

/* ------------------------------------------------- panel preview mirror */
// The control panel shows THIS window: it sends `preview-want` {on, fps, width} as a heartbeat
// (expires after 5 s) and `preview-snap` for an immediate frame. Zero cost when nobody asks.
const pv = { on: false, fps: 8, width: 360, until: 0, last: 0, pending: false, snap: false, seq: 0, canvas: null, ctx: null, checker: null };
listen('preview-want', (p) => {
  if (!p) return;
  pv.on = !!p.on;
  pv.fps = clamp(+p.fps || 8, 1, 30);
  pv.width = clamp(+p.width || 360, 64, 1280) | 0;
  pv.until = performance.now() + 5000;
});
listen('preview-snap', () => { pv.snap = true; pv.until = Math.max(pv.until, performance.now() + 5000); });
function checkerPattern(ctx) {
  const c = new OffscreenCanvas(16, 16), g = c.getContext('2d');
  g.fillStyle = '#2a2b31'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#34353c'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  return ctx.createPattern(c, 'repeat');
}
function capturePreview(now) {
  // called right after a render (the WebGL buffer is still valid in this task)
  const want = (pv.on || pv.snap) && now < pv.until;
  if (!want || pv.pending || typeof OffscreenCanvas === 'undefined') return;
  if (!pv.snap && now - pv.last < 1000 / pv.fps) return;
  pv.snap = false; pv.last = now; pv.pending = true;
  const src = renderer.domElement;
  const w = pv.width, h = Math.max(1, Math.round((w * src.height) / Math.max(1, src.width)));
  if (!pv.canvas || pv.canvas.width !== w || pv.canvas.height !== h) {
    pv.canvas = new OffscreenCanvas(w, h);
    pv.ctx = pv.canvas.getContext('2d');
    pv.checker = checkerPattern(pv.ctx);
  }
  const ctx = pv.ctx;
  const bg = document.body.style.background;
  if (!bg || bg === 'transparent') { ctx.fillStyle = pv.checker; ctx.fillRect(0, 0, w, h); }
  else { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(src, 0, 0, w, h);
  const seq = ++pv.seq;
  pv.canvas.convertToBlob({ type: 'image/webp', quality: 0.75 })
    .then((b) => (b && b.type === 'image/webp' ? b : pv.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })))
    .then((b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }))
    .then((data) => emit('preview-frame', { data, w, h, seq }))
    .catch(() => {})
    .finally(() => { pv.pending = false; });
}
// after an outfit/scene change has rendered, push a fresh frame
const snapSoon = () => { pv.snap = true; };

/* ----------------------------------------- idle preload of other outfits */
async function preloadOutfits() {
  const mod = geocache;
  if (!mod) return;
  const fn = mod.preload || mod.preloadTheme;
  if (typeof fn !== 'function') return;
  const ids = [...Object.keys(presetRaw), ...Object.keys(themes)].filter((id) => id !== outfitId);
  const idle = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 8 }), 50));
  const next = () => {
    const id = ids.shift();
    if (!id) return;
    idle(async () => {
      try { const t = resolveOutfit(id); if (t) await fn.call(mod, t); }
      catch (e) { console.warn('[avatar] preload', id, e); }
      next();   // one item at a time
    });
  };
  next();
}

/* ------------------------------------------------ outfit thumbnails */
// Generated at load (people keep creating presets) with THIS window's GPU renderer: each missing
// thumbnail is rendered into a 256x256 corner of the default framebuffer (same tone mapping and
// colour pipeline as the live view, no second WebGL context), copied out in the same task, then
// overwritten by the normal frame. Cached in Rust: thumb_get / thumb_put (key below).
// same key as the panel (ui/src/lib/thumbs.ts): outfitThumbKey(resolvedTheme) -> "thumb_o-<hash>_v<n>"
const thumbKey = (id, theme) => outfitThumbKey(theme);
const TH = 256;
const th = { queue: [], phase: false, phaseT0: 0, total: 0, done: 0, keys: [], cam: new THREE.PerspectiveCamera(26, 1, 0.05, 50), out: null };
function allOutfits() {
  // resolve exactly like the panel (web/src/app/outfits.js makeResolver)
  const { raw, resolve } = makeResolver({ themes, presets: presetRaw, outfits: config.outfits || {} });
  const ids = new Set([...Object.keys(themes), ...Object.keys(presetRaw), ...Object.keys(config.outfits || {})]);
  const list = [], seen = new Set();
  for (const id of ids) {
    if (!raw(id)) continue;
    const t = resolve(id), key = thumbKey(id, t);
    if (seen.has(key)) continue;            // same look under two ids -> one thumbnail
    seen.add(key);
    list.push({ id, theme: t });
  }
  for (const id of listAccessories()) if (id !== 'glb') list.push({ id, acc: true });
  return list;
}
async function queueMissing(items) {
  const checks = await Promise.all(items.map(async (it) => {
    const key = it.acc ? accThumbKey(it.id) : thumbKey(it.id, it.theme);
    try { const b = await invoke('thumb_get', { key }); return b && (b.byteLength ?? b.length) > 0 ? null : { ...it, key }; }
    catch { return { ...it, key }; }
  }));
  const miss = checks.filter(Boolean).filter((m) => !th.queue.some((q) => q.key === m.key));
  th.queue.push(...miss);
  return miss.length;
}
// Render one thumbnail synchronously into the canvas corner and start its async encode/upload.
function renderOneThumb() {
  const it = th.queue.shift();
  if (!it) return false;
  let tb = null, accMats = null;
  try {
    if (it.acc) {
      // accessory alone, base-theme materials, same lights/camera pipeline
      accMats = new MaterialLib(themes.base.materials);
      const obj = buildAccessory({ THREE, mats: accMats, theme: themes.base, dim: DIM }, { id: it.id, params: {} });
      if (!obj) throw new Error('unknown accessory');
      const g = new THREE.Group(); g.add(obj);
      tb = { root: g, body: g, mats: accMats };
      g.updateMatrixWorld(true);
    } else {
      tb = new ToiletTuber(it.theme);
      for (let i = 0; i < 8; i++) tb.update(1 / 30, { look: { x: 0.25, y: 0.05 }, mouth: zeroMouth() });
      tb.root.updateMatrixWorld(true);
    }
    // frame on the BODY only: fx InstancedMesh matrices (water drops/foam) are non-finite and
    // Box3.setFromObject ignores `visible`, which made the whole box NaN (blank thumbnails)
    const box = new THREE.Box3().setFromObject(tb.body);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || !Number.isFinite(sphere.center.x + sphere.center.y + sphere.center.z) || sphere.radius <= 0) {
      throw new Error('non-finite bounds');
    }
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const r = Math.max(sz.x, sz.y, sz.z) * 0.62;
    const d = r / Math.tan(THREE.MathUtils.degToRad(13));
    th.cam.position.set(c.x + d * 0.32, c.y + d * 0.12, c.z + d * 0.94);
    th.cam.lookAt(c);
    th.cam.clearViewOffset();
    th.cam.updateProjectionMatrix();

    const pr = renderer.getPixelRatio();
    const S = TH / pr;                                         // logical px -> exactly 256 device px
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    tuber.root.visible = false;
    scene.add(tb.root);
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, S, S); renderer.setScissor(0, 0, S, S);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(scene, th.cam);
    if (!th.out) { th.out = new OffscreenCanvas(TH, TH); th.outCtx = th.out.getContext('2d'); }
    const cv = renderer.domElement;
    th.outCtx.clearRect(0, 0, TH, TH);
    th.outCtx.drawImage(cv, 0, cv.height - TH, TH, TH, 0, 0, TH, TH);   // GL viewport origin = bottom-left
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    renderer.setClearColor(prevClear, prevAlpha);
    scene.remove(tb.root);
    tuber.root.visible = true;
    const key = it.key;
    th.out.convertToBlob({ type: 'image/webp', quality: 0.9 })
      .then((b) => b.arrayBuffer())
      .then((buf) => invokeRaw('thumb_put', new Uint8Array(buf), { 'x-key': key }))
      .then(() => { th.keys.push(key); })
      .catch((e) => console.warn('[avatar] thumb_put', key, e));
  } catch (e) {
    console.warn('[avatar] thumbnail failed', it.id, e);
    scene.remove(tb?.root); tuber.root.visible = true;
    renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
  } finally {
    if (tb) { tb.root.traverse((o) => o.geometry?.dispose?.()); tb.mats?.dispose?.(); }
  }
  th.done++;
  return true;
}
function flushThumbKeys() {
  setTimeout(() => {   // give the last encodes a moment
    if (th.keys.length) { emit('thumbs-updated', { keys: th.keys.splice(0) }); }
  }, 400);
}
// panel asks for new/edited outfits
listen('thumbs-request', async (p) => {
  const items = (p?.outfits || []).map((t, i) => ({ id: t.id || `custom-${i}`, theme: migrateOutfit(t.extends ? mergeTheme(resolveOutfit(t.extends) || themes.base, t) : t) }));
  if (await queueMissing(items)) idleThumbs();
});
// after the splash: one thumbnail per idle slot, rendered right before a normal frame (no flash)
let idleScheduled = false;
function idleThumbs() {
  if (idleScheduled || !th.queue.length) return;
  idleScheduled = true;
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 60));
  idle(() => { idleScheduled = false; th.wantOne = true; });
}

/* --------------------------------------------------------------- loop */
let last = performance.now(), lastRaf = performance.now(), lastFrame = 0;
function frame(now) {
  const minDt = 1000 / clamp(config.render?.fps ?? 60, 10, 240) - 1;
  if (now - lastFrame < minDt) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; lastFrame = now;

  const [sx, sy] = restPoint();
  placeCamera(sx, sy);

  let look = { x: 0, y: 0 };
  if (OUTPUT && remoteLook && now - remoteT < 500) look = follow ? remoteLook : look;
  else if (follow && cursor.seen) look = computeLook();

  let mic = null;
  if (isTauri) { if (micOn && now - rustMouthT < 500) mic = rustMouth; }
  else if (browserMic) mic = browserMic.update(dt);
  else if (OUTPUT && remoteMouth && now - remoteT < 500) mic = remoteMouth;
  const rawMouth = maxMouth(mic, fake.update(dt));
  const mouth = shapeMouth(rawMouth);

  if (settings().autoBlink === false) tuber.blinkTimer = 1e9;
  else if (tuber.blinkTimer > 1e8) tuber.blinkTimer = 2;

  // the JS rig clamps look to [-1, 1]; extra range beyond it is added after the update
  const lx = clamp(look.x, -1, 1), ly = clamp(look.y, -1, 1);
  tuber.update(dt, { look: { x: lx, y: ly }, mouth });
  if (!rigHasLimits) {
    const L = lookCfg();
    const yaw = THREE.MathUtils.degToRad(L.maxYawDeg), pitch = THREE.MathUtils.degToRad(L.maxPitchDeg);
    smoothExtra.y += ((Math.max(0, yaw - RIG_YAW) * lx) - smoothExtra.y) * Math.min(1, dt * 6);
    smoothExtra.x += ((Math.max(0, pitch - RIG_PITCH) * ly) - smoothExtra.x) * Math.min(1, dt * 6);
    tuber.body.rotation.y += smoothExtra.y * 0.6;
    tuber.head.rotation.y += smoothExtra.y * 0.4;
    tuber.head.rotation.x -= smoothExtra.x;
  }
  if (!OUTPUT && now - poseT > 33) { poseT = now; emit('avatar-pose', { look, mouth: isTauri ? null : rawMouth }); }

  // thumbnails: during the splash phase one per frame (window still hidden), afterwards at idle
  if (th.phase) {
    if (th.queue.length && now - th.phaseT0 < 6000) {
      renderOneThumb();
      loading(0.75 + 0.25 * (th.done / Math.max(1, th.total)), `gerando miniaturas ${th.done}/${th.total}`);
    } else {
      th.phase = false;
      loading(1.0, 'pronto!');
      invoke('page_ready', { label: 'avatar' }).catch(() => {});
      flushThumbKeys();
      preloadOutfits();
      idleThumbs();   // anything left after the 6 s cap continues after showing
    }
  } else if (th.wantOne) {
    th.wantOne = false;
    if (renderOneThumb()) { if (th.queue.length) idleThumbs(); else flushThumbKeys(); }
  }
  stage.render(dt, !!config.render?.ao);
  if (pv.until) capturePreview(now);
  if (!firstFrame) {
    firstFrame = true;
    // first real frame is on the (hidden) window: generate missing thumbnails, then show it
    th.phase = true; th.phaseT0 = now;
    queueMissing(allOutfits()).then((n) => { th.total = n; th.done = 0; th.phaseT0 = performance.now(); if (!n) th.queue.length = 0; })
      .catch(() => { th.queue.length = 0; });
  }
  frames++;
  if (now - fpsT > 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
}
const smoothExtra = { x: 0, y: 0 };
// streamer's mouth limits: settings.mouth = { maxOpen (0.65), curve (1.6) }
//   open' = maxOpen * open^curve ; round/wide/sib scaled by maxOpen ; closed unchanged
function shapeMouth(m) {
  const cfg = settings().mouth || {};
  const maxOpen = clamp(Number.isFinite(+cfg.maxOpen) ? +cfg.maxOpen : 0.65, 0, 1.5);
  const curve = clamp(Number.isFinite(+cfg.curve) && +cfg.curve > 0 ? +cfg.curve : 1.6, 0.2, 5);
  return {
    open: maxOpen * Math.pow(clamp(m.open || 0, 0, 1), curve),
    round: (m.round || 0) * maxOpen,
    wide: (m.wide || 0) * maxOpen,
    sib: (m.sib || 0) * maxOpen,
    closed: m.closed || 0,
    // extended channels from the rig (corners / jaw / upper-lip raise) pass through, scaled like the shape
    cornerL: (m.cornerL || 0) * maxOpen,
    cornerR: (m.cornerR || 0) * maxOpen,
    jawSide: (m.jawSide || 0) * maxOpen,
    jawFwd: (m.jawFwd || 0) * maxOpen,
    upperRaise: (m.upperRaise || 0) * maxOpen,
  };
}
let firstFrame = false;

// rAF normally; a worker ticker takes over when hidden/occluded (OBS captures it behind other
// windows and rAF pauses then). Never pauses on blur.
renderer.setAnimationLoop(() => { lastRaf = performance.now(); frame(lastRaf); });
const tickSrc = `let id=0;onmessage=(e)=>{clearInterval(id);id=setInterval(()=>postMessage(0),e.data)}`;
const ticker = new Worker(URL.createObjectURL(new Blob([tickSrc], { type: 'text/javascript' })));
function setTick() { ticker.postMessage(Math.max(4, Math.floor(1000 / clamp(config.render?.fps ?? 60, 10, 240)))); }
ticker.onmessage = () => {
  const now = performance.now();
  if (document.visibilityState !== 'visible' || now - lastRaf > 100) frame(now);
};

function fitCanvas() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, config.render?.pixelRatio ?? 1.5));
  renderer.setSize(innerWidth, innerHeight, false);       // CSS (100vw/100vh) owns the element size
  stage.composer?.setPixelRatio?.(Math.min(devicePixelRatio, config.render?.pixelRatio ?? 1.5));
  stage.composer?.setSize?.(innerWidth, innerHeight);
  layout();
}
addEventListener('resize', fitCanvas);
(function watchDpr() {   // devicePixelRatio changes (moving between monitors with different scaling)
  const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
  mq.addEventListener('change', () => { fitCanvas(); watchDpr(); }, { once: true });
})();
// invisible edge/corner zones resize the borderless window (Rust: start_resize)
for (const z of document.querySelectorAll('.rz')) {
  z.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || mode === 'overlay' || OUTPUT) return;
    e.preventDefault();
    invoke('start_resize', { direction: z.dataset.dir }).catch(() => {});
  });
}

loading(0.7, 'montando a privada…');
fitCanvas();
applySettings();
applyConfigOutfit();
applyScene(config.activeScene);
applyLookLimits();
window.avatar = { output: OUTPUT, act, config: () => config, applyScene, applyOutfit, computeLook };
