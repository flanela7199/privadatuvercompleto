// Microphone -> mouth vector {open, round, wide, closed, sib} (see visemes.js).
// Loudness opens the mouth; the spectrum picks the shape:
//   F1 band (300-1000 Hz) heavy -> open vowel (A)
//   F2 band (1000-2600 Hz) vs F1 -> front vowels E/I (wide) vs back vowels O/U (round)
//   3.5-8 kHz hiss -> sibilant consonant (S, X, CH, T)
//   only low hum (80-300 Hz) -> nasal M/N: lips closed
// A short hold keeps the mouth open between syllables (consonants), then it relaxes.
// Loudness: AUTO-LEVEL (default) tracks the speaker's peak (attack 50 ms, release 4 s, only while
// voice) and the noise floor (fast down, slow up) and maps
//   x = (db - floor - 6) / max(12, peak - floor - 6), loud = softKnee(x)
// so normal speech sits ~0.5-0.7 and only shouting reaches 1; manual mode: (db - gate) / range.
// gainDb is applied first; gateDb is an absolute floor. Identical to crates/privada-core/src/dsp.rs.
import { zeroMouth, CHANNELS } from './visemes.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const AGC = { margin: 6, minSpan: 12, attack: 0.05, release: 4, voiceAboveFloor: 10, initPeak: -20, initFloor: -70 };
const knee = (x) => clamp01(0.68 * x + 1.6 * Math.max(0, x - 1));

export class Mic {
  constructor() {
    this.gateDb = -50;   // below this: always silence (-90..0)
    this.rangeDb = 28;   // manual mode: gate + range = fully loud (10..60)
    this.gainDb = 0;     // input gain (-30..+20)
    this.autoLevel = true;
    this.peakDb = AGC.initPeak;
    this.floorDb = AGC.initFloor;
    this.hold = 0.14;    // seconds the shape is held after the voice drops (consonants)
    this.level = 0;
    this.db = -100;
    this.on = false;
    this.mouth = zeroMouth();
    this.silentFor = 1;
  }
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = 2048;
    this.an.smoothingTimeConstant = 0.45;
    src.connect(this.an);
    this.buf = new Float32Array(this.an.fftSize);
    this.fbuf = new Float32Array(this.an.frequencyBinCount);
    this.on = true;
  }
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.on = false; this.level = 0; this.mouth = zeroMouth();
    this.peakDb = AGC.initPeak; this.floorDb = AGC.initFloor;
  }
  band(lo, hi) {
    const hz = this.ctx.sampleRate / this.an.fftSize;
    let s = 0;
    for (let i = Math.floor(lo / hz); i <= Math.min(this.fbuf.length - 1, Math.ceil(hi / hz)); i++) s += 10 ** (this.fbuf[i] / 10);
    return s;
  }
  /** Returns the smoothed mouth vector. `level` (0..1 loudness) is kept for the meter. */
  update(dt) {
    if (!this.on) return this.mouth;
    this.an.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (const v of this.buf) s += v * v;
    const gate = Math.min(0, Math.max(-90, this.gateDb));
    const range = Math.min(60, Math.max(10, this.rangeDb));
    const gain = Math.min(20, Math.max(-30, this.gainDb));
    const db = (this.db = 10 * Math.log10(s / this.buf.length + 1e-12) + gain);
    // noise floor: quickly down, slowly (1.5 dB/s) up
    if (db < this.floorDb) this.floorDb += (db - this.floorDb) * Math.min(1, dt * 4);
    else this.floorDb = Math.min(db, this.floorDb + 1.5 * dt);
    this.floorDb = Math.max(-100, this.floorDb);
    const voice = db > gate && db > this.floorDb + AGC.voiceAboveFloor;
    if (voice) {
      const tau = db > this.peakDb ? AGC.attack : AGC.release;
      this.peakDb += (db - this.peakDb) * Math.min(1, dt / tau);
    }
    let loud;
    if (db <= gate) loud = 0;
    else if (this.autoLevel) {
      const base = this.floorDb + AGC.margin;
      loud = knee((db - base) / Math.max(AGC.minSpan, this.peakDb - base));
    } else loud = clamp01((db - gate) / range);
    this.level += (loud - this.level) * Math.min(1, dt * (loud > this.level ? 30 : 10));

    const target = zeroMouth();
    if (loud > 0.02) {
      this.silentFor = 0;
      this.an.getFloatFrequencyData(this.fbuf);
      const low = this.band(80, 300), f1 = this.band(300, 1000), f2 = this.band(1000, 2600), hiss = this.band(3500, 8000);
      const tot = low + f1 + f2 + hiss + 1e-12;
      const front = f2 / (f1 + f2 + 1e-12);   // ~0.2 for O/U, ~0.6+ for E/I
      const sib = clamp01((hiss / tot - 0.18) / 0.35);
      const nasal = clamp01((low / tot - 0.7) / 0.2) * (1 - sib);
      const voiced = 1 - sib;
      target.open = loud * clamp01(0.35 + (f1 / tot) * 1.6) * voiced * (1 - nasal);
      target.round = loud * clamp01((0.42 - front) / 0.25) * voiced * (1 - nasal);
      target.wide = loud * (clamp01((front - 0.42) / 0.25) * voiced + 0.6 * sib);
      target.sib = loud * sib;
      target.closed = loud * nasal;
      if (sib > 0.3) target.open = Math.max(target.open, 0.15 * loud);
    } else this.silentFor += dt;

    // attack fast; hold the last shape briefly (consonant gaps), then release
    const holding = this.silentFor > 0 && this.silentFor < this.hold;
    for (const k of CHANNELS) {
      const cur = this.mouth[k], tg = target[k];
      if (holding) continue;
      const rate = tg > cur ? 28 : 7;
      this.mouth[k] = cur + (tg - cur) * Math.min(1, dt * rate);
    }
    // same extra fields as the Rust `mouth` event (panel meter)
    Object.assign(this.mouth, { level: this.level, db: this.db, peakDb: this.peakDb, floorDb: this.floorDb });
    return this.mouth;
  }
}
