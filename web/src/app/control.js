// Control panel (pt-BR): Visual (live preview + accessory browser with thumbnails),
// Presets, Cenas, Atalhos, Microfone, Animações. Talks to the app only via bridge.js.
// Every change -> config updated -> save_config (debounced) + emit('state', config).
// The emitted state carries `outfitTheme` (the fully resolved theme of the active outfit)
// so the avatar never has to resolve preset inheritance itself.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { invoke, listen, emit, isTauri } from './bridge.js';
import { DEFAULT_CONFIG, ACTIONS } from './defaults.js';
import { ToiletTuber } from '../rig/ToiletTuber.js';
import { createStage } from '../stage.js';
import { loadThemes, mergeTheme } from '../themes.js';
import { listAccessories, MUSTACHE_IDS } from '../accessories/index.js';
import { ACCESSORY_INFO } from '../accessories/extra.js';
import '../accessories/glb.js';
import { CHANNELS } from '../input/visemes.js';
import { accessoryThumb, outfitThumb, clearThumbs } from './thumbs.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SOCKETS = {
  head_top: 'Topo da cabeça', eyes: 'Olhos', tank_front: 'Frente do tanque', face: 'Rosto (bigode)',
  lid_top: 'Tampa (boca)', body_front: 'Corpo (frente)', neck: 'Pescoço (cano)', side_right: 'Lado direito',
  back: 'Costas', floor_left: 'Chão esquerdo', floor_right: 'Chão direito',
};
const CATS = ['Todos', 'Chapéus', 'Olhos', 'Rosto', 'Bigodes', 'Corpo', 'Objetos', 'Outros'];
const MAT_KEYS = [
  ['porcelain', 'Porcelana'], ['seat', 'Assento'], ['lid', 'Tampa'], ['tankLid', 'Tampa do tanque'],
  ['chrome', 'Metal'], ['gold', 'Ouro'], ['mustache', 'Bigode'], ['eyeWhite', 'Olho'],
  ['pupil', 'Pupila'], ['paper', 'Papel'], ['water', 'Água'],
];
const ANIMS = [
  ['flush', '💧 Descarga'], ['paper', '🧻 Papel'], ['jump', '⤴ Pulo'], ['backflip', '🤸 Mortal'],
  ['no', '↔ Não'], ['gargle', '🫧 Gargarejo'], ['blink', '😑 Piscar'],
];
const VISEMES = ['A', 'E', 'I', 'O', 'U', 'M', 'F', 'S'];

/* ------------------------------------------------------------------ state */
let cfg;
let themes = {};      // built-in themes (resolved)
let presets = {};     // built-in presets (resolved), id -> theme
let work;             // working (resolved) theme of the active outfit
let selected = null;  // { slot, index } of the equipped accessory being adjusted
let cat = 'Todos', search = '';
let sceneSel = 0;
let lastMouth = { open: 0, round: 0, wide: 0, closed: 0, sib: 0, level: 0 };
let avatarSeen = 0, avatarFps = 0;

const info = (id) => {
  const i = ACCESSORY_INFO[id];
  if (MUSTACHE_IDS.includes(id)) return { name: i?.name || id.replace('mustache_', 'Bigode ').replace(/_/g, ' '), socket: 'face', category: 'Bigodes' };
  return i || { name: id.replace(/_/g, ' '), socket: 'head_top', category: 'Outros' };
};

function rawOutfit(id) { return cfg.outfits?.[id] || presets[id] || themes[id] || null; }
function resolveOutfit(id, depth = 0) {
  const t = rawOutfit(id);
  if (!t) return clone(themes.base);
  if (t.extends && depth < 6) {
    const parent = rawOutfit(t.extends) ? resolveOutfit(t.extends, depth + 1) : themes.base;
    return mergeTheme(parent, t);
  }
  return clone(t);
}
const outfitName = (id) => rawOutfit(id)?.name || id;

/* ---------------------------------------------------------- save / emit */
let saveT = 0, emitT = 0, emitPending = false;
function commit({ rebuildPreview = 'acc' } = {}) {
  cfg.outfits ||= {};
  if (rebuildPreview === 'full') preview.tuber.setTheme(work);
  else if (rebuildPreview === 'acc') { preview.tuber.theme = work; preview.tuber.buildAccessories(); }
  clearTimeout(saveT);
  saveT = setTimeout(() => invoke('save_config', { config: cfg }).then(() => setSaved(true)).catch((e) => setSaved(false, e)), 350);
  setSaved(null);
  emitState();
}
function emitState() {
  const now = performance.now();
  if (now - emitT < 80) { // throttle slider storms
    if (!emitPending) { emitPending = true; setTimeout(() => { emitPending = false; emitState(); }, 90); }
    return;
  }
  emitT = now;
  emit('state', { ...cfg, outfitTheme: work });
}
let saveState = 'ok';
function setSaved(ok) { saveState = ok == null ? 'saving' : ok ? 'ok' : 'erro'; renderStatus(); }

/** Edits to a built-in outfit fork it into a custom one so presets stay pristine. */
function ensureCustom() {
  const id = cfg.activeOutfit;
  if (cfg.outfits[id]) { cfg.outfits[id] = work; return; }
  const nid = `custom_${Date.now().toString(36)}`;
  work = { ...work, id: nid, name: `${outfitName(id)} (editado)` };
  delete work.extends;
  cfg.outfits[nid] = work;
  cfg.activeOutfit = nid;
}

/* --------------------------------------------------------------- preview */
const preview = {};
function initPreview() {
  const box = $('#preview');
  const w = box.clientWidth || 400, h = box.clientHeight || 440;
  const stage = createStage({ width: w, height: h, pixelRatio: Math.min(devicePixelRatio, 2), parent: box });
  stage.floor.visible = true;
  stage.camera.position.set(0.5, 1.15, 3.9);
  const controls = new OrbitControls(stage.camera, stage.renderer.domElement);
  controls.target.set(0, 0.9, 0);
  controls.enableDamping = true;
  controls.minDistance = 1.2; controls.maxDistance = 8;
  controls.update();
  const tuber = new ToiletTuber(work);
  stage.scene.add(tuber.root);
  Object.assign(preview, { stage, controls, tuber });
  const mouse = { x: 0, y: 0 };
  box.addEventListener('pointermove', (e) => {
    const r = box.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  });
  new ResizeObserver(() => {
    const W = box.clientWidth, H = box.clientHeight;
    if (W > 10 && H > 10) stage.setSize(W, H);
  }).observe(box);
  const clock = new THREE.Clock();
  stage.renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if ($('#tab-visual').classList.contains('sel') === false && !preview.forceRender) return; // idle when hidden
    tuber.update(dt, { look: { x: mouse.x, y: mouse.y }, mouth: lastMouth });
    stage.updateContact(tuber);
    controls.update();
    stage.render(dt, false);
  });
}

/* ------------------------------------------------------------ Visual tab */
function renderCats() {
  $('#cats').innerHTML = CATS.map((c) => `<button data-cat="${c}" class="${c === cat ? 'sel' : ''}">${c}</button>`).join('');
  $$('#cats button').forEach((b) => (b.onclick = () => { cat = b.dataset.cat; renderCats(); renderGrid(); }));
  $('#sockSel').innerHTML = `<option value="">(lugar padrão)</option>` + Object.entries(SOCKETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
}

function wornIds() {
  const s = new Set();
  for (const list of Object.values(work.slots || {})) for (const e of list) s.add(e.id);
  return s;
}

function renderGrid() {
  const q = search.trim().toLowerCase();
  const worn = wornIds();
  const ids = listAccessories().filter((id) => id !== 'glb').filter((id) => {
    const i = info(id);
    if (cat !== 'Todos' && i.category !== cat) return false;
    return !q || i.name.toLowerCase().includes(q) || id.includes(q);
  }).sort((a, b) => info(a).name.localeCompare(info(b).name, 'pt'));
  $('#accGrid').innerHTML = ids.map((id) => `
    <div class="acc-card ${worn.has(id) ? 'worn' : ''}" data-id="${id}" title="${esc(info(id).name)} · ${SOCKETS[info(id).socket] || info(id).socket}">
      ${worn.has(id) ? '<div class="badge">✔</div>' : ''}
      <div class="img" data-thumb="${id}">⏳</div>
      <div class="nm">${esc(info(id).name)}</div>
    </div>`).join('') || '<div class="mut">Nada encontrado.</div>';
  $$('#accGrid .acc-card').forEach((c) => (c.onclick = () => equip(c.dataset.id)));
  for (const el of $$('#accGrid [data-thumb]')) {
    const id = el.dataset.thumb;
    accessoryThumb(id, themes.base).then((url) => {
      if (url && el.isConnected) { el.style.backgroundImage = `url(${url})`; el.textContent = ''; }
      else if (el.isConnected) el.textContent = '📦';
    });
  }
}

function equip(id) {
  ensureCustom();
  const slot = $('#sockSel').value || info(id).socket || 'head_top';
  // one mustache at a time on the face; replacing feels better than stacking
  if (MUSTACHE_IDS.includes(id) && slot === 'face') work.slots.face = (work.slots.face || []).filter((e) => !MUSTACHE_IDS.includes(e.id));
  (work.slots[slot] ||= []).push({ id, params: {} });
  selected = { slot, index: work.slots[slot].length - 1 };
  commit();
  renderVisual();
}

function entries() {
  const out = [];
  for (const [slot, list] of Object.entries(work.slots || {})) list.forEach((e, index) => out.push({ slot, index, e }));
  return out;
}

function renderWorn() {
  const list = entries();
  $('#wornCount').textContent = list.length ? `(${list.length})` : '';
  $('#worn').innerHTML = list.map(({ slot, index, e }) => `
    <div class="row ${selected && selected.slot === slot && selected.index === index ? 'sel' : ''}" data-slot="${slot}" data-i="${index}">
      <img data-wthumb="${e.id}" alt="" />
      <span class="nm" title="${esc(e.id)}">${e.hidden ? '🚫 ' : ''}${esc(e.params?.name || info(e.id).name)}</span>
      <select data-move>${Object.entries(SOCKETS).map(([k, v]) => `<option value="${k}" ${k === slot ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button class="mini" data-hide title="Mostrar/esconder">👁</button>
      <button class="mini" data-dup title="Duplicar">⧉</button>
      <button class="mini danger" data-del title="Remover">✕</button>
    </div>`).join('') || '<div class="mut">Nada equipado. Clique num card para vestir.</div>';
  for (const img of $$('#worn [data-wthumb]')) {
    const id = img.dataset.wthumb;
    if (id === 'glb') { img.replaceWith(Object.assign(document.createElement('span'), { textContent: '📦' })); continue; }
    accessoryThumb(id, themes.base).then((u) => { if (u && img.isConnected) img.src = u; });
  }
  $$('#worn .row').forEach((row) => {
    const slot = row.dataset.slot, i = +row.dataset.i;
    row.onclick = (ev) => { if (ev.target.closest('select,button')) return; selected = { slot, index: i }; renderWorn(); renderAdjust(); };
    $('[data-del]', row).onclick = () => { ensureCustom(); work.slots[slot].splice(i, 1); selected = null; commit(); renderVisual(); };
    $('[data-hide]', row).onclick = () => { ensureCustom(); const e = work.slots[slot][i]; e.hidden = !e.hidden; commit(); renderWorn(); };
    $('[data-dup]', row).onclick = () => { ensureCustom(); work.slots[slot].push(clone(work.slots[slot][i])); selected = { slot, index: work.slots[slot].length - 1 }; commit(); renderVisual(); };
    $('[data-move]', row).onchange = (ev) => {
      ensureCustom();
      const [e] = work.slots[slot].splice(i, 1);
      e.transform = {};
      (work.slots[ev.target.value] ||= []).push(e);
      selected = { slot: ev.target.value, index: work.slots[ev.target.value].length - 1 };
      commit(); renderVisual();
    };
  });
}

function renderAdjust() {
  const box = $('#adjust');
  const e = selected && work.slots[selected.slot]?.[selected.index];
  if (!e) { box.innerHTML = '<h2>Ajustar</h2><div class="mut">Selecione um acessório equipado para mover, girar, escalar e mudar a cor.</div>'; return; }
  const T = e.transform || {};
  const pos = T.position || [0, 0, 0], rot = T.rotation || [0, 0, 0];
  const sc = typeof T.scale === 'number' ? T.scale : 1;
  const sl = (k, label, v, min, max, step) =>
    `<div class="sl">${label}<input type="range" data-t="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><span>${(+v).toFixed(2)}</span></div>`;
  box.innerHTML = `
    <h2>Ajustar: ${esc(e.params?.name || info(e.id).name)}</h2>
    ${sl('px', 'Pos X', pos[0], -0.6, 0.6, 0.005)}${sl('py', 'Pos Y', pos[1], -0.6, 0.6, 0.005)}${sl('pz', 'Pos Z', pos[2], -0.6, 0.6, 0.005)}
    ${sl('rx', 'Girar X', rot[0], -3.14, 3.14, 0.01)}${sl('ry', 'Girar Y', rot[1], -3.14, 3.14, 0.01)}${sl('rz', 'Girar Z', rot[2], -3.14, 3.14, 0.01)}
    ${sl('s', 'Escala', sc, 0.1, 3, 0.01)}
    <div class="row-btns">
      <label>Cor <input type="color" id="accColor" value="${toHex(e.params?.color, '#888888')}"></label>
      <button class="mini" id="accColorReset">cor original</button>
      <button class="mini" id="accTrReset">zerar posição</button>
    </div>`;
  const live = () => preview.tuber.accessories.find((w) => w.userData.entry === e);
  $$('[data-t]', box).forEach((inp) => {
    inp.oninput = () => {
      ensureCustom();
      const cur = work.slots[selected.slot][selected.index];
      const t = (cur.transform ||= {});
      t.position ||= [0, 0, 0]; t.rotation ||= [0, 0, 0];
      const v = +inp.value, k = inp.dataset.t;
      if (k[0] === 'p') t.position['xyz'.indexOf(k[1])] = v;
      else if (k[0] === 'r') t.rotation['xyz'.indexOf(k[1])] = v;
      else t.scale = v;
      inp.nextElementSibling.textContent = v.toFixed(2);
      const w = live() || preview.tuber.accessories.find((x) => x.userData.entry === cur);
      if (w) ToiletTuber.applyTransform(w, t);
      commit({ rebuildPreview: w ? 'none' : 'acc' });
    };
  });
  $('#accColor', box).onchange = (ev) => { ensureCustom(); (work.slots[selected.slot][selected.index].params ||= {}).color = ev.target.value; commit(); };
  $('#accColorReset', box).onclick = () => { ensureCustom(); delete work.slots[selected.slot][selected.index].params?.color; commit(); renderAdjust(); };
  $('#accTrReset', box).onclick = () => { ensureCustom(); work.slots[selected.slot][selected.index].transform = {}; commit(); renderAdjust(); };
}

function renderMats() {
  $('#mats').innerHTML = MAT_KEYS.map(([k, n]) => `<label>${n}<input type="color" data-mat="${k}" value="${toHex(work.materials?.[k]?.color, '#ffffff')}"></label>`).join('');
  $$('#mats [data-mat]').forEach((inp) => (inp.onchange = () => {
    ensureCustom();
    const k = inp.dataset.mat;
    work.materials[k] = { ...(work.materials[k] || work.materials.porcelain), color: inp.value };
    commit({ rebuildPreview: 'full' });
  }));
}

function renderVisual() { renderGrid(); renderWorn(); renderAdjust(); renderMats(); }

function bindVisual() {
  $('#search').oninput = (e) => { search = e.target.value; renderGrid(); };
  $('#clearAll').onclick = () => { ensureCustom(); work.slots = {}; selected = null; commit(); renderVisual(); };
  $('#glbFile').onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const src = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    ensureCustom();
    const slot = $('#sockSel').value || 'head_top';
    (work.slots[slot] ||= []).push({ id: 'glb', params: { src, name: f.name.replace(/\.(glb|gltf)$/i, ''), fit: 0.35 } });
    selected = { slot, index: work.slots[slot].length - 1 };
    commit(); renderVisual();
    ev.target.value = '';
  };
}

/* ------------------------------------------------------------ Presets tab */
function applyOutfit(id) {
  cfg.activeOutfit = id;
  work = resolveOutfit(id);
  selected = null;
  commit({ rebuildPreview: 'full' });
  renderVisual(); renderPresets();
}

function presetCard(id, t, mine) {
  return `<div class="preset ${cfg.activeOutfit === id ? 'active' : ''}" data-id="${esc(id)}">
    <div class="img" data-othumb="${esc(id)}" title="Aplicar"></div>
    <div class="nm">${esc(t.name || id)}</div>
    <div class="tag">${mine ? 'meu preset' : (themes[id] ? 'tema' : 'preset')}${cfg.activeOutfit === id ? ' · em uso' : ''}</div>
    <div class="row-btns">
      <button class="mini primary" data-apply>Usar</button>
      ${mine ? '<button class="mini" data-rename>Renomear</button><button class="mini danger" data-del>Apagar</button>' : '<button class="mini" data-copy>Copiar p/ meus</button>'}
    </div></div>`;
}

function renderPresets() {
  const mine = Object.entries(cfg.outfits || {});
  const built = [...Object.entries(themes), ...Object.entries(presets)];
  $('#myPresets').innerHTML = mine.map(([id, t]) => presetCard(id, t, true)).join('') || '<div class="mut">Nenhum ainda. Monte um visual na aba Visual e salve aqui.</div>';
  $('#builtinPresets').innerHTML = built.map(([id, t]) => presetCard(id, t, false)).join('');
  for (const el of $$('[data-othumb]')) {
    const id = el.dataset.othumb;
    outfitThumb(resolveOutfit(id)).then((u) => { if (u && el.isConnected) el.style.backgroundImage = `url(${u})`; });
  }
  $$('.preset').forEach((card) => {
    const id = card.dataset.id;
    $('[data-apply]', card).onclick = () => applyOutfit(id);
    $('.img', card).onclick = () => applyOutfit(id);
    $('[data-rename]', card) && ($('[data-rename]', card).onclick = () => {
      const n = prompt('Novo nome do preset:', cfg.outfits[id].name || '');
      if (n) { cfg.outfits[id].name = n; if (cfg.activeOutfit === id) work.name = n; commit({ rebuildPreview: 'none' }); renderPresets(); }
    });
    $('[data-del]', card) && ($('[data-del]', card).onclick = () => {
      if (!confirm(`Apagar "${cfg.outfits[id].name}"?`)) return;
      delete cfg.outfits[id];
      if (cfg.activeOutfit === id) { cfg.activeOutfit = 'base'; work = resolveOutfit('base'); commit({ rebuildPreview: 'full' }); renderVisual(); }
      else commit({ rebuildPreview: 'none' });
      renderPresets();
    });
    $('[data-copy]', card) && ($('[data-copy]', card).onclick = () => {
      const nid = `custom_${Date.now().toString(36)}`;
      cfg.outfits[nid] = { ...resolveOutfit(id), id: nid, name: `${outfitName(id)} (cópia)` };
      delete cfg.outfits[nid].extends;
      commit({ rebuildPreview: 'none' }); renderPresets();
    });
  });
}

function bindPresets() {
  $('#savePreset').onclick = () => {
    const n = prompt('Nome do preset:', work.name && !themes[cfg.activeOutfit] ? work.name : 'Meu visual');
    if (!n) return;
    const nid = `custom_${Date.now().toString(36)}`;
    cfg.outfits[nid] = { ...clone(work), id: nid, name: n };
    delete cfg.outfits[nid].extends;
    cfg.activeOutfit = nid; work = cfg.outfits[nid];
    commit({ rebuildPreview: 'none' }); renderPresets();
  };
  $('#exportPreset').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(work, null, 2)], { type: 'application/json' }));
    a.download = `${(work.name || 'visual').replace(/\W+/g, '_')}.json`;
    a.click();
  };
  $('#importPreset').onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      const t = JSON.parse(await f.text());
      if (!t.slots && !t.materials) throw new Error('Esse JSON não é um visual (faltam slots/materials).');
      const nid = `custom_${Date.now().toString(36)}`;
      const base = t.extends && rawOutfit(t.extends) ? resolveOutfit(t.extends) : themes.base;
      cfg.outfits[nid] = { ...mergeTheme(base, t), id: nid, name: t.name || f.name.replace(/\.json$/i, '') };
      delete cfg.outfits[nid].extends;
      applyOutfit(nid);
    } catch (err) { alert(err.message); }
    ev.target.value = '';
  };
  $('#regenThumbs').onclick = () => { clearThumbs(); renderPresets(); renderGrid(); };
}

/* ------------------------------------------------------------- Scenes tab */
function sceneDefaults(s) {
  return { name: 'Nova cena', mode: 'overlay', outfit: null, x: 0.84, y: 0.8, scale: 1, background: 'transparent', bgColor: '#00ff00', follow: true, mic: true, clickThrough: 'auto', alwaysOnTop: false, ...s };
}
function renderScenes() {
  cfg.scenes = (cfg.scenes || []).map(sceneDefaults);
  if (!cfg.scenes.length) cfg.scenes.push(sceneDefaults({ name: 'Desktop' }));
  sceneSel = Math.min(sceneSel, cfg.scenes.length - 1);
  $('#sceneList').innerHTML = cfg.scenes.map((s, i) => `
    <div class="scene-item ${i === sceneSel ? 'sel' : ''}" data-i="${i}">
      <span>${i + 1}. ${esc(s.name)}</span>
      ${i === cfg.activeScene ? '<span class="live">● ao vivo</span>' : ''}
    </div>`).join('');
  $$('#sceneList .scene-item').forEach((el) => (el.onclick = () => { sceneSel = +el.dataset.i; renderScenes(); }));
  const s = cfg.scenes[sceneSel];
  const outfitOpts = [['', '(manter visual atual)'], ...Object.entries(cfg.outfits || {}).map(([id, t]) => [id, '★ ' + (t.name || id)]),
    ...Object.entries(themes).map(([id, t]) => [id, t.name || id]), ...Object.entries(presets).map(([id, t]) => [id, t.name || id])];
  $('#sceneForm').innerHTML = `
    <h2>${esc(s.name)} ${sceneSel === cfg.activeScene ? '<span class="live mut">(ativa)</span>' : ''}</h2>
    <div class="form">
      <label>Nome</label><input type="text" data-f="name" value="${esc(s.name)}" />
      <label>Modo</label><select data-f="mode">
        <option value="overlay" ${s.mode === 'overlay' ? 'selected' : ''}>Sobre a área de trabalho (transparente)</option>
        <option value="window" ${s.mode === 'window' ? 'selected' : ''}>Janela (para OBS)</option></select>
      <label>Visual da cena</label><select data-f="outfit">${outfitOpts.map(([v, n]) => `<option value="${esc(v)}" ${String(s.outfit || '') === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <label>Posição X</label><div class="sl" style="grid-template-columns:1fr 50px"><input type="range" data-f="x" min="0" max="1" step="0.005" value="${s.x}" /><span>${(+s.x).toFixed(2)}</span></div>
      <label>Posição Y</label><div class="sl" style="grid-template-columns:1fr 50px"><input type="range" data-f="y" min="0" max="1" step="0.005" value="${s.y}" /><span>${(+s.y).toFixed(2)}</span></div>
      <label>Tamanho</label><div class="sl" style="grid-template-columns:1fr 50px"><input type="range" data-f="scale" min="0.3" max="3" step="0.01" value="${s.scale}" /><span>${(+s.scale).toFixed(2)}</span></div>
      <label>Fundo</label><div><select data-f="background">
        <option value="transparent" ${s.background === 'transparent' ? 'selected' : ''}>Transparente</option>
        <option value="color" ${s.background === 'color' ? 'selected' : ''}>Cor sólida / chroma</option></select>
        <input type="color" data-f="bgColor" value="${toHex(s.bgColor, '#00ff00')}" /></div>
      <label>Seguir o mouse</label><input type="checkbox" data-f="follow" ${s.follow ? 'checked' : ''} />
      <label>Microfone mexe a boca</label><input type="checkbox" data-f="mic" ${s.mic ? 'checked' : ''} />
      <label>Sempre no topo</label><input type="checkbox" data-f="alwaysOnTop" ${s.alwaysOnTop ? 'checked' : ''} />
      <label>Clicar através</label><select data-f="clickThrough">
        <option value="auto" ${s.clickThrough === 'auto' ? 'selected' : ''}>Automático (só pega clique na privada)</option>
        <option value="on" ${s.clickThrough === 'on' ? 'selected' : ''}>Sempre (não dá pra arrastar)</option>
        <option value="off" ${s.clickThrough === 'off' ? 'selected' : ''}>Nunca</option></select>
      <div class="full mut">💡 Para OBS: use "Captura de janela" na janela <b>Privada Tuber</b> (funciona mesmo atrás de outras janelas). Com fundo transparente, ative "Permitir transparência" se disponível, ou use fundo de cor + filtro Chroma Key.</div>
      <div class="full row-btns"><button class="primary" id="sceneActivate">▶ Ativar esta cena</button></div>
    </div>`;
  $$('#sceneForm [data-f]').forEach((inp) => {
    const k = inp.dataset.f;
    const ev = inp.type === 'range' ? 'oninput' : 'onchange';
    inp[ev] = () => {
      let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? +inp.value : inp.value;
      if (k === 'outfit') v = v || null;
      cfg.scenes[sceneSel][k] = v;
      if (inp.type === 'range') inp.nextElementSibling.textContent = (+v).toFixed(2);
      commit({ rebuildPreview: 'none' });
      if (k === 'name') renderScenes();
    };
  });
  $('#sceneActivate').onclick = () => activateScene(sceneSel);
}
function activateScene(i) {
  cfg.activeScene = i;
  const s = cfg.scenes[i];
  if (s?.outfit && rawOutfit(s.outfit)) { cfg.activeOutfit = s.outfit; work = resolveOutfit(s.outfit); preview.tuber.setTheme(work); renderVisual(); renderPresets(); }
  commit({ rebuildPreview: 'none' });
  emit('command', { action: 'scene', arg: String(i) });
  renderScenes();
}
function bindScenes() {
  $('#sceneAdd').onclick = () => { cfg.scenes.push(sceneDefaults({ name: `Cena ${cfg.scenes.length + 1}` })); sceneSel = cfg.scenes.length - 1; commit({ rebuildPreview: 'none' }); renderScenes(); };
  $('#sceneDup').onclick = () => { cfg.scenes.splice(sceneSel + 1, 0, { ...clone(cfg.scenes[sceneSel]), name: cfg.scenes[sceneSel].name + ' (cópia)' }); sceneSel++; commit({ rebuildPreview: 'none' }); renderScenes(); };
  $('#sceneDel').onclick = () => {
    if (cfg.scenes.length < 2) return alert('Precisa ter pelo menos uma cena.');
    if (!confirm(`Remover a cena "${cfg.scenes[sceneSel].name}"?`)) return;
    cfg.scenes.splice(sceneSel, 1);
    if (cfg.activeScene >= cfg.scenes.length) cfg.activeScene = cfg.scenes.length - 1;
    sceneSel = Math.max(0, sceneSel - 1);
    commit({ rebuildPreview: 'none' }); renderScenes();
  };
  const move = (d) => {
    const j = sceneSel + d;
    if (j < 0 || j >= cfg.scenes.length) return;
    [cfg.scenes[sceneSel], cfg.scenes[j]] = [cfg.scenes[j], cfg.scenes[sceneSel]];
    if (cfg.activeScene === sceneSel) cfg.activeScene = j; else if (cfg.activeScene === j) cfg.activeScene = sceneSel;
    sceneSel = j; commit({ rebuildPreview: 'none' }); renderScenes();
  };
  $('#sceneUp').onclick = () => move(-1);
  $('#sceneDown').onclick = () => move(1);
}

/* ------------------------------------------------------------- OBS output */
const OUTPUT_DEFAULTS = { background: 'green', color: '#00ff00', width: 1280, height: 720, scale: 1.3, x: 0.5, y: 0.82, follow: true, overlayVisible: true, open: false };
const SIZES = [[1280, 720, '1280×720 (HD)'], [1920, 1080, '1920×1080 (Full HD)'], [1080, 1920, '1080×1920 (vertical)']];
function renderOutput() {
  const o = (cfg.output = { ...OUTPUT_DEFAULTS, ...(cfg.output || {}) });
  const sizeKey = `${o.width}x${o.height}`;
  const sl = (k, label, v, min, max, step, tip) => `<label title="${tip}">${label}</label><div class="sl" style="grid-template-columns:1fr 50px"><input type="range" data-o="${k}" min="${min}" max="${max}" step="${step}" value="${v}" /><span>${(+v).toFixed(2)}</span></div>`;
  $('#obsBox').innerHTML = `
    <h2>Saída para OBS</h2>
    <p class="mut" style="margin-top:0">Uma janela separada, só com a privada, feita para capturar no OBS. Ela pode ficar atrás de outras janelas.</p>
    <div class="row-btns" style="margin-bottom:12px">
      <button class="primary" id="obsOpen" title="Abre a janela de saída">${o.open ? '✔ Janela OBS aberta' : '▶ Abrir janela OBS'}</button>
      <button id="obsClose" title="Fecha a janela de saída">■ Fechar janela OBS</button>
    </div>
    <div class="form">
      <label title="O que aparece atrás da privada na janela do OBS">Fundo</label>
      <div><select data-o="background">
        <option value="green" ${o.background === 'green' ? 'selected' : ''}>Chroma verde (#00FF00)</option>
        <option value="color" ${o.background === 'color' ? 'selected' : ''}>Cor sólida</option>
        <option value="transparent" ${o.background === 'transparent' ? 'selected' : ''}>Transparente real</option>
      </select> <input type="color" data-o="color" value="${toHex(o.color, '#00ff00')}" title="Cor do fundo (modo Cor sólida)" ${o.background === 'color' ? '' : 'disabled'} /></div>
      <label title="Resolução da janela de saída">Tamanho</label>
      <select data-o="size">${SIZES.map(([w, h, n]) => `<option value="${w}x${h}" ${sizeKey === `${w}x${h}` ? 'selected' : ''}>${n}</option>`).join('')}${SIZES.some(([w, h]) => sizeKey === `${w}x${h}`) ? '' : `<option selected value="${sizeKey}">${o.width}×${o.height}</option>`}</select>
      ${sl('scale', 'Tamanho da privada', o.scale, 0.3, 3, 0.01, 'Escala do personagem dentro da janela')}
      ${sl('x', 'Posição X', o.x, 0, 1, 0.005, 'Posição horizontal (0 = esquerda, 1 = direita)')}
      ${sl('y', 'Posição Y', o.y, 0, 1, 0.005, 'Posição vertical do pé da privada (0 = topo, 1 = base)')}
      <label title="Os olhos e a cabeça seguem o mouse do computador">Seguir o mouse</label><input type="checkbox" data-o="follow" ${o.follow ? 'checked' : ''} />
      <label title="Esconde/mostra a privada flutuando na área de trabalho (a janela OBS continua)">Mostrar personagem no desktop</label><input type="checkbox" data-o="overlayVisible" ${o.overlayVisible ? 'checked' : ''} />
    </div>
    <h3>Como colocar no OBS</h3>
    <ol class="mut" style="margin:0;padding-left:18px;line-height:1.7">
      <li>Clique em <b>Abrir janela OBS</b>.</li>
      <li>No OBS: <b>Fontes → + → Captura de janela</b> e escolha <b>Privada Tuber — Saída</b>. Método de captura: <b>Windows 10 (1903+)</b>.</li>
      <li><b>Chroma verde</b>: botão direito na fonte → <b>Filtros → + Chroma Key</b> (verde).</li>
      <li><b>Transparente real</b>: use "Captura de jogo" com <b>Permitir transparência</b>; se aparecer preto, use o chroma verde.</li>
    </ol>`;
  $('#obsOpen').onclick = async () => {
    try { await invoke('open_output', { output: cfg.output }); cfg.output.open = true; commit({ rebuildPreview: 'none' }); renderOutput(); }
    catch (e) { alert('Não consegui abrir a janela OBS: ' + e); }
  };
  $('#obsClose').onclick = async () => { await invoke('close_output').catch(() => {}); cfg.output.open = false; commit({ rebuildPreview: 'none' }); renderOutput(); };
  $$('#obsBox [data-o]').forEach((inp) => {
    const k = inp.dataset.o;
    inp[inp.type === 'range' ? 'oninput' : 'onchange'] = () => {
      const out = cfg.output;
      if (k === 'size') { const [w, h] = inp.value.split('x').map(Number); out.width = w; out.height = h; }
      else out[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? +inp.value : inp.value;
      if (inp.type === 'range') inp.nextElementSibling.textContent = (+inp.value).toFixed(2);
      if (k === 'overlayVisible') invoke('set_overlay_visible', { visible: out.overlayVisible }).catch(() => {});
      commit({ rebuildPreview: 'none' });
      if (k === 'background') renderOutput();
    };
  });
}

/* ------------------------------------------------------------ Hotkeys tab */
let hkRows = [];          // [{accel, value:"play:flush"}]
let hkFailed = new Set();
let recording = -1;
function hkActionOptions() {
  const opts = ACTIONS.map((a) => [a.id, a.name]);
  for (const [id, t] of [...Object.entries(cfg.outfits || {}), ...Object.entries(themes), ...Object.entries(presets)]) opts.push([`outfit:${id}`, `Visual: ${t.name || id}`]);
  cfg.scenes.forEach((s, i) => opts.push([`scene:${i}`, `Cena ${i + 1}: ${s.name}`]));
  for (const v of VISEMES) opts.push([`viseme:${v}`, `Boca: ${v}`]);
  return opts;
}
function hkFromCfg() { hkRows = Object.entries(cfg.hotkeys || {}).map(([accel, b]) => ({ accel, value: `${b.action}:${b.arg ?? ''}` })); }
function hkToCfg() {
  const out = {};
  for (const r of hkRows) {
    if (!r.accel || out[r.accel]) continue; // duplicates: first wins (shown in red)
    const i = r.value.indexOf(':');
    out[r.accel] = { action: r.value.slice(0, i), arg: r.value.slice(i + 1) };
  }
  cfg.hotkeys = out;
}
async function hkApply() {
  hkToCfg();
  commit({ rebuildPreview: 'none' });
  try {
    const res = await invoke('set_hotkeys', { bindings: cfg.hotkeys });
    hkFailed = new Set(res?.failed || []);
    $('#hkMsg').textContent = hkFailed.size ? `⚠ Não consegui registrar: ${[...hkFailed].join(', ')} (já usado por outro programa?)` : `✔ ${res?.ok?.length ?? Object.keys(cfg.hotkeys).length} atalhos ativos.`;
  } catch (e) { $('#hkMsg').textContent = '⚠ ' + e; }
  renderHotkeys();
}
function renderHotkeys() {
  const counts = {};
  for (const r of hkRows) if (r.accel) counts[r.accel] = (counts[r.accel] || 0) + 1;
  const opts = hkActionOptions();
  $('#hkBody').innerHTML = hkRows.map((r, i) => `
    <tr data-i="${i}">
      <td><span class="keycap ${recording === i ? 'rec' : ''} ${counts[r.accel] > 1 ? 'dup' : ''} ${hkFailed.has(r.accel) ? 'failed' : ''}" data-rec title="${counts[r.accel] > 1 ? 'Atalho repetido!' : hkFailed.has(r.accel) ? 'Falhou ao registrar' : 'Clique para gravar'}">${recording === i ? 'aperte as teclas…' : esc(r.accel || '(vazio)')}</span></td>
      <td><select data-act>${opts.map(([v, n]) => `<option value="${esc(v)}" ${v === r.value ? 'selected' : ''}>${esc(n)}</option>`).join('')}${opts.some(([v]) => v === r.value) ? '' : `<option selected value="${esc(r.value)}">${esc(r.value)}</option>`}</select></td>
      <td><button class="mini" data-test>▶ Testar</button> <button class="mini danger" data-del>✕</button></td>
    </tr>`).join('');
  $$('#hkBody tr').forEach((tr) => {
    const i = +tr.dataset.i;
    $('[data-rec]', tr).onclick = () => { recording = i; renderHotkeys(); };
    $('[data-act]', tr).onchange = (e) => { hkRows[i].value = e.target.value; hkApply(); };
    $('[data-del]', tr).onclick = () => { hkRows.splice(i, 1); hkApply(); };
    $('[data-test]', tr).onclick = () => runAction(hkRows[i].value);
  });
}
function accelFromEvent(e) {
  const c = e.code;
  if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(c)) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl'); if (e.altKey) mods.push('Alt'); if (e.shiftKey) mods.push('Shift'); if (e.metaKey) mods.push('Super');
  let k = c;
  if (c.startsWith('Key')) k = c.slice(3);
  else if (c.startsWith('Digit')) k = c.slice(5);
  else if (c.startsWith('Arrow')) k = c.slice(5);
  return [...mods, k].join('+');
}
function bindHotkeys() {
  addEventListener('keydown', (e) => {
    if (recording < 0) return;
    e.preventDefault(); e.stopPropagation();
    if (e.code === 'Escape') { recording = -1; renderHotkeys(); return; }
    const a = accelFromEvent(e);
    if (!a) return;
    const other = hkRows.findIndex((r, j) => j !== recording && r.accel === a);
    if (other >= 0 && !confirm(`${a} já está em uso. Trocar para esta ação?`)) { recording = -1; renderHotkeys(); return; }
    if (other >= 0) hkRows.splice(other, 1);
    const idx = other >= 0 && other < recording ? recording - 1 : recording;
    hkRows[idx].accel = a;
    recording = -1;
    hkApply();
  }, true);
  $('#hkAdd').onclick = () => { hkRows.push({ accel: '', value: 'play:flush' }); recording = hkRows.length - 1; renderHotkeys(); };
  $('#hkReset').onclick = () => { if (confirm('Voltar todos os atalhos para o padrão?')) { cfg.hotkeys = clone(DEFAULT_CONFIG.hotkeys); hkFromCfg(); hkApply(); } };
}

/* ---------------------------------------------------------------- Mic tab */
let browserMic = null;
function renderMic() {
  const a = (cfg.audio ||= clone(DEFAULT_CONFIG.audio));
  $('#micOn').textContent = a.enabled ? 'Ligado' : 'Desligado';
  $('#micOn').classList.toggle('on', !!a.enabled);
  for (const [k, id, f] of [['gateDb', 'gate', (v) => `${v} dB`], ['rangeDb', 'range', (v) => `${v} dB`], ['hold', 'hold', (v) => `${(+v).toFixed(2)} s`]]) {
    $('#' + id).value = a[k]; $('#' + id + 'V').textContent = f(a[k]);
  }
  $('#meters').innerHTML = ['level', ...CHANNELS].map((k) => `<span>${{ level: 'Volume', open: 'Abrir', round: 'Redondo', wide: 'Largo', closed: 'Fechado', sib: 'Chiado' }[k]}</span><div class="meter"><div data-m="${k}"></div></div><span class="mut" data-mv="${k}">0</span>`).join('');
  $('#visBtns').innerHTML = VISEMES.map((v) => `<button data-v="${v}">${v}</button>`).join('');
  $$('#visBtns [data-v]').forEach((b) => (b.onclick = () => runAction(`viseme:${b.dataset.v}`)));
}
async function bindMic() {
  const a = (cfg.audio ||= clone(DEFAULT_CONFIG.audio));
  const push = () => { commit({ rebuildPreview: 'none' }); invoke('set_audio', { audio: cfg.audio }).catch(() => {}); };
  $('#micOn').onclick = () => { a.enabled = !a.enabled; renderMic(); bindMic(); push(); };
  for (const [k, id] of [['gateDb', 'gate'], ['rangeDb', 'range'], ['hold', 'hold']]) {
    $('#' + id).oninput = (e) => {
      a[k] = +e.target.value;
      $('#' + id + 'V').textContent = k === 'hold' ? `${a[k].toFixed(2)} s` : `${a[k]} dB`;
      if (browserMic) { browserMic.gateDb = a.gateDb; browserMic.rangeDb = a.rangeDb; browserMic.hold = a.hold; }
      push();
    };
  }
  try {
    const devs = await invoke('audio_devices');
    $('#micDev').innerHTML = `<option value="">(padrão do sistema)</option>` + (devs || []).map((d) => `<option ${d === a.device ? 'selected' : ''}>${esc(d)}</option>`).join('');
  } catch { $('#micDev').innerHTML = '<option>(indisponível)</option>'; }
  $('#micDev').onchange = (e) => { a.device = e.target.value || null; push(); };
  // browser fallback: run the WebAudio analyzer here and broadcast `mouth` to the avatar tab
  if (!isTauri) {
    $('#browserMic').hidden = false;
    $('#browserMic').onclick = async () => {
      if (browserMic) { browserMic.stop(); browserMic = null; $('#browserMic').classList.remove('on'); return; }
      const { Mic } = await import('../input/mic.js');
      browserMic = new Mic();
      Object.assign(browserMic, { gateDb: a.gateDb, rangeDb: a.rangeDb, hold: a.hold });
      try { await browserMic.start(); } catch (err) { alert('Microfone indisponível: ' + err.message); browserMic = null; return; }
      $('#browserMic').classList.add('on');
      let last = performance.now();
      const tick = () => {
        if (!browserMic) return;
        const now = performance.now();
        const m = browserMic.update((now - last) / 1000); last = now;
        emit('mouth', a.enabled ? { ...m, level: browserMic.level } : { open: 0, round: 0, wide: 0, closed: 0, sib: 0, level: browserMic.level });
        setTimeout(tick, 16);
      };
      tick();
    };
  }
}
function updateMeters() {
  for (const el of $$('[data-m]')) {
    const v = Math.max(0, Math.min(1, lastMouth[el.dataset.m] || 0));
    el.style.width = `${v * 100}%`;
    const t = el.parentElement.nextElementSibling;
    if (t) t.textContent = v.toFixed(2);
  }
}

/* ---------------------------------------------------------- Animations tab */
function runAction(value) {
  const i = value.indexOf(':');
  const action = i < 0 ? value : value.slice(0, i), arg = i < 0 ? '' : value.slice(i + 1);
  if (action === 'outfit') { if (rawOutfit(arg)) applyOutfit(arg); return; }
  if (action === 'scene') { const n = +arg; if (cfg.scenes[n]) activateScene(n); return; }
  if (action === 'open') return;
  if (action === 'play') preview.tuber?.play(arg);
  emit('command', { action, arg });
}
function renderAnims() {
  $('#animGrid').innerHTML = [
    ...ANIMS.map(([id, n]) => `<button data-run="play:${id}">${n}</button>`),
    '<button data-run="toggle:clickthrough">🖱 Clicar através</button>',
    '<button data-run="toggle:follow">👀 Seguir mouse</button>',
    '<button data-run="toggle:mic">🎤 Microfone</button>',
    '<button data-run="reset:position">🏠 Voltar pro lugar</button>',
  ].join('');
  $$('#animGrid [data-run]').forEach((b) => (b.onclick = () => runAction(b.dataset.run)));
}

/* ----------------------------------------------------------------- status */
function renderStatus() {
  const alive = performance.now() - avatarSeen < 2000;
  $('#status').innerHTML = `<span class="dot ${alive ? 'ok' : ''}"></span>${isTauri ? 'App' : 'Navegador'} · avatar ${alive ? `${avatarFps.toFixed(0)} fps` : 'offline'} · ${{ ok: 'salvo', saving: 'salvando…', erro: '⚠ erro ao salvar' }[saveState]}`;
}

/* ------------------------------------------------------------------ boot */
function bindTabs() {
  $$('#tabs button').forEach((b) => (b.onclick = () => {
    $$('#tabs button').forEach((x) => x.classList.toggle('sel', x === b));
    $$('section.tab').forEach((s) => s.classList.toggle('sel', s.id === `tab-${b.dataset.tab}`));
    if (b.dataset.tab === 'hotkeys') renderHotkeys();
    if (b.dataset.tab === 'presets') renderPresets();
  }));
}

async function loadPresets() {
  try {
    const r = await fetch('./presets/index.json');
    if (!r.ok) return {};
    const ids = await r.json();
    const out = {};
    await Promise.all(ids.map(async (id) => {
      try {
        const t = await (await fetch(`./presets/${id}.json`)).json();
        out[t.id || id] = t;
      } catch (e) { console.warn('[preset]', id, e); }
    }));
    return out;
  } catch { return {}; }
}

async function boot() {
  themes = await loadThemes('./themes/');
  presets = await loadPresets();
  const loaded = await invoke('load_config').catch(() => null);
  cfg = { ...clone(DEFAULT_CONFIG), ...(loaded || {}) };
  cfg.outfits ||= {};
  cfg.audio = { ...DEFAULT_CONFIG.audio, ...(cfg.audio || {}) };
  cfg.scenes = (cfg.scenes?.length ? cfg.scenes : clone(DEFAULT_CONFIG.scenes)).map(sceneDefaults);
  if (!rawOutfit(cfg.activeOutfit)) cfg.activeOutfit = 'base';
  work = resolveOutfit(cfg.activeOutfit);
  sceneSel = cfg.activeScene || 0;

  bindTabs();
  initPreview();
  renderCats(); bindVisual(); renderVisual();
  bindPresets(); renderPresets();
  bindScenes(); renderScenes();
  renderOutput();
  hkFromCfg(); bindHotkeys(); renderHotkeys();
  renderMic(); bindMic();
  renderAnims();

  listen('mouth', (m) => { lastMouth = m; });
  listen('avatar-status', (s) => { avatarSeen = performance.now(); avatarFps = s?.fps || 0; });
  listen('hotkey', (h) => {
    if (!h) return;
    if (h.action === 'outfit' && rawOutfit(h.arg)) { cfg.activeOutfit = h.arg; work = resolveOutfit(h.arg); preview.tuber.setTheme(work); renderVisual(); renderPresets(); }
    if (h.action === 'scene' && cfg.scenes[+h.arg]) { cfg.activeScene = +h.arg; renderScenes(); }
    if (h.action === 'play') preview.tuber?.play(h.arg);
  });
  setInterval(() => { updateMeters(); renderStatus(); }, 100);

  invoke('set_hotkeys', { bindings: cfg.hotkeys }).then((res) => { hkFailed = new Set(res?.failed || []); renderHotkeys(); }).catch(() => {});
  invoke('set_audio', { audio: cfg.audio }).catch(() => {});
  emitState();
  renderStatus();
}

function toHex(c, d) {
  if (!c) return d;
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + [...c.slice(1)].map((x) => x + x).join('');
  return d;
}

boot().catch((e) => { console.error(e); $('#status').textContent = '⚠ ' + e.message; });
