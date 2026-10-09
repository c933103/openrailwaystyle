# A04/A05 cache-enabled client trace kit — prepared, not measured

Source: `c933103/openrailwaystyle` main `2875a0744912633f35cd6faba25e3260dae09d89`, tree `022a4b8cdc6d42ecb96da5969fe27217e4932fde` (9 October 2026).

## Result at publication

**No browser measurement completed. No bottleneck, improvement, cache saving or upstream reduction is established.** All 326 tracked source blobs matched GitHub. The pinned-source build, script syntax and 16 Node transport controls pass. Local Chromium cannot create its required Unix socket (`EPERM`), including the approved retry. The supported existing cloud browser cannot reach the command-local loopback fixture (`ERR_CONNECTION_REFUSED`). This is an execution limitation, not an application performance finding, and not an inferred user refusal.

`blocked-run.json` contains the precise acceptance state. `transport.tap` records the executed self-tests. Source identity and hashes are in `source-tree.json` and `source-verification.json`. A capable, authorized browser runner must run and validate the kit before any browser-performance claim. The prior eight routed samples on #150 remain historical; this kit does not relabel browser reuse as HTTP-cache warmth.

## Proposed measurement

- Three independent Chromium processes, each with a cold/new context then a new-page, same-context HTTP-cache-warm navigation. HTTP cache stays enabled: **no Playwright routing or CDP Fetch interception**. New pages discard application tile caches; HTTP cache stays in the context. App storage is cleared before closing the first page. Browser/OS reuse remains a confounder in a simple cold/warm difference; no causal timing improvement is inferred.
- Actual main application and built/pinned MapLibre renderer. Only two provider-origin literals are relocated to distinct loopback HTTP origins; every altered served file gets original/served hashes. ORM-shaped bytes use the accepted `ormVectorFixture` and exact unchanged Wuhan synthetic line. Basemap is the accepted empty PMTiles v3 fixture; first-party map-data collections are synthetic empty collections. This is sparse geometry, not geography/coverage acceptance.
- 1280×800, DPR1, desktop, English, UTC, SwiftShader; no CPU/network throttling. Start z14 at the fixture vertex `[114.35,30.58]`, ensuring geometry is on screen, then 512 px east, reset west, and repeated east pan. This differs from the old off-center trace and cannot be directly compared to it.
- Usable means map-ready, map/tile loaded, rendered fixture rail geometry, fonts ready and two animation frames. Pan completes at MapLibre's genuine idle event. Each stage has a timeout and fails rather than pretending missing geometry is ready.
- CDP thread-ticks metrics and 1 ms sampled CPU profiles, browser-process CPU counters, rAF gaps and long tasks, page-main-isolate heap sampled at 100 ms, then explicit post-GC retained heap. Sampled maxima can miss peaks; workers/GPU memory are excluded. rAF intervals are not compositor FPS; the real timeline is retained for inspection.
- CDP network events plus exact server body-byte ledgers identify cache observations, revalidation, requests, repeated URL/range keys, overlap, failures/cancellations and phase boundaries. Server payload bytes exclude protocol headers; CDP encoded bytes are different and must be separately named. Worker network coverage is cross-checked against server logs. Pending work at a new camera epoch does not alone prove it was obsolete/unnecessary. The serialized idle-pan scenario is not cancellation stress.
- Synthetic HTTP `Cache-Control: public, max-age=3600`, ETag and an explicit stale/revalidation control. These are experiment settings, **not observed provider policies**. A browser control must demonstrate one wire request for two cacheable reads and a real conditional 304 for the stale case before samples start.
- Deny-only local HTTP/CONNECT proxy and restrictive document/worker CSP. The intended remote-runner invocation additionally disables all external networking at the container boundary. No redirects, actual provider data, production refresh/deployment, metadata fallback or live load testing.

## Reproduction layout

Run in a disposable directory with these three files (`trace.mjs`, `fixture-server.mjs`, `transport.test.mjs`) beside a `source/` checkout/archive of the exact source commit. Use Node 22.23.3, the source package-lock, Playwright 1.56.1 and a supported Chromium binary. Install dependencies and prepare the browser before disabling external networking; do not substitute a live provider when a fixture fails.

```
cd source
npm ci --ignore-scripts --no-audit --no-fund
GITHUB_SHA=2875a0744912633f35cd6faba25e3260dae09d89 GITHUB_REPOSITORY=c933103/openrailwaystyle npm run build
cd ..
ln -s source/node_modules node_modules
node --test transport.test.mjs
# In a network-disabled container with working loopback and writable temporary storage:
PAIRS=3 OUT=evidence node trace.mjs
# Optional explicit local executable: CHROMIUM_EXECUTABLE=/path/to/chromium
```

Retain output even on failure. Do not claim completion from script exit alone: verify six samples, cache controls, geometry, no unexpected requests/errors, exact source/build identities, full network ledger reconciliation and the recorded device/runtime limits. The harness currently has transport/syntax coverage only; its browser path still requires its first acceptance run. Do not merge this measurement kit into application code or deploy it as an optimization.
