// Mesh utilities for the CK3 export: weld, quadric-error edge-collapse decimation
// (Garland & Heckbert, positions only, boundary-preserving, flip + link-condition checks)
// and crease-angle normals. Plain arrays in, plain arrays out; no three.js dependency.

/** Merge vertices closer than eps. pos: Float64Array|number[] (3n), idx: number[] (3m). */
export function weld(pos, idx, eps = 1e-5) {
  const map = new Map(), remap = new Int32Array(pos.length / 3), out = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${Math.round(pos[3 * i] / eps)},${Math.round(pos[3 * i + 1] / eps)},${Math.round(pos[3 * i + 2] / eps)}`;
    let j = map.get(k);
    if (j === undefined) { j = out.length / 3; map.set(k, j); out.push(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]); }
    remap[i] = j;
  }
  const tri = [];
  for (let f = 0; f < idx.length; f += 3) {
    const a = remap[idx[f]], b = remap[idx[f + 1]], c = remap[idx[f + 2]];
    if (a !== b && b !== c && a !== c) tri.push(a, b, c);
  }
  return { pos: out, idx: tri };
}

const sub = (p, a, b) => [p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const len = (u) => Math.hypot(u[0], u[1], u[2]);

// symmetric 4x4 quadric as 10 floats: a2 ab ac ad b2 bc bd c2 cd d2
function planeQ(n, d, w) {
  const [a, b, c] = n;
  return [a * a * w, a * b * w, a * c * w, a * d * w, b * b * w, b * c * w, b * d * w, c * c * w, c * d * w, d * d * w];
}
function addQ(Q, o, q) { for (let k = 0; k < 10; k++) Q[o + k] += q[k]; }

class Heap {
  constructor() { this.c = []; this.e = []; }
  get size() { return this.c.length; }
  push(cost, entry) {
    const c = this.c, e = this.e; let i = c.length; c.push(cost); e.push(entry);
    while (i > 0) { const p = (i - 1) >> 1; if (c[p] <= c[i]) break; [c[p], c[i]] = [c[i], c[p]]; [e[p], e[i]] = [e[i], e[p]]; i = p; }
  }
  pop() {
    const c = this.c, e = this.e, top = e[0], tc = c[0], lc = c.pop(), le = e.pop();
    if (c.length) {
      c[0] = lc; e[0] = le; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < c.length && c[l] < c[m]) m = l;
        if (r < c.length && c[r] < c[m]) m = r;
        if (m === i) break;
        [c[m], c[i]] = [c[i], c[m]]; [e[m], e[i]] = [e[i], e[m]]; i = m;
      }
    }
    return [tc, top];
  }
}

/**
 * Decimate an indexed triangle mesh to about `target` triangles.
 * Returns { pos, idx } (compacted). Boundaries are weighted heavily so open edges stay in place.
 */
export function decimate(pos0, idx0, target, { boundaryWeight = 200 } = {}) {
  const { pos: P, idx: I } = weld(pos0, idx0);
  const nv = P.length / 3, nf = I.length / 3;
  if (nf <= target) return { pos: P, idx: I };
  const pos = Float64Array.from(P), F = Int32Array.from(I);
  const fAlive = new Uint8Array(nf).fill(1), vAlive = new Uint8Array(nv).fill(1), ver = new Uint32Array(nv);
  const vf = Array.from({ length: nv }, () => new Set());
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) vf[F[3 * f + k]].add(f);
  const Q = new Float64Array(nv * 10);
  const fn = (f) => { const a = F[3 * f], b = F[3 * f + 1], c = F[3 * f + 2]; return cross(sub(pos, b, a), sub(pos, c, a)); };
  const edgeFaces = new Map();
  const ek = (a, b) => (a < b ? a * nv + b : b * nv + a);
  for (let f = 0; f < nf; f++) {
    const n = fn(f), l = len(n); if (l < 1e-20) continue;
    const u = [n[0] / l, n[1] / l, n[2] / l], a = F[3 * f];
    const q = planeQ(u, -dot(u, [pos[3 * a], pos[3 * a + 1], pos[3 * a + 2]]), l / 2);
    for (let k = 0; k < 3; k++) {
      addQ(Q, 10 * F[3 * f + k], q);
      const e = ek(F[3 * f + k], F[3 * f + (k + 1) % 3]);
      edgeFaces.set(e, (edgeFaces.get(e) || 0) + 1);
    }
  }
  // boundary constraint planes (perpendicular to the face, through the open edge)
  for (let f = 0; f < nf; f++) {
    const n = fn(f), l = len(n); if (l < 1e-20) continue;
    for (let k = 0; k < 3; k++) {
      const a = F[3 * f + k], b = F[3 * f + (k + 1) % 3];
      if (edgeFaces.get(ek(a, b)) !== 1) continue;
      const e = sub(pos, b, a), el = len(e);
      const bn = cross(e, n), bl = len(bn); if (bl < 1e-20) continue;
      const u = [bn[0] / bl, bn[1] / bl, bn[2] / bl];
      const q = planeQ(u, -dot(u, [pos[3 * a], pos[3 * a + 1], pos[3 * a + 2]]), boundaryWeight * el * el);
      addQ(Q, 10 * a, q); addQ(Q, 10 * b, q);
    }
  }
  const isBoundaryV = new Uint8Array(nv);
  for (const [e, c] of edgeFaces) if (c === 1) { isBoundaryV[Math.floor(e / nv)] = 1; isBoundaryV[e % nv] = 1; }

  const opt = (a, b) => {
    const S = new Float64Array(10); for (let k = 0; k < 10; k++) S[k] = Q[10 * a + k] + Q[10 * b + k];
    // solve [a2 ab ac; ab b2 bc; ac bc c2] x = -[ad bd cd]
    const m = [[S[0], S[1], S[2]], [S[1], S[4], S[5]], [S[2], S[5], S[7]]], r = [-S[3], -S[6], -S[8]];
    const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const cands = [];
    const scale = Math.abs(S[0]) + Math.abs(S[4]) + Math.abs(S[7]);
    if (Math.abs(det) > 1e-9 * scale * scale * scale && scale > 0) {
      const D = (c0, c1, c2) => c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) - c1[0] * (c0[1] * c2[2] - c0[2] * c2[1]) + c2[0] * (c0[1] * c1[2] - c0[2] * c1[1]);
      const col = (j) => [m[0][j], m[1][j], m[2][j]];
      const x = D(r, col(1), col(2)) / det, y = D(col(0), r, col(2)) / det, z = D(col(0), col(1), r) / det;
      // keep the optimum near the edge (avoid spikes on nearly flat regions)
      const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2], bx = pos[3 * b], by = pos[3 * b + 1], bz = pos[3 * b + 2];
      const el = Math.hypot(bx - ax, by - ay, bz - az), mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      if (Math.hypot(x - mx, y - my, z - mz) < el) cands.push([x, y, z]);
    }
    cands.push([pos[3 * a], pos[3 * a + 1], pos[3 * a + 2]], [pos[3 * b], pos[3 * b + 1], pos[3 * b + 2]],
      [(pos[3 * a] + pos[3 * b]) / 2, (pos[3 * a + 1] + pos[3 * b + 1]) / 2, (pos[3 * a + 2] + pos[3 * b + 2]) / 2]);
    let best = null, bc = Infinity;
    for (const c of cands) {
      const cost = S[0] * c[0] * c[0] + 2 * S[1] * c[0] * c[1] + 2 * S[2] * c[0] * c[2] + 2 * S[3] * c[0]
        + S[4] * c[1] * c[1] + 2 * S[5] * c[1] * c[2] + 2 * S[6] * c[1] + S[7] * c[2] * c[2] + 2 * S[8] * c[2] + S[9];
      if (cost < bc) { bc = cost; best = c; }
    }
    return [Math.max(0, bc), best];
  };
  const heap = new Heap();
  const pushEdge = (a, b) => { const [c, p] = opt(a, b); heap.push(c, [a, b, ver[a], ver[b], p]); };
  for (const e of edgeFaces.keys()) pushEdge(Math.floor(e / nv), e % nv);

  const neighbors = (v) => { const s = new Set(); for (const f of vf[v]) for (let k = 0; k < 3; k++) { const w = F[3 * f + k]; if (w !== v) s.add(w); } return s; };
  let faces = nf;
  while (faces > target && heap.size) {
    const [, [a, b, va, vb, p0]] = heap.pop();
    let p = p0;
    if (!vAlive[a] || !vAlive[b] || ver[a] !== va || ver[b] !== vb) continue;
    const shared = [...vf[a]].filter((f) => vf[b].has(f));
    if (!shared.length) continue;
    // link condition: common neighbours must be exactly the opposite vertices of the shared faces
    const na = neighbors(a), nb = neighbors(b);
    let common = 0; for (const w of na) if (nb.has(w)) common++;
    if (common !== shared.length) continue;
    // a boundary vertex may only move along the boundary: don't collapse boundary into interior
    if (isBoundaryV[a] !== isBoundaryV[b] && edgeFaces.get(ek(a, b)) !== 1) {
      // collapse onto the boundary vertex position
      const bv = isBoundaryV[a] ? a : b; p = [pos[3 * bv], pos[3 * bv + 1], pos[3 * bv + 2]];
    }
    // flip check
    let ok = true;
    for (const v of [a, b]) {
      for (const f of vf[v]) {
        if (shared.includes(f)) continue;
        const n0 = fn(f);
        const save = [pos[3 * a], pos[3 * a + 1], pos[3 * a + 2], pos[3 * b], pos[3 * b + 1], pos[3 * b + 2]];
        pos[3 * a] = p[0]; pos[3 * a + 1] = p[1]; pos[3 * a + 2] = p[2];
        pos[3 * b] = p[0]; pos[3 * b + 1] = p[1]; pos[3 * b + 2] = p[2];
        const n1 = fn(f);
        pos[3 * a] = save[0]; pos[3 * a + 1] = save[1]; pos[3 * a + 2] = save[2];
        pos[3 * b] = save[3]; pos[3 * b + 1] = save[4]; pos[3 * b + 2] = save[5];
        const l0 = len(n0), l1 = len(n1);
        if (l1 < 1e-14 || dot(n0, n1) < 0.2 * l0 * l1) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    // collapse b -> a
    for (const f of shared) { fAlive[f] = 0; faces--; for (let k = 0; k < 3; k++) vf[F[3 * f + k]].delete(f); }
    for (const f of vf[b]) { for (let k = 0; k < 3; k++) if (F[3 * f + k] === b) F[3 * f + k] = a; vf[a].add(f); }
    vf[b].clear(); vAlive[b] = 0;
    pos[3 * a] = p[0]; pos[3 * a + 1] = p[1]; pos[3 * a + 2] = p[2];
    for (let k = 0; k < 10; k++) Q[10 * a + k] += Q[10 * b + k];
    isBoundaryV[a] = isBoundaryV[a] | isBoundaryV[b];
    ver[a]++;
    for (const w of neighbors(a)) pushEdge(a, w);
  }
  // compact
  const remap = new Int32Array(nv).fill(-1), out = [], tri = [];
  for (let f = 0; f < nf; f++) {
    if (!fAlive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = F[3 * f + k];
      if (remap[v] < 0) { remap[v] = out.length / 3; out.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); }
      tri.push(remap[v]);
    }
  }
  return { pos: out, idx: tri };
}

/**
 * Split vertices along creases and compute area-weighted smooth normals within each smoothing group.
 * Returns { pos, nrm, idx, src } where src[i] = welded source vertex of output vertex i.
 */
export function creaseNormals(pos, idx, creaseDeg = 50) {
  const cosT = Math.cos((creaseDeg * Math.PI) / 180), nf = idx.length / 3;
  const fN = new Float64Array(nf * 3), fU = new Float64Array(nf * 3);
  const vf = Array.from({ length: pos.length / 3 }, () => []);
  for (let f = 0; f < nf; f++) {
    const a = idx[3 * f], b = idx[3 * f + 1], c = idx[3 * f + 2];
    const n = cross(sub(pos, b, a), sub(pos, c, a)), l = len(n) || 1;
    fN.set(n, 3 * f); fU.set([n[0] / l, n[1] / l, n[2] / l], 3 * f);
    vf[a].push(f); vf[b].push(f); vf[c].push(f);
  }
  const outP = [], outN = [], outI = new Array(idx.length), src = [], keyMap = new Map();
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const v = idx[3 * f + k];
      let nx = 0, ny = 0, nz = 0;
      for (const g of vf[v]) {
        if (fU[3 * f] * fU[3 * g] + fU[3 * f + 1] * fU[3 * g + 1] + fU[3 * f + 2] * fU[3 * g + 2] >= cosT) {
          nx += fN[3 * g]; ny += fN[3 * g + 1]; nz += fN[3 * g + 2];
        }
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const key = `${v}|${Math.round(nx * 1000)}|${Math.round(ny * 1000)}|${Math.round(nz * 1000)}`;
      let o = keyMap.get(key);
      if (o === undefined) {
        o = outP.length / 3; keyMap.set(key, o);
        outP.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); outN.push(nx, ny, nz); src.push(v);
      }
      outI[3 * f + k] = o;
    }
  }
  return { pos: outP, nrm: outN, idx: outI, src };
}
