// AudioWorklet: recebe a mixagem final dos efeitos e manda em pedaços de ~20 ms (i16 estéreo intercalado)
// para a thread principal, que entrega ao processo nativo (ver audio_out.rs). Não produz som aqui.
class Captura extends AudioWorkletProcessor {
  constructor() {
    super();
    this.n = Math.round(sampleRate * 0.02);          // quadros por pacote
    this.buf = new Int16Array(this.n * 2); this.i = 0;
    this.silencio = 0;
  }
  process(inputs) {
    const ent = inputs[0];
    const L = ent[0], R = ent[1] || ent[0];
    const q = L ? L.length : 128;
    let alto = false;
    if (L) for (let k = 0; k < q; k++) { const l = L[k], r = R[k]; if (l > 1e-4 || l < -1e-4 || r > 1e-4 || r < -1e-4) { alto = true; break; } }
    this.silencio = alto ? 0 : this.silencio + q / this.n;
    for (let k = 0; k < q; k++) {
      const l = L ? L[k] : 0, r = R ? R[k] : 0;
      this.buf[this.i++] = Math.max(-1, Math.min(1, l)) * 32767;
      this.buf[this.i++] = Math.max(-1, Math.min(1, r)) * 32767;
      if (this.i >= this.buf.length) {
        // silêncio longo: para de mandar (não ocupa o IPC à toa); o nativo toca silêncio quando a fila esvazia
        if (this.silencio < 25) { this.port.postMessage(this.buf.buffer, [this.buf.buffer]); this.buf = new Int16Array(this.n * 2); }
        this.i = 0;
      }
    }
    return true;
  }
}
registerProcessor('captura-vaso', Captura);
