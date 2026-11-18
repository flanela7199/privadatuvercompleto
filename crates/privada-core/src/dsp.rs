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
}

#[derive(Clone, Copy, Debug)]
pub struct MouthParams {
    /// below this: silence (dB)
    pub gate_db: f32,
    /// gate + range = fully loud (dB)
    pub range_db: f32,
    /// seconds the shape is held after the voice drops (consonants)
    pub hold: f32,
}

impl Default for MouthParams {
    fn default() -> Self {
        Self { gate_db: -50.0, range_db: 28.0, hold: 0.14 }
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
        self.db = 10.0 * (s / FFT_SIZE as f32 + 1e-12).log10();
        let p = self.params;
        let loud = clamp01((self.db - p.gate_db) / p.range_db);
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

    #[test]
    fn dsp_silence_is_closed() {
        let m = run(|_| 0.0, 0.5);
        assert!(m.open < 1e-3 && m.sib < 1e-3 && m.level < 1e-3, "{:?}", m);
    }
}
