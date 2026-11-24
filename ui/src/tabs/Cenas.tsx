import React from 'react';
import { useStore, allOutfits } from '../state/config';
import { clone, sceneDefaults } from '../lib/catalog';
import { Section, Field, Fields, Note } from '../components/Section';
import { Button } from '../components/Button';
import { Select, TextField } from '../components/Select';
import { Slider } from '../components/Slider';
import { Toggle } from '../components/Toggle';
import { ColorField } from '../components/ColorField';
import { useToast } from '../components/Toast';

export function Cenas() {
  const { s, update, activateScene, runAction } = useStore();
  const toast = useToast();
  const scenes = s.cfg.scenes;
  const [i, setI] = React.useState(Math.min(s.cfg.activeScene || 0, scenes.length - 1));
  const cur = Math.min(i, scenes.length - 1);
  const sc = scenes[cur];
  const set = (k: string, v: any) => update((d) => { d.cfg.scenes[cur][k] = v; });
  const move = (dir: number) => {
    const j = cur + dir;
    if (j < 0 || j >= scenes.length) return;
    update((d) => {
      const a = d.cfg.scenes;
      [a[cur], a[j]] = [a[j], a[cur]];
      if (d.cfg.activeScene === cur) d.cfg.activeScene = j; else if (d.cfg.activeScene === j) d.cfg.activeScene = cur;
    });
    setI(j);
  };
  const live = cur === s.cfg.activeScene;

  return (
    <div className="scenes">
      <Section title="Cenas" desc="Troque com Ctrl+Alt+1, 2, 3…">
        {scenes.map((x: any, k: number) => (
          <div key={k} className={`scene-item ${k === cur ? 'sel' : ''}`} onClick={() => setI(k)}>
            <span>{k + 1}. {x.name}</span>{k === s.cfg.activeScene && <span className="live">● ao vivo</span>}
          </div>
        ))}
        <div className="btns" style={{ marginTop: 12 }}>
          <Button size="sm" onClick={() => { update((d) => { d.cfg.scenes.push(sceneDefaults({ name: `Cena ${d.cfg.scenes.length + 1}` })); }); setI(scenes.length); }}>＋ Nova</Button>
          <Button size="sm" onClick={() => { update((d) => { d.cfg.scenes.splice(cur + 1, 0, { ...clone(sc), name: `${sc.name} (cópia)` }); }); setI(cur + 1); }}>Duplicar</Button>
          <Button size="sm" tip="Subir" onClick={() => move(-1)}>↑</Button>
          <Button size="sm" tip="Descer" onClick={() => move(1)}>↓</Button>
          <Button kind="danger" size="sm" onClick={() => {
            if (scenes.length < 2) return toast('Precisa ter pelo menos uma cena.', 'warn');
            if (!confirm(`Remover a cena "${sc.name}"?`)) return;
            update((d) => { d.cfg.scenes.splice(cur, 1); if (d.cfg.activeScene >= d.cfg.scenes.length) d.cfg.activeScene = d.cfg.scenes.length - 1; });
            setI(Math.max(0, cur - 1));
          }}>Remover</Button>
        </div>
      </Section>

      <Section title={sc.name} desc={live ? 'Esta é a cena ativa.' : 'Edite e clique em Ativar.'}>
        <Fields>
          <Field label="Nome"><TextField value={sc.name} onChange={(v) => set('name', v)} /></Field>
          <Field label="Modo" tip="Janela própria: uma janela normal só da privada (ideal para OBS). Overlay: flutua por cima da área de trabalho.">
            <Select value={sc.mode} options={[['window', 'Janela própria (recomendado p/ OBS)'], ['overlay', 'Sobre o desktop (overlay)']]} onChange={(v) => set('mode', v)} />
          </Field>
          {sc.mode !== 'overlay' && (
            <Field label="Tamanho da janela" tip="Sempre abre a janela da privada neste tamanho (em pixels reais da tela) ao ativar a cena ou abrir o app. Para o OBS, 1920×1080 (16:9).">
              <Select value={sc.winSize || ''} options={[['', 'Livre (lembra o último tamanho)'], ['1920x1080', '1920 × 1080 (16:9 Full HD)'], ['1280x720', '1280 × 720 (16:9 HD)'], ['1080x1920', '1080 × 1920 (vertical 9:16)'], ['720x900', '720 × 900 (padrão do app)']]} onChange={(v) => set('winSize', v)} />
            </Field>
          )}
          <Field label="Visual da cena"><Select value={sc.outfit || ''} options={[['', '(manter visual atual)'], ...allOutfits(s)]} onChange={(v) => set('outfit', v || null)} /></Field>
          <Field label="Posição X" tip="0 = esquerda, 1 = direita"><Slider value={sc.x} min={0} max={1} step={0.005} onChange={(v) => set('x', v)} /></Field>
          <Field label="Posição Y" tip="Onde fica o pé da privada (0 = topo, 1 = base)"><Slider value={sc.y} min={0} max={1} step={0.005} onChange={(v) => set('y', v)} /></Field>
          <Field label="Tamanho"><Slider value={sc.scale} min={0.3} max={3} step={0.01} fmt="x" onChange={(v) => set('scale', v)} /></Field>
          <Field label="Fundo">
            <Select value={sc.background} options={[['transparent', 'Transparente'], ['color', 'Cor sólida / chroma'], ['sala', 'Sala 3D (cenário completo)']]} onChange={(v) => set('background', v)} />
            <ColorField value={sc.bgColor} fallback="#00ff00" disabled={sc.background !== 'color'} onChange={(v) => set('bgColor', v)} />
          </Field>
          {sc.background === 'sala' && (
            <Field label="Sala 3D" tip="O fundo 3D é desenhado junto com a privada, na mesma janela. Posição X/Y e Tamanho não se aplicam: use o editor da sala (lugar do personagem e câmera).">
              <Button size="sm" disabled={!live} onClick={() => { runAction('sala:editar'); toast(<>Editor da sala aberto na janela da <b>Privada Tuber</b></>); }}>✏ Editar a sala</Button>
            </Field>
          )}
          <Field label="Seguir o mouse"><Toggle checked={sc.follow} onChange={(v) => set('follow', v)} /></Field>
          <Field label="Microfone mexe a boca"><Toggle checked={sc.mic} onChange={(v) => set('mic', v)} /></Field>
          <Field label="Sempre no topo" tip="Desligado: a privada pode ficar atrás de outras janelas (bom para OBS)."><Toggle checked={sc.alwaysOnTop} onChange={(v) => set('alwaysOnTop', v)} /></Field>
          <Field label="Clicar através" tip="No overlay: deixa os cliques passarem para as janelas de trás.">
            <Select value={sc.clickThrough} options={[['off', 'Nunca'], ['on', 'Sempre (cliques passam direto)'], ['auto', 'Automático']]} onChange={(v) => set('clickThrough', v)} />
          </Field>
        </Fields>
        <div style={{ marginTop: 16 }}>
          {sc.background === 'sala' && <Note>🏠 <b>Sala 3D</b>: o cenário inteiro sai na própria janela da Privada Tuber (um programa só, sem fonte de navegador no OBS). Deixe a janela em 16:9 (ex.: 1280×720 ou 1920×1080). Para mexer nos móveis, quadros e câmera: ative a cena e clique em <b>✏ Editar a sala</b> (ou use o atalho "Abrir/fechar editor da Sala 3D").</Note>}
          <Note>💡 Para OBS: use <b>Captura de janela</b> na janela <b>Privada Tuber</b> (funciona mesmo atrás de outras janelas). Com fundo transparente ative <b>Permitir transparência</b> se houver; senão use fundo de cor + filtro <b>Chroma Key</b>.</Note>
        </div>
        <div className="btns" style={{ marginTop: 16 }}>
          <Button kind="primary" disabled={live} onClick={() => { activateScene(cur); toast(<>Cena <b>{sc.name}</b> ativada</>); }}>▶ Ativar esta cena</Button>
        </div>
      </Section>
    </div>
  );
}
