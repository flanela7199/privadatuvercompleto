// Avatar window: the vtuber character alone on a transparent (or chroma) canvas.
// Exactly the same model as the preview (ToiletTuber + themes + presets + accessories).
// Logic that lives in Rust: global cursor, mic -> mouth, hotkeys, click-through (via bridge),
// drag/throw physics (Toss from web/pkg when available; JS fallback with the same API).
import * as THREE from 'three';
import { createStage } from '../stage.js';
import { ToiletTuber } from '../rig/ToiletTuber.js';
import { loadThemes, mergeTheme } from '../themes.js';
import { FakeTalk, maxMouth, zeroMouth } from '../input/visemes.js';
import { sfx } from '../audio/sfx.js';
import '../accessories/extra.js';
import '../accessories/glb.js';
import { isTauri, invoke, listen, emit } from './bridge.js';
import { DEFAULT_CONFIG } from './defaults.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// ?output=1 -> OBS output window (label `output`): mirrors the overlay (outfit, actions, mouth, look)
// with its own background/framing from config.output; no click-through, hit rect or mouse play.
const OUTPUT = new URLSearchParams(location.search).has('output');
const OUTPUT_DEFAULTS = { background: 'chroma', color: '#00ff00', scale: 1.3, x: 0.5, y: 0.82, follow: true };
const outCfg = () => ({ ...OUTPUT_DEFAULTS, ...(config.output || {}) });
const BASE_PX = 380;      // character height on screen (logical px) at scene scale 1
const CHAR_H = 1.8;       // model height in world units (floor -> crown)
const CENTER_Y = 0.85;    // model "center of mass" height
const FOV = 20;

/* --------------------------------------------------------------- config */
let config = (await invoke('load_config').catch(() => null)) || structuredClone(DEFAULT_CONFIG);
config = { ...structuredClone(DEFAULT_CONFIG), ...config };
const scene0 = () => config.scenes[clamp(config.activeScene | 0, 0, config.scenes.length - 1)] || DEFAULT_CONFIG.scenes[0];

/* ---------------------------------------------------------------- stage */
const stage = createStage({
  pixelRatio: Math.min(devicePixelRatio, config.render?.pixelRatio ?? 1.5),
  floor: false, contact: false, shadows: false, preserveDrawingBuffer: false,
});
const { renderer, scene, camera } = stage;
camera.fov = FOV;
camera.near = 0.1; camera.far = 200;
renderer.setClearColor(0x000000, 0);

/* ------------------------------------------------------------- outfits */
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
function resolveOutfit(id, seen = new Set()) {
  if (!id) return null;
  if (resolved.has(id)) return resolved.get(id);
  const t = config.outfits?.[id] || presetRaw[id] || themes[id];
  if (!t) return null;
  let out = t;
  if (t.extends && !seen.has(id)) {
    seen.add(id);
    const base = resolveOutfit(t.extends, seen) || themes.base;
    out = mergeTheme(base, t);
  }
  resolved.set(id, out);
  return out;
}

const tuber = new ToiletTuber(resolveOutfit(config.activeOutfit) || themes.base);
scene.add(tuber.root);
let outfitId = resolveOutfit(config.activeOutfit) ? config.activeOutfit : 'base';
window.tuber = tuber;
tuber.on((type, d) => {
  if (type !== 'sfx' || config.sfx === false) return;
  typeof d === 'string' ? sfx.play(d) : sfx.play(d.type, d);
});

function applyOutfit(id) {
  const t = resolveOutfit(id);
  if (!t) return console.warn('[avatar] unknown outfit', id);
  outfitId = id;
  tuber.setTheme(t);
}

/* ---------------------------------------------------------------- toss */
// JS fallback with the same API as the Rust Toss (screen px, y down, position = the feet).
class JsToss {
  constructor() {
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.angle = 0; this.spin = 0; this.squash = 0; this.sv = 0;
    this.restX = 0; this.restY = 0; this.w = 100; this.h = 100; this.state = 'rest'; this.t = 0;
    this.hist = []; this.offX = 0; this.offY = 0; this.impact = 0; this.hop = null;
  }
  set_rest(x, y) { this.restX = x; this.restY = y; if (this.state === 'rest') { this.x = x; this.y = y; } }
  set_size(w, h) { this.w = w; this.h = h; }
  reset() { this.state = 'rest'; this.x = this.restX; this.y = this.restY; this.vx = this.vy = this.spin = 0; this.angle = 0; }
  grab(x, y) { this.state = 'held'; this.offX = this.x - x; this.offY = this.y - y; this.hist = []; this.spin = 0; }
  drag(x, y, t) {
    this.x = x + this.offX; this.y = y + this.offY;
    this.hist.push([this.x, this.y, t]);
    while (this.hist.length > 6) this.hist.shift();
  }
  release(t) {
    const h = this.hist;
    if (h.length >= 2) {
      const a = h[0], b = h[h.length - 1], dt = Math.max(0.008, b[2] - a[2]);
      this.vx = clamp((b[0] - a[0]) / dt, -4500, 4500);
      this.vy = clamp((b[1] - a[1]) / dt, -4500, 4500);
    } else { this.vx = 0; this.vy = 0; }
    this.spin = this.vx * 0.004;
    this.state = 'fly';
  }
  is_held() { return this.state === 'held'; }
  is_busy() { return this.state !== 'rest'; }
  take_impact() { const i = this.impact; this.impact = 0; return i; }
  update(dt, W, H) {
    const halfW = this.w * 0.5, top = this.h;
    this.sv += (-this.squash * 300 - this.sv * 14) * dt; this.squash += this.sv * dt;
    if (this.state === 'held') {
      const h = this.hist, vx = h.length >= 2 ? (h[h.length - 1][0] - h[0][0]) / Math.max(0.01, h[h.length - 1][2] - h[0][2]) : 0;
      this.angle += (clamp(-vx * 0.0004, -0.6, 0.6) - this.angle) * Math.min(1, dt * 10);  // dangles while dragged
    } else if (this.state === 'fly') {
      this.vy += 2600 * dt;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.angle += this.spin * dt;
      const hit = (v) => { this.impact = Math.max(this.impact, Math.abs(v)); this.squash = clamp(Math.abs(v) / 6000, 0, 0.25); };
      if (this.x < halfW) { this.x = halfW; hit(this.vx); this.vx = -this.vx * 0.55; this.spin = -this.spin * 0.7; }
      if (this.x > W - halfW) { this.x = W - halfW; hit(this.vx); this.vx = -this.vx * 0.55; this.spin = -this.spin * 0.7; }
      if (this.y < top) { this.y = top; hit(this.vy); this.vy = -this.vy * 0.4; }
      if (this.y > H) {
        this.y = H;
        if (Math.abs(this.vy) > 250) hit(this.vy);
        this.vy = -this.vy * 0.45; this.vx *= 0.8; this.spin *= 0.6;
        if (Math.abs(this.vy) < 220) { this.vy = 0; this.state = 'ground'; this.t = 0; }
      }
    } else if (this.state === 'ground') {
      this.t += dt;
      this.vx *= Math.exp(-dt * 6); this.x += this.vx * dt;
      const up = Math.round(this.angle / (Math.PI * 2)) * Math.PI * 2;   // roll upright
      this.angle += (up - this.angle) * Math.min(1, dt * 6);
      if (this.t > 0.7) { this.state = 'hop'; this.hop = { x0: this.x, y0: this.y, t: 0, a0: this.angle - up }; }
    } else if (this.state === 'hop') {
      const hp = this.hop; hp.t += dt;
      const u = clamp(hp.t / 0.75, 0, 1), e = u * u * (3 - 2 * u);
      this.x = hp.x0 + (this.restX - hp.x0) * e;
      this.y = hp.y0 + (this.restY - hp.y0) * e - Math.sin(u * Math.PI) * 140;
      this.angle = hp.a0 * (1 - e);
      if (u >= 1) { this.state = 'rest'; this.angle = 0; this.squash = 0.12; this.impact = 900; }
    } else {
      this.x += (this.restX - this.x) * Math.min(1, dt * 8);
      this.y += (this.restY - this.y) * Math.min(1, dt * 8);
    }
    return [this.x, this.y, this.angle, this.squash];
  }
}

let toss = new JsToss();
let tossIsRust = false;
try {
  const pkg = await import('../../pkg/privada_wasm.js');
  await pkg.default();
  if (pkg.Toss) { toss = new pkg.Toss(); tossIsRust = true; }
} catch { /* web/pkg not built yet -> JS fallback */ }
const call = (name, ...a) => (typeof toss[name] === 'function' ? toss[name](...a) : undefined);

/* -------------------------------------------------------------- scenes */
let follow = true, micOn = true, clickMode = 'auto', scale = 1;
let charPx = BASE_PX;
function applyScene(i, { save = false } = {}) {
  config.activeScene = clamp(i | 0, 0, config.scenes.length - 1);
  const sc = scene0();
  micOn = sc.mic !== false;
  if (sc.outfit) applyOutfit(sc.outfit);
  let solid, color;
  if (OUTPUT) {
    const o = outCfg();
    scale = o.scale ?? 1.3;
    follow = o.follow !== false;
    solid = o.background !== 'transparent';
    color = o.background === 'chroma' ? o.color || '#00ff00' : o.color || '#00ff00';
  } else {
    scale = sc.scale ?? 1;
    follow = sc.follow !== false;
    clickMode = sc.clickThrough || 'auto';
    solid = sc.background === 'color';
    color = sc.bgColor || '#00ff00';
    invoke('set_avatar_mode', { mode: sc.mode || 'overlay', alwaysOnTop: !!sc.alwaysOnTop }).catch(() => {});
    invoke('set_click_through', { mode: clickMode }).catch(() => {});
  }
  document.documentElement.style.background = document.body.style.background = solid ? color : 'transparent';
  renderer.setClearColor(solid ? color : 0x000000, solid ? 1 : 0);
  layout();
  call('reset');
  if (save) saveSoon();
}

function layout() {
  const sc = OUTPUT ? outCfg() : scene0();
  charPx = BASE_PX * scale;
  call('set_size', charPx * 0.62, charPx);
  call('set_rest', (sc.x ?? 0.5) * innerWidth, (sc.y ?? 0.8) * innerHeight);
}

let saveTimer = 0;
function saveSoon() {
  if (OUTPUT) return;   // only the overlay writes the config
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => invoke('save_config', { config }).catch(() => {}), 800);
}

/* -------------------------------------------------- camera placement */
// The character stays at the world origin (FX are simulated in world space), the camera
// moves: distance sets the on-screen size, a view offset places the feet at (sx, sy).
function placeCamera(sx, sy) {
  const W = innerWidth, H = innerHeight;
  const halfH = (CHAR_H * H) / (2 * charPx);              // world half-height visible at z=0
  const dist = halfH / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  camera.aspect = W / H;
  camera.position.set(0, CENTER_Y, dist);
  camera.lookAt(0, CENTER_Y, 0);
  // center of the character should land at (sx, sy - charPx * CENTER_Y / CHAR_H)
  const cx = sx, cy = sy - (charPx * CENTER_Y) / CHAR_H;
  camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
  camera.updateProjectionMatrix();
}

/* -------------------------------------------------------------- input */
const cursor = { x: innerWidth / 2, y: innerHeight / 2, seen: false };
listen('cursor', (p) => {
  // global physical px -> this window's logical px (works while unfocused / behind other windows)
  const dpr = devicePixelRatio || 1;
  cursor.x = p.x / dpr - (window.screenX || 0);
  cursor.y = p.y / dpr - (window.screenY || 0);
  cursor.seen = true;
});
if (!isTauri) addEventListener('pointermove', (e) => { cursor.x = e.clientX; cursor.y = e.clientY; cursor.seen = true; });

let rustMouth = zeroMouth(), rustMouthT = 0;
listen('mouth', (m) => { rustMouth = m; rustMouthT = performance.now(); });
const fake = new FakeTalk();
let browserMic = null;
async function toggleBrowserMic(on) {
  if (isTauri) return;
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
    case 'outfit': applyOutfit(arg); config.activeOutfit = arg; saveSoon(); break;
    case 'scene': applyScene(+arg, { save: true }); break;
    case 'viseme': fake.hold(arg, 0.6); break;
    case 'say': fake.say(arg || ''); break;
    case 'toggle':
      if (arg === 'clickthrough') {
        if (OUTPUT) break;
        clickMode = { auto: 'on', on: 'off', off: 'auto' }[clickMode] || 'auto';
        invoke('set_click_through', { mode: clickMode }).catch(() => {});
      } else if (arg === 'follow') follow = !follow;
      else if (arg === 'mic') {
        micOn = !micOn;
        if (isTauri) { if (!OUTPUT) invoke('set_audio', { audio: { ...config.audio, enabled: micOn } }).catch(() => {}); }
        else if (!OUTPUT) toggleBrowserMic(micOn);
      } else if (arg === 'sfx') config.sfx = config.sfx === false;
      break;
    case 'reset': call('reset'); break;
    case 'open': if (!OUTPUT) invoke('open_control').catch(() => {}); break;
    default: console.warn('[avatar] unknown action', action, arg);
  }
}
const onAction = (p) => { if (p && p.action) act(p.action, p.arg); };
listen('hotkey', onAction);
listen('command', onAction);
listen('state', (cfg) => {
  if (!cfg) return;
  const outfitChanged = cfg.activeOutfit !== config.activeOutfit || JSON.stringify(cfg.outfits || {}) !== JSON.stringify(config.outfits || {});
  config = { ...structuredClone(DEFAULT_CONFIG), ...cfg };
  resolved.clear();
  if (outfitChanged) applyOutfit(config.activeOutfit);
  applyScene(config.activeScene);
  if (config.render?.pixelRatio) renderer.setPixelRatio(Math.min(devicePixelRatio, config.render.pixelRatio));
});

/* ------------------------------------------------------- mouse play */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function hitCharacter(x, y) {
  const r = hitRect;
  if (!r || x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) return false;
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObject(tuber.body, true).length > 0;
}
let down = null, hoverT = 0;
const el = renderer.domElement;
el.addEventListener('pointerdown', (e) => {
  if (OUTPUT || e.button !== 0 || !hitCharacter(e.clientX, e.clientY)) return;
  el.setPointerCapture(e.pointerId);
  down = { x: e.clientX, y: e.clientY, t: performance.now() / 1000, dragging: false };
});
el.addEventListener('pointermove', (e) => {
  if (OUTPUT) return;
  const tnow = performance.now();
  if (!down && tnow - hoverT > 90) { hoverT = tnow; document.body.classList.toggle('grab', !!hitRect && hitCharacter(e.clientX, e.clientY)); }
  if (!down) return;
  const t = performance.now() / 1000;
  if (!down.dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
    down.dragging = true;
    call('grab', down.x, down.y);
    document.body.classList.add('dragging');
  }
  if (down.dragging) call('drag', e.clientX, e.clientY, t);
});
el.addEventListener('pointerup', (e) => {
  if (!down) return;
  if (down.dragging) { call('release', performance.now() / 1000); tuber.emit('sfx', 'whoosh'); }
  else poke();
  document.body.classList.remove('dragging');
  down = null;
});
el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!OUTPUT && hitCharacter(e.clientX, e.clientY)) invoke('open_control').catch(() => {}); });
el.addEventListener('wheel', (e) => {
  if (OUTPUT || !hitCharacter(e.clientX, e.clientY)) return;
  e.preventDefault();
  scale = clamp(scale * Math.pow(1.1, -e.deltaY / 100), 0.3, 4);
  scene0().scale = +scale.toFixed(3);
  layout();
  saveSoon();
}, { passive: false });

const POKES = ['blink', 'jump', 'no', 'gargle', 'jump'];
function poke() {
  emit('command', { action: 'play', arg: POKES[(Math.random() * POKES.length) | 0] }); // both windows
  pokeSquash = 0.12;
}
let pokeSquash = 0, dizzy = 0;

/* -------------------------------------------------- hit rect + status */
let hitRect = null;
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
let frames = 0, fps = 0, fpsT = performance.now();
if (!OUTPUT) setInterval(() => {
  hitRect = computeHitRect();
  invoke('set_hit_rect', { rect: hitRect }).catch(() => {});
}, 100);
if (!OUTPUT) setInterval(() => {
  emit('avatar-status', { fps, hitRect, outfitId, sceneId: config.activeScene, clickThrough: clickMode, tossIsRust, follow, mic: micOn });
}, 250);

/* --------------------------------------------------------------- loop */
const head = new THREE.Vector3();
let remoteLook = null, remoteMouth = null, remoteLookT = 0, poseT = 0;
if (OUTPUT) listen('avatar-pose', (p) => { if (p && p.look) { remoteLook = p.look; remoteMouth = p.mouth || null; remoteLookT = performance.now(); } });
let last = performance.now(), lastRaf = performance.now(), lastFrame = 0;
function frame(now) {
  const minDt = 1000 / clamp(config.render?.fps ?? 60, 10, 240) - 1;
  if (now - lastFrame < minDt) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; lastFrame = now;

  // physics (Rust Toss if built, JS fallback otherwise)
  let [fx, fy, angle, squash] = toss.update(dt, innerWidth, innerHeight);
  if (OUTPUT) { const o = outCfg(); fx = (o.x ?? 0.5) * innerWidth; fy = (o.y ?? 0.82) * innerHeight; angle = 0; squash = 0; }
  const impact = OUTPUT ? 0 : call('take_impact') || 0;
  if (impact > 1400) { dizzy = Math.min(2.2, 0.6 + impact / 2500); tuber.emit('sfx', { type: 'clack', v: Math.min(9, impact / 400) }); }
  placeCamera(fx, fy);

  // look: global mouse relative to the head on screen (or dizzy spirals after a hard hit)
  let look = { x: 0, y: 0 };
  if (OUTPUT && remoteLook && now - remoteLookT < 500) {
    look = follow ? remoteLook : { x: 0, y: 0 };
  } else if (dizzy > 0) {
    dizzy -= dt;
    const t = now / 1000;
    look = { x: Math.cos(t * 13) * 0.95, y: Math.sin(t * 13) * 0.95 };
  } else if (follow && cursor.seen) {
    tuber.head.getWorldPosition(head).project(camera);
    const hx = ((head.x + 1) / 2) * innerWidth, hy = ((1 - head.y) / 2) * innerHeight;
    look = { x: clamp((cursor.x - hx) / (charPx * 1.1), -1, 1), y: clamp(-(cursor.y - hy) / (charPx * 0.9), -1, 1) };
  }

  // mouth: Rust mic (Tauri) or browser mic, plus viseme tests
  let mic = null;
  if (isTauri) { if (micOn && now - rustMouthT < 500) mic = rustMouth; }
  else if (browserMic) mic = browserMic.update(dt);
  else if (OUTPUT && remoteMouth && now - remoteLookT < 500) mic = remoteMouth;   // browser mode: mirror the overlay's mouth
  const mouth = maxMouth(mic, fake.update(dt));

  tuber.update(dt, { look, mouth });
  if (!OUTPUT && now - poseT > 33) { poseT = now; emit('avatar-pose', { look, mouth: isTauri ? null : mouth }); }   // ~30 Hz to the OBS output

  // spin + squash from the toss, applied around the center of mass after the rig update
  pokeSquash *= Math.exp(-dt * 8);
  const sq = clamp(squash + pokeSquash, -0.3, 0.3);
  const b = tuber.body;
  if (angle) {
    b.rotation.z += angle;
    b.position.x += CENTER_Y * Math.sin(angle);
    b.position.y += CENTER_Y - CENTER_Y * Math.cos(angle);
  }
  if (sq) b.scale.set(b.scale.x * (1 + sq * 0.5), b.scale.y * (1 - sq), b.scale.z * (1 + sq * 0.5));

  stage.render(dt, !!config.render?.ao);
  frames++;
  if (now - fpsT > 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
}

// rAF drives rendering normally; a worker-timer takes over when the page is hidden/occluded
// (OBS captures the window while it sits behind others; rAF is paused then). Never pauses on blur.
renderer.setAnimationLoop(() => { lastRaf = performance.now(); frame(lastRaf); });
const tickSrc = `let id=0;onmessage=(e)=>{clearInterval(id);id=setInterval(()=>postMessage(0),e.data)}`;
const ticker = new Worker(URL.createObjectURL(new Blob([tickSrc], { type: 'text/javascript' })));
const setTick = () => ticker.postMessage(Math.max(4, Math.floor(1000 / clamp(config.render?.fps ?? 60, 10, 240))));
ticker.onmessage = () => {
  const now = performance.now();
  if (document.visibilityState !== 'visible' || now - lastRaf > 100) frame(now);
};
setTick();

addEventListener('resize', () => { stage.setSize(innerWidth, innerHeight); layout(); });

applyScene(config.activeScene);
window.avatar = { output: OUTPUT, act, config: () => config, toss: () => toss, applyScene, applyOutfit };
