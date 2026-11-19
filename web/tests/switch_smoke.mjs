// Character switching: 20 x (Privada <-> Chratos) headless. ToiletTuber.dispose() / Chratos.dispose() must free
// the wasm rigs (memory pages stop growing after the first two builds) and every non-shared geometry; no exceptions.
//   node tests/switch_smoke.mjs
import { readFileSync } from 'node:fs';
const ctx2d = new Proxy({}, { get: (t, k) => {
  if (k === 'createImageData' || k === 'getImageData') return (w, h) => { w = w?.width ?? w ?? 4; h = h ?? w; return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; };
  if (k === 'createRadialGradient' || k === 'createLinearGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
  if (k === 'measureText') return () => ({ width: 10 });
  if (k === 'canvas') return { width: 256, height: 256 };
  return typeof k === 'string' ? (t[k] ??= function () {}) : undefined;
}, set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 256, height: 256, getContext: () => ctx2d, style: {} }) };
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d; } };
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.PRIVADA_WASM_BYTES = readFileSync(new URL('../pkg/privada_wasm_bg.wasm', import.meta.url));
const { ToiletTuber } = await import('../src/rig/ToiletTuber.js');
await import('../src/accessories/extra.js');
const { loadWasm } = await import('../src/rig/wasmrig.js');
const mem = (await loadWasm()).memory;
let Chratos = null;
try { Chratos = (await import('../src/characters/chratos/Chratos.js')).Chratos; } catch (e) { console.log('Chratos unavailable:', e.message.split(String.fromCharCode(10))[0]); }
const base = JSON.parse(readFileSync(new URL('../themes/base.json', import.meta.url)));
// props + a chair so the props / seat paths are exercised too
const theme = { ...base, slots: { ...(base.slots || {}), floor_left: [{ id: 'toilet_paper_stack' }], floor_right: [{ id: 'plunger' }] } };
let bad = 0;
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) bad++; };
// phase 1: 40 Privada rebuilds before anything else grows the heap (each leaked Rust rig would add pages)
let freedOk = true, solo = [];
for (let i = 0; i < 40; i++) {
  const t = new ToiletTuber(theme);
  for (let f = 0; f < 5; f++) t.update(1 / 60, { look: { x: 0, y: 0 }, mouth: 0 });
  const rig = t.rust?.r;
  t.dispose();
  freedOk &&= !rig || rig.__wbg_ptr === 0;
  solo.push(mem.buffer.byteLength / 65536);
}
console.log('wasm pages, privada rebuilds:', solo[0], '->', solo.at(-1));
ok(solo.at(-1) <= solo[1], 'privada-only rebuilds: wasm memory does not grow');
ok(freedOk, 'every disposed Rust rig is freed (wasm pointer 0)');
// phase 2: 20 switches Privada <-> Chratos
const pages = [];
let leaked = 0, cur = null;
for (let i = 0; i < 20; i++) {
  const kind = Chratos && i % 2 ? 'chratos' : 'privada';
  if (i === 1) ok(!!Chratos, 'Chratos loads (switching is really exercised)');
  try {
    if (kind === 'chratos') await Chratos.preload?.(theme);
    const next = kind === 'chratos' ? new Chratos(theme) : new ToiletTuber(theme);
    cur?.dispose?.();
    cur = next;
    cur.play?.('flush'); cur.play?.('paper');
    for (let f = 0; f < 90; f++) { cur.update(1 / 60, { look: { x: Math.sin(f / 9), y: 0 }, mouth: (f % 20) / 20 }); cur.root.updateMatrixWorld(); }
    if (kind === 'privada') {   // every non-shared geometry gets disposed
      const geos = new Set(); cur.root.traverse((o) => { if (o.geometry && !o.userData.keepGeo) geos.add(o.geometry); });
      let n = 0; for (const g of geos) g.addEventListener('dispose', () => n++);
      const t = cur; cur = null; t.dispose(); t.dispose(); t.update(1 / 60, {});
      leaked += geos.size - n;
    }
  } catch (e) { bad++; console.log('FAIL switch', i, kind, e.stack?.split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }
  pages.push(mem.buffer.byteLength / 65536);
}
cur?.dispose?.();
console.log('wasm pages per switch:', pages.join(' '));
ok(pages.slice(2).every((p) => p <= Math.max(pages[0], pages[1])), `wasm memory stops growing after the first two builds (${pages[1]} -> ${pages.at(-1)} pages)`);
ok(leaked === 0, `all ToiletTuber geometries disposed (${leaked} missed)`);
console.log(bad ? `switch smoke: ${bad} problem(s)` : 'switch smoke: ok');
process.exit(bad ? 1 : 0);
