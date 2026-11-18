// Export the Privada toilet (base theme + crown + handlebar mustache) for Crusader Kings III.
//
//   source tools/env.sh && node tools/ck3/export_privada.mjs [--budget 20000] [--mod mods/ck3-privada]
//                                                           [--scale-male S] [--scale-female S] [--behind 10]
//
// 1. builds the three.js character headless (browser shims, JS rig, no wasm),
// 2. replaces the hair-strand mustache with a solid low-poly bundle, drops fx / glass domes,
// 3. bakes the rest pose to world space, decimates every part (QEM) to the triangle budget,
// 4. converts to CK3 portrait space per sex (cm, y up, facing -Z, character's left = +X; vertices are
//    in head-skeleton space, i.e. relative to head_root = the torso's bn_sp_thoracic),
// 5. skins: tank/eyes/crown/paper -> bn_h_head, bowl/seat/lid/mustache -> head_root, neck pipe blended,
// 6. assigns every material to a solid-colour stripe of a small atlas,
// and hands the result to build_ck3.py (pdxmesh.py writer + DDS writer + icon renderer).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { decimate, creaseNormals } from './decimate.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const WEB = path.join(ROOT, 'web');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const BUDGET = Number(args.budget ?? 20000);
const MOD = path.resolve(ROOT, args.mod ?? 'mods/ck3-privada');
const OUT_JSON = path.join(ROOT, '.tmp', 'ck3_privada_export.json');

// ---------------------------------------------------------------- three.js in node
const NM = path.join(WEB, 'node_modules'), NM_SRC = path.join(ROOT, '.tmp', 'node_modules_smoke');
const copiedNM = !fs.existsSync(NM);
if (copiedNM) fs.cpSync(NM_SRC, NM, { recursive: true });
let result;
try {
  await import('./shim.mjs');
  const tp = JSON.parse(fs.readFileSync(path.join(NM, 'three/package.json')));
  const ex = tp.exports?.['.'];
  const threeEntry = typeof ex === 'string' ? ex : ex?.import ?? ex?.default ?? 'build/three.module.js';
  const THREE = await import(url.pathToFileURL(path.join(NM, 'three', threeEntry)).href);
  const acc = await import(url.pathToFileURL(path.join(WEB, 'src/accessories/index.js')).href);
  // Low-poly handlebar for CK3: same spine as the web one, but the solid core IS the bundle
  // (full radius instead of 0.78 r under ~1100 hair strands) and the strands are dropped below.
  const hbRadius = (t) => (0.004 + 0.034 * Math.pow(1 - t, 1.15)) / 0.78;
  acc.registerMustache('mustache_handlebar', {
    pts: [[-0.015, 0], [0.05, -0.006], [0.11, -0.02], [0.17, -0.028], [0.215, -0.016],
          [0.243, 0.012], [0.248, 0.045], [0.228, 0.064], [0.205, 0.054]],
    radius: hbRadius, knot: 0.03 / 0.78, amount: 0.22, rust: false, mid: 1,
    hair: { count: 1, seg: 2, thick: 0.0016, start: [0, 0.25], len: [0.35, 1], cover: [0.72, 1.0], twist: 0.7, frizz: 0.0015 },
  });
  const { ToiletTuber } = await import(url.pathToFileURL(path.join(WEB, 'src/rig/ToiletTuber.js')).href);
  const theme = JSON.parse(fs.readFileSync(path.join(WEB, 'themes/base.json')));
  // Portrait fit: CK3 cameras frame the human head (~53 cm tall view in the head camera), so a longer
  // neck pipe lifts the tank (= the face) while the bowl still stands on the floor. 1.6 = the rig's max.
  theme.body = { ...(theme.body || {}), neck: { length: Number(args.neck ?? 1.6) } };
  result = buildExport(THREE, new ToiletTuber(theme));
} finally {
  if (copiedNM) fs.rmSync(NM, { recursive: true, force: true });
}

function buildExport(THREE, tb) {
  for (let i = 0; i < 180; i++) tb.update(1 / 60, { look: { x: 0, y: 0 }, mouth: 0 });
  // neutral rest pose: no idle sway / breathing / gaze
  tb.body.scale.set(1, 1, 1); tb.body.rotation.set(0, 0, 0); tb.body.position.set(0, 0, 0);
  tb.head.rotation.set(0, 0, 0); tb.head.position.y = tb.dim.headY;
  tb.root.traverse((o) => { if (/^pupil_[LR]$/.test(o.name)) { o.position.x = 0; o.position.y = 0; } });
  tb.root.updateMatrixWorld(true);

  const isUnder = (o, name) => { for (let p = o; p; p = p.parent) if (p.name === name) return true; return false; };
  const parts = [];
  const skipped = {};
  const skip = (o, why) => { skipped[why] = (skipped[why] || 0) + 1; };
  tb.root.traverse((o) => {
    if (!o.isMesh) return;
    let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
    if (!vis) return skip(o, 'hidden');
    if (isUnder(o, 'fx')) return skip(o, 'fx');
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || !m.name) return skip(o, 'unnamed material (overlay)');            // water swirl etc.
    if (o.name === 'eye_dome' || (m.transmission > 0.9 && m.name !== 'water')) return skip(o, 'glass');
    const inMustache = (() => { for (let p = o; p; p = p.parent) if (/^acc_mustache/.test(p.name)) return true; return false; })();
    if (inMustache && (o.name === 'mustache_hair' || m.sheen > 0)) return skip(o, 'mustache hair strands');
    const g = o.geometry, n = g.attributes.position.count;
    const pos = new Float64Array(n * 3), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      o.getVertexPosition(i, v);            // morph targets + skinning (SkinnedMesh) in local space
      v.applyMatrix4(o.matrixWorld);
      pos[3 * i] = v.x; pos[3 * i + 1] = v.y; pos[3 * i + 2] = v.z;
    }
    let idx = g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i);
    const det = o.matrixWorld.determinant();
    if (det < 0) for (let f = 0; f < idx.length; f += 3) [idx[f + 1], idx[f + 2]] = [idx[f + 2], idx[f + 1]];
    const group = isUnder(o, 'head') ? 'head' : (/^(neck_pipe|pipe_nut)$/.test(o.name) ? 'pipe' : 'body');
    const c = m.color ?? new THREE.Color(1, 1, 1);
    parts.push({
      name: o.name || o.parent?.name || '?', group, pos, idx,
      mat: { name: m.name, hex: c.getHexString(), metal: m.metalness ?? 0, rough: m.roughness ?? 0.5,
             clearcoat: m.clearcoat ?? 0, transmission: m.transmission ?? 0 },
    });
  });

  // ---------------------------------------------------------------- decimation to budget
  const tris = (p) => p.idx.length / 3;
  const srcTris = parts.reduce((s, p) => s + tris(p), 0);
  const FLOOR = 48; // tiny parts stay as they are
  let lo = 0, hi = 1;
  const plan = (r) => parts.reduce((s, p) => s + Math.min(tris(p), Math.max(FLOOR, Math.round(tris(p) * r))), 0);
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (plan(mid) > BUDGET) hi = mid; else lo = mid; }
  const ratio = lo;
  for (const p of parts) {
    const t = Math.min(tris(p), Math.max(FLOOR, Math.round(tris(p) * ratio)));
    const d = decimate(p.pos, p.idx, t);
    p.dpos = d.pos; p.didx = d.idx;
  }

  // ---------------------------------------------------------------- atlas tiles
  const tiles = [], tileOf = new Map();
  for (const p of parts) {
    const key = `${p.mat.name}#${p.mat.hex}`;
    if (!tileOf.has(key)) { tileOf.set(key, tiles.length); tiles.push({ key, ...p.mat }); }
    p.tile = tileOf.get(key);
  }

  // model-space landmarks
  const bboxOf = (filter) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const p of parts) if (filter(p)) for (let i = 0; i < p.dpos.length; i += 3) for (let a = 0; a < 3; a++) {
      b[a] = Math.min(b[a], p.dpos[i + a]); b[a + 3] = Math.max(b[a + 3], p.dpos[i + a]);
    }
    return b;
  };
  const all = bboxOf(() => true), eyes = bboxOf((p) => p.name === 'eye_white');
  const faceY = (eyes[1] + all[4]) / 2;      // middle of [eye bottom .. crown top]: what the head camera should frame
  const tankFrontZ = eyes[5];                // front plane of the eyes/tank (model +Z = front)

  return { parts, tiles, srcTris, ratio, skipped, landmarks: { all, eyes, faceY, tankFrontZ, neckBaseY: tb.dim.neckBaseY, headY: tb.dim.headY } };
}

// ---------------------------------------------------------------- CK3 space per sex
const SK = JSON.parse(fs.readFileSync(path.join(HERE, 'ck3_skeletons.json')));
const { parts, tiles, landmarks: L } = result;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const sexes = {};
for (const sex of ['male', 'female']) {
  const sk = SK[sex];
  const th = sk.thoracic;                                  // torso bn_sp_thoracic (world, cm) = head_root
  const hm = sk.head_bones.bn_h_head_mid;                  // head space
  const headMidWorld = [hm[0] + th[0], hm[1] + th[1], hm[2] + th[2]];
  // camera_head looks at bn_h_head_mid + 3 cm up: put the eyes..crown span there, feet on the floor (y = 0)
  const s = Number(args[`scale-${sex}`] ?? (headMidWorld[1] + 3) / L.faceY);
  const behind = Number(args.behind ?? 10);                // eyes this many cm behind the head-mid plane
  const zoff = headMidWorld[2] + behind - (-L.tankFrontZ * s);
  const toHead = (x, y, z) => [-x * s - th[0], y * s - th[1], -z * s + zoff - th[2]];
  const boneIx = Object.fromEntries(sk.bones.map((b, i) => [b.name, i]));
  const ROOT_B = boneIx.head_root, HEAD_B = boneIx.bn_h_head;
  const P = [], N = [], T = [], U = [], IX = [], W = [], TRI = [];
  let maxInfl = 1;
  for (const p of parts) {
    const cpos = [];
    for (let i = 0; i < p.dpos.length; i += 3) cpos.push(...toHead(p.dpos[i], p.dpos[i + 1], p.dpos[i + 2]));
    const cn = creaseNormals(cpos, p.didx, 50);
    const base = P.length / 3;
    for (let i = 0; i < cn.pos.length / 3; i++) {
      const x = cn.pos[3 * i], y = cn.pos[3 * i + 1], z = cn.pos[3 * i + 2];
      const nx = cn.nrm[3 * i], ny = cn.nrm[3 * i + 1], nz = cn.nrm[3 * i + 2];
      P.push(x, y, z); N.push(nx, ny, nz);
      // any unit tangent perpendicular to the normal (flat normal map: only needs to be valid)
      let tx = -nz, ty = 0, tz = nx;                        // = -cross((0,1,0), n)
      let tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-4) { tx = 1; ty = 0; tz = 0; tl = 1; }
      T.push(tx / tl, ty / tl, tz / tl, 1);
      U.push(p.tile);                                     // atlas tile; build_ck3.py turns it into u0
      let wHead = p.group === 'head' ? 1 : 0;
      if (p.group === 'pipe') {
        const my = (y + th[1]) / s;                        // back to model height
        wHead = smooth(L.neckBaseY + 0.04, L.headY - 0.02, my);
      }
      if (wHead >= 0.999) { IX.push(HEAD_B, -1, -1, -1); W.push(1, 0, 0, 0); }
      else if (wHead <= 0.001) { IX.push(ROOT_B, -1, -1, -1); W.push(1, 0, 0, 0); }
      else { IX.push(HEAD_B, ROOT_B, -1, -1); W.push(wHead, 1 - wHead, 0, 0); maxInfl = 2; }
    }
    for (const k of cn.idx) TRI.push(base + k);
  }
  const bb = [0, 1, 2].map((a) => [Math.min(...P.filter((_, i) => i % 3 === a)), Math.max(...P.filter((_, i) => i % 3 === a))]);
  sexes[sex] = { scale: s, zoff, p: P, n: N, ta: T, tile: U, tri: TRI, ix: IX, w: W, bones: maxInfl,
    min: bb.map((r) => r[0]), max: bb.map((r) => r[1]), verts: P.length / 3, tris: TRI.length / 3,
    world_floor_y: bb[1][0] + th[1], world_top_y: bb[1][1] + th[1], head_mid_world: headMidWorld };
}

const out = {
  source: 'web/themes/base.json + crown + mustache_handlebar (low-poly)',
  budget: BUDGET, source_tris: result.srcTris, decimation_ratio: result.ratio, skipped: result.skipped,
  parts: parts.map((p) => ({ name: p.name, group: p.group, material: p.mat.name, src_tris: p.idx.length / 3, tris: p.didx.length / 3 })),
  atlas: { tiles },
  sexes,
};
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(out));
for (const [sex, d] of Object.entries(sexes)) {
  console.log(`${sex}: ${d.verts} verts, ${d.tris} tris, scale ${d.scale.toFixed(1)} cm/unit, floor y=${d.world_floor_y.toFixed(1)} top y=${d.world_top_y.toFixed(1)} (world), influences ${d.bones}`);
}
console.log(`source ${result.srcTris} tris -> ratio ${result.ratio.toFixed(3)}; skipped`, result.skipped, `; atlas ${tiles.length} tiles`);

const py = process.env.PYTHON || 'python';
const r = spawnSync(py, ['-I', path.join(HERE, 'build_ck3.py'), OUT_JSON, MOD], { stdio: 'inherit' });
process.exit(r.status ?? 1);
