machine: 12th Gen Intel(R) Core(TM) i5-1235U (12 threads), node v22.11.0, win32 10.0.19044; 3 runs x 3960 frames (+600 warm-up) per scenario

### tb.update() per frame, us (median of the per-run values; [min..max] across runs; CV%)

| scenario | mode | median | p95 | p99 | mean | +matrixWorld median | +matrixWorld p99 | headroom @60 (median) |
|---|---|---|---|---|---|---|---|---|
| idle_talk | js | 149 [135..185] 13.3% | 239 [231..327] 16.5% | 352 [333..523] 21.2% | 158 | 178 | 395 | 94x |
| idle_talk | wasm | 26 [20..34] 22% | 53 [26..70] 36.6% | 111 [48..122] 35.1% | 32 | 58 | 214 | 286x |
| flush | js | 147 [135..351] 47% | 606 [424..1014] 36.2% | 730 [646..1834] 50.6% | 255 | 177 | 784 | 94x |
| flush | wasm | 39 [19..45] 33% | 138 [74..142] 26.2% | 182 [81..202] 34.2% | 64 | 84 | 246 | 198x |
| paper | js | 317 [306..555] 29.3% | 514 [407..999] 40.3% | 791 [650..1608] 41.6% | 317 | 341 | 844 | 49x |
| paper | wasm | 114 [89..119] 12.5% | 181 [142..191] 12.3% | 235 [202..289] 14.8% | 113 | 147 | 304 | 113x |
| flips | js | 144 [118..292] 41.4% | 253 [147..401] 39% | 341 [175..632] 49.3% | 159 | 172 | 416 | 97x |
| flips | wasm | 24 [16..33] 28.1% | 44 [18..49] 36% | 68 [28..78] 37.5% | 28 | 58 | 127 | 289x |
| all | js | 609 [347..1064] 44% | 1485 [562..2174] 46.9% | 2720 [953..3565] 45.1% | 687 | 656 | 2971 | 25x |
| all | wasm | 146 [98..147] 17.4% | 218 [145..230] 18.9% | 244 [155..287] 24% | 130 | 178 | 294 | 94x |

### speedup JS/wasm (tb.update median; p99)

| scenario | median speedup | p99 speedup | Rust compute only (median / p99 us) | flush spew window median js / wasm |
|---|---|---|---|---|
| idle_talk | 5.79x | 3.19x | 11 / 26 | - |
| flush | 3.74x | 4.00x | 18 / 139 | 407 / 102 |
| paper | 2.77x | 3.37x | 87 / 170 | - |
| flips | 6.03x | 5.00x | 11 / 13 | - |
| all | 4.19x | 11.14x | 125 / 214 | 811 / 189 |

### breakdown (instrumented pass, exclusive us/frame, median of runs)

- idle_talk js: total=166.4, three_normals_stream=0, three_normals_paper=62.76, js_water_fx=2.87, js_paper_fx=14.63, js_lid_collision=23.49, js_matrix_world_anchor=56.56, js_accessories=1.82, js_springs_actions_rest=4.27
- idle_talk wasm: total=36.8, three_normals_stream=0, three_normals_paper=6.94, rust_compute=14.32, js_accessories=3.36, js_apply_pose_buffers_rest=12.18
- flush js: total=272.51, three_normals_stream=68.15, three_normals_paper=45.83, js_water_fx=30.13, js_paper_fx=14.11, js_lid_collision=55.82, js_matrix_world_anchor=54.04, js_accessories=1.74, js_springs_actions_rest=11.47
- flush wasm: total=59.45, three_normals_stream=0, three_normals_paper=4.11, rust_compute=41.26, js_accessories=2.42, js_apply_pose_buffers_rest=10.81
- paper js: total=313.83, three_normals_stream=0, three_normals_paper=61.18, js_water_fx=4.31, js_paper_fx=173.13, js_lid_collision=19.64, js_matrix_world_anchor=54.14, js_accessories=1.96, js_springs_actions_rest=8.61
- paper wasm: total=105.69, three_normals_stream=0, three_normals_paper=5.26, rust_compute=87.91, js_accessories=2.14, js_apply_pose_buffers_rest=10.38
- flips js: total=183.01, three_normals_stream=0, three_normals_paper=52.85, js_water_fx=5.66, js_paper_fx=17.75, js_lid_collision=22.97, js_matrix_world_anchor=68.03, js_accessories=2.59, js_springs_actions_rest=13.72
- flips wasm: total=26.95, three_normals_stream=0, three_normals_paper=3.97, rust_compute=10.82, js_accessories=2.04, js_apply_pose_buffers_rest=10.11
- all js: total=646.61, three_normals_stream=88.35, three_normals_paper=90.67, js_water_fx=50.99, js_paper_fx=226.54, js_lid_collision=36.26, js_matrix_world_anchor=113.88, js_accessories=5.6, js_springs_actions_rest=34.32
- all wasm: total=128.4, three_normals_stream=0, three_normals_paper=6, rust_compute=107.71, js_accessories=2.43, js_apply_pose_buffers_rest=12.26

### allocation / GC (median of runs)

| scenario | mode | bytes/frame | KB/s @60 | scavenges | major GC | GC us/frame |
|---|---|---|---|---|---|---|
| idle_talk | js | 38783 | 2272.5 | 8 | 0 | 0.667 |
| idle_talk | wasm | 7872 | 461.3 | 1 | 0 | 0.134 |
| flush | js | 101846 | 5967.5 | 24 | 0 | 1.638 |
| flush | wasm | 8080 | 473.4 | 1 | 0 | 0.167 |
| paper | js | 345188 | 20225.8 | 72 | 4 | 11.335 |
| paper | wasm | 10068 | 589.9 | 2 | 0 | 0.202 |
| flips | js | 38433 | 2251.9 | 8 | 0 | 1.346 |
| flips | wasm | 7847 | 459.8 | 1 | 0 | 0.098 |
| all | js | 368058 | 21565.9 | 79 | 4 | 15.982 |
| all | wasm | 9907 | 580.5 | 2 | 0 | 0.157 |

### correctness (run 0 traces; r = Pearson correlation js vs wasm)

- idle_talk: hinge js[0.006..0.814] wasm[0.006..0.814] r=1 rms=0; bodyY js[0..0] wasm[0..0] r=1 rms=0; bodyUpY js[0.9894..1] wasm[0.9894..1] r=1 rms=0; headPitch js[-0.3726..0.2484] wasm[-0.3726..0.2484] r=1 rms=0; pupilX js[-0.0658..0.0657] wasm[-0.0658..0.0657] r=1 rms=0; seatX js[0..0.058] wasm[0..0.058] r=1 rms=0; drops js[0..0] wasm[0..0] r=1 rms=0; foam js[0..0] wasm[0..0] r=1 rms=0; stream js[0..0] wasm[0..0] r=1 rms=0; paperPts js[1..11] wasm[1..11] r=0.9975 rms=0.087; tornPts js[0..0] wasm[0..0] r=1 rms=0; sfx js=4 wasm=4
- flush: hinge js[0.0051..1.2589] wasm[0.0051..1.2589] r=1 rms=0.001; bodyY js[-0.0033..0.0513] wasm[-0.0033..0.0513] r=1 rms=0; bodyUpY js[0.9935..1] wasm[0.9935..1] r=1 rms=0; headPitch js[-0.8331..0.1131] wasm[-0.8331..0.1131] r=1 rms=0.0001; pupilX js[-0.0047..0.0194] wasm[-0.0047..0.0194] r=1 rms=0; seatX js[0..0.0105] wasm[0..0.0105] r=1 rms=0; drops js[0..346] wasm[0..344] r=0.9982 rms=7.4579; foam js[0..45] wasm[0..47] r=0.9877 rms=2.5073; stream js[0..1] wasm[0..1] r=1 rms=0; paperPts js[1..11] wasm[1..11] r=0.9975 rms=0.087; tornPts js[0..0] wasm[0..0] r=1 rms=0; sfx js=77 wasm=68
- paper: hinge js[0.0104..0.4027] wasm[0.0104..0.4027] r=1 rms=0; bodyY js[0..0] wasm[0..0] r=1 rms=0; bodyUpY js[0.9887..1] wasm[0.9887..1] r=1 rms=0; headPitch js[-0.0791..0.3934] wasm[-0.0791..0.3934] r=1 rms=0; pupilX js[-0.0621..0.0349] wasm[-0.0621..0.0349] r=1 rms=0; seatX js[0..0.0109] wasm[0..0.0109] r=1 rms=0; drops js[0..0] wasm[0..0] r=1 rms=0; foam js[0..0] wasm[0..0] r=1 rms=0; stream js[0..0] wasm[0..0] r=1 rms=0; paperPts js[1..137] wasm[1..137] r=1 rms=0.1742; tornPts js[0..133] wasm[0..133] r=1 rms=0; sfx js=4 wasm=4
- flips: hinge js[0.006..0.7896] wasm[0.006..0.7896] r=1 rms=0; bodyY js[-0.0172..2.45] wasm[-0.0172..2.45] r=1 rms=0; bodyUpY js[-0.9989..1] wasm[-0.9989..1] r=1 rms=0; headPitch js[-0.5827..0.1951] wasm[-0.5827..0.1951] r=1 rms=0; pupilX js[-0.0044..0.0194] wasm[-0.0044..0.0194] r=1 rms=0; seatX js[0..0.011] wasm[0..0.011] r=1 rms=0; drops js[0..0] wasm[0..0] r=1 rms=0; foam js[0..0] wasm[0..0] r=1 rms=0; stream js[0..0] wasm[0..0] r=1 rms=0; paperPts js[1..11] wasm[1..11] r=0.9974 rms=0.125; tornPts js[0..0] wasm[0..0] r=1 rms=0; sfx js=8 wasm=8
- all: hinge js[0.0015..0.7466] wasm[0..0.8121] r=0.995 rms=0.0172; bodyY js[-0.0033..0.0513] wasm[-0.0033..0.0513] r=1 rms=0; bodyUpY js[0.9887..1] wasm[0.9887..1] r=1 rms=0; headPitch js[-0.3494..0.1585] wasm[-0.3494..0.1585] r=0.9999 rms=0.0017; pupilX js[-0.0644..0.064] wasm[-0.0644..0.064] r=1 rms=0; seatX js[0..0.0588] wasm[0..0.0588] r=0.9992 rms=0.0007; drops js[0..340] wasm[0..343] r=0.9976 rms=8.5302; foam js[0..51] wasm[0..52] r=0.9942 rms=1.8623; stream js[0..1] wasm[0..1] r=1 rms=0; paperPts js[1..137] wasm[1..137] r=1 rms=0.1605; tornPts js[0..133] wasm[0..133] r=1 rms=0; sfx js=79 wasm=76

### load

{"wasm":136465,"wasmGzip":55629,"wasmBrotli":46882,"glue":14214,"glueGzip":3351}
readMs: med 0.25 [0.22..0.34]
wasmBytes: med 136465 [136465..136465]
glueImportMs: med 2.5 [2.25..2.93]
compileMs: med 1.13 [0.93..1.28]
instantiateMs: med 1 [0.83..1.22]
memPagesAfterInit: med 17 [17..17]
rigCtorMs: med 1.22 [1.15..1.72]
memPagesAfterRig: med 20 [20..20]
firstUpdateMs: med 1.75 [1.69..2.33]
next59UpdatesMs: med 0.71 [0.66..0.77]
in-app wasm init (compile+instantiate, warm process): {"wasmInitMs":{"med":73.81,"min":56.6,"max":174.61,"cvPct":51.2,"runs":[174.6,73.8,56.6]},"importMs":{"js":{"med":67.29,"min":65.95,"max":92.12,"cvPct":16,"runs":[65.9,92.1,67.3]},"wasm":{"med":110.65,"min":67.83,"max":273.09,"cvPct":58.7,"runs":[273.1,110.6,67.8]}}}
memory: {"js":[{"start":{"rssMB":26.5,"heapUsedMB":4.46,"externalMB":1.62,"arrayBuffersMB":0.03},"afterImportsAndInit":{"rssMB":37.9,"heapUsedMB":8.61,"externalMB":1.86,"arrayBuffersMB":0.02},"endWithOneTuberLive":{"rssMB":149.4,"heapUsedMB":11.72,"externalMB":7.39,"arrayBuffersMB":5.74},"wasmPagesEnd":0,"wasmPagesBeforeLastTuber":0},{"start":{"rssMB":26.6,"heapUsedMB":4.46,"externalMB":1.62,"arrayBuffersMB":0.03},"afterImportsAndInit":{"rssMB":37.9,"heapUsedMB":8.61,"externalMB":1.86,"arrayBuffersMB":0.02},"endWithOneTuberLive":{"rssMB":146,"heapUsedMB":11.43,"externalMB":7.39,"arrayBuffersMB":5.74},"wasmPagesEnd":0,"wasmPagesBeforeLastTuber":0},{"start":{"rssMB":26.6,"heapUsedMB":4.46,"externalMB":1.62,"arrayBuffersMB":0.03},"afterImportsAndInit":{"rssMB":37.9,"heapUsedMB":8.61,"externalMB":1.86,"arrayBuffersMB":0.02},"endWithOneTuberLive":{"rssMB":147.5,"heapUsedMB":11.46,"externalMB":7.39,"arrayBuffersMB":5.74},"wasmPagesEnd":0,"wasmPagesBeforeLastTuber":0}],"wasm":[{"start":{"rssMB":26.5,"heapUsedMB":4.46,"externalMB":1.62,"arrayBuffersMB":0.03},"afterImportsAndInit":{"rssMB":44.7,"heapUsedMB":10.56,"externalMB":4.54,"arrayBuffersMB":0.21},"endWithOneTuberLive":{"rssMB":101.4,"heapUsedMB":14.04,"externalMB":13.96,"arrayBuffersMB":5.92},"wasmPagesEnd":77,"wasmPagesBeforeLastTuber":74},{"start":{"rssMB":35.2,"heapUsedMB":4.46,"externalMB":1.62,"arrayBuffersMB":0.03},"afterImportsAndInit":{"rssMB":48,"heapUsedMB":10.56,"externalMB":4.54,"arrayBuffersMB":0.21},"endWithOneTuberLive":{"rssMB":102.4,"heapUsedMB":13.78,"externalMB":13.08,"arrayBuffersMB":5.92},"wasmPagesEnd":63,"wasmPagesBeforeLastTuber":60},{"start":{"rssMB":26.6,"heapUsedMB":4.46,"externalMB":1.62,"arrayBuffersMB":0.03},"afterImportsAndInit":{"rssMB":45.2,"heapUsedMB":10.56,"externalMB":4.54,"arrayBuffersMB":0.21},"endWithOneTuberLive":{"rssMB":96.6,"heapUsedMB":13.78,"externalMB":13.08,"arrayBuffersMB":5.92},"wasmPagesEnd":63,"wasmPagesBeforeLastTuber":60}]}