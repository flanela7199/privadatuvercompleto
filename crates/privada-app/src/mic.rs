//! Native microphone (cpal/WASAPI) -> privada_core::dsp::MouthAnalyzer -> `mouth` event @ ~60 Hz.
//! Runs on its own thread (cpal streams are !Send); configured through a channel.
//! Never pauses when the app is unfocused / behind other windows.
use crate::dsp::{Mouth, MouthAnalyzer, MouthParams};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCfg {
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub device: Option<String>,
    #[serde(default = "d_gate")]
    pub gate_db: f32,
    #[serde(default = "d_range")]
    pub range_db: f32,
    #[serde(default = "d_hold")]
    pub hold: f32,
}
fn yes() -> bool { true }
fn d_gate() -> f32 { -50.0 }
fn d_range() -> f32 { 28.0 }
fn d_hold() -> f32 { 0.14 }

impl Default for AudioCfg {
    fn default() -> Self {
        Self { enabled: true, device: None, gate_db: d_gate(), range_db: d_range(), hold: d_hold() }
    }
}

#[derive(Serialize, Clone, Copy)]
struct MouthEvent {
    open: f32,
    round: f32,
    wide: f32,
    closed: f32,
    sib: f32,
    level: f32,
}
impl From<Mouth> for MouthEvent {
    fn from(m: Mouth) -> Self {
        Self { open: m.open, round: m.round, wide: m.wide, closed: m.closed, sib: m.sib, level: m.level }
    }
}

pub struct Mic {
    tx: Sender<AudioCfg>,
    pub cfg: Mutex<AudioCfg>,
}

impl Mic {
    pub fn start(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("privada-mic".into())
            .spawn(move || mic_thread(app, rx))
            .expect("mic thread");
        let mic = Self { tx, cfg: Mutex::new(AudioCfg::default()) };
        mic.configure(AudioCfg::default());
        mic
    }

    pub fn configure(&self, cfg: AudioCfg) {
        *self.cfg.lock().unwrap() = cfg.clone();
        let _ = self.tx.send(cfg);
    }

    pub fn set_enabled(&self, on: bool) {
        let mut c = self.cfg.lock().unwrap().clone();
        c.enabled = on;
        self.configure(c);
    }
}

pub fn device_names() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|it| it.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

fn open_stream(cfg: &AudioCfg, pending: Arc<Mutex<Vec<f32>>>) -> Result<(cpal::Stream, f32), String> {
    let host = cpal::default_host();
    let device = match &cfg.device {
        Some(name) => host
            .input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.name().map(|n| &n == name).unwrap_or(false))
            .or_else(|| host.default_input_device()),
        None => host.default_input_device(),
    }
    .ok_or("no input device")?;
    let supported = device.default_input_config().map_err(|e| e.to_string())?;
    let sr = supported.sample_rate().0 as f32;
    let channels = supported.channels() as usize;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let err = |e| log::warn!("mic stream error: {e}");

    macro_rules! build {
        ($t:ty, $conv:expr) => {{
            let pending = pending.clone();
            device.build_input_stream(
                &config,
                move |data: &[$t], _| {
                    let mut p = pending.lock().unwrap();
                    for frame in data.chunks(channels) {
                        let s: f32 = frame.iter().map(|&v| $conv(v)).sum::<f32>() / channels as f32;
                        p.push(s);
                    }
                    let len = p.len();
                    if len > 48000 {
                        p.drain(..len - 48000); // never grow unbounded if the reader stalls
                    }
                },
                err,
                None,
            )
        }};
    }
    let stream = match format {
        cpal::SampleFormat::F32 => build!(f32, |v: f32| v),
        cpal::SampleFormat::I16 => build!(i16, |v: i16| v as f32 / 32768.0),
        cpal::SampleFormat::U16 => build!(u16, |v: u16| (v as f32 - 32768.0) / 32768.0),
        cpal::SampleFormat::I32 => build!(i32, |v: i32| v as f32 / 2147483648.0),
        f => return Err(format!("unsupported sample format {f:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, sr))
}

fn mic_thread(app: AppHandle, rx: Receiver<AudioCfg>) {
    let pending = Arc::new(Mutex::new(Vec::<f32>::with_capacity(8192)));
    let mut analyzer = MouthAnalyzer::new(48000.0);
    let mut stream: Option<cpal::Stream> = None;
    let mut cfg = AudioCfg::default();
    let mut last = Instant::now();
    let mut was_silent_emit = false;
    let frame = Duration::from_micros(16_667);
    loop {
        // apply the newest config, if any
        let mut newest = None;
        while let Ok(c) = rx.try_recv() {
            newest = Some(c);
        }
        if let Some(c) = newest {
            let reopen = stream.is_none() || c.device != cfg.device || c.enabled != cfg.enabled;
            cfg = c;
            analyzer.params = MouthParams { gate_db: cfg.gate_db, range_db: cfg.range_db, hold: cfg.hold };
            if reopen {
                stream = None;
                analyzer.reset();
                pending.lock().unwrap().clear();
                if cfg.enabled {
                    match open_stream(&cfg, pending.clone()) {
                        Ok((s, sr)) => {
                            analyzer.set_sample_rate(sr);
                            stream = Some(s);
                        }
                        Err(e) => {
                            log::warn!("mic: {e}");
                            let _ = app.emit("mic-error", e);
                        }
                    }
                }
            }
        }

        let now = Instant::now();
        let dt = (now - last).as_secs_f32().min(0.1);
        last = now;
        if stream.is_some() {
            let chunk: Vec<f32> = std::mem::take(&mut *pending.lock().unwrap());
            analyzer.push(&chunk);
            let m = analyzer.update(dt);
            let _ = app.emit("mouth", MouthEvent::from(m));
            was_silent_emit = false;
        } else if !was_silent_emit {
            let _ = app.emit("mouth", MouthEvent::from(Mouth::default()));
            was_silent_emit = true;
        }
        std::thread::sleep(frame.saturating_sub(now.elapsed()));
    }
}
