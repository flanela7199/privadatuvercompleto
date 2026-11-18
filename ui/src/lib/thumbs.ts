// Thumbnails for accessories and presets, generated LAZILY (only for visible cards).
//  - ONE shared offscreen WebGLRenderer (128x128-ish, alpha, preserveDrawingBuffer), disposed when idle
//  - at most ONE thumbnail per frame, progress via emit('loading'); a watchdog restarts a stalled queue
//  - cache: memory (object URLs) -> app binary cache (thumb_get / thumb_put: raw WEBP bytes,
//    key thumb_<id>_<ver>, EMPTY ArrayBuffer = miss; IndexedDB in browser mode)
//  - every failure is logged with console.error and resolves to null -> the card shows a fallback icon
// Bump THUMB_VERSION whenever accessory art changes so stale previews regenerate.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAccessory, MaterialLib, ToiletTuber, DIM } from './legacy';
import { emit, invoke, invokeRaw } from './bridge';

export const THUMB_VERSION = 4;
const mem = new Map<string, string>();      // id -> object URL
const keyFor = (id: string) => `thumb_${id}_${THUMB_VERSION}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 96);

/* ------------------------------------------------------------ persistence */
let skipReads = false; // after "↻ Miniaturas": regenerate everything this session (still writes)
let cacheBroken = false;
async function cacheGet(id: string): Promise<string | null> {
  if (skipReads || cacheBroken) return null;
  try {
    const v: any = await withTimeout(invoke('thumb_get', { key: keyFor(id) }), 3000, 'thumb_get');
    const bytes: any = v instanceof ArrayBuffer ? v : ArrayBuffer.isView(v) ? v : Array.isArray(v) ? new Uint8Array(v) : null;
    if (!bytes || bytes.byteLength === 0) return null; // miss
    return URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
  } catch (e) {
    console.error('[thumb] cache read failed, generating instead:', e);
    cacheBroken = true; // don't keep hitting a failing command
    return null;
  }
}
async function cachePut(id: string, blob: Blob) {
  if (cacheBroken) return;
  try { await invokeRaw('thumb_put', new Uint8Array(await blob.arrayBuffer()), { 'x-key': keyFor(id) }); }
  catch (e) { console.error('[thumb] cache write failed:', e); }
}
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms))]);
}

/* ------------------------------------------- shared renderer (lazy + disposed) */
let R: any = null;
let disposeTimer: any = 0;
function ctx() {
  clearTimeout(disposeTimer);
  if (R) return R;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setSize(128, 128, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.9;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8c8478, 0.6));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
  key.position.set(2, 3, 3);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8);
  rim.position.set(-2, 2, -3);
  scene.add(key, rim);
  R = { renderer, scene, env, camera: new THREE.PerspectiveCamera(30, 1, 0.01, 50) };
  return R;
}
function scheduleDispose() {
  clearTimeout(disposeTimer);
  disposeTimer = setTimeout(() => {
    if (!R || jobs.length || busy) return;
    try { R.env.dispose(); R.renderer.dispose(); R.renderer.forceContextLoss(); } catch { /* already lost */ }
    R = null;
  }, 4000);
}

/* --------------------------------------------------- one job per frame + watchdog */
type Job = { id: string; fn: () => Promise<Blob | null>; res: (v: Blob | null) => void };
const jobs: Job[] = [];
let busy = false, total = 0, done = 0, lastProgress = performance.now(), scheduled = false;
function schedule() {
  if (scheduled || busy || !jobs.length) return;
  scheduled = true;
  // rAF = at most one per frame; setTimeout fallback so hidden/throttled windows still progress
  let fired = false;
  const go = () => { if (fired) return; fired = true; scheduled = false; runOne(); };
  requestAnimationFrame(go);
  setTimeout(go, 100);
}
async function runOne() {
  const j = jobs.shift();
  if (!j) { finish(); return; }
  busy = true;
  let blob: Blob | null = null;
  try { blob = await withTimeout(j.fn(), 5000, `render ${j.id}`); }
  catch (e) { console.error(`[thumb] ${j.id} failed:`, e); if (/context|webgl/i.test(String(e))) { R = null; } }
  busy = false;
  j.res(blob);
  done++;
  lastProgress = performance.now();
  emit('loading', { progress: Math.min(0.99, done / Math.max(1, total)), text: `gerando miniaturas… ${done}/${total}` });
  if (jobs.length) schedule(); else finish();
}
function finish() {
  if (total) emit('loading', { progress: 1, text: 'miniaturas prontas' });
  total = done = 0;
  scheduleDispose();
}
// watchdog: a stuck job or a lost wake-up never freezes the queue
setInterval(() => {
  if (jobs.length && !busy && !scheduled) schedule();
  if (busy && performance.now() - lastProgress > 8000) { console.error('[thumb] watchdog: job stuck, restarting queue'); busy = false; schedule(); }
}, 1000);
function queue(id: string, fn: () => Promise<Blob | null>): Promise<Blob | null> {
  return new Promise((res) => { jobs.push({ id, fn, res }); total++; schedule(); });
}

const pending = new Map<string, Promise<string | null>>();
function cachedOr(id: string, make: () => Promise<Blob | null>): Promise<string | null> {
  if (mem.has(id)) return Promise.resolve(mem.get(id)!);
  if (pending.has(id)) return pending.get(id)!;
  const p = (async () => {
    const hit = await cacheGet(id);
    if (hit) { mem.set(id, hit); return hit; }
    const blob = await queue(id, make);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    mem.set(id, url);
    cachePut(id, blob);
    return url;
  })().catch((e) => { console.error(`[thumb] ${id}:`, e); return null; }).finally(() => pending.delete(id));
  pending.set(id, p);
  return p;
}

/* ------------------------------------------------------------------ render */
async function shoot(obj: any, size: number, dir: [number, number, number]): Promise<Blob> {
  const { renderer, scene, camera } = ctx();
  renderer.setSize(size, size, false);
  scene.add(obj);
  try {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.1, -0.1, -0.1), new THREE.Vector3(0.1, 0.1, 0.1));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const d = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    camera.position.copy(sphere.center).add(new THREE.Vector3(...dir).normalize().multiplyScalar(d));
    camera.near = d / 50; camera.far = d * 4;
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    // read back before anything else touches the canvas (preserveDrawingBuffer keeps it valid)
    const blob = await new Promise<Blob | null>((res) => renderer.domElement.toBlob(res, 'image/webp', 0.85));
    if (!blob || blob.size === 0) {
      const url = renderer.domElement.toDataURL('image/png');
      if (url.length < 100) throw new Error('empty canvas readback');
      return await (await fetch(url)).blob();
    }
    return blob;
  } finally { scene.remove(obj); }
}
const disposeTree = (o: any) => o.traverse((m: any) => { if (m.isMesh && !m.userData.keepGeo) m.geometry?.dispose(); });
const NEUTRAL = { dt: 1 / 60, time: 0, mouth: 0, talk: 0, headYawVel: 0, headPitchVel: 0, lift: 0 };

export function accessoryThumb(id: string, theme: any, size = 128) {
  return cachedOr(`acc-${id}`, async () => {
    const mats = new MaterialLib(theme?.materials || {});
    let obj: any = null;
    try {
      obj = buildAccessory({ THREE, mats, theme, dim: DIM }, { id, params: {} });
      if (!obj) throw new Error(`accessory "${id}" built nothing`);
      for (let i = 0; i < 3; i++) obj.traverse((x: any) => x.userData.update?.(NEUTRAL));
      return await shoot(obj, size, [0.55, 0.3, 1]);
    } finally { if (obj) disposeTree(obj); mats.dispose(); }
  });
}

export function outfitThumb(theme: any, size = 160) {
  return cachedOr(`outfit-${hash(JSON.stringify({ m: theme.materials, s: theme.slots }))}`, async () => {
    const tb = new ToiletTuber(theme);
    try {
      for (let i = 0; i < 20; i++) tb.update(1 / 60, { look: { x: 0.25, y: 0.05 }, mouth: 0 });
      tb.fx.visible = false;
      return await shoot(tb.root, size, [0.35, 0.18, 1]);
    } finally { disposeTree(tb.root); tb.mats.dispose(); }
  });
}

/** Forget cached images and regenerate them this session (new images overwrite the old files). */
export function clearThumbs() {
  for (const u of mem.values()) URL.revokeObjectURL(u);
  mem.clear();
  skipReads = true;
}

/** lowercase hex FNV-1a (cache keys must match [a-z0-9_-]) */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ------------------------------------------------- eager background pre-render */
// Right after the panel is interactive: every preset/theme, then every accessory (the tab the
// user is looking at goes first). Cache hits resolve instantly; misses render one per frame and
// are written to disk, so later launches are instant. Cards keep their skeleton until ready.
export const prerender = { done: 0, total: 0, running: false, subs: new Set<() => void>() };
const notify = () => prerender.subs.forEach((f) => f());
let prerendered = false;

export async function prerenderAll(outfits: any[], accessoryIds: string[], theme: any, first: 'presets' | 'accessories' = 'presets') {
  if (prerendered) return;
  prerendered = true;
  const tasks: (() => Promise<unknown>)[] = [];
  const presetTasks = outfits.map((t) => () => outfitThumb(t));
  const accTasks = accessoryIds.map((id) => () => accessoryThumb(id, theme));
  tasks.push(...(first === 'accessories' ? [...accTasks, ...presetTasks] : [...presetTasks, ...accTasks]));
  prerender.total = tasks.length; prerender.done = 0; prerender.running = true; notify();
  // keep at most 2 in flight so the shared queue stays one-per-frame and visible cards can jump in
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const t = tasks[next++];
      try { await t(); } catch (e) { console.error('[thumb] prerender:', e); }
      prerender.done++; notify();
    }
  };
  await Promise.all([worker(), worker()]);
  prerender.running = false; notify();
}
