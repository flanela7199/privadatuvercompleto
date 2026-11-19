// Big accessory pack (mix & match). Every builder takes params.color (main color)
// and params.scale. Motion lives on an inner group so the user's transform
// (position/rotation/scale from the theme or the editor) stays untouched.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { registerAccessory } from './index.js';
import { Spring } from '../anim/spring.js';
import { taperedTube, starShape, clamp } from '../rig/geo.js';

/* ------------------------------------------------------------ helpers */
const FB = {
  felt: { color: '#1b1b1d', roughness: 0.95, sheen: 0.8, sheenRoughness: 0.7, sheenColor: '#5a5a5a' },
  leather: { color: '#6b4423', roughness: 0.62, clearcoat: 0.2, clearcoatRoughness: 0.5 },
  steel: { color: '#9aa0a6', metalness: 1, roughness: 0.35 },
  wood: { color: '#7a4f2a', roughness: 0.65, clearcoat: 0.3, clearcoatRoughness: 0.4 },
  glass: { color: '#e8f2f5', roughness: 0.03, transmission: 0.9, thickness: 0.004, ior: 1.5, transparent: true, opacity: 0.35 },
  darkGlass: { color: '#0d0d0f', roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.9, clearcoat: 1, clearcoatRoughness: 0.02 },
  fabric: { color: '#9e1b2a', roughness: 0.85, sheen: 1, sheenRoughness: 0.5, sheenColor: '#ff8a8a' },
  cotton: { color: '#f4f3ee', roughness: 1, sheen: 1, sheenRoughness: 0.6, sheenColor: '#ffffff' },
  knit: { color: '#a83434', roughness: 1, sheen: 1, sheenRoughness: 0.5, sheenColor: '#ff9a9a' },
  plastic: { color: '#2a2a2c', roughness: 0.45, clearcoat: 0.3 },
  rubber: { color: '#1c1c1c', roughness: 0.85 },
  redRubber: { color: '#7a1a14', roughness: 0.55, clearcoat: 0.2 },
  duckRubber: { color: '#f2c21b', roughness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.3 },
  orange: { color: '#e9711c', roughness: 0.45 },
  ivory: { color: '#e6dcc4', roughness: 0.5, clearcoat: 0.3 },
  tongue: { color: '#cf5866', roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.35, sheen: 0.5, sheenColor: '#ffb4bd' },
  leaf: { color: '#2f6b2a', roughness: 0.6, sheen: 0.4, sheenColor: '#7fbf6a' },
  petal: { color: '#a3101f', roughness: 0.55, sheen: 1, sheenRoughness: 0.4, sheenColor: '#ff5a6a' },
  tobacco: { color: '#5a3a22', roughness: 0.85 },
  ash: { color: '#8e8a84', roughness: 1 },
  ceramicWhite: { color: '#f3f1ea', roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.12 },
  paper: { color: '#fbfbf5', roughness: 0.95, sheen: 0.4, sheenColor: '#ffffff' },
  cardboard: { color: '#b2865a', roughness: 0.9 },
  label: { color: '#3b7fc4', roughness: 0.35, clearcoat: 0.6 },
  cape: { color: '#8f0f1c', roughness: 0.75, sheen: 1, sheenRoughness: 0.4, sheenColor: '#ff6070', side: 'double' },
  gold: { color: '#e9b949', metalness: 1, roughness: 0.25 },
  chrome: { color: '#eef3f7', metalness: 1, roughness: 0.12 },
};

/** Material by name with realistic fallback; params.color -> cloned & recolored. */
function M(mats, name, color) {
  const m = mats.get(name, FB[name]);
  if (!color) return m;
  const c = m.clone();
  c.color = new THREE.Color(color);
  return c;
}

function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
const V = (a) => new THREE.Vector3(...a);
const lathe = (pts, seg = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const tube = (pts, r, seg = 48, radial = 10, closed = false) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(V), closed), seg, r, radial, closed);

function roundRect(w, h, r, Ctor = THREE.Shape) {
  const s = new Ctor(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
const extrude = (shape, depth, bevel = 0.003) => new THREE.ExtrudeGeometry(shape, {
  depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 24,
});

/** Root (user transform) + inner (our motion & params.scale). */
function rig(p) {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  if (p.scale != null) Array.isArray(p.scale) ? inner.scale.fromArray(p.scale) : inner.scale.setScalar(p.scale);
  return { root, inner };
}

/** Hat-style wobble driven by head motion. */
function wobble(target, amt = 1, k = 150, d = 7) {
  const z = new Spring(k, d), x = new Spring(k, d);
  const bz = target.rotation.z, bx = target.rotation.x;
  return (st) => {
    z.target = -st.headYawVel * 0.05 * amt;
    x.target = (st.headPitchVel * 0.04 - st.lift * 2) * amt;
    z.step(st.dt); x.step(st.dt);
    target.rotation.z = bz + z.x; target.rotation.x = bx + x.x;
  };
}

/** Rising smoke puffs (local space of `parent`, which should stay roughly upright). */
class Smoke {
  constructor(parent, n = 12, life = 2.4) {
    this.life = life; this.origin = new THREE.Vector3(); this.puffs = [];
    const geo = new THREE.SphereGeometry(0.018, 10, 8);
    for (let i = 0; i < n; i++) {
      const m = new THREE.MeshStandardMaterial({ color: '#d9d9d6', roughness: 1, transparent: true, opacity: 0, depthWrite: false });
      const p = new THREE.Mesh(geo, m);
      p.userData.t = (i / n) * life; p.userData.seed = Math.random() * 10;
      parent.add(p); this.puffs.push(p);
    }
  }
  update(dt, time, strength = 1) {
    for (const p of this.puffs) {
      p.userData.t += dt;
      if (p.userData.t > this.life) { p.userData.t -= this.life; p.userData.seed = Math.random() * 10; }
      const u = p.userData.t / this.life, sd = p.userData.seed;
      p.position.set(this.origin.x + Math.sin(time * 1.3 + sd) * 0.04 * u, this.origin.y + u * 0.4, this.origin.z + Math.cos(time + sd) * 0.03 * u);
      p.scale.setScalar(0.6 + u * 3.2);
      p.material.opacity = 0.3 * Math.sin(Math.PI * u) * strength;
    }
  }
}

/** Chain of pivots with springs (antennas, dangly things). */
function springChain(parent, n, segLen, build, k = 120, d = 5) {
  const piv = [];
  let prev = parent;
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    g.position.y = i === 0 ? 0 : segLen;
    prev.add(g); build(g, i);
    piv.push({ g, sx: new Spring(k - i * 15, d), sz: new Spring(k - i * 15, d) });
    prev = g;
  }
  return (st) => {
    for (let i = 0; i < piv.length; i++) {
      const c = piv[i];
      c.sz.target = -st.headYawVel * 0.05 * (1 + i * 0.4);
      c.sx.target = st.headPitchVel * 0.04 - st.lift * 3 + Math.sin(st.time * 6 + i) * 0.04 * st.talk;
      c.sz.step(st.dt); c.sx.step(st.dt);
      c.g.rotation.z = c.sz.x; c.g.rotation.x = c.sx.x;
    }
  };
}

/* ================================================================ HATS */
registerAccessory('top_hat', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const felt = M(mats, 'felt', p.color);
  const body = mesh(lathe([[0, 0], [0.27, 0], [0.285, 0.008], [0.28, 0.018], [0.2, 0.02], [0.168, 0.026],
    [0.16, 0.08], [0.165, 0.25], [0.175, 0.3], [0.17, 0.31], [0, 0.312]], 64), felt, inner);
  body.scale.z = 0.86;
  const band = mesh(new THREE.CylinderGeometry(0.163, 0.161, 0.045, 64, 1, true), M(mats, 'fabric', p.bandColor || '#2b0d10'), inner, 0, 0.05, 0);
  band.scale.z = 0.86;
  inner.rotation.z = p.tilt ?? 0.06;
  root.userData.update = wobble(inner);
  return root;
});

registerAccessory('cowboy_hat', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const leather = M(mats, 'leather', p.color || '#9c6a36');
  const brimGeo = lathe([[0.16, 0.0], [0.34, 0.0], [0.35, 0.008], [0.34, 0.014], [0.16, 0.014]], 72);
  const bp = brimGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), z = bp.getZ(i), r = Math.hypot(x, z);
    const rel = clamp((r - 0.16) / 0.18, 0, 1);
    const side = Math.abs(x) / (r || 1);
    bp.setY(i, bp.getY(i) + 0.09 * rel * rel * side * side - 0.02 * rel * (1 - side));
  }
  brimGeo.computeVertexNormals();
  mesh(brimGeo, leather, inner);
  const crownGeo = lathe([[0.165, 0], [0.17, 0.08], [0.16, 0.15], [0.12, 0.175], [0.05, 0.16], [0, 0.14]], 64);
  const cp = crownGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 0.09 && cp.getZ(i) > 0) cp.setX(i, cp.getX(i) * 0.82);
  crownGeo.computeVertexNormals();
  const crown = mesh(crownGeo, leather, inner); crown.scale.z = 0.9;
  const band = mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.03, 64, 1, true), M(mats, 'leather', '#2e1d10'), inner, 0, 0.03, 0);
  band.scale.z = 0.9;
  inner.rotation.z = p.tilt ?? -0.05;
  root.userData.update = wobble(inner);
  return root;
});

registerAccessory('beanie', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const knit = M(mats, 'knit', p.color);
  const cap = new THREE.SphereGeometry(0.2, 96, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const pp = cap.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), z = pp.getZ(i), a = Math.atan2(z, x);
    const k = 1 + 0.025 * Math.abs(Math.sin(a * 24));      // knit ribs
    pp.setX(i, x * k); pp.setZ(i, z * k);
  }
  cap.computeVertexNormals();
  const capM = mesh(cap, knit, inner, 0, 0.05, 0); capM.scale.set(1, 1.05, 0.9);
  const cuff = new THREE.CylinderGeometry(0.212, 0.212, 0.075, 96, 1, true);
  const cf = cuff.attributes.position;
  for (let i = 0; i < cf.count; i++) {
    const x = cf.getX(i), z = cf.getZ(i), a = Math.atan2(z, x), k = 1 + 0.03 * Math.abs(Math.sin(a * 36));
    cf.setX(i, x * k); cf.setZ(i, z * k);
  }
  cuff.computeVertexNormals();
  const cuffM = mesh(cuff, knit, inner, 0, 0.04, 0); cuffM.scale.z = 0.9; cuffM.material = knit;
  // fluffy pom-pom on a spring
  const pomPiv = new THREE.Group(); pomPiv.position.y = 0.26; inner.add(pomPiv);
  const pom = new THREE.IcosahedronGeometry(0.06, 4);
  const pm = pom.attributes.position;
  for (let i = 0; i < pm.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pm, i);
    v.multiplyScalar(1 + (Math.random() - 0.5) * 0.25);
    pm.setXYZ(i, v.x, v.y, v.z);
  }
  pom.computeVertexNormals();
  mesh(pom, M(mats, 'knit', p.pomColor || p.color), pomPiv);
  const bob = new Spring(160, 5), side = new Spring(160, 5);
  const wob = wobble(inner);
  root.userData.update = (st) => {
    wob(st);
    bob.target = -st.lift * 4; side.target = -st.headYawVel * 0.12;
    bob.step(st.dt); side.step(st.dt);
    pomPiv.rotation.set(bob.x, 0, side.x);
  };
  return root;
});

registerAccessory('party_hat', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const cone = mesh(new THREE.ConeGeometry(0.12, 0.3, 48, 1, true), M(mats, 'paper', p.color || '#2f7fd1'), inner, 0, 0.15, 0);
  cone.material = cone.material.clone(); cone.material.side = THREE.DoubleSide;
  const sp = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, a = t * Math.PI * 2 * 4, r = 0.121 * (1 - t) + 0.002;
    sp.push([Math.cos(a) * r, t * 0.3, Math.sin(a) * r]);
  }
  mesh(tube(sp, 0.006, 200, 6), M(mats, 'gold'), inner);
  const tinsel = new THREE.Group(); tinsel.position.y = 0.3; inner.add(tinsel);
  const tm = M(mats, 'gold', p.tinselColor || '#f2c94c');
  for (let i = 0; i < 40; i++) {
    const s = mesh(new THREE.CylinderGeometry(0.0015, 0.003, 0.06, 4), tm, tinsel);
    const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
    s.position.copy(d).multiplyScalar(0.03);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  }
  inner.rotation.z = p.tilt ?? 0.18;
  root.userData.update = wobble(inner, 1.4);
  return root;
});

registerAccessory('pirate_hat', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const felt = M(mats, 'felt', p.color || '#151517');
  const g = lathe([[0, 0.16], [0.12, 0.155], [0.17, 0.11], [0.18, 0.02], [0.2, 0.0], [0.33, 0.0], [0.335, 0.012], [0.2, 0.014], [0.18, 0.02]], 96);
  const pp = g.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), z = pp.getZ(i), r = Math.hypot(x, z);
    if (r < 0.185) continue;
    const a = Math.atan2(z, x) - Math.PI / 2;
    const tri = 0.5 + 0.5 * Math.cos(3 * a);              // 3 corners (front + back sides)
    const rel = clamp((r - 0.185) / 0.15, 0, 1);
    const k = 1 - 0.18 * (1 - tri) * rel;
    pp.setX(i, x * k); pp.setZ(i, z * k);
    pp.setY(i, pp.getY(i) + 0.13 * Math.pow(rel, 1.3) * (1 - 0.6 * tri));
  }
  g.computeVertexNormals();
  const hat = mesh(g, felt, inner); hat.material = felt.clone(); hat.material.side = THREE.DoubleSide;
  // skull & crossbones
  const bone = M(mats, 'ivory', '#efe9dc');
  const em = new THREE.Group(); em.position.set(0, 0.1, 0.205); inner.add(em);
  mesh(new THREE.SphereGeometry(0.028, 20, 14), bone, em).scale.set(1, 1, 0.5);
  for (const s of [1, -1]) {
    const b = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 8), bone, em, 0, -0.035, -0.005);
    b.rotation.z = 0.8 * s;
  }
  root.userData.update = wobble(inner);
  return root;
});

registerAccessory('chef_hat', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const cot = M(mats, 'cotton', p.color);
  const band = mesh(new THREE.CylinderGeometry(0.155, 0.15, 0.11, 64, 1, false), cot, inner, 0, 0.055, 0);
  band.scale.z = 0.9;
  const puff = new THREE.SphereGeometry(0.1, 28, 20);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const m = mesh(puff, cot, inner, Math.cos(a) * 0.1, 0.19 + Math.sin(a * 3) * 0.01, Math.sin(a) * 0.09);
    m.scale.set(1, 0.8, 1);
  }
  mesh(new THREE.SphereGeometry(0.12, 28, 20), cot, inner, 0, 0.23, 0).scale.set(1, 0.75, 0.95);
  root.userData.update = wobble(inner, 0.8);
  return root;
});

registerAccessory('viking_helmet', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const steel = M(mats, 'steel', p.color);
  const dome = mesh(new THREE.SphereGeometry(0.2, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), steel, inner, 0, 0.0, 0);
  dome.scale.z = 0.9;
  const band = mesh(new THREE.TorusGeometry(0.2, 0.015, 12, 64), M(mats, 'leather', '#3c2a1a'), inner, 0, 0.012, 0);
  band.rotation.x = Math.PI / 2; band.scale.y = 0.9;
  const ridge = mesh(new THREE.TorusGeometry(0.2, 0.01, 10, 64, Math.PI), steel, inner);
  ridge.rotation.y = Math.PI / 2; ridge.scale.z = 1;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    mesh(new THREE.SphereGeometry(0.008, 10, 8), steel, inner, Math.cos(a) * 0.212, 0.013, Math.sin(a) * 0.19);
  }
  const horn = M(mats, 'ivory');
  for (const s of [1, -1]) {
    mesh(taperedTube([[0.16 * s, 0.07, 0], [0.24 * s, 0.1, 0.01], [0.31 * s, 0.18, 0.03], [0.33 * s, 0.3, 0.06]],
      (t) => 0.004 + 0.042 * Math.pow(1 - t, 0.9), 48, 14), horn, inner);
  }
  mesh(new RoundedBoxGeometry(0.035, 0.12, 0.015, 2, 0.006), steel, inner, 0, -0.03, 0.2);
  root.userData.update = wobble(inner, 0.6);
  return root;
});

registerAccessory('wizard_hat', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const fab = M(mats, 'fabric', p.color || '#22306b');
  const H = 0.55;
  const cone = new THREE.ConeGeometry(0.2, H, 64, 24, true);
  cone.translate(0, H / 2, 0);
  const bend = (y) => 0.16 * Math.pow(y / H, 3);
  const cp = cone.attributes.position;
  for (let i = 0; i < cp.count; i++) cp.setX(i, cp.getX(i) + bend(cp.getY(i)));
  cone.computeVertexNormals();
  const cm = mesh(cone, fab, inner); cm.material = fab.clone(); cm.material.side = THREE.DoubleSide;
  mesh(lathe([[0.19, 0.0], [0.36, -0.01], [0.365, 0.0], [0.19, 0.012]], 72), fab, inner);
  const gold = M(mats, 'gold');
  for (let i = 0; i < 6; i++) {
    const y = 0.08 + i * 0.07, r = 0.2 * (1 - y / H) + 0.004, a = 0.6 + i * 1.7;
    const st = mesh(extrude(starShape(0.022, 0.009), 0.003, 0.001), gold, inner,
      Math.sin(a) * r + bend(y), y, Math.cos(a) * r);
    st.lookAt(st.position.x * 3, y, st.position.z * 3);
  }
  const tipSpring = new Spring(80, 4);
  const wob = wobble(inner, 1.2);
  root.userData.update = (st) => { wob(st); tipSpring.target = -st.headYawVel * 0.04; tipSpring.step(st.dt); cm.rotation.z = tipSpring.x * 0.5; };
  return root;
});

registerAccessory('beret', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const felt = M(mats, 'felt', p.color || '#7d1420');
  const b = mesh(new THREE.SphereGeometry(0.22, 48, 24), felt, inner, 0.03, 0.035, 0);
  b.scale.set(1, 0.24, 0.92);
  mesh(new THREE.TorusGeometry(0.17, 0.012, 10, 64), felt, inner, 0, 0.012, 0).rotation.x = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.03, 8), felt, inner, 0.03, 0.095, 0);
  inner.rotation.z = p.tilt ?? -0.2;
  root.userData.update = wobble(inner);
  return root;
});

registerAccessory('baseball_cap', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const fab = M(mats, 'fabric', p.color || '#1f3f8f');
  const crown = mesh(new THREE.SphereGeometry(0.18, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), fab, inner);
  crown.scale.set(1, 0.78, 0.95);
  for (let i = 0; i < 3; i++) {             // panel seams
    const s = mesh(new THREE.TorusGeometry(0.18, 0.002, 6, 48, Math.PI), M(mats, 'fabric', p.seamColor || '#15295c'), inner);
    s.rotation.y = (i / 3) * Math.PI; s.scale.set(1, 0.78, 0.95);
  }
  mesh(new THREE.SphereGeometry(0.014, 12, 10), fab, inner, 0, 0.14, 0);
  const visShape = new THREE.Shape();
  visShape.absellipse(0, 0, 0.17, 0.14, 0, Math.PI, false, 0);
  const vis = extrude(visShape, 0.008, 0.003);
  vis.rotateX(Math.PI / 2);                 // shape y -> +z (front), thickness -> -y
  const vp = vis.attributes.position;
  for (let i = 0; i < vp.count; i++) { const x = vp.getX(i); vp.setY(i, vp.getY(i) - 1.6 * x * x * 0.5); }
  vis.computeVertexNormals();
  const visor = mesh(vis, fab, inner, 0, 0.02, 0.12);
  visor.rotation.x = 0.12;
  if (p.backwards) inner.rotation.y = Math.PI;
  root.userData.update = wobble(inner, 0.8);
  return root;
});

registerAccessory('halo', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const m = M(mats, 'halo', p.color).clone();
  if (!mats.specs?.halo) { m.color.set(p.color || '#ffe9a6'); m.emissive = new THREE.Color(p.color || '#ffd56a'); m.emissiveIntensity = 1.4; m.metalness = 0.6; m.roughness = 0.3; }
  const ring = mesh(new THREE.TorusGeometry(0.17, 0.014, 16, 72), m, inner, 0, 0.25, 0);
  ring.rotation.x = Math.PI / 2 - 0.12; ring.castShadow = false;
  root.userData.update = (st) => { ring.position.y = 0.25 + Math.sin(st.time * 2) * 0.015; ring.rotation.z = st.time * 0.4; };
  return root;
});

registerAccessory('headphones', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const plastic = M(mats, 'plastic', p.color);
  const cush = M(mats, 'leather', '#161616');
  const band = mesh(new THREE.TorusGeometry(0.52, 0.018, 12, 96, Math.PI), plastic, inner, 0, -0.3, 0);
  band.scale.set(1, 0.6, 1.6);
  const pad = mesh(new THREE.TorusGeometry(0.52, 0.012, 10, 64, Math.PI * 0.5), cush, inner, 0, -0.3 + 0.02, 0);
  pad.rotation.z = Math.PI * 0.25; pad.scale.set(1, 0.6, 1.6);
  for (const s of [1, -1]) {
    const cup = new THREE.Group(); cup.position.set(0.52 * s, -0.3, 0); inner.add(cup);
    const shell = mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.06, 40), plastic, cup, 0.03 * s, 0, 0);
    shell.rotation.z = Math.PI / 2;
    const ring = mesh(new THREE.TorusGeometry(0.09, 0.025, 14, 40), cush, cup, -0.005 * s, 0, 0);
    ring.rotation.y = Math.PI / 2;
    const cap = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 32), M(mats, 'chrome'), cup, 0.062 * s, 0, 0);
    cap.rotation.z = Math.PI / 2;
  }
  return root;
});

/* ================================================================ EYES */
function temples(inner, mat, x0, r = 0.006) {
  for (const s of [1, -1])
    mesh(tube([[x0 * s, 0.03, 0.0], [0.46 * s, 0.035, -0.02], [0.49 * s, 0.035, -0.1], [0.49 * s, 0.02, -0.3]], r, 32, 8), mat, inner);
}

registerAccessory('sunglasses', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const frame = M(mats, 'plastic', p.color || '#111113');
  const lens = M(mats, 'darkGlass', p.lensColor);
  for (const s of [1, -1]) {
    const f = roundRect(0.35, 0.25, 0.08);
    f.holes.push(roundRect(0.31, 0.21, 0.065, THREE.Path));
    const fm = mesh(extrude(f, 0.018, 0.004), frame, inner, 0.18 * s, 0, 0.04);
    fm.rotation.z = -0.04 * s;
    const l = mesh(extrude(roundRect(0.315, 0.215, 0.066), 0.004, 0.001), lens, inner, 0.18 * s, 0, 0.048);
    l.rotation.z = -0.04 * s;
  }
  mesh(new RoundedBoxGeometry(0.07, 0.03, 0.02, 2, 0.008), frame, inner, 0, 0.07, 0.05);
  temples(inner, frame, 0.35);
  return root;
});

registerAccessory('aviators', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const metal = M(mats, 'gold', p.color);
  const lens = M(mats, 'darkGlass', p.lensColor || '#3b2a14');
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      let x = 0.15 * Math.cos(a), y = 0.12 * Math.sin(a);
      if (y < 0) y *= 1 + 0.35 * (0.5 + 0.5 * Math.cos(a) * s);   // teardrop toward the outside
      pts.push([x, y]);
    }
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const lm = mesh(new THREE.ShapeGeometry(sh, 24), lens, inner, 0.175 * s, 0.01, 0.05);
    lm.material = lens.clone(); lm.material.side = THREE.DoubleSide;
    mesh(tube(pts.map(([x, y]) => [x + 0.175 * s, y + 0.01, 0.05]), 0.005, 96, 8, true), metal, inner);
  }
  mesh(tube([[-0.03, 0.09, 0.052], [0, 0.1, 0.055], [0.03, 0.09, 0.052]], 0.004, 16, 6), metal, inner);
  mesh(tube([[-0.035, 0.05, 0.052], [0, 0.04, 0.056], [0.035, 0.05, 0.052]], 0.004, 16, 6), metal, inner);
  temples(inner, metal, 0.32, 0.004);
  return root;
});

registerAccessory('monocle', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const gold = M(mats, 'gold', p.color);
  const x = p.side === 'left' ? -0.172 : 0.172;
  const rim = mesh(new THREE.TorusGeometry(0.155, 0.008, 12, 72), gold, inner, x, 0, 0.05);
  mesh(new THREE.CircleGeometry(0.152, 48), M(mats, 'glass'), inner, x, 0, 0.05);
  const chainPiv = new THREE.Group(); chainPiv.position.set(x + 0.11, -0.11, 0.05); inner.add(chainPiv);
  const links = [];
  for (let i = 0; i < 22; i++) links.push([0.012 * Math.sin(i * 0.3), -i * 0.016, -0.004 * i]);
  mesh(tube(links, 0.003, 64, 6), gold, chainPiv);
  rim.castShadow = true;
  const sw = new Spring(60, 3);
  root.userData.update = (st) => { sw.target = -st.headYawVel * 0.15; sw.step(st.dt); chainPiv.rotation.z = sw.x; };
  return root;
});

registerAccessory('nerd_glasses', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const frame = M(mats, 'plastic', p.color || '#0e0e10');
  for (const s of [1, -1]) {
    const f = roundRect(0.33, 0.27, 0.07);
    f.holes.push(roundRect(0.27, 0.21, 0.05, THREE.Path));
    mesh(extrude(f, 0.03, 0.005), frame, inner, 0.18 * s, 0, 0.035);
    mesh(new THREE.PlaneGeometry(0.27, 0.21), M(mats, 'glass'), inner, 0.18 * s, 0, 0.05);
  }
  mesh(new RoundedBoxGeometry(0.06, 0.035, 0.03, 2, 0.01), frame, inner, 0, 0.03, 0.05);
  mesh(new RoundedBoxGeometry(0.035, 0.06, 0.04, 2, 0.008), M(mats, 'cotton', '#f2f0e6'), inner, 0, 0.03, 0.05);
  temples(inner, frame, 0.34, 0.008);
  return root;
});

registerAccessory('eyepatch', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const lea = M(mats, 'leather', p.color || '#121212');
  const x = p.side === 'right' ? 0.172 : -0.172;
  const sh = new THREE.Shape(); sh.absellipse(0, 0, 0.16, 0.14, 0, Math.PI * 2, false, 0);
  const patch = mesh(extrude(sh, 0.01, 0.006), lea, inner, x, 0, 0.045);
  patch.scale.z = 1.4;
  const sx = Math.sign(x);
  mesh(tube([[x - 0.12 * sx, 0.09, 0.05], [-0.45 * sx, 0.2, 0.0], [-0.485 * sx, 0.22, -0.15]], 0.008, 32, 6), lea, inner);
  mesh(tube([[x + 0.12 * sx, 0.09, 0.05], [0.25 * sx, 0.18, 0.04], [0.46 * sx, 0.24, 0.0], [0.485 * sx, 0.25, -0.15]], 0.008, 32, 6), lea, inner);
  return root;
});

/* ================================================================ FACE */
// Mouth props. Sockets (both children of seat_bone_6, so they ride the LOWER lip):
//   mouth        centre of the lip gap at the seat's top front edge, +z out, +y up
//   mouth_corner the right (+x) corner of the lips, turned ~25 deg outward
// The upper lip (lid) rests ~0.05 rad open, i.e. a ~4.5 cm gap at the front, so anything
// held between the lips stays under ~3.5 cm thick where it crosses the gap.

/** z (relative to the front point, <= 0) of the seat's outer edge at lateral offset x. */
function lipEdgeZ(dim, x) {
  const S = dim?.seat || { rx: 0.405, rz: 0.495 }, k = dim?.egg ?? 0.08;
  const ax = Math.min(Math.abs(x), S.rx * 0.999);
  let lo = 0, hi = Math.PI / 2;
  for (let i = 0; i < 32; i++) { const m = (lo + hi) / 2; if (S.rx * Math.cos(m) * (1 - k * Math.sin(m)) > ax) lo = m; else hi = m; }
  return S.rz * Math.sin((lo + hi) / 2) - S.rz;
}

registerAccessory('cigar', ({ mats }, p) => {
  const { root, inner } = rig(p);
  // butt ~4 cm inside the mouth, resting on the lower lip; angled down and out, ember outward
  const cig = new THREE.Group(); cig.position.set(0, 0.022, -0.045); cig.rotation.set(0.22, 0.1, 0); inner.add(cig);
  const L = 0.21, R = 0.0155;
  const body = mesh(new THREE.CylinderGeometry(R, R * 0.92, L, 24), M(mats, 'tobacco', p.color), cig, 0, 0, L / 2);
  body.rotation.x = Math.PI / 2;
  const cap = mesh(new THREE.SphereGeometry(R * 0.92, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(mats, 'tobacco', p.color), cig, 0, 0, 0);
  cap.rotation.x = -Math.PI / 2;                                // rounded head inside the mouth
  const band = mesh(new THREE.CylinderGeometry(R + 0.0008, R + 0.0008, 0.018, 24), M(mats, 'fabric', '#8f1622'), cig, 0, 0, 0.07);
  band.rotation.x = Math.PI / 2;                                // just outside the lips
  const ash = mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.92, 0.022, 20), M(mats, 'ash'), cig, 0, 0, L + 0.011);
  ash.rotation.x = Math.PI / 2;
  const emberMat = new THREE.MeshStandardMaterial({ color: '#ff6a2a', emissive: new THREE.Color('#ff3a00'), emissiveIntensity: 2, roughness: 1 });
  const ember = mesh(new THREE.CircleGeometry(R * 0.85, 20), emberMat, cig, 0, 0, L + 0.0225);
  ember.castShadow = false;
  const smoke = new Smoke(inner, 14);
  const tip = new THREE.Vector3();
  const bob = new Spring(120, 8);
  root.userData.update = (st) => {
    // lips grip it: it dips a little as the mouth opens and wobbles while talking
    bob.target = st.talk * 0.12 + Math.sin(st.time * 9) * 0.04 * st.talk; bob.step(st.dt);
    cig.rotation.x = 0.22 + bob.x;
    cig.updateMatrix();
    tip.set(0, 0, L + 0.03).applyMatrix4(cig.matrix);
    smoke.origin.copy(tip);
    emberMat.emissiveIntensity = 1.6 + Math.sin(st.time * 7) * 0.4 + Math.sin(st.time * 17) * 0.2;
    smoke.update(st.dt, st.time);
  };
  return root;
});

registerAccessory('pipe', ({ mats }, p) => {
  const { root, inner } = rig(p);
  // bit held in the corner of the lips, stem out and down, bowl hanging below with the opening up
  const pipe = new THREE.Group(); pipe.position.set(0, 0.017, -0.035); pipe.rotation.set(0.08, 0.05, 0); inner.add(pipe);
  const wood = M(mats, 'wood', p.color || '#5b3218');
  const bit = M(mats, 'plastic', '#121212');
  mesh(tube([[0, 0, 0], [0, -0.002, 0.04], [0, -0.006, 0.07]], 0.0075, 24, 10), bit, pipe);
  mesh(tube([[0, -0.006, 0.07], [0, -0.012, 0.1], [0, -0.025, 0.125], [0, -0.035, 0.135]], 0.0095, 24, 10), wood, pipe);
  const bowl = mesh(lathe([[0.0, 0.0], [0.03, 0.0], [0.036, 0.03], [0.035, 0.075], [0.026, 0.078], [0.024, 0.01], [0, 0.01]], 32), wood, pipe, 0, -0.08, 0.16);
  const ember = mesh(new THREE.CircleGeometry(0.023, 16), new THREE.MeshStandardMaterial({ color: '#ff6a2a', emissive: new THREE.Color('#ff3300'), emissiveIntensity: 1.2 }), bowl, 0, 0.065, 0);
  ember.rotation.x = -Math.PI / 2; ember.castShadow = false;
  const smoke = new Smoke(inner, 10);
  root.userData.update = (st) => {
    pipe.rotation.x = 0.08 + Math.sin(st.time * 8) * 0.04 * st.talk;
    pipe.updateMatrix();
    smoke.origin.set(0, -0.005, 0.16).applyMatrix4(pipe.matrix);
    smoke.update(st.dt, st.time, 0.8);
  };
  return root;
});

registerAccessory('rose_in_mouth', ({ mats, dim }, p) => {
  const { root, inner } = rig(p);
  const leaf = M(mats, 'leaf');
  // stem clenched across the lip gap, just inside the front edge, following its curve;
  // the flower sticks out past the character's right corner
  const y = 0.02, zIn = (x) => lipEdgeZ(dim, x) - 0.008;
  const stem = [];
  for (let i = 0; i <= 12; i++) { const x = -0.15 + i * 0.035; stem.push([x, y + Math.sin(i * 0.6) * 0.003, zIn(x)]); }
  stem.push([0.31, y + 0.004, zIn(0.29) + 0.03]);
  mesh(tube(stem, 0.0055, 64, 8), leaf, inner);
  for (const [x, s] of [[-0.12, 1], [0.2, -1]]) {
    const l = mesh(new THREE.SphereGeometry(0.03, 16, 10), leaf, inner, x, y + 0.014 * s, zIn(x) + 0.02);
    l.scale.set(1.4, 0.15, 0.6); l.rotation.set(0.2 * s, -0.4, 0.5 * s);
  }
  const flower = new THREE.Group(); flower.position.set(0.335, y + 0.006, zIn(0.29) + 0.045); flower.rotation.set(0.2, -0.6, -1.2); inner.add(flower);
  const petal = M(mats, 'petal', p.color);
  const pg = new THREE.SphereGeometry(0.04, 20, 12, 0, Math.PI, 0, Math.PI * 0.6);
  for (let i = 0; i < 11; i++) {
    const ring = Math.floor(i / 4), a = i * 2.4;
    const pm = mesh(pg, petal, flower);
    pm.material = petal.clone(); pm.material.side = THREE.DoubleSide;
    pm.scale.setScalar(0.5 + ring * 0.3);
    pm.rotation.set(-0.3 - ring * 0.35, a, 0);
  }
  const sw = new Spring(90, 5);
  root.userData.update = (st) => {
    sw.target = -st.headYawVel * 0.05 + Math.sin(st.time * 7) * 0.03 * st.talk; sw.step(st.dt);
    flower.rotation.z = -1.2 + sw.x;
  };
  return root;
});

registerAccessory('tongue', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const mat = M(mats, 'tongue', p.color);
  // root inside the mouth on the lower lip; it slides out over the lip edge and hangs down the front
  inner.position.set(0, 0.017, -0.07);
  const BASE = [0.1, 0.55, 0.65, 0.4];                // per-segment bend (rad): flat -> over the edge -> hanging
  const segs = [];
  let parent = inner;
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group(); g.position.z = i === 0 ? 0 : 0.055; parent.add(g);
    const m = mesh(new THREE.SphereGeometry(0.06, 24, 16), mat, g, 0, 0, 0.03);
    m.scale.set(1.2 - i * 0.12, 0.27, 0.75);          // ~3.2 cm thick: fits the lip gap
    if (i < 3) { const groove = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), M(mats, 'tongue', '#a8404d'), g, 0, 0.0155, 0.03); groove.rotation.x = Math.PI / 2; }
    segs.push({ g, s: new Spring(140 - i * 20, 6), y: new Spring(90 - i * 10, 5) });
    parent = g;
  }
  root.userData.update = (st) => {
    for (let i = 0; i < segs.length; i++) {
      const c = segs[i];
      c.s.target = BASE[i] + Math.sin(st.time * 10 - i) * 0.12 * st.talk * (i ? 1 : 0.3) - st.lift * 2 * (i ? 1 : 0);
      c.y.target = Math.sin(st.time * 6 - i * 0.8) * (0.04 + 0.1 * st.talk) - st.headYawVel * 0.03 * i;
      c.s.step(st.dt); c.y.step(st.dt);
      c.g.rotation.x = c.s.x;
      c.g.rotation.y = c.y.x;
    }
  };
  return root;
});

registerAccessory('bow_tie_real', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const fab = M(mats, 'fabric', p.color || '#7e0f1c');
  inner.position.z = -0.05;
  for (const s of [1, -1]) {
    const sh = new THREE.Shape();
    sh.moveTo(0, -0.018); sh.bezierCurveTo(0.04, -0.03, 0.09, -0.06, 0.11, -0.045);
    sh.bezierCurveTo(0.125, -0.01, 0.125, 0.01, 0.11, 0.045);
    sh.bezierCurveTo(0.09, 0.06, 0.04, 0.03, 0, 0.018); sh.lineTo(0, -0.018);
    const w = mesh(extrude(sh, 0.02, 0.008), fab, inner);
    w.scale.x = s;
    if (s < 0) w.material = fab.clone(), w.material.side = THREE.DoubleSide;
  }
  mesh(new RoundedBoxGeometry(0.035, 0.045, 0.035, 2, 0.012), fab, inner, 0, 0, 0.012);
  return root;
});

registerAccessory('necktie', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const fab = M(mats, 'fabric', p.color || '#1d2f63');
  inner.position.set(0, 0.11, -0.04);
  mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.05, 4), fab, inner).rotation.y = Math.PI / 4;
  const piv = new THREE.Group(); piv.position.y = -0.02; inner.add(piv);
  const sh = new THREE.Shape();
  sh.moveTo(-0.022, 0); sh.lineTo(0.022, 0); sh.lineTo(0.05, -0.27); sh.lineTo(0, -0.31); sh.lineTo(-0.05, -0.27); sh.lineTo(-0.022, 0);
  mesh(extrude(sh, 0.008, 0.003), fab, piv);
  const sx = new Spring(70, 4), sz = new Spring(70, 4);
  root.userData.update = (st) => {
    sx.target = -st.lift * 4 + 0.08; sz.target = -st.headYawVel * 0.08;
    sx.step(st.dt); sz.step(st.dt);
    piv.rotation.set(sx.x, 0, sz.x);
  };
  return root;
});

registerAccessory('gold_chain', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const gold = M(mats, 'gold', p.color);
  inner.position.z = -0.06;
  const curve = new THREE.CatmullRomCurve3([V([-0.24, 0.17, -0.1]), V([-0.14, 0.04, 0.0]), V([0, -0.02, 0.02]), V([0.14, 0.04, 0.0]), V([0.24, 0.17, -0.1])]);
  const linkGeo = new THREE.TorusGeometry(0.012, 0.0045, 8, 16);
  const N = 46;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1), pt = curve.getPointAt(t), tg = curve.getTangentAt(t);
    const l = mesh(linkGeo, gold, inner, pt.x, pt.y, pt.z);
    l.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tg);
    if (i % 2) l.rotateX(Math.PI / 2);
    l.scale.set(1.3, 1, 1);
  }
  const medPiv = new THREE.Group(); medPiv.position.set(0, -0.025, 0.025); inner.add(medPiv);
  const med = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.008, 40), gold, medPiv, 0, -0.06, 0);
  med.rotation.x = Math.PI / 2;
  mesh(extrude(starShape(0.03, 0.013), 0.004, 0.001), gold, medPiv, 0, -0.06, 0.005);
  const sw = new Spring(60, 3), sx = new Spring(60, 3);
  root.userData.update = (st) => {
    sw.target = -st.headYawVel * 0.12; sx.target = -st.lift * 3; sw.step(st.dt); sx.step(st.dt);
    medPiv.rotation.set(sx.x, 0, sw.x);
  };
  return root;
});

/* =============================================================== PROPS */
function duck(mats, p) {
  const g = new THREE.Group();
  const rub = M(mats, 'duckRubber', p.color);
  mesh(new THREE.SphereGeometry(0.09, 32, 20), rub, g, 0, 0.07, 0).scale.set(1, 0.8, 1.25);
  mesh(new THREE.SphereGeometry(0.058, 28, 18), rub, g, 0, 0.16, 0.055);
  const tail = mesh(new THREE.ConeGeometry(0.035, 0.07, 16), rub, g, 0, 0.1, -0.11); tail.rotation.x = -2.2;
  const beak = mesh(new THREE.SphereGeometry(0.03, 20, 12), M(mats, 'orange'), g, 0, 0.15, 0.115); beak.scale.set(1.2, 0.45, 1.1);
  for (const s of [1, -1]) {
    mesh(new THREE.SphereGeometry(0.009, 12, 8), M(mats, 'plastic', '#0b0b0b'), g, 0.028 * s, 0.18, 0.1);
    const wing = mesh(new THREE.SphereGeometry(0.05, 20, 12), rub, g, 0.08 * s, 0.08, -0.01); wing.scale.set(0.3, 0.6, 1);
  }
  return g;
}
registerAccessory('rubber_duck', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const d = duck(mats, p); inner.add(d);
  inner.position.x = p.x ?? 0.3;
  const bob = new Spring(100, 4), rz = new Spring(100, 4);
  root.userData.update = (st) => {
    bob.target = -st.lift * 3; rz.target = -st.headYawVel * 0.08; bob.step(st.dt); rz.step(st.dt);
    d.rotation.set(bob.x, Math.sin(st.time * 0.7) * 0.15, rz.x);
  };
  return root;
});

registerAccessory('plunger', ({ mats }, p) => {
  const { root, inner } = rig(p);
  mesh(lathe([[0, 0.12], [0.03, 0.12], [0.09, 0.095], [0.115, 0.04], [0.12, 0.004], [0.112, 0], [0.105, 0.035], [0.08, 0.085], [0.02, 0.11], [0, 0.11]], 48), M(mats, 'redRubber', p.color), inner);
  mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.6, 16), M(mats, 'wood', p.handleColor || '#b98a52'), inner, 0, 0.42, 0);
  mesh(new THREE.SphereGeometry(0.02, 16, 10), M(mats, 'wood', p.handleColor || '#b98a52'), inner, 0, 0.72, 0);
  inner.rotation.z = p.lean ?? 0.12;
  return root;
});

registerAccessory('toilet_brush_holder', ({ mats }, p) => {
  const { root, inner } = rig(p);
  mesh(lathe([[0, 0], [0.07, 0], [0.075, 0.01], [0.072, 0.15], [0.068, 0.16], [0.06, 0.16], [0.06, 0.02], [0, 0.02]], 48), M(mats, 'ceramicWhite', p.color), inner);
  mesh(new THREE.TorusGeometry(0.066, 0.006, 10, 48), M(mats, 'chrome'), inner, 0, 0.16, 0).rotation.x = Math.PI / 2;
  const h = new THREE.Group(); h.rotation.z = 0.12; inner.add(h);
  mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.34, 12), M(mats, 'chrome'), h, 0, 0.28, 0);
  mesh(new THREE.SphereGeometry(0.02, 16, 10), M(mats, 'chrome'), h, 0, 0.46, 0);
  return root;
});

registerAccessory('air_freshener', ({ mats }, p) => {
  const { root, inner } = rig(p);
  inner.position.x = p.x ?? 0.33;
  mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.17, 32), M(mats, 'label', p.color), inner, 0, 0.085, 0);
  mesh(lathe([[0, 0.17], [0.035, 0.17], [0.033, 0.19], [0.02, 0.205], [0, 0.208]], 32), M(mats, 'chrome'), inner);
  mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.045, 32), M(mats, 'plastic', p.capColor || '#f0f0ee'), inner, 0, 0.23, 0);
  mesh(new THREE.TorusGeometry(0.035, 0.002, 6, 32), M(mats, 'chrome'), inner, 0, 0.004, 0).rotation.x = Math.PI / 2;
  return root;
});

registerAccessory('toilet_paper_stack', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const paper = M(mats, 'paper', p.color);
  const core = M(mats, 'cardboard');
  const R = 0.06, H = 0.105;
  const roll = (x, y, z) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.random() * 3; inner.add(g);
    mesh(new THREE.CylinderGeometry(R, R, H, 32, 1, true), paper, g, 0, H / 2, 0);
    for (const yy of [0, H]) mesh(new THREE.RingGeometry(0.02, R, 32), paper, g, 0, yy, 0).rotation.x = yy ? -Math.PI / 2 : Math.PI / 2;
    const c = mesh(new THREE.CylinderGeometry(0.02, 0.02, H, 16, 1, true), core, g, 0, H / 2, 0);
    c.material = core.clone(); c.material.side = THREE.DoubleSide;
  };
  [[-0.125, 0], [0, 0], [0.125, 0]].forEach(([x, z]) => roll(x, 0, z));
  [[-0.0625, 0], [0.0625, 0]].forEach(([x, z]) => roll(x, H, z));
  roll(0, 2 * H, 0);
  return root;
});

registerAccessory('cape', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const W = 0.9, H = p.length ?? 1.15;
  const geo = new THREE.PlaneGeometry(W, H, 12, 24);
  geo.translate(0, -H / 2 + 0.2, 0);
  const base = geo.attributes.position.array.slice();
  const cape = mesh(geo, M(mats, 'cape', p.color), inner, 0, 0, 0.02);
  cape.material = cape.material.clone(); cape.material.side = THREE.DoubleSide;
  mesh(new THREE.CylinderGeometry(0.012, 0.012, W * 0.9, 10), M(mats, 'gold'), inner, 0, 0.2, 0.02).rotation.z = Math.PI / 2;
  const sx = new Spring(40, 4), sl = new Spring(40, 4);
  root.userData.update = (st) => {
    sx.target = -st.headYawVel * 0.3; sl.target = -st.lift * 6; sx.step(st.dt); sl.step(st.dt);
    const a = geo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      const x0 = base[i], y0 = base[i + 1];
      const d = clamp((0.2 - y0) / H, 0, 1);           // 0 at the collar, 1 at the hem
      a[i] = x0 * (1 + 0.35 * d) + sx.x * d * d * 0.4;
      a[i + 1] = y0;
      a[i + 2] = 0.06 * d + 0.2 * d * d + Math.sin(st.time * 2.4 + x0 * 6 + d * 4) * 0.025 * d + sl.x * d * 0.2 + Math.abs(x0) * 0.08 * d;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  };
  return root;
});

registerAccessory('devil_horns', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const m = M(mats, 'devilRed', p.color).clone();
  if (!mats.specs?.devilRed && !p.color) { m.color.set('#8a0d0d'); m.roughness = 0.35; m.clearcoat = 0.8; }
  for (const s of [1, -1])
    mesh(taperedTube([[0.22 * s, -0.01, 0.05], [0.24 * s, 0.06, 0.05], [0.27 * s, 0.12, 0.04], [0.31 * s, 0.16, 0.02]],
      (t) => 0.002 + 0.04 * Math.pow(1 - t, 1.1), 40, 14), m, inner);
  root.userData.update = wobble(inner, 0.3);
  return root;
});

registerAccessory('antenna_bobble', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const stalk = M(mats, 'plastic', p.stalkColor || '#1a1a1a');
  let ball = mats.get('bobble', { color: '#e23d6f', roughness: 0.25, clearcoat: 1, sheen: 0.4 });
  if (p.color) { ball = ball.clone(); ball.color = new THREE.Color(p.color); }
  const ups = [];
  for (const s of [1, -1]) {
    const base = new THREE.Group(); base.position.set(0.15 * s, 0, 0); base.rotation.z = -0.2 * s; inner.add(base);
    ups.push(springChain(base, 4, 0.06, (g, i) => {
      mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.06, 8), stalk, g, 0, 0.03, 0);
      if (i === 3) {
        mesh(new THREE.SphereGeometry(0.035, 20, 14), ball, g, 0, 0.085, 0);
      }
    }));
  }
  root.userData.update = (st) => ups.forEach((u) => u(st));
  return root;
});

/* ===================================================== metadata for UI */
export const ACCESSORY_INFO = {
  // index.js (core set)
  crown: { name: 'Coroa', socket: 'head_top', category: 'Chapéus' },
  ushanka: { name: 'Ushanka', socket: 'head_top', category: 'Chapéus' },
  mustache_handlebar: { name: 'Bigode guidão', socket: 'lip_upper', category: 'Rosto' },
  mustache_walrus: { name: 'Bigode morsa', socket: 'lip_upper', category: 'Rosto' },
  star_badge: { name: 'Estrela (broche)', socket: 'tank_front', category: 'Corpo' },
  bow_tie: { name: 'Gravata-borboleta simples', socket: 'body_front', category: 'Corpo' },
  // hats
  top_hat: { name: 'Cartola', socket: 'head_top', category: 'Chapéus' },
  cowboy_hat: { name: 'Chapéu de cowboy', socket: 'head_top', category: 'Chapéus' },
  beanie: { name: 'Gorro de lã', socket: 'head_top', category: 'Chapéus' },
  party_hat: { name: 'Chapéu de festa', socket: 'head_top', category: 'Chapéus' },
  pirate_hat: { name: 'Chapéu de pirata', socket: 'head_top', category: 'Chapéus' },
  chef_hat: { name: 'Chapéu de chef', socket: 'head_top', category: 'Chapéus' },
  viking_helmet: { name: 'Elmo viking', socket: 'head_top', category: 'Chapéus' },
  wizard_hat: { name: 'Chapéu de mago', socket: 'head_top', category: 'Chapéus' },
  beret: { name: 'Boina', socket: 'head_top', category: 'Chapéus' },
  baseball_cap: { name: 'Boné', socket: 'head_top', category: 'Chapéus' },
  halo: { name: 'Auréola', socket: 'head_top', category: 'Chapéus' },
  headphones: { name: 'Fone de ouvido', socket: 'head_top', category: 'Chapéus' },
  devil_horns: { name: 'Chifres de diabo', socket: 'head_top', category: 'Chapéus' },
  antenna_bobble: { name: 'Anteninhas', socket: 'head_top', category: 'Chapéus' },
  // eyes
  sunglasses: { name: 'Óculos escuros', socket: 'eyes', category: 'Olhos' },
  aviators: { name: 'Óculos aviador', socket: 'eyes', category: 'Olhos' },
  monocle: { name: 'Monóculo', socket: 'eyes', category: 'Olhos' },
  nerd_glasses: { name: 'Óculos nerd', socket: 'eyes', category: 'Olhos' },
  eyepatch: { name: 'Tapa-olho', socket: 'eyes', category: 'Olhos' },
  // face
  cigar: { name: 'Charuto', socket: 'mouth_corner', category: 'Rosto' },
  pipe: { name: 'Cachimbo', socket: 'mouth_corner', category: 'Rosto' },
  rose_in_mouth: { name: 'Rosa na boca', socket: 'mouth', category: 'Rosto' },
  tongue: { name: 'Língua', socket: 'mouth', category: 'Rosto' },
  // body
  bow_tie_real: { name: 'Gravata-borboleta', socket: 'body_front', category: 'Corpo' },
  necktie: { name: 'Gravata', socket: 'body_front', category: 'Corpo' },
  gold_chain: { name: 'Corrente de ouro', socket: 'body_front', category: 'Corpo' },
  cape: { name: 'Capa', socket: 'back', category: 'Corpo' },
  // props. physics = rigid body when hit by water / paper / each other (Rust/wasm rig only, see ToiletTuber.registerProps):
  //   shape 'box' | 'cylinder', size [x,y,z] | {r,h} (m, accessory-local, measured with Box3 from the built geometry),
  //   center = collider centre, comY = centre of mass height as a fraction of the collider (0 bottom .. 1 top), mass kg,
  //   fit: true = re-measure the Box3 at runtime (follows params like x / scale), parts = one body per child part (group),
  //   buoyant = spins / bobs when hit by water and floats in the puddle
  rubber_duck: { name: 'Patinho de borracha', socket: 'head_top', category: 'Objetos',
    physics: { shape: 'box', size: [0.19, 0.22, 0.307], center: [0.3, 0.108, -0.005], comY: 0.4, mass: 0.08, fit: true, buoyant: true } },
  plunger: { name: 'Desentupidor', socket: 'floor_right', category: 'Objetos',
    physics: { shape: 'cylinder', size: { r: 0.12, h: 0.75 }, center: [0, 0.375, 0], comY: 0.28, mass: 0.45 } },
  toilet_brush_holder: { name: 'Escova sanitária', socket: 'floor_left', category: 'Objetos',
    physics: { shape: 'cylinder', size: { r: 0.075, h: 0.479 }, center: [0, 0.239, 0], comY: 0.22, mass: 0.55 } },
  air_freshener: { name: 'Bom Ar (spray)', socket: 'head_top', category: 'Objetos',
    physics: { shape: 'cylinder', size: { r: 0.037, h: 0.253 }, center: [0.33, 0.126, 0], comY: 0.42, mass: 0.3, fit: true } },
  toilet_paper_stack: { name: 'Pilha de papel', socket: 'floor_left', category: 'Objetos',
    physics: { shape: 'box', size: [0.37, 0.315, 0.12], center: [0, 0.158, 0], mass: 0.6,
      parts: { shape: 'cylinder', size: { r: 0.06, h: 0.105 }, center: [0, 0.0525, 0], comY: 0.5, mass: 0.1 } } },
};
