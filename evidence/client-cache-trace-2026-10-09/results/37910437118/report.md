# A04/A05: cache-enabled client baseline, 9 October 2026

## Result and scope

The corrected [isolated run 37910437118](https://github.com/c933103/openrailwaystyle/actions/runs/37910437118) passed all steps and produced six accepted fixture samples. **This is a measured baseline, not an application optimization or deployed-provider saving.** Application main is unchanged at `2875a0744912633f35cd6faba25e3260dae09d89`; measurement workflow/harness head is `035f48e66e5a26749a170acfbe2dcfd856867398`.

The experiment proves actual HTTP-cache reuse rather than merely browser reuse: cold startup made 129 loopback HTTP requests carrying 4,150,029 entity-body bytes; warm startup made one document request carrying 44,519 bytes. However usable times overlap, and rendering dominates this CPU-limited software-GPU runner. No app optimization is justified from this alone.

The previous failed run is retained separately: it produced six provisional samples, then correctly failed its final guard because the control page requested a missing favicon. Only control HTML and a regression changed for the successful run. The final unknown-request guard was neither removed nor weakened. Do not pool its timings with this accepted cohort or infer a speedup from their difference.

## Exact execution order and results

Each pair starts a new browser process/context. Within it, cold runs first, then its page closes after app storage is cleared; warm opens a new page in the same context, retaining HTTP cache. The sequence is exactly P1 cold → P1 warm → P2 cold → P2 warm → P3 cold → P3 warm. OS/file caches were not flushed. Order is not counterbalanced, and warm also reuses browser/OS state.

| Sample | Map-ready ms | Usable ms | First pan ms | Reset ms | Repeated pan ms | Startup main-thread CPU s |
|---|---:|---:|---:|---:|---:|---:|
| P1 cold | 828.4 | 3030.5 | 1253.6 | 674.5 | 818.0 | 0.578 |
| P1 warm | 678.2 | 3261.4 | 1077.6 | 527.0 | 978.3 | 0.652 |
| P2 cold | 847.9 | 3244.3 | 921.9 | 719.8 | 997.2 | 0.612 |
| P2 warm | 672.0 | 3109.0 | 920.8 | 871.8 | 604.0 | 0.608 |
| P3 cold | 846.9 | 3209.8 | 1207.6 | 475.3 | 1116.8 | 0.579 |
| P3 warm | 644.3 | 2899.7 | 1411.3 | 604.7 | 810.5 | 0.614 |

All six have zero page/console errors and five rendered fixture rail features at startup. The screenshot from P1 cold was also visually inspected: the real Atlas controls, railway line and track-count labels render over the intentionally empty synthetic basemap.

- Startup rAF p95 gaps: cold 516.7–533.4 ms, warm 283.5–400.0 ms. First-pan p95: 266.6–499.9 ms across samples. These are observed callback gaps, not compositor FPS or phone frame rates.
- Startup main-isolate sampled peak heap: 28.13–31.45 MiB. Whole-trace sampled maxima: 29.34–31.45 MiB. Post-GC retained page heap: 14.88–14.94 MiB. Sampling is every 100 ms, may miss peaks, and excludes worker/GPU memory.
- Thread-ticks CPU comes from CDP Performance counters, separate from stack-profile sampled elapsed time. Collection brackets include instrumentation/command overhead. All process IDs remain present across each measured phase; process-type counters are retained in `analysis.json`.

Full 24-phase metrics, all 42 origin/phase rows, exact unrounded values, long tasks and memory samples' derived maxima are in `phase-metrics.csv`, `per-origin.csv` and `analysis.json`.

## Origin, byte, cache and concurrency accounting

The following body-byte/wire counts are identical for every pair:

| Phase/cache | Synthetic origin label | Wire requests | Entity-body bytes |
|---|---|---:|---:|
| Cold startup | First party | 39 | 4,032,425 |
| Cold startup | openrailwaymap.app | 88 | 1,550 |
| Cold startup | tuiles.enliberte.fr | 2 | 116,054 |
| Warm startup | First party | 1 | 44,519 |
| Warm startup | Both provider labels | 0 | 0 |
| Cold first pan | openrailwaymap.app | 16 | 193 |
| Warm first pan | All | 0 | 0 |
| Reset and repeated pan, both cache states | All | 0 | 0 |

These labels identify the provider being simulated. **Those public servers were not contacted.** Distinct loopback ports preserve origin separation. The ORM startup set contains 24 railway-line tiles, 24 grouped-station-area tiles, 32 raw/localized station tiles and 8 signal tiles. Query-distinct localization requests are not mislabeled exact-URL duplicates.

- Warm startup records 88 ORM and two basemap HTTP-cache signals; first party has 38 cache signals plus the uncached document. Warm first pan has 16 ORM cache signals and no provider wire requests. Reset/repeated pan uses retained application/renderer data; a cached favicon request can still appear in CDP with zero wire transfer.
- No repeated exact URL/range wire key, application loading failure, premature server close or observed HTTP request finishing after a newer camera epoch occurred. This serialized idle-pan sequence does **not** test rapid-navigation cancellation, retries after outages, or prove no obsolete work in all flows.
- Observed provider outstanding requests peak at four in page CDP. Instant local responses give a server-handler peak of one for each provider; first-party handlers peak at six. These distinct counters are not interchangeable and do not demonstrate public-network peak load.
- Page CDP has no terminal response events for three first-party worker scripts and one blob worker per sample. Their first-party bodies are covered by the exact server ledger; CDP encoded-byte sums therefore have explicitly incomplete coverage. `per-origin.csv` retains known encoded bytes, decoded chunk bytes and missing-event counts separately. Entity-body bytes exclude HTTP headers, TLS and compression effects; these fixture responses are uncompressed.

### The cache policy is synthetic

Assets and synthetic data intentionally receive `Cache-Control: public, max-age=3600` plus content-derived ETags. Documents are `no-store`. A separate stale control uses `max-age=0, must-revalidate`. Before measurements, the browser proved that two fresh-cache reads caused one wire request, while two stale reads caused 200 then a conditional 304. No Playwright routing or CDP Fetch interception is installed.

**No production cache headers were observed or inferred.** The cold/warm byte difference demonstrates this fixture's caching behavior and existing client behavior under that policy, not a saving achieved on the deployed site or upstream providers.

## Measured bottleneck and readiness audit

The dominant measured resource is the software-rendering process: its startup CPU is 4.53–5.02 seconds, or 73.2–75.3% of summed stable-browser-process CPU, under a two-vCPU container quota. In cold samples, MapLibre's shader-program constructor accounts for roughly 1.05–1.19 seconds of sampled-stack elapsed time. Inspection of the pinned renderer maps that constructor to shader creation/compilation/linking. Sampled-stack elapsed time is not itself a CPU counter.

This identifies a **SwiftShader/CPU-constrained fixture-runner bottleneck**, not a proven physical-device GPU problem. Heavy instrumentation and software rendering can dominate the very small synthetic tile payload. Warm cache delivery can remove almost all wire bytes without consistently reducing usable time in three ordered pairs.

Usable requires body map-ready, map/tile loaded, actual rendered fixture geometry, fonts ready and two additional rAF callbacks. There is no fixed startup sleep or artificial fixture service delay. Playwright's readiness predicate uses rAF polling, and command round trips/predicate evaluation add overhead. The contribution of the final two rAFs was not separately timestamped, so it cannot be subtracted. Pan uses the genuine MapLibre idle event; its 30-second timer only rejects failure. A usable timestamp must not be substituted for first paint or physical interaction latency.

**Implementation decision: no production change from these measurements.** The useful next step is a comparable real-GPU/device or separately bounded renderer experiment with the same acceptance criteria and a clearly distinct cohort. App/provider improvement acceptance remains open until a targeted change demonstrates comparable before/after benefit without losing meaning, geometry, freshness, accessibility or recovery.

## Environment and isolation

- Node 22.23.3, Playwright 1.56.1, Chromium 141.0.7390.37, Linux x86-64, SwiftShader
- Desktop 1280×800/DPR1, English, UTC; no installed PWA or phone test
- Docker `--network none --cpus=2 --memory=4g --pids-limit=512 --shm-size=1g`; no DevTools CPU/network throttling. Host/browser-reported logical CPUs and RAM do not override those container limits.
- Official Playwright image executed by digest `sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a`; immutable action SHAs and read-only repository token
- Exact accepted Wuhan fixture line; z14 starts on its vertex `[114.35,30.58]`; 512-pixel east/reset/east pans. Different center/runtime/readiness from the earlier eight-sample baseline: do not compare across them causally.
- Deny-only proxy and restrictive CSP add containment. Browser-background attempts were rejected locally, summarized without unnecessary query strings in `network-containment.json`; zero public-provider delivery is guaranteed by network isolation, not measured from a live provider.

## Verification and durable-record boundary

All 17 transport tests pass in the runner. Six samples pass real cache and geometry gates and the strict final guard. Derived metric consistency plus five intentional corruptions are checked in both normal and optimized Python, with byte-identical receipts. `raw-artifact-manifest.json` lists all 56 original artifact files, lengths and SHA-256 values; every extracted file matches its ZIP member.

The successful artifact ZIP is 2,052,714 bytes, SHA-256 `3064665f298a5e4c7f9a260f42e26488ff4fc6d5cc6b2cef1a21bdff3e8ac445`, independently matching the Actions digest. [Raw artifact 11606690999](https://github.com/c933103/openrailwaystyle/actions/runs/37910437118/artifacts/11606690999) expires 8 November 2026. This publication durably saves the qualified report, structured metrics, environment/cache receipts, analysis/check scripts and full raw-file manifest. **Full raw ZIP/CPU-profile/timeline/screenshot archival is not yet complete.** The successful ZIP is preserved locally; no upload of it has been attempted. The separate failed-run ZIP upload remains pending/unknown and has not been changed, partitioned or rerouted.
