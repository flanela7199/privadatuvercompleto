// Objetos interativos: pequenos "eventos" de cada ambiente, disparados por atalho (ação evento:<nome>)
// ou sozinhos de vez em quando. Cada evento é uma animação curta + som; nada fica permanente
// (o que sai do lugar volta sozinho depois de alguns segundos).
import * as THREE from 'three';

export const NOMES_EVENTOS = {
  lampada: 'Lâmpada pisca', garrafa: 'Garrafa cai da escada', bandeira: 'Rajada de vento na bandeira', quadro: 'Quadro fica torto', tv: 'TV troca de canal',
  coco: 'Coco cai na cabeça', gaivota: 'Gaivota passa', onda: 'Onda grande', vento: 'Ventania',
  fluorescente: 'Lâmpada fluorescente pisca', descarga: 'Descarga na cabine', barata: 'Barata passa', porta: 'Porta da cabine bate',
  sirene: 'Sirene de alarme', grade: 'Guarda bate na grade', rato: 'Rato passa', holofote: 'Holofote pela janela',
  gol: 'GOL na TV', copo: 'Copo cai e quebra', neon: 'Neon pisca', ventilador: 'Ventilador dispara',
};

const suave = (v) => { v = Math.min(1, Math.max(0, v)); return v * v * (3 - 2 * v); };

/**
 * api = { amb, raiz, mundo, objs: Map(id->grupo), itens(tipo) -> [{it, g}], som(nome), reagir(acao),
 *         proximoCanal(), setCanal(id), tuberPos(outVec3) }
 */
export function criarEventos(api) {
  const ativos = [];
  /** anima: fn(k 0..1, dt, t) por `dur` segundos; fim() no final */
  const anima = (dur, fn, fim) => { const a = { t: 0, dur, fn, fim }; ativos.push(a); return a; };
  const espera = (seg, fn) => anima(seg, () => {}, fn);
  const _v = new THREE.Vector3();
  const local = (worldVec) => api.raiz.worldToLocal(worldVec.clone());

  /** objeto que sai do lugar e volta (guarda pos/rot e restaura) */
  function guardar(g) { return { p: g.position.clone(), r: g.rotation.clone(), s: g.scale.clone() }; }
  function restaurar(g, b) { g.position.copy(b.p); g.rotation.copy(b.r); g.scale.copy(b.s); }

  const ev = {
    /* ---------------- sala ---------------- */
    lampada() {
      const ls = api.itens('lampada'); if (!ls.length) return false;
      api.som('zumbido');
      for (const { g } of ls) anima(2.6, (k) => { g.userData.fator = k > 0.92 ? 1 : (Math.random() < 0.45 ? 0.05 : 1.2); }, () => { g.userData.fator = 1; });
    },
    garrafa() {
      const gs = api.itens('garrafa'); if (!gs.length) return false;
      const { g } = gs[0], b = guardar(g), y0 = g.position.y, x0 = g.position.x;
      let quiques = 0;
      anima(2.2, (k) => {
        // desce a escada pulando degrau por degrau (para +x), depois rola no chão (para +z)
        const k1 = Math.min(1, k / 0.6), k2 = Math.max(0, (k - 0.6) / 0.4);
        const salto = Math.abs(Math.sin(k1 * Math.PI * 4)) * 0.12 * (1 - k1);
        g.position.set(x0 + k1 * 0.9 + k2 * 0.25, Math.max(0, y0 * (1 - k1)) + salto, b.p.z + k2 * 0.9);
        g.rotation.set(Math.PI / 2 * Math.min(1, k1 * 3), 0, -k * 14);
        const q = Math.floor(k1 * 4); if (q > quiques && k1 < 1) { quiques = q; api.som('toc', { v: 1 - k1 * 0.6 }); }
      }, () => espera(7, () => restaurar(g, b)));
    },
    bandeira() {
      const bs = api.itens('bandeira'); if (!bs.length) return false;
      api.som('vento');
      for (const { g } of bs) anima(4, (k) => { g.userData.vento = Math.sin(k * Math.PI) * 2.2; }, () => { g.userData.vento = 0; });
    },
    quadro() {
      const qs = api.itens('quadro'); if (!qs.length) return false;
      const { g } = qs[Math.floor(Math.random() * qs.length)], b = guardar(g), lado = Math.random() < 0.5 ? -1 : 1;
      api.som('toc', { v: 1 });
      anima(1.8, (k) => { g.rotation.z = b.r.z + lado * (0.14 * (1 - k) * Math.sin(k * 18) + 0.12 * suave(k)); }, () => espera(18, () => anima(0.6, (k) => { g.rotation.z = b.r.z + lado * 0.12 * (1 - suave(k)); }, () => restaurar(g, b))));
    },
    tv() { if (!api.proximoCanal()) return false; },

    /* ---------------- ilha ---------------- */
    coco() {
      const cs = api.itens('coqueiro'); if (!cs.length) return false;
      const copa = cs[0].g.getObjectByName('copa'); if (!copa) return false;
      const ini = copa.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.15, 0));
      api.tuberPos(_v); const cabeca = _v.clone().add(new THREE.Vector3(0, 1.72, 0));
      const coco = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), new THREE.MeshStandardMaterial({ color: '#6b5326', roughness: 0.6 }));
      coco.castShadow = true; api.raiz.add(coco);
      // o coco "escorrega" da copa até em cima da cabeça (arco), quica e rola na areia
      const iniL = local(ini), cabL = local(cabeca), chaoL = cabL.clone().add(new THREE.Vector3(0.9, -1.6, 0.6)); chaoL.y = 0.11;
      let bateu = false;
      anima(2.4, (k) => {
        if (k < 0.45) { const u = k / 0.45; coco.position.lerpVectors(iniL, cabL, u); coco.position.y = iniL.y + (cabL.y - iniL.y) * u * u + Math.sin(u * Math.PI) * 0.4; }
        else { if (!bateu) { bateu = true; api.som('bonk'); api.reagir('no'); } const u = (k - 0.45) / 0.55; coco.position.lerpVectors(cabL, chaoL, u); coco.position.y = Math.max(0.11, cabL.y + Math.sin(u * Math.PI) * 0.5 - u * u * (cabL.y - 0.11 + 0.5)); }
        coco.rotation.x = k * 12;
      }, () => espera(6, () => { api.raiz.remove(coco); coco.geometry.dispose(); coco.material.dispose(); }));
    },
    gaivota() {
      const ave = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.8, side: THREE.DoubleSide });
      const corpo = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.25, 4, 8), m); corpo.rotation.z = Math.PI / 2; ave.add(corpo);
      const asas = [-1, 1].map((s) => { const a = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.16), new THREE.MeshStandardMaterial({ color: '#dcdcd6', side: THREE.DoubleSide })); a.position.set(0, 0, s * 0.3); a.rotation.x = Math.PI / 2; ave.add(a); return a; });
      ave.scale.setScalar(1.4); api.raiz.add(ave); api.som('gaivota');
      const z = -4 - Math.random() * 6, y = 5 + Math.random() * 2;
      anima(6, (k, dt, t) => {
        ave.position.set(-14 + k * 28, y + Math.sin(k * 6) * 0.5, z); ave.rotation.y = 0;
        const bate = Math.sin(t * 11) * 0.6; asas[0].rotation.x = Math.PI / 2 + bate; asas[1].rotation.x = Math.PI / 2 - bate;
      }, () => { api.raiz.remove(ave); });
    },
    onda() { if (!api.mundo.onda) return false; api.som('onda'); anima(3, (k) => api.mundo.onda(Math.sin(k * Math.PI)), () => api.mundo.onda(0)); },
    vento() {
      api.som('vento');
      const alvos = [...api.itens('guarda_sol'), ...api.itens('coqueiro')];
      const bases = alvos.map(({ g }) => guardar(g));
      anima(3.5, (k, dt, t) => { alvos.forEach(({ g }, i) => { g.rotation.z = bases[i].r.z + Math.sin(t * 9 + i) * 0.035 * Math.sin(k * Math.PI); }); }, () => alvos.forEach(({ g }, i) => restaurar(g, bases[i])));
    },

    /* ---------------- banheiro ---------------- */
    fluorescente() {
      const ts = api.mundo.tubos; if (!ts?.length) return false;
      const i = Math.floor(Math.random() * ts.length), tb = ts[i], luz = api.mundo.luzesInternas?.[i];
      api.som('zumbido');
      anima(3, (k) => { const on = k > 0.9 || Math.random() < 0.4; tb.mat.emissiveIntensity = on ? 2.4 : 0.05; if (luz) luz.intensity = on ? 6 : 0.2; }, () => { tb.mat.emissiveIntensity = 2.4; if (luz) luz.intensity = 6; });
    },
    descarga() {
      api.som('flush');
      const cab = api.itens('cabines')[0]; if (!cab) return;
      const portas = cab.g.userData.portas || [];
      for (const p of portas) anima(1.5, (k, dt, t) => { p.rotation.y = p.userData.base + Math.sin(t * 40) * 0.01 * (1 - k); });
    },
    barata() {
      const b = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: '#3b200e', roughness: 0.35 });
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), m); c.scale.set(1.8, 0.5, 1); b.add(c);
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.06, 4), m); p.position.set(-0.03 + k * 0.03, 0, s * 0.03); p.rotation.x = s * 1.1; b.add(p); }
      api.raiz.add(b); api.som('rato');
      const D = api.mundo.D || { esq: -4, dir: 4 }, z = 1.8 + Math.random() * 1.2;
      anima(3.4, (k, dt, t) => { b.position.set(D.dir - 0.3 - k * (D.dir - D.esq - 0.6), 0.012, z + Math.sin(k * 9) * 0.3); b.rotation.y = Math.PI + Math.cos(k * 9) * 0.5; }, () => api.raiz.remove(b));
    },
    porta() {
      const cab = api.itens('cabines')[0]; if (!cab) return false;
      const portas = cab.g.userData.portas || []; const p = portas[Math.floor(Math.random() * portas.length)]; if (!p) return false;
      const b = p.userData.base;
      anima(1.6, (k) => { p.rotation.y = k < 0.5 ? b - 1.3 * suave(k * 2) : b - 1.3 * (1 - suave((k - 0.5) * 2.2)); if (k > 0.95 && !p.userData.bateu) { p.userData.bateu = true; api.som('porta'); } }, () => { p.rotation.y = b; p.userData.bateu = false; });
    },

    /* ---------------- prisão ---------------- */
    sirene() {
      const s = api.mundo.sirene; if (!s) return false;
      api.som('sirene');
      const lc = api.mundo.luzCela, base = lc?.intensity ?? 6;
      anima(5.6, (k, dt, t) => {
        s.mat.emissiveIntensity = 3 * (0.5 + 0.5 * Math.sin(t * 9)); s.luz.intensity = 22;
        s.luz.target.position.set(s.luz.position.x - 2.4, 1, s.luz.position.z + Math.sin(t * 6) * 3);
        if (lc) lc.intensity = base * (0.35 + 0.3 * Math.sin(t * 9));
      }, () => { s.mat.emissiveIntensity = 0; s.luz.intensity = 0; if (lc) lc.intensity = base; });
    },
    grade() {
      const gr = api.mundo.grade; if (!gr) return false;
      api.som('metal'); const x0 = gr.position.x;
      anima(1.2, (k, dt, t) => { gr.position.x = x0 + Math.sin(t * 70) * 0.012 * (1 - k); }, () => { gr.position.x = x0; });
    },
    rato() {
      const r = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: '#5d5650', roughness: 0.9 });
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), m); c.scale.set(1.8, 0.8, 1); c.position.y = 0.05; r.add(c);
      const cauda = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.003, 0.22, 5), new THREE.MeshStandardMaterial({ color: '#c99a8f' })); cauda.rotation.z = Math.PI / 2 - 0.2; cauda.position.set(-0.17, 0.04, 0); r.add(cauda);
      api.raiz.add(r); api.som('rato');
      const D = api.mundo.D || { esq: -3, dir: 3, fundo: -2.4 };
      anima(2.6, (k) => { r.position.set(D.esq + 0.3 + k * (D.dir - D.esq), 0, D.fundo + 0.35 + Math.sin(k * 7) * 0.08); }, () => api.raiz.remove(r));
    },
    holofote() {
      const j = api.mundo.janelaFeixe; if (!j) return false;
      const sp = new THREE.SpotLight(0xe9f2ff, 60, 14, 0.18, 0.4, 1.2);
      sp.position.set((j.x0 + j.x1) / 2, j.y1 + 0.4, j.z - 2); api.raiz.add(sp, sp.target);
      anima(5, (k) => { sp.target.position.set(-2.5 + k * 5, 0, 1.8 + Math.sin(k * 5) * 0.6); }, () => { api.raiz.remove(sp, sp.target); sp.dispose(); });
    },

    /* ---------------- bar ---------------- */
    gol() {
      api.setCanal('futebol'); api.som('torcida'); api.reagir('jump');
      const n = api.mundo.neon, vs = api.itens('ventilador_teto');
      for (const { g } of vs) { const v0 = g.userData.vel; anima(4, (k) => { g.userData.vel = v0 * (1 + 2.5 * Math.sin(k * Math.PI)); }, () => { g.userData.vel = v0; }); }
      if (n) anima(3, (k, dt, t) => { n.mat.color.setScalar(Math.sin(t * 20) > 0 ? 3 : 0.4); }, () => n.mat.color.setScalar(2.2));
    },
    copo() {
      const ms = api.itens('mesa_bar'); if (!ms.length) return false;
      const { g } = ms[Math.floor(Math.random() * ms.length)];
      const b = new THREE.Box3().setFromObject(g), topo = local(new THREE.Vector3((b.min.x + b.max.x) / 2 + 0.25, b.max.y, (b.min.z + b.max.z) / 2 + 0.2));
      const copo = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.11, 14, 1, true), new THREE.MeshPhysicalMaterial({ color: '#e8f1f3', roughness: 0.05, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      const liq = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.08, 14), new THREE.MeshStandardMaterial({ color: '#e0a21a', roughness: 0.2, transparent: true, opacity: 0.85 }));
      liq.position.y = -0.012; copo.add(liq); copo.position.copy(topo).add(new THREE.Vector3(0, 0.055, 0)); api.raiz.add(copo);
      const cacos = [];
      anima(1.3, (k) => {
        if (k < 0.35) { copo.rotation.z = -suave(k / 0.35) * 0.4; copo.position.x = topo.x + suave(k / 0.35) * 0.12; }
        else { const u = (k - 0.35) / 0.65; copo.rotation.z = -0.4 - u * 4; copo.position.set(topo.x + 0.12 + u * 0.2, topo.y + 0.055 - u * u * topo.y, topo.z); }
      }, () => {
        api.som('vidro'); copo.visible = false;
        const cm = new THREE.MeshPhysicalMaterial({ color: '#eef6f8', roughness: 0.05, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
        for (let i = 0; i < 12; i++) { const c = new THREE.Mesh(new THREE.TetrahedronGeometry(0.015 + Math.random() * 0.015), cm); c.position.set(copo.position.x + (Math.random() - 0.5) * 0.4, 0.006, copo.position.z + (Math.random() - 0.5) * 0.4); c.rotation.set(Math.random() * 3, Math.random() * 3, 0); api.raiz.add(c); cacos.push(c); }
        const poca = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), new THREE.MeshStandardMaterial({ color: '#d39a16', roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false }));
        poca.rotation.x = -Math.PI / 2; poca.position.set(copo.position.x, 0.004, copo.position.z); poca.scale.set(1.3, 0.8, 1); api.raiz.add(poca); cacos.push(poca);
        espera(12, () => { for (const c of [copo, ...cacos]) { api.raiz.remove(c); c.geometry.dispose(); } });
      });
    },
    neon() {
      const n = api.mundo.neon; if (!n) return false;
      api.som('zumbido');
      anima(2.2, () => { const on = Math.random() < 0.5; n.mat.color.setScalar(on ? 2.2 : 0.15); n.luz.intensity = on ? 1.6 : 0.1; }, () => { n.mat.color.setScalar(2.2); n.luz.intensity = 1.6; });
    },
    ventilador() {
      const vs = api.itens('ventilador_teto'); if (!vs.length) return false;
      for (const { g } of vs) { const v0 = g.userData.vel, r0 = g.rotation.clone(); anima(4, (k, dt, t) => { g.userData.vel = v0 * (1 + 4 * Math.sin(k * Math.PI)); g.rotation.x = r0.x + Math.sin(t * 25) * 0.03 * Math.sin(k * Math.PI); }, () => { g.userData.vel = v0; g.rotation.copy(r0); }); }
      api.som('vento');
    },
  };

  return {
    disponiveis: () => (api.amb.eventos || []).filter((n) => ev[n]),
    disparar(nome) {
      if (!nome || nome === 'aleatorio') { const l = this.disponiveis(); nome = l[Math.floor(Math.random() * l.length)]; }
      const f = ev[nome]; if (!f) return false;
      try { return f() !== false; } catch (e) { console.warn('[eventos]', nome, e); return false; }
    },
    frame(dt) {
      for (let i = ativos.length - 1; i >= 0; i--) {
        const a = ativos[i]; a.t += dt;
        const k = Math.min(1, a.t / a.dur);
        try { a.fn(k, dt, a.t); } catch (e) { console.warn('[eventos]', e); a.t = a.dur; }
        if (a.t >= a.dur) { ativos.splice(i, 1); try { a.fim?.(); } catch (e) { console.warn('[eventos]', e); } }
      }
    },
    limpar() { for (const a of ativos.splice(0)) try { a.fim?.(); } catch { /* */ } },
  };
}
