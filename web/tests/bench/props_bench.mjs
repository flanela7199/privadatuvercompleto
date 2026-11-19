// Cost of the props physics + wet paper: 20 bodies, flush + paper every 5.5 s (spew overlaps the paper).
//   node tests/bench/props_bench.mjs [--frames N]
// A) bare Rust rig (WasmRig, no three.js): 0 vs 20 registered props (several in the water / paper path)
// B) ToiletTuber (wasm mode): theme without vs with 20 physical props (incl. JS rest upload + pose apply)
import { readFileSync } from 'node:fs';
import { seed } from './shim.mjs';
const args = process.argv.slice(2);
const FRAMES = (() => { const i = args.indexOf('--frames'); return i >= 0 ? +args[i + 1] : 3300; })();
const DT = 1 / 60, CYCLE = 330;
globalThis.PRIVADA_WASM_BYTES = readFileSync(new URL('../../pkg/privada_wasm_bg.wasm', import.meta.url));
const { ToiletTuber } = await import('../../src/rig/ToiletTuber.js');
await import('../../src/accessories/extra.js');
const { WasmRig, loadWasm } = await import('../../src/rig/wasmrig.js');
const WASM = await loadWasm();
const now = () => performance.now();
const stats = (a) => { const s = Float64Array.from(a).sort(); let m = 0; for (const x of s) m += x; return { mean: (m / s.length) * 1000, p95: s[Math.floor(s.length * 0.95)] * 1000, max: s[s.length - 1] * 1000 }; };
const fmt = (o) => `mean ${o.mean.toFixed(1)} us  p95 ${o.p95.toFixed(1)} us  max ${o.max.toFixed(1)} us`;
const play = (i, f) => { const k = i % CYCLE; if (k === 0) f('flush'); if (k === 75) f('paper'); };

/* A: bare rig */
const T = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
function bare(nProps) {
  const R = new WasmRig(WASM, 7), r = R.r;
  r.set_props_config('{"resetAfter": 3}');
  const cyl = (rr, h, m) => JSON.stringify({ kind: 'cylinder', size: { r: rr, h }, mass: m, center: [0, h / 2, 0], com: [0, h * 0.4, 0] });
  const box = (x, y, z, m) => JSON.stringify({ kind: 'box', size: [x, y, z], mass: m, center: [0, y / 2, 0] });
  for (let k = 0; k < nProps; k++) {
    const a = (k / nProps) * Math.PI * 2;
    // a ring around him + a row in the landing zone + some next to the paper pile
    const p = k % 3 === 0 ? [-0.3 + (k % 5) * 0.15, 0, 1.5 + (k % 4) * 0.12] : k % 3 === 1 ? [-0.6 + (k % 4) * 0.08, 0, 0.3 + (k % 5) * 0.2] : [Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9];
    r.register_prop(`p${k}`, k % 2 ? cyl(0.04, 0.2, 0.25) : box(0.12, 0.1, 0.12, 0.15), T(...p));
  }
  const t = [];
  for (let i = 0; i < FRAMES + 300; i++) {
    play(i, (a) => r.play(a));
    r.set_input(0.1, 0, 0, 0, 0, 0, 0);
    const t0 = now(); r.update(DT); if (r.pending_events()) r.drain_events(); const el = now() - t0;
    if (i >= 300) t.push(el);
  }
  const active = R.view(14)[23];
  r.free();
  return { ...stats(t), active };
}

/* B: ToiletTuber */
const base = JSON.parse(readFileSync(new URL('../../themes/base.json', import.meta.url)));
const at = (x, z) => ({ transform: { position: [x, 0, z] } });
const PROPS20 = {
  floor_left: [{ id: 'toilet_paper_stack' }, { id: 'toilet_brush_holder', ...at(0.0, 0.6) }],
  floor_right: [{ id: 'plunger' }, { id: 'toilet_brush_holder', ...at(-0.62, 1.7) }, { id: 'toilet_paper_stack', ...at(-0.9, 1.4) },
    { id: 'air_freshener', params: { x: 0 }, ...at(-0.45, 1.9) }, { id: 'air_freshener', params: { x: 0 }, ...at(-0.8, 1.95) }],
  head_top: [{ id: 'rubber_duck' }, { id: 'air_freshener', params: { x: -0.33 } }, { id: 'rubber_duck', params: { x: 0 } }],
};
function tuber(withProps) {
  seed(12345);
  // same accessories both times; the baseline opts out of physics (entry.physics = false)
  const off = Object.fromEntries(Object.entries(PROPS20).map(([k, v]) => [k, v.map((e) => ({ ...e, physics: false }))]));
  const tb = new ToiletTuber({ ...base, slots: { ...(base.slots || {}), ...(withProps ? PROPS20 : off) } });
  const js = { rest: 0, apply: 0 };
  for (const [fn, key] of [['writePropRest', 'rest'], ['applyPropPoses', 'apply']]) {
    const orig = tb[fn].bind(tb);
    tb[fn] = () => { const t0 = now(); orig(); js[key] += now() - t0; };
  }
  tb.on(() => {});
  tb.setPropSettings({ resetAfter: 3 });
  const t = [];
  for (let i = 0; i < FRAMES + 300; i++) {
    play(i, (a) => tb.play(a));
    const t0 = now(); tb.update(DT, { look: { x: 0.1, y: 0 }, mouth: 0 }); const el = now() - t0;
    tb.root.updateMatrixWorld();
    if (i >= 300) t.push(el);
  }
  return { ...stats(t), bodies: tb.props.length, jsRest: (js.rest / t.length) * 1000, jsApply: (js.apply / t.length) * 1000 };
}

const res = { bare0: [], bare20: [], tb0: [], tb20: [] };
for (let k = 0; k < 3; k++) {
  res.bare0.push(bare(0)); res.bare20.push(bare(20));
  res.tb0.push(tuber(false)); res.tb20.push(tuber(true));
}
const best = (a) => a.reduce((x, y) => (y.mean < x.mean ? y : x));
const [b0, b20, t0, t20] = [best(res.bare0), best(res.bare20), best(res.tb0), best(res.tb20)];
console.log(`frames ${FRAMES}, flush + paper every ${CYCLE} frames, best of 3 runs`);
console.log(`A rust rig,  0 props : ${fmt(b0)}`);
console.log(`A rust rig, 20 props : ${fmt(b20)}   (active at end: ${b20.active})`);
console.log(`  -> extra: mean ${(b20.mean - b0.mean).toFixed(1)} us, p95 ${(b20.p95 - b0.p95).toFixed(1)} us`);
console.log(`B ToiletTuber, same accessories, physics off : ${fmt(t0)}`);
console.log(`B ToiletTuber, ${t20.bodies} bodies               : ${fmt(t20)}   (JS rest upload ${t20.jsRest.toFixed(1)} us, JS pose apply ${t20.jsApply.toFixed(1)} us)`);
console.log(`  -> extra: mean ${(t20.mean - t0.mean).toFixed(1)} us, p95 ${(t20.p95 - t0.p95).toFixed(1)} us`);
