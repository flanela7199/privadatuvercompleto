//! Microphone -> mouth vector {open, round, wide, closed, sib} (+ level), an exact port of
//! `web/src/input/mic.js` (which used a WebAudio AnalyserNode: fftSize 2048,
//! smoothingTimeConstant 0.45, Blackman window, magnitudes / N).
//!
//! Loudness opens the mouth; the spectrum picks the shape:
//!   F1 band (300-1000 Hz) heavy -> open vowel (A)
//!   F2 band (1000-2600 Hz) vs F1 -> front vowels E/I (wide) vs back vowels O/U (round)
//!   3.5-8 kHz hiss -> sibilant consonant (S, X, CH, T)
//!   only low hum (80-300 Hz) -> nasal M/N: lips closed
//! A short hold keeps the mouth open between syllables (consonants), then it relaxes.
//!
//! Loudness (how far the mouth opens) - two modes:
//!   * AUTO-LEVEL (default): tracks the speaker's own peak (attack ~50 ms, release ~4 s, only while
//!     voice is detected) and the room noise floor (fast down, slow up), then
//!     x = (db - floor - margin) / max(12 dB, peak - floor - margin) with a soft knee, so normal
//!     speech lands around 0.5-0.7 and only shouting above the usual peak reaches 1. A loud, close
//!     mic no longer pins the mouth fully open.
//!   * manual: loud = (db - gate) / range (the original mic.js behaviour).
//! `gain_db` is applied to the measured level first; `gate_db` is always an absolute floor.
//!
//! Dependency-free (own radix-2 FFT) so it builds everywhere, including wasm.

pub const FFT_SIZE: usize = 2048;
const SMOOTHING: f32 = 0.45;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Mouth {
    pub open: f32,
    pub round: f32,
    pub wide: f32,
    pub closed: f32,
    pub sib: f32,
    /// smoothed loudness 0..1 (for meters)
    pub level: f32,
    /// current level in dB (after gain), and the auto-level trackers (for the panel meter)
    pub db: f32,
    pub peak_db: f32,
    pub floor_db: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct MouthParams {
    /// below this: always silence (dB, -90..0)
    pub gate_db: f32,
    /// manual mode: gate + range = fully loud (dB, 10..60)
    pub range_db: f32,
    /// seconds the shape is held after the voice drops (consonants)
    pub hold: f32,
    /// input gain applied to the measured level (dB, -30..+20)
    pub gain_db: f32,
    /// adapt to the speaker's own loudness (recommended)
    pub auto_level: bool,
}

impl Default for MouthParams {
    fn default() -> Self {
        Self { gate_db: -50.0, range_db: 28.0, hold: 0.14, gain_db: 0.0, auto_level: true }
    }
}

impl MouthParams {
    /// clamp user values to the supported ranges
    pub fn sanitized(mut self) -> Self {
        self.gate_db = self.gate_db.clamp(-90.0, 0.0);
        self.range_db = self.range_db.clamp(10.0, 60.0);
        self.hold = self.hold.clamp(0.0, 1.0);
        self.gain_db = self.gain_db.clamp(-30.0, 20.0);
        self
    }
}

#[inline]
fn clamp01(x: f32) -> f32 {
    x.clamp(0.0, 1.0)
}

/// Streaming analyzer: push samples (mono, any rate), call `update(dt)` once per frame.
pub struct MouthAnalyzer {
    pub params: MouthParams,
    sample_rate: f32,
    ring: Vec<f32>,
    pos: usize,
    filled: usize,
    window: Vec<f32>,
    re: Vec<f32>,
    im: Vec<f32>,
    smooth_mag: Vec<f32>,
    power: Vec<f32>,
    pub db: f32,
    level: f32,
    mouth: Mouth,
    silent_for: f32,
    /// auto-level trackers (dB)
    peak_db: f32,
    floor_db: f32,
}

/// auto-level tuning
const AGC_MARGIN_DB: f32 = 6.0;
const AGC_MIN_SPAN_DB: f32 = 12.0;
const AGC_ATTACK_S: f32 = 0.05;
const AGC_RELEASE_S: f32 = 4.0;
const AGC_VOICE_ABOVE_FLOOR_DB: f32 = 10.0;
const INIT_PEAK_DB: f32 = -20.0;
const INIT_FLOOR_DB: f32 = -70.0;

/// soft knee: the usual speaking peak (x = 1) -> 0.68, only ~20 % above it saturates
#[inline]
fn knee(x: f32) -> f32 {
    clamp01(0.68 * x + 1.6 * (x - 1.0).max(0.0))
}

impl MouthAnalyzer {
    pub fn new(sample_rate: f32) -> Self {
        // WebAudio Blackman window (alpha = 0.16)
        let n = FFT_SIZE as f32;
        let a0 = 0.42;
        let a1 = 0.5;
        let a2 = 0.08;
        let window = (0..FFT_SIZE)
            .map(|i| {
                let x = i as f32 / n;
                a0 - a1 * (2.0 * std::f32::consts::PI * x).cos() + a2 * (4.0 * std::f32::consts::PI * x).cos()
            })
            .collect();
        Self {
            params: MouthParams::default(),
            sample_rate,
            ring: vec![0.0; FFT_SIZE],
            pos: 0,
            filled: 0,
            window,
            re: vec![0.0; FFT_SIZE],
            im: vec![0.0; FFT_SIZE],
            smooth_mag: vec![0.0; FFT_SIZE / 2],
            power: vec![0.0; FFT_SIZE / 2],
            db: -100.0,
            level: 0.0,
            mouth: Mouth::default(),
            silent_for: 1.0,
            peak_db: INIT_PEAK_DB,
            floor_db: INIT_FLOOR_DB,
        }
    }

    pub fn set_sample_rate(&mut self, sr: f32) {
        self.sample_rate = sr;
    }

    /// Feed mono samples.
    pub fn push(&mut self, samples: &[f32]) {
        for &s in samples {
            self.ring[self.pos] = s;
            self.pos = (self.pos + 1) % FFT_SIZE;
        }
        self.filled = (self.filled + samples.len()).min(FFT_SIZE);
    }

    /// Reset to silence (mic off).
    pub fn reset(&mut self) {
        self.ring.iter_mut().for_each(|v| *v = 0.0);
        self.smooth_mag.iter_mut().for_each(|v| *v = 0.0);
        self.filled = 0;
        self.level = 0.0;
        self.mouth = Mouth::default();
        self.silent_for = 1.0;
        self.peak_db = INIT_PEAK_DB;
        self.floor_db = INIT_FLOOR_DB;
    }

    /// Latest FFT_SIZE samples in time order.
    fn frame(&self, out: &mut [f32]) {
        for (i, o) in out.iter_mut().enumerate() {
            *o = self.ring[(self.pos + i) % FFT_SIZE];
        }
    }

    fn band(&self, lo: f32, hi: f32) -> f32 {
        let hz = self.sample_rate / FFT_SIZE as f32;
        let start = (lo / hz).floor() as usize;
        let end = ((hi / hz).ceil() as usize).min(self.power.len() - 1);
        (start..=end).map(|i| self.power[i]).sum()
    }

    fn spectrum(&mut self) {
        let mut frame = std::mem::take(&mut self.re);
        self.frame(&mut frame);
        self.re = frame;
        for i in 0..FFT_SIZE {
            self.re[i] *= self.window[i];
            self.im[i] = 0.0;
        }
        fft_in_place(&mut self.re, &mut self.im);
        let n = FFT_SIZE as f32;
        for k in 0..FFT_SIZE / 2 {
            let mag = (self.re[k] * self.re[k] + self.im[k] * self.im[k]).sqrt() / n;
            self.smooth_mag[k] = SMOOTHING * self.smooth_mag[k] + (1.0 - SMOOTHING) * mag;
            // WebAudio returns 20*log10(mag) (dB); mic.js converts back with 10^(dB/10) = mag^2
            let m = self.smooth_mag[k].max(1e-30);
            self.power[k] = m * m;
        }
    }

    /// Returns the smoothed mouth vector (and level).
    pub fn update(&mut self, dt: f32) -> Mouth {
        let mut s = 0.0f32;
        for &v in &self.ring {
            s += v * v;
        }
        let p = self.params.sanitized();
        self.db = 10.0 * (s / FFT_SIZE as f32 + 1e-12).log10() + p.gain_db;
        let db = self.db;

        // noise floor: follows quickly downwards, creeps up slowly (~1.5 dB/s)
        if db < self.floor_db {
            self.floor_db += (db - self.floor_db) * (dt * 4.0).min(1.0);
        } else {
            self.floor_db = (self.floor_db + 1.5 * dt).min(db);
        }
        self.floor_db = self.floor_db.max(-100.0);
        let voice = db > p.gate_db && db > self.floor_db + AGC_VOICE_ABOVE_FLOOR_DB;
        // speaking peak: fast attack, slow release, only while someone is talking
        if voice {
            let tau = if db > self.peak_db { AGC_ATTACK_S } else { AGC_RELEASE_S };
            self.peak_db += (db - self.peak_db) * (dt / tau).min(1.0);
        }
        let loud = if db <= p.gate_db {
            0.0
        } else if p.auto_level {
            let base = self.floor_db + AGC_MARGIN_DB;
            knee((db - base) / (self.peak_db - base).max(AGC_MIN_SPAN_DB))
        } else {
            clamp01((db - p.gate_db) / p.range_db)
        };
        let k = if loud > self.level { 30.0 } else { 10.0 };
        self.level += (loud - self.level) * (dt * k).min(1.0);

        let mut target = Mouth::default();
        if loud > 0.02 {
            self.silent_for = 0.0;
            self.spectrum();
            let low = self.band(80.0, 300.0);
            let f1 = self.band(300.0, 1000.0);
            let f2 = self.band(1000.0, 2600.0);
            let hiss = self.band(3500.0, 8000.0);
            let tot = low + f1 + f2 + hiss + 1e-12;
            let front = f2 / (f1 + f2 + 1e-12); // ~0.2 for O/U, ~0.6+ for E/I
            let sib = clamp01((hiss / tot - 0.18) / 0.35);
            let nasal = clamp01((low / tot - 0.7) / 0.2) * (1.0 - sib);
            let voiced = 1.0 - sib;
            target.open = loud * clamp01(0.35 + (f1 / tot) * 1.6) * voiced * (1.0 - nasal);
            target.round = loud * clamp01((0.42 - front) / 0.25) * voiced * (1.0 - nasal);
            target.wide = loud * (clamp01((front - 0.42) / 0.25) * voiced + 0.6 * sib);
            target.sib = loud * sib;
            target.closed = loud * nasal;
            if sib > 0.3 {
                target.open = target.open.max(0.15 * loud);
            }
        } else {
            self.silent_for += dt;
        }

        // attack fast; hold the last shape briefly (consonant gaps), then release
        let holding = self.silent_for > 0.0 && self.silent_for < p.hold;
        if !holding {
            let m = &mut self.mouth;
            for (cur, tg) in [
                (&mut m.open, target.open),
                (&mut m.round, target.round),
                (&mut m.wide, target.wide),
                (&mut m.closed, target.closed),
                (&mut m.sib, target.sib),
            ] {
                let rate = if tg > *cur { 28.0 } else { 7.0 };
                *cur += (tg - *cur) * (dt * rate).min(1.0);
            }
        }
        self.mouth.level = self.level;
        self.mouth.db = self.db;
        self.mouth.peak_db = self.peak_db;
        self.mouth.floor_db = self.floor_db;
        self.mouth
    }

    pub fn mouth(&self) -> Mouth {
        self.mouth
    }
}

/// Iterative radix-2 Cooley-Tukey FFT (len must be a power of two).
pub fn fft_in_place(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    debug_assert!(n.is_power_of_two() && im.len() == n);
    // bit reversal
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f64::consts::PI / len as f64;
        let (wr, wi) = (ang.cos(), ang.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0f64, 0.0f64);
            for k in 0..len / 2 {
                let a = start + k;
                let b = a + len / 2;
                let (cr32, ci32) = (cr as f32, ci as f32);
                let tr = re[b] * cr32 - im[b] * ci32;
                let ti = re[b] * ci32 + im[b] * cr32;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
        len <<= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    fn run(gen: impl Fn(usize) -> f32, seconds: f32) -> Mouth {
        let mut a = MouthAnalyzer::new(SR);
        let hop = 735; // 60 Hz
        let frames = (seconds * 60.0) as usize;
        let mut m = Mouth::default();
        for f in 0..frames {
            let chunk: Vec<f32> = (0..hop).map(|i| gen(f * hop + i)).collect();
            a.push(&chunk);
            m = a.update(1.0 / 60.0);
        }
        m
    }

    #[test]
    fn fft_finds_a_tone() {
        let mut re: Vec<f32> = (0..FFT_SIZE).map(|i| (2.0 * std::f32::consts::PI * 64.0 * i as f32 / FFT_SIZE as f32).sin()).collect();
        let mut im = vec![0.0; FFT_SIZE];
        fft_in_place(&mut re, &mut im);
        let peak = (0..FFT_SIZE / 2).max_by(|&a, &b| (re[a].hypot(im[a])).partial_cmp(&re[b].hypot(im[b])).unwrap()).unwrap();
        assert_eq!(peak, 64);
    }

    #[test]
    fn dsp_tone_800hz_opens_mouth() {
        let m = run(|i| 0.3 * (2.0 * std::f32::consts::PI * 800.0 * i as f32 / SR).sin(), 0.5);
        assert!(m.open > 0.3, "open={} {:?}", m.open, m);
        assert!(m.sib < 0.1, "{:?}", m);
    }

    #[test]
    fn dsp_hiss_5khz_is_sibilant() {
        // deterministic noise band-limited around 5 kHz: sum of tones 4-6 kHz
        let m = run(
            |i| {
                let t = i as f32 / SR;
                (0..12).map(|k| (2.0 * std::f32::consts::PI * (4000.0 + 170.0 * k as f32) * t + k as f32 * 1.7).sin()).sum::<f32>() * 0.05
            },
            0.5,
        );
        assert!(m.sib > 0.3, "sib={} {:?}", m.sib, m);
    }

    /// vowel-ish signal at `rms_db` dBFS: harmonics of 140 Hz with formants, 4 Hz syllables
    /// (envelope 0.25..1), 1.6 s phrases separated by 0.5 s of room noise at -75 dBFS.
    fn speech(i: usize, rms_db: f32) -> f32 {
        let t = i as f32 / SR;
        let phrase = t % 2.1;
        // tiny deterministic "room noise"
        let noise = (((i as u32).wrapping_mul(1103515245).wrapping_add(12345) >> 9) as f32 / 4194304.0 - 1.0) * 0.00025;
        if phrase > 1.6 {
            return noise;
        }
        let env = 0.25 + 0.75 * (0.5 + 0.5 * (2.0 * std::f32::consts::PI * 4.0 * t).sin());
        let mut v = 0.0;
        for (h, g) in [(1.0, 0.6), (2.0, 0.5), (4.0, 0.9), (5.0, 0.7), (8.0, 0.3), (12.0, 0.2)] {
            v += g * (2.0 * std::f32::consts::PI * 140.0 * h * t).sin();
        }
        let rms_of_v = 1.0; // sum of g^2/2 ~ 1.0
        let amp = 10f32.powf(rms_db / 20.0) / rms_of_v;
        v * env * amp + noise
    }

    /// run and collect `open` over the last `measure` seconds
    fn run_collect(params: MouthParams, gen: impl Fn(usize) -> f32, seconds: f32, measure: f32) -> Vec<f32> {
        let mut a = MouthAnalyzer::new(SR);
        a.params = params;
        let hop = 735;
        let frames = (seconds * 60.0) as usize;
        let keep = (measure * 60.0) as usize;
        let mut out = vec![];
        for f in 0..frames {
            let chunk: Vec<f32> = (0..hop).map(|i| gen(f * hop + i)).collect();
            a.push(&chunk);
            let m = a.update(1.0 / 60.0);
            if f + keep >= frames {
                out.push(m.open);
            }
        }
        out
    }

    #[test]
    fn dsp_agc_loud_speech_is_not_pinned_open() {
        let opens = run_collect(MouthParams::default(), |i| speech(i, -6.0), 8.0, 4.0);
        let voiced: Vec<f32> = opens.iter().copied().filter(|&o| o > 0.02).collect();
        let mean = voiced.iter().sum::<f32>() / voiced.len() as f32;
        let pinned = voiced.iter().filter(|&&o| o > 0.95).count() as f32 / voiced.len() as f32;
        eprintln!("AGC loud -6 dBFS: mean open {mean:.3}, pinned {pinned:.3}");
        assert!(mean <= 0.7, "mean open {mean}");
        assert!(mean > 0.2, "mean open {mean}");
        assert!(pinned < 0.1, "pinned fraction {pinned}");
    }

    #[test]
    fn dsp_manual_mode_loud_speech_saturates() {
        // documents the old problem: the manual window pins a loud close mic open
        let p = MouthParams { auto_level: false, ..MouthParams::default() };
        let opens = run_collect(p, |i| speech(i, -6.0), 4.0, 2.0);
        let max = opens.iter().cloned().fold(0.0, f32::max);
        eprintln!("manual loud -6 dBFS: max open {max:.3}");
        assert!(max > 0.9, "max {max}");
    }

    #[test]
    fn dsp_agc_quiet_speech_still_opens() {
        let opens = run_collect(MouthParams::default(), |i| speech(i, -40.0), 14.0, 4.0);
        let voiced: Vec<f32> = opens.iter().copied().filter(|&o| o > 0.02).collect();
        let mean = voiced.iter().sum::<f32>() / voiced.len().max(1) as f32;
        eprintln!("AGC quiet -40 dBFS: mean open {mean:.3}");
        assert!(!voiced.is_empty() && mean > 0.2, "mean open {mean} over {} voiced frames", voiced.len());
    }

    #[test]
    fn dsp_gain_and_gate_ranges_are_clamped() {
        let p = MouthParams { gate_db: 10.0, range_db: 1.0, gain_db: 99.0, ..MouthParams::default() }.sanitized();
        assert_eq!((p.gate_db, p.range_db, p.gain_db), (0.0, 10.0, 20.0));
    }

    #[test]
    fn dsp_silence_is_closed() {
        let m = run(|_| 0.0, 0.5);
        assert!(m.open < 1e-3 && m.sib < 1e-3 && m.level < 1e-3, "{:?}", m);
    }
}
