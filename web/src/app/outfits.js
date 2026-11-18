// Outfit resolution shared by the panel (ui/src/state/config.ts) and the thumbnail generator
// (web/src/tools/gen-thumbs.js) so both see EXACTLY the same theme for every id.
//   custom outfits (config.outfits) > presets (web/presets) > themes (web/themes)
//   "extends" chains are merged with mergeTheme (materials per key, slots per socket)
import { mergeTheme } from '../themes.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

export function makeResolver({ themes, presets = {}, outfits = {} }) {
  const raw = (id) => outfits?.[id] || presets[id] || themes[id] || null;
  const resolve = (id, depth = 0) => {
    const t = raw(id);
    if (!t) return clone(themes.base);
    if (t.extends && depth < 6) return mergeTheme(raw(t.extends) ? resolve(t.extends, depth + 1) : themes.base, t);
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
