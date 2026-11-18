// THE thumbnail keys, shared by the character window (renders missing thumbnails while the app
// loads, thumb_put, then emits `thumbs-updated` {keys}), the panel (thumb_get) and the optional
// static seed generator (web/tools/gen-thumbs.html -> web/thumbs/index.json).
// Keys are valid app-cache keys: [a-z0-9_-]{1,96}.
export const THUMB_KEY_VERSION = 1;   // bump when the thumbnail look (camera/lights/size) changes
export const ACC_ART_VERSION = 1;     // bump when accessory art changes
export const THUMBS_INDEX_VERSION = 1;

/** FNV-1a 32-bit, lowercase hex */
export function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** canonical JSON (sorted keys) so the same outfit always hashes the same, whatever key order */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** hash of a RESOLVED theme's look: {materials, slots} only (names/ids don't matter) */
export const presetHash = (resolvedTheme) => fnv(canon({ m: resolvedTheme?.materials || {}, s: resolvedTheme?.slots || {} }));
export const accHash = (id) => fnv(`${id}:${ACC_ART_VERSION}`);
export const fileSafe = (id) => String(id).toLowerCase().replace(/[^a-z0-9_-]/g, '-');

/** cache key for an outfit thumbnail, from the RESOLVED theme -> "thumb_o-<hash>_v<n>" */
export function outfitThumbKey(resolvedTheme) {
  return `thumb_o-${presetHash(resolvedTheme)}_v${THUMB_KEY_VERSION}`;
}
/** cache key for an accessory thumbnail -> "thumb_a-<id>-<hash>_v<n>" (max 96 chars) */
export function accThumbKey(id) {
  return `thumb_a-${fileSafe(id).slice(0, 60)}-${accHash(id)}_v${THUMB_KEY_VERSION}`;
}
