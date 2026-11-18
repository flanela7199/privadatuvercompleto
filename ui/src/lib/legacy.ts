// The single doorway to the shared engine in ../web/src (same model, accessories, stage).
// Everything the panel renders goes through these exact modules.
export { ToiletTuber, DIM } from '../../../web/src/rig/ToiletTuber.js';
export { loadThemes, mergeTheme } from '../../../web/src/themes.js';
export { listAccessories, buildAccessory, MUSTACHE_IDS } from '../../../web/src/accessories/index.js';
export { ACCESSORY_INFO } from '../../../web/src/accessories/extra.js';
export { MaterialLib } from '../../../web/src/rig/materials.js';
export { CHANNELS } from '../../../web/src/input/visemes.js';
export { DEFAULT_CONFIG, ACTIONS } from '../../../web/src/app/defaults.js';
import '../../../web/src/accessories/glb.js';

export async function loadMic(): Promise<any> {
  return (await import('../../../web/src/input/mic.js')).Mic;
}
