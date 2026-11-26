// Ambientes fechados novos: banheiro da rodoviária, cela da prisão e boteco.
// Cada um monta o "cômodo" (piso, paredes, teto, janela/porta) e a parte fixa da decoração; os móveis
// que dá para tirar/pôr ficam no layout (cena-*.js) como itens do catálogo.
// Tudo procedural (texturas em canvas, geometria simples com cantos arredondados onde aparece).
import * as THREE from 'three';
import * as TX from './texturas.js';

/* ------------------------------------------------------------ utilidades */
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function texDe(c, rx = 1, ry = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8; return t;
}
const memo = new Map();
const uma = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };
/** sujeira: manchas escuras suaves por cima de um canvas */
function sujar(x, w, h, n = 40, cor = '40,32,20', a = 0.08, seed = 1) {
  const r = TX.rng(seed);
  for (let k = 0; k < n; k++) {
    const px = r() * w, py = r() * h, rad = 10 + r() * w * 0.12, g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, `rgba(${cor},${a * (0.5 + r())})`); g.addColorStop(1, `rgba(${cor},0)`);
    x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
}
/** azulejo: n x n peças com rejunte, variação de tom, algumas trincadas */
function azulejo({ n = 4, cor = '#eef0ec', rejunte = '#a9a59a', varia = 8, desenho = null, seed = 3, sujo = 0.08 } = {}) {
  const S = 512, [c, x] = cv(S, S), r = TX.rng(seed), p = S / n;
  x.fillStyle = rejunte; x.fillRect(0, 0, S, S);
  const base = new THREE.Color(cor);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = (r() - 0.5) * varia / 100, cc = base.clone().offsetHSL(0, 0, v);
    x.fillStyle = `#${cc.getHexString()}`; x.fillRect(i * p + 3, j * p + 3, p - 6, p - 6);
    // brilho do esmalte
    const g = x.createLinearGradient(i * p, j * p, i * p + p, j * p + p); g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.05)');
    x.fillStyle = g; x.fillRect(i * p + 3, j * p + 3, p - 6, p - 6);
    if (desenho) desenho(x, i * p + 3, j * p + 3, p - 6, r);
    if (r() < 0.06) { x.strokeStyle = 'rgba(60,60,60,.35)'; x.lineWidth = 1.5; x.beginPath(); let px = i * p + r() * p, py = j * p; x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (r() - 0.5) * 30; py += p / 6; x.lineTo(px, py); } x.stroke(); }
  }
  if (sujo) sujar(x, S, S, 30, '60,50,30', sujo, seed + 7);
  return c;
}
/** parede pintada velha (tinta descascando, manchas de umidade) */
function pintura(cor, seed = 5, umidade = 0.25, escorridos = 14) {
  const S = 512, [c, x] = cv(S, S), r = TX.rng(seed);
  x.fillStyle = cor; x.fillRect(0, 0, S, S);
  const F = TX.fbm(128, 128, { cx: 4, oct: 4, seed });
  const img = x.getImageData(0, 0, S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) {
    const f = F[((y >> 2) % 128) * 128 + ((xx >> 2) % 128)], i = (y * S + xx) * 4, k = (f - 0.5) * 34 + (r() - 0.5) * 8;
    d[i] += k; d[i + 1] += k; d[i + 2] += k * 0.9;
  }
  x.putImageData(img, 0, 0);
  // escorridos de umidade
  for (let k = 0; k < escorridos; k++) {
    const px = r() * S, len = 60 + r() * 220, g = x.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(70,60,40,${umidade})`); g.addColorStop(1, 'rgba(70,60,40,0)');
    x.fillStyle = g; x.fillRect(px, 0, 4 + r() * 10, len);
  }
  // descascados: manchas irregulares pequenas e discretas (reboco aparecendo)
  for (let k = 0; k < 5; k++) {
    const px = r() * S, py = r() * S, R0 = 6 + r() * 16;
    x.beginPath();
    for (let a = 0; a < 14; a++) { const ang = a / 14 * Math.PI * 2, rr = R0 * (0.5 + r() * 0.8); x.lineTo(px + Math.cos(ang) * rr * 1.4, py + Math.sin(ang) * rr); }
    x.closePath(); x.fillStyle = 'rgba(196,190,176,.55)'; x.fill(); x.strokeStyle = 'rgba(0,0,0,.08)'; x.lineWidth = 1; x.stroke();
  }
  return c;
}
function matCanvas(chave, fn, rx, ry, extra = {}) {
  const c = uma(chave, fn);
  return new THREE.MeshPhysicalMaterial({ map: texDe(c, rx, ry), roughness: 0.85, ...extra });
}
/** caixa com UV em metros (texturas não esticam) */
function caixa(w, h, d, m, x, y, z, parent, escalaUV = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    const px = pos.getX(i) + x, py = pos.getY(i) + y, pz = pos.getZ(i) + z;
    if (nx > 0.5) uv.setXY(i, pz / escalaUV, py / escalaUV); else if (ny > 0.5) uv.setXY(i, px / escalaUV, pz / escalaUV); else uv.setXY(i, px / escalaUV, py / escalaUV);
  }
  const m2 = new THREE.Mesh(g, m); m2.position.set(x, y, z); m2.castShadow = true; m2.receiveShadow = true; parent.add(m2); return m2;
}
function plano(w, h, m, parent, pos, rot) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.copy(pos); if (rot) p.rotation.copy(rot); p.receiveShadow = true; parent.add(p); return p;
}
/** faixa de "oclusão" (gradiente escuro -> transparente) */
function faixaAO(w, h, opac, parent, pos, rot) {
  const t = uma('aoTex', () => { const [c, x] = cv(4, 128); const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.35, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 4, 128); return new THREE.CanvasTexture(c); });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: t, transparent: true, opacity: opac, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.position.copy(pos); m.rotation.copy(rot); m.renderOrder = 2; parent.add(m); return m;
}
/** placa/aviso em canvas (texto) */
export function placaTex(linhas, { w = 512, h = 256, fundo = '#f4f1e8', cor = '#1a1a1a', borda = null, fonte = 'bold 64px Arial', sujo = 0.06, seed = 9 } = {}) {
  const [c, x] = cv(w, h);
  x.fillStyle = fundo; x.fillRect(0, 0, w, h);
  if (borda) { x.strokeStyle = borda; x.lineWidth = 14; x.strokeRect(10, 10, w - 20, h - 20); }
  x.fillStyle = cor; x.textAlign = 'center'; x.textBaseline = 'middle';
  const L = Array.isArray(linhas) ? linhas : [linhas];
  L.forEach((l, i) => { const f = typeof l === 'object' ? l : { t: l }; x.font = f.f || fonte; x.fillStyle = f.c || cor; x.fillText(f.t, w / 2, h * (i + 1) / (L.length + 1)); });
  if (sujo) sujar(x, w, h, 12, '60,50,30', sujo, seed);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function placa(parent, linhas, w, h, pos, rotY = 0, opts = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: placaTex(linhas, opts), roughness: 0.6 }));
  m.position.copy(pos); m.rotation.y = rotY; parent.add(m); return m;
}

/**
 * Cômodo genérico: piso, 3 paredes (fundo, esquerda, direita), teto e as faixas de AO.
 * `vaos` = aberturas na parede direita [{ z0, z1, y0, y1 }] (janela/porta).
 */
function comodo(parent, D, mats, { vaosDir = [], vaosFundo = [], semTeto = false } = {}) {
  const g = new THREE.Group(); g.name = 'comodo'; parent.add(g);
  const { esq, dir, fundo, frente, alto } = D, e = 0.2, W = dir - esq;
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(W, frente - fundo), mats.piso);
  // UV do piso em metros
  const uv = piso.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / (mats.pisoUV || 1), uv.getY(i) * (frente - fundo) / (mats.pisoUV || 1));
  piso.rotation.x = -Math.PI / 2; piso.position.set((esq + dir) / 2, 0, (frente + fundo) / 2); piso.receiveShadow = true; piso.name = 'piso'; g.add(piso);
  // parede do fundo (com vãos horizontais opcionais)
  const zf = fundo - e / 2 + 0.1;
  if (!vaosFundo.length) caixa(W + 2 * e, alto, e, mats.fundo, (esq + dir) / 2, alto / 2, zf, g, mats.uv || 1);
  else {
    const v = vaosFundo[0];
    caixa(v.x0 - (esq - e), alto, e, mats.fundo, (esq - e + v.x0) / 2, alto / 2, zf, g, mats.uv || 1);
    caixa(dir + e - v.x1, alto, e, mats.fundo, (v.x1 + dir + e) / 2, alto / 2, zf, g, mats.uv || 1);
    caixa(v.x1 - v.x0, v.y0, e, mats.fundo, (v.x0 + v.x1) / 2, v.y0 / 2, zf, g, mats.uv || 1);
    caixa(v.x1 - v.x0, alto - v.y1, e, mats.fundo, (v.x0 + v.x1) / 2, (alto + v.y1) / 2, zf, g, mats.uv || 1);
  }
  caixa(e, alto, frente - fundo, mats.lados, esq - e / 2 + 0.1, alto / 2, (frente + fundo) / 2, g, mats.uv || 1);
  // parede direita com vãos (ordenados em z)
  const xr = dir + e / 2 - 0.1;
  if (mats.direita !== null) {
    let z = fundo;
    for (const v of [...vaosDir].sort((a, b) => a.z0 - b.z0)) {
      if (v.z0 > z) caixa(e, alto, v.z0 - z, mats.lados, xr, alto / 2, (z + v.z0) / 2, g, mats.uv || 1);
      if (v.y0 > 0) caixa(e, v.y0, v.z1 - v.z0, mats.lados, xr, v.y0 / 2, (v.z0 + v.z1) / 2, g, mats.uv || 1);
      if (v.y1 < alto) caixa(e, alto - v.y1, v.z1 - v.z0, mats.lados, xr, (alto + v.y1) / 2, (v.z0 + v.z1) / 2, g, mats.uv || 1);
      z = v.z1;
    }
    if (frente > z) caixa(e, alto, frente - z, mats.lados, xr, alto / 2, (z + frente) / 2, g, mats.uv || 1);
  }
  if (!semTeto) caixa(W + 2 * e, e, frente - fundo, mats.teto, (esq + dir) / 2, alto + e / 2, (frente + fundo) / 2, g, mats.uv || 1);
  // AO falso
  const z0 = fundo + 0.1, xl = esq + 0.1, xr2 = dir - 0.1;
  faixaAO(W, 0.7, 0.4, g, new THREE.Vector3((esq + dir) / 2, 0.002, z0 + 0.35), new THREE.Euler(-Math.PI / 2, 0, Math.PI));
  faixaAO(frente - z0, 0.7, 0.4, g, new THREE.Vector3(xl + 0.35, 0.002, (frente + z0) / 2), new THREE.Euler(-Math.PI / 2, 0, -Math.PI / 2));
  faixaAO(frente - z0, 0.7, 0.4, g, new THREE.Vector3(xr2 - 0.35, 0.002, (frente + z0) / 2), new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2));
  faixaAO(W, 0.5, 0.3, g, new THREE.Vector3((esq + dir) / 2, 0.25, z0 + 0.003), new THREE.Euler(0, 0, Math.PI));
  faixaAO(W, 0.45, 0.3, g, new THREE.Vector3((esq + dir) / 2, alto - 0.22, z0 + 0.003), new THREE.Euler(0, 0, 0));
  faixaAO(alto, 0.45, 0.32, g, new THREE.Vector3(xl + 0.22, alto / 2, z0 + 0.004), new THREE.Euler(0, 0, -Math.PI / 2));
  faixaAO(alto, 0.45, 0.32, g, new THREE.Vector3(xr2 - 0.22, alto / 2, z0 + 0.004), new THREE.Euler(0, 0, Math.PI / 2));
  return { g, piso };
}
export function paredesDe(D) {
  return {
    fundo: { normal: new THREE.Vector3(0, 0, 1), plano: D.fundo + 0.1, rotY: 0 },
    esquerda: { normal: new THREE.Vector3(1, 0, 0), plano: D.esq + 0.1, rotY: Math.PI / 2 },
    direita: { normal: new THREE.Vector3(-1, 0, 0), plano: D.dir - 0.1, rotY: -Math.PI / 2 },
  };
}
/** "lá fora" pela janela/porta: céu + chão desfocados; a cor muda com o dia/noite (material.color) */
function foraTex(tipo) {
  return uma('fora_' + tipo, () => {
    const [c, x] = cv(512, 512);
    const g = x.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, '#a6d3f0'); g.addColorStop(0.55, '#e7f1f3'); g.addColorStop(1, '#d7cfc0');
    x.fillStyle = g; x.fillRect(0, 0, 512, 512); x.filter = 'blur(8px)';
    if (tipo === 'rua') {
      x.fillStyle = '#8b8c8e'; x.fillRect(0, 360, 512, 160);                       // asfalto
      x.fillStyle = '#c9c2b2'; x.fillRect(0, 330, 512, 34);                        // calçada
      for (let k = 0; k < 5; k++) { x.fillStyle = ['#c25a3a', '#d8c77a', '#7fa3b8', '#e0e0d8', '#9a6a8a'][k]; x.fillRect(k * 110 - 10, 140 + (k % 2) * 30, 100, 200); }  // casas
      x.fillStyle = '#2f2f2f'; x.fillRect(300, 60, 8, 280);                       // poste
    } else if (tipo === 'patio') {
      x.fillStyle = '#9a958b'; x.fillRect(0, 250, 512, 262);                       // muro
      x.fillStyle = '#6c6860'; for (let k = 0; k < 8; k++) x.fillRect(k * 70, 250, 4, 262);
      x.strokeStyle = '#555'; x.lineWidth = 3; for (let k = 0; k < 30; k++) { x.beginPath(); x.arc(k * 18, 248, 9, Math.PI, 0); x.stroke(); }  // arame farpado
    } else {
      x.fillStyle = '#b9b3a6'; x.fillRect(0, 300, 512, 212);
      for (let k = 0; k < 30; k++) { x.fillStyle = `hsl(${100 + Math.random() * 30},30%,${35 + Math.random() * 20}%)`; x.beginPath(); x.arc(Math.random() * 512, 160 + Math.random() * 160, 30 + Math.random() * 40, 0, 6.28); x.fill(); }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  });
}
function janelaVidro(parent, { x, z0, z1, y0, y1 }, fora, fosco = false) {
  const alu = new THREE.MeshPhysicalMaterial({ color: '#cfd3d6', metalness: 1, roughness: 0.35 });
  const jw = z1 - z0, jh = y1 - y0;
  for (const [w, h, d, y, z] of [[0.06, 0.05, jw, y0, (z0 + z1) / 2], [0.06, 0.05, jw, y1, (z0 + z1) / 2], [0.06, jh, 0.05, (y0 + y1) / 2, z0], [0.06, jh, 0.05, (y0 + y1) / 2, z1], [0.04, jh, 0.04, (y0 + y1) / 2, (z0 + z1) / 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), alu); m.position.set(x - 0.04, y, z); parent.add(m);
  }
  const vidro = new THREE.Mesh(new THREE.PlaneGeometry(jw, jh), new THREE.MeshPhysicalMaterial({ color: fosco ? '#e9eef0' : '#dfeff2', roughness: fosco ? 0.6 : 0.05, transparent: true, opacity: fosco ? 0.7 : 0.12, depthWrite: false, emissive: new THREE.Color(fosco ? '#bfcfd6' : '#000000'), emissiveIntensity: fosco ? 0.6 : 0 }));
  vidro.rotation.y = -Math.PI / 2; vidro.position.set(x - 0.04, (y0 + y1) / 2, (z0 + z1) / 2); parent.add(vidro);
  const foraM = new THREE.MeshBasicMaterial({ map: foraTex(fora), toneMapped: false });
  const f = new THREE.Mesh(new THREE.PlaneGeometry(jw * 2.4, jh * 2), foraM);
  f.rotation.y = -Math.PI / 2; f.position.set(x + 1.2, (y0 + y1) / 2, (z0 + z1) / 2); parent.add(f);
  return { fora: foraM, vidro: vidro.material };
}
/** luminária de tubo fluorescente (calha + tubo que brilha) */
function tubo(parent, x, y, z, comp = 1.25, rotY = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; parent.add(g);
  const calha = new THREE.Mesh(new THREE.BoxGeometry(comp + 0.08, 0.05, 0.16), new THREE.MeshStandardMaterial({ color: '#e6e4dc', roughness: 0.5, metalness: 0.3 }));
  calha.position.y = -0.025; g.add(calha);
  const tm = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: new THREE.Color('#eaf6ff'), emissiveIntensity: 2.4 });
  for (const dz of [-0.04, 0.04]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, comp, 10), tm); t.rotation.z = Math.PI / 2; t.position.set(0, -0.07, dz); g.add(t); }
  return { g, mat: tm };
}

/* ============================================================ BANHEIRO DA RODOVIÁRIA */
export const BANHEIRO = { esq: -4.2, dir: 4.2, fundo: -2.6, frente: 6.5, alto: 3.2 };
export function criarBanheiro(raiz) {
  const D = BANHEIRO;
  const tileBranco = () => azulejo({ n: 4, cor: '#eceee9', rejunte: '#9e9a8e', seed: 3, sujo: 0.1 });
  const azul = new THREE.MeshPhysicalMaterial({ map: texDe(uma('azBr', tileBranco), 1, 1), roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const piso = new THREE.MeshPhysicalMaterial({ map: texDe(uma('pisoBan', () => azulejo({ n: 8, cor: '#8f8a80', rejunte: '#4a463f', varia: 14, seed: 11, sujo: 0.18 })), 1, 1), roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.15 });
  const tinta = new THREE.MeshPhysicalMaterial({ map: texDe(uma('tintaVerde', () => pintura('#a9b9a6', 7, 0.3)), 1, 1), roughness: 0.9 });
  const teto = new THREE.MeshStandardMaterial({ map: texDe(uma('tetoBan', () => pintura('#cfcabd', 2, 0, 0)), 1, 1), roughness: 1, color: '#8f8a80' });
  const { g, piso: chao } = comodo(raiz, D, { piso, fundo: azul, lados: azul, teto, uv: 2.4, pisoUV: 2.4 }, { vaosDir: [{ z0: -1.6, z1: -0.2, y0: 2.3, y1: 2.95 }] });
  // faixa pintada acima do azulejo (os azulejos vão até 2,1 m)
  for (const [w, pos, rot] of [[D.dir - D.esq, new THREE.Vector3(0, 2.65, D.fundo + 0.105), null], [D.frente - D.fundo, new THREE.Vector3(D.esq + 0.105, 2.65, (D.frente + D.fundo) / 2), new THREE.Euler(0, Math.PI / 2, 0)]]) {
    const p = plano(w, 1.1, tinta, g, pos, rot); p.material.map.repeat.set(w / 2.4, 0.5);
  }
  const jan = janelaVidro(g, { x: D.dir - 0.1, z0: -1.6, z1: -0.2, y0: 2.3, y1: 2.95 }, 'ceu', true);
  // tubos fluorescentes
  const tubos = [tubo(g, -2.4, D.alto, 0.2), tubo(g, 0.4, D.alto, 0.2), tubo(g, 2.6, D.alto, 0.6)];
  const luzes = [];
  for (const [x, z] of [[-2.4, 0.4], [0.4, 0.6], [2.6, 0.8]]) { const l = new THREE.PointLight(0xe9f4ff, 6, 9, 1.6); l.position.set(x, D.alto - 0.3, z); g.add(l); luzes.push(l); }
  // avisos
  placa(g, [{ t: 'NÃO JOGUE PAPEL', f: 'bold 54px Arial' }, { t: 'NO VASO', f: 'bold 54px Arial' }, { t: 'Grato: a Administração', f: 'italic 30px Arial', c: '#444' }], 0.55, 0.32, new THREE.Vector3(0.9, 1.75, D.fundo + 0.115), 0, { borda: '#b3172a', seed: 4 });
  placa(g, [{ t: 'LIMPEZA', f: 'bold 50px Arial' }, { t: '8h  ✓   12h  ✓   18h  ✗', f: 'bold 34px Arial', c: '#333' }], 0.36, 0.24, new THREE.Vector3(D.dir - 0.11, 1.6, 1.2), -Math.PI / 2, { fundo: '#fffbe0', seed: 8 });
  placa(g, [{ t: '🚹 MASCULINO', f: 'bold 60px Arial', c: '#fff' }], 0.5, 0.18, new THREE.Vector3(D.esq + 0.11, 2.35, 1.6), Math.PI / 2, { fundo: '#1f4fa0', sujo: 0.02 });
  // poça d'água no chão (brilhante)
  const poca = new THREE.Mesh(new THREE.CircleGeometry(0.6, 40), new THREE.MeshPhysicalMaterial({ color: '#7e8c93', roughness: 0.02, metalness: 0.2, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false }));
  poca.rotation.x = -Math.PI / 2; poca.scale.set(1.6, 0.8, 1); poca.position.set(1.3, 0.004, 1.2); poca.renderOrder = 1; g.add(poca);
  return {
    chao, paredes: paredesDe(D), D, janela: jan, tubos, luzesInternas: luzes,
    alvos: { tubos, luzes },
    diaNoite(i) { jan.fora.color.setScalar(0.12 + 0.88 * i.dia).lerp(new THREE.Color('#ffb070'), i.crepusculo * 0.35 * i.dia); jan.vidro.emissiveIntensity = 0.1 + 0.5 * i.dia; },
  };
}

/* ============================================================ CELA DA PRISÃO */
export const PRISAO = { esq: -3.2, dir: 3.0, fundo: -2.4, frente: 5.8, alto: 3.0 };
export function criarPrisao(raiz) {
  const D = PRISAO;
  const conc = TX.concreto(17);
  const rep = (t, x, y) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };
  const concreto = new THREE.MeshPhysicalMaterial({ map: rep(conc.map, 1, 1), normalMap: rep(conc.normalMap, 1, 1), roughnessMap: rep(conc.roughnessMap, 1, 1), color: '#b3aea3', roughness: 1 });
  const piso = new THREE.MeshPhysicalMaterial({ map: rep(TX.cimento(23).map, 1, 1), color: '#9b978f', roughness: 0.9, clearcoat: 0.05 });
  // barra pintada até 1,2 m (verde hospital desbotado), com riscos de contagem de dias
  const barra = new THREE.MeshPhysicalMaterial({ map: texDe(uma('barraPrisao', () => pintura('#7f9a86', 13, 0.35)), 1, 1), roughness: 0.8 });
  const { g, piso: chao } = comodo(raiz, D, { piso, fundo: concreto, lados: concreto, teto: concreto, direita: null, uv: 2.6, pisoUV: 2.6 }, { vaosFundo: [{ x0: -1.25, x1: -0.35, y0: 2.05, y1: 2.6 }] });
  for (const [w, pos, rot] of [[D.dir - D.esq, new THREE.Vector3((D.esq + D.dir) / 2, 0.6, D.fundo + 0.105), null], [D.frente - D.fundo, new THREE.Vector3(D.esq + 0.105, 0.6, (D.frente + D.fundo) / 2), new THREE.Euler(0, Math.PI / 2, 0)]]) {
    const p = plano(w, 1.2, barra, g, pos, rot); p.material.map.repeat.set(w / 2.6, 0.45);
  }
  // riscos na parede (contagem de dias) + rabiscos
  const riscos = uma('riscos', () => {
    const [c, x] = cv(512, 256); x.clearRect(0, 0, 512, 256); x.strokeStyle = 'rgba(30,28,25,.8)'; x.lineWidth = 4; x.lineCap = 'round';
    for (let gr = 0; gr < 14; gr++) { const bx = 20 + (gr % 7) * 70, by = 30 + Math.floor(gr / 7) * 110; for (let k = 0; k < 4; k++) { x.beginPath(); x.moveTo(bx + k * 12, by); x.lineTo(bx + k * 12 + 2, by + 60); x.stroke(); } x.beginPath(); x.moveTo(bx - 6, by + 50); x.lineTo(bx + 46, by + 10); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  });
  plano(1.1, 0.55, new THREE.MeshStandardMaterial({ map: riscos, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), g, new THREE.Vector3(1.6, 1.6, D.fundo + 0.11));
  const rabisco = placaTex([{ t: 'LIBERDADE', f: 'bold 72px Georgia', c: 'rgba(40,30,25,.85)' }], { w: 512, h: 160, fundo: 'rgba(0,0,0,0)', sujo: 0 });
  plano(1.0, 0.31, new THREE.MeshStandardMaterial({ map: rabisco, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), g, new THREE.Vector3(D.esq + 0.11, 1.9, 0.6), new THREE.Euler(0, Math.PI / 2, -0.05));
  // janelinha gradeada no fundo
  const ferro = new THREE.MeshPhysicalMaterial({ color: '#3a3d40', metalness: 0.9, roughness: 0.55 });
  for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.56, 8), ferro); b.position.set(-1.2 + k * 0.16, 2.325, D.fundo + 0.04); b.castShadow = true; g.add(b); }
  const foraJ = new THREE.MeshBasicMaterial({ map: foraTex('patio'), toneMapped: false });
  const fj = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), foraJ); fj.position.set(-0.8, 2.3, D.fundo - 1.3); g.add(fj);
  // grades na frente da cela (lado direito), do chão ao teto, com a porta
  const grade = new THREE.Group(); grade.name = 'grade'; g.add(grade);
  const xg = D.dir - 0.05;
  for (let z = D.fundo + 0.08; z < D.frente; z += 0.14) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, D.alto, 10), ferro); b.position.set(xg, D.alto / 2, z); b.castShadow = true; grade.add(b); }
  for (const y of [0.08, 1.05, 2.0, D.alto - 0.06]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, D.frente - D.fundo), ferro); b.position.set(xg, y, (D.frente + D.fundo) / 2); b.castShadow = true; grade.add(b); }
  const fecho = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.1), ferro); fecho.position.set(xg, 1.05, 1.35); grade.add(fecho);
  // corredor do outro lado (escuro, com luz de alarme)
  const corr = new THREE.MeshStandardMaterial({ color: '#57534c', roughness: 1 });
  const cp = new THREE.Mesh(new THREE.PlaneGeometry(2.6, D.frente - D.fundo + 4), corr); cp.rotation.x = -Math.PI / 2; cp.position.set(D.dir + 1.3, 0, (D.frente + D.fundo) / 2); cp.receiveShadow = true; g.add(cp);
  const cw = new THREE.Mesh(new THREE.PlaneGeometry(D.frente - D.fundo + 4, D.alto), new THREE.MeshStandardMaterial({ map: texDe(uma('corrParede', () => pintura('#8c8a80', 19, 0.4)), 3, 1), roughness: 1 }));
  cw.rotation.y = -Math.PI / 2; cw.position.set(D.dir + 2.6, D.alto / 2, (D.frente + D.fundo) / 2); g.add(cw);
  const sirMat = new THREE.MeshStandardMaterial({ color: '#5a0b0b', emissive: new THREE.Color('#ff1a1a'), emissiveIntensity: 0 });
  const sirene = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), sirMat); sirene.position.set(D.dir + 2.55, 2.5, 0.2); sirene.rotation.z = Math.PI / 2; g.add(sirene);
  const luzSirene = new THREE.SpotLight(0xff2020, 0, 9, 0.5, 0.6, 1.5); luzSirene.position.set(D.dir + 2.4, 2.5, 0.2); luzSirene.target.position.set(D.dir, 1, 0.2); g.add(luzSirene, luzSirene.target);
  const luzCorr = new THREE.PointLight(0xffe7b8, 2.5, 7, 1.6); luzCorr.position.set(D.dir + 1.4, 2.6, 2.4); g.add(luzCorr);
  // lâmpada com gaiola no teto da cela
  const gaiola = new THREE.Group(); gaiola.position.set(0.2, D.alto, 0.4); g.add(gaiola);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: new THREE.Color('#ffcf7a'), emissiveIntensity: 3 })); lamp.position.y = -0.12; gaiola.add(lamp);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; const f = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.004, 4, 16, Math.PI), ferro); f.position.y = -0.04; f.rotation.set(Math.PI, a, 0); gaiola.add(f); }
  const luzCela = new THREE.PointLight(0xffc98a, 6, 8, 1.7); luzCela.position.set(0.2, D.alto - 0.25, 0.4); luzCela.castShadow = false; g.add(luzCela);
  return {
    chao, paredes: { fundo: paredesDe(D).fundo, esquerda: paredesDe(D).esquerda }, D, grade, sirene: { mat: sirMat, luz: luzSirene, obj: sirene }, luzCela, lampCela: lamp, luzCorr,
    janelaFeixe: { x0: -1.25, x1: -0.35, y0: 2.05, y1: 2.6, z: D.fundo + 0.1 },
    diaNoite(i) { foraJ.color.setScalar(0.1 + 0.9 * i.dia).lerp(new THREE.Color('#ff9a60'), i.crepusculo * 0.3 * i.dia); },
  };
}

/* ============================================================ BOTECO (bar) */
export const BAR = { esq: -4.3, dir: 4.3, fundo: -2.8, frente: 6.5, alto: 3.3 };
export function criarBar(raiz) {
  const D = BAR;
  const azul = () => azulejo({ n: 4, cor: '#f1f1ec', rejunte: '#9aa0a3', seed: 21, sujo: 0.07, desenho: (x, px, py, s, r) => {
    // azulejo português simples: flor azul no centro + cantos
    x.fillStyle = '#2d5fa8'; x.beginPath(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; x.ellipse(px + s / 2 + Math.cos(a) * s * 0.16, py + s / 2 + Math.sin(a) * s * 0.16, s * 0.13, s * 0.07, a, 0, 6.28); } x.fill();
    x.beginPath(); x.arc(px + s / 2, py + s / 2, s * 0.06, 0, 6.28); x.fillStyle = '#f2c94c'; x.fill();
    x.fillStyle = '#2d5fa8'; for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { x.beginPath(); x.arc(px + cx * s, py + cy * s, s * 0.17, 0, 6.28); x.fill(); }
  } });
  const azMat = new THREE.MeshPhysicalMaterial({ map: texDe(uma('azPort', azul), 1, 1), roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const tinta = new THREE.MeshPhysicalMaterial({ map: texDe(uma('tintaMostarda', () => pintura('#d8b65a', 29, 0.18, 6)), 1, 1), roughness: 0.9 });
  const piso = new THREE.MeshPhysicalMaterial({ map: texDe(uma('pisoBar', () => azulejo({ n: 4, cor: '#a5432f', rejunte: '#5b4a3e', varia: 12, seed: 33, sujo: 0.16 })), 1, 1), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.25 });
  const teto = new THREE.MeshStandardMaterial({ map: texDe(uma('tetoBar', () => pintura('#e2dccb', 41, 0, 0)), 1, 1), roughness: 1, color: '#a29d90' });
  const porta = { z0: -0.4, z1: 2.2, y0: 0, y1: 2.6 };
  const { g, piso: chao } = comodo(raiz, D, { piso, fundo: tinta, lados: tinta, teto, uv: 2.6, pisoUV: 1.6 }, { vaosDir: [porta] });
  // barrado de azulejo até 1,3 m
  for (const [w, pos, rot] of [[D.dir - D.esq, new THREE.Vector3(0, 0.65, D.fundo + 0.105), null], [D.frente - D.fundo, new THREE.Vector3(D.esq + 0.105, 0.65, (D.frente + D.fundo) / 2), new THREE.Euler(0, Math.PI / 2, 0)]]) {
    const p = plano(w, 1.3, azMat, g, pos, rot); p.material = p.material.clone(); p.material.map = p.material.map.clone(); p.material.map.repeat.set(w / 0.6, 1.3 / 0.6); p.material.map.needsUpdate = true;
  }
  // porta de aço de enrolar (meio aberta) + rua lá fora
  const aco = new THREE.MeshPhysicalMaterial({ map: texDe(uma('acoOnd', () => { const [c, x] = cv(64, 256); for (let y = 0; y < 256; y++) { const v = 150 + 50 * Math.sin(y / 256 * Math.PI * 24); x.fillStyle = `rgb(${v},${v + 4},${v + 8})`; x.fillRect(0, y, 64, 1); } sujar(x, 64, 256, 10, '80,60,40', 0.2, 2); return c; }), 4, 1), metalness: 0.8, roughness: 0.5 });
  const pa = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, porta.z1 - porta.z0 + 0.1), aco); pa.position.set(D.dir - 0.05, porta.y1 - 0.25, (porta.z0 + porta.z1) / 2); g.add(pa);
  const rolo = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, porta.z1 - porta.z0 + 0.2, 16), aco); rolo.rotation.x = Math.PI / 2; rolo.position.set(D.dir + 0.05, porta.y1 + 0.2, (porta.z0 + porta.z1) / 2); g.add(rolo);
  const foraM = new THREE.MeshBasicMaterial({ map: foraTex('rua'), toneMapped: false });
  foraM.map = foraM.map.clone(); foraM.map.needsUpdate = true; foraM.map.wrapS = THREE.MirroredRepeatWrapping; foraM.map.repeat.set(2.5, 1);
  const fora = new THREE.Mesh(new THREE.PlaneGeometry(16, 4.6), foraM); fora.rotation.y = -Math.PI / 2; fora.position.set(D.dir + 2.5, 1.7, (porta.z0 + porta.z1) / 2 - 4); g.add(fora);
  const calc = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 16), new THREE.MeshStandardMaterial({ color: '#a8a296', roughness: 1 })); calc.rotation.x = -Math.PI / 2; calc.position.set(D.dir + 1.25, -0.01, (porta.z0 + porta.z1) / 2 - 4); g.add(calc);
  // letreiro "BAR DO VASO" (madeira pintada) e neon "ABERTO"
  placa(g, [{ t: 'BAR DO VASO', f: 'bold 120px Georgia', c: '#f6e7b0' }, { t: 'desde 1998 • fiado só amanhã', f: 'italic 40px Georgia', c: '#e7d39a' }], 2.4, 0.6, new THREE.Vector3(-1.2, 2.75, D.fundo + 0.12), 0, { w: 1024, h: 256, fundo: '#7a2a18', borda: '#e2c06a', seed: 12 });
  const neonTex = placaTex([{ t: 'ABERTO', f: 'bold 120px Arial', c: '#ff3b5c' }], { w: 512, h: 192, fundo: '#000000', sujo: 0 });
  const neonM = new THREE.MeshBasicMaterial({ map: neonTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(2.2, 2.2, 2.2) });
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), neonM); neon.position.set(D.dir - 0.13, 2.1, 2.7); neon.rotation.y = -Math.PI / 2; g.add(neon);
  const luzNeon = new THREE.PointLight(0xff3b5c, 1.6, 4, 2); luzNeon.position.set(D.dir - 0.5, 2.1, 2.7); g.add(luzNeon);
  // calendário e pôster de cerveja genérico
  placa(g, [{ t: 'CERVEJA', f: 'bold 80px Arial', c: '#1b1b1b' }, { t: 'GELADA', f: 'bold 80px Arial', c: '#c8121b' }, { t: 'R$ 8,00', f: 'bold 64px Arial', c: '#1b1b1b' }], 0.6, 0.6, new THREE.Vector3(D.esq + 0.12, 2.0, 0.9), Math.PI / 2, { w: 512, h: 512, fundo: '#f2c94c', seed: 5 });
  placa(g, [{ t: 'NÃO VENDEMOS', f: 'bold 46px Arial' }, { t: 'FIADO', f: 'bold 90px Arial', c: '#b3172a' }], 0.5, 0.3, new THREE.Vector3(1.6, 1.95, D.fundo + 0.115), 0, { seed: 6 });
  // lâmpadas
  const luzes = [];
  for (const [x, z] of [[-2.2, 0.3], [1.2, 0.9]]) { const l = new THREE.PointLight(0xffd29a, 6.5, 9, 1.7); l.position.set(x, D.alto - 0.5, z); g.add(l); luzes.push(l); }
  return {
    chao, paredes: paredesDe(D), D, neon: { mat: neonM, luz: luzNeon }, luzesInternas: luzes,
    feixePorta: porta,
    diaNoite(i) { foraM.color.setScalar(0.1 + 0.9 * i.dia).lerp(new THREE.Color('#ffa860'), i.crepusculo * 0.35 * i.dia); luzNeon.intensity = 1.0 + 1.8 * i.noite; },
  };
}
