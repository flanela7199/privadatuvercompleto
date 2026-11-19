// Furniture pack: the classic Brazilian yellow monobloc bar chair ("cadeira de bar Skol"),
// the same chair upgraded into a throne, the matching bar table and a styrofoam cooler.
// Art direction: a real injection-moulded polypropylene chair, not a toy: ~4.5 mm shell walls
// (seat, backrest and table top are shells with rolled edges, arms and legs are open U channels),
// ribbing under the seat / behind the backrest, stacking lugs, drain holes, mould seams, the
// recycling emboss under the seat, and the black swirl logo printed (slightly embossed) on the front.
// Local space of every piece: origin on the floor, +y up, +z = his forward (chairs face +z).
// Chairs go on socket 'floor_under' (floor point under the toilet, centred on the pedestal): the origin is
// the floor point under the seat centre and FURNITURE_INFO[id].seatHeight is the top of the seat surface at
// its centre (m, at scale 1), so the toilet can be raised to sit on it.
// Import-safe in Node (no DOM at import time; the procedural surface maps are only used when a DOM exists).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerAccessory } from './index.js';

/* ------------------------------------------------------------ materials */
const WALL = 0.0045;                          // moulded wall thickness (m)
const surf = (spec, repeat = [3, 3], ns = 0.05) => (typeof document === 'undefined' ? spec
  : { ...spec, normalMap: 'porcelainNormal', normalScale: [ns, ns], roughnessMap: 'porcelainRough', repeat });
const FB = {
  // glossy saturated PP with a little light bleeding through the 4.5 mm walls (subsurface tint)
  skolYellow: () => surf({ color: '#f7d417', roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.22,
    sheen: 0.2, sheenRoughness: 0.8, sheenColor: '#fff3b0', specularIntensity: 0.7,
    transmission: 0.1, thickness: WALL, ior: 1.49, attenuationColor: '#e9a400', attenuationDistance: 0.008 }),
  skolInk: () => ({ color: '#0a0a0a', roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
  drainHole: () => ({ color: '#120f04', roughness: 1, side: 'double' }),
  gold: () => ({ color: '#e9b949', metalness: 1, roughness: 0.25 }),
  velvet: () => ({ color: '#6e0b16', roughness: 0.95, sheen: 1, sheenRoughness: 0.5, sheenColor: '#c23a4c' }),
  jewelRed: () => ({ color: '#7a0a14', roughness: 0.05, metalness: 0, transmission: 0.5, ior: 1.77, thickness: 0.02, clearcoat: 1 }),
  canPaint: () => ({ color: '#f2c40c', metalness: 0.55, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.1 }),
  canBand: () => ({ color: '#101010', metalness: 0.4, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.1 }),
  aluminium: () => ({ color: '#d4d7da', metalness: 1, roughness: 0.3 }),
  styrofoam: () => ({ color: '#f4f4ef', roughness: 0.92, sheen: 0.6, sheenRoughness: 0.8, sheenColor: '#ffffff' }),
  ice: () => ({ color: '#d8eef7', roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.55, ior: 1.31 }),
  iceWater: () => ({ color: '#9cc7d8', roughness: 0.05, transparent: true, opacity: 0.45, depthWrite: false }),
};
function M(mats, name, color) {
  const m = mats.get(name, FB[name]());
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
// Default size factors: the toilet is stylised (bowl rim ~0.82 x 1.0 m, pedestal 0.60 x 0.73 m), so the
// real-size furniture is scaled up to read with it. params.scale overrides (absolute, not relative).
export const FURNITURE_SCALE = { cadeira_skol: 1.45, trono_skol: 1.45, mesa_bar: 1.3, isopor: 1.2 };
function rig(p, def = 1) {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  const sc = p.scale ?? def;
  Array.isArray(sc) ? inner.scale.fromArray(sc) : inner.scale.setScalar(sc);
  return { root, inner };
}
const V = (a) => (a.isVector3 ? a.clone() : new THREE.Vector3(...a));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;
const D2R = Math.PI / 180;

/* ------------------------------------------------------------ geometry helpers */
/** Superellipse |x/a|^n + |y/b|^n = 1: point at parameter th and its outward unit normal. */
function sqPt(a, b, n, th) { return [a * spow(Math.cos(th), 2 / n), b * spow(Math.sin(th), 2 / n)]; }
function sqNrm(a, b, n, x, y) {
  const nx = spow(x / a, n - 1) / a, ny = spow(y / b, n - 1) / b, l = Math.hypot(nx, ny) || 1;
  return [nx / l, ny / l];
}
/** superellipse "radius" of a point (1 on the outline) */
const sqR = (a, b, n, x, y) => ((Math.abs(x) / a) ** n + (Math.abs(y) / b) ** n) ** (1 / n);

/**
 * "Lathe" around a rounded-square (superellipse) outline in the XZ plane.
 * profile = [[s, out, y], ...] (or fn(fx, fz) -> same-length list): point = s * outline + out * normal, at height y.
 * Ordered from the centre outward on the top side, so the normals face out. taper widens the +z side.
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
 * Sweep a section along a centripetal Catmull-Rom path.
 * prof(t, P) -> [halfWidth (along B = T x N), halfHeight (along N), exponent?]  (rounded square)
 *            or [[x, y], ...]  (closed CCW polygon in (B, N), e.g. a U channel; constant length).
 * Frame: `up` = fixed reference projected on each section, else rotation-minimising from n0.
 */
function sweep(pts, prof, o = {}) {
  const { steps = 32, radial = 12, closed = false, up = null, n0 = new THREE.Vector3(0, 1, 0), caps = [false, false], ex = 3 } = o;
  const curve = new THREE.CatmullRomCurve3(pts.map(V), closed, 'centripetal');
  const rings = closed ? steps : steps + 1;
  const pos = [], idx = [];
  const P = new THREE.Vector3(), T = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3();
  const ends = [];
  let R = radial;
  for (let i = 0; i < rings; i++) {
    const t = Math.min(i / steps, 1);
    curve.getPointAt(t, P); curve.getTangentAt(t, T);
    const ref = up || (i === 0 ? n0 : N);
    N.copy(ref).addScaledVector(T, -ref.dot(T));
    if (N.lengthSq() < 1e-10) N.set(1, 0, 0).addScaledVector(T, -T.x);
    N.normalize();
    B.crossVectors(T, N).normalize();
    const pr = prof(t, P);
    let sec;
    if (Array.isArray(pr[0])) sec = pr;
    else {
      const [hw, hh, n = ex] = pr;
      sec = [];
      for (let k = 0; k < radial; k++) {
        const a = (k / radial) * Math.PI * 2;
        sec.push([hw * spow(Math.cos(a), 2 / n), hh * spow(Math.sin(a), 2 / n)]);
      }
    }
    R = sec.length;
    for (const [x, y] of sec) pos.push(P.x + B.x * x + N.x * y, P.y + B.y * x + N.y * y, P.z + B.z * x + N.z * y);
    if (i === 0 || i === rings - 1) ends.push(P.clone());
  }
  const last = closed ? rings : rings - 1;
  for (let i = 0; i < last; i++) {
    const i2 = (i + 1) % rings;
    for (let k = 0; k < R; k++) {
      const k2 = (k + 1) % R;
      const a = i * R + k, b = i2 * R + k, c = i * R + k2, d = i2 * R + k2;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (!closed) {
    [[0, caps[0], ends[0]], [rings - 1, caps[1], ends[1]]].forEach(([ring, on, cp], e) => {
      if (!on) return;
      const ci = pos.length / 3; pos.push(cp.x, cp.y, cp.z);
      for (let k = 0; k < R; k++) {
        const a = ring * R + k, b = ring * R + ((k + 1) % R);
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

/**
 * Moulded U channel section (CCW, in (B, N)): closed rounded side towards +N, open towards -N,
 * walls `tau` thick with rounded lip tips. hhL / hhR = how far each side wall reaches down (curl).
 */
function uChannel(hw, hh, hhL, hhR, tau = WALL, n = 2.6, K = 6) {
  const pts = [];
  const arc = (ax, ay, a0, a1) => {
    for (let i = 0; i <= K; i++) { const a = lerp(a0, a1, i / K); pts.push([ax * spow(Math.cos(a), 2 / n), ay * spow(Math.sin(a), 2 / n)]); }
  };
  pts.push([hw, -hhR]);
  arc(hw, hh, 0, Math.PI);
  pts.push([-hw, -hhL], [-hw + tau * 0.5, -hhL - tau * 0.45], [-hw + tau, -hhL]);
  arc(hw - tau, hh - tau, Math.PI, 0);
  pts.push([hw - tau, -hhR], [hw - tau * 0.5, -hhR - tau * 0.45]);
  return pts;
}

/** Thin rib plate between two (x, z) points hanging under a surface y = surfY(x, z). */
function ribUnder(x0, z0, x1, z1, depth, th, surfY, segs = 10) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const g = new THREE.BoxGeometry(len, 1, th, segs, 1, 1);
  g.rotateY(-Math.atan2(z1 - z0, x1 - x0)); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), ys = surfY(x, z);
    p.setY(i, p.getY(i) > 0 ? ys + 0.001 : ys - depth);
  }
  g.computeVertexNormals();
  return g;
}

/** Box-projected UVs (for the micro normal / roughness maps): ~4 tiles per metre. */
function boxUV(g, sc = 4) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ax >= ay && ax >= az ? [p.getZ(i), p.getY(i)] : ay >= az ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u * sc; uv[i * 2 + 1] = v * sc;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
/** Merge geometries (already in the parent's space) into one, with normals + box UVs. */
function bake(list) {
  const gs = list.map((g0) => {
    const g = g0;
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.morphAttributes = {};
    return boxUV(g);
  });
  const merged = mergeGeometries(gs, false);
  merged.userData.parts = gs.map((g) => g.index.count / 3);   // tris per source part (debug / tests)
  return merged;
}
/** inside-out copy (walls seen from inside: hole walls, crown band): mirror + recompute normals from the flipped winding */
const flipped = (g) => { g.scale(-1, 1, 1); g.computeVertexNormals(); return g; };
const placed = (g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) =>
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));

/** The swirl logo: a filled disc with a curved arrow cut out of it (XY plane, facing +z). */
function logoShape(R) {
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
  return disc;
}
/** printed + slightly embossed logo (crisp edges, no bevel), base at z = 0 */
const logoGeometry = (R, depth = 0.0007) => new THREE.ExtrudeGeometry(logoShape(R), { depth, bevelEnabled: false, curveSegments: 48 });

/** Moulded recycling mark: three chasing arrows around a triangle (XY plane, raised along +z). */
function recycleGeometry(r = 0.018, w = 0.0028, h = 0.0006) {
  const shapes = [];
  for (let i = 0; i < 3; i++) {
    const a0 = Math.PI / 2 + (i * 2 * Math.PI) / 3, a1 = a0 + (2 * Math.PI) / 3;
    const A = new THREE.Vector2(Math.cos(a0) * r, Math.sin(a0) * r), Bv = new THREE.Vector2(Math.cos(a1) * r, Math.sin(a1) * r);
    const d = Bv.clone().sub(A).normalize(), nrm = new THREE.Vector2(-d.y, d.x);
    const s0 = A.clone().addScaledVector(d, 0.006), s1 = Bv.clone().addScaledVector(d, -0.011), tip = Bv.clone().addScaledVector(d, -0.004);
    const sh = new THREE.Shape();
    const pt = (v, k) => v.clone().addScaledVector(nrm, k);
    sh.moveTo(...pt(s0, w / 2).toArray()); sh.lineTo(...pt(s1, w / 2).toArray()); sh.lineTo(...pt(s1, w * 1.3).toArray());
    sh.lineTo(...tip.toArray()); sh.lineTo(...pt(s1, -w * 1.3).toArray()); sh.lineTo(...pt(s1, -w / 2).toArray());
    sh.lineTo(...pt(s0, -w / 2).toArray());
    shapes.push(sh);
  }
  return new THREE.ExtrudeGeometry(shapes, { depth: h, bevelEnabled: false });
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
// seat: rounded square, 4 % wider at the front, dished 10 mm, raised bead at the rim, waterfall front
const SEAT = { a: 0.232, b: 0.228, n: 6, taper: 0.04, y0: 0.45, dish: 0.01, bead: 0.0035, rr: 0.0095 };
// backrest shell: outline (to the rolled rim), centre, recline, cylindrical bend; rim = C section rolled backwards
// (top kept under the toilet's neck pipe, which enters the back of the bowl ~0.44 m above the seat at 1.45x;
// backrest set back so it stays behind the bowl). Per-build overrides via buildChair(o.back).
const BACK_DEF = { a: 0.212, b: 0.118, n: 4.2, cy: 0.615, cz: -0.295, rec: 0.26, bend: 0.5,
  rim: { cd: -0.006, cw: -0.011, R: 0.0175 } };
const BACK = { ...BACK_DEF };
const RIM_OUT = BACK.rim.cd + BACK.rim.R;     // outermost reach of the rolled rim past the outline
const seatTopY = (s) => SEAT.y0 - SEAT.dish * Math.max(0, 1 - (s / 0.96) ** 2) ** 2 + SEAT.bead * sstep(0.88, 0.985, s);
const seatS = (x, z) => sqR(SEAT.a, SEAT.b, SEAT.n, x / (1 + (SEAT.taper * z) / SEAT.b), z);
const seatUnderY = (x, z) => seatTopY(seatS(x, z)) - WALL;
const lipDepth = (fz) => 0.028 + 0.03 * Math.max(0, fz) ** 3;

function seatProfile(fx, fz) {
  const f = Math.max(0, fz) ** 3, r = SEAT.rr * (1 + 0.5 * f), lip = lipDepth(fz), yb = SEAT.y0 + SEAT.bead, c = yb - r;
  const ri = r - WALL, bulge = 0.003 * f;
  const top = [0, 0.2, 0.4, 0.6, 0.75, 0.86, 0.93, 0.965].map((s) => [s, 0, seatTopY(s)]);
  return [
    ...top, [0.985, 0, yb],
    ...[60, 30, 0].map((a) => [1, r * Math.cos(a * D2R), c + r * Math.sin(a * D2R)]),            // rolled edge
    [1, r + bulge, SEAT.y0 - lip * 0.5], [1, r, SEAT.y0 - lip],                                   // skirt / waterfall
    [1, r - WALL * 0.5, SEAT.y0 - lip - WALL * 0.45], [1, ri, SEAT.y0 - lip],                     // rounded bottom edge
    [1, ri + bulge, SEAT.y0 - lip * 0.5], [1, ri, c],
    ...[30, 60].map((a) => [1, ri * Math.cos(a * D2R), c + ri * Math.sin(a * D2R)]),
    [0.985, 0, yb - WALL],
    ...top.reverse().map(([s, , y]) => [s, 0, y - WALL]),                                          // underside
  ];
}

/** backrest C-rim + panel profile (lathe space [s, out, w]) */
function backProfile() {
  const { cd, cw, R } = BACK.rim, Ri = R - WALL, h = WALL / 2;
  const face = [[0, 0], [0.3, 0], [0.55, 0], [0.72, 0]];
  return [
    ...face.map(([s]) => [s, 0, h]), [1, -0.034, h],
    ...[120, 85, 50, 15, -20, -55, -90, -125, -150].map((a) => [1, cd + R * Math.cos(a * D2R), cw + R * Math.sin(a * D2R)]),
    [1, cd + (R - h) * Math.cos(-158 * D2R), cw + (R - h) * Math.sin(-158 * D2R)],
    ...[-150, -120, -85, -50, -15, 20, 55, 90, 140].map((a) => [1, cd + Ri * Math.cos(a * D2R), cw + Ri * Math.sin(a * D2R)]),
    [1, -0.034, -h], ...face.reverse().map(([s]) => [s, 0, -h]),
  ];
}

/** Backrest field: arched crest (throne; the rim keeps its section) and the cylindrical bend (sides come forward). */
function backWarp(x, y, z, crest) {
  if (crest && y > 0) y += crest * Math.max(0, 1 - (x / 0.3) ** 2) ** 1.5 * sstep(0, BACK.b - 0.04, y);
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
/** outline offset by d along its normal, at depth w (backrest local, warped) */
function backOutline(k, d, w, crest) {
  const out = [];
  for (let j = 0; j < k; j++) {
    const [x, y] = sqPt(BACK.a, BACK.b, BACK.n, (j / k) * Math.PI * 2), [nx, ny] = sqNrm(BACK.a, BACK.b, BACK.n, x, y);
    out.push(backWarp(x + nx * d, y + ny * d, w, crest));
  }
  return out;
}
const seam = (pts, up) => sweep(pts, () => [0.0007, 0.0007, 2], { closed: true, steps: 72, radial: 3, up });

/**
 * Build the chair. Returns { group, back, feet, ... } so the throne can decorate it.
 * o.crest = extra backrest height at the centre (m); o.back = overrides of BACK (cz, rec, ...); o.holes; o.logo = {v, R} placement on the front;
 * o.footMat = material of the feet pads.
 */
function buildChair(mats, p, o = {}) {
  const crest = o.crest || 0;
  Object.assign(BACK, BACK_DEF, o.back || {});
  const plastic = M(mats, 'skolYellow', p.color);
  const ink = M(mats, 'skolInk', p.logoColor);
  const g = new THREE.Group();
  g.name = 'monobloc';
  const seatParts = [], backParts = [], footParts = [];

  // seat shell
  seatParts.push(squircleLathe(SEAT.a, SEAT.b, SEAT.n, seatProfile, 64, SEAT.taper));
  // underside: cross-ribbing grid + X diagonals, stacking lugs, recycling emboss
  const ribD = 0.016, ribT = 0.003, inX = (z) => SEAT.a * 0.95 * (1 - (Math.abs(z) / SEAT.b) ** SEAT.n) ** (1 / SEAT.n) * (1 + (SEAT.taper * z) / SEAT.b);
  for (const z of [-0.13, -0.045, 0.045, 0.13]) seatParts.push(ribUnder(-inX(z), z, inX(z), z, ribD, ribT, seatUnderY));
  for (const x of [-0.14, -0.05, 0.05, 0.14]) {
    const zm = SEAT.b * 0.95 * (1 - (Math.abs(x) / SEAT.a) ** SEAT.n) ** (1 / SEAT.n);
    seatParts.push(ribUnder(x, -zm, x, zm, ribD, ribT, seatUnderY));
  }
  for (const s of [-1, 1]) seatParts.push(ribUnder(-0.17, -0.155 * s, 0.17, 0.155 * s, ribD * 0.8, ribT, seatUnderY, 14));
  for (const [x, z] of [[-0.165, -0.15], [0.165, -0.15], [-0.17, 0.155], [0.17, 0.155]]) {
    const lug = new RoundedBoxGeometry(0.02, 0.016, 0.028, 1, 0.005);
    seatParts.push(placed(lug, x, seatUnderY(x, z) - 0.008, z));
  }
  seatParts.push(placed(recycleGeometry(), 0, seatUnderY(0, 0) + 0.0002, 0.02, Math.PI / 2, 0, 0));
  seatParts.push(placed(new THREE.ExtrudeGeometry(logoShape(0.011), { depth: 0.0006, bevelEnabled: false, curveSegments: 16 }),
    0, seatUnderY(0, -0.04) + 0.0002, -0.04, Math.PI / 2, 0, Math.PI));
  // mould seam around the skirt
  const sk = [];
  for (let j = 0; j < 48; j++) {
    const [bx, bz] = sqPt(SEAT.a, SEAT.b, SEAT.n, (j / 48) * Math.PI * 2), [nx, nz] = sqNrm(SEAT.a, SEAT.b, SEAT.n, bx, bz);
    const fz = bz / SEAT.b, f = Math.max(0, fz) ** 3, d = SEAT.rr * (1 + 0.5 * f) + 0.003 * f + 0.0004, z = bz + nz * d;
    sk.push([(bx + nx * d) * (1 + (SEAT.taper * z) / SEAT.b), SEAT.y0 - lipDepth(fz) * 0.5, z]);
  }
  seatParts.push(seam(sk, new THREE.Vector3(0, 1, 0)));
  // 2 drain holes through the dish: dark core + the 4.5 mm wall of the hole
  if (o.holes !== false) {
    const hm = M(mats, 'drainHole');
    for (const x of [-0.028, 0.028]) {
      const z = -0.01, y = seatTopY(seatS(x, z));
      const core = mesh(new THREE.CircleGeometry(0.0058, 14).rotateX(-Math.PI / 2), hm, g, x, y + 0.0004, z);
      core.userData.noShadow = true;
      seatParts.push(placed(flipped(new THREE.CylinderGeometry(0.006, 0.006, WALL + 0.001, 14, 1, true)), x, y - WALL / 2, z));
    }
  }

  // backrest: curved shell with the rolled C rim, ribs on the back
  const back = new THREE.Group();
  back.name = 'backrest';
  back.position.set(0, BACK.cy, BACK.cz); back.rotation.x = -BACK.rec;
  g.add(back);
  backParts.push(warpGeo(squircleLathe(BACK.a, BACK.b, BACK.n, backProfile(), 64).rotateX(Math.PI / 2), crest));
  const ribW = -WALL / 2 - 0.005, vIn = (u) => BACK.b * (1 - (Math.abs(u) / BACK.a) ** BACK.n) ** (1 / BACK.n) - 0.022;
  for (const u of [-0.14, -0.07, 0, 0.07, 0.14]) {
    const vm = vIn(u);
    backParts.push(warpGeo(new THREE.BoxGeometry(0.003, 2 * vm, 0.0105, 1, 8, 1).translate(u, 0, ribW), crest));
  }
  for (const v of [-0.035]) {
    const um = BACK.a * (1 - (Math.abs(v) / BACK.b) ** BACK.n) ** (1 / BACK.n) - 0.022;
    backParts.push(warpGeo(new THREE.BoxGeometry(2 * um, 0.003, 0.0105, 16, 1, 1).translate(0, v, ribW), crest));
  }
  backParts.push(warpGeo(seam(backOutline(48, RIM_OUT + 0.0004, BACK.rim.cw, 0), new THREE.Vector3(0, 0, 1)), crest));
  // the swirl logo, printed and slightly embossed on the front (always on)
  {
    const R = o.logo?.R ?? 0.06, lv = o.logo?.v ?? 0.0;
    const lg = logoGeometry(R);
    const lp = lg.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i), y = lp.getY(i) + lv;
      lp.setXYZ(i, x, y, BACK.bend * x * x + WALL / 2 - 0.0002 + lp.getZ(i));
    }
    lg.computeVertexNormals();
    const m = mesh(lg, ink, back);
    m.name = 'logo';
    m.userData.noShadow = true;
  }

  // arms: from the backrest sides forward, curling down at the front into the front legs (one U channel)
  const feet = [];
  const legW = (y) => lerp(0.019, 0.027, Math.min(1, y / 0.5));          // chunky monobloc legs, tapering down
  for (const s of [-1, 1]) {
    // the arm rises out of the backrest side rim with a big rounded corner (continuous loop look)
    const P0 = backPt(s * (BACK.a - 0.004), 0.065, BACK.rim.cw, crest), P1 = backPt(s * (BACK.a - 0.004), 0.035, BACK.rim.cw, crest);
    const rc = P1.y - 0.648, corner = [30, 60, 90].map((d) => [lerp(P1.x, s * 0.236, d / 90), P1.y - rc * Math.sin(d * D2R), P1.z + rc * (1 - Math.cos(d * D2R))]);
    const armPts = [P0, P1, ...corner, [s * 0.25, 0.648, -0.02], [s * 0.252, 0.64, 0.1],
      [s * 0.246, 0.605, 0.168], [s * 0.232, 0.53, 0.188], [s * 0.224, 0.44, 0.192], [s * 0.232, 0.22, 0.21], [s * 0.242, 0.006, 0.232]];
    const arm = sweep(armPts, (u, P) => {
      const k = sstep(0.5, 0.62, P.y), lw = legW(P.y), j = sstep(0.02, 0.12, u);   // slimmer inside the rim
      const e = lerp(0.5, 1, sstep(0, 0.08, u));                                  // root shrinks inside the rim
      const hw = e * lerp(lw, lerp(0.02, 0.027, j), k), hh = e * lerp(lw * 1.1, 0.012, k);
      const curl = e * lerp(lw * 1.1, 0.02, k), inner = e * lerp(lw * 1.1, 0.011, k);   // outer wall reaches lower
      return s < 0 ? uChannel(hw, hh, inner, curl) : uChannel(hw, hh, curl, inner);
    }, { steps: 52, n0: new THREE.Vector3(0, 1, 0) });
    seatParts.push(arm);
    feet.push(arm.userData.curve);
    // rear leg (open to the front) and rear post up to the backrest (open to the back)
    const rl = sweep([[s * 0.2, 0.434, -0.19], [s * 0.217, 0.22, -0.228], [s * 0.233, 0.006, -0.264]],
      (u, P) => { const w = legW(P.y) + 0.004 * sstep(0.36, 0.43, P.y); return uChannel(w, w * 1.1, w * 1.1, w * 1.1); },
      { steps: 12, n0: new THREE.Vector3(0, 0, -1) });
    seatParts.push(rl);
    feet.push(rl.userData.curve);
    seatParts.push(sweep([[s * 0.2, 0.43, -0.195], [s * 0.198, 0.5, -0.215], backPt(s * 0.196, -0.07, BACK.rim.cw, crest)],
      (u) => { const e = lerp(1, 0.5, sstep(0.75, 1, u)); return uChannel(0.023 * e, 0.013 * e, 0.016 * e, 0.016 * e); },
      { steps: 10, n0: new THREE.Vector3(0, 0, 1) }));
  }
  // rounded feet pads
  for (const c of feet) {
    const e = c.getPointAt(1), d = c.getTangentAt(1);
    footParts.push(placed(new RoundedBoxGeometry(0.044, 0.014, 0.05, 1, 0.006), e.x, 0.007, e.z, 0, Math.atan2(d.x, d.z), 0));
  }

  const seatMesh = mesh(bake(seatParts), plastic, g); seatMesh.name = 'chair_body';
  const backMesh = mesh(bake(backParts), plastic, back); backMesh.name = 'chair_back';
  const footMesh = mesh(bake(footParts), o.footMat || plastic, g); footMesh.name = 'chair_feet';
  return { group: g, back, feet, plastic };
}

/* ------------------------------------------------------------ cadeira_skol */
registerAccessory('cadeira_skol', ({ mats }, p) => {
  const { root, inner } = rig(p, FURNITURE_SCALE.cadeira_skol);
  inner.add(buildChair(mats, p).group);
  return root;
});

/* ------------------------------------------------------------ trono_skol */
const THRONE_BACK = { cz: -0.33, rec: 0.42 };      // throne: reclined further and set back (crest behind the pipe)
const CUSHION_H = 0.06, CUSHION_Y = SEAT.y0 - SEAT.dish + 0.003;
registerAccessory('trono_skol', ({ mats }, p) => {
  const { root, inner } = rig(p, FURNITURE_SCALE.trono_skol);
  const crest = p.crest ?? 0.16;
  const gold = M(mats, 'gold', p.trim);
  const velvet = M(mats, 'velvet', p.cushion);
  // the logo moves up onto the crest (the back cushion covers the panel)
  const { group, back } = buildChair(mats, p, { crest, back: THRONE_BACK, holes: false, footMat: gold, logo: { v: BACK.b - 0.034 + crest * 0.55, R: 0.058 } });
  inner.add(group);
  const goldParts = [], backGold = [];

  // gold piping on the rim bead and the seat bead
  const { cd, cw, R } = BACK.rim;
  backGold.push(sweep(backOutline(48, cd + R * Math.cos(95 * D2R), cw + R * Math.sin(95 * D2R) + 0.003, crest),
    () => [0.0042, 0.0042, 2], { closed: true, steps: 56, radial: 5, up: new THREE.Vector3(0, 0, 1) }));
  const rim = [];
  for (let j = 0; j < 48; j++) {
    const [bx, bz] = sqPt(SEAT.a, SEAT.b, SEAT.n, (j / 48) * Math.PI * 2), [nx, nz] = sqNrm(SEAT.a, SEAT.b, SEAT.n, bx, bz);
    const z = bz * 0.99 + nz * 0.003;
    rim.push([(bx * 0.99 + nx * 0.003) * (1 + (SEAT.taper * z) / SEAT.b), SEAT.y0 + SEAT.bead + 0.002, z]);
  }
  goldParts.push(sweep(rim, () => [0.0042, 0.0042, 2], { closed: true, steps: 56, radial: 5, up: new THREE.Vector3(0, 1, 0) }));
  // finials on the arm fronts and the crest corners
  for (const s of [-1, 1]) {
    goldParts.push(new THREE.SphereGeometry(0.017, 12, 8).translate(s * 0.252, 0.668, 0.1));
    const [cx, cy] = sqPt(BACK.a, BACK.b, BACK.n, Math.PI / 2 - s * 0.9), [nx, ny] = sqNrm(BACK.a, BACK.b, BACK.n, cx, cy);
    backGold.push(new THREE.SphereGeometry(0.016, 12, 8).translate(...backWarp(cx + nx * RIM_OUT, cy + ny * RIM_OUT, cw, crest)));
  }
  // small gold crown on top of the crest (kept upright)
  const crown = new THREE.Group();
  crown.name = 'crown';
  const [, ty, tz] = backWarp(0, BACK.b + RIM_OUT, cw, crest);
  crown.position.set(0, ty - 0.004, tz); crown.rotation.x = BACK.rec;
  back.add(crown);
  const cg = [new THREE.CylinderGeometry(0.05, 0.046, 0.028, 28, 1, true).translate(0, 0.014, 0),
    flipped(new THREE.CylinderGeometry(0.0465, 0.0425, 0.026, 28, 1, true)).translate(0, 0.014, 0),   // inside of the band
    new THREE.TorusGeometry(0.048, 0.0025, 6, 28).rotateX(Math.PI / 2)];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2, x = Math.cos(a) * 0.047, z = Math.sin(a) * 0.047;
    cg.push(new THREE.ConeGeometry(0.011, 0.04, 8).translate(x, 0.048, z), new THREE.SphereGeometry(0.0065, 8, 6).translate(x, 0.071, z));
  }
  mesh(bake(cg), gold, crown);
  const jm = M(mats, 'jewelRed');
  for (const a of [-0.6, 0, 0.6]) mesh(new THREE.SphereGeometry(0.007, 8, 6), jm, crown, Math.sin(a) * 0.05, 0.014, Math.cos(a) * 0.05);

  // red velvet cushions (seat + back), tufted with gold buttons
  const pillow = (h) => {
    const prof = [0, 0.3, 0.55, 0.75, 0.88, 0.95, 0.99].map((s) => [s, 0, h * (0.55 + 0.45 * (1 - s ** 4))]);
    return [...prof, [1, 0.004, h * 0.45], [0.99, 0, h * 0.12], [0.94, 0, 0.002], [0, 0, 0]];
  };
  mesh(squircleLathe(0.205, 0.19, 5, pillow(CUSHION_H), 48, SEAT.taper), velvet, group, 0, CUSHION_Y, 0).name = 'cushion_seat';
  const CB = { a: 0.178, b: 0.088, h: 0.036 };
  const bc = squircleLathe(CB.a, CB.b, 4, pillow(CB.h), 48).rotateX(Math.PI / 2).translate(0, -0.006, WALL / 2);
  mesh(warpGeo(bc, 0), velvet, back).name = 'cushion_back';
  for (const [u, v] of [[-0.075, 0.033], [0.075, 0.033], [0, 0], [-0.075, -0.037], [0.075, -0.037]]) {
    const sN = sqR(CB.a, CB.b, 4, u, v + 0.006), h = CB.h * (0.55 + 0.45 * (1 - sN ** 4)) - 0.005;
    backGold.push(new THREE.SphereGeometry(0.008, 8, 6).translate(...backWarp(u, v, WALL / 2 + h, 0)));
  }
  for (const [x, z] of [[-0.08, -0.07], [0.08, -0.07], [0, 0], [-0.08, 0.08], [0.08, 0.08]]) {
    const sN = sqR(0.205, 0.19, 5, x, z), h = CUSHION_H * (0.55 + 0.45 * (1 - sN ** 4)) - 0.006;
    goldParts.push(new THREE.SphereGeometry(0.008, 8, 6).translate(x, CUSHION_Y + h, z));
  }
  mesh(bake(goldParts), gold, group).name = 'trim_gold';
  mesh(bake(backGold), gold, back).name = 'trim_gold_back';

  // a couple of yellow beer cans beside the legs
  if (p.cans !== false) {
    const c1 = beerCan(mats, { color: p.canColor }); c1.position.set(0.335, 0, 0.12); c1.rotation.y = 0.4; inner.add(c1);
    const c2 = beerCan(mats, { color: p.canColor }); c2.rotation.set(0, 0.6, Math.PI / 2); c2.position.set(-0.29, 0.033, -0.06); inner.add(c2);
  }
  return root;
});

/* ------------------------------------------------------------ mesa_bar */
const TABLE = { a: 0.29, n: 8, H: 0.72, rr: 0.013, skirt: 0.055 };
registerAccessory('mesa_bar', ({ mats }, p) => {
  const { root, inner } = rig(p, FURNITURE_SCALE.mesa_bar);
  inner.position.x = p.x ?? 0.22;      // pushed out (+x on floor_right) to clear the 1.45x chair arms; use -0.22 on floor_left
  const plastic = M(mats, 'skolYellow', p.color);
  const { a, n, H, rr, skirt } = TABLE, c = H - rr, ri = rr - WALL, under = H - WALL;
  const parts = [];
  // top shell: flat top, rolled edge, apron skirt with rounded bottom edge, underside
  const top = [0, 0.4, 0.7, 0.88, 0.96].map((s) => [s, 0, H]);
  parts.push(squircleLathe(a, a, n, [
    ...top, [1, 0, H],
    ...[60, 30, 0].map((d) => [1, rr * Math.cos(d * D2R), c + rr * Math.sin(d * D2R)]),
    [1, rr + 0.001, H - skirt * 0.5], [1, rr, H - skirt], [1, rr - WALL * 0.5, H - skirt - WALL * 0.45], [1, ri, H - skirt],
    [1, ri, c], ...[30, 60].map((d) => [1, ri * Math.cos(d * D2R), c + ri * Math.sin(d * D2R)]), [1, 0, H - WALL],
    ...top.reverse().map(([s]) => [s, 0, under]),
  ], 64));
  // underside ribbing grid + diagonals + corner leg sockets
  const ribY = () => under, e = a * 0.97;
  for (const q of [-0.15, 0, 0.15]) parts.push(ribUnder(-e, q, e, q, 0.02, 0.003, ribY, 4), ribUnder(q, -e, q, e, 0.02, 0.003, ribY, 4));
  for (const sz of [-1, 1]) parts.push(ribUnder(-0.24, -0.24 * sz, 0.24, 0.24 * sz, 0.016, 0.003, ribY, 4));
  const feet = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(placed(new RoundedBoxGeometry(0.07, 0.035, 0.07, 1, 0.008), sx * 0.235, under - 0.0175, sz * 0.235));
    // leg: tapered U channel, closed side outwards, open towards the centre
    const out = new THREE.Vector3(sx, 0, sz).normalize();
    const leg = sweep([[sx * 0.235, H - 0.03, sz * 0.235], [sx * 0.25, H * 0.5, sz * 0.25], [sx * 0.265, 0.006, sz * 0.265]],
      (u, P) => { const w = lerp(0.021, 0.03, P.y / H); return uChannel(w, w * 1.1, w * 1.1, w * 1.1); },
      { steps: 12, n0: out });
    parts.push(leg);
    feet.push(leg.userData.curve);
  }
  for (const cv of feet) { const e2 = cv.getPointAt(1); parts.push(placed(new RoundedBoxGeometry(0.05, 0.014, 0.05, 1, 0.006), e2.x, 0.007, e2.z, 0, Math.PI / 4, 0)); }
  // mould seam around the apron
  const sk = [];
  for (let j = 0; j < 48; j++) {
    const [bx, bz] = sqPt(a, a, n, (j / 48) * Math.PI * 2), [nx, nz] = sqNrm(a, a, n, bx, bz), d = rr + 0.0015;
    sk.push([bx + nx * d, H - skirt * 0.5, bz + nz * d]);
  }
  parts.push(seam(sk, new THREE.Vector3(0, 1, 0)));
  mesh(bake(parts), plastic, inner).name = 'table_body';
  // the swirl logo printed on the top (always on), reading from the front
  const lg = logoGeometry(p.logoSize ?? 0.12).rotateX(-Math.PI / 2);
  const logo = mesh(lg, M(mats, 'skolInk', p.logoColor), inner, 0, H - 0.0002, 0);
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
  const { root, inner } = rig(p, FURNITURE_SCALE.isopor);
  inner.position.x = p.x ?? -0.1;      // pushed out (-x on floor_left) to clear the chair's front legs; use 0.1 on floor_right
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
// Same shape as ACCESSORY_INFO (extra.js). seatHeight = where a flat base rests (m, local): the chair's raised rim
// bead (the toilet pedestal 0.60 x 0.73 overhangs the dish), the throne's cushion top; given at the
// DEFAULT size (seatScale = that default factor): with params.scale = k the seat is at seatHeight * k / seatScale.
// mass (kg) is used by ToiletTuber for the seat body it builds itself. physics = props rigid body (see the comment
// above the props in ACCESSORY_INFO), in UNSCALED builder units: ToiletTuber.addProp multiplies by the inner
// (params / default) scale.
const S = FURNITURE_SCALE;
export const FURNITURE_INFO = {
  cadeira_skol: { name: 'Cadeira de bar (Skol)', socket: 'floor_under', category: 'Móveis',
    seatHeight: +((SEAT.y0 + SEAT.bead) * S.cadeira_skol).toFixed(4), seatScale: S.cadeira_skol, mass: 2.4 },
  trono_skol: { name: 'Trono de bar (Skol)', socket: 'floor_under', category: 'Móveis',
    seatHeight: +((CUSHION_Y + CUSHION_H) * S.trono_skol).toFixed(4), seatScale: S.trono_skol, mass: 3.5 },
  mesa_bar: { name: 'Mesa de bar', socket: 'floor_right', category: 'Móveis', scale: S.mesa_bar,
    physics: { shape: 'box', size: [0.612, 0.72, 0.612], center: [0, 0.36, 0], comY: 0.62, mass: 3.5, fit: true } },
  isopor: { name: 'Isopor com cerveja', socket: 'floor_left', category: 'Móveis', scale: S.isopor,
    physics: { shape: 'box', size: [0.48, 0.32, 0.55], center: [0.01, 0.16, -0.03], comY: 0.35, mass: 1.6, fit: true } },
};
/** seat height (m) for a slot entry's params (honours params.scale) */
export const furnitureSeatHeight = (id, params = {}) => {
  const f = FURNITURE_INFO[id];
  if (!f?.seatHeight) return 0;
  const k = Array.isArray(params.scale) ? params.scale[1] : params.scale;
  return k == null ? f.seatHeight : (f.seatHeight * k) / f.seatScale;
};
