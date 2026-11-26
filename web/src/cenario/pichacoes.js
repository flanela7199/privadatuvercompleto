// Pichações das portas do banheiro: um nome de moderador do canal por estilo (cada um com a sua "assinatura").
// Desenhadas em canvas; cada função recebe o contexto já posicionado no centro da área do nome.

export const MODERADORES = ['Zadig', 'Ju', 'Vitola', 'Coffezyn', 'Renan13', 'David', 'Edivanio', 'Czar', 'Bibi', 'TheFallenRagnar'];

function escorrer(x, cor, xs, y, r) {   // escorridos de tinta abaixo das letras
  x.strokeStyle = cor; x.lineCap = 'round';
  for (const px of xs) { const len = 10 + r() * 38; x.lineWidth = 2 + r() * 3; x.beginPath(); x.moveTo(px, y); x.lineTo(px + (r() - 0.5) * 2, y + len); x.stroke(); x.beginPath(); x.arc(px, y + len, x.lineWidth * 0.9, 0, 6.3); x.fillStyle = cor; x.fill(); }
}
function spray(x, cor, desenha, borrao = 10) {   // "névoa" de spray em volta + traço firme por cima
  x.save(); x.shadowColor = cor; x.shadowBlur = borrao; x.globalAlpha = 0.55; desenha(); x.restore(); desenha();
}
const F = (peso, tam, fam) => `${peso} ${tam}px ${fam}`;

export const ESTILOS = {
  // grafite de bolha: letras gordas com contorno e brilho
  Zadig(x, r) {
    x.rotate(-0.08); x.font = F('900', 104, '"Arial Black", Impact, sans-serif'); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = 22; x.strokeStyle = '#1a1033'; x.strokeText('ZADIG', 0, 0);
    const g = x.createLinearGradient(0, -50, 0, 50); g.addColorStop(0, '#9be15d'); g.addColorStop(1, '#2bb673'); x.fillStyle = g; x.fillText('ZADIG', 0, 0);
    x.lineWidth = 4; x.strokeStyle = '#ffffff'; x.globalAlpha = 0.5; x.strokeText('ZADIG', -3, -4); x.globalAlpha = 1;
    x.fillStyle = '#fff'; for (const [a, b] of [[-150, -30], [120, -35], [30, -40]]) { x.beginPath(); x.ellipse(a, b, 9, 5, -0.4, 0, 6.3); x.fill(); }
    x.font = F('bold', 26, '"Comic Sans MS", cursive'); x.fillStyle = '#7a3cff'; x.fillText('★ crew ★', 0, 70);
  },
  // fofinho: cursiva rosa com corações
  Ju(x, r) {
    x.rotate(0.06); x.font = F('italic bold', 96, '"Segoe Script", "Brush Script MT", cursive'); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#ff5fa2'; x.fillText('Ju', 0, 0);
    const coracao = (cx, cy, s, c) => { x.fillStyle = c; x.beginPath(); x.moveTo(cx, cy + s * 0.3); x.bezierCurveTo(cx - s, cy - s * 0.5, cx - s * 0.4, cy - s * 1.2, cx, cy - s * 0.5); x.bezierCurveTo(cx + s * 0.4, cy - s * 1.2, cx + s, cy - s * 0.5, cx, cy + s * 0.3); x.fill(); };
    coracao(95, -40, 26, '#ff3b7f'); coracao(-90, 35, 18, '#ff9ccc'); coracao(70, 45, 14, '#ff5fa2');
    x.font = F('', 24, '"Segoe Script", cursive'); x.fillStyle = '#d63384'; x.fillText('passei aqui ♡', 0, 62);
  },
  // estêncil militar com spray preto
  Vitola(x, r) {
    x.rotate(-0.02); x.font = F('900', 76, '"Stencil", "Impact", sans-serif'); x.textAlign = 'center'; x.textBaseline = 'middle';
    spray(x, '#151515', () => { x.fillStyle = '#151515'; x.fillText('VITOLA', 0, 0); }, 14);
    x.fillStyle = '#c9b48a'; for (let k = -2; k <= 2; k++) x.fillRect(-170 + (k + 2) * 70 + 20, -6, 4, 12);   // pontes do estêncil
    x.strokeStyle = '#151515'; x.lineWidth = 4; x.strokeRect(-170, -48, 340, 96);
    x.font = F('bold', 18, '"Courier New", monospace'); x.fillStyle = '#151515'; x.fillText('MOD Nº 03 • APROVADO', 0, 66);
  },
  // café: xícara fumegante e letras arredondadas marrons
  Coffezyn(x, r) {
    x.rotate(0.04); x.font = F('bold', 64, '"Segoe UI", "Trebuchet MS", sans-serif'); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 8; x.strokeStyle = '#f3e3c6'; x.strokeText('Coffezyn', 20, 0); x.fillStyle = '#6b3e1e'; x.fillText('Coffezyn', 20, 0);
    // xícara
    x.fillStyle = '#6b3e1e'; x.beginPath(); x.moveTo(-190, -18); x.lineTo(-140, -18); x.lineTo(-146, 22); x.quadraticCurveTo(-165, 34, -184, 22); x.closePath(); x.fill();
    x.lineWidth = 5; x.strokeStyle = '#6b3e1e'; x.beginPath(); x.arc(-137, 2, 9, -1.3, 1.3); x.stroke();
    x.strokeStyle = 'rgba(107,62,30,.6)'; x.lineWidth = 3; for (const dx of [-176, -165, -154]) { x.beginPath(); x.moveTo(dx, -24); x.bezierCurveTo(dx - 8, -36, dx + 8, -44, dx, -58); x.stroke(); }
    x.font = F('italic', 22, 'Georgia, serif'); x.fillStyle = '#8a5a34'; x.fillText('sem café não modero', 20, 48);
  },
  // tag rápida de marcador, inclinada, com escorridos vermelhos
  Renan13(x, r) {
    x.rotate(-0.22); x.font = F('italic 900', 78, 'Impact, "Arial Black", sans-serif'); x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#d0141f'; x.fillText('Renan', -175, 20);
    x.font = F('italic 900', 120, 'Impact, sans-serif'); x.fillStyle = '#111'; x.fillText('13', 55, 34);
    escorrer(x, '#d0141f', [-150, -110, -60, -20, 30], 22, r); escorrer(x, '#111', [80, 125], 36, r);
    x.strokeStyle = '#d0141f'; x.lineWidth = 6; x.lineCap = 'round'; x.beginPath(); x.moveTo(-180, 40); x.quadraticCurveTo(0, 70, 170, 46); x.stroke();
  },
  // riscado na porta com chave/estilete (traço claro fino, "talhado")
  David(x, r) {
    x.rotate(0.03); x.font = F('', 84, '"Times New Roman", serif'); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 3; x.strokeStyle = 'rgba(255,248,230,.95)'; x.strokeText('DAVID', 1, 1);
    x.strokeStyle = 'rgba(60,40,20,.7)'; x.lineWidth = 1.5; x.strokeText('DAVID', -1, -1);
    x.strokeStyle = 'rgba(255,248,230,.8)'; x.lineWidth = 2; for (let k = 0; k < 4; k++) { x.beginPath(); x.moveTo(-150 + k * 4, 52); x.lineTo(150 - k * 6, 55 + k); x.stroke(); }
    x.font = F('', 20, '"Courier New", monospace'); x.fillStyle = 'rgba(70,50,25,.8)'; x.fillText('esteve aqui — 2026', 0, 78);
  },
  // caneta esferográfica azul, letra de caderno sublinhada
  Edivanio(x, r) {
    x.rotate(-0.05); x.font = F('', 58, '"Segoe Print", "Comic Sans MS", cursive'); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#1f3fbf'; x.fillText('Edivanio', 0, 0);
    x.strokeStyle = '#1f3fbf'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(-140, 30); x.lineTo(140, 26); x.stroke(); x.beginPath(); x.moveTo(-120, 37); x.lineTo(130, 34); x.stroke();
    x.font = F('', 22, '"Segoe Print", cursive'); x.fillText('o mais pontual da live', 0, 62);
    x.beginPath(); x.arc(150, -26, 14, 0, 6.3); x.stroke(); x.beginPath(); x.moveTo(145, -30); x.lineTo(145, -28); x.moveTo(155, -30); x.lineTo(155, -28); x.stroke(); x.beginPath(); x.arc(150, -24, 7, 0.3, 2.8); x.stroke();
  },
  // realeza: letras douradas com serifa e coroa
  Czar(x, r) {
    x.font = F('bold', 100, '"Times New Roman", Georgia, serif'); x.textAlign = 'center'; x.textBaseline = 'middle';
    const g = x.createLinearGradient(0, -50, 0, 50); g.addColorStop(0, '#fff1a8'); g.addColorStop(0.5, '#d4a017'); g.addColorStop(1, '#8a6300');
    x.lineWidth = 6; x.strokeStyle = '#4a3300'; x.strokeText('CZAR', 0, 8); x.fillStyle = g; x.fillText('CZAR', 0, 8);
    x.fillStyle = '#d4a017'; x.strokeStyle = '#4a3300'; x.lineWidth = 3; x.beginPath();
    x.moveTo(-42, -52); x.lineTo(-42, -82); x.lineTo(-21, -64); x.lineTo(0, -92); x.lineTo(21, -64); x.lineTo(42, -82); x.lineTo(42, -52); x.closePath(); x.fill(); x.stroke();
    for (const [a, c] of [[-21, '#c8121b'], [0, '#1f6bd0'], [21, '#1a9a4a']]) { x.fillStyle = c; x.beginPath(); x.arc(a, -58, 4, 0, 6.3); x.fill(); }
    x.font = F('italic', 20, 'Georgia, serif'); x.fillStyle = '#6a4a00'; x.fillText('por decreto imperial', 0, 64);
  },
  // batom: escrita rosa-vermelha e marca de beijo
  Bibi(x, r) {
    x.rotate(0.1); x.font = F('bold', 84, '"Brush Script MT", "Segoe Script", cursive'); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#c2185b'; x.globalAlpha = 0.92; x.fillText('Bibi', -20, 0); x.globalAlpha = 1;
    // beijo
    x.save(); x.translate(110, -10); x.rotate(-0.3); x.fillStyle = '#d81b60';
    x.beginPath(); x.moveTo(-34, 0); x.bezierCurveTo(-24, -22, -6, -18, 0, -8); x.bezierCurveTo(6, -18, 24, -22, 34, 0); x.bezierCurveTo(20, -4, -20, -4, -34, 0); x.fill();
    x.beginPath(); x.moveTo(-34, 2); x.bezierCurveTo(-18, 26, 18, 26, 34, 2); x.bezierCurveTo(18, 8, -18, 8, -34, 2); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 1; for (let k = -24; k <= 24; k += 6) { x.beginPath(); x.moveTo(k, -10); x.lineTo(k * 1.05, 16); x.stroke(); }
    x.restore();
    x.font = F('', 22, '"Segoe Script", cursive'); x.fillStyle = '#c2185b'; x.fillText('xoxo', -20, 56);
  },
  // viking: letras angulosas vermelho-escuras, machado cruzado e "runas"
  TheFallenRagnar(x, r) {
    x.rotate(-0.04); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = F('900', 30, '"Segoe UI", sans-serif'); x.fillStyle = '#3a0b0b'; x.fillText('ᚦᛖ ᚠᚨᛚᛚᛖᚾ', 0, -58);
    x.font = F('900', 62, 'Impact, "Arial Black", sans-serif');
    x.lineWidth = 7; x.strokeStyle = '#120404'; x.strokeText('RAGNAR', 0, 4); x.fillStyle = '#8b0d0d'; x.fillText('RAGNAR', 0, 4);
    x.font = F('bold', 22, 'Impact, sans-serif'); x.fillStyle = '#120404'; x.fillText('THE FALLEN', 0, 46);
    // machados cruzados
    const machado = (rot) => { x.save(); x.rotate(rot); x.fillStyle = '#2b2b2b'; x.fillRect(-3, -60, 6, 120); x.fillStyle = '#5a5a5a'; x.beginPath(); x.moveTo(3, -58); x.quadraticCurveTo(34, -52, 30, -24); x.quadraticCurveTo(14, -34, 3, -32); x.fill(); x.restore(); };
    x.save(); x.translate(-170, 0); x.globalAlpha = 0.85; machado(0.5); machado(-0.5); x.restore();
    escorrer(x, '#8b0d0d', [-60, 10, 70], 30, r);
  },
};

/** desenha `nomes` numa porta (canvas W x H), espaçados na vertical, cada um no seu estilo */
export function desenharPichacoes(x, W, H, nomes, r) {
  const n = nomes.length; if (!n) return;
  const faixa = (H * 0.86) / n;
  nomes.forEach((nome, i) => {
    const fn = ESTILOS[nome]; if (!fn) return;
    x.save();
    x.translate(W / 2 + (r() - 0.5) * W * 0.08, H * 0.08 + faixa * (i + 0.5));
    const esc = Math.min(1.2, (W * 0.95) / 420, faixa / 165); x.scale(esc, esc);
    fn(x, r); x.restore();
  });
}
