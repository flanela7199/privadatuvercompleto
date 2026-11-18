// Mouth shapes ("visemes") and the drivers that produce them.
// A mouth state is a small vector, every channel 0..1:
//   open   - jaw/lid opening (A is the widest)
//   round  - lips rounded/pushed out (O, U)
//   wide   - lips stretched sideways (E, I, S)
//   closed - lips pressed together (M, B, P) / lower lip up (F, V)
//   sib    - sibilant/consonant hiss (S, X, CH): small, tense opening
// Optional extra channels (default 0; the rig mirrors them in Rust, privada_core::rig::Mouth):
//   cornerL / cornerR - mouth corners, -1 (down, frown) .. 1 (up, smile); L = the character's
//                       -x side (the same side as eye_L), works with the mouth open or closed
//   jawSide    - -1..1: jaw (lid + seat) yaws to that side and the lips purse toward it
//   jawFwd     - 0..1: jaw pushed forward
//   upperRaise - 0..1: upper lip (lid front) lifts
// The rig turns this vector into lid (upper lip) + seat (lower lip) poses and blend shapes.

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
export const EXT_CHANNELS = ['cornerL', 'cornerR', 'jawSide', 'jawFwd', 'upperRaise'];
export const ALL_CHANNELS = [...CHANNELS, ...EXT_CHANNELS];
export const zeroMouth = () => ({ open: 0, round: 0, wide: 0, closed: 0, sib: 0, cornerL: 0, cornerR: 0, jawSide: 0, jawFwd: 0, upperRaise: 0 });

/**
 * The 15 standard vtuber visemes (+ rest) -> channel values. Mirror of
 * privada_core::rig::STANDARD_VISEMES (keep both in sync; the parity check compares them).
 */
export const STANDARD_VISEMES = {
  rest: {},
  AA: { open: 1, wide: 0.1 },
  AH: { open: 0.75, wide: 0.2, upperRaise: 0.1 },
  AO: { open: 0.8, round: 0.5, jawFwd: 0.1 },
  AW_OW: { open: 0.6, round: 0.85, jawFwd: 0.2 },
  CH_J_SH: { open: 0.25, round: 0.5, sib: 0.8, jawFwd: 0.4, upperRaise: 0.3 },
  EH_AE: { open: 0.55, wide: 0.7, cornerL: 0.1, cornerR: 0.1, upperRaise: 0.1 },
  EY: { open: 0.45, wide: 0.85, cornerL: 0.15, cornerR: 0.15 },
  FV: { open: 0.08, wide: 0.3, closed: 0.6, upperRaise: 0.4 },
  IH_AY: { open: 0.35, wide: 0.8, cornerL: 0.1, cornerR: 0.1 },
  L: { open: 0.4, wide: 0.3, upperRaise: 0.15 },
  M_P_B: { closed: 1 },
  N_NG_DH: { open: 0.25, wide: 0.35, sib: 0.2 },
  OY_UH_UW: { open: 0.3, round: 1, jawFwd: 0.3 },
  R_ER: { open: 0.3, round: 0.55, wide: 0.1, jawFwd: 0.1 },
  W: { open: 0.15, round: 1, jawFwd: 0.4 },
  Y_IY: { open: 0.25, wide: 1, cornerL: 0.2, cornerR: 0.2 },
};
// every standard viseme is also a VISEMES entry (hold('AA'), viseme:<name> actions)
for (const [k, v] of Object.entries(STANDARD_VISEMES)) if (!(k in VISEMES)) VISEMES[k] = v;

/** full mouth vector (all channels) of a viseme name, or null */
export function visemeMouth(name) {
  const v = VISEMES[name];
  return v ? { ...zeroMouth(), ...v } : null;
}

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
    for (const k of ALL_CHANNELS) out[k] = shape[k] || 0;
    return out;
  }
}

/** Blend helper: max of several mouth vectors (signed extra channels: the largest magnitude wins). */
export function maxMouth(...ms) {
  const out = zeroMouth();
  for (const m of ms) {
    if (!m) continue;
    for (const k of CHANNELS) out[k] = Math.max(out[k], m[k] || 0);
    for (const k of EXT_CHANNELS) if (Math.abs(m[k] || 0) > Math.abs(out[k])) out[k] = m[k];
  }
  return out;
}
