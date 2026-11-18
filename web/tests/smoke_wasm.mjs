// Same smoke test as smoke.mjs, but with the Rust/wasm rig (bytes injected: node has no file fetch).
import { readFileSync } from 'node:fs';
globalThis.PRIVADA_WASM_BYTES = readFileSync(new URL('../pkg/privada_wasm_bg.wasm', import.meta.url));
await import('./smoke.mjs');
const { loadWasm, WasmRig } = await import('../src/rig/wasmrig.js');
const rig = new WasmRig(await loadWasm(), 7);
rig.r.play('flush');
const t0 = performance.now();
for (let i = 0; i < 600; i++) { rig.r.set_input(Math.sin(i / 20), 0, (i % 40) / 40, 0, 0, 0, 0); rig.r.update(1 / 60); }
console.log(`wasm rig: ${((performance.now() - t0) / 600 * 1000).toFixed(0)} us/frame (incl. flush FX)`);
