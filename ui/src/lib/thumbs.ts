// Thumbnails in the panel — the panel NEVER builds the character.
// Keys come from web/src/app/thumbkeys.js (outfitThumbKey(resolvedTheme), accThumbKey(id)),
// the same functions the character window uses when it renders missing thumbnails at load.
//
// Outfit (preset/theme/user) lookup:  app cache thumb_get(key)  ->  static seed web/thumbs  ->  null (🚽)
//   - the character window fills the cache during loading and emits `thumbs-updated` {keys}
//   - on save/edit/import the panel emits `thumbs-request` {outfits:[resolvedTheme]} and, meanwhile,
//     stores the mirrored `preview-frame` under the same key as the immediate image
// Accessory lookup: thumb_get(key) -> static seed -> rendered once here (small shared renderer) -> thumb_put
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAccessory, MaterialLib, DIM, outfitThumbKey, accThumbKey } from './legacy';
import { emit, invoke, invokeRaw, listen } from './bridge';

export { outfitThumbKey, accThumbKey };
const mem = new Map<string, string>(); // cache key -> URL (object URL or static path)
const subs = new Set<() => void>();
/** cards re-check their image when thumbnails change */
export function onThumbsChanged(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; }
const changed = () => subs.forEach((cb) => cb());

// the character window finished some thumbnails -> forget them here and refresh the cards
listen('thumbs-updated', (p: any) => {
  const keys: string[] = Array.isArray(p?.keys) ? p.keys : [];
  for (const k of keys) { const u = mem.get(k); if (u?.startsWith('blob:')) URL.revokeObjectURL(u); mem.delete(k); }
  if (!keys.length) { for (const u of mem.values()) if (u.startsWith('blob:')) URL.revokeObjectURL(u); mem.clear(); }
  changed();
});

/* ------------------------------------------------------------ static seed */
type Index = { version: number; items: Record<string, { file: string; hash: string }> };
let indexP: Promise<Index | null> | null = null;
export function staticIndex() {
  indexP ||= fetch('../thumbs/index.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null); // optional seed
  return indexP;
}
async function seedUrl(kind: 'preset' | 'acc', id: string) {
  const it = (await staticIndex())?.items?.[`${kind}:${id}`];
  return it ? `../thumbs/${it.file}` : null;
}

/* ------------------------------------------------------------- disk cache */
let cacheBroken = false;
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms))]);
}
async function cacheGet(key: string): Promise<string | null> {
  if (cacheBroken) return null;
  try {
    const v: any = await withTimeout(invoke('thumb_get', { key }), 3000, 'thumb_get');
    const bytes: any = v instanceof ArrayBuffer ? v : ArrayBuffer.isView(v) ? v : Array.isArray(v) ? new Uint8Array(v) : null;
    if (!bytes || bytes.byteLength === 0) return null; // miss
    return URL.createObjectURL(new Blob([bytes], { type: sniff(bytes) }));
  } catch (e) { console.error('[thumb] cache read failed:', e); cacheBroken = true; return null; }
}
function sniff(b: ArrayBuffer | ArrayBufferView) {
  const u = new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer, b instanceof ArrayBuffer ? 0 : b.byteOffset, 4);
  if (u[0] === 0x89 && u[1] === 0x50) return 'image/png';
  if (u[0] === 0xff && u[1] === 0xd8) return 'image/jpeg';
  return 'image/webp';
}
async function cachePut(key: string, blob: Blob) {
  if (cacheBroken) return;
  try { await invokeRaw('thumb_put', new Uint8Array(await blob.arrayBuffer()), { 'x-key': key }); }
  catch (e) { console.error('[thumb] cache write failed:', e); }
}

/* ----------------------------------------------------------------- outfits */
/** any outfit (built-in or user) by its RESOLVED theme: app cache -> static seed -> null */
export async function outfitThumb(id: string, resolvedTheme: any): Promise<string | null> {
  const key = outfitThumbKey(resolvedTheme);
  if (mem.has(key)) return mem.get(key)!;
  const u = (await cacheGet(key)) || (await seedUrl('preset', id));
  if (u) mem.set(key, u);
  return u;
}

/** ask the character window to (re)render these outfits; it answers with `thumbs-updated` */
export function requestOutfitThumbs(resolvedThemes: any[]) {
  if (resolvedThemes.length) emit('thumbs-request', { outfits: resolvedThemes });
}

/**
 * Immediate thumbnail for an outfit the character window is wearing right now: mirror frame
 * (preview-snap -> next preview-frame), stored under the outfit's key. The proper render from
 * `thumbs-request` replaces it later under the same key.
 */
export function captureOutfitThumb(resolvedTheme: any, timeoutMs = 3000): Promise<string | null> {
  const key = outfitThumbKey(resolvedTheme);
  return new Promise((resolve) => {
    let un = () => {};
    const timer = setTimeout(() => { un(); console.warn(`[thumb] no preview-frame within ${timeoutMs} ms (character window closed?)`); resolve(null); }, timeoutMs);
    un = listen('preview-frame', async (f: any) => {
      if (!f?.data) return;
      clearTimeout(timer); un();
      try {
        const blob = await (await fetch(f.data)).blob();
        const old = mem.get(key);
        if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
        mem.set(key, URL.createObjectURL(blob));
        cachePut(key, blob);
        changed();
        resolve(mem.get(key)!);
      } catch (e) { console.error('[thumb] capture failed:', e); resolve(null); }
    });
    emit('preview-snap', {});
  });
}

/* ------------------------------------------- accessories (runtime fallback) */
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
type Job = { id: string; fn: () => Promise<Blob | null>; res: (v: Blob | null) => void };
const jobs: Job[] = [];
let busy = false, scheduled = false, lastProgress = performance.now();
function schedule() {
  if (scheduled || busy || !jobs.length) return;
  scheduled = true;
  let fired = false;
  const go = () => { if (fired) return; fired = true; scheduled = false; runOne(); };
  requestAnimationFrame(go);
  setTimeout(go, 100);
}
async function runOne() {
  const j = jobs.shift();
  if (!j) { scheduleDispose(); return; }
  busy = true;
  let blob: Blob | null = null;
  try { blob = await withTimeout(j.fn(), 8000, `render ${j.id}`); }
  catch (e) { console.error(`[thumb] ${j.id} failed:`, e); if (/context|webgl/i.test(String(e))) R = null; }
  busy = false;
  lastProgress = performance.now();
  j.res(blob);
  if (jobs.length) schedule(); else scheduleDispose();
}
setInterval(() => { // watchdog
  if (jobs.length && !busy && !scheduled) schedule();
  if (busy && performance.now() - lastProgress > 12000) { console.error('[thumb] watchdog: job stuck, restarting queue'); busy = false; schedule(); }
}, 1000);
const queue = (id: string, fn: () => Promise<Blob | null>) => new Promise<Blob | null>((res) => { jobs.push({ id, fn, res }); schedule(); });

const NEUTRAL = { dt: 1 / 60, time: 0, mouth: 0, talk: 0, headYawVel: 0, headPitchVel: 0, lift: 0 };
const finiteBox = (b: any) => !b.isEmpty() && [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite);
async function renderAccessory(id: string, theme: any): Promise<Blob | null> {
  const mats = new MaterialLib(theme?.materials || {});
  let obj: any = null;
  const { renderer, scene, camera } = ctx();
  try {
    obj = buildAccessory({ THREE, mats, theme, dim: DIM }, { id, params: {} });
    if (!obj) throw new Error(`accessory "${id}" built nothing`);
    for (let i = 0; i < 3; i++) obj.traverse((x: any) => x.userData.update?.(NEUTRAL));
    scene.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (!finiteBox(box)) throw new Error('framing box is empty/NaN');
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const d = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    camera.position.copy(sphere.center).add(new THREE.Vector3(0.55, 0.3, 1).normalize().multiplyScalar(d));
    camera.near = d / 50; camera.far = d * 4;
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const blob = await new Promise<Blob | null>((res) => renderer.domElement.toBlob(res, 'image/webp', 0.85));
    if (!blob || blob.size < 200) throw new Error(`readback too small (${blob?.size ?? 0} bytes)`);
    return blob;
  } finally {
    if (obj) { scene.remove(obj); obj.traverse((m: any) => { if (m.isMesh && !m.userData.keepGeo) m.geometry?.dispose(); }); }
    mats.dispose();
  }
}
const pending = new Map<string, Promise<string | null>>();
/** accessory: app cache -> static seed -> rendered once here + cached */
export function accessoryThumb(id: string, theme: any): Promise<string | null> {
  const key = accThumbKey(id);
  if (mem.has(key)) return Promise.resolve(mem.get(key)!);
  if (pending.has(key)) return pending.get(key)!;
  const p = (async () => {
    const hit = (await cacheGet(key)) || (await seedUrl('acc', id));
    if (hit) { mem.set(key, hit); return hit; }
    const blob = await queue(id, () => renderAccessory(id, theme));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    mem.set(key, url);
    cachePut(key, blob);
    return url;
  })().catch((e) => { console.error(`[thumb] ${id}:`, e); return null; }).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** forget in-memory URLs; cards re-read the cache/seed */
export function clearThumbs() {
  for (const u of mem.values()) if (u.startsWith('blob:')) URL.revokeObjectURL(u);
  mem.clear();
  indexP = null;
  changed();
}
