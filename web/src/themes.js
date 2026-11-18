// Theme loader. Themes are plain JSON in /themes (shared later with the Rust app).
// A theme may "extends" another: materials merge per key, slots replace per socket.
export async function loadThemes(base = './themes/') {
  const ids = await (await fetch(base + 'index.json')).json();
  const raw = {};
  await Promise.all(ids.map(async (id) => { raw[id] = await (await fetch(`${base}${id}.json`)).json(); }));
  const out = {};
  const resolve = (id) => {
    if (out[id]) return out[id];
    const t = raw[id];
    if (!t) throw new Error(`theme "${id}" not found`);
    out[id] = t.extends ? mergeTheme(resolve(t.extends), t) : t;
    return out[id];
  };
  ids.forEach(resolve);
  return out;
}

export function mergeTheme(a, b) {
  const materials = { ...a.materials };
  for (const [k, v] of Object.entries(b.materials || {})) materials[k] = { ...(a.materials?.[k] || {}), ...v };
  return {
    ...a, ...b,
    materials,
    slots: { ...a.slots, ...(b.slots || {}) },
    background: { ...a.background, ...(b.background || {}) },
  };
}
