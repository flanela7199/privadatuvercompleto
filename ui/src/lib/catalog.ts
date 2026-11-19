// Static data + small helpers shared by the tabs.
import { ACCESSORY_INFO, MUSTACHE_IDS, DEFAULT_CONFIG } from './legacy';

export const APP_VERSION = '0.1.0';
export type Opt = [string | number, string];

export const SOCKETS: Record<string, string> = {
  lip_upper: 'Lábio superior (tampa)', mouth: 'Boca', floor_under: 'Chão (embaixo dele)', head_top: 'Topo da cabeça', eyes: 'Olhos', tank_front: 'Frente do tanque', face: 'Rosto (frente da bacia)',
  lid_top: 'Tampa (boca)', body_front: 'Corpo (frente)', neck: 'Pescoço (cano)', side_right: 'Lado direito',
  back: 'Costas', floor_left: 'Chão esquerdo', floor_right: 'Chão direito',
};
export const SOCKET_OPTS: Opt[] = Object.entries(SOCKETS);
/** characters the avatar can be: [id, icon, name] (config.character) */
export const CHARACTERS: [string, string, string][] = [['privada', '🚽', 'Privada'], ['chratos', '🧔', 'Chratos']];
/** Chratos options (theme.chratos), mirrors web/src/characters/chratos/Chratos.js DEFAULTS */
export const CHRATOS_DEFAULTS = { chair: true, headphones: true, cable: true, hoodie: null as string | null, hair: null as string | null, restSmile: 0.3, detail: 1 };
export const CHRATOS_BASE_COLORS = { hoodie: '#1a1a1e', hair: '#322118' };
export const CHRATOS_SOCKETS = ['head_top', 'eyes', 'mouth'];
export const CHRATOS_ANIMS: [string, string][] = [
  ['laugh', '😂 Rir'], ['nod', '🙂 Acenar com a cabeça'], ['no', '↔ Não'], ['surprise', '😮 Surpresa'], ['wink', '😉 Piscadinha'], ['blink', '😑 Piscar'],
];

export const CATS = ['Todos', 'Chapéus', 'Olhos', 'Rosto', 'Bigodes', 'Corpo', 'Objetos', 'Móveis', 'Outros'];
export const MAT_KEYS: [string, string][] = [
  ['porcelain', 'Porcelana'], ['seat', 'Assento'], ['lid', 'Tampa'], ['tankLid', 'Tampa do tanque'],
  ['chrome', 'Metal'], ['gold', 'Ouro'], ['mustache', 'Bigode'], ['eyeWhite', 'Olho'],
  ['pupil', 'Pupila'], ['paper', 'Papel'], ['water', 'Água'],
];
export const ANIMS: [string, string][] = [
  ['flush', '💧 Descarga'], ['paper', '🧻 Papel'], ['jump', '⤴ Pulo'], ['backflip', '🤸 Mortal'],
  ['no', '↔ Não'], ['gargle', '🫧 Gargarejo'], ['blink', '😑 Piscar'],
];
export const VISEMES = ['A', 'E', 'I', 'O', 'U', 'M', 'F', 'S'];
/** the standard visemes (web/src/input/visemes.js STANDARD_VISEMES, minus rest) with a pt-BR hint */
export const STANDARD_VISEME_LIST: [string, string][] = [
  ['AA', 'a (pá)'], ['AH', 'â (cama)'], ['AO', 'ó (pó)'], ['AW_OW', 'ou'], ['CH_J_SH', 'ch / j / x'],
  ['EH_AE', 'é (pé)'], ['EY', 'ê (vê)'], ['FV', 'f / v'], ['IH_AY', 'i / ai'], ['L', 'l'],
  ['M_P_B', 'm / p / b'], ['N_NG_DH', 'n / d / t'], ['OY_UH_UW', 'u / ô'], ['R_ER', 'r'], ['W', 'u curto (w)'], ['Y_IY', 'i longo'],
];
export const SIZES: [number, number, string][] = [[1280, 720, '1280×720 (HD)'], [1920, 1080, '1920×1080 (Full HD)'], [1080, 1920, '1080×1920 (vertical)']];

export const SETTINGS_DEFAULTS = {
  startMinimized: false, openPanelOnStart: true, language: 'pt-BR',
  soundsEnabled: true, soundVolume: 0.8,
  followDefault: true, autoBlink: true, restOpen: 0.05, lookSensitivity: 1,
  mouth: { maxOpen: 0.65, curve: 1.6 },
};
export const LOOK_DEFAULTS = { range: 1.0, reachPx: 1400, maxYawDeg: 80, maxPitchDeg: 35 };
export const RENDER_DEFAULTS = { fps: 60, pixelRatio: 1.5, ao: false, shadows: true };
export const sceneDefaults = (s: any = {}) => ({
  name: 'Nova cena', mode: 'window', outfit: null, x: 0.5, y: 0.86, scale: 1.25, background: 'color',
  bgColor: '#00ff00', follow: true, mic: true, clickThrough: 'off', alwaysOnTop: false, ...s,
});

/** body proportions (theme.body), see docs/app-contract.md "Body proportions + mouth limits" */
export const BODY_DEFAULTS = { tank: { w: 1, h: 1.38, d: 1, round: 0.1, bulge: 0.02, taper: 0.93, lidRound: 0.035, lidThick: 0.14, lidOver: 0.045 }, eyes: { size: 1.13, spacing: 0.97, y: 0, style: 'classico' as 'classico' | 'googly' | 'desenho' | 'serio' | 'sticker' }, neck: { length: 0.9 }, roll: { mount: 'side' as 'side' | 'front' } };
/** open' = maxOpen * open^curve (what the avatar applies before the rig) */
export const shapeOpen = (open: number, m: { maxOpen: number; curve: number }) => m.maxOpen * Math.pow(Math.max(0, Math.min(1, open)), m.curve);

export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

export function normalizeConfig(c: any) {
  const out: any = { ...clone(DEFAULT_CONFIG), ...(c || {}) };
  out.outfits ||= {};
  out.audio = { ...DEFAULT_CONFIG.audio, ...(out.audio || {}) };
  out.render = { ...RENDER_DEFAULTS, ...(DEFAULT_CONFIG.render || {}), ...(c?.render || {}) };
  out.settings = { ...SETTINGS_DEFAULTS, ...(out.settings || {}) };
  out.settings.mouth = { ...SETTINGS_DEFAULTS.mouth, ...(c?.settings?.mouth || {}) };
  out.look = { ...LOOK_DEFAULTS, ...(DEFAULT_CONFIG.look || {}), ...(c?.look || {}) };
  out.scenes = (out.scenes?.length ? out.scenes : clone(DEFAULT_CONFIG.scenes)).map(sceneDefaults);
  out.hotkeysEnabled = out.hotkeysEnabled ?? true;
  out.character = out.character === 'chratos' ? 'chratos' : 'privada';
  out.hotkeys ||= {};
  return out;
}

/** furniture metadata (FURNITURE_INFO from web/src/accessories/furniture.js), filled at boot */
let FURNITURE: Record<string, any> = {};
export function setFurnitureInfo(info: Record<string, any>) { FURNITURE = info || {}; }

export function accInfo(id: string): { name: string; socket: string; category: string } {
  const f = FURNITURE[id];
  if (f) return { name: f.name || id.replace(/_/g, ' '), socket: f.socket || 'floor_under', category: 'Móveis' };
  const i = (ACCESSORY_INFO as any)[id];
  if ((MUSTACHE_IDS as string[]).includes(id)) return { name: i?.name || id.replace('mustache_', 'Bigode ').replace(/_/g, ' '), socket: i?.socket || 'lip_upper', category: 'Bigodes' };
  return i || { name: id.replace(/_/g, ' '), socket: 'head_top', category: 'Outros' };
}

export function toHex(c: string | undefined, d: string) {
  if (!c) return d;
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + [...c.slice(1)].map((x) => x + x).join('');
  return d;
}

export function download(name: string, data: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = name;
  a.click();
}

export function pickFile(accept = '.json'): Promise<File | null> {
  return new Promise((res) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept });
    inp.onchange = () => res(inp.files?.[0] || null);
    inp.click();
  });
}

export const readAsDataURL = (f: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); });

/** Tauri global-shortcut accelerator from a keydown ("Ctrl+Alt+F"); null for bare modifiers. */
export function accelFromEvent(e: KeyboardEvent) {
  const c = e.code;
  if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(c)) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  let k = c;
  if (c.startsWith('Key')) k = c.slice(3);
  else if (c.startsWith('Digit')) k = c.slice(5);
  else if (c.startsWith('Arrow')) k = c.slice(5);
  return [...mods, k].join('+');
}
