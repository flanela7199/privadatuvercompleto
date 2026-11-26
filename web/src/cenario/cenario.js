// Cenário "Sala 3D": um fundo 3D completo (porão de concreto com sofá, TV, quadros, bandeira...)
// renderizado NA MESMA cena e no MESMO renderer do personagem, então não há segundo programa/
// navegador desenhando 3D. Ativado pela cena do painel com fundo = "sala".
//
// O personagem continua na origem do mundo (as FX de água/papel simulam em espaço de mundo);
// quem se move é a SALA: a raiz da sala é posicionada para que o "lugar do personagem" caia na origem.
//
// API (avatar.js):
//   const c = await criarCenario({ renderer, scene, camera, invoke, invokeRaw });
//   c.ativar() / c.desativar() / c.ativo
//   c.frame(dt, tuber)        -> anima a sala e posiciona a câmera (substitui placeCamera)
//   c.miniatura(fn)           -> roda fn com a sala escondida e as luzes do palco originais (thumbnails)
//   c.editar(on?)             -> abre/fecha o editor da sala dentro da janela do personagem
import * as THREE from 'three';
import { MaterialLib } from '../rig/materials.js';
import { CATALOGO, MOLDURAS, construir, aplicarTela } from './objetos.js';
import { CENA_PADRAO, MIGRAR_POS } from './cena-padrao.js';
import { AMBIENTES } from './ambientes.js';
import { criarEventos, NOMES_EVENTOS } from './eventos.js';
import * as TX from './texturas.js';
import { CANAIS, IDS_CANAIS } from './canais.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const D2R = Math.PI / 180;
// relógio do ciclo dia/noite, compartilhado pelos ambientes (começa de manhã, ~7h)
const relogio = { fase: 0.3 };
const QUAL = { baixa: { sombra: 1024, sombraLampada: false, cada: 3 }, media: { sombra: 2048, sombraLampada: false, cada: 2 }, alta: { sombra: 2048, sombraLampada: true, cada: 1 } };

function normalizar(c, PADRAO = CENA_PADRAO) {
  c.efeitos = Object.assign({}, PADRAO.efeitos, c.efeitos || {});
  c.efeitos.diaNoite ??= true; c.efeitos.eventos ??= true;
  c.camera = Object.assign({}, PADRAO.camera, c.camera || {});
  c.personagem = Object.assign({}, PADRAO.personagem, c.personagem || {});
  for (const it of c.itens) { it.escala ??= 1; it.rot ??= 0; it.visivel ??= true; it.p ??= {}; }
  // migração 0.4.x -> 0.4.4: o que ainda está no lugar antigo vai para o lugar novo
  if (!(c.rev >= 2)) {
    const igual = (a, b) => a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
    for (const it of c.itens) {
      const m = MIGRAR_POS[it.id]; if (!m || !igual(it.pos, m.de)) continue;
      const nv = CENA_PADRAO.itens.find((i) => i.id === it.id); if (!nv) continue;
      it.pos = nv.pos.slice(); if (m.p) Object.assign(it.p, m.p);
    }
    if (igual(c.personagem.pos, [0.35, -0.45])) c.personagem.pos = CENA_PADRAO.personagem.pos.slice();
    if (igual(c.camera.pos, [0.15, 1.95, 6.9]) && igual(c.camera.alvo, [0.15, 1.5, -1.2])) { c.camera.pos = CENA_PADRAO.camera.pos.slice(); c.camera.alvo = CENA_PADRAO.camera.alvo.slice(); }
    c.rev = 2;
  }
  // 0.4.5: a "caixinha" de cima da TV era na verdade a miniatura do ônibus do Vasco
  if (c.rev < 3) {
    for (const it of c.itens) if (it.id === 'caixinha' && it.tipo === 'caixinha') { it.tipo = 'onibus'; it.nome = 'Miniatura de ônibus (Vasco)'; }
    c.rev = 3;
  }
  return c;
}

export async function criarCenario({ renderer, scene, camera, invoke, invokeRaw, ambiente = 'sala', opcoes = {} }) {
  const AMB = AMBIENTES[ambiente] || AMBIENTES.sala, PADRAO = AMB.padrao, LUZ = AMB.luz;
  const CHAVE = AMB.chave;
  /* ------------------------------------------------------------ layout salvo */
  let cena = null;
  const cands = [];
  try { const s = localStorage.getItem(CHAVE); if (s) cands.push(JSON.parse(s)); } catch (e) { /* */ }
  try { // cópia de segurança no privada-data/cache (sobrevive a limpar dados do WebView)
    const buf = await invoke('cache_get', { key: AMB.cache });
    if (buf && buf.byteLength) cands.push(JSON.parse(new TextDecoder().decode(buf)));
  } catch (e) { /* */ }
  cands.sort((a, b) => (b.salvoEm || 0) - (a.salvoEm || 0));
  cena = normalizar(cands.find((c) => c && c.versao === 2 && Array.isArray(c.itens)) || clone(PADRAO), PADRAO);

  /* ------------------------------------------------------------ raiz da sala */
  const raiz = new THREE.Group(); raiz.name = ambiente + '3d'; raiz.visible = false; raiz.userData.cenario = true;
  const q = () => QUAL[cena.efeitos.qualidade] || QUAL.media;
  const ctx = { mats: new MaterialLib({}), animacoes: new Map(), animaveis: new Set(), qualidade: q() };
  // luzes próprias da sala (as do palco são desligadas enquanto a sala está ativa)
  const hemi = new THREE.HemisphereLight(LUZ.hemi[0], LUZ.hemi[1], LUZ.hemi[2]);
  const dirSol = LUZ.sol.dir.clone().normalize();
  const SOL_BASE = LUZ.sol.base;
  const sol = new THREE.DirectionalLight(LUZ.sol.cor, SOL_BASE);
  const alvoSol = LUZ.sol.alvo.clone();
  sol.position.copy(dirSol).multiplyScalar(-14).add(alvoSol);
  sol.target.position.copy(alvoSol);
  sol.castShadow = true; sol.shadow.mapSize.set(q().sombra, q().sombra);
  Object.assign(sol.shadow.camera, LUZ.sol.cam);
  sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.02; sol.shadow.radius = 3;
  const prench = new THREE.DirectionalLight(0xd8e4ff, LUZ.prench); prench.position.set(-2, 3, 6);
  const prench2 = new THREE.PointLight(0xffe2c0, LUZ.prench2, 12, 2); prench2.position.set(-1, 2.6, 2.5);
  // luz suave de frente no personagem (para ele não ficar escuro no meio da sala)
  const luzPers = new THREE.SpotLight(0xfff3e4, 9, 14, 0.42, 0.9, 1.6);
  raiz.add(hemi, sol, sol.target, prench, prench2);
  scene.add(raiz);
  scene.add(luzPers, luzPers.target);
  luzPers.visible = false;
  const mundo = AMB.mundo(raiz, ctx, dirSol);
  const salaG = mundo.chao;
  const feixe = mundo.feixe || null;
  const poeira = mundo.poeira || null;
  const PAREDES = mundo.paredes || {};
  // sombra de contato do personagem (o palco do avatar não tem chão)
  const sombraTex = TX.radial([[0, 'rgba(0,0,0,0.85)'], [0.45, 'rgba(0,0,0,0.4)'], [1, 'rgba(0,0,0,0)']], 'contato');
  const contato = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: sombraTex, transparent: true, depthWrite: false, opacity: 0.6, toneMapped: false }));
  contato.rotation.x = -Math.PI / 2; contato.position.y = 0.003; contato.renderOrder = 1; contato.visible = false;
  scene.add(contato);

  const objs = new Map();
  const tipoDe = (it) => CATALOGO[it.tipo].tipo;
  function descartar(o) { o.traverse((m) => { if (m.isMesh) m.geometry.dispose(); }); }
  function montar(it) {
    const velho = objs.get(it.id);
    if (velho) { ctx.animacoes.delete(velho); raiz.remove(velho); descartar(velho); }
    const g = construir(it, ctx);
    if (tipoDe(it) === 'piso' && !['entulho', 'escada', 'rodo', 'poster'].includes(it.tipo)) {
      const b = new THREE.Box3().setFromObject(g), s = new THREE.Vector3(); b.getSize(s);
      const c = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: sombraTex, transparent: true, depthWrite: false, opacity: 0.55, toneMapped: false }));
      c.rotation.x = -Math.PI / 2; c.position.set((b.min.x + b.max.x) / 2, 0.004, (b.min.z + b.max.z) / 2); c.scale.set(s.x * 1.25 + 0.1, s.z * 1.25 + 0.1, 1);
      c.renderOrder = 1; c.name = 'contato'; c.userData.semClique = true; g.add(c);
    }
    raiz.add(g); objs.set(it.id, g); posicionar(it);
  }
  function posicionar(it) {
    const g = objs.get(it.id); if (!g) return;
    g.position.fromArray(it.pos); g.rotation.set(0, 0, 0);
    if (tipoDe(it) === 'parede') { g.rotation.y = PAREDES[it.p.parede || 'fundo'].rotY; g.rotateZ(it.rot * D2R); }
    else g.rotation.y = it.rot * D2R;
    g.scale.setScalar(it.escala); g.visible = it.visivel;
    chaveMoveis = '?';   // força reaplicar "móvel em uso some" e o lugar do sofá
    if (it.tipo === 'sofa') spotSofa = null;
  }
  const pausaJS = () => new Promise((r) => setTimeout(r, 0));
  /** monta os móveis aos poucos (um por vez, devolvendo o controle entre eles: a cena atual não trava) */
  async function preparar() {
    if (construido) return;
    for (const g of objs.values()) { raiz.remove(g); descartar(g); } objs.clear(); ctx.animacoes.clear();
    for (const it of [...cena.itens]) { if (construido) return; montar(it); await pausaJS(); }
    posicionarRaiz(); aplicarEfeitos(); construido = true;
  }
  /** roda fn() com as luzes/objetos como se o ambiente estivesse na tela (para pré-compilar shaders) */
  function comoVisual(fn) {
    if (ativo) return fn();
    const pal = luzesPalco().map((l) => [l, l.visible]);
    const r0 = raiz.visible, l0 = luzPers.visible, c0 = contato.visible;
    for (const [l] of pal) l.visible = false;
    raiz.visible = true; luzPers.visible = true; contato.visible = true;
    try { return fn(); } finally { for (const [l, v] of pal) l.visible = v; raiz.visible = r0; luzPers.visible = l0; contato.visible = c0; }
  }
  /** manda as texturas para a placa de vídeo aos poucos (antes era tudo no 1º quadro do ambiente) */
  async function subirTexturas() {
    const ts = new Set();
    raiz.traverse((o) => { for (const m of [].concat(o.material || [])) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'clearcoatNormalMap']) if (m[k]?.isTexture) ts.add(m[k]); });
    let n = 0;
    for (const t of ts) { try { renderer.initTexture(t); } catch { /* */ } if (++n % 6 === 0) await pausaJS(); }
  }
  function montarTudo() {
    for (const g of objs.values()) { raiz.remove(g); descartar(g); } objs.clear(); ctx.animacoes.clear();
    for (const it of cena.itens) montar(it);
    posicionarRaiz(); aplicarEfeitos();
  }
  // raiz: o "lugar do personagem" (personagem.pos/rot, coordenadas da sala) vai para a origem do mundo
  function posicionarRaiz(pos, rot) {
    const p = cena.personagem;
    if (!pos && sentado && spotSofa) return;   // sentado no sofá: o lugar é o assento
    pos = pos || p.pos; const r = -((rot ?? p.rot) || 0) * D2R;
    raiz.rotation.set(0, r, 0);
    raiz.position.set(-pos[0], 0, -pos[1]).applyAxisAngle(new THREE.Vector3(0, 1, 0), r);
    raiz.updateMatrixWorld(true);
  }
  function aplicarEfeitos() {
    const e = cena.efeitos;
    diaAplicado = -1; mundo.aplicar?.(e);
    luzPers.intensity = 9 * (e.luzPersonagem ?? 1);
  }

  /* ------------------------------------------------------------ dia / noite */
  // Um dia inteiro a cada 24 minutos (o relógio só anda com um cenário 3D na tela; no gameplay para).
  // fase 0 = meia-noite, 0,25 = nascer do sol, 0,5 = meio-dia, 0,75 = pôr do sol.
  let diaAplicado = -1, ultElev = 99;
  const hemiCeu = new THREE.Color(LUZ.hemi[0]), hemiChao = new THREE.Color(LUZ.hemi[1]), corSol = new THREE.Color(LUZ.sol.cor);
  const C_POR = new THREE.Color('#ff8a3d'), C_LUA = new THREE.Color('#8fa6ff'), C_NOITE = new THREE.Color('#2e3d6b'), C_FEIXE = new THREE.Color('#fff1d6'), C_FEIXE_POR = new THREE.Color('#ffb070');
  const horiz = new THREE.Vector2(dirSol.x, dirSol.z).normalize(), elevBase = Math.asin(Math.min(1, -dirSol.y));
  const _d = new THREE.Vector3();
  function infoDia(fase) {
    const el = Math.sin((fase - 0.25) * Math.PI * 2);
    const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    return { fase, el, dia: sm(-0.1, 0.14, el), noite: 1 - sm(-0.22, 0.02, el), crepusculo: Math.max(0, 1 - Math.abs(el) / 0.3) };
  }
  function aplicarDia(i) {
    const e = cena.efeitos;
    // o sol anda ±40° de um lado para o outro e sobe/desce; de noite a "lua" ilumina de cima
    const az = Math.max(-0.7, Math.min(0.7, (i.fase - 0.5) * 1.4));
    const elev = i.el > 0 ? elevBase * (0.35 + 0.65 * Math.pow(i.el, 0.6)) : elevBase * 0.9;
    const c = Math.cos(az), s2 = Math.sin(az), hx = horiz.x * c - horiz.y * s2, hz = horiz.x * s2 + horiz.y * c;
    _d.set(hx * Math.cos(elev), -Math.sin(elev), hz * Math.cos(elev)).normalize();
    sol.position.copy(_d).multiplyScalar(-14).add(alvoSol);
    if (i.dia > 0.02) sol.color.copy(corSol).lerp(C_POR, i.crepusculo * 0.7); else sol.color.copy(C_LUA);
    sol.intensity = SOL_BASE * e.sol * Math.max(i.dia * (1 - 0.35 * i.crepusculo), 0.1 * i.noite);
    const ext = !!LUZ.externo;   // ao ar livre a noite é bem mais escura que dentro de casa
    hemi.intensity = LUZ.hemi[2] * ((ext ? 0.16 : 0.32) + (ext ? 0.84 : 0.68) * i.dia);
    hemi.color.copy(hemiCeu).lerp(C_NOITE, i.noite * 0.75); hemi.groundColor.copy(hemiChao).multiplyScalar(0.45 + 0.55 * i.dia);
    prench.intensity = LUZ.prench * (0.55 + 0.45 * i.dia);
    if (ativo) {
      scene.environmentIntensity = AMB.env * ((ext ? 0.18 : 0.45) + (ext ? 0.82 : 0.55) * i.dia);
      if (ext) renderer.toneMappingExposure = e.brilho * (pausado ? 0.55 : 1) * (0.72 + 0.28 * i.dia);
    }
    luzPers.intensity = 9 * (e.luzPersonagem ?? 1) * (ext ? 0.55 + 0.45 * i.dia : 1);
    if (feixe) {
      feixe.material.uniforms.forca.value = 0.09 * e.sol * (i.dia * (1 - 0.3 * i.crepusculo) + 0.22 * i.noite);
      feixe.material.uniforms.cor.value.copy(i.dia > 0.05 ? C_FEIXE : C_LUA).lerp(C_FEIXE_POR, i.dia > 0.05 ? i.crepusculo * 0.8 : 0);
      if (Math.abs(elev - ultElev) > 0.01 || i.dia < 0.05) { ultElev = elev; feixe.userData.dirigir?.(_d); }
    }
    i.dir = _d; mundo.diaNoite?.(i);
  }
  function aplicarDiaFixo() {   // ciclo desligado: a luz de sempre (sol na posição base)
    const e = cena.efeitos;
    sol.position.copy(dirSol).multiplyScalar(-14).add(alvoSol); sol.color.copy(corSol); sol.intensity = SOL_BASE * e.sol;
    hemi.intensity = LUZ.hemi[2]; hemi.color.copy(hemiCeu); hemi.groundColor.copy(hemiChao); prench.intensity = LUZ.prench;
    if (ativo) scene.environmentIntensity = AMB.env;
    if (feixe) { feixe.material.uniforms.forca.value = 0.09 * e.sol; feixe.material.uniforms.cor.value.copy(C_FEIXE); feixe.userData.dirigir?.(dirSol); }
    mundo.diaNoite?.({ ...infoDia(0.42), dir: dirSol });
  }

  /* ------------------------------------------------------------ eventos (objetos interativos) */
  const _tp = new THREE.Vector3();
  let ultTuberRef = null;
  const eventos = criarEventos({
    amb: AMB, raiz, mundo, objs,
    itens: (tipo) => cena.itens.filter((it) => it.tipo === tipo && it.visivel !== false && objs.get(it.id)?.visible).map((it) => ({ it, g: objs.get(it.id) })),
    som: (n, d) => opcoes.som?.(n, d), reagir: (n) => opcoes.reagir?.(n),
    proximoCanal: () => trocarCanal(null), setCanal: (id) => trocarCanal(id),
    tuberPos: (out) => (ultTuberRef?.body ? ultTuberRef.body.getWorldPosition(out) : out.set(0, 0, 0)),
  });
  let proxEvento = 60 + Math.random() * 90;
  /** troca o canal de todas as TVs do ambiente (id = null: próximo da lista) */
  function trocarCanal(id) {
    const tvs = cena.itens.filter((it) => it.tipo === 'tv' && objs.get(it.id));
    if (!tvs.length) return false;
    for (const it of tvs) {
      const atual = it.p.tela || 'chuvisco', lista = CANAIS.map(([v]) => v).filter((v) => v !== 'verde');
      it.p.tela = id || lista[(lista.indexOf(atual) + 1) % lista.length] || 'jornal';
      const tm = objs.get(it.id).getObjectByName('tela'); if (tm) aplicarTela(tm, it.p, ctx);
    }
    opcoes.som?.('toc', { v: 0.5 });
    salvar();
    return true;
  }

  /* ------------------------------------------------------------ ativar / desativar */
  let ativo = false, construido = false, guardado = null, nQ = 0, tempo = 0;
  const camLocal = { pos: new THREE.Vector3(), alvo: new THREE.Vector3() };
  function luzesPalco() { return scene.children.filter((o) => o.isLight && !raiz.children.includes(o) && o !== luzPers); }
  function ativar() {
    if (!construido) { montarTudo(); construido = true; }   // (normalmente já veio pronto de preparar())
    if (ativo) return; ativo = true;
    guardado = { env: scene.environmentIntensity, tone: renderer.toneMappingExposure, auto: renderer.shadowMap.autoUpdate, luzes: luzesPalco().map((l) => [l, l.visible]) };
    for (const [l] of guardado.luzes) l.visible = false;
    scene.environmentIntensity = AMB.env;
    renderer.toneMappingExposure = cena.efeitos.brilho * (pausado ? 0.55 : 1);
    diaAplicado = -1;
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
    raiz.visible = true; luzPers.visible = true; contato.visible = true;
  }
  function desativar() {
    if (!ativo) return; ativo = false;
    eventos.limpar();
    if (sentado && ultTuber) { ultTuber.sitHeight = 0; sentado = false; spotSofa = null; }
    chaveMoveis = '';
    raiz.visible = false; luzPers.visible = false; contato.visible = false;
    if (guardado) {
      for (const [l, v] of guardado.luzes) l.visible = v;
      scene.environmentIntensity = guardado.env; renderer.toneMappingExposure = guardado.tone; renderer.shadowMap.autoUpdate = guardado.auto;
    }
    editar(false);
  }
  /** thumbnails do painel: sala escondida e iluminação original do palco durante fn() */
  function miniatura(fn) {
    if (!ativo) return fn();
    raiz.visible = false; luzPers.visible = false; contato.visible = false;
    for (const [l, v] of guardado.luzes) l.visible = v;
    const env = scene.environmentIntensity, tone = renderer.toneMappingExposure;
    scene.environmentIntensity = guardado.env; renderer.toneMappingExposure = guardado.tone; renderer.shadowMap.needsUpdate = true;
    try { return fn(); } finally {
      raiz.visible = true; luzPers.visible = true; contato.visible = true;
      for (const [l] of guardado.luzes) l.visible = false;
      scene.environmentIntensity = env; renderer.toneMappingExposure = tone;
    }
  }

  /* ------------------------------------------------------------ quadro a quadro */
  const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function frame(dt, tuber) {
    if (!ativo) return;
    tempo += dt;
    const e = cena.efeitos;
    for (const [g, fn] of ctx.animacoes) if (g.visible && !g.userData.fora) fn(tempo);
    for (const t of ctx.animaveis) t.userData.atualizar(tempo);
    if (poeira) { poeira.visible = e.poeira; if (poeira.visible) poeira.userData.anima(tempo); }
    if (feixe) feixe.visible = e.feixe;
    mundo.animar?.(tempo, dt);
    eventos.frame(dt);
    ultTuberRef = tuber;
    // dia/noite: recalcula ~4x/s (a luz anda devagar; não precisa todo quadro)
    if (e.diaNoite !== false) { relogio.fase = (relogio.fase + dt / (24 * 60)) % 1; if (Math.abs(relogio.fase - diaAplicado) > 1 / (24 * 60 * 4)) { diaAplicado = relogio.fase; aplicarDia(infoDia(relogio.fase)); } }
    else if (diaAplicado !== -2) { diaAplicado = -2; aplicarDiaFixo(); }
    // eventos sozinhos de vez em quando (1 a 3 minutos)
    if (e.eventos !== false && !editando) { proxEvento -= dt; if (proxEvento <= 0) { proxEvento = 60 + Math.random() * 120; eventos.disparar('aleatorio'); } }
    // câmera (coordenadas da sala -> mundo)
    camLocal.pos.fromArray(cena.camera.pos); camLocal.alvo.fromArray(cena.camera.alvo);
    {
      const a = e.movimento && !editando ? e.intensidade : 0, s = tempo * e.velocidade;
      _a.set(camLocal.pos.x + Math.sin(s * 0.21) * 0.45 * a + Math.sin(s * 0.09) * 0.2 * a, camLocal.pos.y + Math.sin(s * 0.17 + 1) * 0.07 * a, camLocal.pos.z + Math.sin(s * 0.13 + 2) * 0.25 * a);
      _b.set(camLocal.alvo.x + Math.sin(s * 0.11) * 0.1 * a, camLocal.alvo.y, camLocal.alvo.z);
      camera.clearViewOffset();
      camera.fov = cena.camera.fov; camera.near = 0.3; camera.far = AMB.far;  // near maior = mais precisão de profundidade (sem tremer escada/corrimão)
      camera.aspect = innerWidth / Math.max(1, innerHeight);
      camera.position.copy(raiz.localToWorld(_a));
      camera.lookAt(raiz.localToWorld(_b));
      camera.updateProjectionMatrix();
    }
    if (tuber) correlacionar(tuber);
    if (nCull++ % 20 === 0) recortar();
    // luz de frente acompanha o personagem; sombra de contato embaixo dele
    if (tuber?.body) {
      tuber.body.getWorldPosition(_v);
      luzPers.position.set(camera.position.x * 0.6 + _v.x * 0.4, 3.2, camera.position.z * 0.55);
      luzPers.target.position.set(_v.x, 0.9, _v.z);
      const lift = Math.max(0, _v.y - (tuber.sitHeight || 0));
      contato.position.set(_v.x, 0.003, _v.z - 0.02);
      const k = (cena.personagem.sombra ?? 1.1) * (1 + lift * 0.8);
      contato.scale.set(k, k * 1.1, 1);
      contato.material.opacity = sentado ? 0 : 0.6 * Math.max(0, 1 - lift * 3);
    }
    if (nQ++ % q().cada === 0 || arr) renderer.shadowMap.needsUpdate = true;
    if (selHelper) atualizarSelecao();
  }

  /* ------------------------------------------------------------ recorte pela câmera */
  // Objetos inteiramente fora do enquadramento (com folga para o balanço da câmera e para sombras que
  // entram na tela) vão para a layer 1: não são desenhados nem entram no mapa de sombra, e não animam.
  // No editor tudo volta (para poder clicar/arrastar).
  let nCull = 0;
  const camCull = new THREE.PerspectiveCamera(), frust = new THREE.Frustum(), _m4 = new THREE.Matrix4(), _box = new THREE.Box3();
  function recortar() {
    camCull.copy(camera, false); camCull.fov = Math.min(150, camera.fov + 24); camCull.aspect = camera.aspect * 1.15;
    camCull.updateProjectionMatrix(); camCull.updateMatrixWorld();
    frust.setFromProjectionMatrix(_m4.multiplyMatrices(camCull.projectionMatrix, camCull.matrixWorldInverse));
    raiz.updateMatrixWorld();
    for (const g of objs.values()) {
      let fora = false;
      if (!editando && g.visible) { _box.setFromObject(g); fora = !_box.isEmpty() && !frust.intersectsBox(_box.expandByScalar(0.6)); }
      if (fora !== !!g.userData.fora) { g.userData.fora = fora; g.traverse((o) => o.layers.set(fora ? 1 : 0)); renderer.shadowMap.needsUpdate = true; }
    }
  }

  /* ------------------------------------------------------------ vaso x móveis da sala */
  // 1) móvel que o vaso está usando na aparência (cadeira/trono/mesa/isopor) some da sala: fica um só.
  // 2) aparência com "Sentar no sofá" (theme.salaSofa): o vaso vai para o assento do sofá e senta nele.
  const MOVEIS = ['cadeira_skol', 'trono_skol', 'mesa_bar', 'isopor'];
  let chaveMoveis = '', sentado = false, spotSofa = null;
  const ASSENTO = { x: -0.32, z: 0.27, y: 0.7 };   // ponto do assento no sistema do sofá (escala 1)
  let ultTuber = null;
  function correlacionar(tuber) {
    ultTuber = tuber;
    const usados = new Set();
    for (const w of tuber.accessories || []) { const id = w.userData?.entry?.id; if (id) usados.add(id); }
    const chave = [...usados].filter((id) => MOVEIS.includes(id)).sort().join(',');
    if (chave !== chaveMoveis) {
      chaveMoveis = chave;
      for (const it of cena.itens) if (MOVEIS.includes(it.tipo)) { const g = objs.get(it.id); if (g) g.visible = it.visivel && !usados.has(it.tipo); }
    }
    const sofa = tuber.theme?.salaSofa ? cena.itens.find((i) => i.tipo === 'sofa' && i.visivel) : null;
    if (sofa) {
      const r = sofa.rot * D2R, e = sofa.escala, cs = Math.cos(r), sn = Math.sin(r);
      const lx = ASSENTO.x * e, lz = ASSENTO.z * e;
      const x = sofa.pos[0] + lx * cs + lz * sn, z = sofa.pos[2] - lx * sn + lz * cs, h = sofa.pos[1] + ASSENTO.y * e;
      const novo = `${x.toFixed(3)},${z.toFixed(3)},${sofa.rot}`;
      if (novo !== spotSofa) { spotSofa = novo; posicionarRaiz([x, z], sofa.rot); }
      if (!sentado || Math.abs(tuber.sitHeight - h) > 0.02 || !tuber.isSitting) tuber.sitHeight = h;
      sentado = true;
    } else if (sentado) {
      sentado = false; spotSofa = null; tuber.sitHeight = 0; posicionarRaiz();
    }
  }

  /* ------------------------------------------------------------ salvar */
  let tSalvar = 0, ultimoJSON = JSON.stringify(cena), desfazer = [];
  function confirmar() {
    const j = JSON.stringify(cena); if (j === ultimoJSON) return;
    desfazer.push(ultimoJSON); if (desfazer.length > 40) desfazer.shift(); ultimoJSON = j;
    clearTimeout(tSalvar); tSalvar = setTimeout(salvar, 500);
  }
  function salvar() {
    cena.salvoEm = Date.now();
    const txt = JSON.stringify(cena);
    try { localStorage.setItem(CHAVE, txt); } catch (e) { /* cheio: fica só no cache */ }
    invokeRaw('cache_put', new TextEncoder().encode(txt), { 'x-key': AMB.cache }).catch(() => {});
  }
  function recarregar(nova) { cena = normalizar(nova); montarTudo(); selecionar(null); painel(); }
  function voltar() {
    if (!desfazer.length) return aviso('Nada para desfazer');
    const j = desfazer.pop(); ultimoJSON = j; const s = selId; recarregar(JSON.parse(j));
    if (cena.itens.some((i) => i.id === s)) selecionar(s);
    clearTimeout(tSalvar); tSalvar = setTimeout(salvar, 500);
  }

  /* ============================================================ EDITOR (dentro da janela do personagem) */
  let editando = false, selId = null, selHelper = null, arr = null, ui = null;
  const sel = () => cena.itens.find((i) => i.id === selId);
  function selecionar(id) {
    selId = id;
    if (selHelper) { scene.remove(selHelper); selHelper = null; }
    if (id && objs.get(id)) { selHelper = new THREE.Box3Helper(new THREE.Box3(), 0x3399ff); selHelper.material.depthTest = false; selHelper.renderOrder = 10; scene.add(selHelper); atualizarSelecao(); }
    painel();
  }
  const _bx = new THREE.Box3();
  function atualizarSelecao() {
    const g = objs.get(selId); if (!g || !selHelper) return;
    selHelper.box.makeEmpty(); g.updateMatrixWorld(true);
    g.traverse((o) => { if (o.isMesh && !o.userData.semClique && o.name !== 'contato') { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); _bx.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); selHelper.box.union(_bx); } });
  }
  function editar(on) {
    on = on === undefined || on === 'editar' || on === 'toggle' ? !editando : !!on && on !== 'fechar';
    if (on && !ativo) { aviso('Ative uma cena com fundo "Sala 3D" primeiro'); return; }
    editando = on; nCull = 0; recortar();
    if (on) { if (!ui) montarUI(); ui.root.style.display = ''; painel(); }
    else { if (ui) ui.root.style.display = 'none'; selecionar(null); }
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plano = new THREE.Plane(), pt = new THREE.Vector3();
  function raio(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function pick(ev) {
    raio(ev);
    const alvos = [...objs.values()].filter((g) => g.visible);
    const hits = ray.intersectObjects(alvos, true).filter((h) => !h.object.userData.semClique);
    for (const h of hits) { let o = h.object; while (o && o.userData.itemId == null) o = o.parent; if (o) return { id: o.userData.itemId, ponto: h.point }; }
    return null;
  }
  function assentar(it) {
    const g = objs.get(it.id); const b = new THREE.Box3().setFromObject(g); const c = new THREE.Vector3(); b.getCenter(c);
    const outros = [...objs.entries()].filter(([id, o]) => id !== it.id && o.visible).map(([, o]) => o);
    ray.set(new THREE.Vector3(c.x, 6, c.z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects([...outros, salaG], true).find((h) => !h.object.userData.semClique && h.object.name !== 'pano' && h.point.y < 3.5);
    it.pos[1] = hit ? +raiz.worldToLocal(hit.point.clone()).y.toFixed(3) : 0; posicionar(it);
  }
  function onDown(ev) {
    if (!editando || ev.button !== 0 || ev.target !== renderer.domElement) return;
    const h = pick(ev);
    if (!h) { selecionar(null); return; }
    if (h.id !== selId) selecionar(h.id);
    const it = sel(), tp = tipoDe(it);
    if (tp === 'parede') {
      const pw = PAREDES[it.p.parede || 'fundo'];
      const n = pw.normal.clone().applyQuaternion(raiz.quaternion);
      plano.setFromNormalAndCoplanarPoint(n, raiz.localToWorld(new THREE.Vector3().fromArray(it.pos)));
    } else plano.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), h.ponto);
    ray.ray.intersectPlane(plano, pt);
    arr = { it, tp, off: new THREE.Vector3().fromArray(it.pos).sub(raiz.worldToLocal(pt.clone())) };
    ev.preventDefault(); ev.stopPropagation();
  }
  function onMove(ev) {
    if (!arr) return;
    raio(ev); if (!ray.ray.intersectPlane(plano, pt)) return;
    const n = raiz.worldToLocal(pt.clone()).add(arr.off), it = arr.it;
    if (arr.tp === 'parede') { const k = it.p.parede || 'fundo'; if (k === 'fundo') { it.pos[0] = n.x; it.pos[1] = n.y; } else { it.pos[2] = n.z; it.pos[1] = n.y; } }
    else { it.pos[0] = +n.x.toFixed(3); it.pos[2] = +n.z.toFixed(3); }
    posicionar(it);
  }
  function onUp() {
    if (!arr) return;
    if (arr.tp === 'piso' && ui.chkGrudar.checked) assentar(arr.it);
    arr = null; confirmar(); painel();
  }
  function onWheel(ev) {
    const it = sel(); if (!editando || !it || ev.target !== renderer.domElement) return;
    ev.preventDefault();
    if (ev.shiftKey) it.rot = +(it.rot + (ev.deltaY > 0 ? 3 : -3)).toFixed(1);
    else it.escala = Math.max(0.1, +(it.escala * (ev.deltaY > 0 ? 0.96 : 1.04)).toFixed(3));
    posicionar(it); painelLeve();
    clearTimeout(onWheel.t); onWheel.t = setTimeout(confirmar, 400);
  }
  function onKey(ev) {
    if (!editando || ev.target.matches?.('input[type=text]')) return;
    const it = sel();
    if (ev.key === 'Escape') { if (selId) selecionar(null); else editar(false); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); voltar(); return; }
    if (!it) return;
    if (ev.key === 'Delete') { ev.preventDefault(); remover(it); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicar(it); }
    else if (ev.key.startsWith('Arrow')) {
      ev.preventDefault(); const d = ev.shiftKey ? 0.1 : 0.01, tp = tipoDe(it), k = it.p.parede || 'fundo', h = tp === 'parede' && k !== 'fundo' ? 2 : 0;
      if (ev.key === 'ArrowLeft') it.pos[h] -= d; if (ev.key === 'ArrowRight') it.pos[h] += d;
      if (ev.key === 'ArrowUp') tp === 'parede' ? (it.pos[1] += d) : (it.pos[2] -= d);
      if (ev.key === 'ArrowDown') tp === 'parede' ? (it.pos[1] -= d) : (it.pos[2] += d);
      posicionar(it); clearTimeout(onKey.t); onKey.t = setTimeout(confirmar, 400);
    }
  }
  function novo(tipo) {
    const def = CATALOGO[tipo];
    let n = 1; while (cena.itens.some((i) => i.id === `${tipo}_${n}`)) n++;
    const it = { id: `${tipo}_${n}`, tipo, nome: def.nome, pos: [cena.personagem.pos[0] + 0.9, 0, cena.personagem.pos[1] + 0.3], rot: 0, escala: 1, visivel: true, p: {} };
    if (def.tipo === 'parede') { it.pos = [-0.3, 2.0, -2.44]; it.p.parede = 'fundo'; if (tipo === 'bandeira') it.pos[1] = 3; }
    if (def.tipo === 'teto') it.pos = [0.3, AMB.alto, 0];
    if (tipo === 'quadro') Object.assign(it.p, { moldura: 'dourada', largura: 0.5, altura: 0.65 });
    if (tipo === 'livro') it.p.capa = 'capital';
    cena.itens.push(it); montar(it); selecionar(it.id); confirmar();
  }
  function remover(it) {
    if (PADRAO.itens.some((i) => i.id === it.id)) { it.visivel = false; posicionar(it); }
    else { cena.itens = cena.itens.filter((i) => i !== it); const g = objs.get(it.id); if (g) { raiz.remove(g); descartar(g); objs.delete(it.id); ctx.animacoes.delete(g); } }
    selecionar(null); confirmar();
  }
  function duplicar(it) {
    const n = clone(it); let k = 1; while (cena.itens.some((i) => i.id === `${it.id}_c${k}`)) k++;
    n.id = `${it.id}_c${k}`; n.nome = `${it.nome} (cópia)`;
    if (tipoDe(it) === 'parede') { if ((it.p.parede || 'fundo') === 'fundo') n.pos[0] += 0.4; else n.pos[2] += 0.4; } else { n.pos[0] += 0.4; n.pos[2] += 0.3; }
    cena.itens.push(n); montar(n); selecionar(n.id); confirmar();
  }
  function lerImagem(file, max) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => { const im = new Image(); im.onload = () => {
        const s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88)); }; im.onerror = rej; im.src = fr.result; };
      fr.onerror = rej; fr.readAsDataURL(file);
    });
  }
  function aviso(txt, ms = 2200) {
    if (!ui) montarUI();
    ui.toast.textContent = txt; ui.toast.classList.add('on');
    clearTimeout(aviso.t); aviso.t = setTimeout(() => ui.toast.classList.remove('on'), ms);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- UI do editor (painel lateral dentro da janela) ---------- */
  function montarUI() {
    const css = document.createElement('style');
    css.textContent = `
#s3d { position: fixed; top: 30px; right: 10px; bottom: 10px; width: 330px; background: rgba(18,20,26,.95); color: #e8e8ea; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.5); display: flex; flex-direction: column; font: 13px "Segoe UI", system-ui, sans-serif; z-index: 50; user-select: none; }
#s3d header { padding: 10px 12px 6px; border-bottom: 1px solid #2c2f38; }
#s3d header h1 { font-size: 14px; margin: 0 0 8px; display: flex; justify-content: space-between; align-items: center; }
#s3d .corpo { overflow-y: auto; padding: 6px 12px 12px; flex: 1; }
#s3d h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #8a90a0; margin: 14px 0 6px; }
#s3d .linha { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; align-items: center; }
#s3d button, #s3d select, #s3d .arq { background: #2b3040; color: #eee; border: 1px solid #3b4255; border-radius: 7px; padding: 5px 9px; font: inherit; cursor: pointer; }
#s3d button:hover, #s3d .arq:hover { background: #353b4f; }
#s3d button.pri { background: #2d6cdf; border-color: #2d6cdf; } #s3d button.perigo { background: #5a2430; border-color: #7a3040; }
#s3d .arq input { display: none; } #s3d input[type=range] { width: 100%; }
#s3d input[type=text] { width: 100%; box-sizing: border-box; background: #1d212b; color: #eee; border: 1px solid #3b4255; border-radius: 6px; padding: 5px 8px; font: inherit; }
#s3d .campo { margin-bottom: 7px; } #s3d .rot { display: flex; justify-content: space-between; color: #aab; margin-bottom: 2px; }
#s3d ul { list-style: none; margin: 0; padding: 0; max-height: 200px; overflow-y: auto; border: 1px solid #2c2f38; border-radius: 8px; }
#s3d li { display: flex; align-items: center; gap: 6px; padding: 3px 8px; border-bottom: 1px solid #23262e; cursor: pointer; }
#s3d li:hover { background: #222633; } #s3d li.sel { background: #24365a; } #s3d li.off .nome { opacity: .4; text-decoration: line-through; }
#s3d li .nome { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } #s3d li button { border: none; background: none; padding: 1px 4px; }
#s3d .dica { color: #8a90a0; font-size: 12px; line-height: 1.4; }
#s3dMenu { position: fixed; background: #1d212b; border: 1px solid #3b4255; border-radius: 8px; padding: 6px; display: none; z-index: 60; width: 240px; max-height: 75vh; overflow-y: auto; font: 13px "Segoe UI", system-ui, sans-serif; color: #eee; }
#s3dMenu button { display: block; width: 100%; text-align: left; margin-bottom: 3px; background: #2b3040; color: #eee; border: 1px solid #3b4255; border-radius: 7px; padding: 5px 9px; font: inherit; cursor: pointer; }
#s3dToast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: #2d6cdf; color: #fff; padding: 7px 14px; border-radius: 8px; font: 14px "Segoe UI", sans-serif; opacity: 0; transition: opacity .3s; pointer-events: none; z-index: 70; }
#s3dToast.on { opacity: 1; }`;
    document.head.appendChild(css);
    const root = document.createElement('div'); root.id = 's3d';
    root.innerHTML = `
<header><h1>${AMB.nome} — editor <button data-a="fechar" title="Fechar (Esc)">✕</button></h1>
<div class="linha"><button class="pri" data-a="add">＋ Adicionar</button><button data-a="desfazer">↶ Desfazer</button></div></header>
<div class="corpo">
<h2>Objetos</h2><ul></ul>
<p class="dica">Clique num objeto e arraste. Roda = tamanho · Shift+roda = girar · setas = ajuste fino · Delete · Ctrl+D · Ctrl+Z.</p>
<div data-sec="sel" style="display:none"><h2>Selecionado</h2>
<div class="campo"><input type="text" data-k="nome"></div>
<div class="campo"><div class="rot"><span>Tamanho</span><span data-v="escala"></span></div><input type="range" data-k="escala" min="0.2" max="3" step="0.01"></div>
<div class="campo"><div class="rot"><span>Girar</span><span data-v="rot"></span></div><input type="range" data-k="rot" min="-180" max="180" step="1"></div>
<div class="campo"><div class="rot"><span>Altura</span><span data-v="altura"></span></div><input type="range" data-k="altura" min="0" max="3.9" step="0.005"></div>
<div class="linha"><button data-a="assentar">⤓ Assentar</button><button data-a="duplicar">⧉ Duplicar</button><button class="perigo" data-a="remover">🗑 Remover</button></div>
<div data-sec="props"></div></div>
<h2>Personagem</h2>
<div class="campo"><div class="rot"><span>Lugar ← →</span></div><input type="range" data-pers="0" min="-3.8" max="3.8" step="0.01"></div>
<div class="campo"><div class="rot"><span>Lugar frente ↕ fundo</span></div><input type="range" data-pers="1" min="-1.8" max="3" step="0.01"></div>
<div class="campo"><div class="rot"><span>Luz no personagem</span></div><input type="range" data-ef="luzPersonagem" min="0" max="2.5" step="0.05"></div>
<h2>Câmera</h2>
<div class="linha"><button data-a="vistaPadrao">Vista original</button></div>
<div class="campo"><div class="rot"><span>Lente (zoom)</span><span data-v="fov"></span></div><input type="range" data-cam="fov" min="18" max="70" step="1"></div>
<div class="linha"><label><input type="checkbox" data-efc="movimento"> Câmera se mexendo devagar</label></div>
<div class="campo"><div class="rot"><span>Quanto mexe</span></div><input type="range" data-ef="intensidade" min="0" max="3" step="0.05"></div>
<div class="campo"><div class="rot"><span>Velocidade</span></div><input type="range" data-ef="velocidade" min="0.1" max="3" step="0.05"></div>
<h2>Luz e efeitos</h2>
<div class="campo"><div class="rot"><span>Sol da janela</span></div><input type="range" data-ef="sol" min="0" max="2.5" step="0.05"></div>
<div class="campo"><div class="rot"><span>Brilho geral</span></div><input type="range" data-ef="brilho" min="0.3" max="2.5" step="0.05"></div>
${feixe ? '<div class="linha"><label><input type="checkbox" data-efc="feixe"> Feixe de luz</label>' + (poeira ? '<label><input type="checkbox" data-efc="poeira"> Poeira</label>' : '') + '</div>' : ''}<div class="linha"><label><input type="checkbox" data-efc="diaNoite"> Dia/noite (24 min)</label><label><input type="checkbox" data-efc="eventos"> Eventos sozinhos</label></div>
<div class="linha"><label>Qualidade da sala <select data-qual><option value="baixa">Leve</option><option value="media">Média</option><option value="alta">Alta</option></select></label></div>
<div class="linha"><label><input type="checkbox" data-grudar checked> Ao soltar, assentar em cima do que estiver embaixo</label></div>
<h2>Salvar</h2>
<div class="linha"><button data-a="exportar">💾 Exportar</button><label class="arq">📂 Importar<input type="file" data-importar accept=".json,.js"></label><button class="perigo" data-a="original">↺ Sala original</button></div>
<p class="dica">Tudo é salvo sozinho. Exportar/Importar serve para backup ou levar a sala para outro PC.</p>
</div>`;
    const menu = document.createElement('div'); menu.id = 's3dMenu';
    const toast = document.createElement('div'); toast.id = 's3dToast';
    document.body.append(root, menu, toast);
    ui = { root, menu, toast, lista: root.querySelector('ul'), sec: root.querySelector('[data-sec=sel]'), props: root.querySelector('[data-sec=props]'), chkGrudar: root.querySelector('[data-grudar]') };
    // eventos 3D
    addEventListener('pointerdown', onDown, true); addEventListener('pointermove', onMove); addEventListener('pointerup', onUp);
    addEventListener('wheel', onWheel, { passive: false }); addEventListener('keydown', onKey);
    // no editor o botão direito não abre o painel
    addEventListener('contextmenu', (e) => { if (editando) { e.stopPropagation(); e.preventDefault(); } }, true);
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    // botões
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a, it = sel();
      if (a === 'fechar') editar(false);
      if (a === 'desfazer') voltar();
      if (a === 'assentar' && it) { assentar(it); confirmar(); painel(); }
      if (a === 'duplicar' && it) duplicar(it);
      if (a === 'remover' && it) remover(it);
      if (a === 'vistaPadrao') { cena.camera = clone(PADRAO.camera); confirmar(); painel(); }
      if (a === 'exportar') {
        const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([JSON.stringify(cena)], { type: 'application/json' }));
        el.download = `${AMB.cache}.json`; document.body.appendChild(el); el.click(); el.remove();
      }
      if (a === 'original' && confirm('Voltar para a sala original? (Ctrl+Z desfaz)')) { recarregar(clone(PADRAO)); confirmar(); }
      if (a === 'add') {
        const r = b.getBoundingClientRect(); menu.style.left = Math.max(8, r.left - 10) + 'px'; menu.style.top = r.bottom + 6 + 'px';
        const rem = cena.itens.filter((i) => !i.visivel);
        menu.innerHTML = '<div class="dica">Novo objeto:</div>' + Object.entries(CATALOGO).filter(([, d]) => d.tipo === 'piso' || (d.tipo === 'parede' && mundo.paredes) || (d.tipo === 'teto' && AMB.alto > 0)).map(([k, d]) => `<button data-novo="${k}">${d.nome}</button>`).join('') +
          (rem.length ? '<div class="dica" style="margin-top:8px">Trazer de volta:</div>' + rem.map((i) => `<button data-volta="${i.id}">↩ ${esc(i.nome)}</button>`).join('') : '');
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block'; e.stopPropagation();
      }
    });
    menu.addEventListener('pointerdown', (e) => e.stopPropagation());
    menu.addEventListener('click', (e) => {
      const n = e.target.closest('[data-novo]'), v = e.target.closest('[data-volta]');
      if (n) novo(n.dataset.novo);
      if (v) { const it = cena.itens.find((i) => i.id === v.dataset.volta); it.visivel = true; posicionar(it); selecionar(it.id); confirmar(); }
      menu.style.display = 'none';
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#s3dMenu') && !e.target.closest('[data-a=add]')) menu.style.display = 'none'; });
    ui.lista.addEventListener('click', (e) => {
      const li = e.target.closest('li'); if (!li) return; const it = cena.itens.find((i) => i.id === li.dataset.id);
      if (e.target.closest('.olho')) { it.visivel = !it.visivel; posicionar(it); if (!it.visivel && selId === it.id) selecionar(null); confirmar(); painel(); return; }
      if (!it.visivel) { it.visivel = true; posicionar(it); confirmar(); }
      selecionar(it.id);
    });
    root.addEventListener('input', (e) => {
      const t = e.target, it = sel();
      if (t.dataset.k && it) {
        if (t.dataset.k === 'nome') { it.nome = t.value; lista(); return; }
        if (t.dataset.k === 'altura') it.pos[1] = +t.value; else it[t.dataset.k] = +t.value;
        posicionar(it); painelLeve(); return;
      }
      if (t.dataset.pers) { cena.personagem.pos[+t.dataset.pers] = +t.value; posicionarRaiz(); return; }
      if (t.dataset.ef) { cena.efeitos[t.dataset.ef] = +t.value; if (t.dataset.ef === 'brilho') renderer.toneMappingExposure = +t.value; aplicarEfeitos(); return; }
      if (t.dataset.cam) { cena.camera.fov = +t.value; painelLeve(); return; }
      if (t.dataset.p && it) { it.p[t.dataset.p] = t.type === 'range' ? +t.value : t.value; montar(it); selecionar(it.id); }
    });
    root.addEventListener('change', async (e) => {
      const t = e.target, it = sel();
      if (t.dataset.efc) { cena.efeitos[t.dataset.efc] = t.checked; }
      if (t.dataset.qual !== undefined) { cena.efeitos.qualidade = t.value; ctx.qualidade = q(); sol.shadow.mapSize.set(q().sombra, q().sombra); sol.shadow.map?.dispose(); sol.shadow.map = null; montarTudo(); }
      if (t.dataset.p && it && t.tagName === 'SELECT') { it.p[t.dataset.p] = t.value; montar(it); selecionar(it.id); }
      if (t.dataset.img && it && t.files[0]) { it.p[t.dataset.img] = await lerImagem(t.files[0], 1200); t.value = ''; montar(it); selecionar(it.id); }
      if (t.dataset.importar !== undefined && t.files[0]) {
        const txt = await t.files[0].text(); t.value = '';
        try { recarregar(JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1))); aviso('Sala importada'); } catch (_) { aviso('Arquivo inválido'); }
      }
      confirmar();
    });
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-orig]'); const it = sel(); if (!b || !it) return; it.p[b.dataset.orig] = b.dataset.v; montar(it); selecionar(it.id); confirmar(); });
  }
  function lista() {
    ui.lista.innerHTML = cena.itens.map((it) => `<li data-id="${it.id}" class="${it.id === selId ? 'sel' : ''} ${it.visivel ? '' : 'off'}"><button class="olho" title="Mostrar / remover">${it.visivel ? '👁' : '◌'}</button><span class="nome">${esc(it.nome)}</span></li>`).join('');
  }
  const $r = (s) => ui.root.querySelector(s);
  function painelLeve() {
    const it = sel();
    if (it) {
      $r('[data-v=escala]').textContent = Math.round(it.escala * 100) + '%'; $r('[data-v=rot]').textContent = it.rot.toFixed(0) + '°'; $r('[data-v=altura]').textContent = it.pos[1].toFixed(2) + ' m';
      $r('[data-k=escala]').value = it.escala; $r('[data-k=rot]').value = it.rot; $r('[data-k=altura]').value = it.pos[1];
    }
    $r('[data-v=fov]').textContent = cena.camera.fov + '°';
  }
  const campoImg = (rotulo, k, origem) => `<div class="linha"><label class="arq">🖼 ${rotulo}<input type="file" accept="image/*" data-img="${k}"></label>${origem ? `<button data-orig="${k}" data-v="${origem}">Original</button>` : ''}</div>`;
  const rng = (rotulo, k, v, min, max, step) => `<div class="campo"><div class="rot"><span>${rotulo}</span><span>${(+v).toFixed(2)}</span></div><input type="range" data-p="${k}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
  function painel() {
    if (!ui || !editando) return;
    lista();
    const it = sel();
    ui.sec.style.display = it ? '' : 'none';
    if (it) {
      $r('[data-k=nome]').value = it.nome;
      const p = it.p; let h = '';
      if (it.tipo === 'quadro') {
        h += campoImg('Trocar foto', 'foto', PADRAO.itens.find((i) => i.id === it.id)?.p.foto);
        h += `<div class="campo"><div class="rot"><span>Moldura</span></div><select data-p="moldura" style="width:100%">${Object.entries(MOLDURAS).map(([k, m]) => `<option value="${k}" ${k === (p.moldura || 'dourada') ? 'selected' : ''}>${m.nome}</option>`).join('')}</select></div>`;
        h += rng('Largura (m)', 'largura', p.largura ?? 0.5, 0.15, 2.5, 0.01) + rng('Altura (m)', 'altura', p.altura ?? 0.65, 0.15, 2.5, 0.01) + rng('Torto (graus)', 'inclinacao', p.inclinacao ?? 0, -25, 25, 0.5);
        h += `<div class="campo"><div class="rot"><span>Parede</span></div><select data-p="parede" style="width:100%">${['fundo', 'esquerda', 'direita'].map((k) => `<option ${k === (p.parede || 'fundo') ? 'selected' : ''}>${k}</option>`).join('')}</select></div>`;
      }
      if (it.tipo === 'bandeira') h += campoImg('Trocar imagem da bandeira', 'imagem', 'bandeira') + rng('Largura (m)', 'largura', p.largura ?? 2, 0.5, 4, 0.01) + rng('Altura (m)', 'altura', p.altura ?? 1.35, 0.3, 3, 0.01) + rng('Vento', 'vento', p.vento ?? 1, 0, 3, 0.05);
      if (it.tipo === 'poster') h += campoImg('Trocar imagem do pôster', 'imagem', 'poster') + rng('Largura (m)', 'largura', p.largura ?? 0.72, 0.2, 2, 0.01) + rng('Altura (m)', 'altura', p.altura ?? 1.08, 0.2, 2.5, 0.01) + rng('Encostado (graus)', 'encosto', p.encosto ?? 12, 0, 30, 0.5);
      if (it.tipo === 'livro') {
        h += `<div class="campo"><div class="rot"><span>Capa</span></div><select data-p="capa" style="width:100%"><option value="capital" ${p.capa === 'capital' ? 'selected' : ''}>O Capital</option><option value="amarelo" ${p.capa === 'amarelo' ? 'selected' : ''}>O Livro Amarelo</option></select></div>`;
        h += campoImg('Capa personalizada', 'imagem') + `<div class="campo"><div class="rot"><span>Cor da lombada</span></div><input type="color" data-p="cor" value="${p.cor || (p.capa === 'amarelo' ? '#f1c21b' : '#8e1418')}"></div>`;
      }
      if (it.tipo === 'tv') h += `<div class="campo"><div class="rot"><span>Tela</span></div><select data-p="tela" style="width:100%">${CANAIS.map(([v, n]) => `<option value="${v}" ${(p.tela || 'chuvisco') === v ? 'selected' : ''}>${n}</option>`).join('')}<option value="original" ${p.tela === 'original' ? 'selected' : ''}>Imagem original</option>${p.tela && !IDS_CANAIS.includes(p.tela) && p.tela !== 'original' ? '<option value="' + esc(p.tela) + '" selected>Imagem enviada</option>' : ''}</select></div>` + campoImg('Pôr imagem na tela', 'tela');
      if (['mesa_vermelha', 'cadeira_skol', 'mesa_bar', 'rodo'].includes(it.tipo)) h += `<div class="campo"><div class="rot"><span>Cor</span></div><input type="color" data-p="cor" value="${p.cor || ({ mesa_vermelha: '#c8121b', rodo: '#d0151d' }[it.tipo] || '#f7d417')}"></div>`;
      if (it.tipo === 'lampada') h += rng('Intensidade', 'intensidade', p.intensidade ?? 7, 0, 20, 0.1) + rng('Balanço', 'balanco', p.balanco ?? 1, 0, 4, 0.05) + rng('Comprimento do fio', 'fio', p.fio ?? 1, 0.2, 2.5, 0.01);
      if (it.tipo === 'entulho') h += rng('Quantidade', 'qtd', p.qtd ?? 22, 3, 80, 1) + rng('Espalhar', 'raio', p.raio ?? 1.2, 0.2, 3, 0.05) + rng('Sorteio', 'semente', p.semente ?? 3, 1, 50, 1);
      ui.props.innerHTML = h;
    }
    const e = cena.efeitos;
    ui.root.querySelectorAll('[data-ef]').forEach((el) => { el.value = e[el.dataset.ef] ?? 1; });
    ui.root.querySelectorAll('[data-efc]').forEach((el) => { el.checked = !!e[el.dataset.efc]; });
    ui.root.querySelectorAll('[data-pers]').forEach((el) => { el.value = cena.personagem.pos[+el.dataset.pers]; });
    $r('[data-qual]').value = e.qualidade; $r('[data-cam=fov]').value = cena.camera.fov;
    painelLeve();
  }

  /* ------------------------------------------------------------ pausa ("Volto já"): cena mais escura */
  let pausado = false;
  function pausa(on) {
    pausado = !!on;
    if (ativo) renderer.toneMappingExposure = cena.efeitos.brilho * (pausado ? 0.55 : 1);
  }
  /** libera a GPU/memória deste ambiente (quando ninguém usa mais) */
  function destruir() {
    desativar(); eventos.limpar();
    scene.remove(raiz, luzPers, luzPers.target, contato);
    const mats = new Set();
    raiz.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m)); });
    for (const m of mats) m.dispose();   // texturas do cache (TX) são compartilhadas entre ambientes: ficam
    sol.shadow.map?.dispose();
    ui?.root.remove(); ui?.menu.remove(); ui?.toast.remove();
    ctx.animacoes.clear(); ctx.animaveis.clear(); objs.clear();
  }

  return {
    get ativo() { return ativo; }, get editando() { return editando; },
    ativar, desativar, frame, miniatura, editar, pausa, destruir, preparar, comoVisual, subirTexturas,
    get layout() { return cena; },
    get nome() { return AMB.nome; },
    /** dispara um evento interativo ('aleatorio' = qualquer um deste ambiente) */
    evento: (nome) => ativo && eventos.disparar(nome),
    /** hora do dia (0..1, 0,5 = meio-dia); sem argumento devolve a atual */
    fase(v) { if (v != null) { relogio.fase = ((+v % 1) + 1) % 1; diaAplicado = -1; } return relogio.fase; },
    eventos: () => eventos.disponiveis().map((n) => [n, NOMES_EVENTOS[n] || n]),
    /** TV: null = próximo canal; 'verde' alterna a tela verde (volta ao canal anterior) */
    canal(id) {
      if (id === 'verde') {
        const tv = cena.itens.find((it) => it.tipo === 'tv');
        if (!tv) return false;
        if (tv.p.tela === 'verde') return trocarCanal(tv.p._antes || 'jornal');
        tv.p._antes = tv.p.tela || 'chuvisco';
        return trocarCanal('verde');
      }
      return trocarCanal(id || null);
    },
  };
}
