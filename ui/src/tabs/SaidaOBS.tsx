import React from 'react';
import { useStore } from '../state/config';
import { invoke } from '../lib/bridge';
import { SIZES, type Opt } from '../lib/catalog';
import { Section, Field, Fields, Note } from '../components/Section';
import { Button } from '../components/Button';
import { Select } from '../components/Select';
import { ColorField } from '../components/ColorField';
import { useToast } from '../components/Toast';

const CHROMA = '#00ff00';

/** OBS tab: the character window itself is the OBS source. Edits apply to the ACTIVE scene. */
export function SaidaOBS() {
  const { s, update } = useStore();
  const toast = useToast();
  const i = Math.min(s.cfg.activeScene || 0, s.cfg.scenes.length - 1);
  const sc = s.cfg.scenes[i];
  const bg = sc.background === 'transparent' ? 'transparent' : (sc.bgColor || '').toLowerCase() === CHROMA ? 'green' : 'color';
  const size = sc.width && sc.height ? `${sc.width}x${sc.height}` : '';
  const sizes: Opt[] = [['', 'Do jeito que está'], ...SIZES.map(([w, h, n]) => [`${w}x${h}`, n] as Opt)];

  const setBg = (v: string) => update((d) => {
    const x = d.cfg.scenes[i];
    if (v === 'transparent') x.background = 'transparent';
    else if (v === 'green') { x.background = 'color'; x.bgColor = CHROMA; }
    else { x.background = 'color'; if ((x.bgColor || '').toLowerCase() === CHROMA) x.bgColor = '#202020'; }
  });
  const setSize = async (v: string) => {
    if (!v) return;
    const [width, height] = v.split('x').map(Number);
    update((d) => { Object.assign(d.cfg.scenes[i], { width, height, mode: 'window' }); });
    try { await invoke('set_avatar_mode', { mode: 'window', width, height }); } catch (e) { toast(`Não consegui mudar o tamanho: ${e}`, 'err'); }
  };
  const show = () => invoke('show_avatar').catch(() => {});

  return (
    <div className="page">
      <Section title="OBS" desc={<>A própria janela da privada é a fonte do OBS. Os ajustes abaixo valem para a cena ativa: <b>{sc.name}</b>.</>}
        right={<div className="btns">
          <Button kind="primary" tip="Abre/traz para frente a janela do personagem" onClick={show}>🚽 Mostrar personagem</Button>
          <Button tip="Coloca a janela atrás das outras; o OBS continua capturando" onClick={() => invoke('send_to_back').catch(() => {})}>⤓ Mandar para trás (continua no OBS)</Button>
        </div>}>
        <Fields>
          <Field label="Fundo" tip="O que aparece atrás da privada na janela">
            <Select value={bg} options={[['green', 'Chroma verde (#00FF00)'], ['color', 'Cor sólida'], ['transparent', 'Transparente']]} onChange={setBg} />
            <ColorField value={sc.bgColor} fallback="#202020" disabled={bg !== 'color'} tip="Cor do fundo (modo Cor sólida)" onChange={(v) => update((d) => { d.cfg.scenes[i].bgColor = v; })} />
          </Field>
          <Field label="Tamanho da janela" tip="Resolução da janela da privada (a cena fica em modo Janela própria)">
            <Select value={size} options={sizes} onChange={setSize} />
          </Field>
        </Fields>
        {sc.mode !== 'window' && <div style={{ marginTop: 12 }}><Note kind="warn">Esta cena está no modo <b>Sobre o desktop</b>. Para capturar no OBS é melhor <b>Janela própria</b> (aba Cenas).</Note></div>}
      </Section>
      <Note kind="warn">
        <div className="big">
          ⚠ <b>Importante no OBS:</b> use <b>Captura de janela</b> com o método <b>“Windows 10 (1903 e posteriores)”</b>.
          O método <b>“Windows 7 (BitBlt)”</b> mostra a janela <b>preta</b>, porque a privada é desenhada pela placa de vídeo.
          Para fundo transparente de verdade use <b>Captura de jogo</b> com <b>“Permitir transparência”</b>.
        </div>
      </Note>
      <Section title="Como colocar no OBS">
        <ol className="steps">
          <li>Clique em <b>Mostrar personagem</b> (a janela pode ficar atrás de outras, o OBS continua capturando).</li>
          <li>No OBS: <b>Fontes → + → Captura de janela</b>, escolha a janela <b>Privada Tuber</b> e em <b>Método de captura</b> selecione <b>Windows 10 (1903 e posteriores)</b> — não use BitBlt.</li>
          <li>Com fundo <b>Chroma verde</b>: botão direito na fonte → <b>Filtros → + Chroma Key</b> (cor verde).</li>
          <li>Com fundo <b>Transparente</b>: use <b>Captura de jogo</b> com <b>Permitir transparência</b>; se aparecer preto, volte para o Chroma verde.</li>
        </ol>
      </Section>
    </div>
  );
}
