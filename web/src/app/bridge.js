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
    default: return true; // set_hit_rect, set_click_through, set_avatar_mode, set_audio, quit
  }
}

// browser: synthesize the global cursor from the page pointer (physical px like Rust)
if (!isTauri) {
  addEventListener('pointermove', (e) => {
    const p = { x: (e.screenX ?? e.clientX) * devicePixelRatio, y: (e.screenY ?? e.clientY) * devicePixelRatio };
    for (const cb of local.get('cursor') || []) cb(p);
  });
}
