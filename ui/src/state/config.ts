// Single store for the panel: React context + reducer.
//  - state.cfg   : the app Config (docs/app-contract.md + settings/output/hotkeysEnabled)
//  - state.work  : fully resolved theme of the active outfit (what the avatar wears)
// Side effects: save_config (debounced 350 ms) and emit('state', {...cfg, outfitTheme: work})
// (throttled 80 ms, trailing) after every change.
import React from 'react';
import { invoke, listen, emit } from '../lib/bridge';
import { loadThemes, DEFAULT_CONFIG, makeResolver, loadPresets, loadFurniture } from '../lib/legacy';
import { captureOutfitThumb, requestOutfitThumbs } from '../lib/thumbs';
import { clone, normalizeConfig, setFurnitureInfo } from '../lib/catalog';

export type State = { ready: boolean; cfg: any; work: any; themes: Record<string, any>; presets: Record<string, any>; hkFailed: string[] };
type Action = { type: 'init'; state: State } | { type: 'update'; fn: (d: State) => void; fork?: boolean };

/* ------------------------------------------------------------ outfit logic */
// same resolution code as the static-thumbnail generator (web/src/app/outfits.js)
const resolver = (s: State) => makeResolver({ themes: s.themes, presets: s.presets, outfits: s.cfg.outfits });
export const rawOutfit = (s: State, id: string) => resolver(s).raw(id);
export function resolveOutfit(s: State, id: string): any { return resolver(s).resolve(id); }
export const outfitName = (s: State, id: string) => rawOutfit(s, id)?.name || id;
export const allOutfits = (s: State): [string, string][] => [
  ...Object.entries(s.cfg.outfits || {}).map(([id, t]: any) => [id, '★ ' + (t.name || id)] as [string, string]),
  ...Object.entries(s.themes).map(([id, t]: any) => [id, t.name || id] as [string, string]),
  ...Object.entries(s.presets).map(([id, t]: any) => [id, t.name || id] as [string, string]),
];
export const newId = () => `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Editing a built-in outfit forks it into a custom one so presets stay pristine. */
function fork(d: State) {
  const id = d.cfg.activeOutfit;
  if (d.cfg.outfits[id]) return;
  const nid = newId();
  d.work = { ...d.work, id: nid, name: `${outfitName(d, id)} (editado)` };
  delete d.work.extends;
  d.cfg.outfits[nid] = d.work;
  d.cfg.activeOutfit = nid;
}

function reducer(s: State, a: Action): State {
  if (a.type === 'init') return a.state;
  const d: State = { ...s, cfg: clone(s.cfg), work: clone(s.work) };
  if (a.fork) fork(d);
  a.fn(d);
  if (d.cfg.outfits[d.cfg.activeOutfit]) d.cfg.outfits[d.cfg.activeOutfit] = d.work; // keep custom outfit in sync
  return d;
}

/** Only enabled bindings, and none at all when the master switch is off. */
export function activeBindings(cfg: any) {
  if (!cfg.hotkeysEnabled) return {};
  return Object.fromEntries(Object.entries(cfg.hotkeys || {}).filter(([, b]: any) => b.enabled !== false).map(([a, b]: any) => [a, { action: b.action, arg: b.arg }]));
}

/* --------------------------------------------------- live data (no re-render) */
// mouth vector + avatar status change 60 times a second: kept outside React state.
export const live = {
  mouth: { open: 0, round: 0, wide: 0, closed: 0, sib: 0, level: 0 } as Record<string, number>,
  avatarFps: 0, avatarSeen: 0, saveState: 'ok' as 'ok' | 'saving' | 'erro',
  subs: new Set<() => void>(),
};
let liveTick = 0;
function notifyLive() { live.subs.forEach((f) => f()); }
setInterval(() => { liveTick++; notifyLive(); }, 100);
/** re-render the caller at ~10 Hz to show live values */
export function useLiveTick() {
  return React.useSyncExternalStore((cb) => { live.subs.add(cb); return () => live.subs.delete(cb); }, () => liveTick);
}

/* --------------------------------------------------------------- provider */
type Ctx = {
  s: State;
  update: (fn: (d: State) => void, opts?: { fork?: boolean }) => void;
  applyOutfit: (id: string) => void;
  activateScene: (i: number) => void;
  runAction: (value: string) => void;
  setCharacter: (id: string) => void;
  applyHotkeys: (cfg?: any) => Promise<string[]>;
  replaceConfig: (c: any) => void;
  previewPlay: React.MutableRefObject<(a: string) => void>;
};
const C = React.createContext<Ctx>(null as any);
export const useStore = () => React.useContext(C);


const EMPTY: State = { ready: false, cfg: normalizeConfig(null), work: null, themes: {}, presets: {}, hkFailed: [] };

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [s, dispatch] = React.useReducer(reducer, EMPTY);
  const sRef = React.useRef(s);
  sRef.current = s;
  const previewPlay = React.useRef<(a: string) => void>(() => {});

  const update = React.useCallback((fn: (d: State) => void, opts: { fork?: boolean } = {}) => dispatch({ type: 'update', fn, fork: opts.fork }), []);

  const applyHotkeys = React.useCallback(async (cfg = sRef.current.cfg) => {
    try {
      const res: any = await invoke('set_hotkeys', { bindings: activeBindings(cfg) });
      const failed: string[] = res?.failed || [];
      update((d) => { d.hkFailed = failed; });
      return failed;
    } catch { return []; }
  }, [update]);

  const build = (st: State, c: any): State => {
    const cfg = normalizeConfig(c);
    const base = { ...st, cfg };
    if (!rawOutfit(base, cfg.activeOutfit)) cfg.activeOutfit = 'base';
    return { ...base, ready: true, work: resolveOutfit(base, cfg.activeOutfit) };
  };
  const replaceConfig = React.useCallback((c: any) => {
    const next = build(sRef.current, c);
    dispatch({ type: 'init', state: next });
    applyHotkeys(next.cfg);
    invoke('set_audio', { audio: next.cfg.audio }).catch(() => {});
  }, [applyHotkeys]);

  // boot
  React.useEffect(() => {
    (async () => {
      emit('loading', { progress: 0.1, text: 'carregando temas…' });
      const themes = await loadThemes('../themes/');
      emit('loading', { progress: 0.25, text: 'carregando presets…' });
      const presets = await loadPresets('../presets/');
      setFurnitureInfo(await loadFurniture()); // registers the furniture accessories too
      emit('loading', { progress: 0.4, text: 'lendo configuração…' });
      const loaded = await invoke('load_config').catch(() => null);
      const next = build({ ...EMPTY, themes, presets }, loaded);
      dispatch({ type: 'init', state: next });
      applyHotkeys(next.cfg);
      invoke('set_audio', { audio: next.cfg.audio }).catch(() => {});
    })().catch((e) => console.error('[panel boot]', e));
    const un = [
      listen('mouth', (m: any) => { if (m) live.mouth = m; }),
      listen('avatar-status', (st: any) => { live.avatarSeen = performance.now(); live.avatarFps = st?.fps || 0; }),
      listen('hotkey', (h: any) => {
        if (!h) return;
        const cur = sRef.current;
        if (h.action === 'outfit' && rawOutfit(cur, h.arg)) update((d) => { d.cfg.activeOutfit = h.arg; d.work = resolveOutfit(d, h.arg); });
        if (h.action === 'scene' && cur.cfg.scenes[+h.arg]) update((d) => { d.cfg.activeScene = +h.arg; });
        if (h.action === 'play') previewPlay.current(h.arg);
        if (h.action === 'character' && (h.arg === 'privada' || h.arg === 'chratos')) update((d) => { d.cfg.character = h.arg; });
      }),
    ];
    return () => un.forEach((f) => f());
  }, []);

  // persist + broadcast after every change
  const saveT = React.useRef<any>(0);
  const emitT = React.useRef({ last: 0, timer: 0 as any });
  React.useEffect(() => {
    if (!s.ready) return;
    clearTimeout(saveT.current);
    live.saveState = 'saving';
    saveT.current = setTimeout(() => {
      invoke('save_config', { config: sRef.current.cfg }).then(() => { live.saveState = 'ok'; }).catch(() => { live.saveState = 'erro'; });
    }, 350);
    const fire = () => { emitT.current.last = performance.now(); emit('state', { ...sRef.current.cfg, outfitTheme: sRef.current.work }); };
    const since = performance.now() - emitT.current.last;
    clearTimeout(emitT.current.timer);
    if (since >= 80) fire(); else emitT.current.timer = setTimeout(fire, 80 - since);
  }, [s.cfg, s.work, s.ready]);

  // user outfit edited -> refresh its thumbnail from the character window (debounced)
  const capT = React.useRef<any>(0);
  React.useEffect(() => {
    if (!s.ready) return;
    const id = s.cfg.activeOutfit;
    if (!s.cfg.outfits?.[id]) return;
    clearTimeout(capT.current);
    const resolved = s.work;
    capT.current = setTimeout(() => { captureOutfitThumb(resolved); requestOutfitThumbs([resolved]); }, 1500);
    return () => clearTimeout(capT.current);
  }, [s.work, s.ready]);

  const applyOutfit = React.useCallback((id: string) => update((d) => { d.cfg.activeOutfit = id; d.work = resolveOutfit(d, id); }), [update]);
  const activateScene = React.useCallback((i: number) => {
    update((d) => {
      d.cfg.activeScene = i;
      const sc = d.cfg.scenes[i];
      if (sc?.outfit && rawOutfit(d, sc.outfit)) { d.cfg.activeOutfit = sc.outfit; d.work = resolveOutfit(d, sc.outfit); }
    });
    emit('command', { action: 'scene', arg: String(i) });
  }, [update]);
  const setCharacter = React.useCallback((id: string) => {
    update((d) => { d.cfg.character = id; });
    emit('command', { action: 'character', arg: id });
  }, [update]);
  const runAction = React.useCallback((value: string) => {
    const i = value.indexOf(':');
    const action = i < 0 ? value : value.slice(0, i), arg = i < 0 ? '' : value.slice(i + 1);
    if (action === 'character') { if (arg === 'privada' || arg === 'chratos') setCharacter(arg); return; }
    if (action === 'outfit') { if (rawOutfit(sRef.current, arg)) applyOutfit(arg); return; }
    if (action === 'scene') { if (sRef.current.cfg.scenes[+arg]) activateScene(+arg); return; }
    if (action === 'open') return;
    if (action === 'play') previewPlay.current(arg);
    emit('command', { action, arg });
  }, [applyOutfit, activateScene, setCharacter]);

  const value: Ctx = { s, update, applyOutfit, activateScene, runAction, setCharacter, applyHotkeys, replaceConfig, previewPlay };
  return React.createElement(C.Provider, { value }, children);
}

export { DEFAULT_CONFIG };
