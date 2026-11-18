// Thumbnails for accessories and presets, generated LAZILY (only for visible cards).
//  - ONE shared small offscreen renderer, disposed after a few idle seconds
//  - at most one thumbnail per idle slot / frame, progress via emit('loading')
//  - cache: memory -> app cache (invoke cache_get/cache_put, key thumb_<id>_<ver>) -> localStorage fallback
// Bump THUMB_VERSION whenever accessory art changes so stale previews regenerate.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAccessory, MaterialLib, ToiletTuber, DIM } from './legacy';
import { emit, invoke, isTauri } from './bridge';

export const THUMB_VERSION = 3;
const mem = new Map<string, string>();
const keyFor = (id: string) => `thumb_${id}_${THUMB_VERSION}`;

/* ------------------------------------------------------------ persistence */
let appCacheOk = isTauri;
let skipReads = false; // after "↻ Miniaturas": regenerate everything this session (still writes)
async function cacheGet(id: string): Promise<string | null> {
  const k = keyFor(id);
  if (skipReads) return null;
  if (appCacheOk) {
    try { const v: any = await invoke('cache_get', { key: k }); if (typeof v === 'string' && v) return v; if (v == null) return localGet(k); }
    catch { appCacheOk = false; }
  }
  return localGet(k);
}
function cachePut(id: string, url: string) {
  const k = keyFor(id);
  if (appCacheOk) invoke('cache_put', { key: k, value: url }).catch(() => { appCacheOk = false; localPut(k, url); });
  else localPut(k, url);
}
function localGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function localPut(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* quota: memory only */ } }

/* ---------------------------------------------- shared renderer (lazy + disposed) */
let R: any = null;
let disposeTimer: any = 0;
function ctx() {
  clearTimeout(disposeTimer);
  if (R) return R;
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
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
    if (!R || jobs.length) return;
    R.env.dispose();
    R.renderer.dispose();
    R.renderer.forceContextLoss();
    R = null;
  }, 4000);
}

/* --------------------------------------------- one job per idle slot / frame */
type Job = { fn: () => string | null; res: (v: string | null) => void };
const jobs: Job[] = [];
let running = false, total = 0, done = 0;
const idle: (cb: () => void) => void = (window as any).requestIdleCallback
  ? (cb) => (window as any).requestIdleCallback(() => requestAnimationFrame(cb), { timeout: 150 })
  : (cb) => requestAnimationFrame(() => setTimeout(cb, 0));
function pump() {
  if (!jobs.length) {
    running = false;
    if (total) emit('loading', { progress: 1, text: 'miniaturas prontas' });
    total = done = 0;
    scheduleDispose();
    return;
  }
  running = true;
  idle(() => {
    const j = jobs.shift()!;
    let v: string | null = null;
    try { v = j.fn(); } catch (e) { console.warn('[thumb]', e); }
    j.res(v);
    done++;
    emit('loading', { progress: Math.min(0.99, done / Math.max(1, total)), text: `gerando miniaturas… ${done}/${total}` });
    pump();
  });
}
function queue(fn: () => string | null): Promise<string | null> {
  return new Promise((res) => {
    jobs.push({ fn, res });
    total++;
    if (!running) pump();
  });
}

const pending = new Map<string, Promise<string | null>>();
function cachedOr(id: string, make: () => string | null): Promise<string | null> {
  if (mem.has(id)) return Promise.resolve(mem.get(id)!);
  if (pending.has(id)) return pending.get(id)!;
  const p = (async () => {
    const hit = await cacheGet(id);
    if (hit) { mem.set(id, hit); return hit; }
    const url = await queue(make);
    if (url) { mem.set(id, url); cachePut(id, url); }
    return url;
  })().finally(() => pending.delete(id));
  pending.set(id, p);
  return p;
}

/* ------------------------------------------------------------------ render */
function shoot(obj: any, size: number, dir: [number, number, number]) {
  const { renderer, scene, camera } = ctx();
  renderer.setSize(size, size, false);
  scene.add(obj);
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
  const url = renderer.domElement.toDataURL('image/webp', 0.85);
  scene.remove(obj);
  return url;
}
const disposeTree = (o: any) => o.traverse((m: any) => { if (m.isMesh && !m.userData.keepGeo) m.geometry?.dispose(); });
const NEUTRAL = { dt: 1 / 60, time: 0, mouth: 0, talk: 0, headYawVel: 0, headPitchVel: 0, lift: 0 };

export function accessoryThumb(id: string, theme: any, size = 128) {
  return cachedOr(`acc-${id}`, () => {
    const mats = new MaterialLib(theme?.materials || {});
    try {
      const obj = buildAccessory({ THREE, mats, theme, dim: DIM }, { id, params: {} });
      if (!obj) return null;
      for (let i = 0; i < 3; i++) obj.traverse((x: any) => x.userData.update?.(NEUTRAL));
      const url = shoot(obj, size, [0.55, 0.3, 1]);
      disposeTree(obj);
      return url;
    } finally { mats.dispose(); }
  });
}

export function outfitThumb(theme: any, size = 180) {
  return cachedOr(`outfit-${hash(JSON.stringify({ m: theme.materials, s: theme.slots }))}`, () => {
    const tb = new ToiletTuber(theme);
    for (let i = 0; i < 20; i++) tb.update(1 / 60, { look: { x: 0.25, y: 0.05 }, mouth: 0 });
    tb.fx.visible = false;
    const url = shoot(tb.root, size, [0.35, 0.18, 1]);
    disposeTree(tb.root);
    tb.mats.dispose();
    return url;
  });
}

/** Forget cached images (memory + localStorage; app cache entries are overwritten on regenerate). */
export function clearThumbs() {
  mem.clear();
  skipReads = true;
  for (const k of Object.keys(localStorage)) if (k.startsWith('thumb_') || k.startsWith('privada.thumb.')) localStorage.removeItem(k);
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
