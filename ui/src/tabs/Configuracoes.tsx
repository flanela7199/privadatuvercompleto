import React from 'react';
import { useStore } from '../state/config';
import { invoke, isTauri } from '../lib/bridge';
import { DEFAULT_CONFIG } from '../lib/legacy';
import { APP_VERSION, clone, download, pickFile } from '../lib/catalog';
import { Section, Field, Fields, Note } from '../components/Section';
import { Button } from '../components/Button';
import { Select } from '../components/Select';
import { Slider } from '../components/Slider';
import { Toggle } from '../components/Toggle';
import { useToast } from '../components/Toast';

export function Configuracoes() {
  const { s, update, applyHotkeys, replaceConfig } = useStore();
  const toast = useToast();
  const st = s.cfg.settings, r = s.cfg.render;
  const setS = (k: string, v: any) => update((d) => { d.cfg.settings[k] = v; });
  const setR = (k: string, v: any) => update((d) => { d.cfg.render[k] = v; });
  const look = s.cfg.look;
  const setL = (k: string, v: number) => update((d) => { d.cfg.look[k] = v; });
  const setMaster = (v: boolean) => { update((d) => { d.cfg.hotkeysEnabled = v; }); applyHotkeys({ ...s.cfg, hotkeysEnabled: v }); };

  const importCfg = async () => {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const c = JSON.parse(await f.text());
      if (!c || typeof c !== 'object' || (!c.scenes && !c.hotkeys && !c.outfits)) throw new Error('Esse arquivo não parece uma configuração do Privada Tuber.');
      if (!confirm('Substituir toda a configuração atual pela do arquivo?')) return;
      replaceConfig(c);
      toast('Configuração importada');
    } catch (err: any) { toast(err.message, 'err'); }
  };

  return (
    <div className="page">
      <Section title="Geral">
        <Fields>
          <Field label="Iniciar minimizado na bandeja" tip="O app abre escondido; use o ícone da bandeja."><Toggle checked={st.startMinimized} onChange={(v) => setS('startMinimized', v)} /></Field>
          <Field label="Abrir este painel ao iniciar"><Toggle checked={st.openPanelOnStart} onChange={(v) => setS('openPanelOnStart', v)} /></Field>
          <Field label="Idioma"><Select value={st.language} options={[['pt-BR', 'Português (Brasil)']]} disabled tip="Mais idiomas em breve" onChange={() => {}} /></Field>
        </Fields>
      </Section>
      <Section title="Desempenho" desc="Menos FPS e qualidade = menos uso de GPU durante a live.">
        <Fields>
          <Field label="Quadros por segundo"><Select value={r.fps} options={[[30, '30 FPS'], [60, '60 FPS'], [120, '120 FPS'], [144, '144 FPS']]} onChange={(v) => setR('fps', +v)} /></Field>
          <Field label="Qualidade (resolução)"><Select value={r.pixelRatio} options={[[1, 'Leve (1×)'], [1.5, 'Normal (1.5×)'], [2, 'Alta (2×)']]} onChange={(v) => setR('pixelRatio', +v)} /></Field>
          <Field label="Sombras"><Toggle checked={r.shadows} onChange={(v) => setR('shadows', v)} /></Field>
          <Field label="Oclusão de ambiente (AO)" tip="Sombra suave nos cantos. Mais pesado."><Toggle checked={r.ao} onChange={(v) => setR('ao', v)} /></Field>
        </Fields>
        {r.ao && <div style={{ marginTop: 8 }}><Note kind="warn">⚠ AO pode causar artefato (uma "parede" escura atrás da privada) em algumas placas. Desligue se aparecer.</Note></div>}
      </Section>
      <Section title="Sons">
        <Fields>
          <Field label="Efeitos sonoros" tip="Descarga, papel, pulo…"><Toggle checked={st.soundsEnabled} onChange={(v) => setS('soundsEnabled', v)} /></Field>
          <Field label="Volume"><Slider value={st.soundVolume} min={0} max={1} step={0.01} fmt="pct" disabled={!st.soundsEnabled} onChange={(v) => setS('soundVolume', v)} /></Field>
        </Fields>
      </Section>
      <Section title="Personagem">
        <Fields>
          <Field label="Seguir o mouse (padrão)"><Toggle checked={st.followDefault} onChange={(v) => setS('followDefault', v)} /></Field>
          <Field label="Piscar sozinho"><Toggle checked={st.autoBlink} onChange={(v) => setS('autoBlink', v)} /></Field>
          <Field label="Boca em repouso" tip="Quanto a tampa fica entreaberta parada."><Slider value={st.restOpen} min={0} max={0.2} step={0.005} onChange={(v) => setS('restOpen', v)} /></Field>
          <Field label="Sensibilidade do olhar" tip="Maior = vira mais para o mouse."><Slider value={st.lookSensitivity} min={0.2} max={2} step={0.05} fmt="x" onChange={(v) => setS('lookSensitivity', v)} /></Field>
        </Fields>
        <h3>Olhar para o mouse (todos os monitores)</h3>
        <Fields>
          <Field label="Alcance do olhar" tip="Quanto ele vira em direção ao mouse. 1 = normal."><Slider value={look.range} min={0.3} max={1.5} step={0.01} fmt="x" onChange={(v) => setL('range', v)} /></Field>
          <Field label="Distância até virar tudo" tip="A que distância (em pixels da tela) do personagem o mouse precisa estar para ele virar o máximo. Menor = vira tudo com pouco movimento."><Slider value={look.reachPx} min={400} max={4000} step={10} fmt="px" onChange={(v) => setL('reachPx', v)} /></Field>
          <Field label="Giro máximo (graus)" tip="Quanto a privada gira para os lados no máximo."><Slider value={look.maxYawDeg} min={30} max={110} step={1} fmt="deg" onChange={(v) => setL('maxYawDeg', v)} /></Field>
          <Field label="Inclinação máxima" tip="Quanto ela olha para cima/baixo no máximo."><Slider value={look.maxPitchDeg} min={10} max={60} step={1} fmt="deg" onChange={(v) => setL('maxPitchDeg', v)} /></Field>
        </Fields>
      </Section>
      <Section title="Atalhos">
        <Fields><Field label="Atalhos globais ligados" tip="Desligar mantém a lista salva."><Toggle checked={s.cfg.hotkeysEnabled} onChange={setMaster} /></Field></Fields>
      </Section>
      <Section title="Dados" desc="Configuração inteira: visuais, cenas, atalhos e ajustes.">
        <div className="btns">
          <Button onClick={() => download('privada-config.json', s.cfg)}>⬇ Exportar configuração</Button>
          <Button onClick={importCfg}>📂 Importar configuração</Button>
          {isTauri && <Button onClick={() => invoke('open_data_dir').catch((e: any) => toast(`Não consegui abrir: ${e}`, 'err'))}>📁 Abrir pasta de dados</Button>}
          <Button kind="danger" onClick={() => {
            if (!confirm('Restaurar TUDO para o padrão? Seus presets, cenas e atalhos serão apagados.')) return;
            replaceConfig(clone(DEFAULT_CONFIG));
            toast('Tudo restaurado para o padrão', 'warn');
          }}>Restaurar tudo para o padrão</Button>
        </div>
      </Section>
      <Section title="Sobre">
        <p>Privada Tuber <b>v{APP_VERSION}</b> · {isTauri ? 'app desktop' : 'modo navegador'}</p>
        <p className="mut" style={{ marginTop: 4 }}>Feito para a live da Flanela. 🚽👑</p>
      </Section>
    </div>
  );
}
