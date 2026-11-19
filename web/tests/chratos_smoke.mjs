// Headless smoke test + bench of the human character "Chratos" (Rust/wasm rig + meshes, three shim):
//   node --import ./.tmp/furn/register.mjs web/tests/chratos_smoke.mjs      (from the repo root)
// (the loader points `three` at .tmp/node_modules_smoke)
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
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
assert.equal(tb.play('flush'), false);
assert.equal(tb.play('laugh'), true);

// every vertex stays finite and inside a sane box through look + talk + actions
const ev = [];
tb.on((type, d) => ev.push(d));
const acts = ['nod', 'no', 'surprise', 'wink', 'blink', 'laugh', 'jump', 'backflip', 'gargle', 'blargh', 'sit', 'stand'];
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
assert.ok(head.y > 1.4 && head.y < 1.62, `head bone height ${head.y} (scale ${CHRATOS_SCALE.toFixed(2)})`);
// theme toggles
tb.setTheme({ chratos: { chair: true, headphones: false, hoodie: '#7a1f2b' } });
assert.equal(tb.meshes.chair?.visible, true);
assert.equal(tb.headphones.visible, false);
assert.ok(tb.materials.cloth.color.r > 1, 'hoodie tint is a ratio to the black base');
tb.dispose();
console.log(`ok: ${n} skinned/morphed vertices checked, events ${[...new Set(ev)].join(',')}`);
