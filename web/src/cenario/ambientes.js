// Registro dos ambientes 3D: cada um diz onde fica o layout salvo, a cena padrão, a iluminação base e
// como montar o "mundo" (cômodo/ilha). Os eventos interativos de cada um ficam em eventos.js.
import * as THREE from 'three';
import { CENA_PADRAO } from './cena-padrao.js';
import { CENA_ILHA } from './cena-ilha.js';
import { CENA_BANHEIRO, CENA_PRISAO, CENA_BAR } from './cena-interiores.js';
import { criarSala, criarFeixe, criarPoeira, PAREDES, SALA, JANELA } from './sala.js';
import { criarIlha, SOL_DIR } from './ilha.js';
import { criarBanheiro, criarPrisao, criarBar, BANHEIRO, PRISAO, BAR } from './interiores.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const AMBIENTES = {
  sala: {
    nome: 'Sala 3D', chave: 'privada_sala3d_v1', cache: 'sala3d-layout', padrao: CENA_PADRAO, env: 0.32, far: 40, alto: SALA.alto,
    luz: { hemi: [0xdfe6ee, 0x6e665c, 0.55], sol: { cor: 0xfff0d6, base: 5.5, dir: V(-1, -0.62, -0.42), alvo: V(2.2, 1.4, -1.2), cam: { left: -6, right: 6, top: 5, bottom: -5, near: 4, far: 30 } }, prench: 0.55, prench2: 1.6 },
    mundo(raiz, ctx, dirSol) {
      const chao = criarSala(raiz, ctx), feixe = criarFeixe(raiz, dirSol), poeira = criarPoeira(raiz);
      const fora = chao.userData.fora, C_POR = new THREE.Color('#ffb070');
      return { chao, feixe, poeira, paredes: PAREDES, janela: JANELA,
        diaNoite(i) { fora?.color.setScalar(0.1 + 0.9 * i.dia).lerp(C_POR, i.crepusculo * 0.35 * i.dia); } };
    },
    eventos: ['lampada', 'garrafa', 'bandeira', 'quadro', 'tv'],
  },
  ilha: {
    nome: 'Ilha tropical', chave: 'privada_ilha3d_v1', cache: 'ilha3d-layout', padrao: CENA_ILHA, env: 0.75, far: 220, alto: 0,
    luz: { hemi: [0xcfe9ff, 0xf0d9a8, 1.15], sol: { cor: 0xfff1dc, base: 3.6, dir: SOL_DIR.clone(), alvo: V(0, 0.8, 0), cam: { left: -8, right: 8, top: 8, bottom: -6, near: 2, far: 32 } }, prench: 0.35, prench2: 0, externo: true },
    mundo(raiz) { const m = criarIlha(raiz); return { ...m, paredes: null }; },
    eventos: ['coco', 'gaivota', 'onda', 'vento'],
  },
  banheiro: {
    nome: 'Banheiro da rodoviária', chave: 'privada_banheiro3d_v1', cache: 'banheiro3d-layout', padrao: CENA_BANHEIRO, env: 0.3, far: 40, alto: BANHEIRO.alto,
    luz: { hemi: [0xe9f4ff, 0x6b6a62, 0.5], sol: { cor: 0xfff2dc, base: 2.6, dir: V(-1, -0.75, -0.25), alvo: V(1.5, 1.2, -1), cam: { left: -6, right: 6, top: 5, bottom: -5, near: 3, far: 28 } }, prench: 0.45, prench2: 0.6 },
    mundo(raiz) {
      const m = criarBanheiro(raiz);
      const janela = { z0: -1.6, z1: -0.2, y0: 2.3, y1: 2.95, x: BANHEIRO.dir - 0.1 };
      return { ...m, janela, feixe: criarFeixe(raiz, new THREE.Vector3(-1, -0.75, -0.25).normalize(), janela) };
    },
    eventos: ['fluorescente', 'descarga', 'barata', 'porta'],
  },
  prisao: {
    nome: 'Cela da prisão', chave: 'privada_prisao3d_v1', cache: 'prisao3d-layout', padrao: CENA_PRISAO, env: 0.22, far: 40, alto: PRISAO.alto,
    luz: { hemi: [0xd8e2ea, 0x55524c, 0.42], sol: { cor: 0xfff0d6, base: 4.2, dir: V(0.25, -0.62, 1).normalize(), alvo: V(-0.8, 0.6, 0.4), cam: { left: -5, right: 5, top: 5, bottom: -4, near: 2, far: 24 } }, prench: 0.35, prench2: 0.5 },
    mundo(raiz) {
      const m = criarPrisao(raiz);
      return { ...m, feixe: criarFeixeFundo(raiz, m.janelaFeixe, new THREE.Vector3(0.25, -0.62, 1).normalize()) };
    },
    eventos: ['sirene', 'grade', 'rato', 'holofote'],
  },
  bar: {
    nome: 'Bar do Vaso', chave: 'privada_bar3d_v1', cache: 'bar3d-layout', padrao: CENA_BAR, env: 0.32, far: 40, alto: BAR.alto,
    luz: { hemi: [0xffe9cc, 0x6e5a48, 0.55], sol: { cor: 0xfff0d6, base: 3.4, dir: V(-1, -0.45, -0.2), alvo: V(2.5, 0.8, 0.9), cam: { left: -6, right: 6, top: 5, bottom: -5, near: 3, far: 28 } }, prench: 0.5, prench2: 0.9 },
    mundo(raiz) { return criarBar(raiz); },
    eventos: ['gol', 'copo', 'neon', 'ventilador', 'tv'],
  },
};
export const IDS_AMBIENTES = Object.keys(AMBIENTES);

/** feixe de sol por uma janela na parede do FUNDO (prisão): volume aditivo da janela até o chão */
function criarFeixeFundo(parent, { x0, x1, y0, y1, z }, dir) {
  const cantos = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]].map((v) => new THREE.Vector3(...v));
  const m = criarFeixe(parent, dir, null, cantos);
  return m;
}
