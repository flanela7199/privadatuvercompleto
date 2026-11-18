// Accessory registry. A theme lists accessories per socket:
//   "slots": { "head_top": [{ "id": "crown", "params": {...} }], ... }
// To add one: registerAccessory('my_hat', (ctx, params) => object3D).
// The returned object may set userData.update = (state) => {} for per-frame motion.
// Meshes with userData.noShadow = true are left out of shadow casting (fur shells).
//
// Art direction: real materials, not toy plastic (see the reference photo:
// real porcelain, stuck-on googly eyes, plain black handlebar mustache, small gold crown).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Spring } from '../anim/spring.js';
import { taperedTube, starShape } from '../rig/geo.js';
import { getMesh, rustMustache, rustRoundedBox } from '../rig/geocache.js';

const REGISTRY = new Map();
export const registerAccessory = (id, build) => REGISTRY.set(id, build);
export const listAccessories = () => [...REGISTRY.keys()];

export function buildAccessory(ctx, entry) {
  const build = REGISTRY.get(entry.id);
  if (!build) {
    console.warn(`[accessory] unknown id "${entry.id}"`);
    return null;
  }
  const obj = build(ctx, entry.params || {});
  obj.name = obj.name || `acc_${entry.id}`;
  const t = entry.transform;
  if (t) {
    if (t.position) obj.position.fromArray(t.position);
    if (t.rotation) obj.rotation.fromArray(t.rotation);
    if (t.scale != null) Array.isArray(t.scale) ? obj.scale.fromArray(t.scale) : obj.scale.setScalar(t.scale);
  }
  obj.traverse((o) => { if (o.isMesh) o.castShadow = !o.userData.noShadow; });
  return obj;
}

/* ------------------------------------------------------------- helpers */
/** Deterministic PRNG so accessories look the same on every rebuild. */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const UPV = new THREE.Vector3(0, 1, 0), XV = new THREE.Vector3(1, 0, 0);

/** Orient an object on a ring: local +Z points outward at angle a (a = atan2(z, x)). */
function faceOut(obj, a) { obj.rotation.y = Math.PI / 2 - a; return obj; }

/**
 * Hundreds of thin tapered hair strands following `curve`, merged into ONE geometry.
 * radiusFn(t) = envelope radius of the hair bundle along the curve.
 */
function hairStrands(curve, radiusFn, o = {}) {
  const {
    count = 800, seg = 9, radial = 3, thick = 0.0018, start = [0, 0.2], len = [0.45, 1],
    cover = [0.65, 1.0], twist = 0.8, frizz = 0.0012, droop = 0, seed = 1, trimY = null,
  } = o;
  const R = rng(seed);
  const FS = 200;
  const frames = curve.computeFrenetFrames(FS, false);
  const nv = count * (seg + 1) * radial;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = [];
  const pts = Array.from({ length: seg + 1 }, () => new THREE.Vector3());
  const P = new THREE.Vector3(), T = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), n = new THREE.Vector3();
  let v = 0;
  for (let s = 0; s < count; s++) {
    const t0 = lerp(start[0], start[1], R());
    const t1 = Math.min(1, t0 + lerp(len[0], len[1], R()));
    const a0 = R() * Math.PI * 2;
    const f = lerp(cover[0], cover[1], Math.sqrt(R()));
    const tw = (R() * 2 - 1) * twist * Math.PI;
    const th = thick * lerp(0.6, 1.4, R());
    const dr = droop * R();
    const fx = (R() - 0.5) * frizz, fy = (R() - 0.5) * frizz, fz = (R() - 0.5) * frizz;
    for (let k = 0; k <= seg; k++) {
      const u = k / seg;
      const t = lerp(t0, t1, u);
      const fi = Math.round(t * FS);
      curve.getPointAt(t, P);
      const r = radiusFn(t) * f * (1 - 0.2 * u * u);
      const a = a0 + tw * u;
      pts[k].copy(P)
        .addScaledVector(frames.normals[fi], Math.cos(a) * r)
        .addScaledVector(frames.binormals[fi], Math.sin(a) * r);
      pts[k].x += fx * u * u; pts[k].y += fy * u * u - dr * u * u; pts[k].z += fz * u * u;
      if (trimY != null && pts[k].y < trimY) pts[k].y = trimY;
    }
    const base = v;
    for (let k = 0; k <= seg; k++) {
      const u = k / seg;
      T.subVectors(pts[Math.min(k + 1, seg)], pts[Math.max(k - 1, 0)]).normalize();
      A.crossVectors(T, Math.abs(T.y) < 0.9 ? UPV : XV).normalize();
      B.crossVectors(T, A);
      const rr = th * (1 - 0.9 * u) + 0.00015;
      for (let j = 0; j < radial; j++) {
        const ang = (j / radial) * Math.PI * 2;
        n.copy(A).multiplyScalar(Math.cos(ang)).addScaledVector(B, Math.sin(ang));
        pos[v * 3] = pts[k].x + n.x * rr; pos[v * 3 + 1] = pts[k].y + n.y * rr; pos[v * 3 + 2] = pts[k].z + n.z * rr;
        nor[v * 3] = n.x; nor[v * 3 + 1] = n.y; nor[v * 3 + 2] = n.z;
        uv[v * 2] = j / radial; uv[v * 2 + 1] = u;
        v++;
      }
    }
    for (let k = 0; k < seg; k++)
      for (let j = 0; j < radial; j++) {
        const a = base + k * radial + j, b = base + k * radial + ((j + 1) % radial);
        idx.push(a, a + radial, b, b, a + radial, b + radial);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Noise texture for fur shells (alpha = random per texel, slight clumping). */
let _furTex = null;
function furTexture() {
  if (_furTex) return _furTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const R = rng(7);
  const clump = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) clump[i] = R();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const nb = (clump[((y + 1) % S) * S + x] + clump[y * S + ((x + 1) % S)]) * 0.5;
      const val = Math.min(1, R() * 0.75 + nb * 0.25) * 255;
      img.data.set([val, val, val, 255], i * 4);
    }
  ctx.putImageData(img, 0, 0);
  _furTex = new THREE.CanvasTexture(c);
  _furTex.wrapS = _furTex.wrapT = THREE.RepeatWrapping;
  _furTex.repeat.set(5, 5);
  _furTex.generateMipmaps = false;
  _furTex.minFilter = THREE.LinearFilter;
  return _furTex;
}

/**
 * Shell-textured fur: a base mesh plus `layers` shells pushed out along the normal
 * (in the vertex shader), each discarding more texels -> tapered hairs.
 */
function furShells(geo, baseMat, { layers = 8, length = 0.02, gravity = 0.4 } = {}) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(geo, baseMat);
  g.add(base);
  const tex = furTexture();
  const tip = baseMat.color.clone().lerp(baseMat.sheenColor ?? new THREE.Color('#ffffff'), 0.35);
  for (let i = 1; i <= layers; i++) {
    const u = i / layers;
    const m = baseMat.clone();
    m.alphaMap = tex;
    m.alphaTest = lerp(0.25, 0.92, u);
    m.color = baseMat.color.clone().lerp(tip, u);
    const off = (length * u).toFixed(5), sag = (length * gravity * u * u).toFixed(5);
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>\n  transformed += normalize(objectNormal) * ${off};\n  transformed.y -= ${sag};`);
    };
    m.customProgramCacheKey = () => `fur_${off}_${sag}`;
    const shell = new THREE.Mesh(geo, m);
    shell.userData.noShadow = true;
    shell.name = `fur_shell_${i}`;
    g.add(shell);
  }
  return g;
}

/** Faceted (Kremlin-style) star: raised centre, ridges to the tips, closed back. */
function facetedStarGeometry(r, ri, h, points = 5) {
  const pos = [0, 0, h];
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? ri : r;
    const a = Math.PI / 2 + (i * Math.PI) / points;
    pos.push(Math.cos(a) * rr, Math.sin(a) * rr, 0);
  }
  pos.push(0, 0, 0); // back centre
  const N = points * 2, back = N + 1, idx = [];
  for (let i = 0; i < N; i++) {
    const a = 1 + i, b = 1 + ((i + 1) % N);
    idx.push(0, a, b, back, b, a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

/** Enamel star with a raised gold rim and a gold backing plate. */
function enamelStar(mats, r) {
  const g = new THREE.Group();
  const gold = mats.get('gold');
  const enamel = mats.get('sovietRed', { color: '#a8121a', roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.15 }).clone();
  enamel.flatShading = true;
  const back = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(r * 1.16, r * 0.5), {
    depth: r * 0.12, bevelEnabled: true, bevelThickness: r * 0.06, bevelSize: r * 0.05, bevelSegments: 3,
  }), gold);
  g.add(back);
  const rimShape = starShape(r * 1.02, r * 0.44);
  const hole = new THREE.Path(starShape(r * 0.88, r * 0.37).getPoints());
  rimShape.holes.push(hole);
  const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(rimShape, {
    depth: r * 0.1, bevelEnabled: true, bevelThickness: r * 0.03, bevelSize: r * 0.02, bevelSegments: 2,
  }), gold);
  rim.position.z = r * 0.16;
  g.add(rim);
  const face = new THREE.Mesh(facetedStarGeometry(r * 0.9, r * 0.38, r * 0.28), enamel);
  face.position.z = r * 0.18;
  g.add(face);
  return g;
}

/* ---------------------------------------------------------------- crown */
// Classic small gold crown: solid sheet-metal band with pointed tips + balls,
// moulded rims, a few bezel-set cut gems, red velvet cap inside.
function crownShell(R, H, band, n, th = 0.006, cols = 256, rows = 8) {
  const pos = [], idx = [];
  const top = (a) => {
    let f = ((a / (Math.PI * 2)) * n) % 1;
    if (f < 0) f += 1;
    const s = 1 - Math.abs(2 * f - 1);
    return band + (H - band) * Math.pow(s, 1.7);
  };
  const flare = (y) => R * (0.94 + 0.06 * (y / H)); // tips lean slightly outward
  // vertex layout per column: outer rows (0..rows), inner rows (rows..0)
  const per = (rows + 1) * 2;
  for (let c = 0; c <= cols; c++) {
    const a = (c / cols) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a), ht = top(a);
    for (let r = 0; r <= rows; r++) {
      const y = (r / rows) * ht, ro = flare(y);
      pos.push(ca * ro, y, sa * ro);
    }
    for (let r = rows; r >= 0; r--) {
      const y = (r / rows) * ht, ri = flare(y) - th;
      pos.push(ca * ri, y, sa * ri);
    }
  }
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < per; r++) {
      const a = c * per + r, b = c * per + ((r + 1) % per), a2 = a + per, b2 = b + per;
      idx.push(a, b, a2, b, b2, a2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, flare };
}

registerAccessory('crown', ({ mats }, p) => {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const R = 0.15;                                  // modelled at 0.15, scaled to p.radius
  const n = p.points ?? 8;
  const H = 0.06 + (p.spike ?? 0.085);             // total height to the tip
  const band = p.band ?? 0.055;
  const gold = mats.get('gold');
  const flare = (y) => R * (0.94 + 0.06 * (y / H));
  const geo = getMesh('crown_shell', { R, H, band, n }) ?? crownShell(R, H, band, n).geo; // Rust build / cache
  const shell = new THREE.Mesh(geo, gold);
  shell.name = 'crown_shell';
  inner.add(shell);

  // moulded rims (round wire) at the bottom and along the top of the band
  for (const y of [0.004, band - 0.004]) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(flare(y) + 0.002, 0.005, 10, 96), gold);
    t.rotation.x = Math.PI / 2; t.position.y = y;
    inner.add(t);
  }
  // fine beaded wire just above the bottom rim
  const beadGeo = new THREE.SphereGeometry(0.0032, 8, 6);
  const beads = new THREE.InstancedMesh(beadGeo, gold, 72);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2, rr = flare(0.013) + 0.002;
    m4.makeTranslation(Math.cos(a) * rr, 0.013, Math.sin(a) * rr);
    beads.setMatrixAt(i, m4);
  }
  inner.add(beads);

  // balls on the tips
  const ballGeo = new THREE.SphereGeometry(0.0115, 20, 14);
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * Math.PI * 2, rr = flare(H) - 0.003;
    const ball = new THREE.Mesh(ballGeo, gold);
    ball.position.set(Math.cos(a) * rr, H + 0.008, Math.sin(a) * rr);
    inner.add(ball);
  }

  // bezel-set cut gems under every tip (crown-cut: flat table, 8 facets)
  const gemMats = [
    mats.get('jewelRed', { color: '#7a0a14', roughness: 0.05, metalness: 0, transmission: 0.5, ior: 1.77, thickness: 0.02, clearcoat: 1 }),
    mats.get('jewelBlue', { color: '#0f2a7a', roughness: 0.05, metalness: 0, transmission: 0.5, ior: 1.77, thickness: 0.02, clearcoat: 1 }),
    mats.get('jewelGreen', { color: '#0b5a34', roughness: 0.05, metalness: 0, transmission: 0.5, ior: 1.58, thickness: 0.02, clearcoat: 1 }),
  ];
  for (const m of gemMats) { m.flatShading = true; m.needsUpdate = true; }
  const gemGeo = new THREE.CylinderGeometry(0.0085, 0.014, 0.008, 8);
  gemGeo.rotateX(Math.PI / 2); // table faces +Z
  const pavGeo = new THREE.ConeGeometry(0.014, 0.008, 8);
  pavGeo.rotateX(-Math.PI / 2); pavGeo.translate(0, 0, -0.008);
  const bezelGeo = new THREE.TorusGeometry(0.0145, 0.0028, 8, 24);
  const yGem = band * 0.55;
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * Math.PI * 2, rr = flare(yGem) + 0.004;
    const set = faceOut(new THREE.Group(), a);
    set.position.set(Math.cos(a) * rr, yGem, Math.sin(a) * rr);
    const gm = gemMats[[0, 1, 0, 2][k % 4]];
    const gem = new THREE.Mesh(gemGeo, gm);
    gem.position.z = 0.002;
    set.add(gem, new THREE.Mesh(pavGeo, gm), new THREE.Mesh(bezelGeo, gold));
    inner.add(set);
    // small gold boss between the gems
    const b = ((k) / n) * Math.PI * 2, rb = flare(yGem) + 0.002;
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 12, 8), gold);
    boss.position.set(Math.cos(b) * rb, yGem, Math.sin(b) * rb);
    inner.add(boss);
  }

  // red velvet cap showing through the points
  const velvet = mats.get('velvet', { color: '#6e0b16', roughness: 0.95, sheen: 1, sheenRoughness: 0.5, sheenColor: '#c23a4c' });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(R * 0.9, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), velvet);
  cap.scale.y = 0.62; cap.position.y = 0.012;
  inner.add(cap);

  inner.scale.setScalar((p.radius ?? 0.15) / R);

  const tilt = p.tilt ?? 0.12;
  const wob = new Spring(140, 6), wobX = new Spring(140, 6);
  g.rotation.z = tilt;
  g.userData.update = (st) => {
    wob.target = -st.headYawVel * 0.06; wobX.target = st.headPitchVel * 0.05 - st.lift * 2;
    wob.step(st.dt); wobX.step(st.dt);
    g.rotation.z = tilt + wob.x;
    g.rotation.x = wobX.x;
  };
  return g;
});

/* ---------------------------------------------------------- mustaches */
// Every mustache is two mirrored hair bundles (mustache_R / mustache_L) laid along the
// LID's front rim (the upper lip): default socket `lip_upper`, so it moves with the lid.
// Add a style with registerMustache(id, spec):
//   pts      right-half control points [x, y] (x >= 0 side); y = 0 is the mustache centre line,
//            which sits LIP.cy above the socket (on the lid's rounded front face)
//   radius   (t) => bundle radius along the curve, t in [0, 1]
//   knot     centre knot radius;  hair: options for hairStrands()
//   amount   how much the halves rotate when the mouth opens
//   hugX     beyond this |x| the bundle leaves the rim and sticks out straight
//   hangFrom below this y the bundle hangs straight down (in front of the seat/bowl)
// Below the lid every bundle keeps its full radius (+ LIP.seatGap) in front of the seat's front rim
// (the lower lip), so it does not cut into the seat when it presses up to the lid.
//   trimY    hairs/core are cut flat at this y (trimmed styles)
// Params (theme JSON): color, scale, length (stretches the shape), thickness.
export const MUSTACHE_IDS = [];

// lip_upper socket (rig/ToiletTuber.js): on the lid's front edge. Origin = front point of the lid
// outline (lid-local x = 0, z = DIM.lid.rz) at the lid underside; +z out, +y up, child of lid_bone_7.
// With the lid closed (hinge 0) it sits at body (0, LIP.y, LIP.z). The lid's rounded front face spans
// y 0..DIM.lid.depth (0.036), outermost at depth / 2. Mirrored in geo/hair.rs (LIP_*).
const LIP = {
  y: 0.677,                                  // lid_pivot y = DIM.rimY + 0.006 + DIM.seat.h + 0.004
  z: 0.49,                                   // lid centre is at body z 0 -> front point = DIM.lid.rz
  rx: 0.4, rz: 0.49, egg: 0.08,              // DIM.lid outline (egg = DIM.egg)
  seatRx: 0.405, seatRz: 0.495,              // DIM.seat outline, just under the lid ...
  seatY0: -0.034, seatY1: -0.004,            // ... between these socket-space y (lid closed / seat pressed up)
  seatGap: 0.005,                            // clearance kept from the seat's front rim (it slides/presses a bit)
  cy: 0.01,                                  // mustache centre line, above the socket origin (on the lid face)
  gap: 0.006,                                // stand-off from the rim
};
const DEFAULT_DIM = {
  bowlProfile: [[0.001, 0], [0.3, 0], [0.312, 0.012], [0.3, 0.035], [0.25, 0.1], [0.225, 0.2], [0.24, 0.3],
    [0.3, 0.39], [0.36, 0.47], [0.395, 0.55], [0.41, 0.6], [0.412, 0.622], [0.402, 0.636], [0.37, 0.638]],
  bowlScaleZ: 1.22, egg: 0.08,
};

/** z of an egg outline (rig/geo.js eggPoint: x = rx cos(th) (1 - k sin(th)), z = rz sin(th)) at |x| = ax, front half. */
function eggZ(rx, rz, k, ax) {
  if (ax >= rx) return 0;
  let lo = 0, hi = Math.PI / 2;
  for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (rx * Math.cos(mid) * (1 - k * Math.sin(mid)) > ax) lo = mid; else hi = mid; }
  return rz * Math.sin((lo + hi) / 2);
}

/**
 * Returns surf(x, y) = z of the bowl's front glaze at socket-space (x, y), relative to the socket at body (o.y, o.z).
 * Mirrors the rig: LatheGeometry (x = r sin φ, z = r cos φ) -> z *= bowlScaleZ -> eggify(k).
 */
function bowlSurface(dim, o) {
  const prof = dim?.bowlProfile ?? DEFAULT_DIM.bowlProfile;
  const sz = dim?.bowlScaleZ ?? DEFAULT_DIM.bowlScaleZ, k = dim?.egg ?? DEFAULT_DIM.egg;
  let top = 1;
  for (let i = 1; i < prof.length; i++) { if (prof[i][1] >= prof[top][1]) top = i; else break; }
  const outer = prof.slice(1, top + 1); // outer wall, ascending y (skip the axis point)
  const rAt = (y) => {
    if (y <= outer[0][1]) return outer[0][0];
    for (let i = 1; i < outer.length; i++) {
      if (y <= outer[i][1]) {
        const [r0, y0] = outer[i - 1], [r1, y1] = outer[i];
        return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
      }
    }
    return outer[outer.length - 1][0];
  };
  const at = (r, phi) => {
    const xs = r * Math.sin(phi), zs = sz * r * Math.cos(phi);
    return [xs * (1 - (k * zs) / (Math.hypot(xs, zs) || 1)), zs];
  };
  return (x, y) => {
    const r = rAt(o.y + y), ax = Math.abs(x);
    let z = 0;
    if (ax < r) {
      let lo = 0, hi = Math.PI / 2;
      for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (at(r, mid)[0] < ax) lo = mid; else hi = mid; }
      z = at(r, (lo + hi) / 2)[1];
    }
    return z - o.z;
  };
}

/**
 * Returns front(x, y) = z of what the mustache lies on at lip-socket-space (x, y), relative to the socket:
 * the lid's front rim (egg outline), and below the lid the bowl glaze (lid closed) so hanging parts stay
 * in front of it. The seat is handled in zOf (full-radius clearance).
 */
function lipFront(dim) {
  const bowl = bowlSurface(dim, LIP);
  return (x, y) => {
    const ax = Math.abs(x);
    let z = eggZ(LIP.rx, LIP.rz, LIP.egg, ax) - LIP.z;
    if (y < LIP.seatY1) z = Math.max(z, bowl(ax, y));
    return z;
  };
}

function mustacheHalves(ctx, spec, p, id) {
  const rs = (part, side) => (spec.rust === false ? null : rustMustache(id, p, ctx.dim, part, side)); // Rust build / cache
  const { mats } = ctx;
  const front = lipFront(ctx.dim);
  const surf = (x, y) => front(x, y + LIP.cy); // shape space (centre line y = 0) -> socket space
  const L = p.length ?? 1, Th = p.thickness ?? 1;
  const radius = (t) => spec.radius(t) * Th;
  const hugX = spec.hugX ?? 0.26;
  const zOf = (x, y, r) => {
    let z = surf(x, y);
    if (x > hugX) { // leave the rim: continue along half the rim slope
      const z0 = surf(hugX, y), z1 = surf(hugX - 0.01, y);
      z = Math.max(z, z0 + ((z0 - z1) / 0.01) * 0.5 * (x - hugX));
    }
    if (spec.hangFrom != null && y < spec.hangFrom) z = Math.max(z, surf(x, spec.hangFrom));
    z = z + LIP.gap + r * 0.55; // sit on the rim, not inside it
    // keep the whole bundle cross-section in front of the seat's front rim (lower lip)
    const ys = y + LIP.cy;
    const dy = ys > LIP.seatY1 ? ys - LIP.seatY1 : ys < LIP.seatY0 ? LIP.seatY0 - ys : 0;
    if (dy < r) z = Math.max(z, eggZ(LIP.seatRx, LIP.seatRz, LIP.egg, Math.abs(x)) - LIP.z + LIP.seatGap + Math.sqrt(r * r - dy * dy));
    return z;
  };
  const trimY = spec.trimY == null ? null : spec.trimY + LIP.cy;
  const g = new THREE.Group();
  let mat = mats.get('mustache');
  mat.side = THREE.DoubleSide;
  if (p.color) { mat = mat.clone(); mat.color.set(p.color); }
  // dark core keeps the silhouette solid; hair strands give the real look
  const core = mat.clone();
  core.color = mat.color.clone().multiplyScalar(0.55);
  core.sheen = 0;
  core.roughness = Math.min(1, (mat.roughness ?? 0.5) + 0.25);
  const trim = (geo) => {
    if (trimY == null) return geo;
    const ps = geo.attributes.position;
    for (let i = 0; i < ps.count; i++) if (ps.getY(i) < trimY) ps.setY(i, trimY);
    geo.computeVertexNormals();
    return geo;
  };
  const n = spec.pts.length;
  const halves = [];
  [1, -1].forEach((side, si) => {
    const pts = spec.pts.map(([x, y], i) => {
      const X = x * L, Y = y * L;
      return [X * side, Y + LIP.cy, zOf(X, Y, radius(i / (n - 1)))];
    });
    const half = new THREE.Group();
    half.name = side > 0 ? 'mustache_R' : 'mustache_L';
    half.add(new THREE.Mesh(rs('core', side) ?? trim(taperedTube(pts, (t) => radius(t) * 0.78, 96, 12)), core));
    const hairGeo = rs('hair', side) ?? hairStrands(new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q))), radius,
      { ...spec.hair, trimY, seed: (spec.hair?.seed ?? 11) + si * 101 });
    const hair = new THREE.Mesh(hairGeo, mat);
    hair.name = 'mustache_hair';
    half.add(hair);
    halves.push(half);
    g.add(half);
  });
  const kr = spec.knot * Th;
  const knot = new THREE.Mesh(new THREE.SphereGeometry(kr, 20, 14), core);
  knot.scale.set(1.2, 0.85, 0.7); knot.position.set(0, LIP.cy, zOf(0, 0, kr));
  g.add(knot);
  // short hairs over the centre so the join is not a bald blob
  const mid = new THREE.CatmullRomCurve3([-0.03, 0, 0.03].map((x) => new THREE.Vector3(x, (x ? 0 : -0.002) + LIP.cy, zOf(Math.abs(x), 0, kr))));
  g.add(new THREE.Mesh(rs('mid', 1) ?? hairStrands(mid, () => kr * 0.95, {
    count: spec.mid ?? 220, seg: 6, start: [0, 0.4], len: [0.4, 0.7], twist: 0.3,
    thick: spec.hair?.thick ?? 0.0018, trimY, seed: 5,
  }), mat));
  return { g, halves };
}

function mustacheUpdate(g, halves, amount) {
  const sp = new Spring(200, 9);
  g.userData.update = (st) => {
    sp.target = st.mouth; sp.step(st.dt);
    const wig = Math.sin(st.time * 18) * 0.04 * st.talk;
    halves[0].rotation.z = sp.x * amount + wig;
    halves[1].rotation.z = -sp.x * amount - wig;
    g.position.y = sp.x * 0.015;
  };
}

export function registerMustache(id, spec) {
  if (!MUSTACHE_IDS.includes(id)) MUSTACHE_IDS.push(id);
  registerAccessory(id, (ctx, p) => {
    const { g, halves } = mustacheHalves(ctx, spec, p, id);
    g.scale.setScalar(p.scale ?? 1);
    mustacheUpdate(g, halves, spec.amount ?? 0.15);
    return g;
  });
}

// Classic waxed handlebar (the reference photo): tight bundle twisting into the curl.
registerMustache('mustache_handlebar', {
  pts: [[-0.015, 0], [0.05, -0.006], [0.11, -0.02], [0.17, -0.028], [0.215, -0.016],
        [0.243, 0.012], [0.248, 0.045], [0.228, 0.064], [0.205, 0.054]],
  radius: (t) => 0.004 + 0.034 * Math.pow(1 - t, 1.15),
  knot: 0.03, amount: 0.22,
  hair: { count: 1100, seg: 10, thick: 0.0016, start: [0, 0.25], len: [0.35, 1], cover: [0.72, 1.0], twist: 0.7, frizz: 0.0015 },
});

// Bushy, loose, drooping.
registerMustache('mustache_walrus', {
  pts: [[-0.02, 0.01], [0.06, 0.0], [0.13, -0.03], [0.185, -0.075], [0.215, -0.12], [0.225, -0.15]],
  radius: (t) => 0.018 + 0.05 * Math.pow(1 - t, 0.8),
  knot: 0.055, amount: 0.12,
  hair: { count: 1500, seg: 9, thick: 0.002, start: [0, 0.35], len: [0.3, 0.9], cover: [0.6, 1.08], twist: 0.35, frizz: 0.008, droop: 0.012 },
});

// Thick and broad, covering the whole "lip", corners slightly down.
registerMustache('mustache_chevron', {
  pts: [[-0.015, 0.01], [0.06, 0.006], [0.12, -0.008], [0.17, -0.032], [0.2, -0.058]],
  radius: (t) => 0.02 + 0.03 * Math.pow(1 - t, 0.6),
  knot: 0.05, amount: 0.14,
  hair: { count: 900, seg: 8, thick: 0.0019, start: [0, 0.3], len: [0.4, 0.9], cover: [0.65, 1.03], twist: 0.25, frizz: 0.004, droop: 0.006 },
});

// Thin, neat line.
registerMustache('mustache_pencil', {
  pts: [[-0.01, 0.0], [0.06, -0.003], [0.12, -0.008], [0.17, -0.012], [0.205, -0.011]],
  radius: (t) => 0.003 + 0.007 * Math.pow(1 - t, 0.5),
  knot: 0.009, amount: 0.18, mid: 80,
  hair: { count: 420, seg: 8, thick: 0.0009, start: [0, 0.25], len: [0.4, 1], cover: [0.6, 1.0], twist: 0.2, frizz: 0.0006 },
});

// Thin over the lip, then two long strands hanging straight down past the bowl.
registerMustache('mustache_fu_manchu', {
  pts: [[-0.01, 0.0], [0.06, -0.008], [0.11, -0.03], [0.13, -0.08], [0.135, -0.16], [0.14, -0.26], [0.145, -0.36]],
  radius: (t) => 0.004 + 0.012 * Math.pow(1 - t, 0.7),
  knot: 0.016, amount: 0.06, hangFrom: -0.06, mid: 120,
  hair: { count: 600, seg: 12, thick: 0.0012, start: [0, 0.15], len: [0.5, 1], cover: [0.6, 1.0], twist: 0.45, frizz: 0.003 },
});

// Down both sides of the "mouth" to the jaw, following the bowl.
registerMustache('mustache_horseshoe', {
  pts: [[-0.01, 0.0], [0.07, -0.005], [0.13, -0.015], [0.17, -0.05], [0.185, -0.12], [0.19, -0.2]],
  radius: (t) => 0.026 - 0.012 * t,
  knot: 0.03, amount: 0.07,
  hair: { count: 800, seg: 10, thick: 0.0017, start: [0, 0.2], len: [0.4, 1], cover: [0.65, 1.02], twist: 0.2, frizz: 0.003 },
});

// Long, straight, pointed sideways (sticks out past the bowl).
registerMustache('mustache_english', {
  pts: [[-0.01, 0.0], [0.07, -0.004], [0.14, -0.006], [0.21, -0.004], [0.28, 0.0], [0.33, 0.004]],
  radius: (t) => 0.002 + 0.03 * Math.pow(1 - t, 1.3),
  knot: 0.028, amount: 0.16, hugX: 0.22,
  hair: { count: 700, seg: 10, thick: 0.0015, start: [0, 0.2], len: [0.45, 1], cover: [0.75, 1.0], twist: 0.5, frizz: 0.001 },
});

// Thin, waxed, sharply upturned spikes.
registerMustache('mustache_dali', {
  pts: [[-0.01, 0.0], [0.04, -0.004], [0.075, -0.01], [0.1, 0.0], [0.113, 0.04], [0.122, 0.09], [0.128, 0.14]],
  radius: (t) => 0.0012 + 0.012 * Math.pow(1 - t, 1.2),
  knot: 0.014, amount: 0.2, mid: 100,
  hair: { count: 600, seg: 10, thick: 0.0011, start: [0, 0.2], len: [0.5, 1], cover: [0.75, 1.0], twist: 0.9, frizz: 0.0005 },
});

// Bushy and upturned at the ends.
registerMustache('mustache_imperial', {
  pts: [[-0.015, 0.005], [0.06, 0.0], [0.12, -0.012], [0.17, -0.008], [0.2, 0.02], [0.215, 0.06], [0.215, 0.095]],
  radius: (t) => 0.008 + 0.04 * Math.pow(1 - t, 0.9),
  knot: 0.045, amount: 0.18,
  hair: { count: 860, seg: 9, thick: 0.0019, start: [0, 0.3], len: [0.4, 1], cover: [0.62, 1.05], twist: 0.5, frizz: 0.005 },
});

// Trimmed: wide, short, cut flat along the bottom.
registerMustache('mustache_lampshade', {
  pts: [[-0.01, 0.0], [0.06, 0.0], [0.11, -0.004], [0.155, -0.01]],
  radius: (t) => 0.032 - 0.012 * t,
  knot: 0.024, amount: 0.12, trimY: -0.02, hugX: 0.3,
  hair: { count: 900, seg: 8, thick: 0.0017, start: [0, 0.4], len: [0.4, 0.8], cover: [0.65, 1.0], twist: 0.15, frizz: 0.002, droop: 0.01 },
});

// Big, heavy, drooping well past the corners.
registerMustache('mustache_pancho', {
  pts: [[-0.02, 0.01], [0.07, 0.0], [0.14, -0.035], [0.19, -0.09], [0.215, -0.16], [0.22, -0.22]],
  radius: (t) => 0.02 + 0.05 * Math.pow(1 - t, 0.8),
  knot: 0.06, amount: 0.1, hangFrom: -0.12,
  hair: { count: 860, seg: 9, thick: 0.0021, start: [0, 0.35], len: [0.35, 0.95], cover: [0.6, 1.08], twist: 0.3, frizz: 0.007, droop: 0.02 },
});

// Ends roll up into tight double spirals.
const curlPts = [[-0.01, 0.0], [0.06, -0.008], [0.12, -0.016], [0.16, -0.019]];
for (let i = 0; i <= 16; i++) {
  const a = -Math.PI / 2 + (i / 16) * Math.PI * 4, rr = 0.038 * (1 - (i / 16) * 0.8);
  curlPts.push([0.19 + Math.cos(a) * rr, 0.02 + Math.sin(a) * rr]);
}
registerMustache('mustache_curly', {
  pts: curlPts,
  radius: (t) => 0.0025 + 0.025 * (1 - t),
  knot: 0.028, amount: 0.2, hugX: 0.3,
  hair: { count: 550, seg: 14, thick: 0.0015, start: [0, 0.15], len: [0.5, 1], cover: [0.72, 1.0], twist: 0.6, frizz: 0.001 },
});

/* -------------------------------------------------------------- ushanka */
registerAccessory('ushanka', ({ mats }, p) => {
  const g = new THREE.Group();
  const fur = mats.get('fur', { color: '#5e3f27', roughness: 1, sheen: 1, sheenRoughness: 0.6, sheenColor: '#b08a62' });
  const cloth = mats.get('hatCloth', { color: '#3d2a1c', roughness: 0.85, sheen: 0.6, sheenRoughness: 0.7, sheenColor: '#7a5a40' });
  const fo = { layers: p.furLayers ?? 8, length: p.furLength ?? 0.02 };

  // crown of the hat: cloth/leather dome with four seams and a button
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), cloth);
  cap.scale.set(0.25, 0.2, 0.21); cap.position.y = 0.06;
  g.add(cap);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const th = (i / 12) * (Math.PI / 2);
      pts.push(new THREE.Vector3(Math.cos(a) * Math.cos(th) * 0.252, 0.06 + Math.sin(th) * 0.202, Math.sin(a) * Math.cos(th) * 0.212));
    }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0025, 6), cloth));
  }
  const button = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 10), cloth);
  button.position.y = 0.262; button.scale.y = 0.6;
  g.add(button);

  // fur band all around + upturned front flap
  const rbox = (w, h, d, s, r) => rustRoundedBox(w, h, d, s, r) ?? new RoundedBoxGeometry(w, h, d, s, r);
  const band = furShells(rbox(0.56, 0.1, 0.47, 5, 0.045), fur, fo);
  band.position.y = 0.05;
  g.add(band);
  const flap = furShells(rbox(0.4, 0.17, 0.06, 5, 0.028), fur, fo);
  flap.position.set(0, 0.15, 0.22); flap.rotation.x = -0.25;
  g.add(flap);
  const star = enamelStar(mats, 0.04);
  star.position.set(0, 0.155, 0.262); star.rotation.x = -0.25;
  g.add(star);

  // ear flaps, hanging and swaying
  const ears = [];
  for (const s of [1, -1]) {
    const piv = new THREE.Group();
    piv.position.set(0.265 * s, 0.07, 0);
    const ear = furShells(rbox(0.06, 0.22, 0.2, 5, 0.028), fur, { ...fo, length: fo.length * 0.8 });
    ear.position.y = -0.1;
    piv.add(ear);
    piv.rotation.z = 0.12 * s;
    g.add(piv);
    ears.push({ piv, s, sp: new Spring(90, 5) });
  }
  g.userData.update = (st) => {
    for (const e of ears) {
      e.sp.target = st.headYawVel * 0.08 * e.s - st.lift * 3 * e.s + st.mouth * 0.15 * e.s;
      e.sp.step(st.dt);
      e.piv.rotation.z = 0.12 * e.s + e.sp.x;
    }
  };
  if (p.scale) g.scale.setScalar(p.scale);
  return g;
});

/* ----------------------------------------------------------- star badge */
registerAccessory('star_badge', ({ mats }, p) => enamelStar(mats, p.radius ?? 0.06));

/* -------------------------------------------------------- simple extras */
registerAccessory('bow_tie', ({ mats }, p) => {
  const g = new THREE.Group();
  const m = mats.get('bowTie', { color: p.color ?? '#7d0f1f', roughness: 0.7, sheen: 1, sheenRoughness: 0.4, sheenColor: '#d0505f' });
  for (const s of [1, -1]) {
    const w = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 20), m);
    w.rotation.z = (Math.PI / 2) * s; w.position.x = -0.06 * s; w.scale.z = 0.4;
    g.add(w);
  }
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), m));
  return g;
});
