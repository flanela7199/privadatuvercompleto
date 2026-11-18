// Shared stage: renderer, lights, environment, floor + contact shadow, AO post.
// Used by the live preview (main.js) and the video showcase (showcase.js).
// Look target: a real glazed-china toilet photographed indoors (not a toy):
// soft natural light, broad soft reflections, ambient occlusion for grounding.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Options (all default to the original behaviour): floor, contact (contact shadow), shadows,
// preserveDrawingBuffer (needed for frame capture; the avatar window turns it off for speed).
export function createStage({ width = innerWidth, height = innerHeight, pixelRatio = Math.min(devicePixelRatio, 2), parent = document.body,
  floor: withFloor = true, contact: withContact = true, shadows = true, preserveDrawingBuffer = true, powerPreference = 'high-performance' } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer, powerPreference });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps whites white (AgX greys porcelain)
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  parent.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;

  const camera = new THREE.PerspectiveCamera(32, width / height, 0.05, 50);
  camera.position.set(0.25, 1.15, 4.1);

  // Natural indoor: warm soft key (window-ish), cool gentle fill, faint rim.
  scene.add(new THREE.HemisphereLight(0xe6edf5, 0x8c8478, 0.45));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.3);
  key.position.set(2.4, 4.2, 3.2);
  key.target.position.set(0, 0.8, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 1.7, bottom: -1.5, near: 2, far: 9.5 });
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.015;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xd8e4ff, 0.5);
  fill.position.set(-3, 1.5, 2.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8);
  rim.position.set(-1.5, 3, -3.5);
  scene.add(rim);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.3 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.visible = withFloor;
  scene.add(floor);

  // Contact shadow: soft dark blob right under the pedestal (follows the body, fades on jumps).
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(0.35, 'rgba(0,0,0,0.45)');
  grd.addColorStop(0.7, 'rgba(0,0,0,0.12)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.55 }));
  contact.name = 'contact_shadow';
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.0015;
  contact.renderOrder = 1;
  contact.visible = withContact;
  scene.add(contact);

  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, width, height);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 0.22, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 16 });
  composer.addPass(gtao);
  composer.addPass(new OutputPass());

  const bodyPos = new THREE.Vector3();
  return {
    renderer, scene, camera, composer, gtao, floor, contact,
    setSize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    },
    /** contact shadow follows the body and fades/grows when it leaves the floor */
    updateContact(tuber) {
      if (!withContact) return;
      tuber.body.getWorldPosition(bodyPos);
      const lift = Math.max(0, bodyPos.y);
      contact.position.x = bodyPos.x;
      contact.position.z = bodyPos.z - 0.02;
      contact.rotation.z = -tuber.body.rotation.y;
      const grow = 1 + lift * 0.8;
      contact.scale.set(0.95 * grow, 1.05 * grow, 1);
      contact.material.opacity = 0.55 * Math.max(0, 1 - lift * 3);
    },
    render(dt, ao = true) { ao ? composer.render(dt) : renderer.render(scene, camera); },
  };
}
