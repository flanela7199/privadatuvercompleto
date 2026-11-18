// Per-frame cost of the character logic: Rust/wasm rig vs pure-JS rig, headless in Node.
//   node --expose-gc tests/bench/rig_bench.mjs <js|wasm|load> [--frames N] [--warm N] [--quick]
// Prints one JSON object on stdout (run_all.mjs aggregates several processes).
// The mode must be chosen per process: ToiletTuber.js loads (or skips) wasm at import time.
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
import { seed } from './shim.mjs';

const args = process.argv.slice(2);
const MODE = args[0] || 'js';
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const QUICK = args.includes('--quick');
const FRAMES = opt('--frames', QUICK ? 660 : 3960);   // 3960 = 12 flush cycles = 66 s of animation
const WARM = opt('--warm', QUICK ? 120 : 600);
const DT = 1 / 60;
const SEED = 12345;
const now = () => performance.now();
const WASM_URL = new URL('../../pkg/privada_wasm_bg.wasm', import.meta.url);
const GLUE = '../../pkg/privada_wasm.js';

/* ------------------------------------------------------------------ load-only mode */
if (MODE === 'load') {
  const out = { mode: 'load' };
  let t = now(); const bytes = readFileSync(WASM_URL); out.readMs = now() - t;
  out.wasmBytes = bytes.length;
  t = now(); const pkg = await import(GLUE); out.glueImportMs = now() - t;
  t = now(); const module = await WebAssembly.compile(bytes); out.compileMs = now() - t;
  t = now(); const exp = pkg.initSync({ module }); out.instantiateMs = now() - t;
  out.memPagesAfterInit = exp.memory.buffer.byteLength / 65536;
  t = now(); const rig = new pkg.Rig(7); out.rigCtorMs = now() - t;
  out.memPagesAfterRig = exp.memory.buffer.byteLength / 65536;
  t = now(); rig.update(DT); out.firstUpdateMs = now() - t;
  t = now(); for (let i = 0; i < 59; i++) rig.update(DT); out.next59UpdatesMs = now() - t;
  console.log(JSON.stringify(out));
  process.exit(0);
}

/* ------------------------------------------------------------------ setup */
const RUST = MODE === 'wasm';
const loadInfo = {};
const mem0 = process.memoryUsage();
if (RUST) {
  let t = now();
  const bytes = readFileSync(WASM_URL);
  globalThis.PRIVADA_WASM_BYTES = bytes;
  const pkg = await import(GLUE);
  t = now();
  await pkg.default({ module_or_path: bytes });   // the same call loadWasm() makes (it then reuses this)
  loadInfo.initMs = now() - t;                    // compile + instantiate, as in the app
} else globalThis.PRIVADA_NO_WASM = true;

let t = now();
const THREE = await import('three');
const { ToiletTuber } = await import('../../src/rig/ToiletTuber.js');
try { await import('../../src/accessories/extra.js'); } catch { /* optional */ }
const { BUF, SC, WasmRig, loadWasm } = await import('../../src/rig/wasmrig.js');
const { VISEMES } = await import('../../src/input/visemes.js');
loadInfo.importMs = now() - t;
const memMB = (m) => ({ rssMB: +(m.rss / 2 ** 20).toFixed(1), heapUsedMB: +(m.heapUsed / 2 ** 20).toFixed(2), externalMB: +(m.external / 2 ** 20).toFixed(2), arrayBuffersMB: +(m.arrayBuffers / 2 ** 20).toFixed(2) });
globalThis.gc?.();
const memAfterImport = process.memoryUsage();
const theme = JSON.parse(readFileSync(new URL('../../themes/base.json', import.meta.url)));
const WASM = RUST ? await loadWasm() : null;

function newTuber() {
  seed(SEED);
  const t0 = now();
  const tb = new ToiletTuber(theme);
  const ms = now() - t0;
  if (tb.usesRust !== RUST) throw new Error(`expected usesRust=${RUST}, got ${tb.usesRust}`);
  tb.on(() => {});   // a listener, like the app's sfx hook
  return { tb, ctorMs: ms };
}

/* ------------------------------------------------------------------ scenarios */
// Inputs are preallocated so the harness itself allocates nothing per frame.
const VIS = Object.values(VISEMES).map((v) => ({ open: 0, round: 0, wide: 0, closed: 0, sib: 0, ...v }));
const looks = Array.from({ length: 1024 }, (_, i) => ({ x: Math.sin(i / 37) * 0.9, y: Math.cos(i / 53) * 0.6 }));
const STILL = { look: { x: 0.1, y: 0 }, mouth: 0 };
const talkIn = (i) => ({ look: looks[i % 1024], mouth: VIS[((i / 5) | 0) % VIS.length] });
const TALK = Array.from({ length: 1024 * VIS.length }, (_, i) => talkIn(i));
const talk = (i) => TALK[i % TALK.length];
const SCEN = {
  idle_talk: { input: talk, play: () => null },
  flush: { input: () => STILL, play: (i) => (i % 330 === 0 ? ['flush'] : null), cycle: 330 },
  paper: { input: () => STILL, play: (i) => (i % 280 === 0 ? ['paper'] : null), cycle: 280 },
  flips: { input: () => STILL, play: (i) => (i % 160 === 0 ? ['backflip'] : i % 160 === 100 ? ['jump'] : null), cycle: 160 },
  all: { input: talk, play: (i) => (i % 330 === 0 ? ['flush', 'paper'] : null), cycle: 330 },
};
const ONLY = process.env.BENCH_SCEN ? process.env.BENCH_SCEN.split(',') : Object.keys(SCEN);

const stats = (arr) => {
  const a = Float64Array.from(arr).sort();
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  let sum = 0; for (const x of a) sum += x;
  return { n: a.length, mean: sum / a.length, median: q(0.5), p95: q(0.95), p99: q(0.99), max: a[a.length - 1], min: a[0] };
};
const toUs = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'n' ? v : +(v * 1000).toFixed(2)]));

function drive(tb, sc, i) {
  const acts = sc.play(i);
  if (acts) for (const a of acts) tb.play(a);
  tb.update(DT, sc.input(i));
}

/* 1. clean timing: tb.update() alone, and + root.updateMatrixWorld() (what three's renderer does next) */
function timeClean(name) {
  const sc = SCEN[name];
  const { tb, ctorMs } = newTuber();
  for (let i = 0; i < WARM; i++) { drive(tb, sc, i); tb.root.updateMatrixWorld(); }
  const up = new Float64Array(FRAMES), mw = new Float64Array(FRAMES);
  for (let k = 0; k < FRAMES; k++) {
    const i = WARM + k;
    const acts = sc.play(i);
    const input = sc.input(i);
    const t0 = now();
    if (acts) for (const a of acts) tb.play(a);
    tb.update(DT, input);
    const t1 = now();
    tb.root.updateMatrixWorld();
    mw[k] = now() - t1;
    up[k] = t1 - t0;
  }
  const both = up.map((x, k) => x + mw[k]);
  // spew window of the flush (t in 1.6..3.4 s of each cycle): the very heaviest frames
  let spew = null;
  if (name === 'flush' || name === 'all') {
    const w = []; for (let k = 0; k < FRAMES; k++) { const t = ((WARM + k) % 330) * DT; if (t > 1.6 && t < 3.4) w.push(up[k]); }
    spew = toUs(stats(w));
  }
  return { ctorMs, update: toUs(stats(up)), matrixWorld: toUs(stats(mw)), updatePlusMatrix: toUs(stats(both)), spew };
}

/* 2. Rust compute alone: a bare WasmRig (no three.js), same inputs/actions */
function timeRustOnly(name) {
  const sc = SCEN[name];
  seed(SEED);
  const R = new WasmRig(WASM, (Math.random() * 4294967295) >>> 0), r = R.r;
  r.set_rest(0.05);
  const step = (i, timed) => {
    const acts = sc.play(i); const input = sc.input(i);
    const t0 = timed ? now() : 0;
    if (acts) for (const a of acts) r.play(a);
    const lk = input.look, m = typeof input.mouth === 'number' ? { open: input.mouth } : input.mouth;
    r.set_input(lk.x, lk.y, m.open || 0, m.round || 0, m.wide || 0, m.closed || 0, m.sib || 0);
    r.update(DT);
    r.drain_events();
    return timed ? now() - t0 : 0;
  };
  for (let i = 0; i < WARM; i++) step(i, false);
  const a = new Float64Array(FRAMES);
  for (let k = 0; k < FRAMES; k++) a[k] = step(WARM + k, true);
  r.free();
  return toUs(stats(a));
}

/* 3. instrumented pass: where the time goes inside tb.update() (wrappers add ~0.05 us per call) */
function timeBreakdown(name) {
  const sc = SCEN[name];
  const { tb } = newTuber();
  const acc = {};
  const stack = [];   // exclusive (self) time: nested wrapped calls are charged to themselves only
  const wrap = (obj, fn, key) => {
    const orig = obj[fn];
    acc[key] ??= 0;
    obj[fn] = function (...a) {
      stack.push(0);
      const t0 = now(); const r = orig.apply(this, a); const el = now() - t0;
      acc[key] += el - stack.pop();
      if (stack.length) stack[stack.length - 1] += el;
      return r;
    };
  };
  // three.js geometry work done in BOTH modes (normals of the stream tube and paper strips)
  wrap(tb.jet.stream.geometry, 'computeVertexNormals', 'three_normals_stream');
  for (const p of [tb.paper, tb.torn]) { wrap(p.geo, 'computeVertexNormals', 'three_normals_paper'); wrap(p.perf, 'computeLineDistances', 'three_normals_paper'); }
  if (RUST) {
    wrap(tb.rust.r, 'set_input', 'rust_compute'); wrap(tb.rust.r, 'update', 'rust_compute'); wrap(tb.rust.r, 'drain_events', 'rust_compute');
  } else {
    wrap(tb.jet, 'update', 'js_water_fx');
    wrap(tb.paper, 'update', 'js_paper_fx'); wrap(tb.torn, 'update', 'js_paper_fx');
    wrap(tb, 'applyLid', 'js_lid_collision');
    wrap(tb, 'updatePaperAnchor', 'js_matrix_world_anchor');
    wrap(tb.root, 'updateMatrixWorld', 'js_matrix_world_anchor');
  }
  for (const a of tb.accessories) wrap(a, 'traverse', 'js_accessories');
  const keys = Object.keys(acc);
  for (let i = 0; i < WARM; i++) drive(tb, sc, i);
  for (const k of keys) acc[k] = 0;
  let total = 0;
  for (let k = 0; k < FRAMES; k++) { const t0 = now(); drive(tb, sc, WARM + k); total += now() - t0; }
  const out = { total: total / FRAMES * 1000 };
  let rest = total;
  for (const k of keys) { out[k] = acc[k] / FRAMES * 1000; rest -= acc[k]; }
  out[RUST ? 'js_apply_pose_buffers_rest' : 'js_springs_actions_rest'] = rest / FRAMES * 1000;
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, +v.toFixed(2)]));
}

/* 4. allocation / GC: heap growth + V8 GC profiler over FRAMES frames */
function measureAlloc(name) {
  const sc = SCEN[name];
  const { tb } = newTuber();
  for (let i = 0; i < WARM; i++) drive(tb, sc, i);
  const wasmMem = () => (RUST ? WASM.memory.buffer.byteLength : 0);
  const w0 = wasmMem();
  globalThis.gc?.(); globalThis.gc?.();
  const h0 = process.memoryUsage();
  const prof = new v8.GCProfiler();
  prof.start();
  for (let k = 0; k < FRAMES; k++) drive(tb, sc, WARM + k);
  const h1 = process.memoryUsage();
  const res = prof.stop();
  let freed = 0, cost = 0, scav = 0, major = 0;
  for (const g of res?.statistics || []) {
    const b = g.beforeGC?.heapStatistics?.usedHeapSize ?? 0, a = g.afterGC?.heapStatistics?.usedHeapSize ?? 0;
    freed += Math.max(0, b - a); cost += g.cost || 0;
    if (/scavenge/i.test(g.gcType)) scav++; else major++;
  }
  const allocated = freed + (h1.heapUsed - h0.heapUsed);
  return {
    allocBytesPerFrame: Math.round(allocated / FRAMES),
    allocKBPerSecAt60: +(allocated / FRAMES * 60 / 1024).toFixed(1),
    gcScavenges: scav, gcMajor: major, gcCostMsTotal: +(cost / 1000).toFixed(2),
    gcCostUsPerFrame: +(cost / FRAMES).toFixed(3),
    heapUsedDeltaKB: +((h1.heapUsed - h0.heapUsed) / 1024).toFixed(1),
    wasmMemGrowBytes: wasmMem() - w0, wasmPages: wasmMem() / 65536,
  };
}

/* 5. correctness traces: observable motion read back from the three.js objects */
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
function liveInstances(mesh) {
  const a = mesh.instanceMatrix.array; let n = 0;
  for (let i = 0; i < mesh.count; i++) { const o = i * 16; if (a[o] !== 0 || a[o + 5] !== 0 || a[o + 10] !== 0) n++; }
  return n;
}
function traces(name) {
  const sc = SCEN[name];
  const { tb } = newTuber();
  const N = (sc.cycle || 330) * 2;
  const T = { hinge: [], bodyY: [], bodyUpY: [], headPitch: [], pupilX: [], seatX: [], drops: [], foam: [], stream: [], paperPts: [], tornPts: [], sfx: 0 };
  tb.on(() => { T.sfx++; });
  for (let i = 0; i < N; i++) {
    drive(tb, sc, i);
    tb.root.updateMatrixWorld();
    T.hinge.push(tb.hinge);
    T.bodyY.push(tb.body.position.y);
    T.bodyUpY.push(_v.set(0, 1, 0).applyQuaternion(tb.body.quaternion).y);
    T.headPitch.push(_e.setFromQuaternion(tb.head.quaternion, 'XYZ').x);
    T.pupilX.push(tb.eyes[0].pupil.position.x);
    T.seatX.push(-_e.setFromQuaternion(tb.nodes.seatPivot.quaternion, 'XYZ').x);
    T.drops.push(liveInstances(tb.jet.drops.mesh));
    T.foam.push(liveInstances(tb.jet.foam.mesh));
    T.stream.push(tb.jet.stream.visible ? 1 : 0);
    if (RUST) { const S = tb.rust.view(BUF.SCALARS); T.paperPts.push(S[SC.PAPER_COUNT]); T.tornPts.push(S[SC.TORN_COUNT] * (S[SC.TORN_OPACITY] > 0 ? 1 : 0)); }
    else { T.paperPts.push(tb.paper.pts.length); T.tornPts.push(tb.torn.fade > 0 ? tb.torn.pts.length : 0); }
  }
  for (const k in T) if (Array.isArray(T[k])) T[k] = T[k].map((x) => +x.toFixed(5));
  return T;
}

/* ------------------------------------------------------------------ run */
const out = { mode: MODE, node: process.version, frames: FRAMES, warm: WARM, load: loadInfo, scenarios: {} };
for (const name of ONLY) {
  const r = {};
  r.clean = timeClean(name);
  if (RUST) r.rustOnly = timeRustOnly(name);
  r.breakdown = timeBreakdown(name);
  r.alloc = measureAlloc(name);
  if (!args.includes('--no-traces')) r.traces = traces(name);
  out.scenarios[name] = r;
}
// one tuber built and run 600 frames, everything else collected
globalThis.gc?.();
const wasmPagesBeforeOne = RUST ? WASM.memory.buffer.byteLength / 65536 : 0;
const one = newTuber().tb;
for (let i = 0; i < 600; i++) drive(one, SCEN.all, i);
globalThis.gc?.(); globalThis.gc?.();
const memOne = process.memoryUsage();
out.memory = {
  start: memMB(mem0), afterImportsAndInit: memMB(memAfterImport), endWithOneTuberLive: memMB(memOne),
  wasmPagesEnd: RUST ? WASM.memory.buffer.byteLength / 65536 : 0, wasmPagesBeforeLastTuber: wasmPagesBeforeOne,
};
console.log(JSON.stringify(out));
