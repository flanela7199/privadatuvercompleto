// Mesh cache: heavy procedural meshes are built in Rust (crates/privada-core/src/geo,
// via web/pkg) and kept in three layers:
//   1. memory (Map key -> PRVM bytes, LRU by size)
//   2. persistent: Tauri `cache_get` / `cache_put` (privada-data/cache/<key>.bin) or IndexedDB in a browser
//   3. build in Rust/wasm (sync), then store in 1 (+ 2 in the background)
// If wasm is missing (?nowasm / ?nogeo), getMesh() returns null and callers use the JS builders.
//
// Binary format (PRVM, little-endian) — see docs/app-contract.md "Mesh cache":
//   0 "PRVM" | 4 u32 format=1 | 8 u32 geoVersion | 12 u32 flags(1 normals,2 uvs,4 indices)
//   16 u32 vertexCount | 20 u32 indexCount | 24,28 reserved | 32.. f32 pos[vc*3], nrm[vc*3]?, uv[vc*2]?, u32 idx[ic]?
import * as THREE from 'three';
import { loadWasm } from './wasmrig.js';

const OFF = globalThis.PRIVADA_NO_GEO || (typeof location !== 'undefined' && /[?&]nogeo\b/.test(location.search || ''));
const W = OFF ? null : await loadWasm();
const pkg = W?.pkg?.build_mesh_prvm ? W.pkg : null;
export const geoReady = !!pkg;
export const GEO_VERSION = pkg ? pkg.geo_version() : 0;
export const RUST_MUSTACHES = new Set(pkg ? pkg.mustache_styles().split(',') : []);

const tauriInvoke = globalThis.__TAURI__?.core?.invoke;
const MEM_BUDGET = 96 * 1024 * 1024;
const mem = new Map(); // key -> Uint8Array (insertion order = LRU)
let memBytes = 0;
export const stats = { hits: 0, persistHits: 0, builds: 0, buildMs: 0, misses: 0 };

/* ------------------------------------------------------------- helpers */
/** JSON with sorted keys, so equal params always give the same cache key */
export function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
}

export function cacheKey(kind, params) {
  const json = typeof params === 'string' ? params : stableStringify(params);
  return pkg ? pkg.mesh_cache_key(kind, json) : `${kind}-${json}`;
}

function remember(key, bytes) {
  if (mem.has(key)) { memBytes -= mem.get(key).byteLength; mem.delete(key); }
  mem.set(key, bytes);
  memBytes += bytes.byteLength;
  for (const [k, b] of mem) {
    if (memBytes <= MEM_BUDGET) break;
    if (k === key) continue;
    mem.delete(k); memBytes -= b.byteLength;
  }
}

function aligned(u8) {
  return u8.byteOffset % 4 === 0 ? u8 : new Uint8Array(u8); // copy to an aligned buffer
}

/** PRVM bytes -> BufferGeometry (arrays are COPIED: callers may mutate the geometry) */
export function decodeGeometry(bytes) {
  const b = aligned(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== 0x4d565250) throw new Error('prvm: bad magic'); // "PRVM"
  const flags = dv.getUint32(12, true), vc = dv.getUint32(16, true), ic = dv.getUint32(20, true);
  let o = b.byteOffset + 32;
  const f32 = (n) => { const a = new Float32Array(b.buffer.slice(o, o + n * 4)); o += n * 4; return a; };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(f32(vc * 3), 3));
  if (flags & 1) g.setAttribute('normal', new THREE.BufferAttribute(f32(vc * 3), 3));
  if (flags & 2) g.setAttribute('uv', new THREE.BufferAttribute(f32(vc * 2), 2));
  if (flags & 4) g.setIndex(new THREE.BufferAttribute(new Uint32Array(b.buffer.slice(o, o + ic * 4)), 1));
  return g;
}

function prvmVersionOk(bytes) {
  if (!bytes || bytes.byteLength < 32) return false;
  const b = aligned(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return dv.getUint32(0, true) === 0x4d565250 && dv.getUint32(8, true) === GEO_VERSION;
}

/* ------------------------------------------------- persistent storage */
let idb = null;
function openIdb() {
  if (idb || typeof indexedDB === 'undefined') return idb;
  idb = new Promise((res) => {
    const r = indexedDB.open('privada-geo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('meshes');
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  });
  return idb;
}

async function persistGet(key) {
  try {
    if (tauriInvoke) {
      const r = await tauriInvoke('cache_get', { key });
      if (!r) return null;
      if (r instanceof ArrayBuffer) return r.byteLength ? new Uint8Array(r) : null;
      if (ArrayBuffer.isView(r)) return new Uint8Array(r.buffer, r.byteOffset, r.byteLength);
      if (Array.isArray(r)) return Uint8Array.from(r);
      if (typeof r === 'string') return Uint8Array.from(atob(r), (c) => c.charCodeAt(0));
      return null;
    }
    const db = await openIdb();
    if (!db) return null;
    return await new Promise((res) => {
      const q = db.transaction('meshes').objectStore('meshes').get(key);
      q.onsuccess = () => res(q.result ? new Uint8Array(q.result) : null);
      q.onerror = () => res(null);
    });
  } catch { return null; }
}

async function persistPut(key, bytes) {
  try {
    if (tauriInvoke) return await tauriInvoke('cache_put', bytes, { headers: { 'x-key': key } });
    const db = await openIdb();
    if (!db) return;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    db.transaction('meshes', 'readwrite').objectStore('meshes').put(buf, key);
  } catch { /* cache is best-effort */ }
}

/* ------------------------------------------------------------- API */
function buildBytes(kind, json) {
  const t0 = performance.now();
  const bytes = pkg.build_mesh_prvm(kind, json);
  stats.builds++; stats.buildMs += performance.now() - t0;
  return bytes;
}

/**
 * Synchronous: returns a fresh THREE.BufferGeometry for (kind, params), built in Rust or
 * served from the cache; null if Rust geometry is unavailable (caller falls back to JS).
 */
export function getMesh(kind, params) {
  if (!pkg) return null;
  const json = typeof params === 'string' ? params : stableStringify(params);
  const key = pkg.mesh_cache_key(kind, json);
  let bytes = mem.get(key);
  if (bytes) { stats.hits++; mem.delete(key); mem.set(key, bytes); }
  else {
    try { bytes = buildBytes(kind, json); } catch (e) { console.warn('[geo]', kind, e?.message || e); stats.misses++; return null; }
    remember(key, bytes);
    persistPut(key, bytes);
  }
  return decodeGeometry(bytes);
}

/** Like getMesh but checks the persistent cache before building (use while preloading). */
export async function getMeshAsync(kind, params) {
  if (!pkg) return null;
  await warm(kind, params);
  return getMesh(kind, params);
}

/** Make sure (kind, params) is in memory: memory -> persistent -> Rust build. Returns the key. */
export async function warm(kind, params) {
  if (!pkg) return null;
  const json = typeof params === 'string' ? params : stableStringify(params);
  const key = pkg.mesh_cache_key(kind, json);
  if (mem.has(key)) return key;
  const saved = await persistGet(key);
  if (saved && prvmVersionOk(saved)) { stats.persistHits++; remember(key, aligned(saved)); return key; }
  const bytes = buildBytes(kind, json);
  remember(key, bytes);
  persistPut(key, bytes);
  return key;
}

/* ---------------------------------------------- what a theme needs */
// Params must match exactly what the builders request (accessories/index.js, geo.js, ToiletTuber).
export const BODY_DIM = {
  egg: 0.08,
  seat: { rx: 0.405, rz: 0.495, hole: 0.62, h: 0.03 },
  lid: { rx: 0.4, rz: 0.49, depth: 0.036, dome: 0.02, edge: 0.02 },
};

export function mustacheParams(style, p = {}, dim) {
  const base = { style, length: p.length ?? 1, thickness: p.thickness ?? 1 };
  if (dim?.bowlProfile) base.bowl = { profile: dim.bowlProfile, scaleZ: dim.bowlScaleZ ?? 1.22, egg: dim.egg ?? 0.08 };
  return [
    { ...base, part: 'core', side: 1 }, { ...base, part: 'hair', side: 1 },
    { ...base, part: 'core', side: -1 }, { ...base, part: 'hair', side: -1 },
    { ...base, part: 'mid', side: 1 },
  ];
}

export function crownParams(p = {}) {
  return { R: 0.15, H: 0.06 + (p.spike ?? 0.085), band: p.band ?? 0.055, n: p.points ?? 8 };
}

/** list of [kind, params] the theme's heavy meshes need (dim = ToiletTuber DIM) */
export function themeMeshes(theme, dim) {
  const out = [];
  // body: seat + lid revolves (same compact profile form geo.js tags its profiles with)
  const egg = dim?.egg ?? BODY_DIM.egg, S = dim?.seat ?? BODY_DIM.seat, L = dim?.lid ?? BODY_DIM.lid;
  out.push(['egg_revolve', { rx: S.rx, rz: S.rz, k: egg, seg: 160, profile: { seat: [S.rx, S.hole, S.h] } }]);
  out.push(['egg_revolve', { rx: L.rx, rz: L.rz, k: egg, seg: 160, profile: { lid: [L.rx, L.depth, L.dome, L.edge] } }]);
  for (const entries of Object.values(theme?.slots || {})) {
    for (const e of entries || []) {
      if (!e || e.hidden) continue;
      if (RUST_MUSTACHES.has(e.id)) for (const p of mustacheParams(e.id, e.params, dim)) out.push(['mustache', p]);
      else if (e.id === 'crown') out.push(['crown_shell', crownParams(e.params)]);
      else if (e.id === 'ushanka') for (const b of USHANKA_BOXES) out.push(['rounded_box', b]);
    }
  }
  return out;
}
// RoundedBoxGeometry(w, h, d, segments, radius) used by the ushanka fur
export const USHANKA_BOXES = [
  { w: 0.56, h: 0.1, d: 0.47, segments: 5, radius: 0.045 },
  { w: 0.4, h: 0.17, d: 0.06, segments: 5, radius: 0.028 },
  { w: 0.06, h: 0.22, d: 0.2, segments: 5, radius: 0.028 },
];

let DIM_CACHE = null;
async function rigDim() {
  if (DIM_CACHE) return DIM_CACHE;
  try { DIM_CACHE = (await import('./ToiletTuber.js')).DIM; } catch { DIM_CACHE = null; }
  return DIM_CACHE;
}

const idle = () => new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 200 }) : setTimeout(r, 0)));
// manifest = { outfitId: [keys] } (stored by the app as privada-data/cache/manifest.json);
// stale entries are harmless: every .bin carries GEO_VERSION in its header.
const manifest = {};
let manifestTimer = null;

/**
 * Build/cache every heavy mesh a theme needs (no scene objects). Yields between meshes.
 * Also records the keys per outfit id in privada-data/cache/manifest (cache_put 'manifest').
 */
export async function preload(theme, dim) {
  if (!pkg || !theme) return;
  dim ??= await rigDim();
  const keys = [];
  for (const [kind, params] of themeMeshes(theme, dim)) {
    try { keys.push(await warm(kind, params)); } catch (e) { console.warn('[geo] preload', kind, e?.message || e); }
    await idle();
  }
  if (theme.id) {
    manifest[theme.id] = keys.filter(Boolean);
    clearTimeout(manifestTimer);
    manifestTimer = setTimeout(() => persistPut('manifest', new TextEncoder().encode(JSON.stringify(manifest))), 500);
  }
}
export const preloadTheme = preload;

/** At startup: pull the persisted meshes of one outfit (from the manifest) into memory. */
export async function warmOutfit(outfitId) {
  if (!pkg) return 0;
  const m = await persistGet('manifest');
  if (!m) return 0;
  try {
    const j = JSON.parse(new TextDecoder().decode(m));
    for (const [id, keys] of Object.entries(j || {})) if (!(id in manifest) && Array.isArray(keys)) manifest[id] = keys;
    let n = 0;
    for (const key of j?.[outfitId] || []) {
      if (mem.has(key)) continue;
      const b = await persistGet(key);
      if (b && prvmVersionOk(b)) { remember(key, aligned(b)); n++; }
    }
    return n;
  } catch { return 0; }
}

/** Helpers used by the JS builders (return null -> use the JS path). */
export function rustMustache(style, p, dim, part, side) {
  if (!RUST_MUSTACHES.has(style)) return null;
  const base = { style, length: p?.length ?? 1, thickness: p?.thickness ?? 1, part, side };
  if (dim?.bowlProfile) base.bowl = { profile: dim.bowlProfile, scaleZ: dim.bowlScaleZ ?? 1.22, egg: dim.egg ?? 0.08 };
  return getMesh('mustache', base);
}

export function rustRoundedBox(w, h, d, segments = 2, radius = 0.1) {
  return getMesh('rounded_box', { w, h, d, segments, radius });
}
