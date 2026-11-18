// Runs rig_bench.mjs in fresh processes (modes interleaved: js, wasm, js, wasm...),
// aggregates the runs and prints markdown tables + writes results/summary.json.
//   node tests/bench/run_all.mjs [--runs 5] [--quick]
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const RUNS = (() => { const i = args.indexOf('--runs'); return i >= 0 ? Number(args[i + 1]) : 5; })();
const QUICK = args.includes('--quick');
const here = new URL('.', import.meta.url);
const resDir = new URL('results/', here);
mkdirSync(resDir, { recursive: true });
const bench = fileURLToPath(new URL('rig_bench.mjs', here));
const run = (mode, extra = []) => {
  const r = spawnSync(process.execPath, ['--expose-gc', bench, mode, ...extra, ...(QUICK ? ['--quick'] : [])], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.error(r.stderr); throw new Error(`${mode} failed`); }
  const line = r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  return JSON.parse(line);
};

// ---- load / instantiate (cold, one process each)
const loads = [];
for (let i = 0; i < 7; i++) loads.push(run('load'));
// ---- per-frame benchmarks
const runs = { js: [], wasm: [] };
for (let i = 0; i < RUNS; i++) for (const m of ['js', 'wasm']) {
  const t0 = Date.now();
  const d = run(m, i === 0 ? [] : ['--no-traces']);
  writeFileSync(new URL(`run-${m}-${i}.json`, resDir), JSON.stringify(d));
  runs[m].push(d);
  console.error(`run ${i} ${m}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// ---- aggregate
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
const cv = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); return m ? (sd / m) * 100 : 0; };
const agg = (vals) => ({ med: +med(vals).toFixed(2), min: +Math.min(...vals).toFixed(2), max: +Math.max(...vals).toFixed(2), cvPct: +cv(vals).toFixed(1), runs: vals.map((v) => +v.toFixed(1)) });
const scen = Object.keys(runs.js[0].scenarios);
const summary = { machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, node: process.version, platform: `${os.platform()} ${os.release()}` }, runs: RUNS, frames: runs.js[0].frames, warm: runs.js[0].warm, scenarios: {} };

const wasmFile = new URL('../../pkg/privada_wasm_bg.wasm', here), glueFile = new URL('../../pkg/privada_wasm.js', here);
const wb = readFileSync(wasmFile), gb = readFileSync(glueFile);
summary.size = { wasm: statSync(wasmFile).size, wasmGzip: gzipSync(wb, { level: 9 }).length, wasmBrotli: brotliCompressSync(wb).length, glue: gb.length, glueGzip: gzipSync(gb, { level: 9 }).length };
const lkeys = Object.keys(loads[0]).filter((k) => typeof loads[0][k] === 'number');
summary.load = Object.fromEntries(lkeys.map((k) => [k, agg(loads.map((l) => l[k]))]));
summary.loadInApp = { wasmInitMs: agg(runs.wasm.map((r) => r.load.initMs)), importMs: { js: agg(runs.js.map((r) => r.load.importMs)), wasm: agg(runs.wasm.map((r) => r.load.importMs)) } };
summary.memory = { js: runs.js.map((r) => r.memory), wasm: runs.wasm.map((r) => r.memory) };

for (const s of scen) {
  const o = {};
  for (const m of ['js', 'wasm']) {
    const R = runs[m].map((r) => r.scenarios[s]);
    const pick = (f) => agg(R.map(f));
    o[m] = {
      update: { median: pick((r) => r.clean.update.median), p95: pick((r) => r.clean.update.p95), p99: pick((r) => r.clean.update.p99), mean: pick((r) => r.clean.update.mean), max: pick((r) => r.clean.update.max) },
      updatePlusMatrix: { median: pick((r) => r.clean.updatePlusMatrix.median), p95: pick((r) => r.clean.updatePlusMatrix.p95), p99: pick((r) => r.clean.updatePlusMatrix.p99) },
      matrixWorld: { median: pick((r) => r.clean.matrixWorld.median) },
      spew: R[0].clean.spew ? { median: pick((r) => r.clean.spew.median), p95: pick((r) => r.clean.spew.p95), p99: pick((r) => r.clean.spew.p99) } : null,
      rustOnly: R[0].rustOnly ? { median: pick((r) => r.rustOnly.median), p95: pick((r) => r.rustOnly.p95), p99: pick((r) => r.rustOnly.p99), mean: pick((r) => r.rustOnly.mean) } : null,
      breakdown: Object.fromEntries(Object.keys(R[0].breakdown).map((k) => [k, +med(R.map((r) => r.breakdown[k])).toFixed(2)])),
      alloc: Object.fromEntries(Object.keys(R[0].alloc).map((k) => [k, +med(R.map((r) => r.alloc[k])).toFixed(3)])),
    };
  }
  // correctness: compare the traces of run 0 (deterministic inputs, same dt)
  const A = runs.js[0].scenarios[s].traces, B = runs.wasm[0].scenarios[s].traces;
  const corr = (x, y) => { const n = x.length; const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : (sxx === syy ? 1 : 0); };
  const rms = (x, y) => Math.sqrt(x.reduce((a, v, i) => a + (v - y[i]) ** 2, 0) / x.length);
  const mean = (x) => x.reduce((a, b) => a + b, 0) / x.length;
  const c = {};
  for (const k of ['hinge', 'bodyY', 'bodyUpY', 'headPitch', 'pupilX', 'seatX', 'drops', 'foam', 'stream', 'paperPts', 'tornPts']) {
    const x = A[k], y = B[k];
    c[k] = { js: { min: +Math.min(...x).toFixed(4), max: +Math.max(...x).toFixed(4), mean: +mean(x).toFixed(4) }, wasm: { min: +Math.min(...y).toFixed(4), max: +Math.max(...y).toFixed(4), mean: +mean(y).toFixed(4) }, r: +corr(x, y).toFixed(4), rms: +rms(x, y).toFixed(4) };
  }
  c.sfx = { js: A.sfx, wasm: B.sfx };
  o.correctness = c;
  summary.scenarios[s] = o;
}
writeFileSync(new URL('summary.json', resDir), JSON.stringify(summary, null, 1));

// ---- markdown tables
const f = (x) => (x == null ? '-' : x < 10 ? x.toFixed(1) : x.toFixed(0));
const L = [];
L.push(`machine: ${summary.machine.cpu} (${summary.machine.cores} threads), node ${summary.machine.node}, ${summary.machine.platform}; ${RUNS} runs x ${summary.frames} frames (+${summary.warm} warm-up) per scenario`);
L.push('\n### tb.update() per frame, us (median of the per-run values; [min..max] across runs; CV%)\n');
L.push('| scenario | mode | median | p95 | p99 | mean | +matrixWorld median | +matrixWorld p99 | headroom @60 (median) |');
L.push('|---|---|---|---|---|---|---|---|---|');
for (const s of scen) for (const m of ['js', 'wasm']) {
  const u = summary.scenarios[s][m].update, um = summary.scenarios[s][m].updatePlusMatrix;
  const rg = (a) => `${f(a.med)} [${f(a.min)}..${f(a.max)}] ${a.cvPct}%`;
  L.push(`| ${s} | ${m} | ${rg(u.median)} | ${rg(u.p95)} | ${rg(u.p99)} | ${f(u.mean.med)} | ${f(um.median.med)} | ${f(um.p99.med)} | ${(16667 / um.median.med).toFixed(0)}x |`);
}
L.push('\n### speedup JS/wasm (tb.update median; p99)\n');
L.push('| scenario | median speedup | p99 speedup | Rust compute only (median / p99 us) | flush spew window median js / wasm |');
L.push('|---|---|---|---|---|');
for (const s of scen) {
  const j = summary.scenarios[s].js, w = summary.scenarios[s].wasm;
  L.push(`| ${s} | ${(j.update.median.med / w.update.median.med).toFixed(2)}x | ${(j.update.p99.med / w.update.p99.med).toFixed(2)}x | ${f(w.rustOnly.median.med)} / ${f(w.rustOnly.p99.med)} | ${j.spew ? `${f(j.spew.median.med)} / ${f(w.spew.median.med)}` : '-'} |`);
}
L.push('\n### breakdown (instrumented pass, exclusive us/frame, median of runs)\n');
for (const s of scen) for (const m of ['js', 'wasm']) L.push(`- ${s} ${m}: ${Object.entries(summary.scenarios[s][m].breakdown).map(([k, v]) => `${k}=${v}`).join(', ')}`);
L.push('\n### allocation / GC (median of runs)\n');
L.push('| scenario | mode | bytes/frame | KB/s @60 | scavenges | major GC | GC us/frame |');
L.push('|---|---|---|---|---|---|---|');
for (const s of scen) for (const m of ['js', 'wasm']) { const a = summary.scenarios[s][m].alloc; L.push(`| ${s} | ${m} | ${a.allocBytesPerFrame} | ${a.allocKBPerSecAt60} | ${a.gcScavenges} | ${a.gcMajor} | ${a.gcCostUsPerFrame} |`); }
L.push('\n### correctness (run 0 traces; r = Pearson correlation js vs wasm)\n');
for (const s of scen) {
  const c = summary.scenarios[s].correctness;
  L.push(`- ${s}: ` + Object.entries(c).map(([k, v]) => k === 'sfx' ? `sfx js=${v.js} wasm=${v.wasm}` : `${k} js[${v.js.min}..${v.js.max}] wasm[${v.wasm.min}..${v.wasm.max}] r=${v.r} rms=${v.rms}`).join('; '));
}
L.push('\n### load\n');
L.push(JSON.stringify(summary.size));
L.push(Object.entries(summary.load).map(([k, v]) => `${k}: med ${v.med} [${v.min}..${v.max}]`).join('\n'));
L.push(`in-app wasm init (compile+instantiate, warm process): ${JSON.stringify(summary.loadInApp)}`);
L.push(`memory: ${JSON.stringify(summary.memory)}`);
const md = L.join('\n');
writeFileSync(new URL('summary.md', resDir), md);
console.log(md);
