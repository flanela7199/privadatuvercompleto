// Material library built from a theme's "materials" table (plain JSON specs).
// Specs are MeshPhysicalMaterial properties plus a few JSON-friendly extras:
//   "side": "front" | "back" | "double"
//   any *Map key may be a texture NAME from textures.js ("normalMap": "porcelainNormal")
//   "repeat": [u, v]  -> applied to this material's own clones of those textures
//   "normalScale" / "clearcoatNormalScale": [x, y]
import * as THREE from 'three';
import { getTexture } from './textures.js';

const SIDES = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide };
const COLOR_MAPS = new Set(['map', 'emissiveMap', 'sheenColorMap', 'specularColorMap']);
const VEC2_KEYS = new Set(['normalScale', 'clearcoatNormalScale']);

function make(spec) {
  const { side, repeat, ...rest } = spec;
  const props = {};
  for (const [k, v] of Object.entries(rest)) {
    if ((k === 'map' || k.endsWith('Map')) && typeof v === 'string') {
      const base = getTexture(v);
      if (!base) continue;
      const t = base.clone();          // own clone: per-material repeat, shared image
      if (COLOR_MAPS.has(k)) t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) t.repeat.fromArray(repeat);
      t.needsUpdate = true;
      props[k] = t;
    } else if (VEC2_KEYS.has(k) && Array.isArray(v)) {
      props[k] = new THREE.Vector2(v[0], v[1] ?? v[0]);
    } else props[k] = v;
  }
  const m = new THREE.MeshPhysicalMaterial(props);
  if (side) m.side = SIDES[side] ?? THREE.FrontSide;
  if (props.opacity != null && props.opacity < 1) m.transparent = true;
  m.userData.spec = spec;   // e.g. fx/waterLook.js reads the theme's water opacity (default when absent)
  return m;
}

export class MaterialLib {
  constructor(specs) {
    this.specs = specs || {};
    this.cache = new Map();
  }
  /** get('gold') or get('fur', {color:'#..'}) — fallback used if the theme does not define it. */
  get(name, fallback) {
    if (this.cache.has(name)) return this.cache.get(name);
    let spec = this.specs[name];
    if (!spec) spec = typeof fallback === 'string' ? this.specs[fallback] : fallback;
    if (!spec) spec = { color: '#ff00ff' };
    const m = make(spec);
    m.name = name;
    this.cache.set(name, m);
    return m;
  }
  dispose() {
    for (const m of this.cache.values()) {
      for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
      m.dispose();
    }
    this.cache.clear();
  }
}
