// Keys/hashes for the static thumbnail set in web/thumbs (shared by generator and panel).
//   web/thumbs/index.json = { version, generated, items: { 'preset:<id>': {file, hash}, 'acc:<id>': {file, hash} } }
// preset hash = FNV-1a of the RESOLVED {materials, slots}; accessory hash = FNV-1a of "<id>:<ACC_ART_VERSION>".
// A hash mismatch means the static image is stale (still shown; regenerate with the generator page).
export const THUMBS_INDEX_VERSION = 1;
export const ACC_ART_VERSION = 1; // bump when accessory art changes, then regenerate web/thumbs

/** FNV-1a 32-bit, lowercase hex (valid in cache keys [a-z0-9_-]) */
export function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export const presetHash = (theme) => fnv(JSON.stringify({ m: theme.materials, s: theme.slots }));
export const accHash = (id) => fnv(`${id}:${ACC_ART_VERSION}`);
export const fileSafe = (id) => String(id).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
