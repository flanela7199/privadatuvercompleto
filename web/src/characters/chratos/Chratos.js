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

const W = await loadWasm();
const pkg = W?.pkg?.HumanRig && geoReady ? W.pkg : null;
/** false when the Rust/wasm build is missing (?nowasm / ?nogeo): the avatar keeps the toilet */
export const chratosReady = !!pkg;
const INFO = pkg ? JSON.parse(pkg.human_rig_info()) : null;
const BUF = { POSE: 0, MORPHS: 1, CABLE_POS: 2, CABLE_NRM: 3 };
const STRIDE = 10;
// model space is metres with the origin between the ears; the avatar frames a 0..1.8 tall character
const MODEL_BOTTOM = INFO?.bottom ?? -1.63, MODEL_TOP = INFO?.top ?? 0.165;   // bottom = the floor under his feet
export const CHRATOS_SCALE = 1.75 / (MODEL_TOP - MODEL_BOTTOM);
const DEFAULTS = { detail: 1, chair: false, headphones: true, cable: true, hoodie: null, hair: null, restSmile: 0.40 };
// default (linear) base colours the Rust vertex colours were authored with: tints are ratios to these
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
  return (TEX = { eye, hair, pores });
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
    pants: P({ roughness: 0.9 }),
    shoes: P({ roughness: 0.7 }),
    cloth: P({ roughness: 0.95, sheen: 0.35, sheenRoughness: 0.9, sheenColor: new THREE.Color(0.25, 0.25, 0.28) }),
    plastic: P({ roughness: 0.62 }),
    pad: P({ roughness: 0.86, sheen: 0.2, sheenRoughness: 0.8 }),
    metal: P({ roughness: 0.32, metalness: 0.9 }),
    cable: new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.6 }),
    chair: P({ roughness: 0.8 }),
  };
}
const PART_MATERIAL = {
  head: 'skin', beard: 'beard', brows: 'beard', hair: 'hair', hair_cap: 'beard', eye: 'eye', cornea: 'cornea', mouth_upper: 'teeth', mouth_lower: 'teeth',
  torso: 'cloth', pants: 'pants', shoes: 'shoes', hands: 'skin', hp_shell: 'plastic', hp_pad: 'pad', hp_metal: 'metal', plug: 'metal', chair: 'chair',
};

export class Chratos {
  /** Build/persist every mesh without blocking a frame for long (yields between meshes). Call before `new Chratos()`. */
  static async preload(theme, onProgress) {
    if (!pkg) return false;
    const detail = theme?.chratos?.detail ?? DEFAULTS.detail;
    const parts = INFO.parts;
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
    this.build(theme);
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
    body.scale.setScalar(CHRATOS_SCALE);
    body.position.y = -MODEL_BOTTOM * CHRATOS_SCALE;                 // his soles on y = 0
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
    add('torso'); add('pants'); add('shoes'); add('hands');
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
    N.root.add(this.cable);
    // sockets for accessories (hats on head_top, glasses on eyes): model space, metres
    this.sockets = {};
    for (const [k, d] of Object.entries(INFO.sockets)) {
      const s = this.sockets[k] = new THREE.Group(); s.name = 'socket_' + k;
      s.position.copy(V(d.pos)).sub(V(B[d.node])); N[d.node].add(s);
    }
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
    tint(this.materials.cloth, cfg.hoodie, BASE.hoodie);
    tint(this.materials.hair, cfg.hair, BASE.hair);
    this.materials.hair.color.multiplyScalar(HAIR_GAIN);   // the card texture stores brightness / 1.6
    tint(this.materials.beard, cfg.hair, BASE.hair);
    this.rig.set_rest_smile(cfg.restSmile ?? DEFAULTS.restSmile);
  }

  /** theme.chratos = { chair, headphones, cable, hoodie: '#rrggbb', hair: '#rrggbb', restSmile, detail } (all optional) */
  setTheme(theme) {
    const cfg = { ...DEFAULTS, ...(theme?.chratos || {}) };
    if (cfg.detail !== this.cfg.detail) return this.build(theme);
    this.cfg = cfg;
    this.applyTheme(cfg);
  }

  /** laugh nod no surprise wink blink jump backflip gargle blargh (spit) sit stand (other names: returns false) */
  play(name) { return this.rig.play(String(name)); }
  get isPlaying() { return this.rig.is_playing(); }
  get blinkTimer() { return this.rig.blink_timer(); }
  set blinkTimer(v) { this.rig.set_blink_timer(+v); }
  setLookLimits(yaw, pitch) { this.rig.set_look_limits(yaw, pitch); }
  seatHeight() { return 0; }
  /** sitting: rig.set_seat_height(h) + play('sit') / play('stand'), or sit directly */
  get isSitting() { return this.rig.is_sitting(); }
  set isSitting(_) {}
  set sitHeight(h) { this.rig.set_seat_height(+h || 0); this.rig.set_sit(h > 0 ? 1 : 0); }
  /** { position, direction } (THREE.Vector3, world space) where a water jet leaves the mouth */
  spout() {
    const s = this.rig.spout(), m = this.nodes.root.parent.matrixWorld;
    return { position: new THREE.Vector3(s[0], s[1], s[2]).applyMatrix4(m), direction: new THREE.Vector3(s[3], s[4], s[5]).transformDirection(m) };
  }
  /** capsules for props physics: [{ node, a, b, r }] (model space at bind), from Rust */
  get bodyCollider() { return INFO.colliders; }
  setPropSettings() {}

  update(dt, input = {}) {
    const l = input.look || {}, m = input.mouth || {};
    const r = this.rig;
    r.set_input(l.x || 0, l.y || 0, m.open || 0, m.round || 0, m.wide || 0, m.closed || 0, m.sib || 0);
    r.set_input_ext(m.cornerL || 0, m.cornerR || 0, m.jawSide || 0, m.jawFwd || 0, m.upperRaise || 0, m.lips || 0);
    r.update(dt);
    this.applyPose();
    this.applyCable();
    if (r.pending_events()) for (const e of r.drain_events().split('\n')) {
      if (!e) continue;
      if (e.startsWith('clack:')) this.emit('sfx', { type: 'clack', v: parseFloat(e.slice(6)) });
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
    this.disposeMeshes();
    for (const m of Object.values(this.materials)) m.dispose();
    this.root.removeFromParent();
    this.rig.free?.();
    this.listeners.clear();
  }
}
