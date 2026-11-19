// Props physics + wet paper through ToiletTuber (Rust/wasm rig): a brush holder placed in the flush's
// landing zone gets knocked over (its wrapper follows the Rust pose, a thud sfx fires), the other props
// stay attached, settled props fly back to their sockets, and paper soaked by the spew gets vertex colours.
//   node tests/props_smoke.mjs        (needs web/node_modules/three and web/pkg)
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
const THREE = await import('three');
const { ToiletTuber } = await import('../src/rig/ToiletTuber.js');
await import('../src/accessories/extra.js');

let bad = 0;
const ok = (c, msg) => { if (!c) { bad++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const base = JSON.parse(readFileSync(new URL('../themes/base.json', import.meta.url)));
const theme = {
  ...base,
  body: { ...(base.body || {}), roll: { mount: 'front' } },
  slots: {
    ...(base.slots || {}),
    floor_left: [{ id: 'toilet_paper_stack' }],
    // floor_right socket is at root (0.62, 0, 0.15): move this one into the jet's landing zone (z ~1.85)
    floor_right: [{ id: 'plunger' }, { id: 'toilet_brush_holder', transform: { position: [-0.62, 0, 1.7] } }],
    head_top: [{ id: 'rubber_duck' }, { id: 'air_freshener', params: { x: -0.33 } }],
  },
};
const tb = new ToiletTuber(theme);
ok(tb.usesRust, 'Rust rig');
const sfx = [];
tb.on((t, d) => { if (t === 'sfx') sfx.push(typeof d === 'string' ? d : d.type); });
tb.setPropSettings({ resetAfter: 2 });
ok(tb.props.length === 10, `registered ${tb.props.length} bodies (6 rolls + plunger + brush + duck + spray)`);
const brush = tb.props.find((p) => p.id.includes('toilet_brush_holder'));
const plunger = tb.props.find((p) => p.id.includes('plunger'));
const roll0 = tb.props.find((p) => p.id.includes('toilet_paper_stack#'));
const r = tb.rust.r;
const S = () => tb.rust.view(14);
let maxActive = 0, brushMoved = 0, wetMax = 0, colMin = 1, finite = true, stackHit = false;
const step = (n, each) => { for (let i = 0; i < n; i++) { tb.update(1 / 60, { look: { x: 0, y: 0 }, mouth: 0 }); tb.root.updateMatrixWorld(); each?.(); } };
const watch = () => {
  maxActive = Math.max(maxActive, S()[23]);
  brushMoved = Math.max(brushMoved, brush.target.position.distanceTo(brush.p0) + brush.target.quaternion.angleTo(brush.q0));
  wetMax = Math.max(wetMax, S()[20], S()[21]);
  stackHit ||= roll0.dyn;
  for (const ps of [tb.paper, tb.torn]) { const a = ps.geo.attributes.color.array; for (let k = 3; k < 300 * 4; k += 4) colMin = Math.min(colMin, a[k]); }
  for (const p of tb.props) finite &&= Number.isFinite(p.target.position.x + p.target.quaternion.w + p.target.scale.y);
};
// 1. flush alone: the column lands on the brush holder
tb.play('flush');
step(330, watch);
ok(maxActive >= 1, `props knocked loose (max active ${maxActive})`);
ok(brushMoved > 0.2, `brush holder wrapper follows the Rust pose (moved ${brushMoved.toFixed(2)})`);
ok(sfx.includes('thud'), `thud sfx (${sfx.filter((s) => s === 'thud').length}x)`);
ok(!plunger.dyn && plunger.target.position.distanceTo(plunger.p0) < 1e-6, 'plunger (not hit) stays attached');
ok(!tb.props.some((p) => p.id.includes('head_top') && p.dyn), 'duck + spray on the tank (not hit) stay attached');
ok(finite, 'all prop transforms finite');
// settle + reset (resetAfter 2 s)
for (let i = 0; i < 60 * 8; i++) { tb.update(1 / 60, { look: { x: 0, y: 0 }, mouth: 0 }); tb.root.updateMatrixWorld(); }
ok(S()[23] === 0 && !brush.dyn, `back in their sockets (active ${S()[23]})`);
ok(brush.target.position.distanceTo(brush.p0) < 1e-6, 'brush holder local transform restored');
ok(sfx.includes('pop'), 'pop sfx on reset');
// 2. flush, then the paper streams out through the spew: it gets wet (front roll: the pile reaches the
// puddle) and the pile on the floor runs into the paper stack next to him
tb.play('flush');
step(75);
tb.play('paper');
step(420, watch);
ok(wetMax > 0.3 && colMin < 0.9, `paper got wet (max ${wetMax.toFixed(2)}, min vertex alpha ${colMin.toFixed(2)})`);
console.log(`info paper pile knocked the stack: ${stackHit}`);
ok(finite, 'all prop transforms finite');
step(60 * 8);
// kick: debug API + group wake (the whole stack scatters)
ok(tb.kickProp(roll0.id, 0, 0.05, 0.12), 'kickProp');
for (let i = 0; i < 90; i++) { tb.update(1 / 60, { look: { x: 0, y: 0 }, mouth: 0 }); tb.root.updateMatrixWorld(); }
ok(tb.props.filter((p) => p.id.includes('toilet_paper_stack#') && p.dyn).length === 6, 'the stack scatters as 6 rolls');
// rebuild keeps everything consistent
tb.buildAccessories();
ok(r.prop_count() === tb.props.length, `rebuild re-registers (${r.prop_count()})`);
tb.setPropSettings({ enabled: false });
console.log(bad ? `props smoke: ${bad} problem(s)` : 'props smoke: ok');
process.exit(bad ? 1 : 0);
