// Furniture pack: the classic Brazilian yellow monobloc bar chair ("cadeira de bar Skol"),
// the same chair upgraded into a throne, the matching bar table and a styrofoam cooler.
// Local space of every piece: origin on the floor, +y up, +z = his forward (chairs face +z).
// The chairs go on socket 'floor_under' (floor point under the toilet, centred on the pedestal):
// the origin is the floor point under the seat centre and FURNITURE_INFO[id].seatHeight is the
// top of the seat surface at the centre, so the toilet can be raised to sit on it.
// Import-safe in Node (no DOM at import or build time).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { registerAccessory } from './index.js';

/* ------------------------------------------------------------ materials */
const FB = {
  skolYellow: { color: '#f7d417', roughness: 0.35, clearcoat: 0.3, clearcoatRoughness: 0.25,
    sheen: 0.25, sheenRoughness: 0.8, sheenColor: '#fff0a0' },               // glossy PP, soft "subsurface" rim
  skolInk: { color: '#0c0c0c', roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.3,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 },   // printed black logo
  drainHole: { color: '#2a2304', roughness: 0.9 },
  gold: { color: '#e9b949', metalness: 1, roughness: 0.25 },
  velvet: { color: '#6e0b16', roughness: 0.95, sheen: 1, sheenRoughness: 0.5, sheenColor: '#c23a4c' },
  jewelRed: { color: '#7a0a14', roughness: 0.05, metalness: 0, transmission: 0.5, ior: 1.77, thickness: 0.02, clearcoat: 1 },
  canPaint: { color: '#f2c40c', metalness: 0.55, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.1 },
  canBand: { color: '#101010', metalness: 0.4, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.1 },
  aluminium: { color: '#d4d7da', metalness: 1, roughness: 0.3 },
  styrofoam: { color: '#f4f4ef', roughness: 0.92, sheen: 0.6, sheenRoughness: 0.8, sheenColor: '#ffffff' },
  ice: { color: '#d8eef7', roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.55, ior: 1.31 },
  iceWater: { color: '#9cc7d8', roughness: 0.05, transparent: true, opacity: 0.45, depthWrite: false },
};
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
function rig(p) {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  if (p.scale != null) Array.isArray(p.scale) ? inner.scale.fromArray(p.scale) : inner.scale.setScalar(p.scale);
  return { root, inner };
}
const V = (a) => (a.isVector3 ? a.clone() : new THREE.Vector3(...a));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

/* ------------------------------------------------------------ geometry helpers */
/** Superellipse |x/a|^n + |y/b|^n = 1: point at parameter th and its outward unit normal. */
function sqPt(a, b, n, th) { return [a * spow(Math.cos(th), 2 / n), b * spow(Math.sin(th), 2 / n)]; }
function sqNrm(a, b, n, x, y) {
  const nx = spow(x / a, n - 1) / a, ny = spow(y / b, n - 1) / b, l = Math.hypot(nx, ny) || 1;
  return [nx / l, ny / l];
}

/**
 * "Lathe" around a rounded-square (superellipse) outline in the XZ plane.
 * profile = [[s, out, y], ...] (or fn(fx, fz) -> same-length list): point = s * boundary + out * normal, at height y.
 * The profile runs from the centre outward (top side) so normals face out. taper widens the +z side.
 */
function squircleLathe(a, b, n, profile, seg = 64, taper = 0) {
  const pos = [], idx = [];
  let rings = 0;
  for (let j = 0; j < seg; j++) {
    const [bx, bz] = sqPt(a, b, n, (j / seg) * Math.PI * 2);
    const [nx, nz] = sqNrm(a, b, n, bx, bz);
    const pr = typeof profile === 'function' ? profile(bx / a, bz / b) : profile;
    rings = pr.length;
    for (const [s, out, y] of pr) {
      let x = s * bx + out * nx; const z = s * bz + out * nz;
      if (taper) x *= 1 + (taper * z) / b;
      pos.push(x, y, z);
    }
  }
  for (let j = 0; j < seg; j++) {
    const j2 = (j + 1) % seg;
    for (let i = 0; i < rings - 1; i++) {
      const A = j * rings + i, B = A + 1, C = j2 * rings + i, D = C + 1;
      idx.push(A, C, B, C, D, B);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Sweep a rounded-square (superellipse) section along a Catmull-Rom path.
 * prof(t, P) -> [halfWidth (along B = T x N), halfHeight (along N), exponent?].
 * Frame: `up` = fixed reference projected on each section, else rotation-minimising from n0.
 */
function sweep(pts, prof, o = {}) {
  const { steps = 32, radial = 12, closed = false, up = null, n0 = new THREE.Vector3(0, 1, 0), caps = [false, false], ex = 3 } = o;
  const curve = new THREE.CatmullRomCurve3(pts.map(V), closed, 'centripetal');
  const rings = closed ? steps : steps + 1;
  const pos = [], idx = [];
  const P = new THREE.Vector3(), T = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3();
  const ends = [];
  for (let i = 0; i < rings; i++) {
    const t = i / steps;
    curve.getPointAt(Math.min(t, 1), P); curve.getTangentAt(Math.min(t, 1), T);
    const ref = up || (i === 0 ? n0 : N);
    N.copy(ref).addScaledVector(T, -ref.dot(T));
    if (N.lengthSq() < 1e-10) N.set(1, 0, 0).addScaledVector(T, -T.x);
    N.normalize();
    B.crossVectors(T, N).normalize();
    const [hw, hh, n = ex] = prof(t, P);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const x = hw * spow(Math.cos(a), 2 / n), y = hh * spow(Math.sin(a), 2 / n);
      pos.push(P.x + B.x * x + N.x * y, P.y + B.y * x + N.y * y, P.z + B.z * x + N.z * y);
    }
    if (i === 0 || i === rings - 1) ends.push(P.clone());
  }
  const last = closed ? rings : rings - 1;
  for (let i = 0; i < last; i++) {
    const i2 = (i + 1) % rings;
    for (let k = 0; k < radial; k++) {
      const k2 = (k + 1) % radial;
      const a = i * radial + k, b = i2 * radial + k, c = i * radial + k2, d = i2 * radial + k2;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (!closed) {
    [[0, caps[0], ends[0]], [rings - 1, caps[1], ends[1]]].forEach(([ring, on, cp], e) => {
      if (!on) return;
      const ci = pos.length / 3; pos.push(cp.x, cp.y, cp.z);
      for (let k = 0; k < radial; k++) {
        const a = ring * radial + k, b = ring * radial + ((k + 1) % radial);
        e === 0 ? idx.push(ci, a, b) : idx.push(ci, b, a);
      }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.curve = curve;
  return g;
}

/** The swirl logo: a filled disc with a curved arrow cut out of it (XY plane, facing +z). */
function logoGeometry(R, seg = 40) {
  const disc = new THREE.Shape();
  disc.absarc(0, 0, R, 0, Math.PI * 2, false);
  const r1 = 0.42 * R, r2 = 0.66 * R, a0 = Math.PI * 1.15, a1 = a0 + Math.PI * 1.45, tip = 0.42;
  const P = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  const hole = new THREE.Path();
  const n = 28;
  hole.moveTo(...P(r2, a0));
  for (let i = 1; i <= n; i++) hole.lineTo(...P(r2, lerp(a0, a1, i / n)));
  hole.lineTo(...P(r2 + 0.13 * R, a1));                 // arrowhead barbs + tip
  hole.lineTo(...P((r1 + r2) / 2, a1 + tip));
  hole.lineTo(...P(r1 - 0.13 * R, a1));
  for (let i = n; i >= 0; i--) hole.lineTo(...P(r1, lerp(a0, a1, i / n)));
  disc.holes.push(hole);
  return new THREE.ShapeGeometry(disc, seg);
}

/** 350 ml can (origin at the bottom centre, +y up). */
function beerCan(mats, p = {}) {
  const g = new THREE.Group();
  const r = 0.033, h = 0.122;
  const lathe = (pts, seg = 24) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
  mesh(lathe([[0.0, 0.006], [0.02, 0.003], [0.026, 0], [0.03, 0.002], [r, 0.012], [r, 0.103], [0.031, 0.111]]),
    M(mats, 'canPaint', p.color), g);
  mesh(lathe([[0.031, 0.111], [0.027, 0.119], [0.0275, h], [0.0262, h + 0.001], [0.0245, h - 0.004], [0, h - 0.004]]),
    M(mats, 'aluminium'), g);
  mesh(new THREE.CylinderGeometry(r + 0.0004, r + 0.0004, 0.022, 24, 1, true), M(mats, 'canBand'), g, 0, 0.05, 0);
  const tab = mesh(new THREE.BoxGeometry(0.012, 0.0015, 0.02), M(mats, 'aluminium'), g, 0, h - 0.003, 0.004);
  tab.rotation.x = 0.05;
  return g;
}

/* ------------------------------------------------------------ the monobloc chair */
const SEAT = { a: 0.232, b: 0.212, n: 6, taper: 0.04, y0: 0.45, dish: 0.01, rr: 0.011 };
const BACK = { a: 0.2, b: 0.13, n: 4, cy: 0.655, cz: -0.232, rec: 0.21, bend: 0.5, t: 0.008, tw: 0.021, td: 0.017 };
const seatDishY = (s) => SEAT.y0 - SEAT.dish * Math.max(0, 1 - (s / 0.96) ** 2) ** 2;

function seatProfile(fx, fz) {
  const { y0, rr } = SEAT, f = Math.max(0, fz) ** 3, r = rr * (1 + 0.5 * f), lip = 0.028 + 0.03 * f, top = y0 + 0.002;
  return [
    ...[0, 0.2, 0.4, 0.6, 0.75, 0.88, 0.96].map((s) => [s, 0, seatDishY(s)]),
    [1, 0, top], [1, r * 0.55, top - r * 0.17], [1, r * 0.92, top - r * 0.6], [1, r, top - r],
    [1, r, y0 - lip], [1, r - 0.003, y0 - lip - 0.002], [1, r - 0.006, y0 - lip], [1, r - 0.006, y0 - 0.016],
    [0.97, 0, y0 - 0.02], [0.6, 0, y0 - 0.024], [0, 0, y0 - 0.028],
  ];
}

/** Backrest field: arched crest (throne) and the cylindrical bend (sides come forward). */
function backWarp(x, y, z, crest) {
  if (crest && y > 0) y += crest * Math.max(0, 1 - (x / 0.24) ** 2) ** 1.5 * (y / BACK.b);
  return [x, y, z + BACK.bend * x * x];
}
function warpGeo(g, crest) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, ...backWarp(p.getX(i), p.getY(i), p.getZ(i), crest));
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
const backMatrix = () => new THREE.Matrix4().compose(new THREE.Vector3(0, BACK.cy, BACK.cz),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-BACK.rec, 0, 0)), new THREE.Vector3(1, 1, 1));
/** backrest-local (u, v, w) -> chair space */
const backPt = (u, v, w = 0, crest = 0) => new THREE.Vector3(...backWarp(u, v, w, crest)).applyMatrix4(backMatrix());
/** closed loop centreline (backrest local, before warp) */
function loopPts(k = 40, off = 0) {
  const out = [];
  for (let j = 0; j < k; j++) {
    const [x, y] = sqPt(BACK.a, BACK.b, BACK.n, (j / k) * Math.PI * 2);
    out.push([x, y, off]);
  }
  return out;
}

/**
 * Build the chair. Returns { group, back, legEnds } so the throne can decorate it.
 * o.crest = extra backrest height at the centre (m), o.holes / o.logoFront toggles.
 */
function buildChair(mats, p, o = {}) {
  const crest = o.crest || 0;
  const plastic = M(mats, 'skolYellow', p.color);
  const ink = M(mats, 'skolInk', p.logoColor);
  const g = new THREE.Group();
  g.name = 'monobloc';

  // seat: dished, rolled edge, deep front "waterfall" lip, slightly wider at the front
  mesh(squircleLathe(SEAT.a, SEAT.b, SEAT.n, seatProfile, 64, SEAT.taper), plastic, g).name = 'seat';
  if (o.holes !== false) {
    const hg = new THREE.CircleGeometry(0.0065, 12).rotateX(-Math.PI / 2), hm = M(mats, 'drainHole');
    for (const [x, z] of [[-0.025, -0.025], [0.025, -0.025], [-0.025, 0.025], [0.025, 0.025]]) {
      const s = Math.hypot(x / SEAT.a, z / SEAT.b);
      mesh(hg, hm, g, x, seatDishY(s) + 0.0012, z).userData.noShadow = true;
    }
  }

  // backrest: thin curved panel inside a thick rounded loop
  const back = new THREE.Group();
  back.name = 'backrest';
  back.position.set(0, BACK.cy, BACK.cz); back.rotation.x = -BACK.rec;
  g.add(back);
  const t = BACK.t / 2;
  const panel = squircleLathe(BACK.a, BACK.b, BACK.n,
    [[0, 0, t], [0.35, 0, t], [0.7, 0, t], [1, 0, t], [1, 0, -t], [0.7, 0, -t], [0.35, 0, -t], [0, 0, -t]], 48);
  // lathe is in XZ with "height" y = thickness; rotate so the panel stands in XY facing +z
  panel.rotateX(Math.PI / 2);
  mesh(warpGeo(panel, crest), plastic, back).name = 'panel';
  const loop = sweep(loopPts(40).map((q) => backWarp(q[0], q[1], q[2], crest)), () => [BACK.tw, BACK.td, 2.6],
    { closed: true, steps: 56, radial: 12, up: new THREE.Vector3(0, 0, 1) });
  mesh(loop, plastic, back).name = 'loop';
  // the swirl logo printed on both faces (always on)
  const R = 0.062, logoV = crest ? -0.01 : 0.0;
  for (const side of o.logoFront === false ? [-1] : [1, -1]) {
    const lg = logoGeometry(R);
    if (side < 0) lg.rotateY(Math.PI);
    const lp = lg.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i), y = lp.getY(i) + logoV;
      lp.setXYZ(i, x, y, BACK.bend * x * x + side * (t + 0.0025));
    }
    lg.computeVertexNormals();
    const m = mesh(lg, ink, back);
    m.name = side > 0 ? 'logo_front' : 'logo_back';
    m.userData.noShadow = true;
  }

  // arms: from the loop sides forward, rolling down at the front into the front legs (one piece)
  const legEnds = [];
  const legSec = (y) => lerp(0.017, 0.024, Math.min(1, y / 0.5));
  for (const s of [-1, 1]) {
    const root = backPt(s * (BACK.a - 0.005), -0.005, 0, crest);
    const armPts = [root, [s * 0.228, 0.652, -0.15], [s * 0.25, 0.648, -0.02], [s * 0.252, 0.64, 0.1],
      [s * 0.246, 0.605, 0.168], [s * 0.232, 0.53, 0.188], [s * 0.224, 0.44, 0.192], [s * 0.232, 0.22, 0.21], [s * 0.242, 0.004, 0.232]];
    const arm = sweep(armPts, (u, P) => {
      const k = sstep(0.5, 0.62, P.y), leg = legSec(P.y);
      const j = sstep(-0.2, -0.13, P.z);                        // slimmer where it merges into the loop
      return [lerp(leg, lerp(0.02, 0.027, j), k), lerp(leg * 1.05, 0.0145, k), lerp(3.2, 2.8, k)];
    }, { steps: 44, radial: 12, n0: new THREE.Vector3(0, 1, 0), caps: [false, true] });
    mesh(arm, plastic, g).name = s < 0 ? 'arm_left' : 'arm_right';
    legEnds.push(arm.userData.curve);
    // rear leg (under the seat) and rear post (seat -> loop)
    const rl = sweep([[s * 0.2, 0.432, -0.175], [s * 0.217, 0.22, -0.212], [s * 0.233, 0.004, -0.248]],
      (u, P) => { const w = legSec(P.y) + 0.004 * sstep(0.36, 0.43, P.y); return [w, w * 1.05, 3.2]; },
      { steps: 10, radial: 12, n0: new THREE.Vector3(0, 0, 1), caps: [false, true] });
    mesh(rl, plastic, g).name = s < 0 ? 'rear_leg_left' : 'rear_leg_right';
    legEnds.push(rl.userData.curve);
    const post = sweep([[s * 0.2, 0.43, -0.18], [s * 0.196, 0.5, -0.19], backPt(s * 0.19, -0.1, 0, crest)],
      () => [0.021, 0.018, 2.8], { steps: 8, radial: 12, n0: new THREE.Vector3(0, 0, 1) });
    mesh(post, plastic, g).name = s < 0 ? 'rear_post_left' : 'rear_post_right';
  }
  return { group: g, back, legEnds, plastic };
}

/* ------------------------------------------------------------ cadeira_skol */
registerAccessory('cadeira_skol', ({ mats }, p) => {
  const { root, inner } = rig(p);
  inner.add(buildChair(mats, p).group);
  return root;
});

/* ------------------------------------------------------------ trono_skol */
const CUSHION_H = 0.06, CUSHION_Y = 0.443;
registerAccessory('trono_skol', ({ mats }, p) => {
  const { root, inner } = rig(p);
  const crest = p.crest ?? 0.16;
  const { group, back, legEnds } = buildChair(mats, p, { crest, holes: false, logoFront: false });
  inner.add(group);
  const gold = M(mats, 'gold', p.trim);
  const velvet = M(mats, 'velvet', p.cushion);

  // gold piping: backrest loop (front face) and seat rim
  const pipe = (pts, r, closed, parent) => mesh(sweep(pts, () => [r, r, 2], { closed, steps: 48, radial: 6, up: new THREE.Vector3(0, 0, 1) }), gold, parent);
  pipe(loopPts(40, BACK.td * 0.75).map((q) => backWarp(q[0], q[1], q[2], crest)), 0.0045, true, back).name = 'trim_loop';
  const rim = [];
  for (let j = 0; j < 40; j++) {
    const [bx, bz] = sqPt(SEAT.a, SEAT.b, SEAT.n, (j / 40) * Math.PI * 2);
    const [nx, nz] = sqNrm(SEAT.a, SEAT.b, SEAT.n, bx, bz);
    const f = Math.max(0, bz / SEAT.b) ** 3, r = SEAT.rr * (1 + 0.5 * f);
    const z = bz + nz * r * 0.7;
    rim.push([(bx + nx * r * 0.7) * (1 + (SEAT.taper * z) / SEAT.b), SEAT.y0 - 0.003, z]);
  }
  mesh(sweep(rim, () => [0.0045, 0.0045, 2], { closed: true, steps: 48, radial: 6, up: new THREE.Vector3(0, 1, 0) }), gold, group).name = 'trim_seat';

  // gold ferrules on the feet, finials on the arm fronts and the crest corners
  const ferrule = new THREE.CylinderGeometry(0.022, 0.024, 0.035, 14);
  for (const c of legEnds) {
    const f = mesh(ferrule, gold, group);
    f.position.copy(c.getPointAt(1)).addScaledVector(c.getTangentAt(1), -0.02);
    f.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), c.getTangentAt(1));
  }
  const ball = new THREE.SphereGeometry(0.017, 12, 8);
  for (const s of [-1, 1]) {
    mesh(ball, gold, group, s * 0.252, 0.664, 0.105);
    const [cx, cy] = sqPt(BACK.a, BACK.b, BACK.n, Math.PI / 2 - s * 0.9);
    const [x, y, z] = backWarp(cx, cy, 0, crest);
    mesh(ball, gold, back, x, y + BACK.tw * 0.8, z);
  }

  // small gold crown on top of the crest (kept upright)
  const crown = new THREE.Group();
  crown.name = 'crown';
  const [, ty, tz] = backWarp(0, BACK.b, 0, crest);
  crown.position.set(0, ty + BACK.tw * 0.6, tz); crown.rotation.x = BACK.rec;
  back.add(crown);
  const band = mesh(new THREE.CylinderGeometry(0.05, 0.046, 0.028, 28, 1, true), gold, crown, 0, 0.014, 0);
  band.material = gold.clone(); band.material.side = THREE.DoubleSide;
  const spike = new THREE.ConeGeometry(0.011, 0.04, 8), knob = new THREE.SphereGeometry(0.0065, 8, 6);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    mesh(spike, gold, crown, Math.cos(a) * 0.047, 0.048, Math.sin(a) * 0.047);
    mesh(knob, gold, crown, Math.cos(a) * 0.047, 0.071, Math.sin(a) * 0.047);
  }
  const jewel = new THREE.SphereGeometry(0.007, 8, 6), jm = M(mats, 'jewelRed');
  for (const a of [-0.6, 0, 0.6]) mesh(jewel, jm, crown, Math.sin(a) * 0.05, 0.014, Math.cos(a) * 0.05);

  // red velvet cushions (seat + back, tufted)
  const pillow = (a, b, h) => {
    const prof = [0, 0.3, 0.55, 0.75, 0.88, 0.95, 0.99].map((s) => [s, 0, h * (0.55 + 0.45 * (1 - s ** 4))]);
    return [...prof, [1, 0.004, h * 0.45], [0.99, 0, h * 0.12], [0.94, 0, 0.002], [0, 0, 0]];
  };
  const seatC = mesh(squircleLathe(0.205, 0.19, 5, pillow(0.205, 0.19, CUSHION_H), 48, SEAT.taper), velvet, group, 0, CUSHION_Y, 0);
  seatC.name = 'cushion_seat';
  const bc = squircleLathe(0.172, 0.105, 4, pillow(0.172, 0.105, 0.036), 48).rotateX(Math.PI / 2);
  bc.translate(0, 0, BACK.t / 2);
  const bcm = mesh(warpGeo(bc, crest), velvet, back);
  bcm.name = 'cushion_back';
  const btn = new THREE.SphereGeometry(0.008, 8, 6);
  for (const [u, v] of [[-0.07, 0.04], [0.07, 0.04], [0, 0], [-0.07, -0.04], [0.07, -0.04]]) {
    const sN = ((Math.abs(u) / 0.172) ** 4 + (Math.abs(v) / 0.105) ** 4) ** 0.25;
    const h = 0.036 * (0.55 + 0.45 * (1 - sN ** 4)) - 0.006;
    const [x, y, z] = backWarp(u, v, BACK.t / 2 + h, crest);
    mesh(btn, gold, back, x, y, z);
  }

  // a couple of yellow beer cans beside the legs
  if (p.cans !== false) {
    const c1 = beerCan(mats, { color: p.canColor }); c1.position.set(0.335, 0, 0.12); c1.rotation.y = 0.4; inner.add(c1);
    const c2 = beerCan(mats, { color: p.canColor }); c2.rotation.set(0, 0.6, Math.PI / 2); c2.position.set(-0.29, 0.033, -0.06); inner.add(c2);
  }
  return root;
});

/* ------------------------------------------------------------ mesa_bar */
const TABLE = { a: 0.29, n: 8, H: 0.72 };
registerAccessory('mesa_bar', ({ mats }, p) => {
  const { root, inner } = rig(p);
  inner.position.x = p.x ?? 0;
  const plastic = M(mats, 'skolYellow', p.color);
  const { a, n, H } = TABLE;
  const top = squircleLathe(a, a, n, [
    [0, 0, H], [0.5, 0, H], [0.85, 0, H], [0.97, 0, H + 0.001], [1, 0, H + 0.001],
    [1, 0.008, H - 0.003], [1, 0.014, H - 0.011], [1, 0.016, H - 0.021], [1, 0.013, H - 0.031], [1, 0.007, H - 0.036],
    [1, -0.002, H - 0.037], [1, -0.002, H - 0.07], [1, -0.006, H - 0.072], [1, -0.009, H - 0.069], [1, -0.009, H - 0.014],
    [0.9, 0, H - 0.012], [0, 0, H - 0.012],
  ], 64);
  mesh(top, plastic, inner).name = 'tabletop';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = sweep([[sx * 0.235, H - 0.015, sz * 0.235], [sx * 0.25, H * 0.5, sz * 0.25], [sx * 0.265, 0.004, sz * 0.265]],
      (u, P) => { const w = lerp(0.019, 0.027, P.y / H) + 0.006 * sstep(H - 0.12, H - 0.02, P.y); return [w, w, 3.2]; },
      { steps: 10, radial: 12, n0: new THREE.Vector3(1, 0, 0), caps: [false, true] });
    mesh(leg, plastic, inner).name = 'table_leg';
  }
  // the swirl logo printed on the top (always on), reading from the front
  const lg = logoGeometry(p.logoSize ?? 0.12).rotateX(-Math.PI / 2);
  const logo = mesh(lg, M(mats, 'skolInk', p.logoColor), inner, 0, H + 0.0025, 0);
  logo.name = 'logo_top'; logo.userData.noShadow = true;
  return root;
});

/* ------------------------------------------------------------ isopor */
const COOLER = { W: 0.44, D: 0.3, H: 0.27, wall: 0.025, r: 0.035 };
function roundRect(w, h, r, Ctor = THREE.Shape) {
  const s = new Ctor(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
registerAccessory('isopor', ({ mats }, p) => {
  const { root, inner } = rig(p);
  inner.position.x = p.x ?? 0;
  const foam = M(mats, 'styrofoam', p.color);
  const { W, D, H, wall, r } = COOLER, bev = 0.005;
  mesh(new RoundedBoxGeometry(W, 0.03, D, 2, 0.01), foam, inner, 0, 0.015, 0).name = 'cooler_bottom';
  const ring = roundRect(W - 2 * bev, D - 2 * bev, r);
  ring.holes.push(roundRect(W - 2 * wall, D - 2 * wall, 0.015, THREE.Path));
  const walls = new THREE.ExtrudeGeometry(ring, { depth: H - 0.02 - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 6 });
  walls.rotateX(-Math.PI / 2);
  mesh(walls, foam, inner, 0, 0.02 + bev, 0).name = 'cooler_walls';
  // lid slid back and askew, so the cans and the ice show at the front
  const lid = new THREE.Group();
  lid.name = 'cooler_lid';
  lid.position.set(0.012, H + 0.02, -0.13); lid.rotation.y = 0.09;
  inner.add(lid);
  mesh(new RoundedBoxGeometry(W + 0.01, 0.04, D + 0.01, 2, 0.012), foam, lid);
  mesh(new RoundedBoxGeometry(W - 0.07, 0.01, D - 0.07, 1, 0.004), foam, lid, 0, 0.022, 0);
  // ice water + cubes + cans inside, two more cans on the floor against the front wall
  const iw = W - 2 * wall, idp = D - 2 * wall;
  const water = mesh(new THREE.PlaneGeometry(iw, idp).rotateX(-Math.PI / 2), M(mats, 'iceWater'), inner, 0, 0.19, 0);
  water.userData.noShadow = true;
  const cube = new RoundedBoxGeometry(0.034, 0.028, 0.034, 1, 0.007), im = M(mats, 'ice');
  [[-0.15, 0.09, 0.4], [-0.02, 0.1, 1.1], [0.1, 0.08, 2], [0.16, 0.05, 0.7], [-0.08, 0.06, 2.6], [0.04, 0.095, 0.2]].forEach(([x, z, ry]) => {
    const c = mesh(cube, im, inner, x, 0.19, z); c.rotation.set(0.3, ry, 0.2); c.userData.noShadow = true;
  });
  if (p.cans !== false) {
    for (const [x, z, ry, tilt] of [[-0.12, 0.072, 0.3, 0.08], [-0.045, 0.08, 1.2, -0.05], [0.07, 0.076, 2.2, 0.06], [0.145, 0.07, 0.8, -0.1]]) {
      const c = beerCan(mats, { color: p.canColor });
      c.position.set(x, 0.135, z); c.rotation.set(tilt, ry, tilt * 0.5);
      inner.add(c);
    }
    const out = beerCan(mats, { color: p.canColor });
    out.position.set(0.17, 0, D / 2 + 0.04); out.rotation.y = 0.5;
    inner.add(out);
    const lying = beerCan(mats, { color: p.canColor });
    lying.rotation.set(0, 0.15, Math.PI / 2); lying.position.set(0.0, 0.033, D / 2 + 0.04);
    inner.add(lying);
  }
  return root;
});

/* ------------------------------------------------------------ metadata */
// Same shape as ACCESSORY_INFO (extra.js). seatHeight = top of the seat surface at its centre (m, local,
// at scale 1). physics = props rigid body (see the comment above the props in ACCESSORY_INFO); the chairs
// carry the toilet, so they have none.
export const FURNITURE_INFO = {
  cadeira_skol: { name: 'Cadeira de bar (Skol)', socket: 'floor_under', category: 'Móveis', seatHeight: SEAT.y0 - SEAT.dish },
  trono_skol: { name: 'Trono de bar (Skol)', socket: 'floor_under', category: 'Móveis', seatHeight: CUSHION_Y + CUSHION_H },
  mesa_bar: { name: 'Mesa de bar', socket: 'floor_right', category: 'Móveis',
    physics: { shape: 'box', size: [0.612, 0.72, 0.612], center: [0, 0.363, 0], comY: 0.62, mass: 3.5, fit: true } },
  isopor: { name: 'Isopor com cerveja', socket: 'floor_left', category: 'Móveis',
    physics: { shape: 'box', size: [0.45, 0.32, 0.31], center: [0, 0.16, -0.02], comY: 0.35, mass: 1.6, fit: true } },
};
