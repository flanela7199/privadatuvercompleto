// Toilet-paper strip: verlet chain pinned to the roll, rendered as a twisting ribbon.
// - paper is cut into sheets: a perforation every SHEET segments (dashed line drawn on it)
// - bending stiffness (paper is not rope), softer at perforations so it folds there
// - turbulent flutter + twist while the wind blows, crumpled pile on the floor
// - tearInto(torn) tears AT the first perforation below the roll; the piece tumbles off
// - rollRadiusScale shrinks as paper is used (rig scales the roll radius with it)
import * as THREE from 'three';

export const SEG = 0.025;
export const SHEET = 4;              // segments per sheet -> 10 cm sheets
const _t = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
const _a = new THREE.Vector3();

const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export class PaperStrip {
  constructor(material, width = 0.19, maxPts = 150) {
    this.width = width;
    this.maxPts = maxPts;
    this.pts = [];         // {p:Vector3, q:Vector3 (previous), id:int, tw:twist}
    this.anchored = true;
    this.anchor = new THREE.Vector3();
    this.widthDir = new THREE.Vector3(0, 0, 1);
    this.emitDir = new THREE.Vector3(0, -1, 0);
    this.targetLen = 0.24;
    this.feedSpeed = 0.6;  // m/s while regrowing to target
    this.fed = 0;
    this.wind = new THREE.Vector3();
    this.time = 0;
    this.fade = 1;
    this.serial = 0;
    this.totalFed = 0;
    this.rollRadiusScale = 1;
    this.cells = new Map();

    const n = maxPts * 2;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < maxPts - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.mat = material.clone();
    this.mat.side = THREE.DoubleSide;
    this.mat.transparent = true;
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'fx_paper';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;

    // perforation lines (2 offset dashed segments per perforation, one per paper side)
    const maxPerf = Math.ceil(maxPts / SHEET) + 2;
    this.perfGeo = new THREE.BufferGeometry();
    this.perfGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPerf * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.perfMat = new THREE.LineDashedMaterial({ color: '#b9b2a2', dashSize: 0.006, gapSize: 0.005, transparent: true });
    this.perf = new THREE.LineSegments(this.perfGeo, this.perfMat);
    this.perf.name = 'fx_paper_perforations';
    this.perf.frustumCulled = false;
    this.mesh.add(this.perf);   // mesh sits at identity in world/root space
  }

  newPoint(p, q) { return { p, q, id: this.serial++, tw: 0 }; }

  reset(anchor) {
    this.pts = [this.newPoint(anchor.clone(), anchor.clone())];
    this.fed = 0;
  }

  /** Copy all points (used by the rig when cloning into a torn piece). */
  copyFrom(other) {
    this.pts = other.pts.map((o) => ({ p: o.p.clone(), q: o.q.clone(), id: o.id, tw: o.tw }));
    this.widthDir.copy(other.widthDir);
  }

  /** Start a fresh full roll (rollRadiusScale back to 1). */
  newRoll() { this.totalFed = 0; this.rollRadiusScale = 1; }

  length() { return Math.max(0, this.pts.length - 1) * SEG; }

  isPerf(i) { return this.pts[i] && this.pts[i].id % SHEET === 0; }

  /**
   * Tear at the first perforation at least ~6 cm below the roll: points beyond it go
   * into `torn` (which tumbles away and fades), the stub stays hanging. Returns false
   * if the strip is too short to tear.
   */
  tearInto(torn) {
    const n = this.pts.length;
    let k = -1;
    for (let i = 2; i < n - 2; i++) if (this.isPerf(i) && i * SEG >= 0.06) { k = i; break; }
    if (k < 0) return false;
    torn.pts = this.pts.slice(k).map((o) => ({ p: o.p.clone(), q: o.q.clone(), id: o.id, tw: o.tw }));
    torn.widthDir.copy(this.widthDir);
    torn.anchored = false;
    torn.fade = 1;
    torn.time = 0;
    // tumble: spin around the width axis + a little push away from the roll
    _c.set(0, 0, 0);
    for (const o of torn.pts) _c.add(o.p);
    _c.multiplyScalar(1 / torn.pts.length);
    const w = 2.2 / 60;
    for (const o of torn.pts) {
      _a.subVectors(o.p, _c);
      _t.crossVectors(this.widthDir, _a).multiplyScalar(w);
      _t.addScaledVector(this.emitDir, -0.01);
      if (o.p.y > 0.03) o.q.copy(o.p).sub(_t);
    }
    this.pts.length = k + 1;
    this.fed = 0;
    return true;
  }

  update(dt) {
    this.time += dt;
    const pts = this.pts;
    if (!pts.length) { this.geo.setDrawRange(0, 0); this.perfGeo.setDrawRange(0, 0); return; }
    if (dt <= 0) return;
    if (this.anchored) {
      // feed new paper out of the roll
      if (this.length() < this.targetLen && pts.length < this.maxPts) {
        this.fed += this.feedSpeed * dt;
        while (this.fed >= SEG && pts.length < this.maxPts) {
          this.fed -= SEG;
          const p = this.anchor.clone().addScaledVector(this.emitDir, 0.002);
          const q = p.clone().addScaledVector(this.emitDir, -this.feedSpeed * dt);
          pts.splice(1, 0, this.newPoint(p, q));
          this.totalFed += SEG;
        }
        this.rollRadiusScale = Math.max(0.55, 1 - this.totalFed * 0.02);
      }
      pts[0].p.copy(this.anchor); pts[0].q.copy(this.anchor);
    }

    // ---- verlet integrate with wind turbulence
    const n = pts.length;
    const windAmt = Math.min(1, this.wind.length() / 30);
    const free = !this.anchored;
    const damp = free ? 0.955 : 0.985;    // a loose sheet falls slowly, like paper
    const g = -9.8 * dt * dt * (free ? 0.75 : 1);
    const t = this.time;
    for (let i = this.anchored ? 1 : 0; i < n; i++) {
      const { p, q } = pts[i];
      const vx = (p.x - q.x) * damp, vy = (p.y - q.y) * damp, vz = (p.z - q.z) * damp;
      q.copy(p);
      const w = i / n;
      const turb = windAmt * 14 * w + (free && p.y > 0.03 ? 3 : 0);
      const fx = this.wind.x * w + turb * Math.sin(t * 7.1 + i * 0.53 + 1.3);
      const fy = this.wind.y * w + turb * Math.sin(t * 5.3 + i * 0.71) * 0.8;
      const fz = this.wind.z * w + turb * Math.sin(t * 6.7 + i * 0.41 + 2.1) * 0.6;
      p.x += vx + fx * dt * dt;
      p.y += vy + g + fy * dt * dt;
      p.z += vz + fz * dt * dt;
    }

    // ---- constraints: length, bending stiffness, floor pile
    const cells = this.cells;
    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < n - 1; i++) {
        const a = pts[i].p, b = pts[i + 1].p;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = (d - SEG) / d;
        const pinned = this.anchored && i === 0;
        const ka = pinned ? 0 : 0.5, kb = pinned ? 1 : 0.5;
        a.x += dx * diff * ka; a.y += dy * diff * ka; a.z += dz * diff * ka;
        b.x -= dx * diff * kb; b.y -= dy * diff * kb; b.z -= dz * diff * kb;
      }
      // bending: keep i and i+2 apart (paper resists folding, except at perforations)
      for (let i = 0; i < n - 2; i++) {
        const a = pts[i].p, c = pts[i + 2].p;
        const minD = (this.isPerf(i + 1) ? 0.55 : 1.5) * SEG;
        const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        if (d >= minD) continue;
        const diff = ((d - minD) / d) * 0.5;
        const pinned = this.anchored && i === 0;
        const ka = pinned ? 0 : 0.5, kc = pinned ? 1 : 0.5;
        a.x += dx * diff * ka; a.y += dy * diff * ka; a.z += dz * diff * ka;
        c.x -= dx * diff * kc; c.y -= dy * diff * kc; c.z -= dz * diff * kc;
      }
      // floor with a growing pile: each paper point in a 4.5 cm cell sits on the ones below
      cells.clear();
      for (let i = n - 1; i >= 0; i--) {
        if (this.anchored && i === 0) continue;
        const { p, q } = pts[i];
        if (p.y > 0.12) continue;
        const key = ((Math.floor(p.x / 0.045) + 2048) << 12) | (Math.floor(p.z / 0.045) + 2048);
        const c = cells.get(key) || 0;
        cells.set(key, c + 1);
        const fl = 0.004 + Math.min(c, 12) * 0.0065;
        if (p.y < fl) {
          p.y = fl; q.y = Math.min(q.y, p.y + 0.0005);
          q.x = p.x * 0.55 + q.x * 0.45; q.z = p.z * 0.55 + q.z * 0.45;   // friction
        }
      }
    }

    // ---- twist: flutter in the wind, crumple on the floor
    for (let i = 0; i < n; i++) {
      const o = pts[i];
      let target;
      if (o.p.y < 0.09) target = (hash(o.id) - 0.5) * 1.1;
      else if (free) target = Math.sin(t * 3 + i * 0.2) * 0.45;
      else target = windAmt * (0.35 * Math.sin(t * 4.3 + i * 0.37) + 0.15 * Math.sin(t * 1.7 + i * 0.11)) * (i / n);
      o.tw += (target - o.tw) * Math.min(1, dt * 6);
    }

    // ---- write ribbon + perforation lines
    const pos = this.geo.attributes.position.array;
    const uv = this.geo.attributes.uv.array;
    const perf = this.perfGeo.attributes.position.array;
    let np = 0;
    const hw = this.width / 2, wd = this.widthDir;
    for (let i = 0; i < n; i++) {
      const o = pts[i], p = o.p;
      const pa = pts[Math.max(0, i - 1)].p, pb = pts[Math.min(n - 1, i + 1)].p;
      _t.subVectors(pb, pa);
      if (_t.lengthSq() < 1e-10) _t.copy(this.emitDir);
      _t.normalize();
      _w.copy(wd).addScaledVector(_t, -wd.dot(_t));
      if (_w.lengthSq() < 1e-8) _w.copy(wd);
      _w.normalize();
      // rotate the width axis around the tangent by the twist angle (Rodrigues, w ⟂ t)
      const cs = Math.cos(o.tw), sn = Math.sin(o.tw);
      _n.crossVectors(_t, _w);
      _w.multiplyScalar(cs).addScaledVector(_n, sn);
      _n.crossVectors(_t, _w);
      pos[i * 6] = p.x - _w.x * hw; pos[i * 6 + 1] = p.y - _w.y * hw; pos[i * 6 + 2] = p.z - _w.z * hw;
      pos[i * 6 + 3] = p.x + _w.x * hw; pos[i * 6 + 4] = p.y + _w.y * hw; pos[i * 6 + 5] = p.z + _w.z * hw;
      const v = o.id * 0.12;              // texture travels with the paper
      uv[i * 4] = 0; uv[i * 4 + 1] = v; uv[i * 4 + 2] = 1; uv[i * 4 + 3] = v;
      if (i > 0 && o.id % SHEET === 0) {
        for (const off of [0.0012, -0.0012]) {
          const k = np * 6;
          perf[k] = p.x - _w.x * hw * 0.98 + _n.x * off;
          perf[k + 1] = p.y - _w.y * hw * 0.98 + _n.y * off;
          perf[k + 2] = p.z - _w.z * hw * 0.98 + _n.z * off;
          perf[k + 3] = p.x + _w.x * hw * 0.98 + _n.x * off;
          perf[k + 4] = p.y + _w.y * hw * 0.98 + _n.y * off;
          perf[k + 5] = p.z + _w.z * hw * 0.98 + _n.z * off;
          np++;
        }
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    this.geo.computeVertexNormals();
    this.perfGeo.attributes.position.needsUpdate = true;
    this.perfGeo.setDrawRange(0, np * 2);
    if (np) this.perf.computeLineDistances();
    const op = this.anchored ? this.fade : Math.min(1, Math.max(0, this.fade * 2.5));
    this.mat.opacity = op;
    this.perfMat.opacity = op * 0.9;
  }
}
