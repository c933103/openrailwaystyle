# Phone resource measurements

Measurements on 2026-10-01 used headless Chromium, a 412×915 touch viewport, DPR 2.625 and SwiftShader. These are browser emulation results, not Xperia/Android hardware measurements. GPU memory was unavailable. The canvas remained 1081×2401; resolution and relief defaults have not changed.

| View | Initial JS heap (MiB) | Main-thread work over 2 s (ms) | Cumulative resources |
| --- | ---: | ---: | ---: |
| Globe 1.8 | 20.20 | 2.91 | 34 |
| Europe 5 | 36.61 | 185.58 | 60 |
| Hong Kong 13 | 37.24 | 0.37 | 93 |
| Tokyo 16 | 33.20 | 156.96 | 138 |
| Tokyo, 50% detail | 57.94 | 0.67 | 140 |
| Tokyo, 25% detail | 32.85 | 0.38 | 142 |

Requests were still settling in some views, so the main-thread figures must not be interpreted as stable idle CPU. Heap changes include garbage collection and do not establish a performance improvement. Network errors and hardware GPU memory need a real-device follow-up. The original probe's accumulating render listeners were excluded from these results.

The fixes target verified retention/copy/initialisation behaviour, with deterministic before/after checks:

| Behaviour | Before | After |
| --- | --- | --- |
| Retaining 120 raw 1 MiB responses | 120 MiB (count cap 240) | 24 MiB byte budget, also count capped |
| Axle lookup with N ways and K distinct tag groups | N parsed records plus a temporary N-entry array and second Map | K shared immutable records decoded directly into one Map |
| Track-count worker handoff for N bytes | N-byte private copy plus N-byte structured clone | N-byte private copy transferred; original cache buffers survive |
| Polar meshes from old views | Unbounded | 32 MiB / 64-entry budget; visible working set is protected |
| Settings disabled before first map frame | Only view/background honoured | All overlay settings honoured before source requests start |
| Removed polar layer | Programs retained; pending responses could upload | Programs, buffers and textures freed; pending responses cannot upload |

Caches never remove tiles currently drawn by MapLibre; evicting raw responses or off-view polar meshes only means a later return may reload them. A polar view whose visible working set exceeds the budget is kept intact. The snapshots and label output are unchanged. New tests exercise byte eviction, worker transfers without detached cache entries, initial source visibility and polar disposal.

Recheck on the current MapLibre release and on the Xperia with Chrome remote inspection before attributing any change in frame time or GPU memory to these fixes. Record network failures, wait for settled tiles, use one render listener, and compare identical views/settings with the same browser cache state.

## MapLibre 5.24 integration

A second run used the same 5.24.0 library and globe compatibility code on both the old and updated cache implementations. All 131 integration tests passed, and desktop/portrait/landscape UI checks reported no page errors. A single render listener was used for all views.

| View | Heap before / after (MiB) | Main-thread work before / after over 2 s (ms) | Cumulative failed requests before / after |
| --- | ---: | ---: | ---: |
| Globe | 35.25 / 36.67 | 0.75 / 0.70 | 22 / 22 |
| Europe | 24.25 / 24.12 | 0.72 / 3.79 | 47 / 47 |
| Hong Kong | 30.98 / 30.58 | 1.03 / 0.60 | 100 / 102 |
| Tokyo | 33.34 / 37.50 | 0.83 / 2.97 | 122 / 191 |
| Tokyo 50% | 46.05 / 35.07 | 0.96 / 163.21 | 144 / 266 |
| Tokyo 25% | 37.89 / 38.51 | 0.90 / 1.39 | 165 / 298 |

The two runs rendered the same feature counts at every sampled view and kept the same 1081×2401 canvas. Many API/tile requests failed or were still pending. Most samples recorded no repaints during the two-second window; the updated 50% sample recorded seven frames as work settled. These results show startup/compatibility and network limitations, not a measured frame-time improvement. The byte budgets and eliminated duplicate buffer copy above are deterministic; Xperia/PWA frame time and GPU-memory checks remain outstanding.

The axle lookup optimisation was added after task 30 landed. A 4,096-way regression confirms one parse for a shared tag group and unchanged way-ID values. This removes the per-way object duplication from the new view as well as its temporary full array and second Map.
