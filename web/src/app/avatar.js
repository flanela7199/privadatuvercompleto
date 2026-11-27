// Avatar window: the vtuber character alone on a transparent (or chroma/color) canvas.
// Exactly the same model as the preview (ToiletTuber + themes + presets + accessories).
// Rust side (via bridge): global cursor on the whole virtual desktop, mic -> mouth, hotkeys,
// window modes. "Playing with the mouse" = he follows the mouse with BIG angles, on every monitor.
//   avatar.html            -> main avatar window (scene mode 'window' by default, or 'overlay')
//   avatar.html?output=1   -> OBS output window (label `output`): mirrors the avatar
//                             (outfit, actions, mouth, look) with its own framing/background.
import * as THREE from 'three';
import { createStage } from '../stage.js';
import { ToiletTuber } from '../rig/ToiletTuber.js';
import { loadThemes, mergeTheme } from '../themes.js';
import { FakeTalk, maxMouth, zeroMouth } from '../input/visemes.js';
import { sfx } from '../audio/sfx.js';
import '../accessories/extra.js';
import '../accessories/glb.js';
import { isTauri, invoke, invokeRaw, listen, emit } from './bridge.js';
import { outfitThumbKey, accThumbKey } from './thumbkeys.js';
import { buildAccessory, listAccessories } from '../accessories/index.js';
import { MaterialLib } from '../rig/materials.js';
import { DIM } from '../rig/ToiletTuber.js';
import { makeResolver, migrateOutfit } from './outfits.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { criarTransicao, curvas } from './transicao.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const OUTPUT = new URLSearchParams(location.search).has('output');
const OUTPUT_DEFAULTS = { background: 'chroma', color: '#00ff00', scale: 1.3, x: 0.5, y: 0.82, follow: true };
const LOOK_DEFAULTS = { range: 1.0, reachPx: 1400, maxYawDeg: 80, maxPitchDeg: 35 };
const BASE_PX = 380;      // character height on screen (logical px) at scale 1
const CHAR_H = 1.8;       // model height in world units (floor -> crown)
const CENTER_Y = 0.85;
const FOV = 20;
// what the JS rig reaches on its own at |look| = 1 (body yaw 0.5 + head yaw 0.28; pitch 0.1 + 0.22)
const RIG_YAW = 0.78, RIG_PITCH = 0.32;

/* -------------------------------------------------------------- loading */
// windows start hidden behind a splash; we report progress and say when the first frame is on screen
const loading = (progress, text) => { try { emit('loading', { label: 'avatar', progress, text }); } catch { /* */ } };

/* --------------------------------------------------------------- config */
let config = (await invoke('load_config').catch(() => null)) || structuredClone(DEFAULT_CONFIG);
config = { ...structuredClone(DEFAULT_CONFIG), ...config };
const scene0 = () => config.scenes?.[clamp(config.activeScene | 0, 0, (config.scenes?.length || 1) - 1)] || DEFAULT_CONFIG.scenes[0];
const outCfg = () => ({ ...OUTPUT_DEFAULTS, ...(config.output || {}) });
const lookCfg = () => ({ ...LOOK_DEFAULTS, ...(config.look || {}) });
const settings = () => config.settings || {};
loading(0.1, 'lendo configuração…');
// Debug / screenshot mode (browser or headless): avatar.html?character=chratos&pose=front|34|profile&expr=rest|aa|smile|blink|oo&bg=%23202020&zoom=1
// fixed close-up camera on the head, fixed expression, no cursor follow, solid background.
const DBG = (() => {
  const q = new URLSearchParams(location.search);
  if (q.get('character')) config.character = q.get('character');
  if (q.has('pose') || q.has('expr')) config.render = { ...(config.render || {}), pixelRatio: +(q.get('dpr') || 1) };
  return q.has('pose') || q.has('expr') ? { pose: q.get('pose') || 'front', expr: q.get('expr') || 'rest', bg: q.get('bg'), zoom: +(q.get('zoom') || 1), target: null } : null;
})();
const DBG_EXPR = { rest: {}, aa: { open: 1, lips: 1 }, smile: { cornerL: 1, cornerR: 1, wide: 0.6, open: 0.25 }, oo: { round: 1, open: 0.3 }, blink: {} };
// expr may also be an action held at its peak: blargh (wide-open spit pose), sit
// screenshot hook: render + read back in the same task (the drawing buffer is not preserved)
window.__shot = () => { stage.render(0, !!config.render?.ao); return renderer.domElement.toDataURL('image/png'); };
// change the debug view without reloading: __dbg('34', 'aa', 1.5)
window.__dbg = (pose, expr, zoom) => { if (!DBG) return false; Object.assign(DBG, { pose: pose ?? DBG.pose, expr: expr ?? DBG.expr, zoom: zoom || 1, freeze: false }); window.__dbgFrames = 0; return true; };
// key frame of an action: play it, simulate `seconds` at 60 Hz right now, then freeze the character (until the next __dbg)
window.__act = (name, seconds, pre = 0) => {
  if (!DBG) return false;
  const step = (n) => { for (let i = 0; i < n; i++) tuber.update(1 / 60, { look: { x: 0, y: 0 }, mouth: zeroMouth() }); };
  step(Math.round(pre * 60));
  const ok = tuber.play(name);
  step(Math.round(seconds * 60));
  DBG.freeze = true; window.__dbgFrames = 0;
  return ok;
};
// wear accessories in debug mode: __wear({ head_top: [{ id: 'crown' }], ... }) (slots of the current outfit are replaced)
window.__wear = (slots) => { tuber.setTheme({ ...currentTheme, slots }); window.__dbgFrames = 0; return (tuber.accessories || []).length; };
function debugCamera() {
  if (!DBG.target) {
    DBG.target = tuber.head.getWorldPosition(new THREE.Vector3()).add(character === 'chratos' ? new THREE.Vector3(0, 0.075, 0.03) : new THREE.Vector3(0, 0, 0.1));
    tuber.blinkTimer = 1e9;
  }
  tuber.forceMorphs = DBG.expr === 'blink' ? { blink_L: 1, blink_R: 1 } : DBG.expr === 'wink' ? { blink_L: 1 } : null;
  if (tuber.rig?.set_mouth_override) { tuber.rig.set_mouth_override(DBG.expr === 'blargh' ? 1 : -1); tuber.rig.set_sit(DBG.expr === 'sit' ? 1 : 0); }
  // poses: front | 34 | profile (head close-up), body | body34 (whole figure), or a yaw in degrees
  const whole = String(DBG.pose).startsWith('body'), hands = DBG.pose === 'hands' || DBG.pose === 'palm', feet = DBG.pose === 'feet';
  const yaw = THREE.MathUtils.degToRad({ front: 0, 34: 38, profile: 90, body: 0, body34: 38, bodyside: 75, bodyback: 180, hands: 55, palm: -70, feet: 40 }[DBG.pose] ?? (+DBG.pose || 0));
  const tgt = hands && tuber.sockets?.hand_R ? tuber.sockets.hand_R.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.03, 0)) : whole ? new THREE.Vector3(0, 0.92, DBG.pose === 'bodyside' ? 0.6 : 0) : DBG.target;
  if (feet) tgt.set(0, 0.07, 0.05);
  const d = (hands ? 0.95 : feet ? 1.6 : whole ? 6.2 : character === 'chratos' ? 1.15 : 3.3) / (DBG.zoom || 1);
  window.__dbgFrames = (window.__dbgFrames || 0) + 1;   // screenshot tools wait for this
  camera.clearViewOffset();
  camera.aspect = innerWidth / innerHeight;
  camera.position.set(tgt.x + d * Math.sin(yaw), tgt.y + 0.02 * d, tgt.z + d * Math.cos(yaw));
  camera.lookAt(tgt);
  camera.updateProjectionMatrix();
  if (DBG.bg) { renderer.setClearColor(new THREE.Color(DBG.bg), 1); document.documentElement.style.background = document.body.style.background = DBG.bg; }
}

/* ---------------------------------------------------------------- stage */
const stage = createStage({
  pixelRatio: Math.min(devicePixelRatio, config.render?.pixelRatio ?? 1.5),
  floor: false, contact: false, shadows: !!config.render?.shadows, preserveDrawingBuffer: false,
});
const { renderer, scene, camera } = stage;
camera.fov = FOV;
camera.near = 0.1; camera.far = 200;
renderer.setClearColor(0x000000, 0);
// transição entre cenas (descarga): a cena que sai é sugada para dentro do vaso / a que entra sai dele
// ---- robustez: erros do JS vão para o crash.log; se a placa de vídeo resetar (driver/jogo pesado),
// o WebGL é recriado recarregando a página em vez de a janela ficar preta/congelada na live
let nLogs = 0;
function logJS(msg) { if (OUTPUT || nLogs++ > 40) return; console.warn('[avatar]', msg); invoke('log_js', { label: 'avatar', msg: String(msg) }).catch(() => {}); }
addEventListener('error', (e) => logJS(`${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => logJS(`promise: ${e.reason?.stack || e.reason}`));
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); logJS('webgl: contexto perdido (reset da placa de vídeo)');
  setTimeout(() => { if (renderer.getContext().isContextLost()) location.reload(); }, 2500);
});
renderer.domElement.addEventListener('webglcontextrestored', () => { logJS('webgl: contexto restaurado, recarregando'); location.reload(); });
const _pv = new THREE.Vector3(), _pv2 = new THREE.Vector3();
const trans = criarTransicao(renderer, scene, camera, {
  // cenário sem o vaso (para a foto que ele engole / a sala que ele cospe)
  semVaso(fn) { const v = tuber?.root.visible; if (tuber) tuber.root.visible = false; try { fn(); } finally { if (tuber) tuber.root.visible = v; } },
  // só o vaso (as luzes continuam): esconde o resto da cena, inclusive os móveis das salas 3D
  soVaso(fn) {
    const esc = [];
    for (const o of scene.children) {
      if (o === tuber?.root || o.isLight || !o.visible) continue;
      if (o.userData.cenario) { for (const c of o.children) if (!c.isLight && c.visible) { esc.push(c); c.visible = false; } }
      else { esc.push(o); o.visible = false; }
    }
    try { fn(); } finally { for (const o of esc) o.visible = true; }
  },
  // boca do vaso no mundo (entre o lábio de baixo e a ponta da tampa); sem sockets: meio do vaso
  bocaMundo(out) {
    const sk = tuber?.sockets;
    if (sk?.mouth && sk?.lip_upper) { sk.mouth.getWorldPosition(out); sk.lip_upper.getWorldPosition(_pv2); out.lerp(_pv2, 0.5); }
    else out.set(0, 0.55, 0.1);
  },
});

// window mode: invisible drag strip on top (Tauri drag region) with a subtle handle on hover
const strip = document.createElement('div');
strip.id = 'drag';
strip.setAttribute('data-tauri-drag-region', '');
strip.innerHTML = '<span data-tauri-drag-region></span>';
document.body.append(strip);

/* ------------------------------------------------------------- outfits */
loading(0.3, 'carregando motor Rust…');
try { const pkg = await import('../../pkg/privada_wasm.js'); await pkg.default?.(); window.privadaWasm = pkg; } catch { /* wasm not built: JS path */ }
const themes = await loadThemes('./themes/');
async function loadPresets() {
  try {
    const ids = await (await fetch('./presets/index.json')).json();
    const raw = {};
    await Promise.all(ids.map(async (id) => { try { raw[id] = await (await fetch(`./presets/${id}.json`)).json(); } catch { /* skip */ } }));
    return raw;
  } catch { return {}; }
}
const presetRaw = await loadPresets();
const resolved = new Map();
// Same resolution as the panel (web/src/app/outfits.js): custom > presets > themes, `extends`
// merged, every raw outfit migrated (mustaches face -> lip_upper). Unknown id -> null.
function resolveOutfit(id) {
  if (!id) return null;
  if (resolved.has(id)) return resolved.get(id);
  const R = makeResolver({ themes, presets: presetRaw, outfits: config.outfits || {} });
  if (!R.raw(id)) return null;
  const out = R.resolve(id);
  resolved.set(id, out);
  return out;
}

// Warm the persisted Rust meshes of the active outfit BEFORE the first build (geocache by worker geo),
// then build the character once, directly in the active outfit.
let geocache = null;
try { geocache = await import('../rig/geocache.js'); } catch { /* not available: plain build */ }
const activeId = config.activeOutfit || 'base';
try { await geocache?.warmOutfit?.(activeId); } catch (e) { console.warn('[avatar] warmOutfit', e); }
const firstTheme = (config.outfitTheme && migrateOutfit(config.outfitTheme)) || resolveOutfit(activeId) || migrateOutfit(themes.base);
let outfitId = config.outfitTheme ? activeId : resolveOutfit(activeId) ? activeId : 'base';
let outfitKey = JSON.stringify(firstTheme);
// Characters: config.character = 'privada' (the toilet, default) | 'chratos' (the human bust,
// web/src/characters/chratos/Chratos.js: needs the Rust/wasm build, else the toilet stays).
// Both expose the same surface (root, body, head, fx, update, play, setTheme, on, blinkTimer).
let currentTheme = firstTheme;
let character = 'privada';
let tuber = null;
let characterJob = 0;
const charKind = (k) => (k === 'chratos' ? 'chratos' : 'privada');
async function createCharacter(kind, theme) {
  if (kind === 'chratos') {
    try {
      const mod = await import('../characters/chratos/Chratos.js');
      if (!mod.chratosReady) throw new Error('Rust/wasm build missing');
      await mod.Chratos.preload(theme, (p) => loading(0.3 + 0.4 * p, 'esculpindo o Chratos…'));
      return [new mod.Chratos(theme), 'chratos'];
    } catch (e) { console.warn('[avatar] chratos unavailable, keeping the toilet:', e?.message || e); }
  }
  return [new ToiletTuber(theme), 'privada'];
}
function mountCharacter(next, kind) {
  if (tuber) { scene.remove(tuber.root); tuber.dispose?.(); }
  tuber = next; character = kind;
  scene.add(tuber.root);
  window.tuber = tuber;
  tuber.on((type, d) => {
    const st = settings();
    if (type !== 'sfx' || st.soundsEnabled === false || config.sfx === false) return;
    typeof d === 'string' ? sfx.play(d) : sfx.play(d.type, d);
  });
}
/** Switch character at runtime (state.character or command {action:'character', arg}). Rebuilds only on change. */
async function setCharacter(kind) {
  kind = charKind(kind);
  if (kind === character) return;
  const job = ++characterJob;
  const [next, got] = await createCharacter(kind, currentTheme);
  if (job !== characterJob || got === character) { next.dispose?.(); return; }   // superseded, or fell back to what is already shown
  mountCharacter(next, got);
  lastSeatKey = null;
  applySettings();
  applyLookLimits();
  snapSoon();
  checkSeat();
}
mountCharacter(...(await createCharacter(charKind(config.character), firstTheme)));

/** Wear a resolved theme (panel's outfitTheme) or an outfit id. Rebuilds only on change. */
function wear(theme, id) {
  if (!theme) return;
  const key = JSON.stringify(theme);
  if (key === outfitKey) return;
  outfitKey = key;
  outfitId = id || theme.id || outfitId;
  currentTheme = theme;
  tuber.setTheme(theme);
  applyLookLimits();
  snapSoon();
  checkSeat();
}
// Auto-sit: furniture on floor_under with a seat (chair/throne) -> sit; removed -> stand.
// Only on seat presence CHANGES (id/height), so the physics worker's own re-sit after a prop
// reset is never double-triggered.
let lastSeatKey = null;
function checkSeat() {
  const h = typeof tuber.seatHeight === 'function' ? +tuber.seatHeight() || 0 : 0;
  const ids = (tuber.accessories || []).filter((w) => w.userData?.slot === 'floor_under').map((w) => w.userData.entry?.id).join(',');
  const key = `${ids}|${h.toFixed(3)}`;
  if (key === lastSeatKey) return;
  const first = lastSeatKey === null;
  lastSeatKey = key;
  if (h > 0 && !tuber.isSitting) tuber.play('sit');
  else if (h <= 0 && tuber.isSitting && !first) tuber.play('stand');
}
function applyOutfit(id) {
  const t = resolveOutfit(id);
  if (!t) return console.warn('[avatar] unknown outfit', id);
  wear(t, id);
}
function applyConfigOutfit() {
  if (config.outfitTheme) wear(migrateOutfit(config.outfitTheme), config.activeOutfit);
  else applyOutfit(config.activeOutfit || 'base');
}

/* ----------------------------------------------------- look limits */
let rigHasLimits = false;
function applyLookLimits() {
  const L = lookCfg();
  const yaw = THREE.MathUtils.degToRad(L.maxYawDeg), pitch = THREE.MathUtils.degToRad(L.maxPitchDeg);
  // Rust rig (privada-core via wasm) or a JS rig that exposes it; otherwise we add the extra turn ourselves
  const fn = tuber.set_look_limits || tuber.setLookLimits || tuber.rust?.set_look_limits;
  rigHasLimits = typeof fn === 'function';
  if (rigHasLimits) fn.call(tuber.rust && tuber.rust.set_look_limits === fn ? tuber.rust : tuber, yaw, pitch);
}

/* -------------------------------------------------------- sala 3D (cenário) */
// Cena com fundo "sala": o fundo 3D completo é desenhado na MESMA cena/renderer do personagem
// (web/src/cenario). Carregado só quando alguma cena usa (não pesa para quem não usa).
// Dois ambientes: 'sala' (porão de concreto) e 'ilha' (ilha tropical). Cada um é criado só na 1ª vez.
const AMBS = ['sala', 'ilha', 'banheiro', 'prisao', 'bar'];   // fundos 3D (scene.background)
const cenarios = {}, cenarioJobs = {}, usoCen = [];
let cenario = null;   // o último ativado (editor / miniaturas)
const ambDe = (sc) => (AMBS.includes(sc?.background) ? sc.background : 'sala');
function garantirCenario(amb = ambDe(scene0())) {
  if (cenarios[amb]) return Promise.resolve(cenarios[amb]);
  if (!cenarioJobs[amb]) cenarioJobs[amb] = import('../cenario/cenario.js')
    .then((m) => m.criarCenario({ renderer, scene, camera, invoke, invokeRaw, ambiente: amb, opcoes: { som: (n, d) => sfx.play(n, d), reagir: (n) => { try { tuber.play(n); } catch { /* */ } } } }))
    .then((c) => { cenarios[amb] = c; c.pausa?.(pausado); return c; })
    .catch((e) => { console.warn('[avatar] cenário 3D indisponível:', amb, e); cenarioJobs[amb] = null; return null; });
  return cenarioJobs[amb];
}
/** no máximo 2 ambientes montados na memória (o atual + o anterior, para a troca ser instantânea) */
function liberarCenarios(atual) {
  const i = usoCen.indexOf(atual); if (i >= 0) usoCen.splice(i, 1); usoCen.unshift(atual);
  for (const amb of usoCen.slice(2)) {
    const c = cenarios[amb]; if (!c || c.ativo) continue;
    try { c.destruir?.(); } catch (e) { console.warn('[avatar] liberar', amb, e); }
    delete cenarios[amb]; delete cenarioJobs[amb]; usoCen.splice(usoCen.indexOf(amb), 1); prontos.delete(amb);
  }
}
const cenarioAtivo = () => { for (const k in cenarios) if (cenarios[k].ativo) return cenarios[k]; return null; };
const usaSala = (sc) => !OUTPUT && AMBS.includes(sc?.background);

/* ------------------------------------------------------------- scenes */
let follow = true, micOn = true, scale = 1, charPx = BASE_PX, mode = 'window';
function applySettings() {
  const st = settings();
  if (st.restOpen != null) tuber.restOpen = +st.restOpen;
  tuber.setPropSettings?.(st.props);   // settings.props = { resetAfter: 8 (s, 0 = never), enabled: true }
  if (st.soundVolume != null) sfx.volume = +st.soundVolume;   // honoured if sfx.js supports a volume
  sfx.enabled = st.soundsEnabled !== false;
  const r = config.render || {};
  if (prPronto) { prAtual = 0; conferirPR(); } else renderer.setPixelRatio(Math.min(devicePixelRatio, r.pixelRatio ?? 1.5));
  const sh = !!r.shadows;
  if (renderer.shadowMap.enabled !== sh) {
    renderer.shadowMap.enabled = sh;
    scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)); });
  }
  setTick();
}

let ultimoTam = '', ultimoModo = '', ultimoCT = '', ultimoFundo = '';
let firstFrame = false;
let cenaAtual = -1;     // índice da cena aplicada por último (para saber quando houve troca de cena)
// Ambiente 3D novo: antes de trocar, ele é montado aos poucos, as texturas sobem para a placa e os
// shaders são compilados em paralelo (compileAsync). Enquanto isso a cena atual continua rodando lisa;
// a troca (e a transição) só acontece quando está tudo pronto — era isso que travava na troca de cenas.
const prontos = new Set(), preparando = {};
let compilouPalco = false;
async function prepararCenario(amb) {
  const c = await garantirCenario(amb); if (!c) return;
  await c.preparar();
  await c.subirTexturas();
  try { await c.comoVisual(() => renderer.compileAsync(scene, camera)); } catch (e) { logJS(`compilar ${amb}: ${e}`); }
}
function applyScene(i, { save = false } = {}) {
  if (config.scenes?.length) config.activeScene = clamp(i | 0, 0, config.scenes.length - 1);
  const sc = scene0();
  if (usaSala(sc) && !prontos.has(ambDe(sc))) {
    const amb = ambDe(sc);
    if (save) saveSoon();
    if (!preparando[amb]) preparando[amb] = prepararCenario(amb).catch((e) => logJS(`preparar ${amb}: ${e}`)).finally(() => {
      preparando[amb] = null; prontos.add(amb);
      if (usaSala(scene0()) && ambDe(scene0()) === amb) applyScene(config.activeScene | 0);
    });
    if (cenaAtual >= 0) return;   // segue mostrando a cena atual até o ambiente novo ficar pronto
  }
  // troca de cena -> transição. Fotografa a cena antiga ANTES de mudar qualquer coisa.
  let tr = null;
  const idx = config.activeScene | 0;
  if (!OUTPUT && firstFrame && cenaAtual >= 0 && idx !== cenaAtual) {
    const tipo = sc.transicao || 'descarga';
    if (trans.ativa) trans.cancelar();
    if (tipo !== 'nenhuma' && trans.capturar(tipo)) tr = { tipo, modo: usaSala(sc) ? 'entra' : 'sai' };
  }
  cenaAtual = idx;
  const st = settings();
  micOn = sc.mic !== false;
  if (sc.outfit) applyOutfit(sc.outfit);
  let solid, color;
  if (OUTPUT) {
    const o = outCfg();
    mode = 'output';
    scale = o.scale ?? 1.3;
    follow = o.follow ?? st.followDefault ?? true;
    solid = o.background !== 'transparent';
    color = o.color || '#00ff00';
  } else {
    mode = usaSala(sc) ? 'window' : (sc.mode || 'window');   // a sala é sempre numa janela própria
    scale = sc.scale ?? 1;
    follow = sc.follow ?? st.followDefault ?? true;
    solid = sc.background === 'color' || sc.background === 'chroma' || usaSala(sc);
    color = usaSala(sc) ? '#000000' : (sc.bgColor || '#00ff00');
    if (usaSala(sc)) {
      const amb = ambDe(sc);
      for (const [k, c] of Object.entries(cenarios)) if (k !== amb) c.desativar();
      garantirCenario(amb).then((c) => {
        if (!(c && usaSala(scene0()) && ambDe(scene0()) === amb)) return;
        c.ativar(); cenario = c; liberarCenarios(amb);
        // a variante "sem cenário" (luzes do palco) dos shaders do vaso também fica pronta, para a volta ao gameplay não travar
        if (!compilouPalco) { compilouPalco = true; setTimeout(() => { try { c.miniatura(() => renderer.compileAsync(scene, camera)); } catch { /* */ } }, 1500); }
      });
    } else for (const c of Object.values(cenarios)) c.desativar();
    // tamanho fixo da janela (ex.: 1920x1080 para o OBS). Em pixels reais da tela: o Tauri recebe
    // tamanho lógico, então divide pela escala do Windows (125%, 150%...). Só reaplica quando a cena
    // ou o tamanho mudam (a cada 'state' do painel o applyScene roda de novo).
    const tam = mode === 'window' && /^\d+x\d+$/.test(sc.winSize || '') ? sc.winSize : '';
    // Só mexe na janela quando algo muda de verdade: cada chamada (bordas, barra de tarefas, tamanho)
    // faz o Windows recompor a janela do WebView, e isso aparecia como uma travadinha na troca de cena.
    const args = { mode, alwaysOnTop: !!sc.alwaysOnTop };
    if (tam) {
      const [w, h] = tam.split('x').map(Number), d = devicePixelRatio || 1;
      const difere = Math.abs(Math.round(innerWidth * d) - w) > 2 || Math.abs(Math.round(innerHeight * d) - h) > 2;
      if (difere) { args.width = w / d; args.height = h / d; }
    }
    ultimoTam = `${config.activeScene}:${tam}`;
    const chaveModo = `${mode}|${args.alwaysOnTop}`;
    if (args.width || chaveModo !== ultimoModo) { ultimoModo = chaveModo; invoke('set_avatar_mode', args).catch(() => {}); }
    const ct = mode === 'overlay' ? (sc.clickThrough || 'auto') : 'off';
    if (ct !== ultimoCT) { ultimoCT = ct; invoke('set_click_through', { mode: ct }).catch(() => {}); }
  }
  // a sala "saindo do ralo": a janela fica transparente até a transição acabar (o jogo aparece atrás no OBS)
  const fundoJanela = (on) => {
    document.documentElement.style.background = document.body.style.background = on ? color : 'transparent';
    // native window background matches the page, so nothing white can show around the webview
    const cor = on ? color : 'transparent';
    if (!OUTPUT && cor !== ultimoFundo) { ultimoFundo = cor; invoke('set_window_background', { color: cor }).catch(() => {}); }
  };
  renderer.setClearColor(solid ? color : 0x000000, solid ? 1 : 0);
  if (tr) {
    const ehEntra = tr.modo === 'entra';
    fundoJanela(solid && !ehEntra);
    trans.engoliu = false;
    trans.iniciar({ ...tr, fim: () => { if (cenaAtual === idx) fundoJanela(solid); } });
    sfx.play({ descarga: 'whoosh', agua: 'flush', arroto: 'arroto', papel: 'rolo' }[tr.tipo] || '');
  } else if (!trans.ativa) fundoJanela(solid);
  document.body.classList.toggle('windowed', mode !== 'overlay');
  document.body.classList.toggle('solidbg', !!solid);
  layout();
  snapSoon();
  if (save) saveSoon();
}

function layout() {
  charPx = BASE_PX * scale;
}
const restPoint = () => {
  const p = OUTPUT ? outCfg() : scene0();
  return [(p.x ?? 0.5) * innerWidth, (p.y ?? 0.82) * innerHeight];
};

let saveTimer = 0;
function saveSoon() {
  if (OUTPUT) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => invoke('save_config', { config }).catch(() => {}), 800);
}

/* -------------------------------------------------- camera placement */
// The character stays at the world origin (FX simulate in world space); the camera moves:
// its distance sets the on-screen size and a view offset puts the feet at (sx, sy).
function placeCamera(sx, sy) {
  const W = innerWidth, H = innerHeight;
  const halfH = (CHAR_H * H) / (2 * charPx);
  const dist = halfH / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  camera.aspect = W / H;
  camera.near = 0.1; camera.far = 200;
  camera.position.set(0, CENTER_Y, dist);
  camera.lookAt(0, CENTER_Y, 0);
  const cx = sx, cy = sy - (charPx * CENTER_Y) / CHAR_H;
  camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
  camera.updateProjectionMatrix();
}

/* -------------------------------------------------------------- input */
// cursor: { x, y, win?: { x, y, w, h, scale } } in virtual-desktop physical px (all monitors)
const cursor = { x: 0, y: 0, win: null, seen: false };
listen('cursor', (p) => {
  if (!p) return;
  cursor.x = p.x; cursor.y = p.y; cursor.win = p.win || null; cursor.seen = true;
});
if (!isTauri) addEventListener('pointermove', (e) => {
  const dpr = devicePixelRatio || 1;
  cursor.x = (window.screenX + e.clientX) * dpr; cursor.y = (window.screenY + e.clientY) * dpr;
  cursor.win = null; cursor.seen = true;
});

let rustMouth = zeroMouth(), rustMouthT = 0;
// panel's mouth-corner test: { cornerL: 0|1, cornerR: 0|1 } heartbeat every 1 s; expires after ~2 s
let mouthTest = null, mouthTestT = 0;
listen('mouth-test', (p) => {
  if (!p) return;
  mouthTest = { cornerL: +p.cornerL || 0, cornerR: +p.cornerR || 0 };
  mouthTestT = performance.now();
});
listen('mouth', (m) => { rustMouth = m; rustMouthT = performance.now(); });
const fake = new FakeTalk();
let browserMic = null;
async function toggleBrowserMic(on) {
  if (isTauri || OUTPUT) return;
  if (on && !browserMic) {
    const { Mic } = await import('../input/mic.js');
    browserMic = new Mic();
    try { await browserMic.start(); } catch (e) { console.warn('[avatar] mic', e); browserMic = null; }
  } else if (!on && browserMic) { browserMic.stop(); browserMic = null; }
}

/* ------------------------------------------------------------ actions */
function act(action, arg) {
  switch (action) {
    case 'play': tuber.play(arg); break;
    case 'character': config.character = charKind(arg); setCharacter(config.character); saveSoon(); break;
    case 'outfit': config.outfitTheme = null; config.activeOutfit = arg; applyOutfit(arg); saveSoon(); break;
    case 'scene': applyScene(+arg, { save: true }); break;
    case 'viseme': fake.hold(arg, 0.6); break;
    case 'sala': garantirCenario(ambDe(scene0())).then((c) => c?.editar(arg || 'toggle')); break;   // abre/fecha o editor da sala 3D
    case 'evento': cenarioAtivo()?.evento(arg || 'aleatorio'); break;                                  // objetos interativos do cenário 3D
    case 'tv': cenarioAtivo()?.canal(arg && arg !== 'proximo' ? arg : null); break;                      // TV: próximo canal / 'verde' / id
    case 'pausa': setPausa(arg === 'on' ? true : arg === 'off' ? false : !pausado); break;                // "Volto já" 
    case 'say': fake.say(arg || ''); break;
    case 'toggle':
      if (arg === 'clickthrough') {
        if (OUTPUT || mode !== 'overlay') break;
        const sc = scene0();
        sc.clickThrough = { auto: 'on', on: 'off', off: 'auto' }[sc.clickThrough || 'auto'] || 'auto';
        invoke('set_click_through', { mode: sc.clickThrough }).catch(() => {});
      } else if (arg === 'follow') follow = !follow;
      else if (arg === 'mic') {
        micOn = !micOn;
        if (isTauri) { if (!OUTPUT) invoke('set_audio', { audio: { ...config.audio, enabled: micOn } }).catch(() => {}); }
        else toggleBrowserMic(micOn);
      } else if (arg === 'sfx') config.sfx = config.sfx === false;
      break;
    case 'reset': break;   // no throwing anymore: he always sits on the scene point
    case 'open': if (!OUTPUT) invoke('open_control').catch(() => {}); break;
    default: console.warn('[avatar] unknown action', action, arg);
  }
}
listen('hotkey', (p) => { if (p && p.action && config.hotkeysEnabled !== false) act(p.action, p.arg); });
listen('command', (p) => { if (p && p.action) act(p.action, p.arg); });
listen('state', (cfg) => {
  if (!cfg) return;
  const outfitsChanged = JSON.stringify(cfg.outfits || {}) !== JSON.stringify(config.outfits || {});
  config = { ...structuredClone(DEFAULT_CONFIG), ...cfg };
  if (outfitsChanged) resolved.clear();
  applySettings();
  applyConfigOutfit();
  applyScene(config.activeScene);
  applyLookLimits();
  setCharacter(config.character);   // no-op unless config.character changed
});

// right-click opens the panel (window mode: anywhere; overlay: on the character)
const el = renderer.domElement;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
el.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (OUTPUT) return;
  if (mode === 'overlay') {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.intersectObject(tuber.body, true).length) return;
  }
  invoke('open_control').catch(() => {});
});

/* ---------------------------------------- hit rect (overlay click-through) */
const box = new THREE.Box3(), tmp = new THREE.Box3(), corner = new THREE.Vector3();
function computeHitRect() {
  box.makeEmpty();
  for (const c of tuber.root.children) if (c !== tuber.fx && c.visible) { tmp.setFromObject(c); box.union(tmp); }
  if (box.isEmpty()) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
    const px = ((corner.x + 1) / 2) * innerWidth, py = ((1 - corner.y) / 2) * innerHeight;
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  const pad = 8;
  return { x: Math.round(x0 - pad), y: Math.round(y0 - pad), w: Math.round(x1 - x0 + 2 * pad), h: Math.round(y1 - y0 + 2 * pad) };
}
let hitRect = null, frames = 0, fps = 0, fpsT = performance.now();
if (!OUTPUT) setInterval(() => {
  if (mode !== 'overlay') { if (hitRect) { hitRect = null; invoke('set_hit_rect', { rect: null }).catch(() => {}); } return; }
  hitRect = computeHitRect();
  invoke('set_hit_rect', { rect: hitRect }).catch(() => {});
}, 100);
setInterval(() => checkSeat(), 250);   // catches accessory rebuilds that don't go through wear()
if (!OUTPUT) setInterval(() => {
  emit('avatar-status', { fps, hitRect, outfitId, sceneId: config.activeScene, mode, follow, mic: micOn, rigHasLimits, character });
}, 250);

/* --------------------------------------------------------------- look */
// Vector from the character's head ON SCREEN (window rect + projected head) to the global
// cursor, mapped with a saturating curve so far monitors still give strong, smooth turns.
const head = new THREE.Vector3();
function computeLook() {
  tuber.head.getWorldPosition(head).project(camera);
  const hxL = ((head.x + 1) / 2) * innerWidth, hyL = ((1 - head.y) / 2) * innerHeight;   // logical px in window
  let hx, hy;
  const w = cursor.win;
  if (w) { const s = w.scale || devicePixelRatio || 1; hx = w.x + hxL * s; hy = w.y + hyL * s; }
  else { const s = devicePixelRatio || 1; hx = (window.screenX + hxL) * s; hy = (window.screenY + hyL) * s; }
  const L = lookCfg(), sens = settings().lookSensitivity ?? 1;
  const dx = cursor.x - hx, dy = cursor.y - hy;
  return {
    x: Math.tanh(dx / L.reachPx) * L.range * sens,
    y: Math.tanh(-dy / (L.reachPx * 0.8)) * L.range * sens,
  };
}
let remoteLook = null, remoteMouth = null, remoteT = 0, poseT = 0;
if (OUTPUT) listen('avatar-pose', (p) => { if (p && p.look) { remoteLook = p.look; remoteMouth = p.mouth || null; remoteT = performance.now(); } });

/* ------------------------------------------------- panel preview mirror */
// The control panel shows THIS window: it sends `preview-want` {on, fps, width} as a heartbeat
// (expires after 5 s) and `preview-snap` for an immediate frame. Zero cost when nobody asks.
const pv = { on: false, fps: 8, width: 360, until: 0, last: 0, pending: false, snap: false, seq: 0, canvas: null, ctx: null, checker: null };
listen('preview-want', (p) => {
  if (!p) return;
  pv.on = !!p.on;
  pv.fps = clamp(+p.fps || 8, 1, 30);
  pv.width = clamp(+p.width || 360, 64, 1280) | 0;
  pv.until = performance.now() + 5000;
});
listen('preview-snap', () => { pv.snap = true; pv.until = Math.max(pv.until, performance.now() + 5000); });
function checkerPattern(ctx) {
  const c = new OffscreenCanvas(16, 16), g = c.getContext('2d');
  g.fillStyle = '#2a2b31'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#34353c'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  return ctx.createPattern(c, 'repeat');
}
function capturePreview(now) {
  // called right after a render (the WebGL buffer is still valid in this task)
  const want = (pv.on || pv.snap) && now < pv.until;
  if (!want || pv.pending || typeof OffscreenCanvas === 'undefined') return;
  if (!pv.snap && now - pv.last < 1000 / pv.fps) return;
  pv.snap = false; pv.last = now; pv.pending = true;
  const src = renderer.domElement;
  const w = pv.width, h = Math.max(1, Math.round((w * src.height) / Math.max(1, src.width)));
  if (!pv.canvas || pv.canvas.width !== w || pv.canvas.height !== h) {
    pv.canvas = new OffscreenCanvas(w, h);
    pv.ctx = pv.canvas.getContext('2d');
    pv.checker = checkerPattern(pv.ctx);
  }
  const ctx = pv.ctx;
  const bg = document.body.style.background;
  if (!bg || bg === 'transparent') { ctx.fillStyle = pv.checker; ctx.fillRect(0, 0, w, h); }
  else { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(src, 0, 0, w, h);
  const seq = ++pv.seq;
  pv.canvas.convertToBlob({ type: 'image/webp', quality: 0.75 })
    .then((b) => (b && b.type === 'image/webp' ? b : pv.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })))
    .then((b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }))
    .then((data) => emit('preview-frame', { data, w, h, seq }))
    .catch(() => {})
    .finally(() => { pv.pending = false; });
}
// after an outfit/scene change has rendered, push a fresh frame
const snapSoon = () => { pv.snap = true; };

/* ----------------------------------------- idle preload of other outfits */
async function preloadOutfits() {
  const mod = geocache;
  if (!mod) return;
  const fn = mod.preload || mod.preloadTheme;
  if (typeof fn !== 'function') return;
  const ids = [...Object.keys(presetRaw), ...Object.keys(themes)].filter((id) => id !== outfitId);
  const idle = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 8 }), 50));
  const next = () => {
    const id = ids.shift();
    if (!id) return;
    idle(async () => {
      try { const t = resolveOutfit(id); if (t) await fn.call(mod, t); }
      catch (e) { console.warn('[avatar] preload', id, e); }
      next();   // one item at a time
    });
  };
  next();
}

/* ------------------------------------------------ outfit thumbnails */
// Generated at load (people keep creating presets) with THIS window's GPU renderer: each missing
// thumbnail is rendered into a 256x256 corner of the default framebuffer (same tone mapping and
// colour pipeline as the live view, no second WebGL context), copied out in the same task, then
// overwritten by the normal frame. Cached in Rust: thumb_get / thumb_put (key below).
// same key as the panel (ui/src/lib/thumbs.ts): outfitThumbKey(resolvedTheme) -> "thumb_o-<hash>_v<n>"
const thumbKey = (id, theme) => outfitThumbKey(theme);
const TH = 256;
const th = { queue: [], phase: false, phaseT0: 0, total: 0, done: 0, keys: [], cam: new THREE.PerspectiveCamera(26, 1, 0.05, 50), out: null };
function allOutfits() {
  // resolve exactly like the panel (web/src/app/outfits.js makeResolver)
  const { raw, resolve } = makeResolver({ themes, presets: presetRaw, outfits: config.outfits || {} });
  const ids = new Set([...Object.keys(themes), ...Object.keys(presetRaw), ...Object.keys(config.outfits || {})]);
  const list = [], seen = new Set();
  for (const id of ids) {
    if (!raw(id)) continue;
    const t = resolve(id), key = thumbKey(id, t);
    if (seen.has(key)) continue;            // same look under two ids -> one thumbnail
    seen.add(key);
    list.push({ id, theme: t });
  }
  for (const id of listAccessories()) if (id !== 'glb') list.push({ id, acc: true });
  return list;
}
async function queueMissing(items) {
  const checks = await Promise.all(items.map(async (it) => {
    const key = it.acc ? accThumbKey(it.id) : thumbKey(it.id, it.theme);
    try { const b = await invoke('thumb_get', { key }); return b && (b.byteLength ?? b.length) > 0 ? null : { ...it, key }; }
    catch { return { ...it, key }; }
  }));
  const miss = checks.filter(Boolean).filter((m) => !th.queue.some((q) => q.key === m.key));
  th.queue.push(...miss);
  return miss.length;
}
// Render one thumbnail synchronously into the canvas corner and start its async encode/upload.
function renderOneThumb() {
  const it = th.queue.shift();
  if (!it) return false;
  let tb = null, accMats = null;
  try {
    if (it.acc) {
      // accessory alone, base-theme materials, same lights/camera pipeline
      accMats = new MaterialLib(themes.base.materials);
      const obj = buildAccessory({ THREE, mats: accMats, theme: themes.base, dim: DIM }, { id: it.id, params: {} });
      if (!obj) throw new Error('unknown accessory');
      const g = new THREE.Group(); g.add(obj);
      tb = { root: g, body: g, mats: accMats };
      g.updateMatrixWorld(true);
    } else {
      tb = new ToiletTuber(it.theme);
      for (let i = 0; i < 8; i++) tb.update(1 / 30, { look: { x: 0.25, y: 0.05 }, mouth: zeroMouth() });
      tb.root.updateMatrixWorld(true);
    }
    // frame on the BODY only: fx InstancedMesh matrices (water drops/foam) are non-finite and
    // Box3.setFromObject ignores `visible`, which made the whole box NaN (blank thumbnails)
    const box = new THREE.Box3().setFromObject(tb.body);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || !Number.isFinite(sphere.center.x + sphere.center.y + sphere.center.z) || sphere.radius <= 0) {
      throw new Error('non-finite bounds');
    }
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const r = Math.max(sz.x, sz.y, sz.z) * 0.62;
    const d = r / Math.tan(THREE.MathUtils.degToRad(13));
    th.cam.position.set(c.x + d * 0.32, c.y + d * 0.12, c.z + d * 0.94);
    th.cam.lookAt(c);
    th.cam.clearViewOffset();
    th.cam.updateProjectionMatrix();

    const pr = renderer.getPixelRatio();
    const S = TH / pr;                                         // logical px -> exactly 256 device px
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    tuber.root.visible = false;
    scene.add(tb.root);
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, S, S); renderer.setScissor(0, 0, S, S);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    const ca = cenarioAtivo(); if (ca) ca.miniatura(() => renderer.render(scene, th.cam)); else renderer.render(scene, th.cam);
    if (!th.out) { th.out = new OffscreenCanvas(TH, TH); th.outCtx = th.out.getContext('2d'); }
    const cv = renderer.domElement;
    th.outCtx.clearRect(0, 0, TH, TH);
    th.outCtx.drawImage(cv, 0, cv.height - TH, TH, TH, 0, 0, TH, TH);   // GL viewport origin = bottom-left
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    renderer.setClearColor(prevClear, prevAlpha);
    scene.remove(tb.root);
    tuber.root.visible = true;
    const key = it.key;
    th.out.convertToBlob({ type: 'image/webp', quality: 0.9 })
      .then((b) => b.arrayBuffer())
      .then((buf) => invokeRaw('thumb_put', new Uint8Array(buf), { 'x-key': key }))
      .then(() => { th.keys.push(key); })
      .catch((e) => console.warn('[avatar] thumb_put', key, e));
  } catch (e) {
    console.warn('[avatar] thumbnail failed', it.id, e);
    scene.remove(tb?.root); tuber.root.visible = true;
    renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
  } finally {
    if (tb) { tb.root.traverse((o) => o.geometry?.dispose?.()); tb.mats?.dispose?.(); }
  }
  th.done++;
  return true;
}
function flushThumbKeys() {
  setTimeout(() => {   // give the last encodes a moment
    if (th.keys.length) { emit('thumbs-updated', { keys: th.keys.splice(0) }); }
  }, 400);
}
// panel asks for new/edited outfits
listen('thumbs-request', async (p) => {
  const items = (p?.outfits || []).map((t, i) => ({ id: t.id || `custom-${i}`, theme: migrateOutfit(t.extends ? mergeTheme(resolveOutfit(t.extends) || themes.base, t) : t) }));
  if (await queueMissing(items)) idleThumbs();
});
// after the splash: one thumbnail per idle slot, rendered right before a normal frame (no flash)
let idleScheduled = false;
function idleThumbs() {
  if (idleScheduled || !th.queue.length) return;
  idleScheduled = true;
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 60));
  idle(() => { idleScheduled = false; th.wantOne = true; });
}

/* --------------------------------------------------------------- pausa ("Volto já") */
// O vaso dorme no ambiente em que estiver: olhos fechados, respiração, Zzz subindo, ronco e uma placa
// de madeira "VOLTO JÁ" fincada do lado dele. O cenário 3D fica mais escuro.
var pausado = false;
const pz = { grupo: null, zs: [], ronco: 0, placa: null, texto: '' };
function texPlaca(texto, sub) {
  const c = document.createElement('canvas'); c.width = 768; c.height = 384; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 384); g.addColorStop(0, '#a8743f'); g.addColorStop(1, '#7c5128'); x.fillStyle = g; x.fillRect(0, 0, 768, 384);
  for (let k = 0; k < 60; k++) { x.strokeStyle = `rgba(60,35,15,${0.08 + Math.random() * 0.12})`; x.lineWidth = 1 + Math.random() * 2; x.beginPath(); const y = Math.random() * 384; x.moveTo(0, y); x.bezierCurveTo(250, y + 8, 500, y - 8, 768, y + 3); x.stroke(); }
  x.strokeStyle = '#4a2c12'; x.lineWidth = 16; x.strokeRect(8, 8, 752, 368);
  x.fillStyle = '#fff6dc'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 8; x.shadowOffsetY = 4;
  x.font = 'bold 132px Georgia, serif'; x.fillText(texto, 384, sub ? 160 : 192, 700);
  if (sub) { x.font = 'italic 58px Georgia, serif'; x.fillText(sub, 384, 296, 700); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function montarPausa() {
  const texto = (config.pausa?.texto || 'VOLTO JÁ').toUpperCase(), sub = config.pausa?.sub ?? 'fui ali e já volto';
  const chave = texto + '|' + sub;
  if (pz.grupo && pz.texto === chave) return;
  if (pz.grupo) { scene.remove(pz.grupo, pz.grupo.userData.zz); pz.grupo.userData.zz.traverse((o) => o.material?.dispose()); pz.grupo.traverse((o) => { o.geometry?.dispose(); for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.dispose(); } }); }
  pz.texto = chave;
  const g = new THREE.Group(); g.name = 'pausa';
  const mad = new THREE.MeshStandardMaterial({ color: '#7c5128', roughness: 0.8 });
  // estaca ATRÁS da placa (antes atravessava a frente e cobria o texto)
  const estaca = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.05), mad); estaca.position.set(0, 0.65, -0.05); estaca.castShadow = true; g.add(estaca);
  const placa = new THREE.Group(); placa.position.y = 1.18; g.add(placa);
  const tab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.04), [mad, mad, mad, mad, new THREE.MeshStandardMaterial({ map: texPlaca(texto, sub), roughness: 0.7 }), mad]);
  tab.castShadow = true; placa.add(tab); pz.placa = placa;
  const zTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); x.font = 'bold 110px Georgia'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 10; x.strokeStyle = '#1b2a4a'; x.strokeText('Z', 64, 64); x.fillStyle = '#eaf2ff'; x.fillText('Z', 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const zz = new THREE.Group(); zz.name = 'zzz'; g.userData.zz = zz;
  pz.zs = [0, 1, 2].map((i) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false })); sp.userData.f = i / 3; zz.add(sp); return sp; });
  pz.grupo = g; g.visible = false; zz.visible = false; scene.add(g, zz);
}
function setPausa(on) {
  pausado = !!on;
  if (pausado) montarPausa();
  if (pz.grupo) { pz.grupo.visible = pausado; pz.grupo.userData.zz.visible = pausado; }
  for (const k in cenarios) cenarios[k].pausa?.(pausado);
  emit('pausa', pausado);
}
function animarPausa(dt) {
  // olhos fechados: "esmaga" os olhos na vertical depois do update do rig
  for (const e of tuber.eyes || []) if (e.eye) e.eye.scale.y = e.eye.scale.x * 0.08;
  montarPausa();   // refaz a placa só se o texto mudou no painel
  if (!pz.grupo) return;
  if (!pz.grupo.visible) { pz.grupo.visible = true; pz.grupo.userData.zz.visible = true; }
  // placa à esquerda do vaso (no mundo o vaso está sempre na origem), virada para a câmera
  pz.grupo.position.set(-0.95, 0, 0.3);
  pz.grupo.rotation.y = Math.atan2(camera.position.x - pz.grupo.position.x, camera.position.z - pz.grupo.position.z) * 0.8;
  pz.placa.rotation.z = Math.sin(performance.now() / 900) * 0.02;
  const t = performance.now() / 1000;
  for (const sp of pz.zs) {
    const k = (t * 0.33 + sp.userData.f) % 1;
    sp.position.set(0.25 + 0.25 * k + Math.sin(k * 6) * 0.05, 1.75 + k * 0.7, 0);
    const sz = 0.12 + k * 0.16; sp.scale.set(sz, sz, 1);
    sp.material.opacity = Math.sin(k * Math.PI);
  }
}

/* --------------------------------------------------------------- loop */
let last = performance.now(), lastRaf = performance.now(), lastFrame = 0, nFrame = 0;
function frame(now) {
  const minDt = 1000 / clamp(config.render?.fps ?? 60, 10, 240) - 1;
  if (now - lastFrame < minDt) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; lastFrame = now;

  const [sx, sy] = restPoint();
  // durante a transição o vaso "engole" a cena (dá uma inchada quando engole)
  const comBoca = trans.ativa && (trans.tipo === 'descarga' || trans.tipo === 'arroto');
  charPx = BASE_PX * scale * (1 + (trans.ativa && trans.tipo === 'descarga' ? curvas.gole(trans.modo, trans.progresso) : 0) + (pausado ? Math.sin(now / 1000 * 1.6) * 0.008 : 0));
  if (comBoca && trans.tipo === 'descarga' && trans.modo === 'sai' && trans.progresso > 0.8 && !trans.engoliu) { trans.engoliu = true; sfx.play('gole'); }
  const cAtivo = cenarioAtivo();
  if (cAtivo) cAtivo.frame(dt, tuber);   // cenário 3D: câmera do cenário (o personagem fica no "lugar" dele)
  else placeCamera(sx, sy);
  if ((nFrame++ & 31) === 0) conferirPR();
  if ((nFrame & 127) === 1) semTransmissao();
  if (DBG) debugCamera();

  let look = { x: 0, y: 0 };
  if (OUTPUT && remoteLook && now - remoteT < 500) look = follow ? remoteLook : look;
  else if (follow && cursor.seen && !DBG) look = computeLook();

  let mic = null;
  if (isTauri) { if (micOn && now - rustMouthT < 500) mic = rustMouth; }
  else if (browserMic) mic = browserMic.update(dt);
  else if (OUTPUT && remoteMouth && now - remoteT < 500) mic = remoteMouth;
  const test = mouthTest && now - mouthTestT < 2000 && (mouthTest.cornerL || mouthTest.cornerR) ? mouthTest : null;
  const rawMouth = maxMouth(mic, fake.update(dt), test);   // maxMouth keeps the signed corner channels
  let mouth = DBG ? { ...zeroMouth(), ...(DBG_EXPR[DBG.expr] || {}) } : shapeMouth(rawMouth);
  if (comBoca) { const b = curvas.boca(trans.modo, trans.progresso, trans.tipo); if (b > 0.01) mouth = { ...zeroMouth(), open: b * 0.85, wide: b * 0.6, round: b * 0.15 }; }
  if (pausado) {   // dormindo: respira devagar com a boca, olha para baixo e ronca de vez em quando
    const t = now / 1000, resp = 0.5 + 0.5 * Math.sin(t * 1.6);
    mouth = { ...zeroMouth(), open: 0.06 + 0.16 * resp, round: 0.3 * resp };
    look = { x: Math.sin(t * 0.2) * 0.1, y: -0.45 };
    if (config.pausa?.ronco !== false && t - pz.ronco > 3.9) { pz.ronco = t; sfx.play('ronco'); }
  }

  if (settings().autoBlink === false || DBG) tuber.blinkTimer = 1e9;
  else if (tuber.blinkTimer > 1e8) tuber.blinkTimer = 2;

  // the JS rig clamps look to [-1, 1]; extra range beyond it is added after the update
  const lx = clamp(look.x, -1, 1), ly = clamp(look.y, -1, 1);
  if (!DBG?.freeze) tuber.update(dt, { look: { x: lx, y: ly }, mouth });
  if (pausado) animarPausa(dt);
  if (!rigHasLimits) {
    const L = lookCfg();
    const yaw = THREE.MathUtils.degToRad(L.maxYawDeg), pitch = THREE.MathUtils.degToRad(L.maxPitchDeg);
    smoothExtra.y += ((Math.max(0, yaw - RIG_YAW) * lx) - smoothExtra.y) * Math.min(1, dt * 6);
    smoothExtra.x += ((Math.max(0, pitch - RIG_PITCH) * ly) - smoothExtra.x) * Math.min(1, dt * 6);
    tuber.body.rotation.y += smoothExtra.y * 0.6;
    tuber.head.rotation.y += smoothExtra.y * 0.4;
    tuber.head.rotation.x -= smoothExtra.x;
  }
  if (!OUTPUT && now - poseT > 33) { poseT = now; emit('avatar-pose', { look, mouth: isTauri ? null : rawMouth }); }

  // thumbnails: during the splash phase one per frame (window still hidden), afterwards at idle
  if (th.phase) {
    if (th.queue.length && now - th.phaseT0 < 6000) {
      renderOneThumb();
      loading(0.75 + 0.25 * (th.done / Math.max(1, th.total)), `gerando miniaturas ${th.done}/${th.total}`);
    } else {
      th.phase = false;
      loading(1.0, 'pronto!');
      invoke('page_ready', { label: 'avatar' }).catch(() => {});
      flushThumbKeys();
      preloadOutfits();
      idleThumbs();   // anything left after the 6 s cap continues after showing
    }
  } else if (th.wantOne) {
    th.wantOne = false;
    if (renderOneThumb()) { if (th.queue.length) idleThumbs(); else flushThumbKeys(); }
  }
  if (trans.ativa) trans.render(() => stage.render(dt, !!config.render?.ao));
  else stage.render(dt, !!config.render?.ao);
  if (pv.until) capturePreview(now);
  if (!firstFrame) {
    firstFrame = true;
    // first real frame is on the (hidden) window: generate missing thumbnails, then show it
    th.phase = !DBG; th.phaseT0 = now;
    queueMissing(allOutfits()).then((n) => { th.total = n; th.done = 0; th.phaseT0 = performance.now(); if (!n) th.queue.length = 0; })
      .catch(() => { th.queue.length = 0; });
  }
  frames++;
  if (now - fpsT > 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
}
const smoothExtra = { x: 0, y: 0 };
// streamer's mouth limits: settings.mouth = { maxOpen (0.65), curve (1.6) }
//   open' = maxOpen * open^curve ; round/wide/sib scaled by maxOpen ; closed unchanged
function shapeMouth(m) {
  // The limit only caps how far the MOUTH OPENS (lid hinge); the lip shapes (round/wide/corners/jaw)
  // stay at full strength so the lips still fold visibly while talking.
  const cfg = settings().mouth || {};
  const maxOpen = clamp(Number.isFinite(+cfg.maxOpen) ? +cfg.maxOpen : 0.65, 0, 1.5);
  const curve = clamp(Number.isFinite(+cfg.curve) && +cfg.curve > 0 ? +cfg.curve : 1.6, 0.2, 5);
  const shape = (v) => clamp(v || 0, -1, 1);
  return {
    open: maxOpen * Math.pow(clamp(m.open || 0, 0, 1), curve),
    round: shape(m.round), wide: shape(m.wide), sib: shape(m.sib), closed: m.closed || 0,
    // lip activity: how much the lips should fold even when the opening is capped
    // proportional to the RAW opening so visemes stay distinct (A ~1, E ~0.5, I ~0.3; rounding adds a bit)
    lips: clamp(Math.pow(clamp(m.open || 0, 0, 1), 0.9) + (m.round || 0) * 0.35, 0, 1),
    cornerL: shape(m.cornerL), cornerR: shape(m.cornerR), jawSide: shape(m.jawSide), jawFwd: shape(m.jawFwd), upperRaise: shape(m.upperRaise),
  };
}

// rAF normally; a worker ticker takes over when hidden/occluded (OBS captures it behind other
// windows and rAF pauses then). Never pauses on blur.
let errosQuadro = 0;
function frameSeguro(now) {
  try { frame(now); errosQuadro = 0; }
  catch (e) { if (errosQuadro++ < 3) logJS(`quadro: ${e?.stack || e}`); }   // um erro num quadro não para o loop
}
renderer.setAnimationLoop(() => { lastRaf = performance.now(); frameSeguro(lastRaf); });
const tickSrc = `let id=0;onmessage=(e)=>{clearInterval(id);id=setInterval(()=>postMessage(0),e.data)}`;
const ticker = new Worker(URL.createObjectURL(new Blob([tickSrc], { type: 'text/javascript' })));
function setTick() { ticker.postMessage(Math.max(4, Math.floor(1000 / clamp(config.render?.fps ?? 60, 10, 240)))); }
ticker.onmessage = () => {
  const now = performance.now();
  if (document.visibilityState !== 'visible' || now - lastRaf > 100) frameSeguro(now);
};

// resolução de render: no cenário 3D (tela cheia) nunca passa de 1920x1080 pixels reais — numa tela
// com escala 125/150% isso corta 35-55% do trabalho da placa sem diferença no OBS (que é 1080p)
function prAlvo() {
  const base = Math.min(devicePixelRatio, config.render?.pixelRatio ?? 1.5);
  if (!cenarioAtivo()) return base;
  return Math.max(0.5, Math.min(base, 1920 / Math.max(1, innerWidth), 1080 / Math.max(1, innerHeight)));
}
// Vidro/água com "transmission" fazem o three.js desenhar a cena INTEIRA de novo numa textura todo
// quadro (a água da bacia está sempre lá, a cadeira Skol também tinha). Troca por transparência comum:
// visual quase igual e ~metade do trabalho da placa. config.render.vidro = true mantém o vidro real.
const _semTx = new WeakSet();
function semTransmissao() {
  if (config.render?.vidro) return;
  scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null;
    if (!ms) return;
    for (const m of ms) {
      if (!m || _semTx.has(m) || !(m.transmission > 0)) continue;
      _semTx.add(m);
      const t = m.transmission;
      m.userData.transmissionOrig = t;
      m.transmission = 0;
      if (t >= 0.45) { const jaTransp = m.transparent && m.opacity < 1; m.transparent = true; m.opacity = jaTransp ? Math.min(0.85, m.opacity + 0.12) : 0.62; m.depthWrite = false; }
      m.needsUpdate = true;
    }
  });
}
var prAtual = 0, prPronto = false;   // var: applySettings() roda antes desta linha na carga
function conferirPR() { const p = prAlvo(); if (Math.abs(p - prAtual) > 1e-3) fitCanvas(); }
function fitCanvas() {
  prAtual = prAlvo();
  renderer.setPixelRatio(prAtual);
  renderer.setSize(innerWidth, innerHeight, false);       // CSS (100vw/100vh) owns the element size
  stage.composer?.setPixelRatio?.(prAtual);
  stage.composer?.setSize?.(innerWidth, innerHeight);
  layout();
}
addEventListener('resize', fitCanvas);
prPronto = true;
// som pelo processo do app (o OBS acha na "Captura de áudio de aplicativo"); no navegador, como antes
if (isTauri && !OUTPUT && config.settings?.somNativo !== false) sfx.usarSaidaNativa({ invoke, invokeRaw }).then((ok) => { if (!ok) sfx.aquecer?.(); });
else setTimeout(() => sfx.aquecer?.(), 2000);
(function watchDpr() {   // devicePixelRatio changes (moving between monitors with different scaling)
  const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
  mq.addEventListener('change', () => { fitCanvas(); watchDpr(); }, { once: true });
})();
// invisible edge/corner zones resize the borderless window (Rust: start_resize)
for (const z of document.querySelectorAll('.rz')) {
  z.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || mode === 'overlay' || OUTPUT) return;
    e.preventDefault();
    invoke('start_resize', { direction: z.dataset.dir }).catch(() => {});
  });
}

loading(0.7, 'montando a privada…');
checkSeat();   // first build (constructor path, not wear())
fitCanvas();
applySettings();
applyConfigOutfit();
applyScene(config.activeScene);
applyLookLimits();
window.avatar = { output: OUTPUT, act, trans: () => trans, cenario: () => cenarioAtivo() || cenario, cenarios: () => cenarios, config: () => config, applyScene, applyOutfit, computeLook, setCharacter, character: () => character };
