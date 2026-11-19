// "Chratos": the stylized human bust (head, beard, hair, headphones, hoodie).
// THIN renderer: every mesh, blend shape, skin weight and all per-frame logic come from Rust
// (crates/privada-core/src/human, via web/pkg). This file only turns the Rust buffers into
// three.js objects and applies pose + morph weights each frame.
//
// Same public surface as ToiletTuber where the avatar uses it:
//   root, body, head, fx, sockets, accessories, update(dt, { look, mouth }), play(name),
//   setTheme(theme), on(fn), blinkTimer, setLookLimits(yaw, pitch), dispose()
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
const MODEL_BOTTOM = INFO?.bottom ?? -0.42, MODEL_TOP = INFO?.top ?? 0.165;
export const CHRATOS_SCALE = 1.75 / (MODEL_TOP - MODEL_BOTTOM);
const DEFAULTS = { detail: 1, chair: true, headphones: true, cable: true, hoodie: null, hair: null, restSmile: 0.30 };
// default (linear) base colours the Rust vertex colours were authored with: tints are ratios to these
const BASE = { hoodie: new THREE.Color().setRGB(26 / 255, 26 / 255, 30 / 255, THREE.SRGBColorSpace), hair: new THREE.Color().setRGB(50 / 255, 33 / 255, 24 / 255, THREE.SRGBColorSpace) };

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
  if (mt.skinned) out.push([kindOf(part), params(detail, { attr: 'skin' })]);
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
    const w = attr({ attr: 'skin' }), n = w.length / 3;
    const sw = new Float32Array(n * 4), si = new Uint16Array(n * 4);
    for (let i = 0; i < n; i++) {
      sw[i * 4] = w[i * 3]; sw[i * 4 + 1] = w[i * 3 + 1]; sw[i * 4 + 2] = w[i * 3 + 2];
      si[i * 4] = 0; si[i * 4 + 1] = 1; si[i * 4 + 2] = 2;
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

let noiseTex = null;
function skinNoise() {
  if (noiseTex) return noiseTex;
  const n = 128, d = new Uint8Array(n * n * 4);
  let s = 1234567;
  for (let i = 0; i < n * n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const v = 118 + ((s >>> 24) % 20);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  noiseTex = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.repeat.set(14, 14);
  noiseTex.needsUpdate = true;
  return noiseTex;
}

function makeMaterials() {
  const P = (o) => new THREE.MeshPhysicalMaterial({ vertexColors: true, ...o });
  const hairSheen = new THREE.Color(0.36, 0.23, 0.15);
  return {
    // skin: soft "subsurface-ish" look from sheen + a little clearcoat, fine bump noise
    skin: P({ roughness: 0.55, sheen: 0.45, sheenRoughness: 0.45, sheenColor: new THREE.Color(0.9, 0.42, 0.3), clearcoat: 0.08, clearcoatRoughness: 0.6, bumpMap: skinNoise(), bumpScale: 0.35 }),
    hair: P({ roughness: 0.48, sheen: 1, sheenRoughness: 0.35, sheenColor: hairSheen }),
    beard: P({ roughness: 0.6, sheen: 0.8, sheenRoughness: 0.45, sheenColor: hairSheen }),
    eye: P({ roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.1 }),
    cornea: new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false }),
    teeth: P({ roughness: 0.3, clearcoat: 0.4 }),
    cloth: P({ roughness: 0.95, sheen: 0.35, sheenRoughness: 0.9, sheenColor: new THREE.Color(0.25, 0.25, 0.28) }),
    plastic: P({ roughness: 0.62 }),
    pad: P({ roughness: 0.86, sheen: 0.2, sheenRoughness: 0.8 }),
    metal: P({ roughness: 0.32, metalness: 0.9 }),
    cable: new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.6 }),
    chair: P({ roughness: 0.8 }),
  };
}
const PART_MATERIAL = {
  head: 'skin', beard: 'beard', brows: 'beard', hair: 'hair', eye: 'eye', cornea: 'cornea', mouth_upper: 'teeth', mouth_lower: 'teeth',
  torso: 'cloth', hp_shell: 'plastic', hp_pad: 'pad', hp_metal: 'metal', plug: 'metal', chair: 'chair',
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
    this.isSitting = false;
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
    const B = INFO.bind, V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    const body = this.body = new THREE.Group(); body.name = 'body';
    body.scale.setScalar(CHRATOS_SCALE);
    body.position.y = -MODEL_BOTTOM * CHRATOS_SCALE;
    this.root.add(body);
    // node hierarchy (local TRS comes from the Rust pose buffer every frame)
    const N = this.nodes = {};
    N.root = new THREE.Group();
    N.chest = new THREE.Bone(); N.neck = new THREE.Bone(); N.head = new THREE.Bone();
    N.jaw = new THREE.Group(); N.eye_L = new THREE.Group(); N.eye_R = new THREE.Group(); N.plug = new THREE.Group();
    for (const [k, o] of Object.entries(N)) o.name = k;
    body.add(N.root); N.root.add(N.chest, N.plug); N.chest.add(N.neck); N.neck.add(N.head); N.head.add(N.jaw, N.eye_L, N.eye_R);
    this.head = N.head;
    this.applyPose();                       // bind pose = the rig's first pose is not neutral: use the bind positions
    N.root.position.set(0, 0, 0); N.root.quaternion.identity();
    N.chest.position.copy(V(B.chest)); N.neck.position.copy(V(B.neck).sub(V(B.chest))); N.head.position.copy(V(B.head).sub(V(B.neck)));
    for (const b of [N.chest, N.neck, N.head]) { b.quaternion.identity(); b.scale.setScalar(1); }
    // model-space containers under the bones
    const space = (parent, bind, name) => { const g = new THREE.Group(); g.name = name; g.position.copy(V(bind)).negate(); parent.add(g); return g; };
    const headSpace = this.headSpace = space(N.head, B.head, 'head_space');
    const chestSpace = space(N.chest, B.chest, 'chest_space');
    const jawSpace = space(N.jaw, B.jaw, 'jaw_space');
    body.updateMatrixWorld(true);
    const skeleton = this.skeleton = new THREE.Skeleton([N.chest, N.neck, N.head]);

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
        this.morphMeshes.push({ mesh, idx: mt.morphs.map((n) => this.morphNames.indexOf(n)) });
        mesh.frustumCulled = false;
      }
      mesh.castShadow = true; mesh.receiveShadow = part !== 'cornea';
      this.meshes[part] = mesh;
      return mesh;
    };
    add('head'); add('beard');
    add('brows', headSpace); add('hair', headSpace); add('mouth_upper', headSpace);
    add('mouth_lower', jawSpace);
    add('torso', chestSpace);
    this.headphones = new THREE.Group(); this.headphones.name = 'headphones'; headSpace.add(this.headphones);
    add('hp_shell', this.headphones); add('hp_pad', this.headphones); add('hp_metal', this.headphones);
    add('chair', body);
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
    for (const [k, p] of Object.entries(INFO.sockets)) {
      const s = this.sockets[k] = new THREE.Group(); s.name = 'socket_' + k; s.position.copy(V(p)); headSpace.add(s);
    }
    pkg.human_free();
    this.applyTheme(cfg);
    this.applyPose();
    this.applyCable();
  }

  applyTheme(cfg) {
    this.meshes.chair.visible = cfg.chair !== false;
    this.headphones.visible = cfg.headphones !== false;
    this.cable.visible = this.meshes.plug.visible = cfg.headphones !== false && cfg.cable !== false;
    const tint = (mat, col, base) => {
      if (!col) return mat.color.setRGB(1, 1, 1);
      const c = new THREE.Color(col);
      mat.color.setRGB(c.r / base.r, c.g / base.g, c.b / base.b);
    };
    tint(this.materials.cloth, cfg.hoodie, BASE.hoodie);
    tint(this.materials.hair, cfg.hair, BASE.hair);
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

  /** laugh | nod | no | surprise | wink | blink (other names are ignored: returns false) */
  play(name) { return this.rig.play(String(name)); }
  get isPlaying() { return this.rig.is_playing(); }
  get blinkTimer() { return this.rig.blink_timer(); }
  set blinkTimer(v) { this.rig.set_blink_timer(+v); }
  setLookLimits(yaw, pitch) { this.rig.set_look_limits(yaw, pitch); }
  seatHeight() { return 0; }
  setPropSettings() {}

  update(dt, input = {}) {
    const l = input.look || {}, m = input.mouth || {};
    const r = this.rig;
    r.set_input(l.x || 0, l.y || 0, m.open || 0, m.round || 0, m.wide || 0, m.closed || 0, m.sib || 0);
    r.set_input_ext(m.cornerL || 0, m.cornerR || 0, m.jawSide || 0, m.jawFwd || 0, m.upperRaise || 0, m.lips || 0);
    r.update(dt);
    this.applyPose();
    this.applyCable();
    if (r.pending_events()) for (const e of r.drain_events().split('\n')) if (e) this.emit('sfx', e);
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
    const Wt = this.view(BUF.MORPHS);
    for (const { mesh, idx } of this.morphMeshes || []) {
      const inf = mesh.morphTargetInfluences;
      for (let j = 0; j < idx.length; j++) inf[j] = Wt[idx[j]];
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
    this.body.traverse((o) => { if (o.isMesh) out[o.name] = (out[o.name] || 0) + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
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
