// JS fallback (no wasm): sit / stand / backflip on a chair (no chair physics: it stays, he lands back on it).
//   node tests/sit_smoke_js.mjs
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
globalThis.PRIVADA_NO_WASM = true;
const { ToiletTuber, registerFurnitureInfo } = await import('../src/rig/ToiletTuber.js');
const { registerAccessory } = await import('../src/accessories/index.js');
registerAccessory('test_chair', ({ THREE: T }) => { const g = new T.Group(); const m = new T.Mesh(new T.BoxGeometry(0.46, 0.45, 0.46)); m.position.y = 0.225; g.add(m); return g; });
registerFurnitureInfo({ test_chair: { seatHeight: 0.45 } });
const base = JSON.parse(readFileSync(new URL('../themes/base.json', import.meta.url)));
const tb = new ToiletTuber({ ...base, slots: { ...(base.slots || {}), floor_under: [{ id: 'test_chair' }] } });
let bad = 0;
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) bad++; };
const run = (n) => { let step = 0, prev = tb.body.position.y; for (let i = 0; i < n; i++) { tb.update(1 / 60, { look: { x: 0, y: 0 }, mouth: 0 }); step = Math.max(step, Math.abs(tb.body.position.y - prev)); prev = tb.body.position.y; } return step; };
ok(!tb.usesRust && tb.seatHeight() === 0.45, 'JS rig, seat height 0.45');
let st = (tb.play('sit'), run(80));
ok(tb.isSitting && Math.abs(tb.body.position.y - 0.45) < 0.02 && st < 0.05, `sit: base ${tb.body.position.y.toFixed(3)}, max step ${st.toFixed(3)}`);
tb.play('backflip'); run(120);
ok(Math.abs(tb.body.position.y - 0.45) < 0.03, `backflip lands back on the seat (${tb.body.position.y.toFixed(3)})`);
st = (tb.play('stand'), run(80));
ok(!tb.isSitting && tb.body.position.y < 0.02 && st < 0.05, 'stand: floor');
tb.sitHeight = 0.3; run(60);
ok(Math.abs(tb.sitHeight - 0.3) < 0.01, 'sitHeight setter');
console.log(bad ? `sit smoke (js): ${bad} problem(s)` : 'sit smoke (js): ok');
process.exit(bad ? 1 : 0);
