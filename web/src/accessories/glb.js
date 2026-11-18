// "glb" accessory: any user-supplied 3D model (.glb/.gltf) attached to a socket.
// params: { src: dataURL|url, fit: 0.35 (max size in meters), name }
// The model is auto-scaled to `fit`, centered on X/Z and sat on its base (y=0).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { registerAccessory } from './index.js';

const loader = new GLTFLoader();
const cache = new Map(); // src -> Promise<gltf scene>

registerAccessory('glb', (ctx, p) => {
  const g = new THREE.Group();
  g.name = `acc_glb_${p.name || 'model'}`;
  if (!p.src) return g;
  if (!cache.has(p.src)) cache.set(p.src, loader.loadAsync(p.src).then((gl) => gl.scene));
  cache.get(p.src).then((scene) => {
    const o = scene.clone(true);
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    const s = (p.fit ?? 0.35) / Math.max(size.x, size.y, size.z, 1e-6);
    o.scale.setScalar(s);
    const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
    o.position.set(-c.x, -box.min.y * s, -c.z);
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      m.userData.keepGeo = true; // geometry shared with the cached scene
      if (p.color && m.material?.color) { m.material = m.material.clone(); m.material.color.set(p.color); }
    });
    g.add(o);
  }).catch((e) => console.warn('[glb] load failed', e));
  return g;
});
