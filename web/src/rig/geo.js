// Geometry helpers shared by the rig and accessories.
import * as THREE from 'three';

/** Tube along a Catmull-Rom curve whose radius varies with t in [0,1]. */
export function taperedTube(points, radiusFn, tubular = 64, radial = 12) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const P = curve.getPointAt(t);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = radiusFn(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), s = -Math.sin(a);
      const nx = c * N.x + s * B.x, ny = c * N.y + s * B.y, nz = c * N.z + s * B.z;
      nor.push(nx, ny, nz);
      pos.push(P.x + r * nx, P.y + r * ny, P.z + r * nz);
      uv.push(t, j / radial);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function ellipseShape(rx, ry, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  s.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, false, 0);
  return s;
}

export function ellipsePath(rx, ry, cx = 0, cy = 0) {
  const p = new THREE.Path();
  p.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, true, 0);
  return p;
}

/** Flat oval slab lying in XZ (extruded upward along +Y from y=0). */
export function ovalSlab(rx, rz, depth, bevel = 0.01, hole = null) {
  const shape = ellipseShape(rx, rz);
  if (hole) shape.holes.push(ellipsePath(hole.rx, hole.rz, 0, hole.cz ?? 0));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 4, curveSegments: 64,
  });
  g.rotateX(-Math.PI / 2); // shape XY -> XZ, extrusion along +Y
  return g;
}

export function starShape(rOuter, rInner, points = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? rInner : rOuter;
    const a = Math.PI / 2 + (i * Math.PI) / points;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  s.closePath();
  return s;
}

/** Spiral texture used for the bowl water (rotated during the flush). */
export function swirlTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  grd.addColorStop(0, '#1f6fa8');
  grd.addColorStop(1, '#c8eeff');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 7;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      const a = (k * Math.PI) / 2 + t * Math.PI * 3;
      const x = 128 + Math.cos(a) * t * 128, y = 128 + Math.sin(a) * t * 128;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.center.set(0.5, 0.5);
  return tex;
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------ real-toilet shapes */
// "Egg" oval: narrower at the front (+z) like an elongated toilet bowl.
// k = how much narrower the front is (0 = plain ellipse).
export function eggPoint(theta, rx, rz, k = 0.1) {
  const s = Math.sin(theta);
  return [rx * Math.cos(theta) * (1 - k * s), rz * s];
}

/** Egg outline as a THREE.Shape in shape-space (x, y = -z) so ovalSlab-style rotateX(-PI/2) maps it to XZ. */
export function eggShape(rx, rz, k = 0.1, seg = 96, Ctor = THREE.Shape) {
  const s = new Ctor();
  for (let i = 0; i <= seg; i++) {
    const [x, z] = eggPoint((i / seg) * Math.PI * 2, rx, rz, k);
    i ? s.lineTo(x, -z) : s.moveTo(x, -z);
  }
  return s;
}

/** Egg slab (lid / tank-lid style): extruded up +Y, optional hole, optional dome on top. */
export function eggSlab(rx, rz, depth, { k = 0.1, bevel = 0.012, hole = null, dome = 0 } = {}) {
  const shape = eggShape(rx, rz, k);
  if (hole) {
    const h = eggShape(hole.rx, hole.rz, hole.k ?? k, 96, THREE.Path);
    if (hole.cz) h.curves.forEach((c) => { c.v1.y -= hole.cz; c.v2.y -= hole.cz; });
    shape.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 6, curveSegments: 8,
  });
  g.rotateX(-Math.PI / 2);
  if (dome) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > depth * 0.5) {
        const nx = p.getX(i) / rx, nz = p.getZ(i) / rz;
        p.setY(i, y + dome * Math.max(0, 1 - nx * nx - nz * nz));
      }
    }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Sweep a closed 2D profile [(out, up)...] around an egg path in XZ -> a ring
 * with a real rounded cross-section (toilet seat).
 */
export function eggRing(rx, rz, k, profile, seg = 160) {
  const pos = [], idx = [], uv = [];
  const np = profile.length;
  for (let i = 0; i <= seg; i++) {
    const th = (i / seg) * Math.PI * 2;
    const [x, z] = eggPoint(th, rx, rz, k);
    const [x2, z2] = eggPoint(th + 1e-3, rx, rz, k);
    let tx = x2 - x, tz = z2 - z; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
    const nx = tz, nz = -tx; // outward normal for CCW path
    for (let j = 0; j <= np; j++) {
      const [a, b] = profile[j % np];
      pos.push(x + nx * a, b, z + nz * a);
      uv.push(i / seg, j / np);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < np; j++) {
      const a = i * (np + 1) + j, b = (i + 1) * (np + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Rounded-rectangle cross-section profile (closed loop, CCW) of width w, height h, corner r. */
export function roundedProfile(w, h, r, steps = 5) {
  const pts = [];
  const cs = [[w / 2 - r, h - r, 0], [-w / 2 + r, h - r, Math.PI / 2], [-w / 2 + r, r, Math.PI], [w / 2 - r, r, Math.PI * 1.5]];
  for (const [cx, cy, a0] of cs)
    for (let s = 0; s <= steps; s++) {
      const a = a0 + (s / steps) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  return pts;
}

/** Narrow the front of any geometry like an egg (x *= 1 - k*sin(theta)). */
export function eggify(geo, k = 0.1) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 1e-5) p.setX(i, x * (1 - k * (z / r)));
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Revolve a cross-section profile [[s, y], ...] around an egg outline, where s is a
 * radial scale (0 = center, 1 = outline). Gives a dense polar mesh, which is what
 * lets the lid bend smoothly like a lip when skinned.
 */
export function eggRevolve(rx, rz, k, profile, seg = 128) {
  const pos = [], uv = [], idx = [];
  const np = profile.length;
  for (let i = 0; i <= seg; i++) {
    const th = (i / seg) * Math.PI * 2;
    const [ex, ez] = eggPoint(th, rx, rz, k);
    for (let j = 0; j < np; j++) {
      const [s, y] = profile[j];
      pos.push(ex * s, y, ez * s);
      uv.push(0.5 + (ex * s) / (2 * rx), 0.5 + (ez * s) / (2 * rz));
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < np - 1; j++) {
      const a = i * np + j, b = (i + 1) * np + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Lid cross-section: domed top, rounded edge (radius e in absolute units), flat underside. */
export function lidProfile(rx, depth, dome, e) {
  const p = [];
  const se = e / rx;
  for (let i = 0; i <= 14; i++) {           // top, center -> edge
    const s = (i / 14) * (1 - se);
    p.push([s, depth + dome * (1 - s * s)]);
  }
  for (let i = 1; i <= 10; i++) {           // rounded edge
    const a = Math.PI / 2 - (i / 10) * Math.PI;
    p.push([1 - se + se * Math.cos(a), depth / 2 + (depth / 2) * Math.sin(a)]);
  }
  for (let i = 1; i <= 10; i++) p.push([(1 - se) * (1 - i / 10), 0]); // underside back to center
  return p;
}

/** Seat cross-section: soft rounded ring between s0 (hole) and 1 (outer). */
export function seatProfile(rx, s0, h) {
  const p = [];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - (i / n) * Math.PI;   // top arc, inner -> outer
    const s = (s0 + 1) / 2 + ((1 - s0) / 2) * Math.cos(a);
    p.push([s, h * 0.35 + h * 0.65 * Math.sin(a)]);
  }
  for (let i = 1; i <= n; i++) {             // underside arc, outer -> inner (flatter)
    const a = (i / n) * Math.PI;
    const s = (s0 + 1) / 2 + ((1 - s0) / 2) * Math.cos(a);
    p.push([s, h * 0.35 - h * 0.35 * Math.sin(a)]);
  }
  return p;
}
