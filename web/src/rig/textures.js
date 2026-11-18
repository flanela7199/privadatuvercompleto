// Procedural textures (no image files). Every texture is tileable and is built
// once, then cached. Material specs reference them by name, e.g.
//   "normalMap": "porcelainNormal", "normalScale": [0.12, 0.12], "repeat": [6, 6]
// Add your own with registerTexture('name', () => THREE.Texture).
//
// Normal maps follow the OpenGL convention (green = +v), so they match three.js.
import * as THREE from 'three';

const GEN = new Map();
const CACHE = new Map();

export function registerTexture(name, fn) { GEN.set(name, fn); CACHE.delete(name); }
export function hasTexture(name) { return GEN.has(name); }
export function getTexture(name) {
  if (CACHE.has(name)) return CACHE.get(name);
  const fn = GEN.get(name);
  if (!fn) { console.warn(`[texture] unknown "${name}"`); return null; }
  const t = fn();
  t.name = name;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  CACHE.set(name, t);
  return t;
}

/* ------------------------------------------------------------ helpers */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable fractal value noise in [0,1]; cx/cy = cells across the tile at octave 0. */
function fbm(w, h, { cx = 8, cy = cx, oct = 4, gain = 0.5, seed = 1 } = {}) {
  const out = new Float32Array(w * h);
  const r = rng(seed);
  let amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    const nx = cx << o, ny = cy << o;
    const g = new Float32Array(nx * ny);
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * ny, yi = Math.floor(fy), ty = fy - yi;
      const sy = ty * ty * (3 - 2 * ty), y0 = yi % ny, y1 = (yi + 1) % ny;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * nx, xi = Math.floor(fx), tx = fx - xi;
        const sx = tx * tx * (3 - 2 * tx), x0 = xi % nx, x1 = (xi + 1) % nx;
        const a = g[y0 * nx + x0], b = g[y0 * nx + x1], c = g[y1 * nx + x0], d = g[y1 * nx + x1];
        out[y * w + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    norm += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  return { c, ctx, img: ctx.createImageData(w, h) };
}

/** Height field -> tangent-space normal map (wraps at the edges, so it tiles). */
function normalFromHeight(H, w, h, strength = 1) {
  const { c, ctx, img } = canvas(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const yu = ((y - 1 + h) % h) * w, yd = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w;
      const nx = -(H[y * w + xr] - H[y * w + xl]) * strength;
      const ny = (H[yd + x] - H[yu + x]) * strength; // canvas y grows down, texture v grows up
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      d[i] = (nx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

/** Field in [0,1] -> grayscale texture mapped to [lo,hi] (0..255). */
function grayFromField(F, w, h, lo, hi) {
  const { c, ctx, img } = canvas(w, h);
  const d = img.data;
  for (let i = 0; i < F.length; i++) {
    const v = lo + (hi - lo) * Math.min(1, Math.max(0, F[i]));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

function colorFromField(F, w, h, base, amp, shade = null) {
  const { c, ctx, img } = canvas(w, h);
  const d = img.data;
  for (let i = 0; i < F.length; i++) {
    const k = (F[i] - 0.5) * amp + (shade ? shade[i] : 0);
    d[i * 4] = base[0] + k; d[i * 4 + 1] = base[1] + k; d[i * 4 + 2] = base[2] + k * 1.1;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Quilted toilet-paper relief: diamond pillows + tiny emboss dots + fibres. */
function quiltHeight(w, h, nx, ny, seed) {
  const fib = fbm(w, h, { cx: 32, cy: 32, oct: 3, seed });
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x / w) * nx, v = (y / h) * ny;
      const a = u + v, b = u - v;                 // diamond grid, still tileable
      const pa = Math.abs(Math.sin(Math.PI * a)), pb = Math.abs(Math.sin(Math.PI * b));
      const pillow = Math.pow(pa * pb, 0.45);
      const fa = a - Math.round(a), fb = b - Math.round(b);
      const dot = Math.exp(-(fa * fa + fb * fb) * 400) * 0.6; // emboss dot at crossings
      H[y * w + x] = pillow * 0.75 - dot + fib[y * w + x] * 0.25;
    }
  }
  return H;
}

/* ----------------------------------------------------------- porcelain */
// Vitreous-china glaze: almost flat, with a faint orange-peel ripple.
registerTexture('porcelainNormal', () => {
  const w = 512;
  const a = fbm(w, w, { cx: 20, oct: 3, seed: 11 });
  const b = fbm(w, w, { cx: 5, oct: 2, seed: 12 });
  for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.8 + b[i] * 0.4;
  return normalFromHeight(a, w, w, 3.0);
});

registerTexture('porcelainRough', () => {
  const w = 512;
  const a = fbm(w, w, { cx: 6, oct: 5, gain: 0.55, seed: 21 });
  return grayFromField(a, w, w, 205, 255); // multiplier 0.8..1.0 of the material roughness
});

/* --------------------------------------------------------------- paper */
registerTexture('paperBump', () => {
  const w = 512;
  return grayFromField(quiltHeight(w, w, 4, 4, 31), w, w, 0, 255);
});

registerTexture('paperNormal', () => {
  const w = 512;
  return normalFromHeight(quiltHeight(w, w, 4, 4, 31), w, w, 6);
});

registerTexture('paperMap', () => {
  const w = 512;
  const fib = fbm(w, w, { cx: 48, oct: 3, seed: 32 });
  const q = quiltHeight(w, w, 4, 4, 31);
  const shade = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) shade[i] = (q[i] - 0.5) * 6;
  return colorFromField(fib, w, w, [243, 241, 233], 10, shade);
});

// One full sheet per tile (u = strip width 0.19 m, v = sheet length 0.11 m),
// with a perforation row. Use with "repeat": [1, 1.894] on the strip, whose
// UV v grows 0.12 per 0.025 m segment (0.11 m sheet = 0.528 v).
const PERF_W = 760, PERF_H = 440, PERF_NX = 19, PERF_NY = 11;
function perfHeight() {
  const H = quiltHeight(PERF_W, PERF_H, PERF_NX, PERF_NY, 41);
  const holes = 34;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < PERF_W; x++) {
      const f = ((x / PERF_W) * holes) % 1;
      if (f > 0.25 && f < 0.75 && y >= 2 && y <= 5) H[y * PERF_W + x] -= 1.2;  // slot
      else H[y * PERF_W + x] = H[y * PERF_W + x] * 0.4 + 0.2;                    // pressed line
    }
  }
  return H;
}
registerTexture('paperPerf', () => normalFromHeight(perfHeight(), PERF_W, PERF_H, 6));
registerTexture('paperPerfMap', () => {
  const H = perfHeight();
  const fib = fbm(PERF_W, PERF_H, { cx: 76, cy: 44, oct: 2, seed: 42 });
  const shade = new Float32Array(H.length);
  for (let i = 0; i < H.length; i++) shade[i] = H[i] < -0.3 ? -40 : (H[i] - 0.5) * 6;
  return colorFromField(fib, PERF_W, PERF_H, [243, 241, 233], 10, shade);
});

// End of the roll (RingGeometry planar UV: centre 0.5, outer edge radius 0.5).
registerTexture('rollEnd', () => {
  const w = 512;
  const { c, ctx } = canvas(w, w);
  const r0 = 0.5 * w, rCore = (0.024 / 0.085) * r0;
  ctx.fillStyle = '#efece3';
  ctx.fillRect(0, 0, w, w);
  const r = rng(51);
  for (let rr = rCore; rr < r0; rr += 1.6) {
    const g = 220 + r() * 25;
    ctx.strokeStyle = `rgba(${g * 0.86},${g * 0.84},${g * 0.78},${0.35 + r() * 0.3})`;
    ctx.lineWidth = 0.8 + r() * 0.6;
    ctx.beginPath();
    ctx.arc(w / 2 + (r() - 0.5) * 0.8, w / 2 + (r() - 0.5) * 0.8, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#9c7a52';
  ctx.beginPath(); ctx.arc(w / 2, w / 2, rCore, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5a4630';
  ctx.beginPath(); ctx.arc(w / 2, w / 2, rCore * 0.82, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
});

/* --------------------------------------------------------------- water */
registerTexture('waterNormal', () => {
  const w = 512;
  const H = fbm(w, w, { cx: 4, oct: 3, gain: 0.45, seed: 61 });
  const r = rng(62);
  const waves = Array.from({ length: 7 }, () => [Math.round(1 + r() * 5) * (r() < 0.5 ? -1 : 1), Math.round(1 + r() * 5), r() * Math.PI * 2]);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (const [kx, ky, ph] of waves) s += Math.sin(((kx * x + ky * y) / w) * Math.PI * 2 + ph);
      H[y * w + x] = H[y * w + x] * 0.6 + s * 0.06;
    }
  return normalFromHeight(H, w, w, 4);
});

/* ---------------------------------------------------------------- gold */
// Fine brushing + soft worn patches (roughness multiplier).
registerTexture('goldRough', () => {
  const w = 512;
  const streak = fbm(w, w, { cx: 2, cy: 96, oct: 2, seed: 71 });
  const wear = fbm(w, w, { cx: 4, oct: 4, seed: 72 });
  for (let i = 0; i < streak.length; i++) streak[i] = streak[i] * 0.6 + wear[i] * 0.4;
  return grayFromField(streak, w, w, 170, 255);
});

/* --------------------------------------------------------- braided hose */
registerTexture('hoseBraid', () => {
  const w = 256, N = 8, wires = 4;
  const H = new Float32Array(w * w);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const u = (x / w) * N, v = (y / w) * N;
      const a = u + v, b = u - v;
      const s1 = Math.abs(Math.sin(Math.PI * a)), s2 = Math.abs(Math.sin(Math.PI * b));
      const w1 = 0.75 + 0.25 * Math.abs(Math.sin(Math.PI * b * wires));
      const w2 = 0.75 + 0.25 * Math.abs(Math.sin(Math.PI * a * wires));
      const over = ((Math.floor(a) + Math.floor(b)) & 1) === 0; // over/under weave checker
      H[y * w + x] = over ? Math.max(s1 * w1, s2 * w2 * 0.6) : Math.max(s2 * w2, s1 * w1 * 0.6);
    }
  return normalFromHeight(H, w, w, 5);
});
