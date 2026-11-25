// Construtores dos objetos da sala. Cada construtor recebe (p, ctx) e devolve um THREE.Group
// com origem no chão (objetos de piso) ou no ponto de contato com a parede (objetos de parede,
// virados para +z). Direção de arte igual à do PrivadaTuber: objetos "de verdade" fotografados
// num ambiente interno (não brinquedo), materiais físicos, sombras suaves.
// Escala: a mesma "escala de personagem" do rig (móveis ~1,3–1,45x o tamanho real), para o vaso caber na cena.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildAccessory } from '../accessories/index.js';
import '../accessories/furniture.js';
import * as TX from './texturas.js';
import { FOTOS } from './fotos.js';

/* ------------------------------------------------------------ utilidades */
export const mat = (o) => {
  const m = new THREE.MeshPhysicalMaterial(o);
  if (o.opacity != null && o.opacity < 1) m.transparent = true;
  return m;
};
function mesh(geo, material, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true; m.receiveShadow = true;
  parent && parent.add(m);
  return m;
}
const rbox = (w, h, d, r, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
/** almofada: estufa as faces escolhidas (ax = [x, y, z] em metros) */
function fofo(geo, ax) {
  geo.computeBoundingBox();
  const b = geo.boundingBox, c = new THREE.Vector3(), s = new THREE.Vector3();
  b.getCenter(c); b.getSize(s).multiplyScalar(0.5);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const n = [(p.getX(i) - c.x) / s.x, (p.getY(i) - c.y) / s.y, (p.getZ(i) - c.z) / s.z];
    const v = [p.getX(i), p.getY(i), p.getZ(i)];
    for (let k = 0; k < 3; k++) {
      if (!ax[k]) continue;
      const a = n[(k + 1) % 3], bb = n[(k + 2) % 3];
      v[k] += Math.sign(n[k]) * ax[k] * Math.max(0, 1 - a * a) * Math.max(0, 1 - bb * bb) * Math.abs(n[k]) ** 0.5;
    }
    p.setXYZ(i, v[0], v[1], v[2]);
  }
  geo.computeVertexNormals();
  return geo;
}
/** amassa levemente (ruído senoidal) para tirar a cara de "CG perfeito" */
function amassar(geo, amp, freq = 7, seed = 1) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * freq + seed) * Math.sin(y * freq * 1.3 + seed * 2) * Math.sin(z * freq * 0.9 + seed * 3);
    p.setXYZ(i, x + n * amp, y + n * amp * 0.6, z + n * amp);
  }
  geo.computeVertexNormals();
  return geo;
}
function repetir(t, rx, ry) { const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c; }
function grupo(nome) { const g = new THREE.Group(); g.name = nome; return g; }
/** textura de imagem com enquadramento "cover" num retângulo w x h */
export function texturaFoto(src, w, h, cb) {
  const url = FOTOS[src] || src;
  const t = TX.imagem(url, (tx) => {
    const ia = tx.image.width / tx.image.height, ra = w / h;
    tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
    if (ia > ra) { tx.repeat.set(ra / ia, 1); tx.offset.set((1 - ra / ia) / 2, 0); }
    else { tx.repeat.set(1, ia / ra); tx.offset.set(0, (1 - ia / ra) / 2); }
    cb && cb(tx);
  });
  return t;
}
/** objeto da app PrivadaTuber (mesma geometria e materiais) */
function daApp(nome, ctx, p = {}) {
  const g = buildAccessory({ THREE, mats: ctx.mats, theme: null, dim: null }, { id: nome, params: p }) || new THREE.Group();
  g.traverse((o) => { if (o.isMesh && !o.userData.noShadow) { o.castShadow = o.receiveShadow = true; } });
  return g;
}

/* ------------------------------------------------------------ materiais compartilhados */
let M = null;
function mats() {
  if (M) return M;
  const tec = TX.tecido(), mv = TX.metalVelho(), mad = TX.madeira([66, 46, 32], 9), madQ = TX.madeira([122, 82, 44], 4);
  M = {
    tecido: mat({ map: tec.map, normalMap: tec.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color('#e9d9bb') }),
    tecidoEsc: mat({ map: tec.map, normalMap: tec.normalMap, color: '#b8a07c', roughness: 0.95, sheen: 0.8, sheenRoughness: 0.7, sheenColor: new THREE.Color('#d5c3a0') }),
    manta: mat({ color: '#e9e5da', normalMap: tec.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffffff'), side: THREE.DoubleSide }),
    espuma: mat({ color: '#efe6cf', roughness: 1, sheen: 1, sheenRoughness: 0.8, sheenColor: new THREE.Color('#fff8e6') }),
    papelao: mat({ color: '#9b7b52', roughness: 0.95, side: THREE.DoubleSide }),
    metalTV: mat({ map: mv.map, roughnessMap: mv.roughnessMap, metalnessMap: mv.metalnessMap, metalness: 1, roughness: 1, clearcoat: 0.2 }),
    cromo: mat({ color: '#e4e8eb', metalness: 1, roughness: 0.14 }),
    prata: mat({ color: '#cfccc3', metalness: 1, roughness: 0.3 }),
    prataEsc: mat({ color: '#8d8a83', metalness: 1, roughness: 0.42 }),
    ouro: mat({ color: '#d9ad55', metalness: 1, roughness: 0.3 }),
    ouroClaro: mat({ color: '#ead08f', metalness: 0.95, roughness: 0.36 }),
    ouroVelho: mat({ color: '#a57a30', metalness: 1, roughness: 0.45 }),
    pretoLaca: mat({ color: '#111111', roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18 }),
    pretoFosco: mat({ color: '#171717', roughness: 0.75 }),
    borracha: mat({ color: '#1b1b1b', roughness: 0.8 }),
    creme: mat({ color: '#e6dcc6', roughness: 0.45, clearcoat: 0.4 }),
    madeiraEsc: mat({ map: mad.map, normalMap: mad.normalMap, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.5 }),
    madeiraQuadro: mat({ map: madQ.map, normalMap: madQ.normalMap, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.7 }),
    branco: mat({ color: '#f1efe9', roughness: 0.5, clearcoat: 0.3 }),
    vermelhoPP: mat({ color: '#c8121b', roughness: 0.36, clearcoat: 0.35, clearcoatRoughness: 0.2 }),
    acoArma: mat({ color: '#2e3135', metalness: 1, roughness: 0.32 }),
    madeiraCabo: mat({ color: '#5a3520', roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    galvanizado: mat({ color: '#b9bec2', metalness: 1, roughness: 0.38 }),
    papel: mat({ color: '#f4f1ea', roughness: 0.9, side: THREE.DoubleSide }),
    folha: mat({ color: '#6f9a2d', roughness: 0.7, side: THREE.DoubleSide }),
  };
  return M;
}

/* ============================================================ SOFÁ */
function sofa(p) {
  const m = mats(), g = grupo('sofa');
  const W = 2.6, sh = 0.47;                    // largura entre braços, altura da base
  mesh(fofo(rbox(W + 0.02, sh, 1.18, 0.07, 4), [0.02, 0, 0.05]), m.tecido, g, 0, sh / 2, 0.02);
  // encosto (estrutura) e braços com rolo
  mesh(fofo(rbox(W + 0.1, 0.62, 0.3, 0.12, 4), [0, 0.03, 0.03]), m.tecido, g, 0, sh + 0.28, -0.46);
  for (const s of [-1, 1]) {
    const bx = s * (W / 2 + 0.17);
    mesh(fofo(rbox(0.36, 0.66, 1.22, 0.1, 4), [0.04, 0, 0.02]), m.tecido, g, bx, 0.33, 0.02);
    mesh(fofo(rbox(0.46, 0.27, 1.26, 0.13, 4), [0.03, 0.03, 0]), m.tecido, g, bx + s * 0.03, 0.72, 0.02);
  }
  // assentos: o da direita afundado (rasgado), com espuma saindo
  mesh(amassar(fofo(rbox(1.27, 0.25, 1.0, 0.1, 4), [0.02, 0.06, 0.05]), 0.008, 6, 1), m.tecido, g, -0.64, sh + 0.11, 0.1, 0, 0.02, 0.01);
  mesh(amassar(fofo(rbox(1.27, 0.22, 1.0, 0.1, 4), [0.02, 0.03, 0.05]), 0.014, 5, 4), m.tecido, g, 0.64, sh + 0.08, 0.12, 0.03, -0.03, -0.03);
  // almofadas do encosto
  mesh(amassar(fofo(rbox(1.22, 0.66, 0.3, 0.13, 4), [0.02, 0.03, 0.08]), 0.01, 6, 2), m.tecido, g, -0.63, sh + 0.52, -0.3, -0.2, 0.02, 0.02);
  mesh(amassar(fofo(rbox(1.22, 0.62, 0.3, 0.13, 4), [0.02, 0.03, 0.07]), 0.016, 5, 5), m.tecido, g, 0.63, sh + 0.47, -0.28, -0.3, -0.04, -0.05);
  // almofadas soltas
  mesh(amassar(fofo(rbox(0.55, 0.5, 0.17, 0.08, 4), [0.02, 0.02, 0.09]), 0.012, 8, 3), m.tecido, g, -1.02, sh + 0.42, -0.05, -0.5, 0.35, 0.45);
  mesh(amassar(fofo(rbox(0.6, 0.48, 0.17, 0.08, 4), [0.02, 0.02, 0.09]), 0.012, 8, 7), m.tecido, g, 0.98, sh + 0.42, -0.02, -0.6, -0.4, -0.3);
  // manta jogada por cima do encosto direito, caindo no assento
  const path = new THREE.CatmullRomCurve3([[-0.62, 0.55], [-0.5, 1.22], [-0.3, 1.25], [-0.15, 0.9], [0.05, 0.66], [0.32, 0.62]].map(([z, y]) => new THREE.Vector3(0, y, z)));
  const mw = 0.95, nu = 26, nv = 48, pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv, P = path.getPointAt(v);
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, x = (u - 0.5) * mw * (1 + v * 0.25);
      const dobra = Math.sin(u * 18 + v * 3) * 0.022 * v + Math.sin(u * 7) * 0.03 * v;
      pos.push(0.45 + x + Math.sin(v * 5) * 0.04, P.y + dobra * 0.5, P.z + dobra);
      uv.push(u * 3, v * 5);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + nu + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); mg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); mg.setIndex(idx); mg.computeVertexNormals();
  mesh(mg, m.manta, g);
  // espuma saindo do rasgo + pedaços no chão
  const r = TX.rng(42), bolas = [];
  const espuma = (cx, cy, cz, n, rad) => {
    for (let k = 0; k < n; k++) {
      const s = rad * (0.4 + r() * 0.8), b = amassar(new THREE.IcosahedronGeometry(s, 2), s * 0.25, 30, k);
      b.scale(1, 0.6, 1); b.translate(cx + (r() - 0.5) * rad * 5, cy + r() * rad * 0.8, cz + (r() - 0.5) * rad * 4);
      bolas.push(b);
    }
  };
  espuma(0.1, sh + 0.2, 0.15, 26, 0.05);
  espuma(-1.0, 0.02, 0.75, 7, 0.04); espuma(0.6, 0.02, 0.8, 5, 0.035);
  mesh(mergeGeometries(bolas), m.espuma, g);
  // barra rasgada: tiras de tecido caídas na frente
  for (let k = 0; k < 9; k++) {
    const tw = 0.12 + r() * 0.16, th = 0.1 + r() * 0.12, x = -1.3 + k * 0.32 + r() * 0.1;
    const pl = new THREE.PlaneGeometry(tw, th, 3, 3), pp = pl.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setZ(i, Math.sin(pp.getX(i) * 20) * 0.01 + (pp.getY(i) < 0 ? (r() * 0.03) : 0));
    pl.computeVertexNormals();
    const t = mesh(pl, m.tecidoEsc.clone(), g, x, th / 2 + 0.005, 0.62 + r() * 0.03, -0.5 - r() * 0.6, (r() - 0.5) * 0.6, (r() - 0.5) * 0.4);
    t.material.side = THREE.DoubleSide;
  }
  // pés
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.06, 12), m.madeiraEsc, g, sx * 1.55, 0.03, sz * 0.5);
  g.scale.setScalar(p.tamanho ?? 1);
  return g;
}

/* ============================================================ MESA VERMELHA (mesa de bar da app, vermelha) */
function mesaVermelha(p, ctx) {
  const g = daApp('mesa_bar', ctx, { color: p.cor || '#c8121b', x: 0 });
  g.traverse((o) => { if (o.name === 'logo_top') o.visible = !!p.logo; });
  if (p.rotulo) { // rótulo personalizado (imagem) sobre o tampo
    const t = texturaFoto(p.rotulo, 0.55, 0.22);
    const pl = mesh(new THREE.PlaneGeometry(0.55, 0.22), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.5 }), g, 0, 0.938, 0.18, -Math.PI / 2);
    pl.castShadow = false;
  }
  return g;
}

/* ============================================================ LIVRO */
const CAPAS = {
  capital: () => TX.capaLivro({ fundo: '#8e1418', borda: '#e8d9b0', texto: '#f3e8cf', titulo: ['O', 'CAPITAL'], subtitulo: 'crítica da economia política', autor: ['KARL', 'MARX'] }),
  amarelo: () => TX.capaLivro({ fundo: '#f1c21b', borda: '#2a2418', texto: '#231d12', titulo: ['O', 'LIVRO', 'AMARELO'], autor: [],
    desenho: (c) => { // onça estilizada a traço
      c.strokeStyle = '#231d12'; c.lineWidth = 4; c.beginPath();
      c.moveTo(170, 520); c.bezierCurveTo(210, 440, 300, 430, 350, 470); c.bezierCurveTo(380, 490, 395, 460, 410, 440);
      c.moveTo(350, 470); c.lineTo(345, 560); c.moveTo(300, 470); c.lineTo(290, 560); c.moveTo(220, 480); c.lineTo(200, 560); c.moveTo(190, 500); c.lineTo(160, 560);
      c.moveTo(170, 520); c.bezierCurveTo(140, 500, 120, 520, 110, 500); c.stroke();
      for (let k = 0; k < 26; k++) { c.beginPath(); c.arc(190 + (k % 9) * 18, 460 + Math.floor(k / 9) * 18 + (k % 2) * 6, 4, 0, 6.28); c.stroke(); }
    } }),
};
function livro(p) {
  const m = mats(), g = grupo('livro');
  const w = p.largura ?? 0.4, h = p.altura ?? 0.58, d = p.espessura ?? 0.1;
  const capa = p.imagem ? texturaFoto(p.imagem, w, h) : CAPAS[p.capa || 'capital']();
  const cor = p.cor || (p.capa === 'amarelo' ? '#f1c21b' : '#8e1418');
  const capaM = mat({ map: capa, roughness: 0.55, clearcoat: 0.25 }), corM = mat({ color: cor, roughness: 0.55, clearcoat: 0.2 });
  const pag = mat({ map: TX.paginas(), roughness: 0.9 });
  // miolo + capas duras com leve sobra
  mesh(new THREE.BoxGeometry(w - 0.012, h - 0.016, d - 0.012), pag, g, 0.004, h / 2, 0);
  const tampa = new THREE.BoxGeometry(w, h, 0.008);
  mesh(tampa, [corM, corM, corM, corM, capaM, corM], g, 0, h / 2, d / 2 - 0.004).name = 'capa';
  mesh(tampa.clone(), corM, g, 0, h / 2, -d / 2 + 0.004);
  mesh(rbox(0.014, h, d, 0.006, 2), mat({ color: cor, roughness: 0.45, clearcoat: 0.3 }), g, -w / 2 + 0.004, h / 2, 0);
  return g;
}

/* ============================================================ REVÓLVER (deitado) */
function revolver() {
  const m = mats(), g = grupo('revolver'), a = grupo('arma');
  mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.26, 16), m.acoArma, a, 0.2, 0, 0, 0, 0, Math.PI / 2);
  mesh(rbox(0.26, 0.028, 0.035, 0.008), m.acoArma, a, 0.18, 0.024, 0);                 // trilho superior
  mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.075, 6), m.acoArma, a, 0.03, 0.006, 0, 0, 0, Math.PI / 2); // tambor
  mesh(rbox(0.13, 0.085, 0.04, 0.012), m.acoArma, a, -0.02, 0.0, 0);                    // armação
  mesh(rbox(0.075, 0.17, 0.05, 0.02), m.madeiraCabo, a, -0.1, -0.08, 0, 0, 0, 0.42);    // cabo
  mesh(new THREE.TorusGeometry(0.032, 0.006, 8, 18, Math.PI), m.acoArma, a, -0.01, -0.045, 0, 0, 0, Math.PI);
  mesh(rbox(0.012, 0.035, 0.008, 0.003), m.acoArma, a, -0.012, -0.05, 0, 0, 0, 0.3);   // gatilho
  mesh(rbox(0.03, 0.03, 0.012, 0.005), m.acoArma, a, -0.075, 0.05, 0, 0, 0, -0.5);    // cão
  a.rotation.x = -Math.PI / 2; a.position.y = 0.022;
  g.add(a);
  return g;
}

/* ============================================================ TV ANTIGA */
function tv(p, ctx) {
  const m = mats(), g = grupo('tv');
  const W = 1.12, H = 0.76, D = 0.6, y0 = 0.05;
  mesh(rbox(W, H, D, 0.06, 4), m.metalTV, g, 0, y0 + H / 2, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(new THREE.CylinderGeometry(0.03, 0.025, y0, 12), m.prataEsc, g, sx * (W / 2 - 0.08), y0 / 2, sz * (D / 2 - 0.08));
  // moldura do tubo
  const sw = 0.66, shh = 0.44, cx = -0.18, cy = y0 + H / 2 + 0.07, zf = D / 2;
  const ext = new THREE.Shape(); const rr = 0.07;
  const rr2 = (s, w, h, r) => { s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); return s; };
  rr2(ext, sw + 0.1, shh + 0.1, rr + 0.03); ext.holes.push(rr2(new THREE.Path(), sw, shh, rr));
  mesh(new THREE.ExtrudeGeometry(ext, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 8 }), m.cromo, g, cx, cy, zf - 0.01);
  // tela abaulada (CRT)
  const tela = new THREE.PlaneGeometry(sw, shh, 24, 16), tp = tela.attributes.position;
  for (let i = 0; i < tp.count; i++) { const u = tp.getX(i) / (sw / 2), v = tp.getY(i) / (shh / 2); tp.setZ(i, 0.035 * (1 - u * u * 0.6) * (1 - v * v * 0.6)); }
  tela.computeVertexNormals();
  const telaM = mat({ color: '#ffffff', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.85 });
  const tm = mesh(tela, telaM, g, cx, cy, zf - 0.025);
  tm.castShadow = false; tm.name = 'tela';
  aplicarTela(tm, p, ctx);
  // coluna de controles
  const px = W / 2 - 0.17;
  mesh(rbox(0.26, 0.6, 0.02, 0.02), m.metalTV, g, px, cy, zf);
  for (const [dy, rad] of [[0.2, 0.065], [0.04, 0.05]]) {
    mesh(new THREE.CylinderGeometry(rad, rad, 0.025, 32), m.cromo, g, px, cy + dy, zf + 0.012, Math.PI / 2);
    mesh(new THREE.CylinderGeometry(rad * 0.8, rad * 0.8, 0.012, 32), m.creme, g, px, cy + dy, zf + 0.026, Math.PI / 2);
    mesh(new THREE.BoxGeometry(0.004, rad * 0.7, 0.004), mat({ color: '#b3172a' }), g, px, cy + dy + rad * 0.2, zf + 0.034, 0, 0, 0.6);
  }
  for (let k = 0; k < 6; k++) mesh(new THREE.BoxGeometry(0.2, 0.008, 0.01), m.pretoFosco, g, px, cy - 0.12 - k * 0.022, zf + 0.012);
  // fileira de botões embaixo
  for (let k = 0; k < 6; k++) {
    const bx = -W / 2 + 0.12 + k * 0.105;
    mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.035, 20), k % 2 ? m.creme : m.cromo, g, bx, y0 + 0.1, zf + 0.012, Math.PI / 2);
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12), m.pretoLaca, g, bx, y0 + 0.1, zf + 0.04, Math.PI / 2);
  }
  mesh(rbox(W - 0.08, 0.16, 0.02, 0.02), m.metalTV, g, 0, y0 + 0.1, zf - 0.004);
  return g;
}
export function aplicarTela(tm, p, ctx) {
  const M2 = tm.material;
  if (M2.map && M2.map.userData.atualizar) ctx.animaveis.delete(M2.map);
  let t;
  if ((p.tela || 'chuvisco') === 'chuvisco') { t = TX.chuvisco(); ctx.animaveis.add(t); }
  else t = texturaFoto(p.tela === 'original' ? 'tv_tela' : p.tela, 0.66, 0.44);
  M2.map = t; M2.emissiveMap = t; M2.needsUpdate = true;
}

/* ============================================================ MESINHA (madeira escura) */
function mesinha() {
  const m = mats(), g = grupo('mesinha');
  const W = 1.45, D = 0.82, H = 0.66;
  mesh(rbox(W, 0.06, D, 0.012), m.madeiraEsc, g, 0, H - 0.03, 0);
  mesh(rbox(W - 0.1, 0.04, D - 0.1, 0.01), m.madeiraEsc, g, 0, 0.16, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(rbox(0.07, H - 0.06, 0.07, 0.01), m.madeiraEsc, g, sx * (W / 2 - 0.06), (H - 0.06) / 2, sz * (D / 2 - 0.06));
  for (const sz of [-1, 1]) mesh(rbox(W - 0.14, 0.09, 0.03, 0.008), m.madeiraEsc, g, 0, H - 0.1, sz * (D / 2 - 0.05));
  return g;
}

/* ============================================================ ESTATUETA (ídolo de prata) */
function estatueta() {
  const m = mats(), g = grupo('estatueta');
  const perfil = [[0, 0], [0.12, 0], [0.125, 0.02], [0.11, 0.04], [0.1, 0.08], [0.085, 0.15], [0.07, 0.22], [0.055, 0.28], [0.06, 0.31], [0.045, 0.33], [0, 0.34]].map(([x, y]) => new THREE.Vector2(x, y));
  mesh(new THREE.LatheGeometry(perfil, 40), m.prata, g);
  for (const [y, r] of [[0.05, 0.106], [0.12, 0.091], [0.2, 0.074], [0.27, 0.058]]) mesh(new THREE.TorusGeometry(r, 0.006, 8, 40), m.prataEsc, g, 0, y, 0, Math.PI / 2);
  mesh(new THREE.SphereGeometry(0.05, 24, 16), m.prata, g, 0, 0.385, 0).scale.set(1, 1.15, 0.9);
  for (const s of [-1, 1]) {
    const chifre = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.02 * s, 0.41, 0], [0.06 * s, 0.45, 0], [0.065 * s, 0.5, 0], [0.045 * s, 0.53, 0]].map((v) => new THREE.Vector3(...v))), 12, 0.009, 8);
    mesh(chifre, m.prata, g);
    const braco = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.04 * s, 0.29, 0], [0.1 * s, 0.31, 0.01], [0.14 * s, 0.37, 0.01], [0.15 * s, 0.43, 0]].map((v) => new THREE.Vector3(...v))), 16, 0.014, 8);
    mesh(braco, m.prata, g);
    mesh(new THREE.SphereGeometry(0.018, 12, 10), m.prata, g, 0.15 * s, 0.44, 0);
    mesh(new THREE.SphereGeometry(0.009, 10, 8), m.pretoLaca, g, 0.018 * s, 0.395, 0.043);
  }
  mesh(new THREE.TorusGeometry(0.03, 0.007, 8, 20), m.prataEsc, g, 0, 0.17, 0.075, -0.3);
  return g;
}

/* ============================================================ CAIXINHA preta e branca */
function caixinha() {
  const m = mats(), g = grupo('caixinha');
  const c = document.createElement('canvas'); c.width = 512; c.height = 200; const x = c.getContext('2d');
  x.fillStyle = '#121212'; x.fillRect(0, 0, 512, 200); x.strokeStyle = '#f2f2f2'; x.lineWidth = 6;
  for (let k = 0; k < 7; k++) { x.beginPath(); x.arc(40 + k * 75, 100 + (k % 2 ? 30 : -30), 34, k, k + 4.2); x.stroke(); }
  x.fillStyle = '#c4161c'; x.fillRect(236, 70, 40, 60); x.fillRect(216, 90, 80, 20);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const lado = mat({ map: t, roughness: 0.35, clearcoat: 0.6 }), preto = mat({ color: '#141414', roughness: 0.35, clearcoat: 0.6 });
  const b = mesh(rbox(0.42, 0.16, 0.24, 0.03), [preto], g, 0, 0.08, 0);
  b.material = preto;
  mesh(new THREE.PlaneGeometry(0.38, 0.14), lado, g, 0, 0.08, 0.1205).castShadow = false;
  mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 20, Math.PI), m.cromo, g, 0, 0.16, 0);
  return g;
}

/* ============================================================ MINIATURA DE ÔNIBUS (o "Vasco" de cima da TV) */
// Ônibus rodoviário de dois andares em miniatura: preto, faixa branca, escudo branco com cruz vermelha
// na lateral, para-brisa grande e 3 eixos. p.imagem = imagem própria para a lateral (adesivo).
function canvasTex(w, h, desenha) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; desenha(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function ladoOnibus(x, W, H) {
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a2b2f'); g.addColorStop(0.5, '#141416'); g.addColorStop(1, '#0b0b0c');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // janelas dos dois andares (vidro fumê com reflexo)
  const vid = (y, h) => { const gv = x.createLinearGradient(0, y, 0, y + h); gv.addColorStop(0, '#3b4350'); gv.addColorStop(0.45, '#1a1e25'); gv.addColorStop(1, '#0d0f13'); x.fillStyle = gv; x.fillRect(W * 0.16, y, W * 0.8, h); };
  vid(H * 0.1, H * 0.2); vid(H * 0.42, H * 0.17);
  x.strokeStyle = 'rgba(0,0,0,.7)'; x.lineWidth = 6;
  for (let k = 1; k < 7; k++) { const xx = W * (0.16 + k * 0.8 / 7); x.beginPath(); x.moveTo(xx, H * 0.1); x.lineTo(xx, H * 0.3); x.moveTo(xx, H * 0.42); x.lineTo(xx, H * 0.59); x.stroke(); }
  // faixa branca em diagonal (corre da frente para o teto)
  x.fillStyle = '#e9e9e6'; x.beginPath(); x.moveTo(W * 0.02, H * 0.86); x.bezierCurveTo(W * 0.25, H * 0.8, W * 0.32, H * 0.25, W * 0.42, 0); x.lineTo(W * 0.455, 0); x.bezierCurveTo(W * 0.35, H * 0.3, W * 0.28, H * 0.86, W * 0.02, H * 0.92); x.fill();
  // escudo branco com cruz vermelha
  const ex = W * 0.66, ey = H * 0.2, ew = W * 0.15, eh = H * 0.62;
  x.fillStyle = '#d8d8d4'; x.strokeStyle = '#f4f4f2'; x.lineWidth = 5;
  x.beginPath(); x.moveTo(ex, ey); x.lineTo(ex + ew, ey); x.lineTo(ex + ew, ey + eh * 0.55); x.quadraticCurveTo(ex + ew, ey + eh * 0.9, ex + ew / 2, ey + eh); x.quadraticCurveTo(ex, ey + eh * 0.9, ex, ey + eh * 0.55); x.closePath(); x.fill(); x.stroke();
  x.fillStyle = '#c3161c'; const cx = ex + ew / 2, cy = ey + eh * 0.45, a = ew * 0.36, b = ew * 0.1;
  x.beginPath();
  x.moveTo(cx - b, cy - b); x.lineTo(cx - a * 0.75, cy - a * 1.15); x.lineTo(cx + a * 0.75, cy - a * 1.15); x.lineTo(cx + b, cy - b);
  x.lineTo(cx + a * 1.0, cy - a * 0.6); x.lineTo(cx + a * 1.0, cy + a * 0.6); x.lineTo(cx + b, cy + b);
  x.lineTo(cx + a * 0.75, cy + a * 1.5); x.lineTo(cx - a * 0.75, cy + a * 1.5); x.lineTo(cx - b, cy + b);
  x.lineTo(cx - a * 1.0, cy + a * 0.6); x.lineTo(cx - a * 1.0, cy - a * 0.6); x.closePath(); x.fill();
  // flâmula cinza saindo do escudo e detalhes
  x.fillStyle = 'rgba(200,200,196,.55)'; x.beginPath(); x.moveTo(ex + ew, ey + eh * 0.1); x.bezierCurveTo(W * 0.88, H * 0.05, W * 0.93, H * 0.3, W * 0.99, H * 0.22); x.lineTo(W * 0.99, H * 0.3); x.bezierCurveTo(W * 0.92, H * 0.38, W * 0.88, H * 0.2, ex + ew, ey + eh * 0.22); x.fill();
  x.fillStyle = '#0a0a0a'; x.fillRect(0, H * 0.93, W, H * 0.07);   // saia
}
function onibus(p) {
  const m = mats(), g = grupo('onibus');
  const L = 0.5, Hc = 0.165, Wd = 0.12, y0 = 0.024;
  const lado = p.imagem ? texturaFoto(p.imagem, L, Hc) : canvasTex(1024, 340, ladoOnibus);
  const ladoB = lado.clone(); ladoB.needsUpdate = true; ladoB.wrapS = THREE.RepeatWrapping; ladoB.repeat.x = -1; ladoB.offset.x = 1;
  const frente = canvasTex(256, 340, (x, W, H) => {
    x.fillStyle = '#121214'; x.fillRect(0, 0, W, H);
    const gv = x.createLinearGradient(0, 0, W, H); gv.addColorStop(0, '#5b6675'); gv.addColorStop(0.4, '#1b2029'); gv.addColorStop(1, '#0c0e12');
    x.fillStyle = gv; x.fillRect(W * 0.08, H * 0.06, W * 0.84, H * 0.26); x.fillRect(W * 0.08, H * 0.38, W * 0.84, H * 0.33);
    x.fillStyle = '#f2f2ee'; x.fillRect(W * 0.08, H * 0.78, W * 0.2, H * 0.06); x.fillRect(W * 0.72, H * 0.78, W * 0.2, H * 0.06);
    x.fillStyle = '#9a9a9a'; x.fillRect(W * 0.34, H * 0.8, W * 0.32, H * 0.08);
  });
  const tras = canvasTex(256, 340, (x, W, H) => {
    x.fillStyle = '#141416'; x.fillRect(0, 0, W, H); x.fillStyle = '#1d2027'; x.fillRect(W * 0.12, H * 0.08, W * 0.76, H * 0.2);
    x.fillStyle = '#c31a1a'; x.fillRect(W * 0.06, H * 0.62, W * 0.12, H * 0.18); x.fillRect(W * 0.82, H * 0.62, W * 0.12, H * 0.18);
  });
  const verniz = { roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12 };
  const preto = mat({ color: '#101012', ...verniz });
  // caixa com materiais por face: +x frente, -x trás, +y teto, -y chão, +z lado, -z lado
  const geo = new THREE.BoxGeometry(L, Hc, Wd);
  const caixa = mesh(geo, [mat({ map: frente, ...verniz }), mat({ map: tras, ...verniz }), preto, preto, mat({ map: lado, ...verniz }), mat({ map: ladoB, ...verniz })], g, 0, y0 + Hc / 2, 0);
  caixa.name = 'carroceria';
  // cantos arredondados de miniatura: teto e frente com "capô" curvo
  mesh(new THREE.CylinderGeometry(0.018, 0.018, Wd, 16, 1, false, 0, Math.PI / 2), preto, g, L / 2 - 0.018, y0 + Hc - 0.018, 0, Math.PI / 2, 0, 0).scale.set(1, 1, 1);
  // rodas: 1 eixo na frente, 2 atrás
  const pneu = mat({ color: '#0c0c0c', roughness: 0.85 }), r = 0.022;
  for (const ex of [L * 0.33, -L * 0.26, -L * 0.38]) for (const sz of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(r, r, 0.018, 20), pneu, g, ex, r, sz * (Wd / 2 - 0.006), Math.PI / 2);
    mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.002, 16), m.cromo, g, ex, r, sz * (Wd / 2 + 0.0035), Math.PI / 2);
  }
  // retrovisores "chifre" na frente
  for (const sz of [-1, 1]) mesh(new THREE.BoxGeometry(0.008, 0.03, 0.006), preto, g, L / 2 + 0.008, y0 + Hc * 0.72, sz * (Wd / 2 + 0.006));
  return g;
}

/* ============================================================ GUARDA-SOL de praia */
function guardaSol(p) {
  const g = grupo('guarda_sol');
  const R = p.raio ?? 1.25, alt = p.altura ?? 2.25, n = 10, c1 = p.cor || '#f6c21a', c2 = p.cor2 || '#d6262b';
  const haste = mat({ color: '#f3f1ea', roughness: 0.4, metalness: 0.2 });
  const incl = (p.inclinacao ?? 8) * Math.PI / 180;
  const topo = grupo('topo'); topo.rotation.z = incl; g.add(topo);
  mesh(new THREE.CylinderGeometry(0.02, 0.022, alt, 12), haste, topo, 0, alt / 2, 0);
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 12), haste, topo, 0, alt * 0.62, 0);
  // lona em gomos (cone aberto com leve "barriga" entre as varetas)
  const geo = new THREE.CylinderGeometry(0.004, R, 0.48, n * 4, 6, true);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i), a = Math.atan2(z, x), rr = Math.hypot(x, z);
    const gomo = Math.abs(Math.sin((a * n) / 2));             // 0 nas varetas, 1 no meio do gomo
    pos.setY(i, y - gomo * 0.035 * (rr / R));
  }
  geo.computeVertexNormals();
  const tex = canvasTex(1024, 64, (x, W, H) => { for (let k = 0; k < n; k++) { x.fillStyle = k % 2 ? c2 : c1; x.fillRect((k * W) / n, 0, W / n + 1, H); } });
  const lona = mesh(geo, mat({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.22, roughness: 0.75, side: THREE.DoubleSide, sheen: 0.4, sheenColor: new THREE.Color('#ffffff') }), topo, 0, alt + 0.2, 0);   // emissive = sol atravessando a lona
  lona.name = 'lona';
  // babado na borda
  const bab = new THREE.CylinderGeometry(R * 0.995, R * 0.995, 0.09, n * 4, 1, true);
  mesh(bab, mat({ map: tex, roughness: 0.8, side: THREE.DoubleSide }), topo, 0, alt - 0.08, 0);
  // varetas
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + Math.PI / n;
    const ap = new THREE.Vector3(0, alt + 0.44, 0), base = new THREE.Vector3(Math.cos(a) * R * 0.99, alt - 0.06, Math.sin(a) * R * 0.99);
    const d = base.clone().sub(ap), v = mesh(new THREE.CylinderGeometry(0.006, 0.006, d.length(), 6), haste, topo);
    v.position.copy(ap).addScaledVector(d, 0.5); v.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  }
  mesh(new THREE.SphereGeometry(0.035, 12, 8), haste, topo, 0, alt + 0.45, 0);
  return g;
}

/* ============================================================ COQUEIRO */
function texFolha() {
  return canvasTex(128, 512, (x, W, H) => {
    x.clearRect(0, 0, W, H);
    // folíolos saindo da nervura central
    for (let i = 0; i < 46; i++) {
      const y = 10 + (i / 46) * (H - 20), larg = W * 0.48 * Math.sin(Math.PI * (0.12 + 0.88 * i / 46)) + 6;
      x.strokeStyle = `hsl(${92 + Math.random() * 18},${48 + Math.random() * 14}%,${24 + Math.random() * 12}%)`; x.lineWidth = 5 + Math.random() * 2;
      for (const s of [-1, 1]) { x.beginPath(); x.moveTo(W / 2, y); x.quadraticCurveTo(W / 2 + s * larg * 0.5, y + 6, W / 2 + s * larg, y + 22 + Math.random() * 6); x.stroke(); }
    }
    x.strokeStyle = '#6a7a2a'; x.lineWidth = 4; x.beginPath(); x.moveTo(W / 2, 0); x.lineTo(W / 2, H); x.stroke();
  });
}
let FOLHA = null;
function coqueiro(p, ctx) {
  const g = grupo('coqueiro');
  const alt = p.altura ?? 6.5, curva = p.curva ?? 1.4, seed = p.semente ?? 1;
  let sr = seed * 9301 + 49297; const r = () => ((sr = (sr * 9301 + 49297) % 233280) / 233280);
  // tronco curvo, mais fino em cima, com anéis
  const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector3(curva * t * t, alt * t, curva * 0.25 * Math.sin(t * 2))); }
  const curvaT = new THREE.CatmullRomCurve3(pts);
  const tg = new THREE.TubeGeometry(curvaT, 40, 0.17, 10, false);
  const tp = tg.attributes.position, uv = tg.attributes.uv;
  for (let i = 0; i < tp.count; i++) {
    const t = uv.getX(i), c = curvaT.getPoint(t), k = 1 - 0.45 * t;
    tp.setXYZ(i, c.x + (tp.getX(i) - c.x) * k * (t < 0.05 ? 1.3 - t * 6 : 1), tp.getY(i), c.z + (tp.getZ(i) - c.z) * k * (t < 0.05 ? 1.3 - t * 6 : 1));
  }
  tg.computeVertexNormals();
  const casca = canvasTex(64, 512, (x, W, H) => {
    x.fillStyle = '#8a6f4f'; x.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 9 + Math.random() * 4) { x.fillStyle = `rgba(60,42,25,${0.35 + Math.random() * 0.3})`; x.fillRect(0, y, W, 3); x.fillStyle = 'rgba(190,165,130,.25)'; x.fillRect(0, y + 3, W, 2); }
  });
  casca.wrapS = casca.wrapT = THREE.RepeatWrapping; casca.repeat.set(1, 6);
  mesh(tg, mat({ map: casca, roughness: 0.95 }), g);
  // copa
  const topo = curvaT.getPoint(1), copa = grupo('copa'); copa.position.copy(topo); g.add(copa);
  FOLHA ||= texFolha();
  const mf = mat({ map: FOLHA, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7, sheen: 0.3 });
  const nF = 11;
  for (let i = 0; i < nF; i++) {
    const comp = 2.0 + r() * 0.8, geo = new THREE.PlaneGeometry(1.15, comp, 1, 12);
    geo.translate(0, comp / 2, 0);
    const pa = geo.attributes.position;
    for (let k = 0; k < pa.count; k++) { const y = pa.getY(k), t = y / comp; pa.setZ(k, -t * t * comp * 0.85); pa.setX(k, pa.getX(k) * (1 - Math.abs(pa.getX(k)) * 0.3 * t)); }
    geo.computeVertexNormals();
    const f = new THREE.Mesh(geo, mf); f.castShadow = true;
    const piv = new THREE.Group(); piv.rotation.y = (i / nF) * Math.PI * 2 + r() * 0.4; piv.add(f);
    f.rotation.x = -Math.PI / 2 + 0.35 + r() * 0.45;   // sai quase na horizontal, subindo um pouco; a curva da geometria faz a queda
    copa.add(piv);
  }
  for (let i = 0; i < 4; i++) mesh(new THREE.SphereGeometry(0.11, 12, 10), mat({ color: i % 2 ? '#5a6b23' : '#6b5326', roughness: 0.6 }), copa, Math.cos(i * 1.7) * 0.14, -0.12, Math.sin(i * 1.7) * 0.14);
  // balanço no vento
  const fase = r() * 10;
  ctx?.animacoes.set(g, (t) => { copa.rotation.z = Math.sin(t * 0.7 + fase) * 0.04; copa.rotation.x = Math.sin(t * 0.53 + fase * 2) * 0.03; });
  return g;
}

/* ============================================================ QUADRO (moldura + foto) */
export const MOLDURAS = {
  dourada: { nome: 'Dourada', borda: 0.11, prof: 0.05, mat: 'ouro', friso: 'ouroVelho' },
  dourada_clara: { nome: 'Dourada clara', borda: 0.07, prof: 0.04, mat: 'ouroClaro', friso: 'ouro' },
  madeira: { nome: 'Madeira rústica', borda: 0.1, prof: 0.05, mat: 'madeiraQuadro', friso: 'madeiraEsc' },
  preta: { nome: 'Preta', borda: 0.07, prof: 0.045, mat: 'pretoLaca', friso: null },
  preta_fina: { nome: 'Preta fina', borda: 0.03, prof: 0.035, mat: 'pretoLaca', friso: null },
  prata: { nome: 'Prateada', borda: 0.07, prof: 0.04, mat: 'prata', friso: 'prataEsc' },
  branca: { nome: 'Branca com paspatur', borda: 0.05, prof: 0.04, mat: 'branco', friso: null, paspatur: 0.08 },
  nenhuma: { nome: 'Sem moldura (placa)', borda: 0, prof: 0.02, mat: null, friso: null },
};
function anel(w, h, b, r = 0) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 - b, -h / 2 - b); s.lineTo(w / 2 + b, -h / 2 - b); s.lineTo(w / 2 + b, h / 2 + b); s.lineTo(-w / 2 - b, h / 2 + b); s.lineTo(-w / 2 - b, -h / 2 - b);
  const hole = new THREE.Path(); hole.moveTo(-w / 2, -h / 2); hole.lineTo(-w / 2, h / 2); hole.lineTo(w / 2, h / 2); hole.lineTo(w / 2, -h / 2); hole.lineTo(-w / 2, -h / 2);
  s.holes.push(hole); return s;
}
function quadro(p) {
  const m = mats(), g = grupo('quadro');
  const w = p.largura ?? 0.5, h = p.altura ?? 0.65, st = MOLDURAS[p.moldura || 'dourada'] || MOLDURAS.dourada;
  const pas = st.paspatur ? Math.min(w, h) * st.paspatur * 1.2 : 0;
  const fw = w - 2 * pas, fh = h - 2 * pas;
  const b = st.borda * Math.min(1, Math.max(0.45, Math.sqrt(w * h) / 0.75)), d = st.prof;
  const corpo = grupo('quadro_corpo'); g.add(corpo);
  // fundo (chassi)
  mesh(new THREE.BoxGeometry(w + b * 1.6, h + b * 1.6, 0.012), m.pretoFosco, corpo, 0, 0, 0.006);
  if (st.mat) {
    const e = Math.min(b * 0.35, 0.025);
    const geo = new THREE.ExtrudeGeometry(anel(w + e * 2, h + e * 2, b - e * 2), { depth: d - e, bevelEnabled: true, bevelThickness: e, bevelSize: e, bevelSegments: 4, curveSegments: 4 });
    mesh(geo, m[st.mat], corpo, 0, 0, 0.004);
    if (st.friso) { // friso interno (lábio) em outro tom
      const f = Math.max(0.008, b * 0.18);
      mesh(new THREE.ExtrudeGeometry(anel(w, h, f), { depth: d * 0.55, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2 }), m[st.friso], corpo, 0, 0, 0.006);
    }
  } else {
    mesh(rbox(w + 0.01, h + 0.01, d, 0.006), m.pretoFosco, corpo, 0, 0, d / 2);
  }
  if (pas) mesh(new THREE.PlaneGeometry(w, h), mat({ color: '#f4f0e6', roughness: 0.9 }), corpo, 0, 0, 0.0125);
  const foto = mesh(new THREE.PlaneGeometry(fw, fh), new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0 }), corpo, 0, 0, st.mat ? 0.014 : d + 0.001);
  foto.name = 'foto'; foto.castShadow = false;
  foto.material.map = p.foto ? texturaFoto(p.foto, fw, fh) : TX.semFoto();
  // sombra suave do quadro na parede (deslocada para baixo, como luz de cima)
  const sc = document.createElement('canvas'); sc.width = sc.height = 128; const sx = sc.getContext('2d');
  sx.filter = 'blur(14px)'; sx.fillStyle = 'rgba(0,0,0,0.9)'; sx.fillRect(26, 26, 76, 76);
  const sombra = new THREE.Mesh(new THREE.PlaneGeometry((w + b * 2) * 1.5, (h + b * 2) * 1.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
  sombra.position.set(0.02, -0.05, 0.002); sombra.userData.semClique = true; sombra.renderOrder = 1; corpo.add(sombra);
  // prego + arame
  mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 8), m.galvanizado, g, 0, h / 2 + b * 0.6, 0.01, Math.PI / 2);
  corpo.rotation.z = (p.inclinacao ?? 0) * Math.PI / 180;
  return g;
}

/* ============================================================ BANDEIRA (pano 3D com vento) */
// Pano pregado na parede pelos 4 cantos (igual à foto): as bordas ficam quase presas e o meio
// "respira" com rajadas de vento vindas da janela, com ondas que correm pelo pano e pregas leves.
function bandeira(p, ctx) {
  const g = grupo('bandeira'), m = mats();
  const w = p.largura ?? 2.2, h = p.altura ?? 1.36, nx = 44, ny = 28;
  const geo = new THREE.PlaneGeometry(w, h, nx, ny);
  geo.translate(0, -h / 2, 0);
  const base = geo.attributes.position.array.slice();
  const t = texturaFoto(p.imagem || 'bandeira', w, h);
  const pano = mesh(geo, mat({ map: t, roughness: 0.82, sheen: 0.7, sheenRoughness: 0.55, sheenColor: new THREE.Color('#ffffff'), side: THREE.DoubleSide }), g, 0, 0, 0.03);
  pano.name = 'pano';
  // pregos nos 4 cantos
  for (const sx of [-1, 1]) for (const yy of [-0.03, -h + 0.03]) {
    mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.06, 10), m.galvanizado, g, sx * (w / 2 - 0.035), yy, 0.03, Math.PI / 2);
    mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 14), m.galvanizado, g, sx * (w / 2 - 0.035), yy, 0.06, Math.PI / 2);
  }
  const seed = Math.random() * 100;
  const anima = (tempo) => {
    const pa = geo.attributes.position, A = p.vento ?? 1, T = tempo + seed;
    // rajada: força que sobe e desce devagar (nunca para totalmente)
    const raj = 0.55 + 0.3 * Math.sin(T * 0.37) * Math.sin(T * 0.13 + 1) + 0.15 * Math.sin(T * 1.7) * Math.max(0, Math.sin(T * 0.21));
    for (let i = 0; i < pa.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], u = Math.min(1, Math.max(0, x / w + 0.5)), v = Math.min(1, Math.max(0, -y / h));
      // presa nos cantos (pregos); as bordas cedem um pouco, o meio solto
      const solto = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.7) * (0.3 + 0.7 * Math.pow(Math.max(0, Math.sin(Math.PI * v)), 0.8)) + 0.18 * Math.sin(Math.PI * u) * (v > 0.5 ? 1 : 0.3);
      const onda = Math.sin(x * 3.2 - T * 1.9 + y * 0.8) * 0.032 + Math.sin(x * 7.5 - T * 3.1 - y * 2.2) * 0.011 + Math.sin(y * 5.5 + T * 1.3 + x * 1.5) * 0.008;
      const barriga = 0.035 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);   // ar empurrando o meio
      const pregas = Math.sin(u * Math.PI * 7 + 0.6) * 0.006 * (0.4 + v);        // dobras de pano guardado
      pa.setZ(i, (onda * raj * A + barriga * raj * A) * solto + pregas + 0.004);
      // o pano encolhe um tiquinho na horizontal quando estufa (não estica)
      pa.setX(i, x * (1 - 0.006 * raj * A * Math.sin(Math.PI * v)));
      pa.setY(i, y - 0.012 * Math.sin(Math.PI * u) * Math.pow(v, 1.5));          // a barra de baixo cede
    }
    pa.needsUpdate = true; geo.computeVertexNormals();
  };
  anima(0);
  ctx.animacoes.set(g, anima);
  return g;
}

/* ============================================================ PÔSTER encostado */
function poster(p) {
  const m = mats(), g = grupo('poster');
  const w = p.largura ?? 0.72, h = p.altura ?? 1.08, inc = (p.encosto ?? 12) * Math.PI / 180;
  const corpo = grupo('poster_corpo'); g.add(corpo);
  mesh(rbox(w + 0.04, h + 0.04, 0.025, 0.006), m.pretoLaca, corpo, 0, h / 2 + 0.02, 0);
  const f = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ roughness: 0.35 }), corpo, 0, h / 2 + 0.02, 0.0135);
  f.name = 'foto'; f.castShadow = false;
  f.material.map = texturaFoto(p.imagem || 'poster', w, h);
  corpo.rotation.x = -inc; // encosta na parede atrás (−z)
  return g;
}

/* ============================================================ RODO */
function rodo(p) {
  const m = mats(), g = grupo('rodo'), c = grupo('rodo_corpo'); g.add(c);
  const L = 1.55, cor = mat({ color: p.cor || '#d0151d', roughness: 0.35, clearcoat: 0.4 });
  mesh(new THREE.CylinderGeometry(0.016, 0.016, L, 16), mat({ color: '#25345c', roughness: 0.35, metalness: 0.6 }), c, 0, L / 2 + 0.06, 0);
  mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 16), cor, c, 0, L + 0.02, 0);
  mesh(rbox(0.6, 0.06, 0.07, 0.015), cor, c, 0, 0.05, 0);
  mesh(rbox(0.6, 0.03, 0.012, 0.004), m.borracha, c, 0, 0.012, 0.0);
  mesh(rbox(0.06, 0.09, 0.05, 0.012), cor, c, 0, 0.1, 0);
  c.rotation.x = -(p.encosto ?? 14) * Math.PI / 180;
  return g;
}

/* ============================================================ LÂMPADA pendurada (balança) */
function lampada(p, ctx) {
  const g = grupo('lampada'), m = mats();
  const fio = p.fio ?? 1.0, pend = grupo('pendulo'); g.add(pend);
  mesh(new THREE.CylinderGeometry(0.004, 0.004, fio, 6), m.pretoFosco, pend, 0, -fio / 2, 0);
  mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.06, 16), m.pretoFosco, pend, 0, -fio - 0.03, 0);
  const vidro = mat({ color: '#fff3d6', emissive: new THREE.Color('#ffcf7a'), emissiveIntensity: 3, roughness: 0.2, transmission: 0.2 });
  const b = mesh(new THREE.SphereGeometry(0.055, 24, 16), vidro, pend, 0, -fio - 0.1, 0); b.castShadow = false;
  b.scale.set(1, 1.2, 1);
  const luz = new THREE.PointLight(0xffc27a, p.intensidade ?? 7, 9, 2);
  luz.position.set(0, -fio - 0.12, 0); luz.castShadow = !!ctx.qualidade.sombraLampada;
  luz.shadow.mapSize.set(512, 512); luz.shadow.bias = -0.002; luz.shadow.radius = 4;
  pend.add(luz); g.userData.luz = luz;
  const t0 = Math.random() * 10;
  ctx.animacoes.set(g, (t) => { const a = (p.balanco ?? 1); pend.rotation.z = Math.sin(t * 1.1 + t0) * 0.05 * a; pend.rotation.x = Math.sin(t * 0.8 + t0) * 0.03 * a; luz.intensity = (p.intensidade ?? 7) * (1 + (p.piscar ? (Math.random() < 0.03 ? -0.6 : 0) : 0)); });
  return g;
}

/* ============================================================ GARRAFA d'água */
function garrafa() {
  const g = grupo('garrafa');
  const pf = [[0, 0], [0.04, 0], [0.045, 0.01], [0.045, 0.13], [0.04, 0.16], [0.018, 0.2], [0.015, 0.23], [0, 0.23]].map(([x, y]) => new THREE.Vector2(x, y));
  mesh(new THREE.LatheGeometry(pf, 24), mat({ color: '#56b3e8', roughness: 0.08, transmission: 0.85, thickness: 0.05, ior: 1.45, clearcoat: 1 }), g);
  mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.025, 16), mat({ color: '#1e63c4', roughness: 0.4 }), g, 0, 0.24, 0);
  return g;
}

/* ============================================================ ENTULHO (papelão, papel, folhas) */
function entulho(p) {
  const m = mats(), g = grupo('entulho'), r = TX.rng(p.semente ?? 3), R = p.raio ?? 1.2;
  for (let k = 0; k < (p.qtd ?? 22); k++) {
    const tipo = r(), x = (r() - 0.5) * R * 2, z = (r() - 0.5) * R;
    if (tipo < 0.45) mesh(new THREE.BoxGeometry(0.05 + r() * 0.16, 0.004, 0.04 + r() * 0.12), m.papelao, g, x, 0.004, z, (r() - 0.5) * 0.3, r() * 6, (r() - 0.5) * 0.3);
    else if (tipo < 0.75) mesh(amassar(new THREE.PlaneGeometry(0.08 + r() * 0.08, 0.06 + r() * 0.06, 4, 4), 0.01, 40, k), m.papel, g, x, 0.01, z, -Math.PI / 2 + (r() - 0.5) * 0.6, 0, r() * 6);
    else mesh(new THREE.PlaneGeometry(0.03, 0.02), m.folha, g, x, 0.003, z, -Math.PI / 2, 0, r() * 6);
  }
  return g;
}

/* ============================================================ ESCADA de concreto com corrimão */
function escada(p) {
  const m = mats(), g = grupo('escada');
  const n = p.degraus ?? 13, comp = p.comprimento ?? 3.4, alt = p.altura ?? 3.3, larg = p.largura ?? 1.05;
  const pa = comp / n, ea = alt / n;
  const conc = TX.concreto(3), cm = mat({ map: repetir(conc.map, 0.6, 0.3), normalMap: repetir(conc.normalMap, 0.6, 0.3), roughness: 0.92 });
  // degraus sobem para a esquerda (−x). Degraus vizinhos se sobrepõem 2 cm em x; para as faces da frente/fundo
  // não ficarem no MESMO plano (z-fighting = escada "piscando"), os ímpares são 4 mm mais estreitos.
  for (let i = 0; i < n; i++) mesh(rbox(pa + 0.02, ea, larg - (i % 2) * 0.004, 0.012, 2), cm, g, -(i + 0.5) * pa, (i + 0.5) * ea, 0);
  // laje inclinada por baixo: mais estreita e recuada (antes as laterais coincidiam com as dos degraus)
  const ang = Math.atan2(alt, comp), L = Math.hypot(alt, comp);
  mesh(new THREE.BoxGeometry(L, 0.18, larg - 0.05), cm, g, -comp / 2 - 0.06, alt / 2 - 0.12, 0, 0, 0, -ang);
  // corrimão no lado aberto (+z): um pouco mais grosso (fino demais "serrilha" e pisca de longe)
  const zc = larg / 2 - 0.05, hr = 0.95;
  for (let i = 0; i <= n; i += 3) mesh(new THREE.CylinderGeometry(0.024, 0.024, hr, 10), m.galvanizado, g, -i * pa - pa * 0.5, i * ea + hr / 2, zc);
  for (const k of [1, 0.55]) {
    const ini = new THREE.Vector3(-pa * 0.5, ea + hr * k, zc), fim = new THREE.Vector3(-(n - 0.5) * pa, n * ea + hr * k, zc);
    const tubo = new THREE.TubeGeometry(new THREE.LineCurve3(ini, fim), 1, k === 1 ? 0.03 : 0.02, 12);
    mesh(tubo, m.galvanizado, g);
  }
  return g;
}

/* ============================================================ catálogo */
export const CATALOGO = {
  sofa: { nome: 'Sofá velho', fn: sofa, tipo: 'piso' },
  mesa_vermelha: { nome: 'Mesa de bar vermelha', fn: mesaVermelha, tipo: 'piso', campos: ['cor', 'rotulo'] },
  cadeira_skol: { nome: 'Cadeira Skol (do app)', fn: (p, c) => daApp('cadeira_skol', c, p), tipo: 'piso', campos: ['cor'] },
  trono_skol: { nome: 'Trono Skol (do app)', fn: (p, c) => daApp('trono_skol', c, p), tipo: 'piso' },
  mesa_bar: { nome: 'Mesa de bar amarela (do app)', fn: (p, c) => daApp('mesa_bar', c, Object.assign({ x: 0 }, p)), tipo: 'piso', campos: ['cor'] },
  isopor: { nome: 'Isopor (do app)', fn: (p, c) => daApp('isopor', c, Object.assign({ x: 0 }, p)), tipo: 'piso' },
  livro: { nome: 'Livro', fn: livro, tipo: 'piso', campos: ['imagem', 'cor'] },
  revolver: { nome: 'Revólver', fn: revolver, tipo: 'piso' },
  tv: { nome: 'TV antiga', fn: tv, tipo: 'piso', campos: ['tela'] },
  mesinha: { nome: 'Mesinha de madeira', fn: mesinha, tipo: 'piso' },
  estatueta: { nome: 'Estatueta de prata', fn: estatueta, tipo: 'piso' },
  caixinha: { nome: 'Caixinha', fn: caixinha, tipo: 'piso' },
  onibus: { nome: 'Miniatura de ônibus (Vasco)', fn: onibus, tipo: 'piso', campos: ['imagem'] },
  guarda_sol: { nome: 'Guarda-sol', fn: guardaSol, tipo: 'piso', campos: ['cor'] },
  coqueiro: { nome: 'Coqueiro', fn: coqueiro, tipo: 'piso' },
  quadro: { nome: 'Quadro com foto', fn: quadro, tipo: 'parede', campos: ['foto', 'moldura', 'tamanho'] },
  bandeira: { nome: 'Bandeira', fn: bandeira, tipo: 'parede', campos: ['imagem', 'tamanho'] },
  poster: { nome: 'Pôster encostado', fn: poster, tipo: 'piso', campos: ['imagem', 'tamanho'] },
  rodo: { nome: 'Rodo', fn: rodo, tipo: 'piso', campos: ['cor'] },
  lampada: { nome: 'Lâmpada pendurada', fn: lampada, tipo: 'teto' },
  garrafa: { nome: "Garrafa d'água", fn: garrafa, tipo: 'piso' },
  entulho: { nome: 'Entulho no chão', fn: entulho, tipo: 'piso' },
  escada: { nome: 'Escada de concreto', fn: escada, tipo: 'piso' },
};
export function construir(item, ctx) {
  const def = CATALOGO[item.tipo];
  const g = def.fn(item.p || {}, ctx);
  g.userData.itemId = item.id;
  return g;
}
