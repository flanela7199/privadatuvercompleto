// Transição entre cenas ("descarga"): a imagem da cena que sai é sugada num redemoinho para dentro
// do vaso (e a que entra sai girando de dentro dele). Tudo na GPU, só durante a transição:
//   * capturar()  -> fotografa a cena atual numa render target (antes de trocar de cena)
//   * iniciar()   -> começa a animação
//   * render(fn)  -> substitui o stage.render enquanto a transição está ativa
// Modos: 'sai'   = cena nova ao vivo por baixo, a foto da antiga gira e some no ralo;
//        'entra' = foto da antiga some devagar, a cena nova (ao vivo) sai girando do ralo e cresce.
// tipo 'fade' = só dissolve (sem redemoinho).
import * as THREE from 'three';

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FS = /* glsl */`
uniform sampler2D tex; uniform float escala; uniform float p; uniform float giro; uniform float fade; uniform vec2 dreno; uniform float aspect;
varying vec2 vUv;
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main(){
  float e = p * p * (3.0 - 2.0 * p);
  vec2 d = vUv - dreno; d.x *= aspect;
  float r = length(d);
  // encolhe em direção ao ralo e gira mais forte perto dele (redemoinho de descarga)
  float k = mix(1.0, 0.015, pow(e, 0.8));
  float ang = giro * e * (1.2 + 3.5 / (1.0 + r * 4.0 / max(k, 0.05)));
  vec2 s = rot(-ang) * d / k; s.x /= aspect;
  vec2 uv = dreno + s;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 c = texture2D(tex, uv); c.rgb *= escala;   // compensa a exposição da cena antiga
  // água: fica azulada e escurece um pouco enquanto gira
  c.rgb = mix(c.rgb, c.rgb * vec3(0.78, 0.92, 1.08), e * 0.6);
  float a = c.a * fade * (1.0 - smoothstep(0.82, 1.0, e));
  gl_FragColor = vec4(c.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function criarTransicao(renderer, scene, camera) {
  const tam = new THREE.Vector2();
  const mkRT = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  let rtVelha = null, rtNova = null;
  const mat = () => new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, escala: { value: 1 }, p: { value: 0 }, giro: { value: 9 }, fade: { value: 1 }, dreno: { value: new THREE.Vector2(0.5, 0.5) }, aspect: { value: 1 } },
    vertexShader: VS, fragmentShader: FS, transparent: true, depthTest: false, depthWrite: false, toneMapped: true,
  });
  const mVelha = mat(), mNova = mat();
  const quadScene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const qVelha = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mVelha), qNova = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mNova);
  qVelha.frustumCulled = qNova.frustumCulled = false; qNova.renderOrder = 1;
  quadScene.add(qVelha, qNova);
  let t = null;   // { t0, dur, modo, tipo, fim }
  let expCap = 1;

  // a foto da cena antiga só é redimensionada na captura (setSize apaga o conteúdo); a da nova acompanha a janela
  function garantirRT(velhaTambem) {
    renderer.getDrawingBufferSize(tam);
    if (!rtVelha) { rtVelha = mkRT(); rtNova = mkRT(); }
    if (velhaTambem && (rtVelha.width !== tam.x || rtVelha.height !== tam.y)) rtVelha.setSize(tam.x, tam.y);
    if (rtNova.width !== tam.x || rtNova.height !== tam.y) rtNova.setSize(tam.x, tam.y);
  }
  function renderEm(rt) {
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(cc, ca); renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
  }
  /** fotografa o que está na tela agora (chamar ANTES de trocar a cena) */
  function capturar() {
    try { garantirRT(true); renderEm(rtVelha); expCap = renderer.toneMappingExposure; return true; } catch (e) { console.warn('[transição] captura falhou', e); return false; }
  }
  /**
   * @param {object} o  { modo: 'sai'|'entra', tipo: 'descarga'|'fade', dreno: [u, v] (0..1, origem embaixo), dur (s), fim() }
   */
  function iniciar(o) {
    t = { t0: performance.now(), dur: (o.dur ?? window.__transDur ?? 1.6) * 1000, modo: o.modo, tipo: o.tipo || 'descarga', fim: o.fim, x: 0 };
    const asp = tam.x / Math.max(1, tam.y);
    for (const m of [mVelha, mNova]) { m.uniforms.dreno.value.set(o.dreno[0], o.dreno[1]); m.uniforms.aspect.value = asp; m.uniforms.giro.value = t.tipo === 'fade' ? 0 : 9; }
    mVelha.uniforms.tex.value = rtVelha.texture; mNova.uniforms.tex.value = rtNova.texture;
  }
  function render(stageRender) {
    const x = Math.min(1, (performance.now() - t.t0) / t.dur); t.x = x;
    const fade = t.tipo === 'fade';
    mVelha.uniforms.escala.value = expCap / Math.max(1e-3, renderer.toneMappingExposure);
    const auto = renderer.autoClear;
    if (t.modo === 'sai') {
      stageRender();                                   // cena nova ao vivo
      mVelha.uniforms.p.value = fade ? 0 : x; mVelha.uniforms.fade.value = fade ? 1 - x : 1;
      qVelha.visible = true; qNova.visible = false;
      renderer.autoClear = false; renderer.render(quadScene, cam); renderer.autoClear = auto;
    } else {
      garantirRT(false); renderEm(rtNova);             // cena nova ao vivo -> textura
      // fundo transparente enquanto a cena nova ainda está saindo do ralo (o jogo continua aparecendo atrás no OBS)
      const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
      renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.setClearColor(cc, ca);
      mVelha.uniforms.p.value = 0; mVelha.uniforms.fade.value = 1 - Math.min(1, x * 1.6);
      mNova.uniforms.p.value = fade ? 0 : 1 - x; mNova.uniforms.fade.value = fade ? x : 1;
      qVelha.visible = true; qNova.visible = true;
      renderer.autoClear = false; renderer.render(quadScene, cam); renderer.autoClear = auto;
    }
    if (x >= 1) { const f = t.fim; t = null; f && f(); }
  }
  function cancelar() { t = null; }
  function setDreno(u, v) { for (const m of [mVelha, mNova]) m.uniforms.dreno.value.set(u, v); }
  return { capturar, iniciar, render, cancelar, setDreno, get ativa() { return !!t; }, get progresso() { return t ? t.x : 1; }, get modo() { return t?.modo; } };
}
