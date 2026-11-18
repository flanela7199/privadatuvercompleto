// Geometry benchmark + equivalence check: JS builders vs Rust (wasm) builders vs mesh-cache hits.
//   cd web && node tests/bench/geo_bench.mjs            (needs web/node_modules/three shim)
// Spawns two child processes (mode js / rust) that build the same meshes, dump the arrays
// to .tmp/geo_bench/<mode>/ and report timings; the parent compares the arrays.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../..');
const OUT = path.resolve(WEB, '../.tmp/geo_bench');
const [, , cmd, mode] = process.argv;

const readF64 = (f) => { const b = fs.readFileSync(f); return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

if (cmd === 'child') {
  if (mode === 'js') globalThis.PRIVADA_NO_GEO = true;
  globalThis.PRIVADA_WASM_BYTES = fs.readFileSync(path.join(WEB, 'pkg/privada_wasm_bg.wasm'));
  await import('./shim.mjs');
  const THREE = await import('three');
  const geoc = await import('../../src/rig/geocache.js');
  const { buildAccessory } = await import('../../src/accessories/index.js');
  await import('../../src/accessories/extra.js');
  const { MaterialLib } = await import('../../src/rig/materials.js');
  const { eggRevolve, lidProfile, seatProfile } = await import('../../src/rig/geo.js');
  const { ToiletTuber, DIM } = await import('../../src/rig/ToiletTuber.js');
  const { mergeTheme } = await import('../../src/themes.js');
  const themesDir = path.join(WEB, 'themes');
  const raw = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(themesDir, 'index.json'))).map((id) => [id, JSON.parse(fs.readFileSync(path.join(themesDir, id + '.json')))]));
  const themes = {};
  for (const id in raw) themes[id] = raw[id].extends ? mergeTheme(raw[raw[id].extends], raw[id]) : raw[id];
  const mats = new MaterialLib(themes.base.materials);
  const ctx = { THREE, mats, theme: themes.base, dim: DIM };

  const dir = path.join(OUT, mode);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const dump = (name, geo) => {
    const parts = { pos: geo.attributes.position?.array, nrm: geo.attributes.normal?.array, uv: geo.attributes.uv?.array, idx: geo.index?.array };
    for (const [k, a] of Object.entries(parts)) if (a) fs.writeFileSync(path.join(dir, `${name}.${k}.bin`), Buffer.from(new Float64Array(Array.from(a)).buffer));
  };
  const geosOf = (obj) => { const out = []; obj.traverse((o) => { if (o.isMesh || o.isInstancedMesh) out.push(o.geometry); }); return out; };

  const targets = [
    ['seat', () => eggRevolve(DIM.seat.rx, DIM.seat.rz, DIM.egg, seatProfile(DIM.seat.rx, DIM.seat.hole, DIM.seat.h), 160)],
    ['lid', () => eggRevolve(DIM.lid.rx, DIM.lid.rz, DIM.egg, lidProfile(DIM.lid.rx, DIM.lid.depth, DIM.lid.dome, DIM.lid.edge), 160)],
    ['crown', () => buildAccessory(ctx, { id: 'crown', params: { points: 8, tilt: 0.12, radius: 0.15 } })],
    ['ushanka', () => buildAccessory(ctx, { id: 'ushanka' })],
    ...[...geoc.RUST_MUSTACHES.size ? geoc.RUST_MUSTACHES : ['mustache_handlebar', 'mustache_walrus', 'mustache_chevron', 'mustache_pencil', 'mustache_fu_manchu', 'mustache_horseshoe', 'mustache_english', 'mustache_dali', 'mustache_imperial', 'mustache_lampshade', 'mustache_pancho', 'mustache_curly']]
      .map((id) => [id, () => buildAccessory(ctx, { id })]),
  ];
  const res = { mode, items: {}, themes: {} };
  for (const [name, fn] of targets) {
    const t0 = performance.now();
    const first = fn();
    const cold = performance.now() - t0;
    const again = [];
    for (let i = 0; i < 5; i++) { const t = performance.now(); fn(); again.push(performance.now() - t); }
    const geos = first.isBufferGeometry ? [first] : geosOf(first);
    geos.forEach((g, i) => dump(`${name}.${i}`, g));
    let verts = 0; geos.forEach((g) => (verts += g.attributes.position.count));
    res.items[name] = { cold, warm: median(again), verts, geos: geos.length };
  }
  // pure Rust build (bypasses the cache) and decode-only (= persistent cache hit, minus IO)
  if (mode === 'rust') {
    const W = globalThis.PRIVADA_WASM_BYTES && (await import('../../pkg/privada_wasm.js'));
    for (const id of geoc.RUST_MUSTACHES) {
      const p = geoc.mustacheParams(id, {}, DIM);
      const tb = [], td = [];
      for (let i = 0; i < 5; i++) {
        let t = performance.now();
        const bytes = p.map((q) => W.build_mesh_prvm('mustache', geoc.stableStringify(q)));
        tb.push(performance.now() - t);
        t = performance.now();
        bytes.forEach((b) => geoc.decodeGeometry(b));
        td.push(performance.now() - t);
      }
      res.items[id].rustBuild = median(tb);
      res.items[id].decode = median(td);
    }
  }
  for (const id of ['base', 'soviet', 'golden']) {
    const t0 = performance.now();
    new ToiletTuber(themes[id]);
    const cold = performance.now() - t0;
    const again = [];
    for (let i = 0; i < 3; i++) { const t = performance.now(); new ToiletTuber(themes[id]); again.push(performance.now() - t); }
    res.themes[id] = { cold, warm: median(again) };
  }
  res.stats = geoc.stats;
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(res, null, 1));
  process.exit(0);
}

/* ------------------------------------------------------------ parent */
const runs = {};
for (const m of ['js', 'rust']) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child', m], { cwd: WEB, encoding: 'utf8' });
  if (r.status !== 0) { console.error(m, r.stderr || r.stdout); process.exit(1); }
  runs[m] = JSON.parse(fs.readFileSync(path.join(OUT, m, 'result.json')));
}
// compare arrays
const files = fs.readdirSync(path.join(OUT, 'js')).filter((f) => f.endsWith('.bin'));
const cmp = {};
for (const f of files) {
  const name = f.split('.')[0];
  const a = readF64(path.join(OUT, 'js', f));
  const bp = path.join(OUT, 'rust', f);
  const c = (cmp[name] ||= { arrays: 0, exact: 0, maxAbs: 0, missing: 0, lenMismatch: 0 });
  c.arrays++;
  if (!fs.existsSync(bp)) { c.missing++; continue; }
  const b = readF64(bp);
  if (a.length !== b.length) { c.lenMismatch++; continue; }
  let max = 0, same = true;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > max) max = d; if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) same = false; }
  if (same) c.exact++;
  c.maxAbs = Math.max(c.maxAbs, max);
}
const rows = [];
for (const name of Object.keys(runs.js.items)) {
  const j = runs.js.items[name], r = runs.rust.items[name], c = cmp[name] || {};
  rows.push({
    item: name, verts: j.verts, jsCold: +j.cold.toFixed(2), jsWarm: +j.warm.toFixed(2), rustCold: +r.cold.toFixed(2),
    cacheHit: +r.warm.toFixed(2), rustBuildOnly: r.rustBuild != null ? +r.rustBuild.toFixed(2) : null, decodeOnly: r.decode != null ? +r.decode.toFixed(2) : null,
    arraysExact: `${c.exact ?? 0}/${c.arrays ?? 0}`, maxAbsDiff: c.maxAbs ?? null, lenMismatch: c.lenMismatch ?? 0,
  });
}
console.table(rows);
console.table(Object.keys(runs.js.themes).map((id) => ({ theme: id, jsCold: +runs.js.themes[id].cold.toFixed(1), jsWarm: +runs.js.themes[id].warm.toFixed(1), rustCold: +runs.rust.themes[id].cold.toFixed(1), rustWarm: +runs.rust.themes[id].warm.toFixed(1) })));
console.log('rust cache stats', runs.rust.stats);
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ rows, themes: { js: runs.js.themes, rust: runs.rust.themes }, stats: runs.rust.stats }, null, 1));
