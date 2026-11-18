# Rig benchmark: Rust/wasm vs pure JS (per-frame character logic)

## Resumo (pt-BR)

- **Quem é mais rápido:** o caminho Rust/wasm. O `ToiletTuber.update()` inteiro fica **~1,8x a 2,2x mais
  rápido na mediana** e **~1,7x a 2,8x mais rápido no p99** em todos os cenários. O pior caso medido (descarga
  + papel + olhar + boca, tudo junto) cai de **436 µs para 202 µs** na mediana e de **1,54 ms para 0,56 ms**
  no p99.
- **Só a lógica Rust** (`rig.update()` sozinho, sem three.js) custa **8–10 µs/frame** parado, falando, na descarga
  ou no backflip, e **~80–95 µs** com o papel (verlet). O código JS equivalente custa de 3,6x a 7x mais.
- **O que sobra em JS no modo Rust é a maior parte do custo:** 55–80% do frame no modo Rust é JS. Quase tudo é
  `computeVertexNormals()` do three.js para o tubo do jato e as tiras de papel, que os **dois** caminhos fazem igual
  (~50 µs/frame mesmo com o papel parado). Copiar a pose e os buffers custa só ~10–14 µs. Essa é a próxima otimização
  (ver "O que fazer").
- **GC:** o caminho JS aloca **39–370 KB por frame** (até ~21 MB/s com o papel), com 70–80 coletas menores e 4
  coletas completas em 66 s. Isso aparece como picos no p99 (até 5,6 ms numa execução). O modo Rust aloca
  **~10–13 KB/frame** em quase todas as execuções, com 2–3 coletas menores. Por isso o p99 dele é bem mais estável.
- **Faz diferença a 60/144 fps?** Pouca. Mesmo o JS no pior caso usa **~10% do orçamento de 16,7 ms (60 fps)** no p99
  e **~23% do orçamento de 6,9 ms (144 fps)**. Com Rust isso cai para **~3,7% e ~9%**. Nenhum dos dois caminhos
  derruba frame sozinho nesta máquina (laptop i5-1235U). O ganho real está nos picos e no GC: a 144 fps, um pico de
  GC de 1–5 ms no JS pode custar um frame, e o Rust praticamente remove esses picos.
- **Corretude:** os dois caminhos produzem o **mesmo movimento**. Dobradiça da tampa, altura e rotação do corpo
  no backflip, cabeça, pupilas e assento dão correlação r = 1,000 e RMS ≈ 0. Só as partículas de água, que
  dependem de números aleatórios, diferem um pouco (r ≈ 0,99, máximo de 359 contra 349 gotas).
- **Custo de carregar:** `.wasm` de 141 KiB (55,7 KB gzip, 47,1 KB brotli) + 13,7 KB de cola JS. Compilar e
  instanciar leva poucos ms (até ~60 ms pelo caminho assíncrono do app no Node). A memória wasm começa em 17 páginas
  (1,06 MiB) e cada `Rig` soma 3 páginas.

## Setup

| item | value |
|---|---|
| machine | 12th Gen Intel Core i5-1235U (2P+8E cores, 12 threads), Windows 10 LTSC 19044, on battery/AC unknown, no CPU pinning |
| runtime | portable Node v22.11.0 (V8 12.4). WebView2 also uses V8, so the JIT behaviour is close, but it is not the same build |
| wasm build | `cargo --release`, `opt-level = "s"` for privada-wasm, thin LTO, no `wasm-opt`, no SIMD (`tools/build_wasm.sh`) |
| theme | `themes/base.json` (crown + handlebar mustache, so accessory `userData.update` runs) |
| dt | fixed 1/60 s, same input sequence for both paths, `Math.random` replaced by a seeded mulberry32 (seed 12345) |
| method | 5 fresh processes per mode, interleaved js/wasm/js/wasm…; per scenario: 600 warm-up frames, then 3960 timed frames (66 s of animation, 12 flush cycles) |
| timer | `performance.now()` around each `tb.update()` call (sub-µs resolution in Node) |

The numbers below are the **median across the 5 runs** of each run's per-frame statistic. Brackets show the
**[min..max] across runs**, and CV is the coefficient of variation across runs. Run 0 was about 2x slower in both
modes (the machine was busy or on E-cores at the time). The median across runs absorbs that outlier, but variance on
this hybrid-core laptop is high (CV 10–45%).

Scenarios (inputs are preallocated, so the harness itself allocates nothing per frame):

1. `idle_talk`: mouse look sweeping (sin/cos) + viseme vector cycling every 5 frames (all 10 `VISEMES`), no actions.
2. `flush`: `play('flush')` every 330 frames (water jet: drops, foam, stream, puddle, ripples). The "spew" row
   covers only t = 1.6–3.4 s of each cycle, the heaviest frames.
3. `paper`: `play('paper')` every 280 frames (verlet strip, floor pile, tear at t = 3 s, torn strip falling).
4. `flips`: `backflip` then `jump` every 160 frames.
5. `all`: `flush` + `paper` together every 330 frames, with look + visemes.

## 1. Whole `ToiletTuber.update()` per frame (µs)

`+matrixWorld` adds `root.updateMatrixWorld()` right after the update. The three.js renderer does this anyway, so
this is the full CPU cost of the rig before any draw call. Headroom = 16 667 µs / (update + matrixWorld median).

| scenario | mode | median | p95 | p99 | mean | +matrixWorld median | +matrixWorld p99 | headroom @60 fps |
|---|---|---|---|---|---|---|---|---|
| idle_talk | js | 121 [109..239] 33% | 231 [193..395] | 399 [291..1374] | 136 | 151 | 465 | 111x |
| idle_talk | wasm | **69** [59..108] 23% | 116 [70..152] | 187 [131..202] | 76 | 100 | 250 | 167x |
| flush | js | 167 [96..267] 33% | 598 [397..1302] | 977 [668..5604] | 277 | 213 | 1075 | 78x |
| flush | wasm | **87** [50..97] 21% | 350 [199..454] | 504 [258..763] | 173 | 117 | 583 | 143x |
| flush spew window | js | 467 | 775 | 1210 | | | | |
| flush spew window | wasm | **298** | 424 | 602 | | | | |
| paper | js | 334 [314..686] 36% | 622 [559..1181] | 843 [804..4423] | 338 | 367 | 910 | 45x |
| paper | wasm | **158** [118..193] 17% | 266 [182..341] | 310 [281..458] | 165 | 191 | 382 | 87x |
| backflip+jump | js | 116 [105..243] 38% | 149 [136..330] | 238 [225..543] | 118 | 143 | 293 | 117x |
| backflip+jump | wasm | **61** [47..66] 12% | 92 [51..111] | 136 [60..168] | 63 | 88 | 187 | 189x |
| all at once | js | 436 [348..969] 45% | 963 [590..1741] | 1537 [1080..5835] | 461 | 475 | 1621 | 35x |
| all at once | wasm | **202** [171..222] 9% | 373 [302..447] | 558 [327..685] | 206 | 229 | 618 | 73x |

Speedup JS ÷ wasm:

| scenario | median | p99 |
|---|---|---|
| idle_talk | 1.76x | 2.13x |
| flush | 1.91x | 1.94x (spew window median 1.57x, p99 2.0x) |
| paper | 2.11x | 2.72x |
| backflip+jump | 1.91x | 1.74x |
| all at once | 2.16x | 2.75x |

What this means for the frame budget, worst scenario (`all`, update + matrixWorld):

| | 60 fps (16.67 ms) | 144 fps (6.94 ms) |
|---|---|---|
| JS median / p99 | 2.9% / 9.7% | 6.8% / 23% |
| wasm median / p99 | 1.4% / 3.7% | 3.3% / 8.9% |

## 2. Rust compute alone vs the JS that remains (item 6)

**Rust alone** is a bare `WasmRig` with no three.js objects, driven by the same inputs and actions. Each timed frame
calls `play` (when due), `set_input`, `update` and `drain_events`:

| scenario | Rust median | Rust p95 | Rust p99 | Rust mean |
|---|---|---|---|---|
| idle_talk | 8.7 | 11.9 | 15 | 9.2 |
| flush | 10 | 58 | 69 | 26 |
| paper | 77 | 109 | 130 | 71 |
| backflip+jump | 8.3 | 9.3 | 10 | 8.4 |
| all at once | 95 | 124 | 146 | 74 |

The flush median is low because most of the cycle has no jet; the p95/p99 come from the spew phase.

**Breakdown inside `tb.update()`** comes from an instrumented pass. Selected methods are wrapped on the instance,
and the time is exclusive (self time). Each wrapper adds about 0.05 µs per call, so the totals are a bit higher than
in table 1. All values are µs/frame, median of 5 runs.

| scenario | mode | total | Rust compute | three.js normals (stream / paper) | JS water FX | JS paper FX | JS lid collision | JS matrixWorld + paper anchor | accessories | rest (wasm: pose/buffer apply; js: springs/actions) |
|---|---|---|---|---|---|---|---|---|---|---|
| idle_talk | js | 134 | — | 0 / 55 | 3.6 | 17 | 16 | 34 | 2.5 | 5.7 |
| idle_talk | wasm | 74 | **10** | 0 / 51 | — | — | — | — | 2.4 | 11 |
| flush | js | 271 | — | 84 / 56 | 36 | 17 | 41 | 34 | 2.6 | 8.8 |
| flush | wasm | 142 | **30** | 59 / 41 | — | — | — | — | 2.5 | 14 |
| paper | js | 366 | — | 0 / 82 | 6.3 | 214 | 7.4 | 41 | 3.9 | 13 |
| paper | wasm | 175 | **79** | 0 / 76 | — | — | — | — | 2.6 | 12 |
| backflip+jump | js | 136 | — | 0 / 52 | 2.8 | 17 | 12 | 34 | 2.8 | 15 |
| backflip+jump | wasm | 73 | **10** | 0 / 49 | — | — | — | — | 2.1 | 11 |
| all at once | js | 443 | — | 77 / 72 | 38 | 186 | 14 | 38 | 3.5 | 14 |
| all at once | wasm | 193 | **84** | 50 / 50 | — | — | — | — | 2.3 | 12 |

How to read it:

- **The logic itself (Rust vs the JS code it replaced)** is everything except the shared three.js normals and the
  accessories. idle: 77 → 10 µs (**~7x**); flush: 128 → 30 µs (**~4.3x**); paper: 283 → 79 µs (**~3.6x**);
  flips: 81 → 10 µs (**~8x**); all: 290 → 84 µs (**~3.4x**). The paper verlet (10 constraint iterations over up
  to 150 points, plus the floor-pile hash map) is the slowest part of the Rust core.
- **The JS that remains in Rust mode:** applying the pose, morphs, scalars and FX buffers, plus creating the
  `Float32Array` views, plus the ripple and strip setup, costs **10–14 µs/frame**. Accessories cost ~2.5 µs. That is
  as much as or more than the Rust compute in most scenarios.
- **The real cost driver in Rust mode is three.js `computeVertexNormals()`:** 50–100 µs/frame, which is 55–70% of
  the whole update. The paper strip's normals are recomputed **every frame, even at rest**. The geometry is sized for
  `maxPts = 150` and `computeVertexNormals` ignores `drawRange`, so it walks the full buffer. The JS path pays exactly
  the same cost (`paperStrip.js:251`, `waterJet.js:311`).

## 3. Allocation and GC (`--expose-gc`, `v8.GCProfiler`)

Allocation is estimated as Σ(heapUsed before − after each GC) + net heapUsed growth over the 3960 frames, measured
after warm-up and a forced full GC.

| scenario | mode | bytes/frame (median) | KB/s @60 | scavenges / major GCs in 66 s | GC time µs/frame |
|---|---|---|---|---|---|
| idle_talk | js | 39 300 | 2 303 | 9 / 0 | 0.89 |
| idle_talk | wasm | 11 816 | 692 | 2 / 0 | 0.25 |
| flush | js | 104 870 | 6 145 | 24 / 0 | 1.95 |
| flush | wasm | 11 432 | 670 | 2 / 0 | 0.28 |
| paper | js | 345 020 | 20 216 | 72 / **4** | 11.4 |
| paper | wasm | 25 854 | 1 515 | 6 / 0 | 0.49 |
| backflip+jump | js | 38 585 | 2 261 | 8 / 0 | 0.76 |
| backflip+jump | wasm | 12 709 | 745 | 3 / 0 | 0.25 |
| all at once | js | 369 738 | 21 664 | 79 / **4** | 10.3 |
| all at once | wasm | 105 314 | 6 171 | 25 / 0 | 1.72 |

- JS allocation is stable from run to run. It comes from the paper strip (`newPoint` Vector3 clones,
  `pts.splice`, `Map` cells), the water FX temporaries, and the per-frame `{...}` override and spring objects.
- wasm mode allocation is **bimodal across runs**. Most scenario runs sit at 9–14 KB/frame, but some runs measured
  70–215 KB/frame for the same scenario (for example `all`: 14 / 27 / 105 / 174 / 215 KB). The cause was not
  isolated. Likely suspects are V8 re-optimising the apply code, or old `Rig`/tuber garbage (freed through
  wasm-bindgen's `FinalizationRegistry`) being collected inside the window. The steady per-frame floor is
  understood: about 13–16 new `Float32Array` views per frame (`WasmRig.view()`), the accessory `st` object,
  `drain_events()` strings, and the paper's `computeLineDistances()`, which allocates a new attribute every frame.
- Average GC time per frame is small in both modes (≤ 11 µs). The difference shows up in the tails: JS `p99` and `max`
  have multi-millisecond spikes (flush max p99 5.6 ms, all 5.8 ms in one run). The wasm path never went above
  0.76 ms p99.

## 4. Load, size and memory

| item | value |
|---|---|
| `privada_wasm_bg.wasm` | 144 287 B (141 KiB); gzip -9: 55 698 B; brotli: 47 148 B |
| `privada_wasm.js` glue | 13 676 B; gzip: 3 201 B |
| read file | 0.6 ms |
| `WebAssembly.compile` | 1.6 ms median [1.3..27.9] (Node 22 compiles wasm lazily, so functions compile on first call) |
| instantiate (`initSync`) | 2.0 ms |
| `new Rig()` | 2.7 ms (first call, cold) |
| first `rig.update()` | 2.6 ms cold (lazy compile), next 59 updates 1.4 ms total |
| in-app path `pkg.default({module_or_path: bytes})` (async `WebAssembly.instantiate`) | 63 ms median [54..72] in the bench process; ~20 ms in an empty process. With `--no-wasm-lazy-compilation` it was ~70 ms. The browser uses `instantiateStreaming` with its own tiering, so expect a different number |
| ToiletTuber construction (meshes, textures) | ~0.8–1.0 s for the first one (cold JIT), then 65–170 ms. **Same in both modes**: Rust does not touch the build |
| wasm linear memory | 17 pages (1.06 MiB) after init, **+3 pages (192 KiB) per `Rig`**. Linear memory never shrinks: after ~25 Rigs created and dropped in one bench process it stayed at 59–73 pages (3.7–4.6 MiB) |
| JS heap after imports (+ wasm init) | js 8.6 MB heapUsed / 38 MB RSS; wasm 10.6 MB heapUsed / 44.5 MB RSS |
| JS heap with one tuber live after all scenarios (after full GC) | js 11.4–11.7 MB heapUsed, external 7.4 MB, RSS 139–148 MB; wasm 13.7–14.0 MB heapUsed, external 12.8–13.7 MB (includes the wasm memory), RSS 98–102 MB |

RSS is ~45 MB lower in wasm mode after the same workload. That is the V8 heap that grew to absorb the JS path's
allocation churn, not data the rig keeps.

## 5. Correctness sanity check (same inputs, run 0 traces)

The traces read back from the three.js objects after each frame; r is the Pearson correlation js vs wasm over 2 scenario cycles.

| scenario | quantity | JS [min..max] | wasm [min..max] | r | RMS diff |
|---|---|---|---|---|---|
| idle_talk | lid hinge (rad) | 0.006..0.814 | 0.006..0.814 | 1.000 | 0 |
| idle_talk | head pitch, pupil x, seat | identical | identical | 1.000 | 0 |
| flush | lid hinge | 0.0051..1.1894 | 0.0051..1.1894 | 1.000 | 0.0011 |
| flush | body y | -0.0033..0.0513 | -0.0033..0.0513 | 1.000 | 0 |
| flush | head pitch | -0.695..0.093 | -0.695..0.093 | 1.000 | 0.0001 |
| flush | live drops / foam (instances) | 0..359 / 0..45 | 0..349 / 0..46 | 0.998 / 0.990 | 7.9 / 2.5 |
| paper | paper points / torn points | 1..137 / 0..133 | 1..137 / 0..133 | 1.000 / 1.000 | 0.17 / 0 |
| backflip+jump | body y (m) | -0.0172..2.45 | -0.0172..2.45 | 1.000 | 0 |
| backflip+jump | body up-vector y (−1 = upside down) | -0.996..1 | -0.996..1 | 1.000 | 0 |
| all at once | lid hinge | 0.0015..0.754 | 0..0.803 | 0.995 | 0.017 |
| all at once | live drops / foam | 0..357 / 0..50 | 0..337 / 0..49 | 0.998 / 0.986 | 8.5 / 2.9 |

The rigid motion (lid, body, head, eyes, seat, paper) matches to rounding. Particle counts differ slightly because
the Rust core has its own PRNG, so the random stream differs from the seeded `Math.random`. The `all` hinge has a
small offset for the same reason: in the combined case the jet and paper randomness feeds back into the lid
collision clamp. Sound-event counts: flush js 85 / wasm 68, all js 68 / wasm 75, paper 4/4, flips 8/8. The
difference is the random `drip` events.

## What to do with this

1. **Keep Rust as the default.** It is about 2x faster end to end, has 3–8x faster logic, a much flatter p99, and
   about 10x less GC churn, with identical motion.
2. **The next real win is in the JS that both paths share,** not in the Rust core. For the paper strips, either
   compute normals in Rust (it already has the positions) or skip `computeVertexNormals` when the strip did not
   change or is at rest. Also restrict the work to the draw range and drop the per-frame `computeLineDistances`
   allocation. That removes ~50 µs/frame at idle and ~100 µs during flush + paper, more than the whole Rust compute.
3. Cache the `Float32Array` views in `WasmRig` and recreate them only when `memory.buffer` changes. This removes most
   of the remaining per-frame allocation in Rust mode.
4. If the paper sim ever matters (it is the costliest Rust part, ~80 µs), try `opt-level = 3` and `wasm-opt -O3` for
   privada-wasm, and wasm SIMD. The current build is size-optimised (`"s"`) and has no `wasm-opt`.

Caveats: this is headless Node on one laptop, not WebView2 with a GPU. Rendering, skinning and uploads are not
included. The hybrid P/E-core CPU without pinning gives high run-to-run variance, so trust the medians and the ratios
more than any single number.

## Reproduce

```sh
source tools/env.sh
cp -r .tmp/node_modules_smoke/three web/node_modules/   # temporary 'three' shim
cd web && node tests/bench/run_all.mjs --runs 5           # ~4 min; --quick for a 10 s smoke run
rm -rf node_modules
```

- `web/tests/bench/shim.mjs`: canvas/document shims + seeded `Math.random`.
- `web/tests/bench/rig_bench.mjs <js|wasm|load>`: one process per mode. The mode is fixed at import time by `ToiletTuber.js`.
- `web/tests/bench/run_all.mjs`: runs the processes interleaved and aggregates them.
- `web/tests/bench/results/`: raw run JSON, `summary.json` and `summary.md` from the run reported here.
