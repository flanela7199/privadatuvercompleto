// Transição entre cenas: o VASO ENGOLE o cenário (ou cospe o novo).
//   'sai'   (sala -> gameplay): o vaso abre a boca e vai voando do lugar dele na sala até o canto,
//            enquanto a sala inteira (foto tirada sem o vaso) é sugada para dentro da boca. No fim ele
//            fecha a boca, dá um gole e mastiga.
//   'entra' (gameplay -> sala): o vaso abre a boca no canto e vai até o lugar dele na sala enquanto
//            a sala nova sai da boca dele, crescendo até ocupar a tela.
// O vaso é desenhado AO VIVO por cima (com a boca mexendo de verdade); o cenário é uma textura
// distorcida num quad de tela cheia. Só roda durante a transição (fora dela não custa nada).
// tipo 'fade' = só dissolve, sem boca.
import * as THREE from 'three';

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FS = /* glsl */`
uniform sampler2D tex; uniform float escala; uniform float p; uniform float giro; uniform float fade; uniform vec2 dreno; uniform float aspect;
varying vec2 vUv;
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main(){
  float e = clamp(p, 0.0, 1.0);
  vec2 d = vUv - dreno; d.x *= aspect;
  float r = length(d);
  // sucção: tudo encolhe para a boca, e o que está perto dela vai primeiro (puxão mais forte perto)
  float k = mix(1.0, 0.004, pow(e, 0.75));
  float perto = 1.0 / (1.0 + r * 3.0 / max(k, 0.02));
  k *= mix(1.0, 0.35, e * perto);
  float ang = giro * e * (0.6 + 1.6 * perto);
  vec2 s = rot(-ang) * d / k; s.x /= aspect;
  vec2 uv = dreno + s;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 c = texture2D(tex, uv); c.rgb *= escala;
  // escurece um pouco ao entrar na "garganta"
  c.rgb *= 1.0 - 0.45 * smoothstep(0.55, 1.0, e);
  float a = c.a * fade * (1.0 - smoothstep(0.86, 1.0, e));
  gl_FragColor = vec4(c.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const suave = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
// composições das transições novas (velha = foto da cena antiga, nova = cena nova ao vivo, ambas com o vaso)
const FS_MIX = /* glsl */`
uniform sampler2D velha, nova; uniform float x, aspect, tempo, escVelha; uniform vec2 dreno; uniform int tipo;
varying vec2 vUv;
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec4 V(vec2 uv){ vec4 c = texture2D(velha, clamp(uv, 0., 1.)); c.rgb *= escVelha; return c; }
vec4 N(vec2 uv){ return texture2D(nova, clamp(uv, 0., 1.)); }
void main(){
  vec2 uv = vUv; vec4 c;
  if (tipo == 1) {            // DESCARGA COM ÁGUA: a água sobe, gira e desce pelo ralo levando a cena antiga
    const vec3 AG = vec3(.22, .52, .72);
    if (x < .5) {
      float nivel = smoothstep(0., .5, x) * 1.15 - .05;
      float lin = nivel + sin(uv.x * 18. + tempo * 6.) * .012 + sin(uv.x * 7. - tempo * 3.) * .018;
      float sob = step(uv.y, lin);
      vec2 ref = uv + vec2(sin(uv.y * 40. + tempo * 5.), cos(uv.x * 35. + tempo * 4.)) * .006 * sob;
      vec4 b = V(ref);
      vec3 col = mix(b.rgb, AG, .45 * sob) + vec3(.8) * smoothstep(.014, 0., abs(uv.y - lin));
      c = vec4(col, max(b.a, sob * .92));
    } else {
      float p = (x - .5) / .5;
      vec2 d = uv - dreno; d.x *= aspect; float r = length(d);
      float k = mix(1., .01, pow(p, .8));
      float ang = 7. * p * (1. + 2. / (1. + r * 5. / max(k, .05)));
      vec2 s = rot(-ang) * d / k; s.x /= aspect; vec2 u2 = dreno + s;
      vec4 n = N(uv);
      if (u2.x < 0. || u2.y < 0. || u2.x > 1. || u2.y > 1.) c = n;
      else { vec4 b = V(u2); float a = 1. - smoothstep(.85, 1., p); c = vec4(mix(n.rgb, mix(b.rgb, AG, .5), a), max(n.a, a * .95)); }
    }
  } else if (tipo == 2) {     // ARROTO: onda de choque sai da boca e "empurra" a cena antiga
    vec2 d = uv - dreno; d.x *= aspect; float r = length(d);
    float R = pow(smoothstep(.1, .85, x), 1.15) * 1.9;
    float anel = exp(-pow((r - R) * 12., 2.));
    vec2 dir = r > 1e-4 ? d / r : vec2(0.); dir.x /= aspect;
    vec2 desl = dir * anel * .07;
    float dentro = smoothstep(R + .01, R - .01, r);
    c = mix(V(uv - desl), N(uv - desl * .4), dentro);
    c.rgb += vec3(.75, 1., .45) * anel * .3;
    c.a = max(c.a, anel * .6);
  } else {                    // CORTINA DE PAPEL HIGIÊNICO: desenrola de cima e enrola de volta revelando a nova
    float borda = x < .5 ? 1.04 - smoothstep(0., .5, x) * 1.12 : -.08 + smoothstep(.5, 1., x) * 1.12;
    vec4 fundo = x < .5 ? V(uv) : N(uv);
    float off = uv.y - borda;
    if (off > 0.) {
      vec2 q = vec2(uv.x * aspect * 16., off * 16.);
      float los = abs(fract(q.x + q.y) - .5) + abs(fract(q.x - q.y) - .5);
      float picote = step(.985, fract(off * 2.4)) * step(.45, fract(uv.x * aspect * 42.));
      vec3 papel = vec3(.97, .96, .93) - smoothstep(.3, .5, los) * .05 - picote * .3;
      papel *= .86 + .14 * smoothstep(0., .12, off);
      c = vec4(papel, 1.);
    } else c = fundo;
    if (abs(off) < .045) { float k = off / .045; c = vec4(vec3(.98, .97, .94) * (.5 + .5 * sqrt(max(0., 1. - k * k))), 1.); }
    else if (off < -.045 && off > -.12) c.rgb *= .72 + .28 * smoothstep(-.045, -.12, off);
  }
  gl_FragColor = c;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const TIPO_MIX = { agua: 1, arroto: 2, papel: 3 };

export const curvas = {
  /** abertura da boca (0..1) durante a transição */
  boca(modo, x, tipo = 'descarga') {
    if (tipo === 'arroto') return suave(x / 0.08) * (1 - suave((x - 0.42) / 0.14));
    if (modo === 'sai') {
      const aberta = suave(x / 0.14) * (1 - suave((x - 0.8) / 0.07));
      const mastiga = x > 0.87 ? 0.4 * Math.max(0, Math.sin(((x - 0.87) / 0.13) * Math.PI * 2)) : 0;
      return Math.max(aberta, mastiga);
    }
    return suave((x - 0.02) / 0.14) * (1 - suave((x - 0.8) / 0.1));
  },
  /** gole: o vaso incha um pouco quando engole */
  gole(modo, x) { return modo === 'sai' ? Math.sin(Math.PI * clamp01((x - 0.8) / 0.16)) * 0.12 : 0; },
};

export function criarTransicao(renderer, scene, camera, { semVaso, soVaso, bocaMundo }) {
  const tam = new THREE.Vector2();
  const mkRT = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  let rtVelha = null, rtNova = null;
  const mat = () => new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, escala: { value: 1 }, p: { value: 0 }, giro: { value: 2.5 }, fade: { value: 1 }, dreno: { value: new THREE.Vector2(0.5, 0.5) }, aspect: { value: 1 } },
    vertexShader: VS, fragmentShader: FS, transparent: true, depthTest: false, depthWrite: false, toneMapped: true,
  });
  const mVelha = mat(), mNova = mat();
  const quadScene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const qVelha = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mVelha), qNova = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mNova);
  qVelha.frustumCulled = qNova.frustumCulled = false; qNova.renderOrder = 1;
  quadScene.add(qVelha, qNova);
  const mMix = new THREE.ShaderMaterial({
    uniforms: { velha: { value: null }, nova: { value: null }, x: { value: 0 }, aspect: { value: 1 }, tempo: { value: 0 }, escVelha: { value: 1 }, dreno: { value: new THREE.Vector2(0.5, 0.4) }, tipo: { value: 1 } },
    vertexShader: VS, fragmentShader: FS_MIX, transparent: true, depthTest: false, depthWrite: false, toneMapped: true,
  });
  const mixScene = new THREE.Scene(), qMix = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mMix); qMix.frustumCulled = false; mixScene.add(qMix);
  let t = null, expCap = 1;
  // câmera da cena antiga (A) -> câmera da cena nova (B): o vaso "voa" de um lugar para o outro
  const A = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 40, view: null, near: 0.1, far: 200 };
  const B = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 40, view: null, near: 0.1, far: 200 };
  const guardar = (o) => { o.pos.copy(camera.position); o.q.copy(camera.quaternion); o.fov = camera.fov; o.view = camera.view && camera.view.enabled ? { ...camera.view } : null; o.near = camera.near; o.far = camera.far; };
  const plena = (v, W, H) => v || { fullWidth: W, fullHeight: H, offsetX: 0, offsetY: 0, width: W, height: H };
  function aplicarCam(o) {
    camera.position.copy(o.pos); camera.quaternion.copy(o.q); camera.fov = o.fov; camera.near = o.near; camera.far = o.far;
    if (o.view) camera.setViewOffset(o.view.fullWidth, o.view.fullHeight, o.view.offsetX, o.view.offsetY, o.view.width, o.view.height); else camera.clearViewOffset();
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
  function misturarCam(k) {
    // posição/rotação/lente interpoladas; o deslocamento da imagem (view offset) também
    camera.position.lerpVectors(A.pos, B.pos, k); camera.quaternion.slerpQuaternions(A.q, B.q, k);
    camera.fov = A.fov + (B.fov - A.fov) * k; camera.near = Math.min(A.near, B.near); camera.far = Math.max(A.far, B.far);
    const W = innerWidth, H = innerHeight;
    if (!A.view && !B.view) camera.clearViewOffset();
    else {
      const a = plena(A.view, W, H), b = plena(B.view, W, H);
      const ox = a.offsetX / a.fullWidth + (b.offsetX / b.fullWidth - a.offsetX / a.fullWidth) * k;
      const oy = a.offsetY / a.fullHeight + (b.offsetY / b.fullHeight - a.offsetY / a.fullHeight) * k;
      camera.setViewOffset(W, H, ox * W, oy * H, W, H);
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
  const _b = new THREE.Vector3();
  function bocaUV() {
    bocaMundo(_b); _b.project(camera);
    return [_b.x * 0.5 + 0.5, _b.y * 0.5 + 0.5];
  }

  // a foto da cena antiga só é redimensionada na captura (setSize apaga o conteúdo); a da nova acompanha a janela
  function garantirRT(velhaTambem) {
    renderer.getDrawingBufferSize(tam);
    if (!rtVelha) { rtVelha = mkRT(); rtNova = mkRT(); }
    if (velhaTambem && (rtVelha.width !== tam.x || rtVelha.height !== tam.y)) rtVelha.setSize(tam.x, tam.y);
    if (rtNova.width !== tam.x || rtNova.height !== tam.y) rtNova.setSize(tam.x, tam.y);
  }
  function renderEm(rt, comVaso) {
    renderer.setRenderTarget(rt); renderer.clear();
    if (comVaso) renderer.render(scene, camera); else semVaso(() => renderer.render(scene, camera));
    renderer.setRenderTarget(null);
  }
  /** fotografa a cena atual (sem o vaso, se for a transição com boca) ANTES de trocar a cena */
  function capturar(tipo) {
    try { garantirRT(true); renderEm(rtVelha, tipo !== 'descarga'); expCap = renderer.toneMappingExposure; guardar(A); return true; }
    catch (e) { console.warn('[transição] captura falhou', e); return false; }
  }
  /** @param {object} o  { modo: 'sai'|'entra', tipo: 'descarga'|'fade', dur (s), fim() } */
  function iniciar(o) {
    const durs = { fade: 0.9, descarga: 2.1, agua: 2.6, arroto: 1.7, papel: 2.3 };
    t = { t0: performance.now(), dur: (o.dur ?? window.__transDur ?? durs[o.tipo] ?? 2.1) * 1000, modo: o.modo, tipo: o.tipo || 'descarga', fim: o.fim, x: 0 };
    mMix.uniforms.velha.value = rtVelha.texture; mMix.uniforms.nova.value = rtNova.texture; mMix.uniforms.aspect.value = tam.x / Math.max(1, tam.y);
    mMix.uniforms.tipo.value = TIPO_MIX[t.tipo] || 1;
    mVelha.uniforms.tex.value = rtVelha.texture; mNova.uniforms.tex.value = rtNova.texture;
    for (const m of [mVelha, mNova]) { m.uniforms.aspect.value = tam.x / Math.max(1, tam.y); m.uniforms.giro.value = o.modo === 'sai' ? 1.1 : -0.9; }
  }
  /** substitui o render normal enquanto a transição roda (a câmera já está na posição da cena nova) */
  function render(stageRender) {
    const x = window.__transX ?? Math.min(1, (performance.now() - t.t0) / t.dur); t.x = x;   // __transX: teste
    const sai = t.modo === 'sai', auto = renderer.autoClear;
    mVelha.uniforms.escala.value = expCap / Math.max(1e-3, renderer.toneMappingExposure);
    if (t.tipo === 'fade') {   // dissolver simples
      stageRender();
      mVelha.uniforms.p.value = 0; mVelha.uniforms.fade.value = 1 - suave(x); qVelha.visible = true; qNova.visible = false;
      renderer.autoClear = false; renderer.render(quadScene, cam); renderer.autoClear = auto;
      if (x >= 1) { const f = t.fim; t = null; f && f(); }
      return;
    }
    if (TIPO_MIX[t.tipo]) {   // água / arroto / papel: compõe a foto antiga com a cena nova (vaso incluso)
      const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
      garantirRT(false); renderEm(rtNova, true);
      const [u, v] = bocaUV();
      const U = mMix.uniforms;
      if (t.tipo === 'agua') U.dreno.value.set(u, Math.max(0.05, v - 0.06)); else U.dreno.value.set(u, v);
      U.x.value = x; U.tempo.value = performance.now() / 1000; U.escVelha.value = expCap / Math.max(1e-3, renderer.toneMappingExposure);
      renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.setClearColor(cc, ca);
      renderer.autoClear = false; renderer.render(mixScene, cam); renderer.autoClear = auto;
      if (x >= 1) { const f = t.fim; t = null; f && f(); }
      return;
    }
    guardar(B);
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    if (!sai) { garantirRT(false); renderEm(rtNova, false); }    // sala nova (sem o vaso) -> textura
    // câmera do vaso: vai da posição antiga para a nova
    misturarCam(suave((x - (sai ? 0.04 : 0.08)) / 0.72));
    const [u, v] = bocaUV();
    mVelha.uniforms.dreno.value.set(u, v); mNova.uniforms.dreno.value.set(u, v);
    renderer.setRenderTarget(null);
    if (!sai) renderer.setClearColor(0x000000, 0);                 // a sala ainda está saindo: o resto fica transparente
    renderer.clear();
    renderer.setClearColor(cc, ca);
    if (sai) {
      mVelha.uniforms.p.value = Math.pow(suave((x - 0.1) / 0.7), 1.35); mVelha.uniforms.fade.value = 1;
      qVelha.visible = true; qNova.visible = false;
    } else {
      mVelha.uniforms.p.value = 0; mVelha.uniforms.fade.value = 1 - suave(x / 0.3);
      mNova.uniforms.p.value = 1 - Math.pow(suave((x - 0.12) / 0.7), 0.8); mNova.uniforms.fade.value = 1;
      qVelha.visible = true; qNova.visible = true;
    }
    renderer.autoClear = false;
    renderer.render(quadScene, cam);
    renderer.clearDepth();
    soVaso(() => renderer.render(scene, camera));                // vaso ao vivo por cima, com a boca aberta
    renderer.autoClear = auto;
    aplicarCam(B);
    if (x >= 1) { const f = t.fim; t = null; f && f(); }
  }
  function cancelar() { t = null; }
  return { capturar, iniciar, render, cancelar, get ativa() { return !!t; }, get progresso() { return t ? t.x : 1; }, get modo() { return t?.modo; }, get tipo() { return t?.tipo; } };
}
