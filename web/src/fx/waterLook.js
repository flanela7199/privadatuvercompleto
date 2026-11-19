// Water that reads as water on ANY background (dark, chroma green, white).
// A glass-like material (transmission ~1) only filters what is behind it: white water vanishes and on a
// dark background it turns black. So every water surface here is a semi-opaque TINTED body (the theme /
// panel colour, `materials.water.opacity`, default 0.65) with limited transmission, a little self-glow,
// strong clearcoat / specular highlights and depth attenuation; spray, splashes, drips and foam are a
// separate bright white semi-opaque material (no transmission) so the jet always pops.
import * as THREE from 'three';

export const WATER_OPACITY = 0.65;
const _c = new THREE.Color();

/** the theme's water opacity (MaterialLib keeps the JSON spec in userData.spec) */
export function waterOpacity(mat) {
  const o = +(mat?.userData?.spec?.opacity ?? WATER_OPACITY);
  return Number.isFinite(o) ? Math.min(1, Math.max(0.1, o)) : WATER_OPACITY;
}

/**
 * Tune a (cloned) water material in place for one use:
 *   'bowl'   water in the bowl (more transmission: the porcelain shows through, still tinted)
 *   'stream' the jet column
 *   'puddle' floor puddle (no transmission; its opacity is driven per frame, scaled by `opacityScale`)
 *   'spray'  drops / splashes / drips: bright white, a touch of the tint, semi-opaque
 *   'foam'   froth / bubbles: whiter and softer
 */
export function tuneWater(m, kind) {
  const spec = m.userData?.spec || {};
  const O = waterOpacity(m);
  const tint = _c.copy(m.color);
  m.transparent = true;
  m.metalness = 0;
  m.ior = 1.33;
  if ('clearcoat' in m) { m.clearcoat = 1; m.clearcoatRoughness = 0.04; }
  if ('specularIntensity' in m) m.specularIntensity = 1;
  m.envMapIntensity = Math.max(m.envMapIntensity ?? 1, 1.5);
  if (m.attenuationColor) {
    if (spec.attenuationColor) m.attenuationColor.set(spec.attenuationColor);
    else m.attenuationColor.copy(tint).multiplyScalar(0.8);
    m.attenuationDistance = spec.attenuationDistance ?? 0.4;
  }
  switch (kind) {
    case 'bowl':
      m.roughness = Math.min(m.roughness ?? 0.05, 0.05);
      m.transmission = Math.min(spec.transmission ?? 0.6, 0.6);
      m.thickness = Math.max(m.thickness ?? 0, 0.08);
      m.opacity = Math.min(1, O + 0.2);
      m.emissive?.copy(tint).multiplyScalar(0.08);
      break;
    case 'stream':
      m.roughness = Math.min(m.roughness ?? 0.05, 0.05);
      m.transmission = Math.min(spec.transmission ?? 0.45, 0.45);
      m.thickness = Math.max(m.thickness ?? 0, 0.05);
      m.opacity = O;
      m.emissive?.copy(tint).multiplyScalar(0.12);
      break;
    case 'puddle':
      m.roughness = 0.03;
      m.transmission = 0;
      m.thickness = 0;
      m.emissive?.copy(tint).multiplyScalar(0.06);
      m.userData.opacityScale = O / WATER_OPACITY;   // the FX drive opacity 0..0.7 per frame
      break;
    case 'spray':
    case 'foam': {
      const white = kind === 'foam' ? 0.85 : 0.7;
      m.color.set('#f4fbff').lerp(tint.clone ? tint.clone() : tint, 1 - white);
      m.transmission = 0;
      m.thickness = 0;
      m.roughness = kind === 'foam' ? 0.45 : 0.08;
      m.opacity = Math.min(1, (kind === 'foam' ? 0.82 : 0.85) * (0.6 + 0.4 * O / WATER_OPACITY));
      m.emissive?.copy(m.color).multiplyScalar(0.15);
      break;
    }
  }
  m.needsUpdate = true;
  return m;
}
