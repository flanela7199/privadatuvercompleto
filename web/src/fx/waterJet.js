// Flush water FX (world space): bowl gurgle bubbles, a coherent ballistic water
// column, spray droplets with motion stretch, crown splashes on the floor, foam,
// ripple rings, drips from the rim and an irregular puddle that spreads and dries.
//
// Contract with the rig (set every frame): origin (bowl mouth, world), dir (up-forward),
// side (body x axis). Controls: emitting, rate (droplets/s), speed (column exit m/s),
// gurgle (0..1 bubbling in the bowl), drips (seconds of rim dripping left).
// Outputs for the rig: bowlRise (-0.2..1 water level), bowlSlosh (-1..1 small wobble).
import * as THREE from 'three';
import { tuneWater } from './waterLook.js';

const G = -9.8;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _d = new THREE.Vector3(), _t = new THREE.Vector3(), _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3();
const _v0 = new THREE.Vector3(), _fwd = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const rnd = (a, b) => a + Math.random() * (b - a);

/** Fixed-size particle pool backed by one InstancedMesh. */
class Pool {
  constructor(geo, mat, max, name) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.name = name;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.size = new Float32Array(max);
    this.kind = new Uint8Array(max);
    this.next = 0;
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, ZERO);
  }
  spawn(x, y, z, vx, vy, vz, life, size, kind) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    const o = i * 3;
    this.p[o] = x; this.p[o + 1] = y; this.p[o + 2] = z;
    this.v[o] = vx; this.v[o + 1] = vy; this.v[o + 2] = vz;
    this.life[i] = life; this.age[i] = 0; this.size[i] = size; this.kind[i] = kind;
    return i;
  }
  kill(i) { this.life[i] = 0; this.mesh.setMatrixAt(i, ZERO); }
}

const STREAM_SEG = 48, STREAM_RAD = 12;
const RIPPLES = 18;

export class WaterJet {
  constructor(material, max = 900) {
    this.group = new THREE.Group();
    this.group.name = 'fx_water';
    this.origin = new THREE.Vector3();   // bowl center (bubbles)
    this.mouth = new THREE.Vector3();    // spout: the gap between lid (upper lip) and seat (lower lip)
    this.mouthWidth = 0.13;
    this.dir = new THREE.Vector3(0, 1, 0);
    this.side = new THREE.Vector3(1, 0, 0);
    this.emitting = false;
    this.rate = 400;
    this.speed = 3.2;
    this.gurgle = 0;
    this.drips = 0;
    this.onSplash = null;
    this.bowlRise = 0;
    this.bowlSlosh = 0;
    this.levelOffset = -0.135;   // bowl water surface relative to origin (rig: waterY - mouth y)
    this.time = 0;
    this.speedNow = this.speed;
    this.acc = { spray: 0, mouth: 0, splash: 0, foam: 0, bubble: 0, drip: 0, ripple: 0 };
    this.drainT = 0;
    this.wasEmitting = false;

    // ---- materials (clones of the theme water, tuned per use: see waterLook.js; the bowl water is untouched)
    // spray / splashes / drips: bright white semi-opaque (no transmission) so the jet pops on any background
    const dropMat = tuneWater(material.clone(), 'spray');
    // the column: tinted semi-opaque water body with highlights (not glass)
    const streamMat = tuneWater(material.clone(), 'stream');
    streamMat.side = THREE.DoubleSide;
    streamMat.depthWrite = false;
    this.streamMat = streamMat;
    const foamMat = tuneWater(material.clone(), 'foam');
    foamMat.depthWrite = false;

    // ---- droplets (kind 0 = spray, 1 = secondary splash, 2 = rim drip)
    this.drops = new Pool(new THREE.SphereGeometry(0.03, 10, 8), dropMat, max, 'fx_water_drops');
    this.drops.mesh.castShadow = true;
    // ---- foam (kind 0 = mouth froth, 1 = bowl bubble, 2 = floor foam)
    this.foam = new Pool(new THREE.IcosahedronGeometry(0.03, 1), foamMat, 360, 'fx_water_foam');
    // kept for backwards compatibility (old code referenced jet.mesh)
    this.mesh = this.drops.mesh;

    // ---- continuous water column
    const nV = (STREAM_SEG + 1) * (STREAM_RAD + 1);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nV * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < STREAM_SEG; i++)
      for (let j = 0; j < STREAM_RAD; j++) {
        const a = i * (STREAM_RAD + 1) + j, b = a + STREAM_RAD + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    sg.setIndex(idx);
    this.stream = new THREE.Mesh(sg, streamMat);
    this.stream.name = 'fx_water_stream';
    this.stream.frustumCulled = false;
    this.stream.castShadow = true;
    this.stream.visible = false;
    this.streamOn = false;
    this.tFront = 0; this.tBack = 0; this.amt = 0;
    this.landing = new THREE.Vector3();
    this.landed = false;

    // ---- puddle with an irregular edge
    const pm = tuneWater(material.clone(), 'puddle');
    pm.opacity = 0; pm.depthWrite = false;
    pm.polygonOffset = true; pm.polygonOffsetFactor = -2; pm.polygonOffsetUnits = -2;
    const pg = new THREE.CircleGeometry(1, 120);
    pg.rotateX(-Math.PI / 2);
    this.puddleBase = Float32Array.from(pg.attributes.position.array);
    this.puddle = new THREE.Mesh(pg, pm);
    this.puddle.name = 'fx_puddle';
    this.puddle.position.y = 0.003;
    this.puddle.scale.setScalar(0.001);
    this.puddle.receiveShadow = true;
    this.vol = 0; this.wx = 0; this.wz = 0; this.wsum = 0; this.dry = 0;
    this.reshapePuddle();

    // ---- ripple rings
    this.ripples = [];
    const rg = new THREE.RingGeometry(0.86, 1, 64);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < RIPPLES; i++) {
      const r = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: '#e6f6ff', transparent: true, opacity: 0, depthWrite: false }));
      r.name = 'fx_ripple';
      r.position.y = 0.0045;
      r.visible = false;
      r.userData = { age: 0, life: 1, max: 0.3 };
      this.ripples.push(r);
    }
    this.nextRipple = 0;

    this.group.add(this.drops.mesh, this.foam.mesh, this.stream, this.puddle, ...this.ripples);
  }

  /* ------------------------------------------------------------- helpers */
  reshapePuddle() {
    const pos = this.puddle.geometry.attributes.position;
    const base = this.puddleBase;
    const f1 = rnd(0, 6.28), f2 = rnd(0, 6.28), f3 = rnd(0, 6.28), f4 = rnd(0, 6.28);
    for (let i = 1; i < pos.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      const a = Math.atan2(z, x);
      const r = 1 + 0.13 * Math.sin(3 * a + f1) + 0.08 * Math.sin(5 * a + f2) + 0.045 * Math.sin(9 * a + f3) + 0.025 * Math.sin(17 * a + f4);
      pos.setXYZ(i, x * r, 0, z * r);
    }
    pos.needsUpdate = true;
  }

  wet(x, z, amount) {
    if (this.vol <= 0.0001) { this.reshapePuddle(); this.wx = this.wz = this.wsum = 0; }
    this.vol += amount;
    this.wx += x * amount; this.wz += z * amount; this.wsum += amount;
    this.dry = 0;
  }

  ripple(x, z, maxR = 0.3, life = 1.1) {
    const r = this.ripples[this.nextRipple];
    this.nextRipple = (this.nextRipple + 1) % RIPPLES;
    r.position.x = x; r.position.z = z;
    r.userData.age = 0; r.userData.life = life; r.userData.max = maxR;
    r.visible = true;
  }

  groundTime(y0, vy) {
    const h = Math.max(0.01, y0 - 0.006);
    return (vy + Math.sqrt(vy * vy + 2 * -G * h)) / -G;
  }

  arcPoint(t, out) {
    return out.copy(this.mouth).addScaledVector(_v0, t).setY(this.mouth.y + _v0.y * t + 0.5 * G * t * t);
  }

  /* -------------------------------------------------------------- update */
  update(dt) {
    if (dt <= 0) return;
    this.time += dt;
    const A = this.acc;
    _fwd.set(this.dir.x, 0, this.dir.z);
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
    _fwd.normalize();

    // ---- bowl level: rises with the gurgle, full while spewing, drains after
    if (this.wasEmitting && !this.emitting) this.drainT = 1.4;
    this.wasEmitting = this.emitting;
    this.drainT = Math.max(0, this.drainT - dt);
    const target = this.emitting ? 1 : this.drainT > 0 ? -0.2 : this.gurgle * 0.55;
    this.bowlRise += (target - this.bowlRise) * Math.min(1, dt * 2.5);
    this.bowlSlosh = Math.sin(this.time * 11) * Math.min(1, this.gurgle * 0.6 + (this.emitting ? 0.4 : 0));
    const levelY = this.origin.y + this.levelOffset + this.bowlRise * 0.12;

    // ---- bubbles in the bowl
    if (this.gurgle > 0.01) {
      A.bubble += this.gurgle * 90 * dt;
      while (A.bubble >= 1) {
        A.bubble--;
        const rr = Math.sqrt(Math.random()) * 0.19, a = rnd(0, Math.PI * 2);
        const x = this.origin.x + this.side.x * Math.cos(a) * rr + _fwd.x * Math.sin(a) * rr * 1.2;
        const z = this.origin.z + this.side.z * Math.cos(a) * rr + _fwd.z * Math.sin(a) * rr * 1.2;
        this.foam.spawn(x, levelY - rnd(0.03, 0.08), z, 0, rnd(0.15, 0.3), 0, 1.2, rnd(0.25, 0.6), 1);
      }
    }

    this.updateStream(dt, A);

    // ---- mouth spray (wide, broken water right at the lid)
    if (this.emitting) {
      A.mouth += this.rate * 0.45 * dt;
      while (A.mouth >= 1) {
        A.mouth--;
        const j = rnd(-1, 1), sp = this.speedNow * rnd(0.65, 1.15);
        this.drops.spawn(
          this.mouth.x + this.side.x * j * this.mouthWidth, this.mouth.y + rnd(-0.01, 0.02), this.mouth.z + this.side.z * j * this.mouthWidth,
          this.dir.x * sp + this.side.x * j * 1.1 + rnd(-0.2, 0.2), this.dir.y * sp + rnd(-0.2, 0.6), this.dir.z * sp + this.side.z * j * 1.1 + rnd(-0.2, 0.2),
          2.5, rnd(0.45, 1.05), 0);
      }
      A.foam += 70 * dt;
      while (A.foam >= 1) {
        A.foam--;
        const j = rnd(-1, 1), sp = this.speedNow * rnd(0.2, 0.55);
        this.foam.spawn(
          this.mouth.x + this.side.x * j * this.mouthWidth * 0.8, this.mouth.y + 0.01, this.mouth.z + this.side.z * j * this.mouthWidth * 0.8,
          this.dir.x * sp + this.side.x * j * 0.5, this.dir.y * sp, this.dir.z * sp + this.side.z * j * 0.5,
          rnd(0.25, 0.45), rnd(0.5, 1.1), 0);
      }
    }

    // ---- drips from the front rim after the spew
    if (this.drips > 0) {
      this.drips -= dt;
      A.drip += 7 * dt;
      while (A.drip >= 1) {
        A.drip--;
        const j = rnd(-1, 1) * 0.25;
        this.drops.spawn(
          this.mouth.x + this.side.x * j, this.mouth.y - 0.005, this.mouth.z + this.side.z * j,
          0, -0.1, 0, 2, rnd(0.5, 0.7), 2);
      }
    }

    this.updateDrops(dt);
    this.updateFoam(dt, levelY);
    this.updateRipples(dt);
    this.updatePuddle(dt);
  }

  updateStream(dt, A) {
    this.speedNow += (this.speed - this.speedNow) * Math.min(1, dt * 6);
    _v0.copy(this.dir).normalize().multiplyScalar(this.speedNow);
    const T = this.groundTime(this.mouth.y, _v0.y);
    if (this.emitting) {
      if (!this.streamOn) { this.streamOn = true; this.tFront = 0; this.amt = 0; }
      this.tBack = 0;
      this.amt += (1 - this.amt) * Math.min(1, dt * 8);
    } else if (this.streamOn) {
      this.tBack += dt;                       // column detaches and falls along the arc
    }
    if (!this.streamOn) { this.stream.visible = false; this.landed = false; return; }
    this.tFront = Math.min(this.tFront + dt, T);
    if (this.tBack >= this.tFront - 1e-3) {
      this.streamOn = false; this.stream.visible = false; this.landed = false; this.amt = 0;
      return;
    }
    this.stream.visible = true;
    const t0 = this.tBack, t1 = this.tFront;
    this.landed = t1 >= T - 1e-4;
    const pos = this.stream.geometry.attributes.position.array;
    const uv = this.stream.geometry.attributes.uv.array;
    const time = this.time;
    for (let i = 0; i <= STREAM_SEG; i++) {
      const u = i / STREAM_SEG;
      const t = t0 + (t1 - t0) * u;
      this.arcPoint(t, _p);
      _t.set(_v0.x, _v0.y + G * t, _v0.z).normalize();
      _b1.copy(this.side).addScaledVector(_t, -this.side.dot(_t)).normalize();
      _b2.crossVectors(_t, _b1);
      let r = 0.036 * this.amt * (0.7 + 0.75 * (t / T));
      if (!this.landed) r *= Math.sqrt(Math.min(1, (t1 - t) / 0.06));
      if (t0 > 0) r *= Math.sqrt(Math.min(1, (t - t0) / 0.06));
      const wob = 1 + 0.16 * Math.sin(time * 31 - t * 60) + 0.08 * Math.sin(time * 17 + t * 23);
      for (let j = 0; j <= STREAM_RAD; j++) {
        const a = (j / STREAM_RAD) * Math.PI * 2;
        const rr = r * wob * (1 + 0.08 * Math.sin(3 * a + time * 13 + t * 30));
        const ca = Math.cos(a) * rr, sa = Math.sin(a) * rr;
        const k = (i * (STREAM_RAD + 1) + j);
        pos[k * 3] = _p.x + _b1.x * ca + _b2.x * sa;
        pos[k * 3 + 1] = _p.y + _b1.y * ca + _b2.y * sa;
        pos[k * 3 + 2] = _p.z + _b1.z * ca + _b2.z * sa;
        uv[k * 2] = j / STREAM_RAD;
        uv[k * 2 + 1] = t * 6 - time * 4;
      }
    }
    const g = this.stream.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    g.computeVertexNormals();

    // spray shed from the column surface
    if (this.emitting || t0 > 0) {
      A.spray += this.rate * 0.55 * dt * this.amt;
      while (A.spray >= 1) {
        A.spray--;
        const t = rnd(t0, t1);
        this.arcPoint(t, _p);
        const s = rnd(0.85, 1.05), sp = 0.45;
        this.drops.spawn(_p.x + rnd(-0.03, 0.03), _p.y + rnd(-0.03, 0.03), _p.z + rnd(-0.03, 0.03),
          _v0.x * s + rnd(-sp, sp), (_v0.y + G * t) * s + rnd(-sp, sp), _v0.z * s + rnd(-sp, sp),
          2.5, rnd(0.35, 0.9), 0);
      }
    }

    // column hitting the floor: crown splash, foam, ripples, puddle volume
    if (this.landed) {
      this.arcPoint(T, this.landing);
      const L = this.landing;
      const vin = _d.set(_v0.x, 0, _v0.z);
      A.splash += 170 * this.amt * dt;
      while (A.splash >= 1) {
        A.splash--;
        const a = rnd(0, Math.PI * 2), hs = rnd(0.35, 1.3);
        this.drops.spawn(L.x + Math.cos(a) * 0.03, 0.02, L.z + Math.sin(a) * 0.03,
          Math.cos(a) * hs + vin.x * 0.35, rnd(0.6, 1.7), Math.sin(a) * hs + vin.z * 0.35,
          1.2, rnd(0.3, 0.6), 1);
      }
      A.foam += 30 * this.amt * dt;
      while (A.foam >= 1) {
        A.foam--;
        const a = rnd(0, Math.PI * 2), rr = rnd(0, 0.08);
        this.foam.spawn(L.x + Math.cos(a) * rr, 0.01, L.z + Math.sin(a) * rr, Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2, rnd(0.5, 0.9), rnd(0.8, 1.6), 2);
      }
      A.ripple += dt;
      if (A.ripple > 0.09) { A.ripple = 0; this.ripple(L.x + rnd(-0.05, 0.05), L.z + rnd(-0.05, 0.05), rnd(0.25, 0.45), rnd(0.8, 1.3)); }
      this.wet(L.x, L.z, 2.5 * this.amt * dt);
    }
  }

  updateDrops(dt) {
    const P = this.drops, p = P.p, v = P.v;
    const drag = 1 - 0.15 * dt;
    for (let i = 0; i < P.max; i++) {
      if (P.life[i] <= 0) continue;
      const o = i * 3;
      P.age[i] += dt; P.life[i] -= dt;
      v[o + 1] += G * dt;
      v[o] *= drag; v[o + 1] *= drag; v[o + 2] *= drag;
      p[o] += v[o] * dt; p[o + 1] += v[o + 1] * dt; p[o + 2] += v[o + 2] * dt;
      if (p[o + 1] < 0.012) {
        const kind = P.kind[i], x = p[o], z = p[o + 2], sz = P.size[i];
        P.kill(i);
        if (kind === 0) {
          const n = 1 + (Math.random() * 3) | 0;   // little crown splash
          for (let k = 0; k < n; k++) {
            const a = rnd(0, Math.PI * 2), hs = rnd(0.25, 0.8);
            P.spawn(x, 0.015, z, Math.cos(a) * hs + v[o] * 0.2, rnd(0.4, 1.1), Math.sin(a) * hs + v[o + 2] * 0.2, 0.8, sz * rnd(0.35, 0.5), 1);
          }
          this.wet(x, z, 0.004);
          if (Math.random() < 0.05) this.ripple(x, z, rnd(0.08, 0.16), 0.7);
          this.onSplash?.();
        } else if (kind === 1) {
          this.wet(x, z, 0.001);
        } else {
          this.wet(x, z, 0.002);
          if (Math.random() < 0.6) this.ripple(x, z, rnd(0.06, 0.12), 0.8);
          this.onSplash?.();
        }
        continue;
      }
      if (P.life[i] <= 0) { P.kill(i); continue; }
      _p.set(p[o], p[o + 1], p[o + 2]);
      _d.set(v[o], v[o + 1], v[o + 2]);
      const speed = _d.length();
      if (speed > 1e-4) _q.setFromUnitVectors(UP, _d.multiplyScalar(1 / speed));
      else _q.identity();
      const sc = P.size[i] * Math.min(1, P.life[i] * 4) * Math.min(1, 0.4 + P.age[i] * 12);
      _s.set(sc, sc * (1 + speed * 0.22), sc);
      _m.compose(_p, _q, _s);
      P.mesh.setMatrixAt(i, _m);
    }
    P.mesh.instanceMatrix.needsUpdate = true;
  }

  updateFoam(dt, levelY) {
    const P = this.foam, p = P.p, v = P.v;
    _q.identity();
    for (let i = 0; i < P.max; i++) {
      if (P.life[i] <= 0) continue;
      const o = i * 3, kind = P.kind[i];
      P.age[i] += dt; P.life[i] -= dt;
      const age = P.age[i];
      let sc, flat = 1;
      if (kind === 1) {                 // bubble rising in the bowl, pops at the surface
        p[o] += Math.sin(age * 20 + i) * 0.002;
        p[o + 1] += v[o + 1] * dt;
        p[o + 2] += Math.cos(age * 17 + i) * 0.002;
        if (p[o + 1] >= levelY) {
          P.kill(i);
          if (Math.random() < 0.3) P.spawn(p[o], levelY, p[o + 2], rnd(-0.1, 0.1), rnd(0.2, 0.5), rnd(-0.1, 0.1), 0.2, P.size[i] * 0.6, 0);
          continue;
        }
        sc = P.size[i] * (0.5 + age * 0.8);
      } else if (kind === 0) {          // froth at the mouth: decelerates, grows, fades
        const k = 1 - Math.min(1, 4 * dt);
        v[o] *= k; v[o + 1] = v[o + 1] * k + G * 0.2 * dt; v[o + 2] *= k;
        p[o] += v[o] * dt; p[o + 1] += v[o + 1] * dt; p[o + 2] += v[o + 2] * dt;
        sc = P.size[i] * (0.6 + age * 1.5) * Math.min(1, P.life[i] * 5);
      } else {                          // floor foam: spreads, flattens, fades
        p[o] += v[o] * dt; p[o + 2] += v[o + 2] * dt;
        v[o] *= 1 - Math.min(1, 2 * dt); v[o + 2] *= 1 - Math.min(1, 2 * dt);
        sc = P.size[i] * (0.5 + age * 1.2) * Math.min(1, P.life[i] * 2);
        flat = 0.3;
      }
      if (P.life[i] <= 0) { P.kill(i); continue; }
      _p.set(p[o], p[o + 1], p[o + 2]);
      _s.set(sc, sc * flat, sc);
      _m.compose(_p, _q, _s);
      P.mesh.setMatrixAt(i, _m);
    }
    P.mesh.instanceMatrix.needsUpdate = true;
  }

  updateRipples(dt) {
    for (const r of this.ripples) {
      if (!r.visible) continue;
      const u = r.userData;
      u.age += dt;
      const k = u.age / u.life;
      if (k >= 1) { r.visible = false; continue; }
      const s = 0.02 + u.max * (1 - (1 - k) * (1 - k));
      r.scale.set(s, 1, s);
      r.material.opacity = 0.45 * (1 - k);
    }
  }

  updatePuddle(dt) {
    const pm = this.puddle.material;
    if (this.vol <= 0) return;
    this.dry += dt;
    const r = Math.min(0.9, 0.08 + Math.sqrt(this.vol) * 0.21);
    const cur = this.puddle.scale.x;
    const s = cur + (r - cur) * Math.min(1, dt * 3);
    this.puddle.scale.set(s, 1, s * 0.85);
    if (this.wsum > 0) {
      this.puddle.position.x += (this.wx / this.wsum - this.puddle.position.x) * Math.min(1, dt * 4);
      this.puddle.position.z += (this.wz / this.wsum - this.puddle.position.z) * Math.min(1, dt * 4);
    }
    if (this.dry < 3) pm.opacity = Math.min(Math.min(1, 0.7 * (pm.userData.opacityScale ?? 1)), pm.opacity + dt * 3);
    else {
      pm.opacity -= dt * 0.3;
      this.vol *= 1 - dt * 0.08;          // shrinks a little while drying
      if (pm.opacity <= 0) {
        pm.opacity = 0; this.vol = 0; this.wx = this.wz = this.wsum = 0;
        this.puddle.scale.setScalar(0.001);
      }
    }
  }
}
