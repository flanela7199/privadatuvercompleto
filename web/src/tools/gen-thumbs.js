// Static thumbnail generator (maintainers). Open via tools/capture_server.py:
//   http://127.0.0.1:8766/tools/gen-thumbs.html
// Renders every preset/theme (resolved exactly like the panel, web/src/app/outfits.js) and every
// accessory with ONE shared renderer at 256 px, WebP 0.9, framing on the character body only
// (the FX meshes are excluded: their instance matrices made the old framing box NaN -> empty images).
// Each image is POSTed to /thumb?path=presets/<id>.webp | accessories/<id>.webp, then
// /thumb?path=index.json. Auto-runs; document.title = 'DONE' at the end.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ToiletTuber, DIM } from '../rig/ToiletTuber.js';
import { MaterialLib } from '../rig/materials.js';
import { loadThemes } from '../themes.js';
import { listAccessories, buildAccessory } from '../accessories/index.js';
import '../accessories/extra.js';
import { makeResolver, loadPresets } from '../app/outfits.js';
import { presetHash, accHash, fileSafe, THUMBS_INDEX_VERSION, ACC_ART_VERSION } from '../app/thumbkeys.js';

const SIZE = 256;
const $ = (id) => document.getElementById(id);
const log = (msg, err = false) => {
  const line = document.createElement('div');
  if (err) line.className = 'err';
  line.textContent = msg;
  $('log').append(line);
  $('log').scrollTop = 1e9;
  (err ? console.error : console.log)('[gen-thumbs]', msg);
};

/* ------------------------------------------------------------ renderer */
const canvas = document.createElement('canvas');
canvas.width = canvas.height = SIZE;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
pm.dispose();
scene.environmentIntensity = 0.9;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8c8478, 0.6));
const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
key.position.set(2, 3, 3);
const rim = new THREE.DirectionalLight(0xffffff, 0.8);
rim.position.set(-2, 2, -3);
scene.add(key, rim);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);

const finiteBox = (b) => !b.isEmpty() && [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite);

/** render `obj` framed on `frameOn` (defaults to obj) -> WebP blob */
async function shoot(obj, dir, frameOn = obj) {
  scene.add(obj);
  try {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(frameOn);
    if (!finiteBox(box)) throw new Error('framing box is empty/NaN');
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const d = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.04;
    camera.position.copy(sphere.center).add(new THREE.Vector3(...dir).normalize().multiplyScalar(d));
    camera.near = d / 50; camera.far = d * 4;
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.9));
    if (!blob || blob.size < 200) throw new Error(`readback too small (${blob?.size ?? 0} bytes)`);
    return blob;
  } finally { scene.remove(obj); }
}
const disposeTree = (o) => o.traverse((m) => { if (m.isMesh && !m.userData.keepGeo) m.geometry?.dispose(); });
const NEUTRAL = { dt: 1 / 60, time: 0, mouth: 0, talk: 0, headYawVel: 0, headPitchVel: 0, lift: 0 };

async function post(path, body, type) {
  const r = await fetch(`/thumb?path=${encodeURIComponent(path)}`, { method: 'POST', body, headers: { 'Content-Type': type } });
  if (!r.ok) throw new Error(`POST ${path}: HTTP ${r.status}`);
}
function show(label, blob) {
  const f = document.createElement('figure');
  f.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt=""><figcaption>${label}</figcaption>`;
  $('grid').append(f);
}
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

/* ---------------------------------------------------------------- main */
async function run() {
  const themes = await loadThemes('../themes/');
  const presets = await loadPresets('../presets/');
  const { resolve } = makeResolver({ themes, presets });
  const outfitIds = [...new Set([...Object.keys(themes), ...Object.keys(presets)])];
  const accIds = listAccessories().filter((id) => id !== 'glb');
  const total = outfitIds.length + accIds.length;
  const items = {};
  let done = 0, failed = 0;
  const tick = (what) => {
    done++;
    $('bar').firstElementChild.style.width = `${(done / total) * 100}%`;
    $('status').textContent = `${done}/${total} · ${what}${failed ? ` · ${failed} erro(s)` : ''}`;
  };
  log(`${outfitIds.length} presets/temas + ${accIds.length} acessórios`);

  for (const id of outfitIds) {
    const t0 = performance.now();
    try {
      const theme = resolve(id);
      const tb = new ToiletTuber(theme);
      try {
        for (let i = 0; i < 20; i++) tb.update(1 / 60, { look: { x: 0.25, y: 0.05 }, mouth: 0 });
        tb.fx.visible = false;
        // frame on the character itself: fx (water/paper) and floor sockets stay out of the box
        const blob = await shoot(tb.root, [0.35, 0.18, 1], tb.body);
        const file = `presets/${fileSafe(id)}.webp`;
        await post(file, blob, 'image/webp');
        items[`preset:${id}`] = { file, hash: presetHash(theme) };
        show(theme.name || id, blob);
        log(`✔ preset ${id} (${(performance.now() - t0).toFixed(0)} ms, ${(blob.size / 1024).toFixed(1)} KB)`);
      } finally { disposeTree(tb.root); tb.mats.dispose(); }
    } catch (e) { failed++; log(`✘ preset ${id}: ${e?.stack || e}`, true); }
    tick(`preset ${id}`);
    await frame();
  }

  const mats = new MaterialLib(themes.base.materials);
  for (const id of accIds) {
    try {
      const obj = buildAccessory({ THREE, mats, theme: themes.base, dim: DIM }, { id, params: {} });
      if (!obj) throw new Error('built nothing');
      try {
        for (let i = 0; i < 3; i++) obj.traverse((x) => x.userData.update?.(NEUTRAL));
        const blob = await shoot(obj, [0.55, 0.3, 1]);
        const file = `accessories/${fileSafe(id)}.webp`;
        await post(file, blob, 'image/webp');
        items[`acc:${id}`] = { file, hash: accHash(id) };
        show(id, blob);
      } finally { disposeTree(obj); }
    } catch (e) { failed++; log(`✘ acessório ${id}: ${e?.stack || e}`, true); }
    tick(`acessório ${id}`);
    await frame();
  }
  mats.dispose();

  const index = { version: THUMBS_INDEX_VERSION, accArtVersion: ACC_ART_VERSION, generated: new Date().toISOString(), items };
  await post('index.json', JSON.stringify(index, null, 2), 'application/json');
  log(`index.json: ${Object.keys(items).length} itens, ${failed} erro(s)`);
  $('status').textContent = `PRONTO ✔ ${Object.keys(items).length}/${total} miniaturas${failed ? ` · ${failed} erro(s)` : ''}`;
  document.title = 'DONE';
}

run().catch((e) => { log(`FALHOU: ${e?.stack || e}`, true); document.title = 'DONE (erro)'; });
