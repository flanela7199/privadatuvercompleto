// The single doorway to the shared engine in ../web/src (same model, accessories, stage).
// Everything the panel renders goes through these exact modules.
export { ToiletTuber, DIM } from '../../../web/src/rig/ToiletTuber.js';
export { loadThemes, mergeTheme } from '../../../web/src/themes.js';
export { listAccessories, buildAccessory, MUSTACHE_IDS } from '../../../web/src/accessories/index.js';
export { ACCESSORY_INFO } from '../../../web/src/accessories/extra.js';
export { MaterialLib } from '../../../web/src/rig/materials.js';
export { CHANNELS } from '../../../web/src/input/visemes.js';
export { DEFAULT_CONFIG, ACTIONS } from '../../../web/src/app/defaults.js';
export { makeResolver, loadPresets, migrateOutfit } from '../../../web/src/app/outfits.js';
export { outfitThumbKey, accThumbKey } from '../../../web/src/app/thumbkeys.js';
import '../../../web/src/accessories/glb.js';

/**
 * Optional furniture pack (web/src/accessories/furniture.js: registers its accessories and exports
 * FURNITURE_INFO). Loaded through import.meta.glob so the panel still builds when the file is absent.
 */
const furnitureMods = import.meta.glob('../../../web/src/accessories/furniture.js');
export async function loadFurniture(): Promise<Record<string, any>> {
  const load = Object.values(furnitureMods)[0];
  if (!load) return {};
  try { return ((await load()) as any).FURNITURE_INFO || {}; }
  catch (e) { console.error('[panel] furniture.js failed to load:', e); return {}; }
}

export async function loadMic(): Promise<any> {
  return (await import('../../../web/src/input/mic.js')).Mic;
}
