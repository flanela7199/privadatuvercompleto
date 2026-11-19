import React from 'react';
import { useStore, live, useLiveTick } from '../state/config';
import { invoke, emit, isTauri } from '../lib/bridge';
import { CHANNELS, loadMic } from '../lib/legacy';
import { STANDARD_VISEME_LIST, shapeOpen } from '../lib/catalog';
import { Section, Field, Fields, Note } from '../components/Section';
import { Button } from '../components/Button';
import { Select } from '../components/Select';
import { Slider } from '../components/Slider';
import { Toggle } from '../components/Toggle';
import { useToast } from '../components/Toast';

const LABELS: Record<string, string> = { level: 'Volume', open: 'Abrir', round: 'Redondo', wide: 'Largo', closed: 'Fechado', sib: 'Chiado' };

// browser fallback mic: runs the WebAudio analyzer in the panel and broadcasts `mouth`
let browserMic: any = null;
let micEnabled = true; // read by the browser-mic loop (kept current on every render)

/** live input level on a −80..0 dB scale with the gate, learned noise floor and voice peak markers */
function DbMeter({ gateDb }: { gateDb: number }) {
  useLiveTick();
  const m: any = live.mouth;
  const pos = (db: number) => `${Math.max(0, Math.min(1, (db + 80) / 80)) * 100}%`;
  const has = (v: any) => typeof v === 'number' && Number.isFinite(v);
  return (
    <div className="dbm">
      <div className="dbm-track">
        {has(m.db) && <div className="dbm-fill" style={{ width: pos(m.db) }} />}
        <div className="dbm-mark gate" style={{ left: pos(gateDb) }} title={`Silêncio: ${gateDb} dB`} />
        {has(m.floorDb) && <div className="dbm-mark floor" style={{ left: pos(m.floorDb) }} title={`Ruído da sala: ${m.floorDb.toFixed(0)} dB`} />}
        {has(m.peakDb) && <div className="dbm-mark peak" style={{ left: pos(m.peakDb) }} title={`Pico da sua voz: ${m.peakDb.toFixed(0)} dB`} />}
      </div>
      <div className="dbm-legend">
        <span><b>{has(m.db) ? `${m.db.toFixed(0)} dB` : '— dB'}</b> agora</span>
        <span><i className="sw gate" /> silêncio {gateDb} dB</span>
        <span><i className="sw floor" /> ruído {has(m.floorDb) ? `${m.floorDb.toFixed(0)} dB` : '—'}</span>
        <span><i className="sw peak" /> pico da voz {has(m.peakDb) ? `${m.peakDb.toFixed(0)} dB` : '—'}</span>
      </div>
    </div>
  );
}

function Meters({ mouth }: { mouth: { maxOpen: number; curve: number } }) {
  useLiveTick();
  const shaped = shapeOpen(live.mouth.open || 0, mouth);
  return (
    <div className="meters">
      <span>Boca final</span>
      <div className="meter" title="Abertura que vai para a privada (depois do limite e da curva)"><div style={{ width: `${shaped * 100}%`, background: 'var(--acc)' }} /></div>
      <span className="mouth-out">{shaped.toFixed(2)}</span>
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

/** "Abertura máxima da boca" + "Curva" (shared with Configurações > Personagem) */
export function MouthLimits() {
  const { s, update } = useStore();
  const m = s.cfg.settings.mouth;
  const set = (k: 'maxOpen' | 'curve', v: number) => update((d) => { d.cfg.settings.mouth = { ...d.cfg.settings.mouth, [k]: v }; });
  return (
    <Fields>
      <Field label="Abertura máxima da boca" tip="1 = abre tudo. Menor = a tampa nunca abre demais."><Slider value={m.maxOpen} min={0.2} max={1} step={0.01} fmt="pct" onChange={(v) => set('maxOpen', v)} /></Field>
      <Field label="Curva (fala baixa abre menos)" tip="1 = linear. Maior = falar baixinho quase não abre; gritar abre tudo."><Slider value={m.curve} min={1} max={3} step={0.05} fmt="n2" onChange={(v) => set('curve', v)} /></Field>
    </Fields>
  );
}

export function Microfone() {
  const { s, update, runAction } = useStore();
  const toast = useToast();
  const a = s.cfg.audio;
  micEnabled = a.enabled;
  const [devs, setDevs] = React.useState<string[] | null>(null);
  const [bm, setBm] = React.useState(!!browserMic);
  // smile test: held while the toggles are on; re-sent as a heartbeat, cleared on leave
  const [smile, setSmile] = React.useState({ cornerL: false, cornerR: false });
  React.useEffect(() => {
    const send = () => emit('mouth-test', { cornerL: smile.cornerL ? 1 : 0, cornerR: smile.cornerR ? 1 : 0 });
    send();
    const on = smile.cornerL || smile.cornerR;
    const iv = on ? setInterval(send, 1000) : 0;
    return () => { if (iv) clearInterval(iv); if (on) emit('mouth-test', { cornerL: 0, cornerR: 0 }); };
  }, [smile]);
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
          <Field label="Nivelamento automático (recomendado p/ quem fala alto)" tip="Aprende o volume da sua voz e o ruído da sala e ajusta a abertura sozinho.">
            <Toggle checked={a.autoLevel !== false} onChange={(v) => set('autoLevel', v)} />
          </Field>
          <Field label="Ganho / Sensibilidade" tip="Aumenta ou diminui o volume do microfone antes de tudo. Negativo = menos sensível."><Slider value={a.gainDb ?? 0} min={-30} max={20} step={1} fmt="dbs" onChange={(v) => set('gainDb', v)} /></Field>
          <Field label="Silêncio abaixo de" tip="Ruído abaixo deste volume não mexe a boca. Suba se a boca mexe sozinha."><Slider value={a.gateDb} min={-80} max={0} step={1} fmt="db" onChange={(v) => set('gateDb', v)} /></Field>
          <Field label="Faixa até boca aberta" tip={a.autoLevel !== false ? 'Com o nivelamento automático ligado a faixa é aprendida sozinha.' : 'Menor = abre mais fácil.'}>
            <Slider value={a.rangeDb} min={10} max={60} step={1} fmt="db" disabled={a.autoLevel !== false} onChange={(v) => set('rangeDb', v)} />
          </Field>
          <Field label="Segurar entre sílabas" tip="Quanto tempo a boca fica aberta nas consoantes."><Slider value={a.hold} min={0} max={0.5} step={0.01} fmt="s" onChange={(v) => set('hold', v)} /></Field>
        </Fields>
      </Section>
      <Section title="Limites da boca" desc="Controla quanto a tampa abre com a sua voz.">
        <MouthLimits />
      </Section>
      <Section title="Nível e forma da boca">
        <DbMeter gateDb={a.gateDb} />
        <div style={{ marginTop: 12 }}><Meters mouth={s.cfg.settings.mouth} /></div>
        <div style={{ marginTop: 12 }}><Note>💡 Se a boca abre demais: ligue o <b>nivelamento automático</b> ou baixe o <b>ganho</b>.</Note></div>
      </Section>
      <Section title="Testar formas da boca" desc="Os visemas padrão — clique para a privada fazer a forma.">
        <div className="vis-grid">
          {STANDARD_VISEME_LIST.map(([v, hint]) => (
            <Button key={v} size="sm" tip={hint} onClick={() => runAction(`viseme:${v}`)}><b>{v.replace(/_/g, ' ')}</b><span className="mut">{hint}</span></Button>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <Fields>
            <Field label="Sorriso esquerdo" tip="Teste: levanta o canto esquerdo da boca (cornerL)"><Toggle checked={smile.cornerL} onChange={(v) => setSmile({ ...smile, cornerL: v })} /></Field>
            <Field label="Sorriso direito" tip="Teste: levanta o canto direito da boca (cornerR)"><Toggle checked={smile.cornerR} onChange={(v) => setSmile({ ...smile, cornerR: v })} /></Field>
          </Fields>
        </div>
      </Section>
    </div>
  );
}
