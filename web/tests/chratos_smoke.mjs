// Headless smoke test + bench of the human character "Chratos" (Rust/wasm rig + meshes, three shim):
//   node --import ./.tmp/furn/register.mjs web/tests/chratos_smoke.mjs      (from the repo root)
// (the loader points `three` at .tmp/node_modules_smoke)
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
// canvas stand-in for the procedural textures of the shared material library (water, paper)
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
const { Chratos, chratosReady, CHRATOS_SCALE } = await import('../src/characters/chratos/Chratos.js');
const geocache = await import('../src/rig/geocache.js');
assert.ok(chratosReady, 'wasm build with the human module');

let t0 = performance.now();
await Chratos.preload();
const tPreload = performance.now() - t0;
t0 = performance.now();
const tb = new Chratos({}, 7);
const tBuild = performance.now() - t0;
const st = tb.stats();
console.log(`preload (Rust build of every mesh) ${tPreload.toFixed(0)} ms, construct ${tBuild.toFixed(0)} ms, cache builds ${geocache.stats.builds}`);
console.log('triangles', JSON.stringify(st));
assert.ok(st.head > 60000 && st.head < 100000, `head tris ${st.head}`);
assert.ok(st.total > 200000 && st.total <= 400000, `total tris ${st.total}`);
for (const k of ['root', 'body', 'head', 'fx', 'sockets']) assert.ok(tb[k], k);
for (const k of ['head_top', 'eyes', 'mouth']) assert.ok(tb.sockets[k], 'socket ' + k);
assert.equal(tb.play('handstand'), false);
assert.equal(tb.play('laugh'), true);

// every vertex stays finite and inside a sane box through look + talk + actions
const ev = [];
tb.on((type, d) => ev.push(d));
const acts = ['nod', 'no', 'surprise', 'wink', 'blink', 'laugh', 'jump', 'backflip', 'gargle', 'blargh', 'flush', 'paper'];
for (const k of ['mouth_spout', 'hand_L', 'hand_R']) assert.ok(tb.sockets[k], 'socket ' + k);
assert.ok(tb.bodyCollider.length >= 10 && tb.spout().direction.z > 0.5);
const N = 3600;
t0 = performance.now();
for (let i = 0; i < N; i++) {
  const t = i / 60;
  if (i % 300 === 100) tb.play(acts[(i / 300 | 0) % acts.length]);
  tb.update(1 / 60, { look: { x: Math.sin(t * 0.8), y: Math.cos(t * 0.5) * 0.8 }, mouth: { open: Math.abs(Math.sin(t * 9)), round: Math.max(0, Math.sin(t * 1.3)), wide: Math.max(0, Math.cos(t * 1.7)), lips: 0.5, cornerL: Math.sin(t) } });
}
const us = (performance.now() - t0) / N * 1000;
t0 = performance.now();
for (let i = 0; i < N; i++) { tb.rig.set_input(Math.sin(i / 50), 0, (i % 40) / 40, 0, 0, 0, 0); tb.rig.update(1 / 60); }
const usRig = (performance.now() - t0) / N * 1000;
console.log(`update: ${us.toFixed(1)} us/frame total (Rust rig ${usRig.toFixed(1)} us + JS apply pose/morphs/cable)`);
assert.ok(ev.includes('laugh'), 'laugh event reached the listeners');
tb.root.updateMatrixWorld(true);
const THREE = await import('three');
const v = new THREE.Vector3();
let n = 0;
for (const name of ['head', 'beard', 'torso', 'pants', 'shoes', 'hands']) {
  const m = tb.meshes[name];
  for (let i = 0; i < m.geometry.attributes.position.count; i += 37) {
    m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
    assert.ok(Number.isFinite(v.x + v.y + v.z) && Math.abs(v.x) < 1.2 && v.y > -0.3 && v.y < 2.6 && Math.abs(v.z) < 1.2, `${name} vertex ${i}: ${v.toArray()}`);
    n++;
  }
}
tb.setTheme({});
for (let i = 0; i < 400; i++) tb.update(1 / 60, {});   // let the last action finish
const head = new THREE.Vector3(); tb.head.getWorldPosition(head);
assert.ok(head.y > 1.45 && head.y < 1.66, `head bone height ${head.y} (scale ${CHRATOS_SCALE.toFixed(2)})`);
// theme toggles
tb.setTheme({ chratos: { chair: true, headphones: false, hoodie: '#7a1f2b' } });
assert.equal(tb.meshes.chair?.visible, true);
assert.equal(tb.headphones.visible, false);
assert.ok(tb.materials.cloth.color.r > 1, 'hoodie tint is a ratio to the black base');
// ---- accessories on his sockets (toilet registry + per-character fit), furniture, props
await import('../src/accessories/extra.js');
tb.setTheme({ slots: {
  head_top: [{ id: 'crown' }], eyes: [{ id: 'sunglasses' }], mouth_corner: [{ id: 'cigar' }],
  floor_under: [{ id: 'cadeira_skol' }], floor_left: [{ id: 'toilet_paper_stack' }], floor_right: [{ id: 'plunger' }],
} });
assert.equal(tb.accessories.length, 6, 'six accessories built: ' + tb.accessories.map((a) => a.name));
tb.root.updateMatrixWorld(true);
const boxOf = (slot) => new THREE.Box3().setFromObject(tb.accessories.find((a) => a.userData.slot === slot));
const crown = boxOf('head_top'), glasses = boxOf('eyes'), headY = tb.head.getWorldPosition(new THREE.Vector3()).y;
assert.ok(crown.min.y > headY + 0.15 && crown.max.y < headY + 0.42 && crown.max.x - crown.min.x < 0.3, `crown sits on his head, human sized: ${crown.min.y.toFixed(2)}..${crown.max.y.toFixed(2)} w ${(crown.max.x - crown.min.x).toFixed(2)}`);
assert.ok(glasses.max.x - glasses.min.x > 0.1 && glasses.max.x - glasses.min.x < 0.2 && Math.abs((glasses.min.y + glasses.max.y) / 2 - (headY + 0.082)) < 0.03, `sunglasses on the eyes: w ${(glasses.max.x - glasses.min.x).toFixed(3)}`);
const seat = tb.seatHeight();
assert.ok(seat > 0.3 && seat < 0.9, `seat height from FURNITURE_INFO: ${seat}`);
assert.ok(tb.props.length >= 3 && tb.rig.prop_count() >= 3, `props registered: ${tb.props.length}`);
tb.play('sit');
for (let i = 0; i < 150; i++) tb.update(1 / 60, {});
assert.ok(tb.isSitting, 'sits on the chair');
const pelvis = tb.nodes.pelvis.getWorldPosition(new THREE.Vector3());
assert.ok(Math.abs(pelvis.y - (seat + 0.105)) < 0.03, `pelvis on the seat: ${pelvis.y.toFixed(3)} vs seat ${seat.toFixed(3)}`);
// flush while seated: water flies, props near the puddle may get hit; nothing explodes
ev.length = 0;
tb.play('flush');
let drops = 0;
for (let i = 0; i < 330; i++) { tb.update(1 / 60, {}); drops = Math.max(drops, tb.view(14)[11] > 0.5 ? 1 : drops); }
assert.ok(ev.includes('flush') && ev.includes('splash'), 'flush + splash sfx: ' + [...new Set(ev.filter((e) => typeof e === 'string'))]);
assert.ok(drops > 0 && tb.jet.stream.geometry.attributes.position.array.some((v) => v !== 0), 'the water column was visible and uploaded');
tb.play('paper');
for (let i = 0; i < 120; i++) tb.update(1 / 60, {});
assert.ok(tb.roll.visible && tb.paper.geo.drawRange.count > 60, `paper strip drawn: ${tb.paper.geo.drawRange.count}`);
tb.setTheme({});
assert.equal(tb.accessories.length, 0);
assert.equal(tb.seatHeight(), 0);
for (let i = 0; i < 200; i++) tb.update(1 / 60, {});
assert.ok(!tb.isSitting, 'stands up when the chair is removed');
tb.dispose();
console.log(`ok: ${n} skinned/morphed vertices checked, events ${[...new Set(ev)].join(',')}`);
