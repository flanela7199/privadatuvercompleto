// Loads the Rust rig (crates/privada-wasm -> web/pkg, built by tools/build_wasm.sh).
// When it is missing (or ?nowasm / globalThis.PRIVADA_NO_WASM), returns null and the
// pure-JS rig in ToiletTuber.js keeps working.
//
// Buffers are zero-copy f32 views into wasm memory; see crates/privada-wasm/src/lib.rs.
export const BUF = {
  POSE: 0, DROPS: 1, FOAM: 2, STREAM_POS: 3, STREAM_UV: 4, RIPPLES: 5, PUDDLE: 6, PUDDLE_RADIAL: 7,
  PAPER_POS: 8, PAPER_UV: 9, PAPER_PERF: 10, TORN_POS: 11, TORN_UV: 12, TORN_PERF: 13, SCALARS: 14, MORPHS: 15,
  STREAM_NRM: 16, PAPER_NRM: 17, TORN_NRM: 18,
  PROP_POSES: 19, PROP_REST: 20, PAPER_COL: 21, TORN_COL: 22,   // props physics + wet paper (see docs/app-contract.md)
};
// mirror of privada_core::rig::sc
export const SC = {
  HINGE: 0, ST_MOUTH: 1, ST_TALK: 2, HEAD_YAW_VEL: 3, HEAD_PITCH_VEL: 4, ST_LIFT: 5, TIME: 6,
  SWIRL_OPACITY: 7, SWIRL_ROT: 8, WATER_TEX_OFFSET: 9, DT: 10, STREAM_VISIBLE: 11,
  PAPER_COUNT: 12, PAPER_PERF: 13, PAPER_OPACITY: 14, TORN_COUNT: 15, TORN_PERF: 16, TORN_OPACITY: 17,
  PUDDLE_VERSION: 18, BOWL_RISE: 19, PAPER_WET: 20, TORN_WET: 21, PROP_COUNT: 22, PROPS_ACTIVE: 23,
};

export async function loadWasm() {
  const off = globalThis.PRIVADA_NO_WASM || (typeof location !== 'undefined' && /[?&]nowasm\b/.test(location.search || ''));
  if (off) return null;
  try {
    const pkg = await import('../../pkg/privada_wasm.js');
    const bytes = globalThis.PRIVADA_WASM_BYTES; // tests can inject the .wasm bytes (no fetch in node)
    const exports = await pkg.default(bytes ? { module_or_path: bytes } : undefined);
    return { pkg, memory: exports.memory };
  } catch (e) {
    console.info('[rig] Rust/wasm rig unavailable, using the JS rig:', e?.message || e);
    return null;
  }
}

export class WasmRig {
  constructor(mod, seed = 1) {
    this.mod = mod;
    this.r = new mod.pkg.Rig(seed >>> 0);
    this.order = this.r.node_order().split(',');
    this.views = [];
    this.buffer = null;
  }
  /** cached zero-copy view; rebuilt only when wasm memory grows (old views detach) */
  view(id) {
    const buf = this.mod.memory.buffer;
    if (buf !== this.buffer) { this.buffer = buf; this.views = []; }
    return this.views[id] ||= new Float32Array(buf, this.r.buf_ptr(id), this.r.buf_len(id));
  }
}
