// Deterministic video showcase: renders a scripted ~48 s scene frame by frame
// (fixed dt), POSTs JPEG frames + an offline-rendered WAV to tools/capture_server.py.
// Open http://127.0.0.1:8766/showcase.html  (?preview=1 plays it live, no capture)
import * as THREE from 'three';
import { createStage } from './stage.js';
import { ToiletTuber } from './rig/ToiletTuber.js';
import { loadThemes } from './themes.js';
import { FakeTalk, VISEMES, textToVisemes } from './input/visemes.js';
import { sfx } from './audio/sfx.js';
import './accessories/extra.js';
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer/mp4-muxer.mjs';

let SEED = 1234567;
Math.random = () => ((SEED = (Math.imul(SEED, 1664525) + 1013904223) >>> 0) / 4294967296);
const P = new URLSearchParams(location.search);
const PREVIEW = P.has('preview');
const W = +(P.get('w') || 1920), H = +(P.get('h') || 1080), FPS = +(P.get('fps') || 30);
const DUR = 33;
const FRAMES = +(P.get('frames') || DUR * FPS);
const status = document.getElementById('status');

const stage = createStage({ width: W, height: H, pixelRatio: 1 });
const { scene, camera, renderer } = stage;
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = 'auto';

const themes = await loadThemes();
const clone = (o) => JSON.parse(JSON.stringify(o));
const tuber = new ToiletTuber(themes.base);
scene.add(tuber.root);

// background as a real texture (CSS backgrounds don't end up in captured frames)
function bgTexture(theme) {
  const cols = (theme.background?.css || '').match(/#[0-9a-f]{6}/gi) || ['#d9d2c5', '#a39a8b', '#5f584e'];
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 576;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(512, 230, 30, 512, 288, 640);
  cols.forEach((col, i) => grd.addColorStop(i / Math.max(1, cols.length - 1), col));
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 576);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function setTheme(t) {
  tuber.setTheme(t);
  scene.background?.dispose?.();
  scene.background = bgTexture(t);
}
setTheme(themes.base);
// diagnostics: ?noao (skip ambient occlusion), ?noshadow (no shadow maps)
if (P.has('noshadow')) renderer.shadowMap.enabled = false;

/* ----------------------------------------------------------- script */
const fake = new FakeTalk();
const sounds = [];   // [t, name, data]
const voice = [];    // [t, viseme, dur]
let T = 0;
tuber.on((type, d) => { if (type === 'sfx') sounds.push(typeof d === 'string' ? [T, d] : [T, d.type, d]); });
const say = (text) => {
  fake.say(text);
  let t = T;
  for (const [v, dur] of textToVisemes(text)) { voice.push([t, v, dur]); t += dur; }
};
const look = { x: 0, y: 0 };
let lookMode = 'wander';

// build a look from a base theme + slot changes
const outfit = (base, slots, mats = {}) => {
  const t = clone(base);
  t.slots = slots;
  for (const [k, c] of Object.entries(mats)) t.materials[k] = { ...(t.materials[k] || t.materials.porcelain), color: c };
  return t;
};
const B = themes.base;
const crown = { id: 'crown', params: { points: 8, tilt: 0.12, radius: 0.15 } };
const hb = { id: 'mustache_handlebar' };
const accOnly = (slots) => { tuber.theme = { ...tuber.theme, slots }; tuber.buildAccessories(); sounds.push([T, 'pop']); };

const hats = ['top_hat', 'cowboy_hat', 'viking_helmet', 'wizard_hat', 'chef_hat', 'pirate_hat', 'party_hat', 'beanie', 'baseball_cap', 'halo'];
const mustaches = ['mustache_dali', 'mustache_chevron', 'mustache_fu_manchu', 'mustache_imperial', 'mustache_walrus', 'mustache_english', 'mustache_pancho', 'mustache_curly', 'mustache_handlebar'];
const eyes = ['sunglasses', 'monocle', 'aviators', 'nerd_glasses', 'eyepatch', null];

// quick mouth-shape demo (no voice): each shape held briefly
const shapes = (seq, hold = 0.32) => {
  fake.seq = [...seq].map((v) => [v, hold]).concat([['rest', 0.15]]);
  fake.i = 0; fake.t = 0;
};
const EVENTS = [
  [0.0, () => { lookMode = 'wander'; }],
  [1.0, () => tuber.play('jump')],
  [2.2, () => { lookMode = 'camera'; shapes('AOEUM'); }],
  [4.2, () => tuber.play('flush')],
  [9.5, () => tuber.play('paper')],
];
// accessory carousel 13.8 .. 23.6 (fast)
let ci = 0;
for (let t = 13.8; t < 23.6; t += 0.7, ci++) {
  const i = ci;
  EVENTS.push([t, () => {
    const slots = {
      head_top: [{ id: hats[i % hats.length] }],
      face: [{ id: mustaches[i % mustaches.length] }],
    };
    const e = eyes[Math.floor(i / 2) % eyes.length];
    if (e) slots.eyes = [{ id: e }];
    if (i >= 2) slots.body_front = [{ id: i % 2 ? 'bow_tie_real' : 'gold_chain' }];
    if (i >= 4) slots.back = [{ id: 'cape', params: { color: ['#7a1020', '#1d2f6b', '#1d4a2a'][i % 3] } }];
    if (i >= 5) slots.floor_right = [{ id: 'plunger' }];
    if (i >= 6) slots.floor_left = [{ id: 'rubber_duck' }];
    if (i >= 9) slots.face.push({ id: 'cigar' });
    accOnly(slots);
    if (i === 3) setTheme(outfit(tuber.theme, slots, { seat: '#1c1c1e', lid: '#1c1c1e' }));
    if (i === 8) setTheme(outfit(tuber.theme, slots, { seat: '#2f5d9c', lid: '#2f5d9c' }));
    if (i % 4 === 1) tuber.play('jump');
    if (i === 10) tuber.play('no');
  }]);
}
EVENTS.push(
  [23.8, () => { setTheme(themes.soviet); tuber.play('gargle'); }],
  [26.2, () => setTheme(themes.golden)],
  [26.5, () => tuber.play('backflip')],
  [28.4, () => shapes('OA', 0.3)],
  [29.4, () => setTheme(outfit(B, { head_top: [{ id: 'top_hat' }], eyes: [{ id: 'sunglasses' }], face: [hb], body_front: [{ id: 'bow_tie_real' }] }, {}))],
  [29.8, () => tuber.play('jump')],
  [31.4, () => { setTheme(themes.base); tuber.play('blink'); }],
);
EVENTS.sort((a, b) => a[0] - b[0]);

/* ----------------------------------------------------------- camera */
// keyframes: [t, camPos, target, fov]
const K = [
  [0, [0.0, 1.0, 5.6], [0, 0.85, 0], 30],
  [2.2, [0.25, 1.15, 4.0], [0, 0.9, 0], 32],
  [4.0, [0.2, 1.15, 3.6], [0, 0.95, 0], 32],      // mouth close-up
  [5.0, [2.4, 1.3, 3.6], [0, 0.75, 0.6], 34],      // flush: 3/4 view to see the arc
  [9.0, [2.6, 1.0, 3.4], [0, 0.6, 0.8], 34],
  [10.0, [-2.5, 1.4, 2.6], [-0.4, 0.8, 0], 32],    // paper: left side
  [13.2, [-2.2, 1.2, 2.8], [-0.4, 0.7, 0], 32],
  [14.0, [0.0, 1.25, 3.9], [0, 1.0, 0], 32],
  [18.5, [3.6, 1.4, 1.2], [0, 0.95, 0], 32],       // orbit to show the cape
  [21.0, [0.6, 1.4, -3.6], [0, 1.0, 0], 32],
  [23.6, [-0.3, 1.25, 4.0], [0, 0.95, 0], 32],
  [26.3, [0.0, 1.2, 4.1], [0, 0.95, 0], 32],
  [26.8, [1.6, 1.0, 4.6], [0, 1.1, 0], 36],        // backflip: wider
  [28.4, [0.3, 1.2, 3.4], [0, 1.0, 0], 32],
  [31.0, [0.1, 1.2, 3.6], [0, 1.0, 0], 30],
  [33.0, [0.0, 1.1, 5.0], [0, 0.85, 0], 30],
];
const ease = (u) => u * u * (3 - 2 * u);
const v3 = new THREE.Vector3(), tg = new THREE.Vector3();
function cameraAt(t) {
  let i = 0;
  while (i < K.length - 2 && t > K[i + 1][0]) i++;
  const [t0, p0, a0, f0] = K[i], [t1, p1, a1, f1] = K[i + 1];
  const u = ease(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
  v3.fromArray(p0).lerp(new THREE.Vector3().fromArray(p1), u);
  // swing wide around the toilet instead of cutting through it
  const r = Math.hypot(v3.x, v3.z), want = Math.max(r, 2.6);
  if (r > 1e-3) { v3.x *= want / r; v3.z *= want / r; }
  tg.fromArray(a0).lerp(new THREE.Vector3().fromArray(a1), u);
  camera.position.copy(v3);
  camera.lookAt(tg);
  camera.fov = f0 + (f1 - f0) * u;
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------ frames */
const camNdc = new THREE.Vector3();
let ev = 0;
function step(dt, draw = true) {
  while (ev < EVENTS.length && EVENTS[ev][0] <= T) EVENTS[ev++][1]();
  if (lookMode === 'wander') { look.x = Math.sin(T * 1.3) * 0.8; look.y = Math.sin(T * 0.9) * 0.3; }
  else {
    // look at the camera, with a little life
    tuber.head.getWorldPosition(camNdc).project(camera);
    look.x = -camNdc.x * 1.2 + Math.sin(T * 0.7) * 0.15;
    look.y = -camNdc.y * 1.2 + Math.sin(T * 0.5) * 0.08;
  }
  cameraAt(T);
  tuber.update(dt, { look, mouth: fake.update(dt) });
  stage.updateContact(tuber);
  if (draw) stage.render(dt, !P.has('noao'));
  T += dt;
}

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', body });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
}

/* ------------------------------------------------------------- audio */
const VOWEL_F = { A: [800, 1250], E: [480, 1900], I: [300, 2300], O: [520, 900], U: [330, 780], L: [400, 1500] };
function renderVoice(ctx) {
  for (const [t, v, dur] of voice) {
    if (v === 'rest') continue;
    const g = ctx.createGain();
    g.connect(ctx.destination);
    const end = t + dur;
    if (VOWEL_F[v]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const pitch = 165 + 25 * Math.sin(t * 3.1);
      o.frequency.setValueAtTime(pitch, t); o.frequency.linearRampToValueAtTime(pitch * 0.94, end);
      for (const [f, q, gain] of [[VOWEL_F[v][0], 6, 0.5], [VOWEL_F[v][1], 9, 0.28]]) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
        const bg = ctx.createGain(); bg.gain.value = gain;
        o.connect(bp).connect(bg).connect(g);
      }
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.setValueAtTime(0.35, end - 0.025); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.01);
      o.start(t); o.stop(end + 0.03);
    } else if (v === 'M') {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 150;
      o.connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, end);
      o.start(t); o.stop(end + 0.02);
    } else {
      const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * (dur + 0.05)), ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = ctx.createBufferSource(); s.buffer = b;
      const f = ctx.createBiquadFilter(); f.type = v === 'S' ? 'highpass' : 'bandpass'; f.frequency.value = v === 'S' ? 4500 : 1800;
      s.connect(f).connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v === 'S' ? 0.12 : 0.07, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, end);
      s.start(t); s.stop(end + 0.03);
    }
  }
}
function wav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true); o += 2; }
  return new Blob([out], { type: 'audio/wav' });
}
async function renderAudio() {
  const sr = 44100, ctx = new OfflineAudioContext(2, Math.ceil(sr * (FRAMES / FPS + 0.5)), sr);
  for (const [t, name, data] of sounds) if (name !== 'drip' || Math.random() < 0.5) sfx.renderInto(ctx, t, name, data);
  return wav(await ctx.startRendering());
}

/* -------------------------------------------------------------- main */
const dt = 1 / FPS;
if (PREVIEW) {
  let last = performance.now(), acc = 0;
  renderer.setAnimationLoop(() => {
    const n = performance.now(); acc += Math.min(0.1, (n - last) / 1000); last = n;
    while (acc >= dt) { step(dt); acc -= dt; }
    status.textContent = `preview ${T.toFixed(1)}s`;
    if (T > DUR) { T = 0; ev = 0; setTheme(themes.base); }
  });
} else if ('VideoEncoder' in window && !P.has('jpeg')) {
  // Fast path: hardware H.264 in the browser (WebCodecs) -> MP4 in memory -> one upload.
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
  let failed = null;
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failed = e; } });
  let cfg = null;
  for (const codec of ['avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42e028']) {
    const c = { codec, width: W, height: H, bitrate: 18e6, framerate: FPS, hardwareAcceleration: 'prefer-hardware', latencyMode: 'quality' };
    if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; }
  }
  if (!cfg) throw new Error('H.264 encoder not supported here; open with ?jpeg');
  enc.configure(cfg);
  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f++) {
    step(dt);
    const frame = new VideoFrame(renderer.domElement, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    enc.encode(frame, { keyFrame: f % (FPS * 2) === 0 });
    frame.close();
    while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
    if (failed) throw failed;
    if (f % 15 === 0) {
      const el = (performance.now() - t0) / 1000;
      status.textContent = `render ${f}/${FRAMES} (${((f / FRAMES) * 100).toFixed(0)}%) · ${(f / el).toFixed(1)} fps`;
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await enc.flush();
  muxer.finalize();
  status.textContent = 'enviando vídeo + áudio…';
  await post('/video', new Blob([muxer.target.buffer], { type: 'video/mp4' }));
  await post('/audio', await renderAudio());
  await post('/done', JSON.stringify({ mode: 'webcodecs', codec: cfg.codec, frames: FRAMES, fps: FPS, w: W, h: H, sounds: sounds.length, seconds: ((performance.now() - t0) / 1000).toFixed(1) }));
  status.textContent = 'PRONTO ✔ vídeo salvo em D:/flanelil/out/privada_showcase.mp4';
  document.title = 'DONE';
} else {
  // JPEG path, optionally a chunk [from, to) so several browsers can render in parallel
  const FROM = +(P.get('from') || 0), TO = Math.min(FRAMES, +(P.get('to') || FRAMES));
  for (let f = 0; f < TO; f++) {
    const draw = f >= FROM;
    step(dt, draw);
    if (!draw) continue;
    const blob = await new Promise((res) => renderer.domElement.toBlob(res, 'image/jpeg', 0.93));
    await post(`/frame?i=${f}`, blob);
    if (f % 15 === 0) status.textContent = `render ${f}/${TO}`;
  }
  const last = TO === FRAMES;
  if (last) await post('/audio', await renderAudio());
  await post('/done', JSON.stringify({ mode: 'jpeg', from: FROM, to: TO, frames: FRAMES, fps: FPS, w: W, h: H, audio: last }));
  status.textContent = 'PRONTO ✔';
  document.title = 'DONE';
}
