// Tiny synthesized sound effects (no audio files needed).
// Live: plays on a shared AudioContext. Offline (video): sfx.renderInto(offlineCtx, t)
// schedules the same sounds at time t inside an OfflineAudioContext.
let live;
let cur = null, OFF = 0;           // current context + time offset (offline rendering)
const ac = () => cur || (live ??= new AudioContext());
// master volume (sfx.volume 0..1): every sound goes through one gain node per context
const masters = new WeakMap();
const out = (a) => {
  let g = masters.get(a);
  if (!g) { g = a.createGain(); g.connect(a.destination); masters.set(a, g); }
  g.gain.value = Math.max(0, Math.min(1, sfx.volume ?? 1));
  return g;
};
const now = () => ac().currentTime + OFF;
const noiseCache = new WeakMap();
const noise = (a, sec) => {
  let m = noiseCache.get(a);
  if (!m) noiseCache.set(a, (m = new Map()));
  const key = Math.ceil(sec * 10);
  if (m.has(key)) return m.get(key);
  const b = a.createBuffer(1, Math.ceil(a.sampleRate * key / 10), a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  m.set(key, b);
  return b;
};
function burst({ sec, type = 'lowpass', f0, f1, q = 1, peak = 0.4, attack = 0.05, at = 0 }) {
  const a = ac(), t = now() + at;
  const src = a.createBufferSource(); src.buffer = noise(a, sec);
  const f = a.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + sec);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  src.connect(f).connect(g).connect(out(a));
  src.start(t); src.stop(t + sec + 0.05);
}
function tone(f0, f1, sec, peak = 0.2, type = 'sine', at = 0) {
  const a = ac(), t = now() + at;
  const o = a.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + sec);
  const g = a.createGain();
  g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  o.connect(g).connect(out(a)); o.start(t); o.stop(t + sec + 0.02);
}

export const sfx = {
  enabled: true,
  volume: 1,
  /**
   * Saída nativa (para a "Captura de áudio de aplicativo" do OBS): a mixagem dos efeitos vai por um
   * AudioWorklet para o processo do PrivadaTuber, que toca pelo dispositivo padrão (audio_out.rs).
   * Se algo falhar, volta a tocar pelo WebView como antes. Chamar ANTES de qualquer som.
   */
  async usarSaidaNativa({ invoke, invokeRaw }) {
    try {
      const info = await invoke('audio_info');
      if (!live) live = new AudioContext({ sampleRate: info?.sampleRate || 48000, latencyHint: 'interactive' });
      await live.audioWorklet.addModule(new URL('./captura-worklet.js', import.meta.url));
      const node = new AudioWorkletNode(live, 'captura-vaso', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
      const mudo = live.createGain(); mudo.gain.value = 0; node.connect(mudo).connect(live.destination);   // mantém o nó "puxado"
      const g = out(live);
      let falhas = 0;
      const voltar = () => { try { g.disconnect(); } catch { /* */ } g.connect(live.destination); node.port.onmessage = null; console.warn('[sfx] saída nativa falhou: tocando pelo WebView'); };
      node.port.onmessage = (e) => { invokeRaw('audio_push', new Uint8Array(e.data), { 'x-sr': String(live.sampleRate) }).then(() => { falhas = 0; }, () => { if (++falhas === 5) voltar(); }); };
      g.disconnect(); g.connect(node);
      if (live.state === 'suspended') live.resume().catch(() => {});
      return true;
    } catch (e) { console.warn('[sfx] saída nativa indisponível', e); return false; }
  },
  /** cria o AudioContext já na carga (o 1º som da live não "engasga" criando ele) */
  aquecer() { try { const a = ac(); out(a); } catch { /* */ } },
  play(name, data) {
    if (!this.enabled) return;
    try { (this[name] || (() => {}))(data); } catch { /* audio blocked until user gesture */ }
  },
  /** Schedule a sound into an OfflineAudioContext at time t (seconds). */
  renderInto(ctx, t, name, data) {
    cur = ctx; OFF = t - ctx.currentTime;
    try { (this[name] || (() => {}))(data); } finally { cur = null; OFF = 0; }
  },
  flush() {
    burst({ sec: 3.6, f0: 250, f1: 900, q: 0.7, peak: 0.35, attack: 1.2 });
    tone(180, 60, 0.6, 0.25, 'sine', 1.4);
  },
  splash() { burst({ sec: 1.6, type: 'bandpass', f0: 1800, f1: 500, q: 0.8, peak: 0.45, attack: 0.03 }); },
  drip() { tone(900 + Math.random() * 600, 300, 0.08, 0.05); },
  paper() { burst({ sec: 2.3, type: 'highpass', f0: 2500, f1: 1200, q: 0.5, peak: 0.12, attack: 0.1 }); },
  rip() { burst({ sec: 0.35, type: 'bandpass', f0: 3000, f1: 1500, q: 1.5, peak: 0.35, attack: 0.01 }); },
  whoosh() { burst({ sec: 0.6, type: 'bandpass', f0: 400, f1: 2200, q: 0.9, peak: 0.25, attack: 0.15 }); },
  gargle() {
    for (let i = 0; i < 9; i++) tone(220 + Math.random() * 180, 120, 0.12, 0.12, 'sine', i * 0.19);
    burst({ sec: 2, type: 'bandpass', f0: 600, f1: 300, q: 2, peak: 0.12, attack: 0.2 });
  },
  /** gole (o vaso engolindo o cenário) */
  gole() { tone(260, 70, 0.28, 0.32, 'sine'); burst({ sec: 0.35, type: 'bandpass', f0: 700, f1: 200, q: 1.2, peak: 0.18, attack: 0.02 }); tone(140, 90, 0.12, 0.15, 'triangle', 0.32); },
  boing() { tone(200, 520, 0.35, 0.2, 'triangle'); },
  // ---- cenários 3D (eventos, pausa, transições) ----
  zumbido() { for (let k = 0; k < 6; k++) tone(120, 118, 0.12, 0.05, 'sawtooth', k * 0.18 + Math.random() * 0.08); burst({ sec: 0.15, type: 'highpass', f0: 4000, f1: 3000, q: 1, peak: 0.1, attack: 0.005, at: 0.3 }); },
  toc(d) { tone(700 + Math.random() * 300, 300, 0.06, 0.12 * (d?.v ?? 1), 'triangle'); },
  bonk() { tone(420, 140, 0.18, 0.35, 'sine'); burst({ sec: 0.12, type: 'lowpass', f0: 1400, f1: 300, q: 0.8, peak: 0.25, attack: 0.003 }); tone(900, 1400, 0.25, 0.06, 'sine', 0.12); },
  gaivota() { for (let k = 0; k < 3; k++) { tone(1500, 1100, 0.16, 0.08, 'sawtooth', k * 0.28); tone(1250, 900, 0.12, 0.05, 'triangle', k * 0.28 + 0.06); } },
  onda() { burst({ sec: 2.6, type: 'lowpass', f0: 300, f1: 1400, q: 0.5, peak: 0.25, attack: 1.1 }); burst({ sec: 1.6, type: 'highpass', f0: 2500, f1: 1200, q: 0.4, peak: 0.08, attack: 0.6, at: 1.0 }); },
  vento() { burst({ sec: 3.5, type: 'bandpass', f0: 300, f1: 900, q: 1.6, peak: 0.16, attack: 1.2 }); },
  porta() { tone(90, 50, 0.25, 0.4, 'square'); burst({ sec: 0.25, type: 'lowpass', f0: 1200, f1: 150, q: 0.7, peak: 0.35, attack: 0.003 }); },
  sirene() { for (let k = 0; k < 4; k++) { tone(600, 1100, 0.7, 0.09, 'sawtooth', k * 1.4); tone(1100, 600, 0.7, 0.09, 'sawtooth', k * 1.4 + 0.7); } },
  metal() { for (let k = 0; k < 3; k++) { tone(320, 300, 0.4, 0.15, 'square', k * 0.35); tone(1810, 1750, 0.5, 0.05, 'sine', k * 0.35); burst({ sec: 0.1, type: 'highpass', f0: 3000, f1: 2000, peak: 0.15, attack: 0.002, at: k * 0.35 }); } },
  rato() { for (let k = 0; k < 4; k++) tone(3200, 2600, 0.06, 0.05, 'sine', k * 0.11 + Math.random() * 0.05); },
  torcida() { burst({ sec: 3.2, type: 'bandpass', f0: 800, f1: 1100, q: 0.4, peak: 0.3, attack: 0.25 }); for (let k = 0; k < 3; k++) tone(330, 260, 0.6, 0.05, 'sawtooth', 0.2 + k * 0.5); },
  vidro() { for (let k = 0; k < 7; k++) tone(2500 + Math.random() * 3000, 1500 + Math.random() * 800, 0.15 + Math.random() * 0.2, 0.06, 'sine', Math.random() * 0.15); burst({ sec: 0.4, type: 'highpass', f0: 5000, f1: 2500, peak: 0.2, attack: 0.003 }); },
  ronco() { burst({ sec: 1.4, type: 'lowpass', f0: 160, f1: 260, q: 2, peak: 0.12, attack: 0.6 }); tone(70, 60, 1.2, 0.05, 'sawtooth', 0.15); },
  arroto() { const a = ac(), t = now(); const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(95, t); o.frequency.linearRampToValueAtTime(70, t + 0.9);
    const l = a.createOscillator(); l.frequency.value = 23; const lg = a.createGain(); lg.gain.value = 18; l.connect(lg).connect(o.frequency);
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(f).connect(g).connect(out(a)); o.start(t); l.start(t); o.stop(t + 1.05); l.stop(t + 1.05); },
  rolo() { burst({ sec: 1.2, type: 'bandpass', f0: 1800, f1: 2600, q: 1.2, peak: 0.12, attack: 0.05 }); for (let k = 0; k < 10; k++) tone(900, 800, 0.03, 0.03, 'square', k * 0.11); },
  clack(d) { tone(140, 60, 0.07, Math.min(0.3, (d?.v ?? 3) * 0.04), 'square'); },
  pop() { tone(500, 900, 0.08, 0.12, 'sine'); },
  // a prop hitting the floor / the toilet / another prop: d.v = impact speed (m/s), louder when harder
  thud(d) {
    const v = Math.max(0, Math.min(1, (d?.v ?? 1) / 3));
    tone(130 + 40 * v, 48, 0.16, 0.04 + 0.26 * v, 'sine');
    burst({ sec: 0.12, type: 'lowpass', f0: 900, f1: 160, q: 0.7, peak: 0.03 + 0.2 * v, attack: 0.004 });
  },
};
