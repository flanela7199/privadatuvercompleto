// The ONLY module that talks to Tauri (see docs/app-contract.md).
// In a normal browser (Brave/Chrome, for development) it falls back to:
//   events   -> BroadcastChannel('privada') between tabs (avatar.html <-> control.html)
//   cursor   -> pointer position inside the page
//   mouth    -> WebAudio mic (src/input/mic.js) when enabled from the control page
//   commands -> localStorage-backed config, no-ops for window/OS commands
const T = window.__TAURI__;
export const isTauri = !!(T && T.core);

const bc = !isTauri ? new BroadcastChannel('privada') : null;
const local = new Map(); // event -> Set(cb), for same-page delivery in browser mode

export async function invoke(cmd, args = {}) {
  if (isTauri) return T.core.invoke(cmd, args);
  return browserInvoke(cmd, args);
}

/**
 * Raw-bytes command (no JSON): body is a Uint8Array/ArrayBuffer, extra data goes in headers.
 * Used for the binary caches: invokeRaw('thumb_put', bytes, { 'x-key': key }).
 * Reads (thumb_get / cache_get) use normal invoke(cmd, { key }) and return an ArrayBuffer
 * (EMPTY = miss). Browser fallback: IndexedDB.
 */
export async function invokeRaw(cmd, bytes, headers = {}) {
  if (isTauri) return T.core.invoke(cmd, bytes, { headers });
  if (cmd === 'thumb_put' || cmd === 'cache_put') { await idb('put', `${cmd.slice(0, -4)}:${headers['x-key']}`, bytes); return true; }
  return true;
}

/** listen(event, cb) -> unlisten() ; cb receives the payload */
export function listen(event, cb) {
  if (isTauri) {
    let un = null, dead = false;
    T.event.listen(event, (e) => cb(e.payload)).then((u) => (dead ? u() : (un = u)));
    return () => { dead = true; un?.(); };
  }
  if (!local.has(event)) local.set(event, new Set());
  local.get(event).add(cb);
  return () => local.get(event).delete(cb);
}

/** emit to every window (including this one) */
export function emit(event, payload) {
  if (isTauri) return T.event.emit(event, payload);
  bc.postMessage({ event, payload });
  for (const cb of local.get(event) || []) cb(payload);
}

if (bc) bc.onmessage = (m) => { for (const cb of local.get(m.data.event) || []) cb(m.data.payload); };

/* ------------------------------------------------ browser fallbacks */
const LS = 'privada.app.config';
async function browserInvoke(cmd, args) {
  switch (cmd) {
    case 'load_config': {
      const { DEFAULT_CONFIG } = await import('./defaults.js');
      const saved = localStorage.getItem(LS);
      return saved ? { ...structuredClone(DEFAULT_CONFIG), ...JSON.parse(saved) } : structuredClone(DEFAULT_CONFIG);
    }
    case 'save_config': localStorage.setItem(LS, JSON.stringify(args.config)); return true;
    case 'set_hotkeys': return { ok: Object.keys(args.bindings || {}), failed: [] };
    case 'audio_devices': return ['(navegador) microfone padrão'];
    case 'get_monitor': return { x: 0, y: 0, width: innerWidth * devicePixelRatio, height: innerHeight * devicePixelRatio, scale: devicePixelRatio };
    case 'open_control': window.open('control.html', 'privada-control'); return true;
    case 'thumb_get': case 'cache_get': return (await idb('get', `${cmd.slice(0, -4)}:${args.key}`)) || new ArrayBuffer(0);
    default: return true; // set_hit_rect, set_click_through, set_avatar_mode, set_audio, quit
  }
}

// tiny IndexedDB key/value store for the browser fallback of the binary caches
let dbp = null;
function idb(op, key, value) {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('privada-cache', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp.then((db) => new Promise((res, rej) => {
    const tx = db.transaction('kv', op === 'get' ? 'readonly' : 'readwrite');
    const st = tx.objectStore('kv');
    const rq = op === 'get' ? st.get(key) : st.put(value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength), key);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  })).catch(() => null);
}

// browser: synthesize the global cursor from the page pointer (physical px like Rust)
if (!isTauri) {
  addEventListener('pointermove', (e) => {
    const p = { x: (e.screenX ?? e.clientX) * devicePixelRatio, y: (e.screenY ?? e.clientY) * devicePixelRatio };
    for (const cb of local.get('cursor') || []) cb(p);
  });
}
