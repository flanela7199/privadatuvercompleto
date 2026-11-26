// Ilha tropical: areia, mar azul-turquesa com ondas e espuma na beira, céu com sol, ilhotas e nuvens
// lá longe. Tudo procedural (sem arquivos de imagem), leve: o mar e o céu são shaders simples.
// O "lugar do personagem" fica perto do centro da ilha; a câmera olha para o mar.
import * as THREE from 'three';

export const ILHA = { centro: [0, 1.2], raio: 7.2, agua: -0.06, ceu: 95 };
export const SOL_DIR = new THREE.Vector3(-0.55, -0.62, -0.56).normalize();   // sol de fim de tarde, um pouco à esquerda e ao fundo

function ruido2(x, y) {   // ruído de valor barato (determinístico)
  const h = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => ruido2(x, y) * 0.55 + ruido2(x * 2.1, y * 2.1) * 0.3 + ruido2(x * 4.3, y * 4.3) * 0.15;
/** raio da beira da ilha numa direção (contorno irregular) */
export function raioBeira(ang) { return ILHA.raio * (0.88 + 0.22 * fbm(Math.cos(ang) * 1.3 + 5, Math.sin(ang) * 1.3 + 5)); }

function texAreia() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#e8d3a6'; x.fillRect(0, 0, 512, 512);
  const img = x.getImageData(0, 0, 512, 512), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % 512, py = Math.floor(i / 4 / 512);
    const n = (Math.random() - 0.5) * 26 + (fbm(px / 40, py / 40) - 0.5) * 30;
    d[i] += n; d[i + 1] += n * 0.92; d[i + 2] += n * 0.8;
    if (Math.random() < 0.004) { d[i] = 250; d[i + 1] = 246; d[i + 2] = 236; }   // conchinhas/brilho
  }
  x.putImageData(img, 0, 0);
  // marquinhas de vento na areia
  x.strokeStyle = 'rgba(150,120,80,.12)'; x.lineWidth = 2;
  for (let k = 0; k < 60; k++) { const y = Math.random() * 512; x.beginPath(); x.moveTo(0, y); for (let xx = 0; xx <= 512; xx += 16) x.lineTo(xx, y + Math.sin(xx / 30 + k) * 4); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 7); t.anisotropy = 8;
  return t;
}

function criarAreia(parent) {
  const [cx, cz] = ILHA.centro, R = ILHA.raio * 1.6, n = 150;
  const geo = new THREE.PlaneGeometry(R * 2, R * 2, n, n); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cor = new Float32Array(pos.count * 3);
  const seca = new THREE.Color('#ffffff'), molhada = new THREE.Color('#b89a6c'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z), rb = raioBeira(Math.atan2(z, x));
    const t = r / rb;   // 1 = beira
    // platô suave (dunas baixinhas) que desce para dentro d'água depois da beira
    let y = 0.02 + (fbm(x * 0.35 + 9, z * 0.35) - 0.5) * 0.18 * Math.max(0, 1 - t * 1.1);
    y -= Math.max(0, t - 0.78) * 0.55 + Math.max(0, t - 1) * 0.9;
    if (r < 3.2) y *= Math.min(1, r / 3.2) * 0.6;            // em volta do personagem: chão plano
    pos.setY(i, y);
    c.copy(seca).lerp(molhada, THREE.MathUtils.smoothstep(t, 0.8, 0.98)); cor.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cor, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texAreia(), vertexColors: true, roughness: 0.95 }));
  m.position.set(cx, 0, cz); m.receiveShadow = true; m.name = 'areia'; parent.add(m);
  return m;
}

function criarMar(parent) {
  const [cx, cz] = ILHA.centro;
  const geo = new THREE.PlaneGeometry(ILHA.ceu * 2.2, ILHA.ceu * 2.2, 1, 1); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      t: { value: 0 }, centro: { value: new THREE.Vector2(cx, cz) }, raio: { value: ILHA.raio },
      solDir: { value: SOL_DIR.clone().negate() }, raso: { value: new THREE.Color('#3fe0d0') }, fundo: { value: new THREE.Color('#0b5aa0') },
      ceuCor: { value: new THREE.Color('#9fd6f2') }, forca: { value: 1 }, luz: { value: 1 }, ondaExtra: { value: 0 },
    },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */`
      uniform float t; uniform vec2 centro; uniform float raio; uniform vec3 solDir, raso, fundo, ceuCor; uniform float forca, luz, ondaExtra;
      varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
      float fbm(vec2 p){ return n2(p)*.55 + n2(p*2.1)*.3 + n2(p*4.3)*.15; }
      void main(){
        vec2 p = vW.xz;
        // normal das ondas (soma de senos + ruído)
        vec2 g = vec2(0.);
        g += vec2(.7,.3) * cos(dot(p, vec2(.7,.3))*1.6 + t*1.3) * .09;
        g += vec2(-.4,.9) * cos(dot(p, vec2(-.4,.9))*2.3 + t*1.7) * .06;
        g += vec2(.2,-1.) * cos(dot(p, vec2(.2,-1.))*4.1 + t*2.4) * .03;
        g += (vec2(fbm(p*1.3 + t*.25), fbm(p*1.3 - t*.21 + 7.)) - .5) * .25;
        vec3 n = normalize(vec3(-g.x, 1., -g.y));
        vec3 v = normalize(cameraPosition - vW);
        float r = length(p - centro);
        // raso (turquesa) perto da ilha -> fundo (azul) longe; borda irregular igual à da areia
        float ang = atan(p.y - centro.y, p.x - centro.x);
        float rb = raio * (0.88 + 0.22 * fbm(vec2(cos(ang), sin(ang)) * 1.3 + 5.));
        float k = smoothstep(rb * 0.95, rb * 2.4, r);
        vec3 agua = mix(raso, fundo, k) * luz;
        float fres = pow(1. - max(dot(n, v), 0.), 4.);
        vec3 c = mix(agua, ceuCor, fres * .65 + .08);
        // brilho do sol
        vec3 hv = normalize(solDir + v);
        c += vec3(1., .93, .78) * pow(max(dot(n, hv), 0.), 220.) * 3. * forca;
        // espuma na beira (vai e volta)
        float onda = sin(t * .9 + r * .8) * .5 + .5 + ondaExtra * 1.6;
        float esp = smoothstep(rb * (1.02 + .05 * onda), rb * (0.98 + .05 * onda), r) * smoothstep(rb * .9, rb * .97, r);
        esp *= smoothstep(.35, .6, fbm(p * 3. + t * .3));
        c = mix(c, vec3(.97, .98, 1.) * max(luz, .25), clamp(esp * (1.4 + ondaExtra * 2.), 0., .95));
        // névoa no horizonte
        float d = length(vW - cameraPosition);
        c = mix(c, ceuCor * 1.05, smoothstep(30., 90., d) * .75);
        gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat); m.position.set(cx, ILHA.agua, cz); m.name = 'mar'; m.renderOrder = -1; parent.add(m);
  return m;
}

function criarCeu(parent) {
  const geo = new THREE.SphereGeometry(ILHA.ceu, 32, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms: { solDir: { value: SOL_DIR.clone().negate() }, zen: { value: new THREE.Color('#2f86d6') }, hor: { value: new THREE.Color('#bfe7f6') }, forca: { value: 1 }, noite: { value: 0 }, luaDir: { value: new THREE.Vector3(0.4, 0.6, -0.7).normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: /* glsl */`
      uniform vec3 solDir, zen, hor, luaDir; uniform float forca, noite; varying vec3 vD;
      float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main(){
        float y = max(vD.y, 0.);
        vec3 c = mix(hor, zen, pow(y, .55));
        float s = max(dot(normalize(vD), normalize(solDir)), 0.);
        c += vec3(1., .85, .6) * (pow(s, 8.) * .35 + pow(s, 900.) * 6.) * forca * (1. - noite);   // halo + disco do sol
        // noite: estrelas e lua
        vec3 q = floor(normalize(vD) * 220.); float st = step(.997, h3(q)) * smoothstep(.02, .25, vD.y);
        c += vec3(st) * noite * (.6 + .4 * sin(h3(q + 1.) * 40.));
        float l = max(dot(normalize(vD), luaDir), 0.);
        c += vec3(.85, .9, 1.) * (pow(l, 2500.) * 4. + pow(l, 30.) * .12) * noite;
        if (vD.y < 0.) c = hor * 1.02;
        gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat); m.name = 'ceu'; m.renderOrder = -2; m.frustumCulled = false; parent.add(m);
  return m;
}

function criarNuvens(parent) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
  for (let k = 0; k < 14; k++) {
    const px = 40 + Math.random() * 176, py = 60 + Math.random() * 30, r = 18 + Math.random() * 26;
    const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 6.3); x.fill();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group(); g.name = 'nuvens'; parent.add(g);
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85, fog: false }));
    const a = -1.2 + (i / 8) * 2.4 + (Math.random() - 0.5) * 0.3, d = 70 + Math.random() * 15;
    s.position.set(Math.sin(a) * d, 12 + Math.random() * 16, -Math.cos(a) * d); s.scale.set(26 + Math.random() * 18, 10 + Math.random() * 6, 1);
    s.userData.v = 0.15 + Math.random() * 0.25; g.add(s);
  }
  return g;
}

function criarIlhotas(parent) {
  const g = new THREE.Group(); g.name = 'ilhotas'; parent.add(g);
  const verde = new THREE.MeshStandardMaterial({ color: '#2f6b3a', roughness: 1 }), areia = new THREE.MeshStandardMaterial({ color: '#e5d2a2', roughness: 1 });
  for (const [x, z, r, h] of [[-34, -58, 9, 3.2], [-22, -66, 5, 2.2], [40, -62, 12, 4.5], [56, -48, 6, 2.4]]) {
    const morro = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), verde); morro.scale.y = h / r; morro.position.set(x, ILHA.agua - 0.2, z); g.add(morro);
    const praia = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.12, r * 1.2, 0.3, 24), areia); praia.position.set(x, ILHA.agua - 0.1, z); g.add(praia);
  }
  return g;
}

/** monta a ilha dentro de `raiz`; devolve o chão (para clicar/assentar) e o que anima */
export function criarIlha(raiz) {
  const g = new THREE.Group(); g.name = 'ilha'; raiz.add(g);
  const ceu = criarCeu(g), mar = criarMar(g), areia = criarAreia(g), nuvens = criarNuvens(g);
  criarIlhotas(g);
  return {
    grupo: g, chao: areia,
    animar(t) {
      mar.material.uniforms.t.value = t;
      for (const s of nuvens.children) { s.position.x += s.userData.v * 0.016; if (s.position.x > 95) s.position.x = -95; }
    },
    aplicar(e) { mar.material.uniforms.forca.value = e.sol; ceu.material.uniforms.forca.value = e.sol; },
    onda(k) { mar.material.uniforms.ondaExtra.value = k; },
    diaNoite(i) {
      const u = ceu.material.uniforms, m = mar.material.uniforms;
      const zen = new THREE.Color('#2f86d6').lerp(new THREE.Color('#3a2f6b'), i.crepusculo * 0.5 * i.dia).lerp(new THREE.Color('#050a1c'), i.noite);
      const hor = new THREE.Color('#bfe7f6').lerp(new THREE.Color('#ff9a5c'), i.crepusculo * 0.85 * (i.dia > 0.02 ? 1 : 0.3)).lerp(new THREE.Color('#121a33'), i.noite * 0.95);
      u.zen.value.copy(zen); u.hor.value.copy(hor); u.noite.value = i.noite;
      if (i.dir && i.dia > 0.02) { u.solDir.value.copy(i.dir).negate(); m.solDir.value.copy(i.dir).negate(); }
      m.ceuCor.value.copy(hor).multiplyScalar(0.95); m.luz.value = 0.18 + 0.82 * i.dia;
      for (const s of nuvens.children) s.material.color.setScalar(0.25 + 0.75 * i.dia).lerp(new THREE.Color('#ffb48a'), i.crepusculo * 0.5 * i.dia);
    },
  };
}
