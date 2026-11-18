// Repro for "preset (outfit) thumbnails don't appear".
// Runs the panel's outfitThumb() body (same theme/preset resolution as ui/src/state/config.ts)
// up to `shoot`, with shoot's framing math, for EVERY theme + preset; times each one and
// reports exceptions, NaN poses, and bad framing boxes.
// Run from web/:  node tests/outfit_thumbs.mjs   (needs web/node_modules/three -> vendor/three)
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
globalThis.PRIVADA_WASM_BYTES = fs.readFileSync('pkg/privada_wasm_bg.wasm'); // same Rust rig as the panel
const THREE = await import('three');
const { ToiletTuber } = await import('../src/rig/ToiletTuber.js');
const { mergeTheme } = await import('../src/themes.js');
await import('../src/accessories/extra.js');

/* ---- exactly the panel's resolution path (ui/src/lib/catalog + ui/src/state/config.ts) ---- */
const clone = (o) => JSON.parse(JSON.stringify(o));
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
// loadThemes('../themes/') -> resolves "extends" among themes
const rawT = Object.fromEntries(read('themes/index.json').map((id) => [id, read(`themes/${id}.json`)]));
const themes = {};
const resT = (id) => (themes[id] ||= rawT[id].extends ? mergeTheme(resT(rawT[id].extends), rawT[id]) : rawT[id]);
Object.keys(rawT).forEach(resT);
// loadPresets('../presets/') -> raw presets keyed by t.id || file id
const presets = {};
for (const id of read('presets/index.json')) { const t = read(`presets/${id}.json`); presets[t.id || id] = t; }
const s = { cfg: { outfits: {} }, themes, presets };
const rawOutfit = (id) => s.cfg.outfits?.[id] || s.presets[id] || s.themes[id] || null;
function resolveOutfit(id, depth = 0) {
  const t = rawOutfit(id);
  if (!t) return clone(s.themes.base);
  if (t.extends && depth < 6) return mergeTheme(rawOutfit(t.extends) ? resolveOutfit(t.extends, depth + 1) : s.themes.base, t);
  return clone(t);
}
/* ---- the thumbnail key used by outfitThumb / the cards ---- */
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
const keyOf = (t) => `outfit-${hash(JSON.stringify({ m: t.materials, s: t.slots }))}`;

const ids = [...new Set([...Object.keys(themes), ...Object.keys(presets)])];
const sizeOf = (b) => b.getSize(new THREE.Vector3());
let fails = 0;
console.log('id'.padEnd(20), 'ms'.padStart(6), ' mats  slots  box(root)                     box(body)                     notes');
for (const id of ids) {
  const theme = resolveOutfit(id);
  const notes = [];
  if (!theme.materials || !theme.materials.porcelain) notes.push('NO porcelain material (magenta!)');
  if (keyOf(theme) !== keyOf(resolveOutfit(id))) notes.push('KEY UNSTABLE');
  const t0 = performance.now();
  try {
    const tb = new ToiletTuber(theme);
    for (let i = 0; i < 20; i++) tb.update(1 / 60, { look: { x: 0.25, y: 0.05 }, mouth: 0 });
    tb.fx.visible = false;
    tb.root.updateMatrixWorld(true);
    let nan = 0;
    tb.root.traverse((o) => { if (o.matrixWorld.elements.some((e) => !Number.isFinite(e))) nan++; });
    if (nan) notes.push(`${nan} nodes with NaN matrices`);
    const boxRoot = new THREE.Box3().setFromObject(tb.root);
    const boxBody = new THREE.Box3().setFromObject(tb.body);
    const ms = performance.now() - t0;
    const r = sizeOf(boxRoot), b = sizeOf(boxBody);
    if (boxRoot.isEmpty() || !Number.isFinite(r.x + r.y + r.z)) notes.push('ROOT BOX EMPTY/NaN');
    if (r.length() > b.length() * 1.6) notes.push(`root box ${(r.length() / b.length()).toFixed(1)}x body box (fx/floor stuff in frame)`);
    console.log(id.padEnd(20), ms.toFixed(0).padStart(6), String(Object.keys(theme.materials || {}).length).padStart(5), String(Object.values(theme.slots || {}).flat().length).padStart(6),
      ` ${r.x.toFixed(2)}x${r.y.toFixed(2)}x${r.z.toFixed(2)}`.padEnd(30), ` ${b.x.toFixed(2)}x${b.y.toFixed(2)}x${b.z.toFixed(2)}`.padEnd(30), notes.join('; '));
  } catch (e) {
    fails++;
    console.log(id.padEnd(20), (performance.now() - t0).toFixed(0).padStart(6), ' EXCEPTION:', e.stack.split('\n').slice(0, 3).join(' | '));
  }
}
console.log(`\n${ids.length} outfits, ${fails} exceptions`);
