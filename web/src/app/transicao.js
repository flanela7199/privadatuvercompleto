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
export const curvas = {
  /** abertura da boca (0..1) durante a transição */
  boca(modo, x) {
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
    try { garantirRT(true); renderEm(rtVelha, tipo === 'fade'); expCap = renderer.toneMappingExposure; guardar(A); return true; }
    catch (e) { console.warn('[transição] captura falhou', e); return false; }
  }
  /** @param {object} o  { modo: 'sai'|'entra', tipo: 'descarga'|'fade', dur (s), fim() } */
  function iniciar(o) {
    t = { t0: performance.now(), dur: (o.dur ?? window.__transDur ?? (o.tipo === 'fade' ? 0.9 : 2.1)) * 1000, modo: o.modo, tipo: o.tipo || 'descarga', fim: o.fim, x: 0 };
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
