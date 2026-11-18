import React from 'react';
import { Tabs } from './components/Tabs';
import { live, useLiveTick, useStore } from './state/config';
import { invoke, isTauri, emit } from './lib/bridge';
import { Button } from './components/Button';
import { ThumbChip } from './components/ThumbChip';
import { prerenderAll } from './lib/thumbs';
import { listAccessories } from './lib/legacy';
import { resolveOutfit } from './state/config';
import { Visual } from './tabs/Visual';
import { Presets } from './tabs/Presets';
import { Cenas } from './tabs/Cenas';
import { SaidaOBS } from './tabs/SaidaOBS';
import { Atalhos } from './tabs/Atalhos';
import { Microfone } from './tabs/Microfone';
import { Animacoes } from './tabs/Animacoes';
import { Configuracoes } from './tabs/Configuracoes';

const TABS: [string, string][] = [
  ['visual', '👔 Visual'], ['presets', '⭐ Presets'], ['scenes', '🎬 Cenas'], ['obs', '📺 OBS'],
  ['hotkeys', '⌨ Atalhos'], ['mic', '🎤 Microfone'], ['anims', '💧 Animações'], ['settings', '⚙ Configurações'],
];

function Status() {
  useLiveTick();
  const alive = performance.now() - live.avatarSeen < 2000;
  const save = { ok: 'salvo', saving: 'salvando…', erro: '⚠ erro ao salvar' }[live.saveState];
  return (
    <div id="status">
      <span className={`dot ${alive ? 'ok' : ''}`} />
      {isTauri ? 'App' : 'Navegador'} · avatar {alive ? `${live.avatarFps.toFixed(0)} fps` : 'offline'} · {save}
    </div>
  );
}

export function App() {
  const { s } = useStore();
  const [tab, setTab] = React.useState('visual');
  const tabRef = React.useRef(tab);
  tabRef.current = tab;
  // Tell the app the panel is interactive right after its first real paint (not after thumbnails).
  React.useEffect(() => {
    if (!s.ready) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      emit('loading', { progress: 0.6, text: 'painel pronto' });
      invoke('page_ready', { label: 'control' }).catch(() => {});
      // eager background pre-render of every preset + accessory thumbnail (disk-cached)
      const ids = [...Object.keys(s.cfg.outfits || {}), ...Object.keys(s.themes), ...Object.keys(s.presets)];
      const outfits = [...new Set(ids)].map((id) => resolveOutfit(s, id));
      const acc = (listAccessories() as string[]).filter((id) => id !== 'glb');
      setTimeout(() => prerenderAll(outfits, acc, s.themes.base, tabRef.current === 'visual' ? 'accessories' : 'presets'), 200);
    }));
  }, [s.ready]);
  if (!s.ready) return <div style={{ padding: 24 }} className="mut">Carregando o Privada Tuber…</div>;
  return (
    <>
      <header>
        <div className="logo">🚽 Privada Tuber</div>
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
        <div className="grow" />
        <ThumbChip />
        <Button kind="primary" tip="Abre/traz para frente a janela do personagem" onClick={() => invoke('show_avatar').catch(() => {})}>🚽 Mostrar personagem</Button>
        <Status />
      </header>
      <main>
        {/* Visual stays mounted so the 3D preview keeps its WebGL context; it idles when hidden. */}
        <section className={`tab ${tab === 'visual' ? 'sel' : ''}`} id="tab-visual"><Visual active={tab === 'visual'} /></section>
        {tab === 'presets' && <section className="tab sel"><Presets /></section>}
        {tab === 'scenes' && <section className="tab sel"><Cenas /></section>}
        {tab === 'obs' && <section className="tab sel"><SaidaOBS /></section>}
        {tab === 'hotkeys' && <section className="tab sel"><Atalhos /></section>}
        {tab === 'mic' && <section className="tab sel"><Microfone /></section>}
        {tab === 'anims' && <section className="tab sel"><Animacoes /></section>}
        {tab === 'settings' && <section className="tab sel"><Configuracoes /></section>}
      </main>
    </>
  );
}
