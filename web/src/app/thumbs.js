// Offscreen thumbnail renderer for the control panel.
// One shared WebGL renderer; every image is cached in localStorage (bump THUMB_VERSION
// whenever accessory art changes so stale previews are regenerated).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAccessory } from '../accessories/index.js';
import { MaterialLib } from '../rig/materials.js';
import { ToiletTuber, DIM } from '../rig/ToiletTuber.js';

export const THUMB_VERSION = 3;
const PREFIX = `privada.thumb.v${THUMB_VERSION}.`;

let R = null; // lazy { renderer, scene, camera }
function ctx() {
  if (R) return R;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8c8478, 0.6));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
  key.position.set(2, 3, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8);
  rim.position.set(-2, 2, -3);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  R = { renderer, scene, camera };
  return R;
}

// sequential queue so thumbnails never fight over the renderer
let chain = Promise.resolve();
const queue = (fn) => (chain = chain.then(() => new Promise((r) => setTimeout(r, 0))).then(fn, fn));

function cached(key) { try { return localStorage.getItem(PREFIX + key); } catch { return null; } }
function store(key, url) { try { localStorage.setItem(PREFIX + key, url); } catch { /* quota: keep in memory only */ } }
const mem = new Map();

function shoot(obj, size, dir = [0.55, 0.3, 1]) {
  const { renderer, scene, camera } = ctx();
  renderer.setSize(size, size, false);
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.1, -0.1, -0.1), new THREE.Vector3(0.1, 0.1, 0.1));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const d = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
  camera.position.copy(sphere.center).add(new THREE.Vector3(...dir).normalize().multiplyScalar(d));
  camera.near = d / 50; camera.far = d * 4;
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(obj);
  return url;
}

function disposeTree(o) {
  o.traverse((m) => { if (m.isMesh && !m.userData.keepGeo) m.geometry?.dispose(); });
}

const NEUTRAL_ST = { dt: 1 / 60, time: 0, mouth: 0, talk: 0, headYawVel: 0, headPitchVel: 0, lift: 0 };

/** Thumbnail of one accessory, built alone with the given theme's materials. */
export function accessoryThumb(id, theme, size = 128) {
  const key = `acc.${id}`;
  if (mem.has(key)) return Promise.resolve(mem.get(key));
  const hit = cached(key);
  if (hit) { mem.set(key, hit); return Promise.resolve(hit); }
  return queue(() => {
    const mats = new MaterialLib(theme?.materials || {});
    let url = null;
    try {
      const obj = buildAccessory({ THREE, mats, theme, dim: DIM }, { id, params: {} });
      if (obj) {
        for (let i = 0; i < 3; i++) obj.traverse((x) => x.userData.update?.(NEUTRAL_ST));
        url = shoot(obj, size);
        disposeTree(obj);
      }
    } catch (e) { console.warn('[thumb]', id, e); }
    mats.dispose();
    if (url) { mem.set(key, url); store(key, url); }
    return url;
  });
}

/** Thumbnail of the whole character wearing an outfit (cache key = content hash). */
export function outfitThumb(theme, size = 180) {
  const key = `outfit.${hash(JSON.stringify({ m: theme.materials, s: theme.slots }))}`;
  if (mem.has(key)) return Promise.resolve(mem.get(key));
  const hit = cached(key);
  if (hit) { mem.set(key, hit); return Promise.resolve(hit); }
  return queue(() => {
    let url = null;
    try {
      const tb = new ToiletTuber(theme);
      for (let i = 0; i < 20; i++) tb.update(1 / 60, { look: { x: 0.25, y: 0.05 }, mouth: 0 });
      tb.fx.visible = false;
      url = shoot(tb.root, size, [0.35, 0.18, 1]);
      disposeTree(tb.root);
      tb.mats.dispose();
    } catch (e) { console.warn('[thumb] outfit', e); }
    if (url) { mem.set(key, url); store(key, url); }
    return url;
  });
}

export function clearThumbs() {
  mem.clear();
  for (const k of Object.keys(localStorage)) if (k.startsWith('privada.thumb.')) localStorage.removeItem(k);
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
