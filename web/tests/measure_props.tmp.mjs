// temp: Box3 of the prop accessories (accessory-local space)
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
const THREE = await import('three');
const { ToiletTuber } = await import('../src/rig/ToiletTuber.js');
await import('../src/accessories/extra.js');
const { buildAccessory } = await import('../src/accessories/index.js');
const fs = await import('node:fs');
const tb = new ToiletTuber(JSON.parse(fs.readFileSync(new URL('../themes/base.json', import.meta.url))));
const ctx = { THREE, mats: tb.mats, theme: tb.theme, dim: tb.dim };
const r = (v) => +v.toFixed(3);
for (const id of ['toilet_paper_stack', 'air_freshener', 'rubber_duck', 'plunger', 'toilet_brush_holder']) {
  const o = buildAccessory(ctx, { id, params: {} });
  o.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o);
  const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  console.log(id, 'size', [r(s.x), r(s.y), r(s.z)], 'center', [r(c.x), r(c.y), r(c.z)]);
  if (id === 'toilet_paper_stack') {
    const roll = o.children[0].children[0];
    const b2 = new THREE.Box3().setFromObject(roll); roll.updateMatrixWorld(true);
    const inv = roll.matrixWorld.clone().invert();
    const lb = b2.clone().applyMatrix4(inv);
    console.log('  roll world box', b2.getSize(new THREE.Vector3()).toArray().map(r), 'local', lb.getSize(new THREE.Vector3()).toArray().map(r), lb.getCenter(new THREE.Vector3()).toArray().map(r));
  }
}
