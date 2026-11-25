// A sala em si: piso de cimento, paredes de concreto, janela com sol entrando, feixe de luz,
// poeira no ar e "AO falso" (escurecimento nos cantos) para funcionar bem mesmo sem GTAO.
import * as THREE from 'three';
import * as TX from './texturas.js';

export const SALA = { esq: -4.3, dir: 4.3, fundo: -2.6, frente: 7, alto: 3.9, parede: 0.2 };
export const PAREDES = {
  fundo: { normal: new THREE.Vector3(0, 0, 1), plano: SALA.fundo + 0.1, rotY: 0 },
  esquerda: { normal: new THREE.Vector3(1, 0, 0), plano: SALA.esq + 0.1, rotY: Math.PI / 2 },
  direita: { normal: new THREE.Vector3(-1, 0, 0), plano: SALA.dir - 0.1, rotY: -Math.PI / 2 },
};
// vão no teto em cima da escada (canto esquerdo do fundo): acima dele só um "poço" escuro, nada é renderizado lá em cima
export const ABERTURA = { x1: -2.5, z1: -1.36, poco: 1.3 };
export const JANELA = { z0: -2.15, z1: -0.75, y0: 1.15, y1: 3.05 };

function rep(t, x, y) { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; }
function matConcreto(seed, rx, ry, tint = '#ffffff') {
  const c = TX.concreto(seed);
  return new THREE.MeshPhysicalMaterial({ map: rep(c.map, rx, ry), normalMap: rep(c.normalMap, rx, ry), roughnessMap: rep(c.roughnessMap, rx, ry), roughness: 1, color: tint, normalScale: new THREE.Vector2(0.9, 0.9) });
}
function caixa(w, h, d, m, x, y, z, parent) {
  const g = new THREE.BoxGeometry(w, h, d);
  // UV em metros (para o concreto não esticar): usa a maior face
  const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    const px = pos.getX(i) + x, py = pos.getY(i) + y, pz = pos.getZ(i) + z;
    if (nx > 0.5) uv.setXY(i, pz / 2.6, py / 2.6); else if (ny > 0.5) uv.setXY(i, px / 2.6, pz / 2.6); else uv.setXY(i, px / 2.6, py / 2.6);
  }
  const m2 = new THREE.Mesh(g, m); m2.position.set(x, y, z); m2.castShadow = true; m2.receiveShadow = true; parent.add(m2); return m2;
}
function textoCanvasJanela() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, '#9fd0f2'); g.addColorStop(0.55, '#e6f2f6'); g.addColorStop(1, '#f6efe0');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  // muro e árvore lá fora (desfocados)
  x.filter = 'blur(10px)';
  x.fillStyle = '#d9cfbf'; x.fillRect(0, 330, 512, 200);
  for (let k = 0; k < 40; k++) { x.fillStyle = `hsl(${95 + Math.random() * 30},${35 + Math.random() * 20}%,${30 + Math.random() * 20}%)`; x.beginPath(); x.arc(Math.random() * 512, 120 + Math.random() * 260, 30 + Math.random() * 50, 0, 6.28); x.fill(); }
  for (let k = 0; k < 26; k++) { x.fillStyle = `hsl(${320 + Math.random() * 20},70%,${70 + Math.random() * 12}%)`; x.beginPath(); x.arc(Math.random() * 200 + 300, Math.random() * 160, 14 + Math.random() * 20, 0, 6.28); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** faixa de "oclusão" (gradiente escuro -> transparente) */
function faixaAO(w, h, opac, parent, pos, rot) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.35, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: t, transparent: true, opacity: opac, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.position.copy(pos); m.rotation.copy(rot); m.renderOrder = 2; parent.add(m); return m;
}

export function criarSala(scene, ctx) {
  const g = new THREE.Group(); g.name = 'sala'; scene.add(g);
  const { esq, dir, fundo, frente, alto, parede: e } = SALA, W = dir - esq;
  // piso
  const ci = TX.cimento();
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(W, frente - fundo), new THREE.MeshPhysicalMaterial({
    map: rep(ci.map, W / 3.2, (frente - fundo) / 3.2), normalMap: rep(ci.normalMap, W / 3.2, (frente - fundo) / 3.2), roughnessMap: rep(ci.roughnessMap, W / 3.2, (frente - fundo) / 3.2),
    roughness: 1, color: '#d8d4cc', clearcoat: 0.08, clearcoatRoughness: 0.6 }));
  piso.rotation.x = -Math.PI / 2; piso.position.set(0, 0, (frente + fundo) / 2); piso.receiveShadow = true; g.add(piso);
  // paredes (caixas com espessura: as da direita formam o vão da janela)
  const mc = matConcreto(3, 1, 1), mcL = matConcreto(3, 1, 1, '#e4e0d8');
  caixa(W + 2 * e, alto, e, mc, 0, alto / 2, fundo - e / 2 + 0.1, g);
  caixa(e, alto, frente - fundo, mcL, esq - e / 2 + 0.1, alto / 2, (frente + fundo) / 2, g);
  const { z0, z1, y0, y1 } = JANELA, xr = dir + e / 2 - 0.1;
  caixa(e, alto, z0 - fundo, mcL, xr, alto / 2, (fundo + z0) / 2, g);
  caixa(e, alto, frente - z1, mcL, xr, alto / 2, (z1 + frente) / 2, g);
  caixa(e, y0, z1 - z0, mcL, xr, y0 / 2, (z0 + z1) / 2, g);
  caixa(e, alto - y1, z1 - z0, mcL, xr, (alto + y1) / 2, (z0 + z1) / 2, g);
  // teto
  const mt = matConcreto(3, 1, 1, '#6a665f'), { x1: ax, z1: az, poco } = ABERTURA, xe = esq - e;
  caixa(dir + e - ax, e, frente - fundo, mt, (ax + dir + e) / 2, alto + e / 2, (frente + fundo) / 2, g);
  caixa(ax - xe, e, frente - az, mt, (xe + ax) / 2, alto + e / 2, (az + frente) / 2, g);
  // poço escuro acima do vão (só as faces de dentro; não projeta sombra)
  const pw = ax - (esq + 0.1), pd = az - (fundo + 0.1);
  const poco3 = new THREE.Mesh(new THREE.BoxGeometry(pw, poco, pd), new THREE.MeshStandardMaterial({ color: '#2a2825', roughness: 1, side: THREE.BackSide }));
  poco3.position.set(esq + 0.1 + pw / 2, alto + poco / 2, fundo + 0.1 + pd / 2); poco3.receiveShadow = true; g.add(poco3);
  // janela: caixilho de alumínio, vidro e "lá fora"
  const alu = new THREE.MeshPhysicalMaterial({ color: '#cfd3d6', metalness: 1, roughness: 0.35 });
  const jx = dir - 0.06, jw = z1 - z0, jh = y1 - y0;
  for (const [w, h, d, y, z] of [[0.06, 0.06, jw, y0, (z0 + z1) / 2], [0.06, 0.06, jw, y1, (z0 + z1) / 2], [0.06, jh, 0.06, (y0 + y1) / 2, z0], [0.06, jh, 0.06, (y0 + y1) / 2, z1], [0.05, jh, 0.05, (y0 + y1) / 2, (z0 + z1) / 2], [0.05, 0.05, jw, y0 + jh * 0.62, (z0 + z1) / 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), alu); m.position.set(jx, y, z); m.castShadow = true; g.add(m);
  }
  const vidro = new THREE.Mesh(new THREE.PlaneGeometry(jw, jh), new THREE.MeshPhysicalMaterial({ color: '#dfeff2', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false }));
  vidro.rotation.y = -Math.PI / 2; vidro.position.set(jx, (y0 + y1) / 2, (z0 + z1) / 2); g.add(vidro);
  const fora = new THREE.Mesh(new THREE.PlaneGeometry(jw * 2.2, jh * 1.8), new THREE.MeshBasicMaterial({ map: textoCanvasJanela(), toneMapped: false }));
  fora.rotation.y = -Math.PI / 2; fora.position.set(dir + 1.2, (y0 + y1) / 2, (z0 + z1) / 2); g.add(fora);
  // fio elétrico na parede do fundo (detalhe de obra)
  const fio = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[-4.2, 3.6], [-2.5, 3.72], [-0.5, 3.6], [1.0, 3.75], [3.0, 3.62], [4.2, 3.7]].map(([x, y]) => new THREE.Vector3(x, y, fundo + 0.13))), 60, 0.008, 6), new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.6 }));
  fio.castShadow = true; g.add(fio);
  // AO falso nos encontros parede/piso e nos cantos
  const z = fundo + 0.1, xl = esq + 0.1, xr2 = dir - 0.1;
  faixaAO(W, 0.7, 0.42, g, new THREE.Vector3(0, 0.002, z + 0.35), new THREE.Euler(-Math.PI / 2, 0, Math.PI));
  faixaAO(frente - z, 0.7, 0.42, g, new THREE.Vector3(xl + 0.35, 0.002, (frente + z) / 2), new THREE.Euler(-Math.PI / 2, 0, -Math.PI / 2));
  faixaAO(frente - z, 0.7, 0.42, g, new THREE.Vector3(xr2 - 0.35, 0.002, (frente + z) / 2), new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2));
  faixaAO(W, 0.6, 0.35, g, new THREE.Vector3(0, 0.3, z + 0.003), new THREE.Euler(0, 0, Math.PI));
  faixaAO(W, 0.5, 0.3, g, new THREE.Vector3(0, alto - 0.25, z + 0.003), new THREE.Euler(0, 0, 0));
  faixaAO(alto, 0.5, 0.35, g, new THREE.Vector3(xl + 0.25, alto / 2, z + 0.004), new THREE.Euler(0, 0, -Math.PI / 2));
  faixaAO(alto, 0.5, 0.35, g, new THREE.Vector3(xr2 - 0.25, alto / 2, z + 0.004), new THREE.Euler(0, 0, Math.PI / 2));
  faixaAO(frente - z, 0.6, 0.35, g, new THREE.Vector3(xl + 0.003, 0.3, (frente + z) / 2), new THREE.Euler(0, Math.PI / 2, Math.PI));
  faixaAO(frente - z, 0.6, 0.35, g, new THREE.Vector3(xr2 - 0.003, 0.3, (frente + z) / 2), new THREE.Euler(0, -Math.PI / 2, Math.PI));
  return g;
}

/** feixe de sol: volume aditivo do vão da janela até o chão, na direção do sol */
export function criarFeixe(scene, dirSol) {
  const { z0, z1, y0, y1 } = JANELA, x = SALA.dir - 0.1;
  const cantos = [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]].map((v) => new THREE.Vector3(...v));
  const d = dirSol.clone().normalize();
  const longe = cantos.map((c) => c.clone().addScaledVector(d, Math.min(9, c.y / -d.y)));
  const pos = [], alfa = [];
  for (let i = 0; i < 4; i++) {
    const a = cantos[i], b = cantos[(i + 1) % 4], c = longe[(i + 1) % 4], e = longe[i];
    pos.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...e.toArray());
    alfa.push(1, 1, 0, 1, 0, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('alfa', new THREE.Float32BufferAttribute(alfa, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { cor: { value: new THREE.Color('#fff1d6') }, forca: { value: 0.09 } },
    vertexShader: 'attribute float alfa; varying float vA; varying vec3 vN; varying vec3 vV; void main(){ vA=alfa; vec4 mv=modelViewMatrix*vec4(position,1.); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 cor; uniform float forca; varying float vA; void main(){ gl_FragColor=vec4(cor*forca*pow(vA,1.4),1.); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const feixe = new THREE.Mesh(geo, m); feixe.renderOrder = 5; feixe.name = 'feixe';
  scene.add(feixe);
  return feixe;
}

/** poeira flutuando (mais visível dentro do feixe) */
export function criarPoeira(scene) {
  const n = 420, pos = new Float32Array(n * 3), fase = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = -1 + Math.random() * 5.2; pos[i * 3 + 1] = Math.random() * 3.4; pos[i * 3 + 2] = -2.4 + Math.random() * 3.6; fase[i] = Math.random() * 6.28; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const base = pos.slice();
  const m = new THREE.PointsMaterial({ size: 0.012, map: TX.radial([[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']], 'poeira'), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: '#fff3dc' });
  const p = new THREE.Points(geo, m); p.name = 'poeira'; scene.add(p);
  p.userData.anima = (t) => {
    const a = geo.attributes.position.array;
    for (let i = 0; i < n; i++) {
      a[i * 3] = base[i * 3] + Math.sin(t * 0.13 + fase[i]) * 0.25;
      a[i * 3 + 1] = (base[i * 3 + 1] + t * 0.02 + Math.sin(t * 0.3 + fase[i]) * 0.05) % 3.5;
      a[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.11 + fase[i]) * 0.2;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return p;
}
