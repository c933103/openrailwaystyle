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
| Track-count worker handoff for N bytes | N-byte private copy plus N-byte structured clone | N-byte private copy transferred; original cache buffers survive |
| Polar meshes from old views | Unbounded | 32 MiB / 64-entry budget; visible working set is protected |
| Settings disabled before first map frame | Only view/background honoured | All overlay settings honoured before source requests start |
| Removed polar layer | Programs retained; pending responses could upload | Programs, buffers and textures freed; pending responses cannot upload |

Caches never remove tiles currently drawn by MapLibre; evicting raw responses or off-view polar meshes only means a later return may reload them. A polar view whose visible working set exceeds the budget is kept intact. The snapshots and label output are unchanged. New tests exercise byte eviction, worker transfers without detached cache entries, initial source visibility and polar disposal.

Recheck on the current MapLibre release and on the Xperia with Chrome remote inspection before attributing any change in frame time or GPU memory to these fixes. Record network failures, wait for settled tiles, use one render listener, and compare identical views/settings with the same browser cache state.
