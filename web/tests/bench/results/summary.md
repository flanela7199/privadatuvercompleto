machine: 12th Gen Intel(R) Core(TM) i5-1235U (12 threads), node v22.11.0, win32 10.0.19044; 3 runs x 3960 frames (+600 warm-up) per scenario

### tb.update() per frame, us (median of the per-run values; [min..max] across runs; CV%)

| scenario | mode | median | p95 | p99 | mean | +matrixWorld median | +matrixWorld p99 | headroom @60 (median) |
|---|---|---|---|---|---|---|---|---|
| idle_talk | js | 115 [102..174] 23.9% | 192 [166..294] 25.5% | 262 [251..431] 26.2% | 122 | 137 | 308 | 122x |
| idle_talk | wasm | 18 [16..20] 9.5% | 25 [20..33] 21.4% | 47 [40..56] 14% | 19 | 41 | 87 | 410x |
| flush | js | 115 [113..133] 7.4% | 380 [352..457] 11.2% | 617 [506..710] 13.7% | 210 | 138 | 641 | 121x |
| flush | wasm | 18 [17..29] 26.3% | 69 [66..121] 29.7% | 73 [69..138] 33.7% | 35 | 40 | 101 | 420x |
| paper | js | 284 [275..355] 11.7% | 366 [358..565] 22.3% | 570 [565..796] 16.7% | 272 | 306 | 598 | 55x |
| paper | wasm | 80 [78..95] 9.2% | 133 [105..141] 12.1% | 159 [116..165] 14.8% | 75 | 100 | 204 | 168x |
| flips | js | 98 [96..126] 12.8% | 142 [115..169] 15.5% | 211 [160..214] 12.8% | 106 | 120 | 251 | 139x |
| flips | wasm | 16 [14..19] 10.9% | 17 [17..29] 26.3% | 21 [21..35] 24.6% | 16 | 38 | 45 | 443x |
| all | js | 347 [333..349] 2.1% | 579 [572..602] 2.2% | 967 [889..979] 4.3% | 333 | 370 | 1034 | 45x |
| all | wasm | 109 [104..118] 5.4% | 214 [172..215] 9.8% | 235 [225..268] 7.5% | 99 | 130 | 281 | 128x |

### speedup JS/wasm (tb.update median; p99)

| scenario | median speedup | p99 speedup | Rust compute only (median / p99 us) | flush spew window median js / wasm |
|---|---|---|---|---|
| idle_talk | 6.34x | 5.59x | 7.3 / 10 | - |
| flush | 6.59x | 8.44x | 8.8 / 61 | 347 / 61 |
| paper | 3.57x | 3.60x | 66 / 113 | - |
| flips | 6.19x | 9.92x | 6.5 / 7.6 | - |
| all | 3.19x | 4.11x | 102 / 178 | 446 / 136 |

### breakdown (instrumented pass, exclusive us/frame, median of runs)

- idle_talk js: total=116.39, three_normals_stream=0, three_normals_paper=37.15, js_water_fx=2.14, js_paper_fx=11.32, js_lid_collision=17.73, js_matrix_world_anchor=43.41, js_accessories=1.4, js_springs_actions_rest=3.24
- idle_talk wasm: total=16.91, three_normals_stream=0, three_normals_paper=2.55, rust_compute=7.46, js_accessories=1.39, js_apply_pose_buffers_rest=5.58
- flush js: total=241.53, three_normals_stream=60.33, three_normals_paper=40.08, js_water_fx=27.4, js_paper_fx=12.73, js_lid_collision=45.85, js_matrix_world_anchor=48.17, js_accessories=1.61, js_springs_actions_rest=6.87
- flush wasm: total=38.44, three_normals_stream=0, three_normals_paper=2.44, rust_compute=27.59, js_accessories=1.43, js_apply_pose_buffers_rest=7.12
- paper js: total=271.12, three_normals_stream=0, three_normals_paper=52.71, js_water_fx=3.18, js_paper_fx=148.8, js_lid_collision=14.83, js_matrix_world_anchor=44.58, js_accessories=1.49, js_springs_actions_rest=6.68
- paper wasm: total=68.05, three_normals_stream=0, three_normals_paper=3.26, rust_compute=57.94, js_accessories=1.2, js_apply_pose_buffers_rest=5.76
- flips js: total=117.81, three_normals_stream=0, three_normals_paper=36.37, js_water_fx=2.25, js_paper_fx=12.41, js_lid_collision=15.03, js_matrix_world_anchor=47.46, js_accessories=1.6, js_springs_actions_rest=10.47
- flips wasm: total=17.73, three_normals_stream=0, three_normals_paper=2.23, rust_compute=7.43, js_accessories=1.33, js_apply_pose_buffers_rest=6.65
- all js: total=344.87, three_normals_stream=55.78, three_normals_paper=52.63, js_water_fx=26.57, js_paper_fx=134.75, js_lid_collision=18.98, js_matrix_world_anchor=47.72, js_accessories=1.63, js_springs_actions_rest=7.67
- all wasm: total=120.86, three_normals_stream=0, three_normals_paper=5.51, rust_compute=99.17, js_accessories=2.45, js_apply_pose_buffers_rest=13.73

### allocation / GC (median of runs)

| scenario | mode | bytes/frame | KB/s @60 | scavenges | major GC | GC us/frame |
|---|---|---|---|---|---|---|
| idle_talk | js | 37049 | 2170.8 | 8 | 0 | 0.622 |
| idle_talk | wasm | 7903 | 463.1 | 1 | 0 | 0.076 |
| flush | js | 103680 | 6075 | 24 | 0 | 1.667 |
| flush | wasm | 8274 | 484.8 | 1 | 0 | 0.077 |
| paper | js | 347016 | 20333 | 73 | 4 | 6.389 |
| paper | wasm | 10440 | 611.7 | 2 | 0 | 0.147 |
| flips | js | 38406 | 2250.4 | 8 | 0 | 0.544 |
| flips | wasm | 7889 | 462.2 | 1 | 0 | 0.095 |
| all | js | 370182 | 21690.4 | 80 | 4 | 6.927 |
| all | wasm | 10016 | 586.9 | 2 | 0 | 0.178 |

### correctness (run 0 traces; r = Pearson correlation js vs wasm)

- idle_talk: hinge js[0.006..0.814] wasm[0.006..0.814] r=1 rms=0; bodyY js[0..0] wasm[0..0] r=1 rms=0; bodyUpY js[0.9894..1] wasm[0.9894..1] r=1 rms=0; headPitch js[-0.3726..0.2484] wasm[-0.3726..0.2484] r=1 rms=0; pupilX js[-0.0658..0.0657] wasm[-0.0658..0.0657] r=1 rms=0; seatX js[0..0.058] wasm[0..0.058] r=1 rms=0; drops js[0..0] wasm[0..0] r=1 rms=0; foam js[0..0] wasm[0..0] r=1 rms=0; stream js[0..0] wasm[0..0] r=1 rms=0; paperPts js[1..11] wasm[1..11] r=0.9975 rms=0.087; tornPts js[0..0] wasm[0..0] r=1 rms=0; sfx js=4 wasm=4
- flush: hinge js[0.0051..1.2589] wasm[0.0051..1.2589] r=1 rms=0.001; bodyY js[-0.0033..0.0513] wasm[-0.0033..0.0513] r=1 rms=0; bodyUpY js[0.9935..1] wasm[0.9935..1] r=1 rms=0; headPitch js[-0.8331..0.1131] wasm[-0.8331..0.1131] r=1 rms=0.0001; pupilX js[-0.0047..0.0194] wasm[-0.0047..0.0194] r=1 rms=0; seatX js[0..0.0105] wasm[0..0.0105] r=1 rms=0; drops js[0..346] wasm[0..344] r=0.9982 rms=7.4579; foam js[0..45] wasm[0..47] r=0.9877 rms=2.5073; stream js[0..1] wasm[0..1] r=1 rms=0; paperPts js[1..11] wasm[1..11] r=0.9975 rms=0.087; tornPts js[0..0] wasm[0..0] r=1 rms=0; sfx js=77 wasm=68
- paper: hinge js[0.0104..0.4027] wasm[0.0104..0.4027] r=1 rms=0; bodyY js[0..0] wasm[0..0] r=1 rms=0; bodyUpY js[0.9887..1] wasm[0.9887..1] r=1 rms=0; headPitch js[-0.0791..0.3934] wasm[-0.0791..0.3934] r=1 rms=0; pupilX js[-0.0621..0.0349] wasm[-0.0621..0.0349] r=1 rms=0; seatX js[0..0.0109] wasm[0..0.0109] r=1 rms=0; drops js[0..0] wasm[0..0] r=1 rms=0; foam js[0..0] wasm[0..0] r=1 rms=0; stream js[0..0] wasm[0..0] r=1 rms=0; paperPts js[1..137] wasm[1..137] r=1 rms=0.1742; tornPts js[0..133] wasm[0..133] r=1 rms=0; sfx js=4 wasm=4
- flips: hinge js[0.006..0.7896] wasm[0.006..0.7896] r=1 rms=0; bodyY js[-0.0172..2.45] wasm[-0.0172..2.45] r=1 rms=0; bodyUpY js[-0.9989..1] wasm[-0.9989..1] r=1 rms=0; headPitch js[-0.5827..0.1951] wasm[-0.5827..0.1951] r=1 rms=0; pupilX js[-0.0044..0.0194] wasm[-0.0044..0.0194] r=1 rms=0; seatX js[0..0.011] wasm[0..0.011] r=1 rms=0; drops js[0..0] wasm[0..0] r=1 rms=0; foam js[0..0] wasm[0..0] r=1 rms=0; stream js[0..0] wasm[0..0] r=1 rms=0; paperPts js[1..11] wasm[1..11] r=0.9974 rms=0.125; tornPts js[0..0] wasm[0..0] r=1 rms=0; sfx js=8 wasm=8
- all: hinge js[0.0015..0.7466] wasm[0..0.8121] r=0.995 rms=0.0172; bodyY js[-0.0033..0.0513] wasm[-0.0033..0.0513] r=1 rms=0; bodyUpY js[0.9887..1] wasm[0.9887..1] r=1 rms=0; headPitch js[-0.3494..0.1585] wasm[-0.3494..0.1585] r=0.9999 rms=0.0017; pupilX js[-0.0644..0.064] wasm[-0.0644..0.064] r=1 rms=0; seatX js[0..0.0588] wasm[0..0.0588] r=0.9992 rms=0.0007; drops js[0..340] wasm[0..343] r=0.9976 rms=8.5302; foam js[0..51] wasm[0..52] r=0.9942 rms=1.8623; stream js[0..1] wasm[0..1] r=1 rms=0; paperPts js[1..137] wasm[1..137] r=1 rms=0.1605; tornPts js[0..133] wasm[0..133] r=1 rms=0; sfx js=79 wasm=76

### load

{"wasm":137355,"wasmGzip":54951,"wasmBrotli":47132,"glue":14214,"glueGzip":3351}
readMs: med 0.19 [0.17..0.21]
wasmBytes: med 137355 [137355..137355]
glueImportMs: med 1.51 [1.39..1.99]
compileMs: med 0.75 [0.67..0.85]
instantiateMs: med 0.71 [0.68..0.78]
memPagesAfterInit: med 17 [17..17]
rigCtorMs: med 0.99 [0.93..3.25]
memPagesAfterRig: med 20 [20..20]
firstUpdateMs: med 1.5 [1.37..1.67]
next59UpdatesMs: med 0.54 [0.5..0.6]
in-app wasm init (compile+instantiate, warm process): {"wasmInitMs":{"med":45.39,"min":45.23,"max":49.1,"cvPct":3.8,"runs":[45.2,45.4,49.1]},"importMs":{"js":{"med":56.44,"min":51.52,"max":82.64,"cvPct":21.5,"runs":[51.5,56.4,82.6]},"wasm":{"med":59.07,"min":58.43,"max":60.07,"cvPct":1.1,"runs":[60.1,59.1,58.4]}}}
memory: {"js":[{"start":{"rssMB":26.3,"heapUsedMB":4.46,"externalMB":1.62,"arrayBuffersMB":0.03},"afterImportsAndInit":{"rssMB":38.1,"heapUsedMB":8.61,"externalMB":1.86,"arrayBuffersMB":0.02},"endWithOneTuberLive":{"rssMB":148.9,"heapUsedMB":11.72,"externalMB":7.39,"arrayBuffersMB":5.74},"wasmPagesEnd":0,"wasmPagesBeforeLastTuber":0},{"start":{"rssMB":26.6,"heapUsedMB":4.46,"externalMB":1.62,"arrayBuffersMB":0.03},"afterImportsAndInit":{"rssMB":38.1,"heapUsedMB":8.61,"externalMB":1.86,"arrayBuffersMB":0.02},"endWithOneTuberLive":{"rssMB":146.8,"heapUsedMB":11.44,"externalMB":7.39,"arrayBuffersMB":5.74},"wasmPagesEnd":0,"wasmPagesBeforeLastTuber":0},{"start":{"rssMB":26.6,"heapUsedMB":4.46,"externalMB":1.62,"arrayBuffersMB":0.03},"afterImportsAndInit":{"rssMB":38.2,"heapUsedMB":8.61,"externalMB":1.86,"arrayBuffersMB":0.02},"endWithOneTuberLive":{"rssMB":139.8,"heapUsedMB":11.43,"externalMB":7.39,"arrayBuffersMB":5.74},"wasmPagesEnd":0,"wasmPagesBeforeLastTuber":0}],"wasm":[{"start":{"rssMB":26.6,"heapUsedMB":4.46,"externalMB":1.62,"arrayBuffersMB":0.03},"afterImportsAndInit":{"rssMB":44.7,"heapUsedMB":10.56,"externalMB":4.54,"arrayBuffersMB":0.21},"endWithOneTuberLive":{"rssMB":100.1,"heapUsedMB":14.02,"externalMB":13.96,"arrayBuffersMB":5.92},"wasmPagesEnd":77,"wasmPagesBeforeLastTuber":74},{"start":{"rssMB":26.6,"heapUsedMB":4.46,"externalMB":1.62,"arrayBuffersMB":0.03},"afterImportsAndInit":{"rssMB":44.6,"heapUsedMB":10.56,"externalMB":4.54,"arrayBuffersMB":0.21},"endWithOneTuberLive":{"rssMB":98.1,"heapUsedMB":13.76,"externalMB":13.08,"arrayBuffersMB":5.92},"wasmPagesEnd":63,"wasmPagesBeforeLastTuber":60},{"start":{"rssMB":26.5,"heapUsedMB":4.46,"externalMB":1.62,"arrayBuffersMB":0.03},"afterImportsAndInit":{"rssMB":44.7,"heapUsedMB":10.56,"externalMB":4.54,"arrayBuffersMB":0.21},"endWithOneTuberLive":{"rssMB":95.4,"heapUsedMB":13.81,"externalMB":13.08,"arrayBuffersMB":5.92},"wasmPagesEnd":63,"wasmPagesBeforeLastTuber":60}]}