// Tiny synthesized sound effects (no audio files needed).
// Live: plays on a shared AudioContext. Offline (video): sfx.renderInto(offlineCtx, t)
// schedules the same sounds at time t inside an OfflineAudioContext.
let live;
let cur = null, OFF = 0;           // current context + time offset (offline rendering)
const ac = () => cur || (live ??= new AudioContext());
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
  src.connect(f).connect(g).connect(a.destination);
  src.start(t); src.stop(t + sec + 0.05);
}
function tone(f0, f1, sec, peak = 0.2, type = 'sine', at = 0) {
  const a = ac(), t = now() + at;
  const o = a.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + sec);
  const g = a.createGain();
  g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + sec + 0.02);
}

export const sfx = {
  enabled: true,
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
  boing() { tone(200, 520, 0.35, 0.2, 'triangle'); },
  clack(d) { tone(140, 60, 0.07, Math.min(0.3, (d?.v ?? 3) * 0.04), 'square'); },
  pop() { tone(500, 900, 0.08, 0.12, 'sine'); },
};
