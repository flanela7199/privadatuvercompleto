//! Saída de som nativa: os efeitos sonoros são sintetizados no WebView (Web Audio), mas o som de um
//! WebView2 sai pelo processo `msedgewebview2.exe`, não pelo `PrivadaTuber.exe`. Por isso a "Captura
//! de áudio de aplicativo" do OBS (que escolhe o processo da janela) não pegava nada.
//! Aqui o JS manda as amostras já mixadas (PCM i16 estéreo) e quem toca é ESTE processo, via cpal,
//! então o OBS acha o som na janela do PrivadaTuber.
//!
//! Comandos:
//!   audio_info()                         -> { sampleRate } da saída padrão (o JS cria o AudioContext nessa taxa)
//!   audio_push(bytes i16 LE intercalado) -> true   (raw body; ~20 ms por chamada)

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::ipc::{InvokeBody, Request};

/// fila de amostras estéreo intercaladas (f32) entre o IPC e o callback de áudio
type Fila = Arc<Mutex<VecDeque<f32>>>;

struct Saida {
    fila: Fila,
    taxa: u32,
    viva: Arc<AtomicBool>,
    _parar: mpsc::Sender<()>,
}

static SAIDA: OnceLock<Mutex<Option<Saida>>> = OnceLock::new();
fn saida() -> &'static Mutex<Option<Saida>> {
    SAIDA.get_or_init(|| Mutex::new(None))
}

fn taxa_padrao() -> u32 {
    cpal::default_host()
        .default_output_device()
        .and_then(|d| d.default_output_config().ok())
        .map(|c| c.sample_rate().0)
        .unwrap_or(48_000)
}

/// abre a saída padrão numa thread própria (o Stream do cpal não pode trocar de thread)
fn abrir() -> Result<Saida, String> {
    let fila: Fila = Arc::new(Mutex::new(VecDeque::with_capacity(48_000)));
    let viva = Arc::new(AtomicBool::new(true));
    let (tx_parar, rx_parar) = mpsc::channel::<()>();
    let (tx_ok, rx_ok) = mpsc::channel::<Result<u32, String>>();
    let (f2, v2) = (fila.clone(), viva.clone());
    std::thread::Builder::new()
        .name("audio-out".into())
        .spawn(move || {
            let r = (|| -> Result<(cpal::Stream, u32), String> {
                let dev = cpal::default_host().default_output_device().ok_or("sem dispositivo de saída")?;
                let cfg = dev.default_output_config().map_err(|e| e.to_string())?;
                let taxa = cfg.sample_rate().0;
                let canais = cfg.channels() as usize;
                let conf: cpal::StreamConfig = cfg.clone().into();
                let v3 = v2.clone();
                let erro = move |e: cpal::StreamError| {
                    crate::crash_log(&format!("audio-out: {e}"));
                    v3.store(false, Ordering::Relaxed); // o próximo push reabre (ex.: trocou o fone)
                };
                let f3 = f2.clone();
                // escreve um quadro (L,R) em `canais` saídas: estéreo nas duas primeiras, mono = média
                fn quadro<T: Copy>(dst: &mut [T], l: f32, r: f32, conv: impl Fn(f32) -> T, zero: T) {
                    match dst.len() {
                        1 => dst[0] = conv((l + r) * 0.5),
                        _ => {
                            dst[0] = conv(l);
                            dst[1] = conv(r);
                            for x in &mut dst[2..] {
                                *x = zero;
                            }
                        }
                    }
                }
                let stream = match cfg.sample_format() {
                    cpal::SampleFormat::F32 => dev.build_output_stream(
                        &conf,
                        move |out: &mut [f32], _| {
                            let mut q = f3.lock().unwrap_or_else(|p| p.into_inner());
                            for fr in out.chunks_mut(canais) {
                                let (l, r) = if q.len() >= 2 { (q.pop_front().unwrap(), q.pop_front().unwrap()) } else { (0.0, 0.0) };
                                quadro(fr, l, r, |v| v, 0.0);
                            }
                        },
                        erro,
                        None,
                    ),
                    cpal::SampleFormat::I16 => dev.build_output_stream(
                        &conf,
                        move |out: &mut [i16], _| {
                            let mut q = f3.lock().unwrap_or_else(|p| p.into_inner());
                            for fr in out.chunks_mut(canais) {
                                let (l, r) = if q.len() >= 2 { (q.pop_front().unwrap(), q.pop_front().unwrap()) } else { (0.0, 0.0) };
                                quadro(fr, l, r, |v| (v.clamp(-1.0, 1.0) * 32767.0) as i16, 0);
                            }
                        },
                        erro,
                        None,
                    ),
                    cpal::SampleFormat::U16 => dev.build_output_stream(
                        &conf,
                        move |out: &mut [u16], _| {
                            let mut q = f3.lock().unwrap_or_else(|p| p.into_inner());
                            for fr in out.chunks_mut(canais) {
                                let (l, r) = if q.len() >= 2 { (q.pop_front().unwrap(), q.pop_front().unwrap()) } else { (0.0, 0.0) };
                                quadro(fr, l, r, |v| ((v.clamp(-1.0, 1.0) * 0.5 + 0.5) * 65535.0) as u16, 32768);
                            }
                        },
                        erro,
                        None,
                    ),
                    f => return Err(format!("formato de saída não suportado: {f:?}")),
                }
                .map_err(|e| e.to_string())?;
                stream.play().map_err(|e| e.to_string())?;
                Ok((stream, taxa))
            })();
            match r {
                Ok((stream, taxa)) => {
                    let _ = tx_ok.send(Ok(taxa));
                    let _ = rx_parar.recv(); // segura o stream vivo até a Saida ser descartada
                    drop(stream);
                }
                Err(e) => {
                    let _ = tx_ok.send(Err(e));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    let taxa = rx_ok.recv().map_err(|e| e.to_string())??;
    Ok(Saida { fila, taxa, viva, _parar: tx_parar })
}

#[derive(serde::Serialize)]
pub struct AudioInfo {
    #[serde(rename = "sampleRate")]
    sample_rate: u32,
}

#[tauri::command]
pub fn audio_info() -> AudioInfo {
    let g = saida().lock().unwrap_or_else(|p| p.into_inner());
    AudioInfo { sample_rate: g.as_ref().map(|s| s.taxa).unwrap_or_else(taxa_padrao) }
}

#[tauri::command]
pub fn audio_push(request: Request<'_>) -> Result<bool, String> {
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b,
        InvokeBody::Json(_) => return Err("audio_push: envie bytes (i16 LE estéreo)".into()),
    };
    let mut g = saida().lock().unwrap_or_else(|p| p.into_inner());
    if g.as_ref().map(|s| !s.viva.load(Ordering::Relaxed)).unwrap_or(true) {
        *g = None; // derruba a anterior (se houver) antes de reabrir
        match abrir() {
            Ok(s) => *g = Some(s),
            Err(e) => {
                crate::crash_log(&format!("audio-out: não abriu a saída: {e}"));
                return Err(e);
            }
        }
    }
    let s = g.as_ref().unwrap();
    let sr_in: u32 = request.headers().get("x-sr").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(s.taxa);
    let amostras: Vec<f32> = bytes.chunks_exact(2).map(|p| i16::from_le_bytes([p[0], p[1]]) as f32 / 32768.0).collect();
    let mut q = s.fila.lock().unwrap_or_else(|p| p.into_inner());
    if sr_in == s.taxa || sr_in == 0 {
        q.extend(amostras);
    } else {
        // taxa diferente (o contexto de áudio nasceu antes de saber a do dispositivo): reamostragem linear
        let n_in = amostras.len() / 2;
        let n_out = (n_in as u64 * s.taxa as u64 / sr_in as u64) as usize;
        for i in 0..n_out {
            let pos = i as f64 * sr_in as f64 / s.taxa as f64;
            let a = (pos as usize).min(n_in.saturating_sub(1));
            let b = (a + 1).min(n_in.saturating_sub(1));
            let t = (pos - a as f64) as f32;
            for c in 0..2 {
                q.push_back(amostras[a * 2 + c] * (1.0 - t) + amostras[b * 2 + c] * t);
            }
        }
    }
    // atraso máximo ~150 ms: se acumular (aba travou, PC engasgou), descarta o mais antigo
    let max = (s.taxa as usize) * 2 * 15 / 100;
    if q.len() > max {
        let sobra = q.len() - (s.taxa as usize) * 2 * 6 / 100;
        q.drain(..sobra - sobra % 2);
    }
    Ok(true)
}
