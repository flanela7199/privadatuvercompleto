// Sala inicial: a mesma composição da imagem "FUNDO CONVERSA", agora em 3D.
// pos = [x, y, z] em metros (y = base do objeto; quadros: centro na parede). rot em graus.
const Q = (id, nome, x, y, w, h, moldura, foto, inclinacao = 0, parede = 'fundo') =>
  ({ id, tipo: 'quadro', nome, pos: [x, y, -2.5], rot: 0, escala: 1, p: { parede, largura: w, altura: h, moldura, foto, inclinacao } });

export const CENA_PADRAO = {
  versao: 2,
  camera: { pos: [0.15, 1.95, 6.9], alvo: [0.15, 1.5, -1.2], fov: 36 },
  // lugar do personagem na sala (x, z em metros; o personagem fica sempre na origem do mundo e a sala se ajusta)
  personagem: { pos: [0.35, -0.45], rot: 0, sombra: 1.1 },
  efeitos: { movimento: true, intensidade: 0.5, velocidade: 1, poeira: true, feixe: true, sol: 1, brilho: 1, luzPersonagem: 1, qualidade: 'media' },
  itens: [
    { id: 'escada', tipo: 'escada', nome: 'Escada de concreto', pos: [-0.95, 0, -1.97], rot: 0, escala: 1, p: {} },
    { id: 'garrafa', tipo: 'garrafa', nome: "Garrafa d'água", pos: [-1.52, 0.762, -1.75], rot: 0, escala: 1, p: {} },
    { id: 'sofa', tipo: 'sofa', nome: 'Sofá velho', pos: [0.35, 0, -1.82], rot: 0, escala: 1, p: {} },
    { id: 'mesinha', tipo: 'mesinha', nome: 'Mesinha de madeira', pos: [2.9, 0, -2.02], rot: 0, escala: 1, p: {} },
    { id: 'tv', tipo: 'tv', nome: 'TV antiga', pos: [2.9, 0.66, -1.98], rot: -6, escala: 1, p: { tela: 'chuvisco' } },
    { id: 'estatueta', tipo: 'estatueta', nome: 'Estatueta de prata', pos: [2.5, 1.47, -2.02], rot: 10, escala: 1, p: {} },
    { id: 'caixinha', tipo: 'caixinha', nome: 'Caixinha', pos: [3.22, 1.47, -2.05], rot: -8, escala: 1, p: {} },
    { id: 'mesa', tipo: 'mesa_vermelha', nome: 'Mesa de bar vermelha', pos: [-2.15, 0, -0.45], rot: 18, escala: 1, p: { cor: '#c8121b' } },
    { id: 'livro_capital', tipo: 'livro', nome: 'Livro O Capital', pos: [-2.3, 0.937, -0.55], rot: 14, escala: 0.82, p: { capa: 'capital' } },
    { id: 'livro_amarelo', tipo: 'livro', nome: 'O Livro Amarelo', pos: [-1.95, 0.937, -0.47], rot: 20, escala: 0.82, p: { capa: 'amarelo' } },
    { id: 'revolver', tipo: 'revolver', nome: 'Revólver', pos: [-2.25, 0.937, -0.22], rot: 35, escala: 1.25, p: {} },
    { id: 'cadeira', tipo: 'cadeira_skol', nome: 'Cadeira Skol', pos: [-2.75, 0, 1.05], rot: 62, escala: 1, p: {}, frente: true },
    { id: 'poster', tipo: 'poster', nome: 'Pôster encostado', pos: [4.08, 0, -0.35], rot: -90, escala: 1, p: { imagem: 'poster' } },
    { id: 'rodo', tipo: 'rodo', nome: 'Rodo', pos: [3.98, 0, 0.35], rot: -90, escala: 1, p: {} },
    { id: 'bandeira', tipo: 'bandeira', nome: 'Bandeira', pos: [0.35, 3.3, -2.5], rot: 0, escala: 1, p: { parede: 'fundo', largura: 2.15, altura: 1.42, imagem: 'bandeira', vento: 1 } },
    Q('quadro_sindicalista', 'Quadro dourado claro', -3.3, 3.25, 0.42, 0.52, 'dourada_clara', 'quadro_sindicalista', -8),
    Q('quadro_master', 'Quadro de madeira', -2.6, 3.0, 0.55, 0.76, 'madeira', 'quadro_master', 3),
    Q('quadro_ciborgue', 'Quadro dourado', -1.82, 2.72, 0.48, 0.62, 'dourada', 'quadro_ciborgue', 0),
    Q('quadro_galo', 'Quadro do galo', -1.12, 2.62, 0.5, 0.74, 'preta', 'quadro_galo', -1.5),
    Q('quadro_flavio', 'Quadro dourado pequeno', -1.58, 1.95, 0.4, 0.42, 'dourada', 'quadro_flavio', 3),
    Q('quadro_temer', 'Quadro grande', 2.3, 2.42, 0.98, 1.32, 'preta', 'quadro_temer', 0.5),
    Q('quadro_praia', 'Quadro da praia', 3.72, 2.95, 0.3, 0.6, 'preta', 'quadro_praia', -6),
    Q('quadro_lula', 'Quadro preto pequeno', 3.74, 2.1, 0.3, 0.64, 'preta', 'quadro_lula', 4),
    { id: 'lampada', tipo: 'lampada', nome: 'Lâmpada pendurada', pos: [0.4, 3.9, -0.7], rot: 0, escala: 1, p: { fio: 1.05, intensidade: 7, balanco: 1 } },
    { id: 'entulho', tipo: 'entulho', nome: 'Entulho do sofá', pos: [0.45, 0, -0.85], rot: 0, escala: 1, p: { raio: 1.5, qtd: 26, semente: 3 } },
    { id: 'entulho2', tipo: 'entulho', nome: 'Entulho perto da TV', pos: [2.6, 0, -0.9], rot: 0, escala: 1, p: { raio: 0.9, qtd: 10, semente: 8 } },
  ],
};
