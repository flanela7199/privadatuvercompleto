// Ilha tropical (segunda opção de cenário 3D): só a cadeira da Skol, a mesa e um guarda-sol, com
// dois coqueiros de fundo (dá para remover/adicionar tudo no editor, igual à sala).
export const CENA_ILHA = {
  versao: 2,
  rev: 3,
  camera: { pos: [0.1, 1.7, 6.4], alvo: [0.1, 1.25, -2.5], fov: 38 },
  personagem: { pos: [0, 0.4], rot: 0, sombra: 1.1 },
  efeitos: { movimento: true, intensidade: 0.45, velocidade: 0.8, poeira: false, feixe: false, sol: 1, brilho: 1, luzPersonagem: 0.7, qualidade: 'media' },
  itens: [
    { id: 'guarda_sol', tipo: 'guarda_sol', nome: 'Guarda-sol', pos: [0.75, 0, -0.35], rot: 0, escala: 1, p: { raio: 1.45, altura: 2.3, inclinacao: 7 } },
    { id: 'mesa', tipo: 'mesa_bar', nome: 'Mesa de bar amarela', pos: [1.25, 0, 0.35], rot: -12, escala: 1, p: {} },
    { id: 'cadeira', tipo: 'cadeira_skol', nome: 'Cadeira Skol', pos: [-1.35, 0, 0.55], rot: 28, escala: 1, p: {} },
    { id: 'coqueiro1', tipo: 'coqueiro', nome: 'Coqueiro', pos: [-3.7, 0, -3.4], rot: 15, escala: 1, p: { altura: 4.9, curva: 1.1, semente: 2 } },
    { id: 'coqueiro2', tipo: 'coqueiro', nome: 'Coqueiro', pos: [4.3, 0, -2.6], rot: 195, escala: 1, p: { altura: 4.4, curva: 0.9, semente: 5 } },
  ],
};
