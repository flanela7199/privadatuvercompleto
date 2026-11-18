// Outfit resolution shared by the panel (ui/src/state/config.ts) and the thumbnail generator
// (web/src/tools/gen-thumbs.js) so both see EXACTLY the same theme for every id.
//   custom outfits (config.outfits) > presets (web/presets) > themes (web/themes)
//   "extends" chains are merged with mergeTheme (materials per key, slots per socket)
//   every raw outfit goes through migrateOutfit (mustaches face -> lip_upper)
import { mergeTheme } from '../themes.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

const isMustache = (e) => typeof e?.id === 'string' && e.id.startsWith('mustache_');
/**
 * Old themes/configs wore mustaches on `face` (the bowl); they now live on `lip_upper` (the lid's
 * front edge, moves with the upper lip). Moves every mustache_* entry from slots.face to the end of
 * slots.lip_upper. An old-format outfit that `extends` another and overrides `face` without a
 * `lip_upper` gets `lip_upper: []`, so it still hides the parent's mustache like before.
 * Idempotent; never mutates `theme` (returns it unchanged when there is nothing to do).
 */
export function migrateOutfit(theme) {
  const face = theme?.slots?.face;
  if (!Array.isArray(face)) return theme;
  const moved = face.filter(isMustache);
  const lip = theme.slots.lip_upper;
  if (!moved.length && (Array.isArray(lip) || !theme.extends)) return theme;
  return {
    ...theme,
    slots: { ...theme.slots, face: face.filter((e) => !isMustache(e)), lip_upper: [...(Array.isArray(lip) ? lip : []), ...moved] },
  };
}

export function makeResolver({ themes, presets = {}, outfits = {} }) {
  const raw = (id) => migrateOutfit(outfits?.[id] || presets[id] || themes[id] || null);
  const resolve = (id, depth = 0) => {
    const t = raw(id);
    if (!t) return clone(migrateOutfit(themes.base));
    if (t.extends && depth < 6) return mergeTheme(raw(t.extends) ? resolve(t.extends, depth + 1) : clone(migrateOutfit(themes.base)), t);
    return clone(t);
  };
  return { raw, resolve };
}

/** web/presets/index.json + each preset (raw, may "extends"); missing index -> {} */
export async function loadPresets(base = '../presets/') {
  try {
    const r = await fetch(`${base}index.json`);
    if (!r.ok) return {};
    const out = {};
    await Promise.all((await r.json()).map(async (id) => {
      try { const t = await (await fetch(`${base}${id}.json`)).json(); out[t.id || id] = t; } catch (e) { console.warn('[preset]', id, e); }
    }));
    return out;
  } catch { return {}; }
}
