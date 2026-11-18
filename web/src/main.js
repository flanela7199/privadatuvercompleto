// Web preview: scene, lighting, input (mouse + mic) and the control panel.
// Look target: a real glazed-china toilet photographed indoors (not a toy):
// soft natural light, broad soft reflections, ambient occlusion for grounding.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ToiletTuber } from './rig/ToiletTuber.js';
import { createStage } from './stage.js';
import { loadThemes } from './themes.js';
import { Mic } from './input/mic.js';
import { FakeTalk, maxMouth } from './input/visemes.js';
import './accessories/extra.js';
import './accessories/glb.js';
import { sfx } from './audio/sfx.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- stage */
const stage = createStage();
const { renderer, scene, camera, composer, floor, contact } = stage;
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.88, 0);
controls.enableDamping = true;
controls.enabled = false;
controls.update();

/* ------------------------------------------------------------ character */
const themes = await loadThemes();
const themeId = params.get('theme') in themes ? params.get('theme') : 'base';
const tuber = new ToiletTuber(themes[themeId]);
scene.add(tuber.root);
window.tuber = tuber; // handy in devtools: tuber.play('flush')

tuber.on((type, data) => {
  if (type !== 'sfx' || !$('sound').checked) return;
  typeof data === 'string' ? sfx.play(data) : sfx.play(data.type, data);
});

const sel = $('theme');
for (const [id, t] of Object.entries(themes)) sel.add(new Option(t.name, id, false, id === themeId));
sel.onchange = () => { tuber.setTheme(themes[sel.value]); applyBg(); };

function applyBg() {
  const v = $('bg').value;
  document.body.style.background = v === 'green' ? '#00ff00' : v === 'transparent' ? 'transparent' : tuber.theme.background?.css || '#777';
  floor.visible = v !== 'green';
  contact.visible = v !== 'green';
}
$('bg').onchange = applyBg;
applyBg();
window.applyBg = applyBg;
window.themes = themes;

// Wardrobe / accessory editor (src/editor.js)
// (never let an editor problem stop the character itself)
import('./editor.js')
  .then(({ initEditor }) => initEditor({ tuber, themes, applyBg, scene, camera, renderer }))
  .then((ed) => { window.editor = ed; })
  .catch((err) => console.error('[editor] failed to load:', err));

/* ---------------------------------------------------------------- input */
const mouse = new THREE.Vector2(0, 0);
addEventListener('pointermove', (e) => mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
const mic = new Mic();
$('mic').onclick = async () => {
  if (mic.on) { mic.stop(); $('mic').classList.remove('on'); return; }
  try { await mic.start(); $('mic').classList.add('on'); } catch (err) { alert('Microfone indisponível: ' + err.message); }
};
$('gate').oninput = (e) => { mic.gateDb = +e.target.value; $('gateV').textContent = e.target.value; };
$('orbit').onchange = (e) => { controls.enabled = e.target.checked; };
document.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => tuber.play(b.dataset.act)));

// "High quality (AO)" toggle, injected next to the other checkboxes.
const aoRow = document.createElement('div');
aoRow.className = 'chk';
aoRow.innerHTML = '<input type="checkbox" id="ao" checked /> Qualidade alta (AO)';
($('orbit')?.parentElement ?? $('ui')).after(aoRow);
if (params.get('ao') === '0') $('ao').checked = false;

let spaceMouth = 0;
const fake = new FakeTalk();
window.fake = fake;
document.querySelectorAll('[data-vis]').forEach((b) => (b.onclick = () => fake.hold(b.dataset.vis)));
$('say').onclick = () => fake.say($('sayText').value || 'Olá Flanela! Eu sou a privada!');
$('sayText').onkeydown = (e) => { if (e.key === 'Enter') { fake.say(e.target.value); e.stopPropagation(); } };
$('rest').oninput = (e) => { tuber.restOpen = +e.target.value; };
const KEYS = { f: 'flush', p: 'paper', j: 'jump', n: 'no', b: 'blink', g: 'gargle', k: 'backflip' };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') return;
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (KEYS[k]) tuber.play(KEYS[k]);
  if (k === 'h') $('ui').classList.toggle('hidden');
  if (e.code === 'Space') { spaceMouth = 1; e.preventDefault(); }
});
addEventListener('keyup', (e) => { if (e.code === 'Space') spaceMouth = 0; });

$('export').onclick = () => {
  tuber.fx.visible = false;
  new GLTFExporter().parse(tuber.root, (glb) => {
    tuber.fx.visible = true;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    a.download = `privada_${tuber.theme.id}.glb`;
    a.click();
  }, (err) => { tuber.fx.visible = true; console.error(err); }, { binary: true });
};

addEventListener('resize', () => {
  stage.setSize(innerWidth, innerHeight);
});

// ?play=flush -> trigger an action at startup (used for screenshots)
if (params.get('play')) setTimeout(() => tuber.play(params.get('play')), 300);
if (params.get('ui') === '0') $('ui').classList.add('hidden');
if (params.get('mouth')) $('mouth').value = params.get('mouth');

/* ----------------------------------------------------------------- loop */
const clock = new THREE.Clock();
const headNdc = new THREE.Vector3();
const fixedLook = params.get('look') ? params.get('look').split(',').map(Number) : null;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const micMouth = mic.update(dt);
  $('meter').firstElementChild.style.width = `${mic.level * 100}%`;

  // look direction = mouse relative to the head on screen
  tuber.head.getWorldPosition(headNdc).project(camera);
  let look = { x: 0, y: 0 };
  if (fixedLook) look = { x: fixedLook[0], y: fixedLook[1] };
  else if ($('follow').checked) look = { x: (mouse.x - headNdc.x) * 1.3, y: (mouse.y - headNdc.y) * 1.3 };

  const mouth = maxMouth(mic.on ? micMouth : null, fake.update(dt), { open: Math.max(+$('mouth').value, spaceMouth) });
  tuber.update(dt, { look, mouth });

  stage.updateContact(tuber);

  controls.update();
  // AO only over the theme background; chroma/transparent capture uses the direct path (clean alpha).
  const useAO = $('ao').checked && $('bg').value === 'theme';
  if (useAO) composer.render(dt);
  else renderer.render(scene, camera);
});
