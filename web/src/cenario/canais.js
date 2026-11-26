// "Canais" da TV antiga: tudo desenhado em canvas e atualizado ~15x/s (só enquanto a TV aparece).
// 'verde' é a tela de chroma key (verde puro, sem luz/reflexo) para pôr qualquer coisa atrás no OBS.
import * as THREE from 'three';

export const CANAIS = [
  ['chuvisco', 'Chuvisco'], ['jornal', 'Jornal do Vaso'], ['futebol', 'Futebol ao vivo'], ['novela', 'Novela das 8'],
  ['desenho', 'Desenho animado'], ['tempo', 'Previsão do tempo'], ['barras', 'Fora do ar'], ['verde', 'Tela verde (chroma)'],
];
export const IDS_CANAIS = CANAIS.map(([id]) => id);

const MANCHETES = [
  'URGENTE: VASO É FLAGRADO AO VIVO NA LIVE', 'PREÇO DO PAPEL HIGIÊNICO DISPARA', 'CIENTISTAS CONFIRMAM: DESCARGA É IMPORTANTE',
  'TORCEDOR GARANTE QUE "ESSE ANO VAI"', 'CHUVA DE PIX PREVISTA PARA ESTA NOITE', 'ENCANADOR É O NOVO HERÓI NACIONAL',
  'ESPECIALISTAS: "NÃO JOGUE PAPEL NO VASO"', 'BAR DO VASO ANUNCIA SALGADO EM DOBRO',
];

function base(w = 320, h = 220) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return [c, c.getContext('2d'), t];
}
/** linhas de varredura + vinheta de tubo, por cima de qualquer canal */
function crt(x, w, h, t) {
  x.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < h; y += 3) x.fillRect(0, y, w, 1);
  const g = x.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.85); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  const r = ((t * 30) % (h + 40)) - 20; x.fillStyle = 'rgba(255,255,255,.05)'; x.fillRect(0, r, w, 10);
}

const DESENHA = {
  jornal(x, w, h, t) {
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#0d2c6b'); g.addColorStop(1, '#1b4fa8'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,.08)'; for (let k = 0; k < 8; k++) x.fillRect(((k * 53 + t * 12) % (w + 60)) - 60, 20 + k * 14, 50, 3);
    // âncora: um vaso de terno (silhueta simpática)
    const bx = w * 0.42, by = h * 0.82;
    x.fillStyle = '#1b1b22'; x.beginPath(); x.ellipse(bx, by, 70, 34, 0, Math.PI, 0); x.fill();                    // ombros/terno
    x.fillStyle = '#f2f1ec'; x.fillRect(bx - 26, by - 104, 52, 46); x.beginPath(); x.ellipse(bx, by - 46, 34, 22, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#c8121b'; x.beginPath(); x.moveTo(bx, by - 30); x.lineTo(bx - 6, by - 4); x.lineTo(bx + 6, by - 4); x.fill();   // gravata
    const fala = Math.abs(Math.sin(t * 9)) * 6;
    x.fillStyle = '#111'; for (const s of [-1, 1]) { x.beginPath(); x.arc(bx + s * 11, by - 84, 5, 0, 6.3); x.fill(); }
    x.fillStyle = '#3b2a1a'; x.fillRect(bx - 12, by - 56 + fala * 0.2, 24, 3 + fala);
    // logotipo e tarja
    x.fillStyle = '#c8121b'; x.fillRect(w - 98, 12, 86, 26); x.fillStyle = '#fff'; x.font = 'bold 15px Arial'; x.fillText('AO VIVO', w - 88, 30);
    x.fillStyle = '#f2c94c'; x.fillRect(0, h - 46, 88, 20); x.fillStyle = '#111'; x.font = 'bold 13px Arial'; x.fillText('URGENTE', 10, h - 31);
    x.fillStyle = '#c8121b'; x.fillRect(0, h - 26, w, 26);
    const msg = MANCHETES.join('   •   '); x.font = 'bold 15px Arial'; x.fillStyle = '#fff';
    const L = x.measureText(msg).width + 60, off = (t * 60) % L; x.fillText(msg, w - off, h - 8); x.fillText(msg, w - off + L, h - 8);
  },
  futebol(x, w, h, t) {
    for (let k = 0; k < 10; k++) { x.fillStyle = k % 2 ? '#2f8a3a' : '#38994a'; x.fillRect(k * w / 10, 0, w / 10 + 1, h); }
    x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 2; x.strokeRect(10, 14, w - 20, h - 28);
    x.beginPath(); x.moveTo(w / 2, 14); x.lineTo(w / 2, h - 14); x.stroke(); x.beginPath(); x.arc(w / 2, h / 2, 28, 0, 6.3); x.stroke();
    x.strokeRect(10, h / 2 - 40, 40, 80); x.strokeRect(w - 50, h / 2 - 40, 40, 80);
    const bola = { x: w / 2 + Math.sin(t * 0.9) * w * 0.35 + Math.sin(t * 2.3) * 20, y: h / 2 + Math.sin(t * 1.3) * h * 0.3 };
    for (let k = 0; k < 11; k++) for (const [cor, lado] of [['#111', -1], ['#fff', 1]]) {
      const px = w / 2 + lado * (30 + (k % 4) * 30) + Math.sin(t * 1.1 + k) * 14 + (bola.x - w / 2) * 0.3, py = 30 + (k * 37) % (h - 60) + Math.cos(t * 0.8 + k * 2) * 10;
      x.fillStyle = cor; x.beginPath(); x.arc(px, py, 4, 0, 6.3); x.fill(); x.strokeStyle = '#000'; x.lineWidth = 1; x.stroke();
    }
    x.fillStyle = '#fff'; x.beginPath(); x.arc(bola.x, bola.y, 3, 0, 6.3); x.fill();
    x.fillStyle = 'rgba(0,0,0,.75)'; x.fillRect(8, 4, 128, 20); x.fillStyle = '#fff'; x.font = 'bold 13px Arial';
    const min = Math.floor((t / 2) % 90) + 1; x.fillText(`CAM 2 x 1 ADV  ${min}'`, 14, 19);
  },
  novela(x, w, h, t) {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5b2a3a'); g.addColorStop(1, '#c77a6a'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    const z = 1 + Math.sin(t * 0.3) * 0.04; x.save(); x.translate(w / 2, h / 2); x.scale(z, z); x.translate(-w / 2, -h / 2);
    for (const [cx, s] of [[w * 0.36, 1], [w * 0.64, -1]]) {
      x.fillStyle = '#2a1520'; x.beginPath(); x.ellipse(cx, h * 0.48, 40, 52, s * 0.15, 0, 6.3); x.fill();
      x.fillRect(cx - 50, h * 0.7, 100, h * 0.4);
    }
    x.restore();
    for (let k = 0; k < 6; k++) { const px = w / 2 + Math.sin(t + k) * 40, py = h * 0.35 - ((t * 20 + k * 30) % 90); x.fillStyle = `rgba(255,90,120,${0.8 - ((t * 20 + k * 30) % 90) / 110})`; x.font = '20px Arial'; x.fillText('♥', px, py); }
    const falas = ['— Você não pode me deixar, Creuza!', '— O vaso... é seu filho, Jorge.', '— NÃÃÃO!'];
    x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(0, h - 30, w, 30); x.fillStyle = '#ffe9a0'; x.font = 'italic 14px Georgia';
    x.fillText(falas[Math.floor(t / 4) % falas.length], 14, h - 10);
  },
  desenho(x, w, h, t) {
    x.fillStyle = '#7fd3ff'; x.fillRect(0, 0, w, h); x.fillStyle = '#6cc04a'; x.fillRect(0, h * 0.72, w, h * 0.28);
    x.fillStyle = '#fff'; for (let k = 0; k < 3; k++) { const cx = ((k * 140 + t * 18) % (w + 120)) - 60; x.beginPath(); x.arc(cx, 40 + k * 12, 18, 0, 6.3); x.arc(cx + 20, 36 + k * 12, 22, 0, 6.3); x.arc(cx + 42, 42 + k * 12, 16, 0, 6.3); x.fill(); }
    const px = ((t * 70) % (w + 80)) - 40, py = h * 0.72 - Math.abs(Math.sin(t * 5)) * 60;
    x.fillStyle = '#f7d417'; x.beginPath(); x.arc(px, py - 22, 22, 0, 6.3); x.fill();
    x.fillStyle = '#111'; x.beginPath(); x.arc(px + 7, py - 28, 4, 0, 6.3); x.arc(px - 5, py - 28, 4, 0, 6.3); x.fill();
    x.strokeStyle = '#111'; x.lineWidth = 2; x.beginPath(); x.arc(px + 1, py - 18, 9, 0.2, Math.PI - 0.2); x.stroke();
    x.fillStyle = '#c8121b'; x.font = 'bold 16px "Comic Sans MS", cursive'; x.fillText('BOING!', px - 20, py - 54);
  },
  tempo(x, w, h, t) {
    x.fillStyle = '#123d6b'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#3b8f4a'; x.beginPath(); x.moveTo(w * 0.45, 30); x.bezierCurveTo(w * 0.85, 30, w * 0.9, 90, w * 0.72, 120); x.bezierCurveTo(w * 0.66, 170, w * 0.52, 200, w * 0.42, 190); x.bezierCurveTo(w * 0.36, 140, w * 0.2, 110, w * 0.3, 70); x.closePath(); x.fill();
    const icone = (cx, cy, k) => {
      if (k === 0) { x.fillStyle = '#ffd33a'; x.beginPath(); x.arc(cx, cy, 10, 0, 6.3); x.fill(); }
      else { x.fillStyle = '#e8eef2'; x.beginPath(); x.arc(cx, cy, 9, 0, 6.3); x.arc(cx + 10, cy - 3, 11, 0, 6.3); x.fill(); x.fillStyle = '#58a6ff'; for (let d = 0; d < 3; d++) x.fillRect(cx - 4 + d * 7, cy + 12 + ((t * 30 + d * 5) % 10), 2, 5); }
    };
    icone(w * 0.55, 70, 0); icone(w * 0.68, 110, 1); icone(w * 0.46, 150, Math.floor(t / 3) % 2);
    x.fillStyle = '#fff'; x.font = 'bold 18px Arial'; x.fillText('PREVISÃO', 12, 28); x.font = '14px Arial'; x.fillText('Chuva de Pix: 90%', 12, 52); x.fillText('Calor: 38°C', 12, 72);
  },
  barras(x, w, h, t) {
    const cores = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    cores.forEach((c, i) => { x.fillStyle = c; x.fillRect(i * w / 7, 0, w / 7 + 1, h * 0.7); });
    x.fillStyle = '#111'; x.fillRect(0, h * 0.7, w, h * 0.3);
    x.fillStyle = '#fff'; x.font = 'bold 22px Arial'; x.textAlign = 'center'; x.fillText('FORA DO AR', w / 2, h * 0.88); x.textAlign = 'left';
    if (Math.sin(t * 3) > 0.6) { x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(0, 0, w, h); }
  },
};

/** textura animada do canal `id` (null para 'chuvisco'/'verde', que são tratados à parte) */
export function texturaCanal(id) {
  const fn = DESENHA[id]; if (!fn) return null;
  const [c, x, t] = base();
  let ult = -1;
  t.userData.atualizar = (tempo) => {
    if (tempo - ult < 1 / 15) return;   // 15 quadros/s bastam para uma TV de tubo
    ult = tempo;
    x.save(); fn(x, c.width, c.height, tempo); x.restore(); crt(x, c.width, c.height, tempo);
    t.needsUpdate = true;
  };
  t.userData.atualizar(0);
  return t;
}
