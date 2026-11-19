// The tank (head) as a soft "pillow": a rounded box (corner radius r) that is slightly tapered
// toward the bottom and whose faces bulge outward. Mirror of privada_core::dim::TankShape: the
// mesh and every attachment (eyes, handle, paper holder, sockets) use the same surface math.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** top/bottom faces bulge less than the sides (fraction of `bulge`) */
export const TANK_BULGE_Y = 0.4;

/**
 * Tank shape in tank-local coordinates (origin = tank centre).
 * @param {{w:number,h:number,d:number}} T tank size; opts: round (m), bulge (m), taper (bottom width factor)
 */
export function tankShape(T, { round = 0.11, bulge = 0.025, taper = 0.9 } = {}) {
  const hx = T.w / 2, hy = T.h / 2, hz = T.d / 2;
  const r = Math.max(0.005, Math.min(round, Math.min(hx, hy, hz) - 0.005));
  const H = [hx, hy, hz];
  /** taper (x fully, z half) + face bulge; p = [x, y, z] on the rounded box */
  const deform = (p) => {
    const ty = clamp((p[1] + hy) / (2 * hy), 0, 1), s = taper + (1 - taper) * ty, sz = (1 + s) / 2;
    const ux = clamp(p[0] / hx, -1, 1), uy = clamp(p[1] / hy, -1, 1), uz = clamp(p[2] / hz, -1, 1);
    return [
      p[0] * s + bulge * ux * (1 - uy * uy) * (1 - uz * uz),
      p[1] + bulge * TANK_BULGE_Y * uy * (1 - ux * ux) * (1 - uz * uz),
      p[2] * sz + bulge * uz * (1 - ux * ux) * (1 - uy * uy),
    ];
  };
  const _m = new THREE.Matrix3(), _n = new THREE.Vector3();
  /** normal after the deformation: J^-T n (numeric Jacobian) */
  const deformNormal = (p, n) => {
    const e = 1e-4, c = [];
    for (let k = 0; k < 3; k++) {
      const a = p.slice(), b = p.slice();
      a[k] += e; b[k] -= e;
      const da = deform(a), db = deform(b);
      c.push([(da[0] - db[0]) / (2 * e), (da[1] - db[1]) / (2 * e), (da[2] - db[2]) / (2 * e)]);
    }
    _m.set(c[0][0], c[1][0], c[2][0], c[0][1], c[1][1], c[2][1], c[0][2], c[1][2], c[2][2]).invert().transpose();
    return _n.set(n[0], n[1], n[2]).applyMatrix3(_m).normalize().toArray();
  };
  /** box-surface point q -> rounded-box point + normal */
  const rounded = (q) => {
    const c = q.map((v, k) => clamp(v, -(H[k] - r), H[k] - r));
    let d = q.map((v, k) => v - c[k]);
    let l = Math.hypot(...d);
    if (l < 1e-9) {                       // flat-face centre: the dominant axis
      const k = [0, 1, 2].reduce((a, b) => (Math.abs(q[b] / H[b]) > Math.abs(q[a] / H[a]) ? b : a), 0);
      d = [0, 0, 0]; d[k] = Math.sign(q[k]) || 1; l = 1;
    }
    const n = d.map((v) => v / l);
    return { p: c.map((v, k) => v + n[k] * r), n };
  };
  /** box-surface point q -> pillow surface point + normal (tank-local) */
  const surface = (q) => {
    const { p, n } = rounded(q);
    return { p: deform(p), n: deformNormal(p, n) };
  };
  return {
    hx, hy, hz, r, bulge, taper, deform, surface,
    front: (x, y) => surface([x, y, hz]),
    back: (x, y) => surface([x, y, -hz]),
    side: (sx, y, z) => surface([sx * hx, y, z]),
    top: (x, z) => surface([x, hy, z]),
    /** extents of the deformed shape */
    frontMax: hz + bulge, topMax: hy + bulge * TANK_BULGE_Y, halfW: hx + bulge,
  };
}

/** Pillow mesh: 6 subdivided faces (dense in the rounded bands), analytic smooth normals. */
export function pillowGeometry(S, nFlat = 12, nRound = 6) {
  const H = [S.hx, S.hy, S.hz];
  const samples = (h) => {
    const a = [], f = h - S.r;
    for (let i = 0; i < nRound; i++) a.push(-h + (S.r * i) / nRound);
    for (let i = 0; i < nFlat; i++) a.push(-f + (2 * f * i) / nFlat);
    for (let i = 0; i <= nRound; i++) a.push(f + (S.r * i) / nRound);
    return a;
  };
  const pos = [], nrm = [], uv = [], idx = [];
  for (const k of [0, 1, 2]) for (const sg of [1, -1]) {
    const u = (k + 1) % 3, v = (k + 2) % 3;
    const A = samples(H[u]), B = samples(H[v]);
    const base = pos.length / 3;
    for (const b of B) for (const a of A) {
      const q = [0, 0, 0]; q[k] = sg * H[k]; q[u] = a; q[v] = b;
      const { p, n } = S.surface(q);
      pos.push(...p); nrm.push(...n);
      uv.push((a + H[u]) / (2 * H[u]), (b + H[v]) / (2 * H[v]));
    }
    const na = A.length;
    // u x v points along +k, so flip the winding on the -k face
    for (let j = 0; j < B.length - 1; j++) for (let i = 0; i < na - 1; i++) {
      const p0 = base + j * na + i, p1 = p0 + 1, p2 = p0 + na, p3 = p2 + 1;
      if (sg > 0) idx.push(p0, p1, p3, p0, p3, p2); else idx.push(p0, p3, p1, p0, p2, p3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
