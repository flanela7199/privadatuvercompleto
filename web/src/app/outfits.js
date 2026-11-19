// Outfit resolution shared by the panel (ui/src/state/config.ts) and the thumbnail generator
// (web/src/tools/gen-thumbs.js) so both see EXACTLY the same theme for every id.
//   custom outfits (config.outfits) > presets (web/presets) > themes (web/themes)
//   "extends" chains are merged with mergeTheme (materials per key, slots per socket)
//   every raw outfit goes through migrateOutfit (face -> lip_upper / mouth / mouth_corner)
import { mergeTheme } from '../themes.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

const isMustache = (e) => typeof e?.id === 'string' && e.id.startsWith('mustache_');
/** mouth props that used to sit on the bowl front (`face`) and are now held by the lips */
const MOUTH_PROPS = { cigar: 'mouth_corner', pipe: 'mouth_corner', rose_in_mouth: 'mouth', tongue: 'mouth' };
const destOf = (e) => (isMustache(e) ? 'lip_upper' : MOUTH_PROPS[e?.id]);
/**
 * Old themes/configs wore mustaches and mouth props on `face` (the bowl). Mustaches now live on
 * `lip_upper` (the lid's front edge, moves with the upper lip); cigar/pipe on `mouth_corner` and
 * rose_in_mouth/tongue on `mouth` (both on the lower lip). Moves those entries from slots.face to the
 * end of their new slot. An old-format outfit that `extends` another and overrides `face` without a
 * `lip_upper` gets `lip_upper: []`, so it still hides the parent's mustache like before.
 * Idempotent; never mutates `theme` (returns it unchanged when there is nothing to do).
 */
export function migrateOutfit(theme) {
  const face = theme?.slots?.face;
  if (!Array.isArray(face)) return theme;
  const moving = face.filter(destOf);
  const lip = theme.slots.lip_upper;
  const hideParentLip = !Array.isArray(lip) && !!theme.extends;
  if (!moving.length && !hideParentLip) return theme;
  const slots = { ...theme.slots, face: face.filter((e) => !destOf(e)) };
  if (hideParentLip || moving.some(isMustache)) slots.lip_upper = [...(Array.isArray(lip) ? lip : []), ...moving.filter(isMustache)];
  for (const e of moving) {
    const d = destOf(e);
    if (d !== 'lip_upper') slots[d] = [...(Array.isArray(slots[d]) ? slots[d] : []), e];
  }
  return { ...theme, slots };
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
