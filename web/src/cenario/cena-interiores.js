// Layouts padrão dos ambientes novos (tudo dá para mover/remover/adicionar no editor).
const efeitosBase = { movimento: true, intensidade: 0.4, velocidade: 0.8, poeira: false, feixe: true, sol: 1, brilho: 1, luzPersonagem: 0.8, qualidade: 'media', diaNoite: true, eventos: true };

export const CENA_BANHEIRO = {
  versao: 2, rev: 3,
  camera: { pos: [0.2, 1.85, 6.3], alvo: [0.2, 1.35, -1.5], fov: 40 },
  personagem: { pos: [0.35, 0.9], rot: 0, sombra: 1.1 },
  efeitos: { ...efeitosBase },
  itens: [
    { id: 'cabines', tipo: 'cabines', nome: 'Cabines de banheiro', pos: [-1.95, 0, -1.0], rot: 0, escala: 1, p: { n: 4, abertas: [1] } },
    { id: 'mictorios', tipo: 'mictorios', nome: 'Mictórios', pos: [2.0, 0, -2.5], rot: 0, escala: 1, p: { n: 3 } },
    { id: 'pias', tipo: 'pias', nome: 'Pias com espelho', pos: [4.1, 0, 1.4], rot: -90, escala: 1, p: { n: 3 } },
    { id: 'lixeira', tipo: 'lixeira', nome: 'Lixeira cheia', pos: [3.55, 0, 3.4], rot: 0, escala: 1, p: {} },
  ],
};

export const CENA_PRISAO = {
  versao: 2, rev: 3,
  camera: { pos: [-0.1, 1.75, 5.2], alvo: [0, 1.3, -1.5], fov: 42 },
  personagem: { pos: [0.45, 0.1], rot: 0, sombra: 1.1 },
  efeitos: { ...efeitosBase, feixe: true },
  itens: [
    { id: 'beliche', tipo: 'beliche', nome: 'Beliche de ferro', pos: [-2.05, 0, -1.88], rot: 0, escala: 1, p: {} },
    { id: 'pia', tipo: 'pia_inox', nome: 'Pia de inox da cela', pos: [-3.1, 0, 0.9], rot: 90, escala: 1, p: {} },
    { id: 'lixeira', tipo: 'lixeira', nome: 'Balde', pos: [2.2, 0, -1.9], rot: 0, escala: 0.8, p: { cor: '#6d7a6f' } },
  ],
};

export const CENA_BAR = {
  versao: 2, rev: 3,
  camera: { pos: [0.25, 1.8, 6.6], alvo: [0.25, 1.4, -1.5], fov: 40 },
  personagem: { pos: [0.35, 0.6], rot: 0, sombra: 1.1 },
  efeitos: { ...efeitosBase },
  itens: [
    { id: 'balcao', tipo: 'balcao', nome: 'Balcão do bar', pos: [-1.5, 0, -1.7], rot: 0, escala: 1, p: { comprimento: 3.4 } },
    { id: 'prateleira', tipo: 'prateleira_bebidas', nome: 'Prateleira de bebidas', pos: [-1.5, 1.15, -2.68], rot: 0, escala: 1, p: { comprimento: 2.8 } },
    { id: 'suporte_tv', tipo: 'suporte_tv', nome: 'Suporte de TV', pos: [-3.75, 2.05, -2.25], rot: 40, escala: 1, p: {} },
    { id: 'tv', tipo: 'tv', nome: 'TV do bar', pos: [-3.62, 2.07, -2.05], rot: 40, escala: 0.72, p: { tela: 'futebol' } },
    { id: 'mesa1', tipo: 'mesa_bar', nome: 'Mesa de bar amarela', pos: [2.2, 0, 0.9], rot: 8, escala: 1, p: {} },
    { id: 'cadeira1', tipo: 'cadeira_skol', nome: 'Cadeira Skol', pos: [3.05, 0, 1.35], rot: -70, escala: 1, p: {} },
    { id: 'mesa2', tipo: 'mesa_bar', nome: 'Mesa de bar amarela', pos: [-2.6, 0, 1.6], rot: -6, escala: 1, p: {} },
    { id: 'engradado1', tipo: 'engradado', nome: 'Engradados de cerveja', pos: [3.7, 0, -2.25], rot: 8, escala: 1, p: { n: 3 } },
    { id: 'engradado2', tipo: 'engradado', nome: 'Engradados de cerveja', pos: [2.95, 0, -2.35], rot: -5, escala: 1, p: { n: 2, cor: '#e8b41a' } },
    { id: 'ventilador', tipo: 'ventilador_teto', nome: 'Ventilador de teto', pos: [0.3, 3.3, 0.9], rot: 0, escala: 1, p: {} },
  ],
};
