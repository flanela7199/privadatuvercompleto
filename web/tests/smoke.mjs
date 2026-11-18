// Node smoke test: build every theme, play every action, step 6 s, look for NaN/exceptions.
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
const fs = await import('node:fs');
const THREE = await import('three');
const { ToiletTuber } = await import('../src/rig/ToiletTuber.js');
const { mergeTheme } = await import('../src/themes.js');
try { await import('../src/accessories/extra.js'); } catch (e) { console.log('extra.js:', e.message.split('\n')[0]); }
const { listAccessories } = await import('../src/accessories/index.js');
const raw = Object.fromEntries(JSON.parse(fs.readFileSync('themes/index.json')).map((id) => [id, JSON.parse(fs.readFileSync(`themes/${id}.json`))]));
const themes = {}; for (const id in raw) themes[id] = raw[id].extends ? mergeTheme(raw[raw[id].extends], raw[id]) : raw[id];
let bad = 0;
const check = (tb, label) => { tb.root.traverse((o) => { for (const v of [o.position, o.scale]) if (!Number.isFinite(v.x + v.y + v.z)) { bad++; if (bad < 5) console.log('NaN', label, o.name); } }); };
for (const [id, th] of Object.entries(themes)) {
  const tb = new ToiletTuber(th);
  let verts = 0; tb.root.traverse((o) => { if (o.geometry) verts += o.geometry.attributes.position.count; });
  for (const act of ['flush', 'paper', 'jump', 'no', 'blink', 'backflip', 'gargle']) {
    tb.play(act);
    for (let i = 0; i < 300; i++) tb.update(1 / 60, { look: { x: Math.sin(i / 20), y: Math.cos(i / 30) * 0.5 }, mouth: (i % 40) / 40 });
  }
  check(tb, id);
  console.log(`theme ${id}: ok, ${tb.accessories.length} acc, ${(verts / 1000).toFixed(0)}k verts, hinge=${tb.hinge?.toFixed(2)}`);
}
// every accessory on every socket
const tb = new ToiletTuber(themes.base);
for (const id of listAccessories()) {
  if (id === 'glb') continue;
  try { tb.theme = { ...themes.base, slots: { head_top: [{ id }] } }; tb.buildAccessories(); for (let i = 0; i < 30; i++) tb.update(1 / 60, { look: { x: 0.5, y: 0 }, mouth: 0.8 }); }
  catch (e) { bad++; console.log('ACC FAIL', id, e.message); }
}
// lid vs head: full mouth with head looking down must never penetrate
tb.theme = themes.base; tb.buildAccessories();
let maxH = 0; for (let i = 0; i < 400; i++) { tb.update(1 / 60, { look: { x: Math.sin(i / 15), y: -1 }, mouth: 1 }); maxH = Math.max(maxH, tb.hinge); }
tb.play('flush'); for (let i = 0; i < 300; i++) { tb.update(1 / 60, { look: { x: 0, y: -1 }, mouth: 0 }); maxH = Math.max(maxH, tb.hinge); if (tb.lidHitsHead(tb.hinge)) { bad++; console.log('LID IN HEAD at', i); break; } }
console.log('accessories:', listAccessories().length, '| max hinge', maxH.toFixed(2), '| problems:', bad);
// visemes drive the lips
const { VISEMES } = await import('../src/input/visemes.js');
const t2 = new ToiletTuber(themes.base);
for (const [k, v] of Object.entries(VISEMES)) {
  for (let i = 0; i < 40; i++) t2.update(1 / 60, { look: { x: 0, y: 0 }, mouth: v });
  console.log(`viseme ${k.padEnd(4)} hinge=${t2.hinge.toFixed(3)} seat=${t2.s.seat.x.toFixed(3)} smile=${t2.s.smile.x.toFixed(2)} pucker=${t2.s.pucker.x.toFixed(2)} tipCurl=${t2.lidBones.at(-1).rotation.x.toFixed(3)}`);
}
