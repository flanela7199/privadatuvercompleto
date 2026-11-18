import React from 'react';
import { useStore, live, useLiveTick } from '../state/config';
import { invoke, emit, isTauri } from '../lib/bridge';
import { CHANNELS, loadMic } from '../lib/legacy';
import { VISEMES } from '../lib/catalog';
import { Section, Field, Fields } from '../components/Section';
import { Button } from '../components/Button';
import { Select } from '../components/Select';
import { Slider } from '../components/Slider';
import { Toggle } from '../components/Toggle';
import { useToast } from '../components/Toast';

const LABELS: Record<string, string> = { level: 'Volume', open: 'Abrir', round: 'Redondo', wide: 'Largo', closed: 'Fechado', sib: 'Chiado' };

// browser fallback mic: runs the WebAudio analyzer in the panel and broadcasts `mouth`
let browserMic: any = null;
let micEnabled = true; // read by the browser-mic loop (kept current on every render)

function Meters() {
  useLiveTick();
  return (
    <div className="meters">
      {['level', ...(CHANNELS as string[])].map((k) => {
        const v = Math.max(0, Math.min(1, live.mouth[k] || 0));
        return (
          <React.Fragment key={k}>
            <span>{LABELS[k]}</span>
            <div className="meter"><div style={{ width: `${v * 100}%` }} /></div>
            <span className="mut">{v.toFixed(2)}</span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function Microfone() {
  const { s, update, runAction } = useStore();
  const toast = useToast();
  const a = s.cfg.audio;
  micEnabled = a.enabled;
  const [devs, setDevs] = React.useState<string[] | null>(null);
  const [bm, setBm] = React.useState(!!browserMic);
  React.useEffect(() => { invoke('audio_devices').then((d: any) => setDevs(d || [])).catch(() => setDevs([])); }, []);

  const set = (k: string, v: any) => {
    update((d) => { d.cfg.audio[k] = v; });
    const next = { ...a, [k]: v };
    invoke('set_audio', { audio: next }).catch(() => {});
    if (browserMic) Object.assign(browserMic, { gateDb: next.gateDb, rangeDb: next.rangeDb, hold: next.hold });
  };
  const toggleBrowserMic = async () => {
    if (browserMic) { browserMic.stop(); browserMic = null; setBm(false); return; }
    const Mic = await loadMic();
    const m = new Mic();
    Object.assign(m, { gateDb: a.gateDb, rangeDb: a.rangeDb, hold: a.hold });
    try { await m.start(); } catch (err: any) { toast(`Microfone indisponível: ${err.message}`, 'err'); return; }
    browserMic = m; setBm(true);
    let last = performance.now();
    const tick = () => {
      if (browserMic !== m) return;
      const now = performance.now();
      const v = m.update((now - last) / 1000); last = now;
      const out = micEnabled ? { ...v, level: m.level } : { open: 0, round: 0, wide: 0, closed: 0, sib: 0, level: m.level };
      emit('mouth', out);
      setTimeout(tick, 16);
    };
    tick();
  };

  return (
    <div className="page">
      <Section title="Microfone" desc="A boca abre e muda de forma com a sua voz (vogais e consoantes).">
        <Fields>
          <Field label="Microfone ligado">
            <Toggle checked={a.enabled} onChange={(v) => set('enabled', v)} />
            {!isTauri && <Button size="sm" kind={bm ? 'primary' : 'secondary'} onClick={toggleBrowserMic}>{bm ? '■ Parar mic do navegador' : '🎤 Usar mic do navegador'}</Button>}
          </Field>
          <Field label="Dispositivo">
            <Select value={a.device || ''} options={devs ? [['', 'Padrão do sistema'], ...devs.map((d) => [d, d] as [string, string])] : [['', 'carregando…']]} onChange={(v) => set('device', v || null)} />
          </Field>
          <Field label="Silêncio abaixo de" tip="Ruído abaixo deste volume não mexe a boca. Suba se a boca mexe sozinha."><Slider value={a.gateDb} min={-80} max={-20} step={1} fmt="db" onChange={(v) => set('gateDb', v)} /></Field>
          <Field label="Faixa até boca aberta" tip="Menor = abre mais fácil."><Slider value={a.rangeDb} min={10} max={50} step={1} fmt="db" onChange={(v) => set('rangeDb', v)} /></Field>
          <Field label="Segurar entre sílabas" tip="Quanto tempo a boca fica aberta nas consoantes."><Slider value={a.hold} min={0} max={0.5} step={0.01} fmt="s" onChange={(v) => set('hold', v)} /></Field>
        </Fields>
      </Section>
      <Section title="Nível e forma da boca"><Meters /></Section>
      <Section title="Testar formas da boca" desc="Mostra cada forma na privada.">
        <div className="btns vis-btns">{VISEMES.map((v) => <Button key={v} onClick={() => runAction(`viseme:${v}`)}>{v}</Button>)}</div>
      </Section>
    </div>
  );
}
