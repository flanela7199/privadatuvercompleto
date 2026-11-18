// Mouth shapes ("visemes") and the drivers that produce them.
// A mouth state is a small vector, every channel 0..1:
//   open   - jaw/lid opening (A is the widest)
//   round  - lips rounded/pushed out (O, U)
//   wide   - lips stretched sideways (E, I, S)
//   closed - lips pressed together (M, B, P) / lower lip up (F, V)
//   sib    - sibilant/consonant hiss (S, X, CH): small, tense opening
// The rig turns this vector into lid (upper lip) + seat (lower lip) poses.

export const VISEMES = {
  rest: {},
  A: { open: 1, wide: 0.15 },
  E: { open: 0.5, wide: 0.9 },
  I: { open: 0.3, wide: 1 },
  O: { open: 0.65, round: 1 },
  U: { open: 0.3, round: 1 },
  M: { closed: 1 },
  F: { open: 0.12, closed: 0.6, wide: 0.3 },
  S: { open: 0.18, wide: 0.6, sib: 1 },
  L: { open: 0.4, wide: 0.3 },
};
export const CHANNELS = ['open', 'round', 'wide', 'closed', 'sib'];
export const zeroMouth = () => ({ open: 0, round: 0, wide: 0, closed: 0, sib: 0 });

/** Portuguese-ish letters -> visemes (good enough for a talking toilet). */
const LETTER = {
  a: 'A', á: 'A', à: 'A', â: 'A', ã: 'A', e: 'E', é: 'E', ê: 'E', i: 'I', í: 'I', y: 'I',
  o: 'O', ó: 'O', ô: 'O', õ: 'O', u: 'U', ú: 'U', w: 'U',
  m: 'M', b: 'M', p: 'M', f: 'F', v: 'F',
  s: 'S', z: 'S', x: 'S', c: 'S', ç: 'S', j: 'S', g: 'S', t: 'S', d: 'S', k: 'S', q: 'S', h: 'S',
  l: 'L', n: 'L', r: 'L',
};
export function textToVisemes(text) {
  const out = [];
  for (const ch of text.toLowerCase()) {
    if (ch === ' ' || ch === ',') { out.push(['rest', ch === ',' ? 0.22 : 0.07]); continue; }
    if (ch === '.' || ch === '!' || ch === '?') { out.push(['rest', 0.35]); continue; }
    const v = LETTER[ch];
    if (v) out.push([v, 'AEIOU'.includes(v) ? 0.13 : 0.07]);
  }
  out.push(['rest', 0.2]);
  return out;
}

/** Plays a viseme sequence (from text or a single test shape). */
export class FakeTalk {
  constructor() { this.seq = []; this.t = 0; this.i = 0; this.cur = zeroMouth(); }
  say(text) { this.seq = textToVisemes(text); this.i = 0; this.t = 0; }
  hold(viseme, sec = 0.7) { this.seq = [[viseme, sec], ['rest', 0.15]]; this.i = 0; this.t = 0; }
  get active() { return this.i < this.seq.length; }
  update(dt) {
    const out = zeroMouth();
    if (!this.active) return out;
    this.t += dt;
    while (this.active && this.t > this.seq[this.i][1]) { this.t -= this.seq[this.i][1]; this.i++; }
    if (!this.active) return out;
    const shape = VISEMES[this.seq[this.i][0]];
    for (const k of CHANNELS) out[k] = shape[k] || 0;
    return out;
  }
}

/** Blend helper: max of several mouth vectors. */
export function maxMouth(...ms) {
  const out = zeroMouth();
  for (const m of ms) if (m) for (const k of CHANNELS) out[k] = Math.max(out[k], m[k] || 0);
  return out;
}
