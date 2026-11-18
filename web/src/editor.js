// Guarda-roupa: free mix-and-match editor on top of any theme.
//  - add / remove / hide any registered accessory on any socket
//  - move / rotate / scale / recolor each one (live)
//  - recolor the main materials
//  - import your own .glb models as accessories
//  - save / load the result as a theme JSON (also kept in localStorage)
import { listAccessories } from './accessories/index.js';
import './accessories/glb.js';
import { ToiletTuber } from './rig/ToiletTuber.js';

const SOCKET_NAMES = {
  head_top: 'Topo da cabeça', lip_upper: 'Lábio superior (tampa)', eyes: 'Olhos', tank_front: 'Frente do tanque', face: 'Rosto (bigode)',
  lid_top: 'Tampa (boca)', body_front: 'Corpo (frente)', side_right: 'Lado direito', back: 'Costas',
  floor_left: 'Chão esquerdo', floor_right: 'Chão direito',
};
const MAT_KEYS = [
  ['porcelain', 'Porcelana'], ['seat', 'Assento'], ['lid', 'Tampa'], ['tankLid', 'Tampa do tanque'],
  ['chrome', 'Metal'], ['gold', 'Ouro'], ['mustache', 'Bigode'], ['eyeWhite', 'Olho'], ['pupil', 'Pupila'],
  ['paper', 'Papel'], ['water', 'Água'],
];
const LS_KEY = 'privada.customThemes';
const clone = (o) => JSON.parse(JSON.stringify(o));

const CSS = `
#wardrobe{position:fixed;top:12px;left:12px;width:290px;max-height:calc(100vh - 24px);overflow:auto;background:rgba(15,15,20,.82);
 backdrop-filter:blur(6px);border-radius:12px;padding:10px 12px;color:#eee;font:12px/1.35 system-ui,sans-serif;box-shadow:0 6px 30px rgba(0,0,0,.35)}
#wardrobe.min>*:not(h2){display:none}
#wardrobe h2{font-size:14px;margin:0 0 6px;cursor:pointer;user-select:none}
#wardrobe h3{font-size:12px;margin:10px 0 4px;color:#bbb;font-weight:600}
#wardrobe select,#wardrobe input[type=text]{width:100%;background:#22242c;color:#eee;border:1px solid #444;border-radius:6px;padding:3px}
#wardrobe .acc{display:flex;gap:4px;align-items:center;padding:3px 4px;border-radius:6px;cursor:pointer}
#wardrobe .acc:hover{background:#2a2c36}#wardrobe .acc.sel{background:#33405a}
#wardrobe .acc span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wardrobe .acc select{width:110px}
#wardrobe .mini{padding:2px 6px;font-size:11px}
#wardrobe .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px}
#wardrobe .grid label{display:flex;justify-content:space-between;align-items:center;gap:4px;color:#ccc}
#wardrobe input[type=color]{width:34px;height:20px;border:none;background:none;padding:0}
#wardrobe .sl{display:grid;grid-template-columns:52px 1fr 38px;gap:4px;align-items:center;color:#ccc}
#wardrobe .sl input{width:100%}
#wardrobe .row{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}
#wardrobe .muted{color:#888}
`;

export async function initEditor({ tuber, themes, applyBg }) {
  let INFO = {};
  try { INFO = (await import('./accessories/extra.js')).ACCESSORY_INFO || {}; } catch { /* pack not present */ }
  try { const m = await import('./accessories/index.js'); for (const id of m.MUSTACHE_IDS || []) INFO[id] ??= { name: id.replace('mustache_', 'Bigode '), socket: 'lip_upper', category: 'Bigodes' }; } catch { /* */ }
  const BASE_INFO = {
    crown: { name: 'Coroa', socket: 'head_top', category: 'Chapéus' },
    ushanka: { name: 'Ushanka', socket: 'head_top', category: 'Chapéus' },
    star_badge: { name: 'Estrela', socket: 'tank_front', category: 'Corpo' },
    bow_tie: { name: 'Gravata borboleta', socket: 'body_front', category: 'Corpo' },
    mustache_handlebar: { name: 'Bigode guidão', socket: 'lip_upper', category: 'Bigodes' },
    mustache_walrus: { name: 'Bigode morsa', socket: 'lip_upper', category: 'Bigodes' },
  };
  INFO = { ...BASE_INFO, ...INFO };
  const info = (id) => INFO[id] || { name: id, socket: id.startsWith('mustache') ? 'lip_upper' : 'head_top', category: id.startsWith('mustache') ? 'Bigodes' : 'Outros' };

  // custom themes from previous sessions
  const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  const themeSel = document.getElementById('theme');
  for (const [id, t] of Object.entries(saved)) {
    themes[id] = t;
    if (![...themeSel.options].some((o) => o.value === id)) themeSel.add(new Option('★ ' + t.name, id));
  }

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement('div');
  root.id = 'wardrobe';
  document.body.append(root);

  let work = clone(tuber.theme);
  let selected = null; // {slot, index}

  const sockets = () => Object.keys(tuber.sockets);
  const sockOpts = (cur) => sockets().map((s) => `<option value="${s}" ${s === cur ? 'selected' : ''}>${SOCKET_NAMES[s] || s}</option>`).join('');

  function commit(full = false) {
    tuber.theme = work;
    if (full) tuber.setTheme(work); else tuber.buildAccessories();
  }
  function entries() {
    const out = [];
    for (const [slot, list] of Object.entries(work.slots || {})) list.forEach((e, index) => out.push({ slot, index, e }));
    return out;
  }
  function wrapperOf(e) { return tuber.accessories.find((w) => w.userData.entry === e); }

  function render() {
    const cats = {};
    for (const id of listAccessories()) (cats[info(id).category] ||= []).push(id);
    const sel = selected && work.slots[selected.slot]?.[selected.index];
    const T = sel?.transform || {};
    const pos = T.position || [0, 0, 0], rot = T.rotation || [0, 0, 0];
    const sc = typeof T.scale === 'number' ? T.scale : 1;
    const slider = (key, label, v, min, max, step) =>
      `<div class="sl">${label}<input type="range" data-t="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><span>${(+v).toFixed(2)}</span></div>`;

    root.innerHTML = `
      <h2 id="w-toggle">👔 Guarda-roupa <span class="muted">(clique p/ minimizar)</span></h2>
      <input type="text" id="w-name" value="${work.name || ''}" placeholder="Nome do visual">
      <h3>Equipados</h3>
      <div id="w-list">${entries().map(({ slot, index, e }) => `
        <div class="acc ${selected && selected.slot === slot && selected.index === index ? 'sel' : ''}" data-slot="${slot}" data-i="${index}">
          <span title="${e.id}">${e.hidden ? '🚫 ' : ''}${e.params?.name || info(e.id).name}</span>
          <select data-move>${sockOpts(slot)}</select>
          <button class="mini" data-hide title="Mostrar/esconder">👁</button>
          <button class="mini" data-del title="Remover">✕</button>
        </div>`).join('') || '<div class="muted">Nada equipado</div>'}</div>
      <h3>Adicionar acessório</h3>
      <select id="w-add">${Object.entries(cats).sort().map(([c, ids]) => `<optgroup label="${c}">${ids.filter((i) => i !== 'glb').map((id) => `<option value="${id}">${info(id).name}</option>`).join('')}</optgroup>`).join('')}</select>
      <div class="row"><select id="w-add-sock" style="flex:1"><option value="">(posição padrão)</option>${sockOpts('')}</select><button id="w-add-btn">＋ Colocar</button></div>
      ${sel ? `
      <h3>Ajustar: ${sel.params?.name || info(sel.id).name}</h3>
      ${slider('px', 'Pos X', pos[0], -0.6, 0.6, 0.005)}${slider('py', 'Pos Y', pos[1], -0.6, 0.6, 0.005)}${slider('pz', 'Pos Z', pos[2], -0.6, 0.6, 0.005)}
      ${slider('rx', 'Rot X', rot[0], -3.14, 3.14, 0.01)}${slider('ry', 'Rot Y', rot[1], -3.14, 3.14, 0.01)}${slider('rz', 'Rot Z', rot[2], -3.14, 3.14, 0.01)}
      ${slider('s', 'Escala', sc, 0.1, 3, 0.01)}
      <div class="row"><label>Cor <input type="color" id="w-color" value="${sel.params?.color || '#888888'}"></label>
        <button class="mini" id="w-color-reset">cor original</button><button class="mini" id="w-tr-reset">zerar posição</button><button class="mini" id="w-dup">duplicar</button></div>` : '<div class="muted" style="margin-top:6px">Clique num acessório equipado para mover/girar/escalar.</div>'}
      <h3>Cores do corpo</h3>
      <div class="grid">${MAT_KEYS.map(([k, n]) => `<label>${n}<input type="color" data-mat="${k}" value="${toHex(work.materials?.[k]?.color)}"></label>`).join('')}</div>
      <h3>Modelo próprio (.glb / .gltf)</h3>
      <div class="row"><input type="file" id="w-glb" accept=".glb,.gltf" style="width:100%"></div>
      <div class="row"><select id="w-glb-sock" style="flex:1">${sockOpts('head_top')}</select></div>
      <h3>Visual</h3>
      <div class="row">
        <button id="w-save">💾 Salvar visual</button><button id="w-dl">⬇ .json</button>
        <label class="mini" style="border:1px solid #444;border-radius:7px;padding:4px 7px;cursor:pointer">📂 Carregar<input type="file" id="w-load" accept=".json" hidden></label>
        <button id="w-clear">Tirar tudo</button>
      </div>`;
    bind();
  }

  function bind() {
    const $ = (s) => root.querySelector(s);
    $('#w-toggle').onclick = () => root.classList.toggle('min');
    $('#w-name').onchange = (ev) => { work.name = ev.target.value; };
    root.querySelectorAll('.acc').forEach((row) => {
      const slot = row.dataset.slot, i = +row.dataset.i;
      row.onclick = (ev) => { if (ev.target.closest('select,button')) return; selected = { slot, index: i }; render(); };
      row.querySelector('[data-del]').onclick = () => { work.slots[slot].splice(i, 1); selected = null; commit(); render(); };
      row.querySelector('[data-hide]').onclick = () => { const e = work.slots[slot][i]; e.hidden = !e.hidden; commit(); render(); };
      row.querySelector('[data-move]').onchange = (ev) => {
        const [e] = work.slots[slot].splice(i, 1);
        e.transform = {};
        (work.slots[ev.target.value] ||= []).push(e);
        selected = { slot: ev.target.value, index: work.slots[ev.target.value].length - 1 };
        commit(); render();
      };
    });
    $('#w-add-btn').onclick = () => {
      const id = $('#w-add').value;
      const slot = $('#w-add-sock').value || info(id).socket || 'head_top';
      (work.slots[slot] ||= []).push({ id, params: {} });
      selected = { slot, index: work.slots[slot].length - 1 };
      commit(); render();
    };
    root.querySelectorAll('[data-t]').forEach((inp) => {
      inp.oninput = () => {
        const e = work.slots[selected.slot][selected.index];
        const t = (e.transform ||= {});
        t.position ||= [0, 0, 0]; t.rotation ||= [0, 0, 0];
        const v = +inp.value, k = inp.dataset.t;
        if (k[0] === 'p') t.position['xyz'.indexOf(k[1])] = v;
        else if (k[0] === 'r') t.rotation['xyz'.indexOf(k[1])] = v;
        else t.scale = v;
        inp.nextElementSibling.textContent = v.toFixed(2);
        const w = wrapperOf(e);
        if (w) ToiletTuber.applyTransform(w, t);
      };
    });
    if (selected) {
      const e = () => work.slots[selected.slot][selected.index];
      $('#w-color').onchange = (ev) => { (e().params ||= {}).color = ev.target.value; commit(); };
      $('#w-color-reset').onclick = () => { if (e().params) delete e().params.color; commit(); render(); };
      $('#w-tr-reset').onclick = () => { e().transform = {}; commit(); render(); };
      $('#w-dup').onclick = () => {
        const c = clone(e());
        work.slots[selected.slot].push(c);
        selected = { slot: selected.slot, index: work.slots[selected.slot].length - 1 };
        commit(); render();
      };
    }
    root.querySelectorAll('[data-mat]').forEach((inp) => {
      inp.onchange = () => {
        const k = inp.dataset.mat;
        work.materials[k] = { ...(work.materials[k] || work.materials.porcelain), color: inp.value };
        commit(true);
      };
    });
    $('#w-glb').onchange = async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const src = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      const slot = $('#w-glb-sock').value;
      (work.slots[slot] ||= []).push({ id: 'glb', params: { src, name: f.name.replace(/\.(glb|gltf)$/i, ''), fit: 0.35 } });
      selected = { slot, index: work.slots[slot].length - 1 };
      commit(); render();
    };
    $('#w-save').onclick = () => {
      work.name = work.name || 'Meu visual';
      const id = work.id && work.id.startsWith('custom_') ? work.id : `custom_${Date.now().toString(36)}`;
      work.id = id;
      const t = clone(work);
      themes[id] = t;
      const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      all[id] = t;
      try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch { alert('Visual salvo só nesta sessão (modelo .glb grande demais para o armazenamento local). Use ⬇ .json.'); }
      let opt = [...themeSel.options].find((o) => o.value === id);
      if (!opt) { opt = new Option('★ ' + t.name, id); themeSel.add(opt); }
      opt.text = '★ ' + t.name;
      themeSel.value = id;
    };
    $('#w-dl').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(work, null, 2)], { type: 'application/json' }));
      a.download = `${(work.name || 'visual').replace(/\W+/g, '_')}.json`;
      a.click();
    };
    $('#w-load').onchange = async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      try {
        const t = JSON.parse(await f.text());
        if (!t.materials || !t.slots) throw new Error('JSON não é um tema (faltam materials/slots)');
        work = t; selected = null; commit(true); applyBg?.(); render();
      } catch (err) { alert(err.message); }
    };
    $('#w-clear').onclick = () => { work.slots = {}; selected = null; commit(); render(); };
  }

  // follow the theme dropdown
  themeSel.addEventListener('change', () => setTimeout(() => { work = clone(tuber.theme); selected = null; render(); }, 0));
  render();
  return { get theme() { return work; }, render };
}

function toHex(c) {
  if (!c) return '#ffffff';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + [...c.slice(1)].map((x) => x + x).join('');
  return '#ffffff';
}
