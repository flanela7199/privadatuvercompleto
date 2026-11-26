// Texturas procedurais da sala (sem arquivos de imagem): concreto, cimento queimado,
// madeira, tecido, metal envelhecido e rótulos desenhados em canvas.
// Mesma filosofia do PrivadaTuber (app/textures.js): tudo gerado uma vez e guardado em cache.
import * as THREE from 'three';

const CACHE = new Map();
export function tex(nome, fn) {
  if (!CACHE.has(nome)) CACHE.set(nome, fn());
  return CACHE.get(nome);
}

/* ------------------------------------------------------------ ruído */
export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** fbm de valor, repetível (tileable), resultado em [0,1] */
export function fbm(w, h, { cx = 8, cy = cx, oct = 4, gain = 0.5, seed = 1 } = {}) {
  const out = new Float32Array(w * h), r = rng(seed);
  let amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    const nx = cx << o, ny = cy << o, g = new Float32Array(nx * ny);
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * ny, yi = Math.floor(fy), ty = fy - yi, sy = ty * ty * (3 - 2 * ty), y0 = yi % ny, y1 = (yi + 1) % ny;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * nx, xi = Math.floor(fx), tx = fx - xi, sx = tx * tx * (3 - 2 * tx), x0 = xi % nx, x1 = (xi + 1) % nx;
        const a = g[y0 * nx + x0], b = g[y0 * nx + x1], c = g[y1 * nx + x0], d = g[y1 * nx + x1];
        out[y * w + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    norm += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function texCanvas(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
/** altura -> normal map (OpenGL, repetível) */
function normalDeAltura(H, w, h, k = 1) {
  const [c, ctx] = cv(w, h), img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const yu = ((y - 1 + h) % h) * w, yd = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w;
      const nx = -(H[y * w + xr] - H[y * w + xl]) * k, ny = (H[yd + x] - H[yu + x]) * k, inv = 1 / Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
      d[i] = (nx * inv * 0.5 + 0.5) * 255; d[i + 1] = (ny * inv * 0.5 + 0.5) * 255; d[i + 2] = (inv * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return texCanvas(c, false);
}
function cinzaDeCampo(F, w, h, lo, hi) {
  const [c, ctx] = cv(w, h), img = ctx.createImageData(w, h), d = img.data;
  for (let i = 0; i < F.length; i++) { const v = lo + (hi - lo) * Math.min(1, Math.max(0, F[i])); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return texCanvas(c, false);
}
/** rachadura: passeio aleatório desenhado num campo de altura */
function rachar(H, w, h, r, n, len) {
  for (let k = 0; k < n; k++) {
    let x = r() * w, y = r() * h, a = r() * Math.PI * 2;
    const L = len * (0.5 + r());
    for (let s = 0; s < L; s++) {
      a += (r() - 0.5) * 0.7; x += Math.cos(a); y += Math.sin(a);
      const xi = ((Math.round(x) % w) + w) % w, yi = ((Math.round(y) % h) + h) % h;
      H[yi * w + xi] -= 0.35;
      if (r() < 0.02) rachar(H, w, h, r, 0, 0); // (sem ramos extras: mantém barato)
    }
  }
}

/* ------------------------------------------------------------ concreto das paredes */
// Concreto aparente de obra: manchas, poros, juntas das fôrmas, furos de amarração e rachaduras.
export function concreto(seed = 3) {
  return tex('concreto' + seed, () => {
    const w = 1024, h = 1024, r = rng(seed);
    const big = fbm(w, h, { cx: 3, oct: 4, seed }), mid = fbm(w, h, { cx: 16, oct: 3, seed: seed + 1 }), fine = fbm(w, h, { cx: 128, oct: 2, seed: seed + 2 });
    const H = new Float32Array(w * h), C = new Float32Array(w * h);
    for (let i = 0; i < H.length; i++) {
      H[i] = mid[i] * 0.5 + fine[i] * 0.5;
      C[i] = big[i] * 0.65 + mid[i] * 0.25 + fine[i] * 0.1;
    }
    // poros (bolhas de ar)
    for (let k = 0; k < 2600; k++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h), rad = 1 + r() * 2.5;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const d = Math.hypot(dx, dy); if (d > rad) continue;
        const i = (((y + dy + h) % h) * w + ((x + dx + w) % w)); H[i] -= 0.5 * (1 - d / rad); C[i] -= 0.12 * (1 - d / rad);
      }
    }
    // juntas das fôrmas (2 x 2 painéis por tile) + furos de amarração
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const jx = Math.min(x % 512, 512 - (x % 512)), jy = Math.min(y % 512, 512 - (y % 512)), j = Math.min(jx, jy);
      if (j < 3) { H[y * w + x] -= 0.25 * (1 - j / 3); C[y * w + x] -= 0.05; }
    }
    for (const [px, py] of [[128, 128], [384, 128], [128, 384], [384, 384]]) for (const [ox, oy] of [[0, 0], [512, 0], [0, 512], [512, 512]]) {
      for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
        const d = Math.hypot(dx, dy); if (d > 9) continue;
        const i = (py + oy + dy) * w + (px + ox + dx); H[i] -= d < 6 ? 0.9 : 0.3; C[i] -= d < 6 ? 0.28 : 0.08;
      }
    }
    rachar(H, w, h, r, 7, 260);
    // cor: cinza levemente quente com escorridos (umidade) verticais
    const [c, ctx] = cv(w, h), img = ctx.createImageData(w, h), d = img.data;
    const esc = fbm(w, h, { cx: 24, cy: 2, oct: 3, seed: seed + 9 });
    for (let i = 0; i < C.length; i++) {
      const v = 0.53 + (C[i] - 0.5) * 0.38 - Math.max(0, esc[i] - 0.64) * 0.35;
      d[i * 4] = Math.min(255, v * 255 * 1.04); d[i * 4 + 1] = Math.min(255, v * 255 * 1.0); d[i * 4 + 2] = Math.min(255, v * 255 * 0.93); d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const rough = new Float32Array(w * h); for (let i = 0; i < rough.length; i++) rough[i] = 0.78 + fine[i] * 0.2 - Math.max(0, esc[i] - 0.62) * 0.4;
    return { map: texCanvas(c), normalMap: normalDeAltura(H, w, h, 2.2), roughnessMap: cinzaDeCampo(rough, w, h, 0, 255) };
  });
}

/* ------------------------------------------------------------ piso de cimento */
export function cimento(seed = 11) {
  return tex('cimento' + seed, () => {
    const w = 1024, h = 1024, r = rng(seed);
    const big = fbm(w, h, { cx: 2, oct: 5, seed }), mid = fbm(w, h, { cx: 12, oct: 3, seed: seed + 1 }), fine = fbm(w, h, { cx: 160, oct: 2, seed: seed + 2 });
    const H = new Float32Array(w * h);
    for (let i = 0; i < H.length; i++) H[i] = fine[i] * 0.6 + mid[i] * 0.4;
    rachar(H, w, h, r, 6, 340);
    // junta de dilatação no meio do tile
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = Math.min(Math.abs(x - 512), Math.abs(y - 512)); if (j < 2) H[y * w + x] -= 0.5; }
    const [c, ctx] = cv(w, h), img = ctx.createImageData(w, h), d = img.data;
    for (let i = 0; i < H.length; i++) {
      const mancha = Math.max(0, big[i] - 0.55) * 0.9;
      const v = 0.5 + (mid[i] - 0.5) * 0.25 + (fine[i] - 0.5) * 0.08 - mancha * 0.45 + Math.min(0, H[i] - 0.3) * 0.4;
      d[i * 4] = v * 255 * 1.0; d[i * 4 + 1] = v * 255 * 0.985; d[i * 4 + 2] = v * 255 * 0.95; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const rough = new Float32Array(w * h); for (let i = 0; i < rough.length; i++) rough[i] = 0.55 + mid[i] * 0.3 + Math.max(0, big[i] - 0.55) * 0.3;
    return { map: texCanvas(c), normalMap: normalDeAltura(H, w, h, 1.6), roughnessMap: cinzaDeCampo(rough, w, h, 0, 255) };
  });
}

/* ------------------------------------------------------------ madeira */
export function madeira(tom = [118, 78, 46], seed = 5) {
  return tex('madeira' + tom.join() + seed, () => {
    const w = 512, h = 512, n = fbm(w, h, { cx: 4, cy: 32, oct: 4, seed }), f = fbm(w, h, { cx: 64, cy: 4, oct: 2, seed: seed + 3 });
    const [c, ctx] = cv(w, h), img = ctx.createImageData(w, h), d = img.data, H = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, ring = Math.sin((x / w) * Math.PI * 2 * 14 + n[i] * 9) * 0.5 + 0.5;
      const k = 0.75 + ring * 0.25 - f[i] * 0.15; H[i] = ring * 0.5 + f[i] * 0.5;
      d[i * 4] = tom[0] * k; d[i * 4 + 1] = tom[1] * k; d[i * 4 + 2] = tom[2] * k; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return { map: texCanvas(c), normalMap: normalDeAltura(H, w, h, 1.2) };
  });
}

/* ------------------------------------------------------------ tecido do sofá */
export function tecido(seed = 21) {
  return tex('tecido' + seed, () => {
    const w = 512, h = 512, sujo = fbm(w, h, { cx: 3, oct: 5, seed }), fio = fbm(w, h, { cx: 96, oct: 1, seed: seed + 1 });
    const H = new Float32Array(w * h), [c, ctx] = cv(w, h), img = ctx.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, tr = Math.sin(x * 0.785) * Math.sin(y * 0.785); // trama 8 px
      H[i] = tr * 0.5 + fio[i] * 0.5;
      const m = Math.max(0, sujo[i] - 0.5) * 1.3, k = 1 - m * 0.45 + (fio[i] - 0.5) * 0.06;
      d[i * 4] = 205 * k; d[i * 4 + 1] = 182 * k * (1 - m * 0.05); d[i * 4 + 2] = 144 * k * (1 - m * 0.12); d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return { map: texCanvas(c), normalMap: normalDeAltura(H, w, h, 0.9) };
  });
}

/* ------------------------------------------------------------ metal envelhecido (TV) */
export function metalVelho(seed = 31) {
  return tex('metal' + seed, () => {
    const w = 512, h = 512, f = fbm(w, h, { cx: 6, oct: 5, seed }), g = fbm(w, h, { cx: 40, oct: 2, seed: seed + 1 });
    const [c, ctx] = cv(w, h), img = ctx.createImageData(w, h), d = img.data, R = new Float32Array(w * h), M = new Float32Array(w * h);
    for (let i = 0; i < f.length; i++) {
      const fer = Math.min(1, Math.max(0, (f[i] - 0.58) * 6 + (g[i] - 0.5)));
      const base = [222, 214, 196], ox = [128, 66, 30];
      for (let k = 0; k < 3; k++) d[i * 4 + k] = base[k] * (1 - fer) * (0.92 + g[i] * 0.1) + ox[k] * fer * (0.8 + g[i] * 0.4);
      d[i * 4 + 3] = 255; R[i] = 0.35 + fer * 0.55; M[i] = 0.65 * (1 - fer);
    }
    ctx.putImageData(img, 0, 0);
    return { map: texCanvas(c), roughnessMap: cinzaDeCampo(R, w, h, 0, 255), metalnessMap: cinzaDeCampo(M, w, h, 0, 255) };
  });
}

/* ------------------------------------------------------------ rótulos / capas */
export function capaLivro({ fundo, borda, texto, titulo, subtitulo, autor, desenho }) {
  const [c, ctx] = cv(512, 768);
  ctx.fillStyle = fundo; ctx.fillRect(0, 0, 512, 768);
  const g = ctx.createLinearGradient(0, 0, 512, 768); g.addColorStop(0, 'rgba(255,255,255,.08)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 768);
  ctx.strokeStyle = borda; ctx.lineWidth = 6; ctx.strokeRect(30, 30, 452, 708); ctx.lineWidth = 2; ctx.strokeRect(44, 44, 424, 680);
  ctx.fillStyle = texto; ctx.textAlign = 'center';
  ctx.font = '600 34px Georgia, serif'; ctx.fillText(titulo[0], 256, 150);
  ctx.font = '600 76px Georgia, serif'; ctx.fillText(titulo[1], 256, 240);
  if (titulo[2]) ctx.fillText(titulo[2], 256, 320);
  if (subtitulo) { ctx.font = 'italic 24px Georgia, serif'; ctx.fillText(subtitulo, 256, 290); }
  if (desenho) desenho(ctx);
  ctx.font = '600 44px Georgia, serif'; if (autor) autor.forEach((l, i) => ctx.fillText(l, 256, 480 + i * 54));
  return texCanvas(c, true, false);
}
export function paginas() {
  return tex('paginas', () => {
    const [c, ctx] = cv(256, 64); ctx.fillStyle = '#efe6d2'; ctx.fillRect(0, 0, 256, 64);
    for (let y = 0; y < 64; y += 2) { ctx.fillStyle = `rgba(120,100,70,${0.05 + Math.random() * 0.12})`; ctx.fillRect(0, y, 256, 1); }
    return texCanvas(c, true, false);
  });
}
/** "sem foto": cartão neutro para quadros novos */
export function semFoto(txt = 'SUA FOTO') {
  const [c, ctx] = cv(512, 640);
  const g = ctx.createLinearGradient(0, 0, 0, 640); g.addColorStop(0, '#3b4252'); g.addColorStop(1, '#1d212b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 640);
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '700 54px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(txt, 256, 335);
  return texCanvas(c, true, false);
}
/** chuvisco da TV (canvas atualizado a cada quadro) */
export function chuvisco() {
  const [c, ctx] = cv(160, 120), img = ctx.createImageData(160, 120);
  const t = texCanvas(c, true, false);
  t.minFilter = THREE.LinearFilter;
  let ult = -1;
  t.userData.atualizar = (tempo) => {
    if (tempo - ult < 1 / 20 && tempo > ult) return;   // 20 quadros/s (o chuvisco não precisa de 60)
    ult = tempo;
    const d = img.data;
    for (let y = 0; y < 120; y++) {
      const faixa = 0.75 + 0.25 * Math.sin(y * 0.5 + tempo * 18) + (Math.abs(((tempo * 40) % 140) - y) < 6 ? 0.25 : 0);
      for (let x = 0; x < 160; x++) { const v = Math.random() * 235 * faixa, i = (y * 160 + x) * 4; d[i] = v; d[i + 1] = v * 1.02; d[i + 2] = v * 0.98; d[i + 3] = 255; }
    }
    ctx.putImageData(img, 0, 0); t.needsUpdate = true;
  };
  t.userData.atualizar(0);
  return t;
}
/** gradiente radial suave (sombra de contato, brilho de lâmpada, poeira) */
export function radial(stops, nome) {
  return tex('radial' + nome, () => {
    const [c, ctx] = cv(128, 128), g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    stops.forEach(([p, col]) => g.addColorStop(p, col)); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    const t = texCanvas(c, true, false); return t;
  });
}
/** carrega imagem (data URL ou caminho) como textura sRGB */
const loader = new THREE.TextureLoader();
export function imagem(url, onload) {
  const t = loader.load(url, (tx) => { tx.needsUpdate = true; onload && onload(tx); });
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
