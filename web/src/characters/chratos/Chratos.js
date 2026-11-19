// "Chratos": the realistic human character (full body: head, beard, hair cards, headphones, hoodie, pants, shoes, hands).
// THIN renderer: every mesh, blend shape, skin weight and all per-frame logic come from Rust
// (crates/privada-core/src/human, via web/pkg). This file only turns the Rust buffers into
// three.js objects and applies pose + morph weights each frame.
//
// Same public surface as ToiletTuber where the avatar uses it:
//   root, body, head, fx, sockets, accessories, update(dt, { look, mouth }), play(name),
//   setTheme(theme), on(fn), blinkTimer, setLookLimits(yaw, pitch), isSitting, sitHeight, dispose()
// Skeleton (INFO.nodes / parents / bind from Rust `human_rig_info()`): root > pelvis > spine1 > spine2 >
// chest > neck > head > jaw / eye_L / eye_R; chest > clavicle > upperarm > forearm > hand (L, R);
// pelvis > thigh > shin > foot (L, R); plug (root space). Sockets: head_top, eyes, mouth, mouth_spout
// (+z = where a water jet leaves the mouth, see spout()), hand_L, hand_R, chest.
//
// Meshes go through the PRVM mesh cache (web/src/rig/geocache.js) with kinds `human_<part>`
// and params { detail, v, attr?: 'color' | 'skin' | 'morph' | 'meta', morph? }.
import * as THREE from 'three';
import { loadWasm } from '../../rig/wasmrig.js';
import { getMesh, warm, geoReady } from '../../rig/geocache.js';
import { MaterialLib } from '../../rig/materials.js';
import { buildAccessory } from '../../accessories/index.js';
import { WaterJet } from '../../fx/waterJet.js';
import { PaperStrip } from '../../fx/paperStrip.js';

// accessory metadata (physics shapes, furniture seat heights): optional, loaded once
const ACC_INFO = await import('../../accessories/extra.js').then((m) => m.ACCESSORY_INFO || {}, () => ({}));
const FURN_MOD = await import('../../accessories/furniture.js').catch(() => null);
const FURN = FURN_MOD?.FURNITURE_INFO || {};
const entrySeatHeight = (e) => (e.seatHeight != null ? +e.seatHeight || 0 : FURN_MOD?.furnitureSeatHeight?.(e.id, e.params || {}) || 0);

const W = await loadWasm();
const pkg = W?.pkg?.HumanRig && geoReady ? W.pkg : null;
/** false when the Rust/wasm build is missing (?nowasm / ?nogeo): the avatar keeps the toilet */
export const chratosReady = !!pkg;
const INFO = pkg ? JSON.parse(pkg.human_rig_info()) : null;
// buffer ids / scalar indices: the FX + props ones are the toilet Rig's (see crates/privada-wasm/src/human.rs)
const BUF = {
  POSE: 0, DROPS: 1, FOAM: 2, STREAM_POS: 3, STREAM_UV: 4, RIPPLES: 5, PUDDLE: 6, PUDDLE_RADIAL: 7,
  PAPER_POS: 8, PAPER_UV: 9, PAPER_PERF: 10, TORN_POS: 11, TORN_UV: 12, TORN_PERF: 13, SCALARS: 14, MORPHS: 15,
  STREAM_NRM: 16, PAPER_NRM: 17, TORN_NRM: 18, PROP_POSES: 19, PROP_REST: 20, PAPER_COL: 21, TORN_COL: 22, CABLE_POS: 30, CABLE_NRM: 31,
};
const SC = {
  ST_MOUTH: 1, ST_TALK: 2, HEAD_YAW_VEL: 3, HEAD_PITCH_VEL: 4, ST_LIFT: 5, TIME: 6, DT: 10, STREAM_VISIBLE: 11,
  PAPER_COUNT: 12, PAPER_PERF: 13, PAPER_OPACITY: 14, TORN_COUNT: 15, TORN_PERF: 16, TORN_OPACITY: 17, PUDDLE_VERSION: 18,
  PAPER_WET: 20, TORN_WET: 21, PROP_COUNT: 22, PROPS_ACTIVE: 23, ROLL: 24, SIT: 25, ROLL_ROT: 26,
};
const PROP_STRIDE = 12;
// Per-character fit of the toilet's accessory sockets on the human: [parent node | 'root', position (model space
// at bind; root space for 'root'), uniform scale, yaw]. Accessories are authored for the toilet (tank 0.95 m wide,
// eyes 0.34 m apart, mouth 0.4 m wide): the scale brings them to a human head.
const FIT = {
  head_top: ['head', [0, 0.116, -0.012], 0.56, 0],
  eyes: ['head', [0, 0.0105, 0.0865], 0.185, 0],
  face: ['head', [0, -0.02, 0.095], 0.2, 0],
  lip_upper: ['head', [0, -0.058, 0.1005], 0.17, 0],
  mouth: ['head', [0, -0.067, 0.099], 0.38, 0],
  mouth_corner: ['head', [0.021, -0.066, 0.096], 0.42, 25],
  body_front: ['chest', [0, -0.34, 0.088], 0.5, 0],
  tank_front: ['chest', [0, -0.34, 0.088], 0.5, 0],
  back: ['chest', [0, -0.34, -0.145], 0.5, 180],
  floor_left: ['root', [-0.62, 0, 0.15], 1, 0],
  floor_right: ['root', [0.62, 0, 0.15], 1, 0],
  floor_under: ['root', [0, 0, 0], 1, 0],
};
const _pm = new THREE.Matrix4(), _pm2 = new THREE.Matrix4(), _pv = new THREE.Vector3(), _pq = new THREE.Quaternion(), _ps = new THREE.Vector3();
const STRIDE = 10;
// model space is metres with the origin between the ears; the avatar frames a 0..1.8 tall character
// the rig's root space already has the floor at y = 0 (like the toilet), metres: no extra scale, so the FX /
// props simulations and the furniture share his space
export const CHRATOS_SCALE = 1;
const DEFAULTS = { detail: 1, chair: false, headphones: true, cable: true, hoodie: null, hoodieColor: null, pantsColor: null, shoeColor: null, pants: 'joggers', hair: null, restSmile: 0.40 };
// default (linear) base colours the Rust vertex colours were authored with: tints are ratios to these
// clothes are recoloured per vertex (tintPart): only the cloth itself, not stitches / soles / laces / metal.
// [base sRGB of the cloth as authored in Rust, max linear channel still considered cloth]
const CLOTH = { torso: [[27, 27, 31], 0.034], pants: [[50, 52, 60], 0.062], pants_jeans: [[40, 54, 88], 0.34], shoes: [[42, 44, 52], 0.036] };
const BASE = { hoodie: new THREE.Color().setRGB(26 / 255, 26 / 255, 30 / 255, THREE.SRGBColorSpace), hair: new THREE.Color().setRGB(31 / 255, 21 / 255, 16 / 255, THREE.SRGBColorSpace) };

const params = (detail, extra) => ({ detail, v: INFO.version, ...extra });
const kindOf = (part) => 'human_' + part;
function meta(part, detail) {
  const m = getMesh(kindOf(part), params(detail, { attr: 'meta' })).attributes.position.array;
  return { skinned: m[0] > 0, tris: m[1], verts: m[2], morphs: INFO.morphs.filter((_, i) => m[3 + i] > 0) };
}
/** every [kind, params] a part needs (meta must be in memory already) */
function partRequests(part, detail) {
  const mt = meta(part, detail);
  const out = [[kindOf(part), params(detail)], [kindOf(part), params(detail, { attr: 'color' })]];
  if (mt.skinned) out.push([kindOf(part), params(detail, { attr: 'skin' })], [kindOf(part), params(detail, { attr: 'skin_index' })]);
  for (const name of mt.morphs) out.push([kindOf(part), params(detail, { attr: 'morph', morph: name })]);
  return out;
}

/** BufferGeometry of one part with colour (+ skin + morph targets) attributes */
function partGeometry(part, detail) {
  const mt = meta(part, detail);
  const g = getMesh(kindOf(part), params(detail));
  const attr = (extra) => getMesh(kindOf(part), params(detail, extra)).attributes.position.array;
  g.setAttribute('color', new THREE.BufferAttribute(attr({ attr: 'color' }), 3));
  if (mt.skinned) {
    // three weights + three skin-bone indices per vertex (INFO.skinBones order)
    const w = attr({ attr: 'skin' }), ix = attr({ attr: 'skin_index' }), n = w.length / 3;
    const sw = new Float32Array(n * 4), si = new Uint16Array(n * 4);
    for (let i = 0; i < n; i++) {
      sw[i * 4] = w[i * 3]; sw[i * 4 + 1] = w[i * 3 + 1]; sw[i * 4 + 2] = w[i * 3 + 2];
      si[i * 4] = ix[i * 3]; si[i * 4 + 1] = ix[i * 3 + 1]; si[i * 4 + 2] = ix[i * 3 + 2];
    }
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  }
  if (mt.morphs.length) {
    g.morphAttributes.position = mt.morphs.map((name) => new THREE.BufferAttribute(attr({ attr: 'morph', morph: name }), 3));
    g.morphTargetsRelative = true;
  }
  g.userData.meta = mt;
  g.computeBoundingSphere();
  return g;
}

// Procedural textures. The eye and hair-card textures are generated in Rust (human_eye_texture /
// human_hair_texture); the skin micro-detail (pores) is a small tiling bump map.
const HAIR_GAIN = 1.25;
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const data = (bytes, w, h, srgb) => {
    const t = new THREE.DataTexture(bytes, w, h, THREE.RGBAFormat);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4; t.needsUpdate = true;
    return t;
  };
  const eye = data(pkg.human_eye_texture(512), 512, 512, true);
  const hair = data(pkg.human_hair_texture(256, 512), 256, 512, false);
  hair.wrapS = THREE.RepeatWrapping;
  // pores: two octaves of smoothed noise, tiling
  const n = 128, src = new Float32Array(n * n), d = new Uint8Array(n * n * 4);
  let s = 1234567;
  for (let i = 0; i < n * n; i++) { s = (s * 1664525 + 1013904223) >>> 0; src[i] = (s >>> 8) / 16777216; }
  const at = (x, y) => src[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fine = (at(x, y) * 2 + at(x + 1, y) + at(x - 1, y) + at(x, y + 1) + at(x, y - 1)) / 6;
    const coarse = (at(x >> 2, y >> 2) + at((x >> 2) + 1, y >> 2) + at(x >> 2, (y >> 2) + 1)) / 3;
    const pit = fine < 0.36 ? 0.55 : 1;                       // sparse darker pits = pores
    const v = Math.round(255 * Math.min(1, (0.55 * fine + 0.45 * coarse) * pit));
    const o = (y * n + x) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
  }
  const pores = data(d, n, n, false);
  pores.wrapS = pores.wrapT = THREE.RepeatWrapping; pores.repeat.set(26, 22);
  // fabric normal maps (tiling 4 cm, cloth UVs from Rust): knitted fleece, denim twill
  const fabric = (kind) => { const t = data(pkg.human_fabric_texture(256, kind), 256, 256, false); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  return (TEX = { eye, hair, pores, fleece: fabric(0), denim: fabric(1) });
}

function makeMaterials() {
  const T = textures();
  const P = (o) => new THREE.MeshPhysicalMaterial({ vertexColors: true, ...o });
  return {
    // skin: no clearcoat (that reads as plastic); a warm sheen stands in for subsurface scattering, pores from the bump map
    skin: P({ roughness: 0.56, sheen: 0.55, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.55, 0.20, 0.14), specularIntensity: 0.6, bumpMap: T.pores, bumpScale: 0.6 }),
    // hair cards: alpha-tested strands (alpha to coverage with MSAA: no sorting needed), anisotropic highlight across the strands
    hair: P({ map: T.hair, color: new THREE.Color(HAIR_GAIN, HAIR_GAIN, HAIR_GAIN), alphaTest: 0.30, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.55, anisotropy: 0.6,
      specularIntensity: 0.3 }),
    // beard / brows / lashes: thousands of single-hair ribbons over a dark shell
    beard: P({ side: THREE.DoubleSide, roughness: 0.6, specularIntensity: 0.35 }),
    eye: P({ map: T.eye, roughness: 0.30, specularIntensity: 0.4 }),
    // cornea: clear glossy bulge over the iris (blended, drawn after everything opaque, never writes depth)
    cornea: new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.10, roughness: 0.0, clearcoat: 1, clearcoatRoughness: 0.0, envMapIntensity: 1.6, depthWrite: false }),
    teeth: P({ roughness: 0.3, clearcoat: 0.4 }),
    pants: P({ roughness: 0.9, normalMap: T.fleece, normalScale: new THREE.Vector2(0.55, 0.55), sheen: 0.25, sheenRoughness: 0.9, sheenColor: new THREE.Color(0.2, 0.2, 0.24) }),
    shoes: P({ roughness: 0.72 }),
    cloth: P({ normalMap: T.fleece, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.95, sheen: 0.35, sheenRoughness: 0.9, sheenColor: new THREE.Color(0.25, 0.25, 0.28) }),
    plastic: P({ roughness: 0.62 }),
    pad: P({ roughness: 0.86, sheen: 0.2, sheenRoughness: 0.8 }),
    metal: P({ roughness: 0.32, metalness: 0.9 }),
    cable: new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.6 }),
    chair: P({ roughness: 0.8 }),
  };
}
const PART_MATERIAL = {
  head: 'skin', beard: 'beard', brows: 'beard', hair: 'hair', hair_cap: 'beard', eye: 'eye', cornea: 'cornea', mouth_upper: 'teeth', mouth_lower: 'teeth',
  torso: 'cloth', pants: 'pants', pants_jeans: 'pants', shoes: 'shoes', hands: 'skin', hp_shell: 'plastic', hp_pad: 'pad', hp_metal: 'metal', plug: 'metal', chair: 'chair',
};

export class Chratos {
  /** Build/persist every mesh without blocking a frame for long (yields between meshes). Call before `new Chratos()`. */
  static async preload(theme, onProgress) {
    if (!pkg) return false;
    const detail = theme?.chratos?.detail ?? DEFAULTS.detail;
    // only what this theme shows (the other pants variant / the optional chair backrest are built on demand)
    const cfg = { ...DEFAULTS, ...(theme?.chratos || {}) };
    const parts = INFO.parts.filter((p) => (p !== 'chair' || cfg.chair) && p !== (cfg.pants === 'jeans' ? 'pants' : 'pants_jeans'));
    for (let i = 0; i < parts.length; i++) {
      await warm(kindOf(parts[i]), params(detail, { attr: 'meta' }));
      for (const [k, p] of partRequests(parts[i], detail)) await warm(k, p);
      onProgress?.((i + 1) / parts.length, parts[i]);
      await new Promise((r) => setTimeout(r, 0));
    }
    pkg.human_free();
    return true;
  }

  constructor(theme = {}, seed = 1) {
    if (!pkg) throw new Error('Chratos needs the Rust/wasm build (web/pkg)');
    this.name = 'chratos';
    this.listeners = new Set();
    this.accessories = [];
    this.restOpen = 0;
    this.rig = new pkg.HumanRig(seed >>> 0);
    this.nodeOrder = this.rig.node_order().split(',');
    this.morphNames = this.rig.morph_names().split(',');
    this.views = []; this.buffer = null;
    this.root = new THREE.Group(); this.root.name = 'chratos';
    this.fx = new THREE.Group(); this.fx.name = 'fx'; this.root.add(this.fx);
    this.materials = makeMaterials();
    this.theme = theme || {};
    this.mats = new MaterialLib(this.theme.materials || {});
    this.props = [];
    this.build(theme);
    this.buildFx();
    this.buildAccessories();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  /** zero-copy f32 view into wasm memory (rebuilt when the memory grows) */
  view(id) {
    const buf = W.memory.buffer;
    if (buf !== this.buffer) { this.buffer = buf; this.views = []; }
    return this.views[id] ||= new Float32Array(buf, this.rig.buf_ptr(id), this.rig.buf_len(id));
  }

  build(theme) {
    const cfg = { ...DEFAULTS, ...(theme?.chratos || {}) };
    this.cfg = cfg;
    if (this.body) { this.root.remove(this.body); this.disposeMeshes(); }
    const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    const B = Object.fromEntries(INFO.nodes.map((n, i) => [n, INFO.bind[i]]));   // bind positions (model space)
    const body = this.body = new THREE.Group(); body.name = 'body';
    this.root.add(body);
    // skeleton (local TRS comes from the Rust pose buffer every frame); built in the bind pose first
    const N = this.nodes = {};
    INFO.nodes.forEach((name, i) => {
      const o = N[name] = new THREE.Bone(); o.name = name;
      const par = INFO.parents[i];
      (par < 0 ? body : N[INFO.nodes[par]]).add(o);
      o.position.copy(V(INFO.bind[i]));
      if (par >= 0) o.position.sub(V(INFO.bind[par]));
    });
    this.head = N.head;
    body.add(N.plug);                       // the plug's pose is in rig-root space too
    // model-space containers under the bones (rigid parts are authored in model space)
    const space = (node, name) => { const g = new THREE.Group(); g.name = name; g.position.copy(V(B[node])).negate(); N[node].add(g); return g; };
    const headSpace = this.headSpace = space('head', 'head_space');
    const jawSpace = space('jaw', 'jaw_space');
    body.updateMatrixWorld(true);
    const skeleton = this.skeleton = new THREE.Skeleton(INFO.skinBones.map((n) => N[n]));

    this.meshes = {}; this.morphMeshes = [];
    const add = (part, parent) => {
      const geo = partGeometry(part, cfg.detail), mt = geo.userData.meta, mat = this.materials[PART_MATERIAL[part]];
      let mesh;
      if (mt.skinned) {
        mesh = new THREE.SkinnedMesh(geo, mat);
        body.add(mesh);
        mesh.updateMatrixWorld(true);
        mesh.bind(skeleton, mesh.matrixWorld);
        mesh.frustumCulled = false;
      } else {
        mesh = new THREE.Mesh(geo, mat);
        parent.add(mesh);
      }
      mesh.name = part;
      if (mt.morphs.length) {
        mesh.morphTargetInfluences = new Array(mt.morphs.length).fill(0);
        mesh.morphTargetDictionary = Object.fromEntries(mt.morphs.map((n, i) => [n, i]));
        this.morphMeshes.push({ mesh, names: mt.morphs, idx: mt.morphs.map((n) => this.morphNames.indexOf(n)) });
        mesh.frustumCulled = false;
      }
      mesh.castShadow = true; mesh.receiveShadow = part !== 'cornea';
      this.meshes[part] = mesh;
      return mesh;
    };
    add('head'); add('beard'); add('brows');
    add('hair_cap', headSpace); add('hair', headSpace); add('mouth_upper', headSpace);
    add('mouth_lower', jawSpace);
    add('torso'); this.meshes.pants = add(cfg.pants === 'jeans' ? 'pants_jeans' : 'pants'); add('shoes'); add('hands');
    this.headphones = new THREE.Group(); this.headphones.name = 'headphones'; headSpace.add(this.headphones);
    add('hp_shell', this.headphones); add('hp_pad', this.headphones); add('hp_metal', this.headphones);
    if (cfg.chair) add('chair', body);   // optional gaming-chair backrest (off by default: furniture comes from the app)
    // eyes: one geometry, two nodes
    const eyeGeo = partGeometry('eye', cfg.detail), corneaGeo = partGeometry('cornea', cfg.detail);
    for (const n of [N.eye_L, N.eye_R]) {
      const e = new THREE.Mesh(eyeGeo, this.materials.eye), c = new THREE.Mesh(corneaGeo, this.materials.cornea);
      e.name = 'eye'; c.name = 'cornea'; c.renderOrder = 2; c.castShadow = false;
      n.add(e, c);
    }
    this.meshes.plug = add('plug', N.plug);
    // cable: positions / normals are rewritten from the rig every frame
    const cg = new THREE.BufferGeometry(), cn = INFO.cable.points * INFO.cable.sides * 3;
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cn), 3));
    cg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(cn), 3));
    cg.setIndex(new THREE.BufferAttribute(pkg.human_cable_indices(), 1));
    this.cable = new THREE.Mesh(cg, this.materials.cable); this.cable.name = 'cable'; this.cable.frustumCulled = false;
    body.add(this.cable);                 // rope vertices are in rig-root space (not under the moving root NODE)
    // sockets for accessories (hats on head_top, glasses on eyes): model space, metres
    this.sockets = {};
    for (const [k, d] of Object.entries(INFO.sockets)) {
      const s = this.sockets[k] = new THREE.Group(); s.name = 'socket_' + k;
      s.position.copy(V(d.pos)).sub(V(B[d.node])); N[d.node].add(s);
    }
    // the toilet's accessory sockets, fitted to the human (FIT): hats, glasses, cigars, floor props, furniture
    for (const [k, [node, pos, scale, yaw]] of Object.entries(FIT)) {
      const s = this.sockets[k] = new THREE.Group(); s.name = 'socket_' + k;
      if (node === 'root') { s.position.fromArray(pos); this.root.add(s); }
      else { s.position.copy(V(pos)).sub(V(B[node])); N[node].add(s); }
      s.scale.setScalar(scale); s.rotation.y = (yaw * Math.PI) / 180;
    }
    // the toilet-paper roll he pulls out (right palm), shown by the rig while the paper action runs
    const roll = this.roll = new THREE.Group(); roll.name = 'paper_roll'; roll.visible = false;
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.95 });
    const rollBody = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.1, 28, 1, true), paperMat);
    const rollEnds = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.052, 28), paperMat.clone()); rollEnds.material.side = THREE.DoubleSide;
    const rollEnd2 = rollEnds.clone();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.101, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x9c7a55, roughness: 0.9, side: THREE.DoubleSide }));
    rollEnds.rotation.x = Math.PI / 2; rollEnds.position.y = 0.05; rollEnd2.rotation.x = -Math.PI / 2; rollEnd2.position.y = -0.05;
    const spin = this.rollSpin = new THREE.Group(); spin.add(rollBody, rollEnds, rollEnd2, core);
    spin.rotation.z = Math.PI / 2;                 // roll axis = x (across the strip)
    roll.add(spin); roll.position.set(0, -0.01, 0.045);
    this.sockets.hand_R.add(roll);
    pkg.human_free();
    this.applyTheme(cfg);
    this.applyPose();
    this.applyCable();
  }

  applyTheme(cfg) {
    if (cfg.chair && !this.meshes.chair) return this.build({ chratos: cfg });
    if (this.meshes.chair) this.meshes.chair.visible = !!cfg.chair;
    this.headphones.visible = cfg.headphones !== false;
    this.cable.visible = this.meshes.plug.visible = cfg.headphones !== false && cfg.cable !== false;
    const tint = (mat, col, base) => {
      if (!col) return mat.color.setRGB(1, 1, 1);
      const c = new THREE.Color(col);
      mat.color.setRGB(c.r / base.r, c.g / base.g, c.b / base.b);
    };
    this.tintPart('torso', cfg.hoodieColor || cfg.hoodie);
    this.tintPart(cfg.pants === 'jeans' ? 'pants_jeans' : 'pants', cfg.pantsColor);
    this.tintPart('shoes', cfg.shoeColor);
    const jeans = cfg.pants === 'jeans';
    this.materials.pants.normalMap = jeans ? TEX.denim : TEX.fleece;
    this.materials.pants.normalScale.setScalar(jeans ? 0.9 : 0.55);
    this.materials.pants.needsUpdate = true;
    tint(this.materials.hair, cfg.hair, BASE.hair);
    this.materials.hair.color.multiplyScalar(HAIR_GAIN);   // the card texture stores brightness / 1.6
    tint(this.materials.beard, cfg.hair, BASE.hair);
    this.rig.set_rest_smile(cfg.restSmile ?? DEFAULTS.restSmile);
  }

  /** recolour the cloth vertices of a part (stitches, soles, laces and metal keep their colour); null = authored colour */
  tintPart(part, col) {
    const mesh = this.meshes[part === 'pants_jeans' ? 'pants' : part], spec = CLOTH[part];
    if (!mesh || !spec) return;
    const attr = mesh.geometry.attributes.color, key = col || '';
    if (mesh.userData.tint === key) return;
    const src = mesh.geometry.userData.col0 ||= attr.array.slice();
    mesh.userData.tint = key;
    if (!col) { attr.array.set(src); attr.needsUpdate = true; return; }
    const base = new THREE.Color().setRGB(spec[0][0] / 255, spec[0][1] / 255, spec[0][2] / 255, THREE.SRGBColorSpace), c = new THREE.Color(col);
    const k = [c.r / base.r, c.g / base.g, c.b / base.b], a = attr.array, max = spec[1];
    for (let i = 0; i < a.length; i += 3) {
      const cloth = Math.max(src[i], src[i + 1], src[i + 2]) < max;
      for (let j = 0; j < 3; j++) a[i + j] = cloth ? src[i + j] * k[j] : src[i + j];
    }
    attr.needsUpdate = true;
  }

  /** theme.chratos = { pants: 'joggers' | 'jeans', hoodieColor, pantsColor, shoeColor, hair: '#rrggbb', chair, headphones, cable, restSmile, detail } (all optional) */
  setTheme(theme) {
    const cfg = { ...DEFAULTS, ...(theme?.chratos || {}) };
    this.theme = theme || {};
    if (cfg.detail !== this.cfg.detail || cfg.pants !== this.cfg.pants) { this.build(theme); this.buildAccessories(); return; }
    this.cfg = cfg;
    this.applyTheme(cfg);
    if (JSON.stringify(this.theme.slots || {}) !== this.slotsKey) this.buildAccessories();
  }

  /** flush (spit) paper gargle backflip blink jump no sit stand laugh nod surprise wink blargh (other names: returns false) */
  play(name) { this.syncSeat(); return this.rig.play(String(name)); }
  get isPlaying() { return this.rig.is_playing(); }
  get blinkTimer() { return this.rig.blink_timer(); }
  set blinkTimer(v) { this.rig.set_blink_timer(+v); }
  setLookLimits(yaw, pitch) { this.rig.set_look_limits(yaw, pitch); }
  /** sitting: rig.set_seat_height(h) + play('sit') / play('stand'), or sit directly */
  get isSitting() { return this.rig.is_sitting(); }
  set isSitting(_) {}
  get sitHeight() { return this.rig.is_sitting() ? this.rig.seat_height() : 0; }
  set sitHeight(h) { this.rig.set_seat_height(+h || 0); this.rig.set_sit(h > 0 ? 1 : 0); }
  /** { position, direction } (THREE.Vector3, world space) where a water jet leaves the mouth */
  spout() {
    const s = this.rig.spout(), m = this.nodes.root.parent.matrixWorld;
    return { position: new THREE.Vector3(s[0], s[1], s[2]).applyMatrix4(m), direction: new THREE.Vector3(s[3], s[4], s[5]).transformDirection(m) };
  }
  /** capsules for props physics: [{ node, a, b, r }] (model space at bind), from Rust */
  get bodyCollider() { return INFO.colliders; }

  update(dt, input = {}) {
    const l = input.look || {}, m = input.mouth || {};
    const r = this.rig;
    r.set_input(l.x || 0, l.y || 0, m.open || 0, m.round || 0, m.wide || 0, m.closed || 0, m.sib || 0);
    r.set_input_ext(m.cornerL || 0, m.cornerR || 0, m.jawSide || 0, m.jawFwd || 0, m.upperRaise || 0, m.lips || 0);
    this.syncSeat();
    this.writePropRest();
    r.update(dt);
    this.applyPose();
    this.applyCable();
    const S = this.view(BUF.SCALARS);
    this.applyFx(S);
    this.applyPropPoses();
    if (this.accessories.length) {
      const st = { dt: S[SC.DT], time: S[SC.TIME], mouth: S[SC.ST_MOUTH], talk: S[SC.ST_TALK], headYawVel: S[SC.HEAD_YAW_VEL], headPitchVel: S[SC.HEAD_PITCH_VEL], lift: S[SC.ST_LIFT] };
      for (const a of this.accessories) a.traverse((x) => x.userData.update?.(st));
    }
    if (r.pending_events()) for (const e of r.drain_events().split('\n')) {
      if (!e) continue;
      if (e.startsWith('clack:')) this.emit('sfx', { type: 'clack', v: parseFloat(e.slice(6)) });
      else if (e.startsWith('prop_hit:')) { const i = e.lastIndexOf(':'); this.emit('sfx', { type: 'thud', v: parseFloat(e.slice(i + 1)), id: e.slice(9, i) }); }
      else if (e.startsWith('prop_reset:')) this.emit('sfx', 'pop');
      else this.emit('sfx', e);
    }
  }

  applyPose() {
    const P = this.view(BUF.POSE), order = this.nodeOrder;
    for (let i = 0; i < order.length; i++) {
      const o = this.nodes[order[i]], k = i * STRIDE;
      if (!o) continue;
      o.position.set(P[k], P[k + 1], P[k + 2]);
      o.quaternion.set(P[k + 3], P[k + 4], P[k + 5], P[k + 6]);
      o.scale.set(P[k + 7], P[k + 8], P[k + 9]);
    }
    const Wt = this.view(BUF.MORPHS), F = this.forceMorphs;   // forceMorphs: { name: weight } debug override
    for (const { mesh, idx, names } of this.morphMeshes || []) {
      const inf = mesh.morphTargetInfluences;
      for (let j = 0; j < idx.length; j++) inf[j] = F && names[j] in F ? F[names[j]] : Wt[idx[j]];
    }
  }

  /* ------------------------------------------------------------ FX (water jet, paper strips): Rust buffers */
  buildFx() {
    const jetMat = this.mats.get('water').clone();
    this.jet = new WaterJet(jetMat);
    this.fx.add(this.jet.group);
    const stripMat = this.mats.get('paperStrip', 'paper');
    this.paper = new PaperStrip(stripMat, 0.1);
    this.torn = new PaperStrip(stripMat, 0.1);
    this.fx.add(this.paper.mesh, this.torn.mesh);
    for (const ps of [this.paper, this.torn]) {   // wet paper: per-vertex RGBA from Rust
      const n = ps.geo.attributes.position.count;
      ps.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4).fill(1), 4).setUsage(THREE.DynamicDrawUsage));
      ps.mat.vertexColors = true;
      ps._wet = false; ps._rustN = 0;
      ps.geo.setDrawRange(0, 0); ps.perfGeo.setDrawRange(0, 0);
      ps.mesh.frustumCulled = false;
    }
    this.puddleVersion = -1;
  }

  applyFx(S) {
    const J = this.jet, view = (id) => this.view(id);
    J.drops.mesh.instanceMatrix.array.set(view(BUF.DROPS)); J.drops.mesh.instanceMatrix.needsUpdate = true;
    J.foam.mesh.instanceMatrix.array.set(view(BUF.FOAM)); J.foam.mesh.instanceMatrix.needsUpdate = true;
    const streamOn = S[SC.STREAM_VISIBLE] > 0.5;
    J.stream.visible = streamOn;
    if (streamOn) {
      const g = J.stream.geometry;
      if (!g.attributes.normal) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
      g.attributes.position.array.set(view(BUF.STREAM_POS)); g.attributes.position.needsUpdate = true;
      g.attributes.normal.array.set(view(BUF.STREAM_NRM)); g.attributes.normal.needsUpdate = true;
      g.attributes.uv.array.set(view(BUF.STREAM_UV)); g.attributes.uv.needsUpdate = true;
    }
    const RP = view(BUF.RIPPLES);
    J.ripples.forEach((m, i) => {
      const k = i * 5;
      m.visible = RP[k + 4] > 0.5;
      if (!m.visible) return;
      m.position.x = RP[k]; m.position.z = RP[k + 1];
      m.scale.set(RP[k + 2], 1, RP[k + 2]);
      m.material.opacity = RP[k + 3];
    });
    const PU = view(BUF.PUDDLE);
    J.puddle.position.x = PU[0]; J.puddle.position.z = PU[1];
    J.puddle.scale.set(PU[2], 1, PU[3]);
    J.puddle.material.opacity = Math.min(1, PU[4] * (J.puddle.material.userData.opacityScale ?? 1));
    if (S[SC.PUDDLE_VERSION] !== this.puddleVersion) {
      this.puddleVersion = S[SC.PUDDLE_VERSION];
      const rad = view(BUF.PUDDLE_RADIAL), pos = J.puddle.geometry.attributes.position, base = J.puddleBase;
      for (let i = 1; i < pos.count; i++) { const f = rad[i - 1] ?? 1; pos.setXYZ(i, base[i * 3] * f, 0, base[i * 3 + 2] * f); }
      pos.needsUpdate = true;
    }
    const strip = (ps, pos, nrm, uv, perf, count, np, op, col, wetSc) => {
      const n = S[count] | 0, nperf = S[np] | 0;
      const ca = ps.geo.attributes.color;
      const wet = S[wetSc] > 0;
      if (wet && n > 0) { ca.array.set(view(col).subarray(0, n * 8)); ca.needsUpdate = true; }
      else if (!wet && ps._wet) { ca.array.fill(1); ca.needsUpdate = true; }
      ps._wet = wet;
      if (n === 0 && ps._rustN === 0) return;
      ps._rustN = n;
      const g = ps.geo;
      if (!g.attributes.normal) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
      if (n > 0) {
        g.attributes.position.array.set(view(pos).subarray(0, n * 6)); g.attributes.position.needsUpdate = true;
        g.attributes.normal.array.set(view(nrm).subarray(0, n * 6)); g.attributes.normal.needsUpdate = true;
        g.attributes.uv.array.set(view(uv).subarray(0, n * 4)); g.attributes.uv.needsUpdate = true;
      }
      g.setDrawRange(0, Math.max(0, n - 1) * 6);
      if (nperf) {
        ps.perfGeo.attributes.position.array.set(view(perf).subarray(0, nperf * 6)); ps.perfGeo.attributes.position.needsUpdate = true;
        ps.perf.computeLineDistances();
      }
      ps.perfGeo.setDrawRange(0, nperf * 2);
      ps.mat.opacity = S[op];
      ps.perfMat.opacity = S[op] * 0.9;
    };
    strip(this.paper, BUF.PAPER_POS, BUF.PAPER_NRM, BUF.PAPER_UV, BUF.PAPER_PERF, SC.PAPER_COUNT, SC.PAPER_PERF, SC.PAPER_OPACITY, BUF.PAPER_COL, SC.PAPER_WET);
    strip(this.torn, BUF.TORN_POS, BUF.TORN_NRM, BUF.TORN_UV, BUF.TORN_PERF, SC.TORN_COUNT, SC.TORN_PERF, SC.TORN_OPACITY, BUF.TORN_COL, SC.TORN_WET);
    this.roll.visible = S[SC.ROLL] > 0.02;
    if (this.roll.visible) { this.roll.scale.setScalar(Math.min(1, S[SC.ROLL] * 1.2)); this.rollSpin.rotation.x = S[SC.ROLL_ROT]; }
  }

  /* ------------------------------------------------------------ accessories on his sockets (toilet registry + FIT) */
  buildAccessories() {
    for (const a of this.accessories || []) {
      a.parent?.remove(a);
      a.traverse((o) => { if (o.isMesh && !o.userData.keepGeo) o.geometry?.dispose(); });
    }
    this.accessories = [];
    const ctx = { THREE, mats: this.mats, theme: this.theme };
    for (const [slot, entries] of Object.entries(this.theme?.slots || {})) {
      const sock = this.sockets[slot];
      if (!sock) continue;                         // toilet-only sockets are skipped silently
      (entries || []).forEach((e, i) => {
        if (!e || e.hidden) return;
        // his own beard / mustache: the toilet's stick-on mustaches are not worn
        if (slot === 'lip_upper' && !e.onHuman) return;
        let inner = null;
        try { inner = buildAccessory(ctx, { id: e.id, params: e.params }); } catch (err) { console.warn('[chratos] accessory', e.id, err?.message || err); }
        if (!inner) return;
        const wrap = new THREE.Group();
        wrap.name = `slot_${slot}_${i}_${e.id}`;
        wrap.userData = { slot, index: i, entry: e };
        wrap.add(inner);
        const t = e.transform || {};
        wrap.position.fromArray(t.position || [0, 0, 0]);
        wrap.rotation.fromArray([...(t.rotation || [0, 0, 0]), 'XYZ']);
        const sc = t.scale ?? 1;
        Array.isArray(sc) ? wrap.scale.fromArray(sc) : wrap.scale.setScalar(sc);
        sock.add(wrap);
        this.accessories.push(wrap);
      });
    }
    this.slotsKey = JSON.stringify(this.theme?.slots || {});
    this.registerProps();
    this._seatSent = null;
  }

  /** seat height (m) of the furniture on floor_under (same rule as ToiletTuber.seatHeight) */
  seatHeight() {
    let h = 0;
    for (const w of this.accessories || []) {
      if (w.userData.slot !== 'floor_under') continue;
      const sh = entrySeatHeight(w.userData.entry || {});
      if (sh > 0) h = Math.max(h, sh * w.scale.y + w.position.y);
    }
    return h;
  }
  syncSeat() {
    const h = this.seatHeight();
    if (h === this._seatSent) return;
    this._seatSent = h;
    this.rig.set_seat_height(h);
  }

  /* ------------------------------------------------------------ props physics (same rules as ToiletTuber) */
  registerProps() {
    this.props = [];
    const r = this.rig;
    r.clear_props();
    this.root.updateMatrixWorld(true);
    const rootInv = _pm2.copy(this.root.matrixWorld).invert();
    for (const wrap of this.accessories) {
      const e = wrap.userData.entry || {};
      if (e.physics === false || e.physical === false) continue;
      let meta = (e.physics && typeof e.physics === 'object' ? e.physics : null) ||
        ACC_INFO[e.id]?.physics || FURN[e.id]?.physics || (e.physical ? { shape: 'box', fit: true, mass: 0.3 } : null);
      const seatH = wrap.userData.slot === 'floor_under' ? entrySeatHeight(e) : 0;
      if (seatH > 0) meta = { shape: 'box', fit: true, mass: FURN[e.id]?.mass ?? 3, ...(meta || {}), seat: true, seatHeight: seatH };
      if (!meta) continue;
      const onBody = wrap.parent?.parent !== this.root;
      const obj = wrap.children[0];
      if (!obj) continue;
      if (meta.parts) {
        let n = obj;
        while (n.children.length === 1) n = n.children[0];
        n.children.forEach((part, i) => this.addProp(`${wrap.name}#${i}`, part, null, { group: wrap.name, onBody, ...meta.parts }, rootInv));
      } else this.addProp(wrap.name, wrap, obj, { onBody, ...meta }, rootInv);
    }
  }

  addProp(id, target, obj, meta, rootInv) {
    const box = new THREE.Box3();
    let center, size;
    const cyl = meta.shape === 'cylinder';
    if (meta.fit || !meta.size) {
      const inv = new THREE.Matrix4().copy(target.matrixWorld).invert(), tmp = new THREE.Box3();
      target.traverse((m) => {
        if (!m.isMesh || !m.geometry?.attributes?.position) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.union(tmp.copy(m.geometry.boundingBox).applyMatrix4(_pm.multiplyMatrices(inv, m.matrixWorld)));
      });
    }
    if (!box.isEmpty()) {
      center = box.getCenter(new THREE.Vector3()); size = box.getSize(new THREE.Vector3());
    } else {
      const M = new THREE.Matrix4();
      if (obj) { obj.updateMatrix(); M.copy(obj.matrix); if (obj.children[0]) { obj.children[0].updateMatrix(); M.multiply(_pm.makeScale(...obj.children[0].scale.toArray())); } }
      const sc = new THREE.Vector3().setFromMatrixScale(M);
      center = new THREE.Vector3().fromArray(meta.center || [0, 0, 0]).applyMatrix4(M);
      const sz = meta.size || [0.1, 0.1, 0.1];
      size = Array.isArray(sz) ? new THREE.Vector3().fromArray(sz) : new THREE.Vector3(2 * sz.r, sz.h, 2 * sz.r);
      size.multiply(sc);
    }
    if (meta.seatHeight > 0) { center.y = meta.seatHeight / 2; size.y = meta.seatHeight; }
    if (!(size.x > 0.002 && size.y > 0.002 && size.z > 0.002)) return;
    const com = center.clone(); com.y += ((meta.comY ?? 0.5) - 0.5) * size.y;
    const shape = {
      kind: cyl ? 'cylinder' : 'box',
      size: cyl ? { r: Math.max(size.x, size.z) / 2, h: size.y } : size.toArray(),
      mass: meta.mass ?? 0.3, center: center.toArray(), com: com.toArray(),
      group: meta.group || '', buoyant: !!meta.buoyant, seat: !!meta.seat, onBody: !!meta.onBody,
    };
    target.updateMatrix();
    const restLocal = target.matrix.clone();
    const rest = _pm.multiplyMatrices(rootInv, target.parent.matrixWorld).multiply(restLocal);
    const slot = this.rig.register_prop(id, JSON.stringify(shape), new Float32Array(rest.elements));
    if (slot < 0) return;
    this.props.push({ id, slot, target, restLocal, dyn: false, p0: target.position.clone(), q0: target.quaternion.clone(), s0: target.scale.clone() });
  }

  setPropSettings(cfg = {}) {
    this.propSettings = { resetAfter: cfg?.resetAfter ?? 8, enabled: cfg?.enabled !== false };
    this.rig.set_props_config(JSON.stringify(this.propSettings));
  }
  kickProp(id, x = 0, y = 0.05, z = 0.1) { return !!this.rig.prop_kick(id, x, y, z); }

  writePropRest() {
    if (!this.props.length) return;
    const view = this.view(BUF.PROP_REST);
    const rootInv = _pm2.copy(this.root.matrixWorld).invert();
    for (const p of this.props) {
      _pm.multiplyMatrices(rootInv, p.target.parent.matrixWorld).multiply(p.restLocal);
      _pm.toArray(view, p.slot * 16);
    }
  }

  applyPropPoses() {
    if (!this.props.length) return;
    const P = this.view(BUF.PROP_POSES);
    let rootW = null;
    for (const p of this.props) {
      const k = p.slot * PROP_STRIDE, st = P[k];
      if (st > 0) {
        rootW ??= this.root.matrixWorld;
        _pv.set(P[k + 1], P[k + 2], P[k + 3]); _pq.set(P[k + 4], P[k + 5], P[k + 6], P[k + 7]); _ps.set(P[k + 8], P[k + 9], P[k + 10]);
        _pm.compose(_pv, _pq, _ps).premultiply(rootW);
        const par = p.target.parent;
        par.updateWorldMatrix(true, false);
        _pm.premultiply(_pm2.copy(par.matrixWorld).invert());
        _pm.decompose(p.target.position, p.target.quaternion, p.target.scale);
        p.dyn = true;
      } else if (p.dyn) {
        p.target.position.copy(p.p0); p.target.quaternion.copy(p.q0); p.target.scale.copy(p.s0);
        p.dyn = false;
      }
    }
  }

  applyCable() {
    if (!this.cable?.visible) return;
    const g = this.cable.geometry;
    g.attributes.position.array.set(this.view(BUF.CABLE_POS));
    g.attributes.normal.array.set(this.view(BUF.CABLE_NRM));
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  }

  /** triangle count per part (debug / report) */
  stats() {
    const out = {};
    this.body.traverse((o) => { if (o.isMesh && o.visible) out[o.name] = (out[o.name] || 0) + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    out.total = Object.values(out).reduce((a, b) => a + b, 0);
    return out;
  }

  disposeMeshes() {
    const seen = new Set();
    this.body?.traverse((o) => { if (o.isMesh && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } });
    this.skeleton?.dispose?.();
  }
  dispose() {
    for (const a of this.accessories || []) a.traverse((o) => { if (o.isMesh && !o.userData.keepGeo) o.geometry?.dispose(); });
    this.fx.traverse((o) => { if (o.isMesh || o.isLine || o.isLineSegments) o.geometry?.dispose(); });
    this.mats?.dispose?.();
    this.disposeMeshes();
    for (const m of Object.values(this.materials)) m.dispose();
    this.root.removeFromParent();
    this.rig.free?.();
    this.listeners.clear();
  }
}
