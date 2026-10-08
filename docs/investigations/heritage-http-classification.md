# Heritage HTTP error classification correction

Corrects the still-valid [review finding on merged PR #96](https://github.com/c933103/openrailwaystyle/pull/96#discussion_r4213748325), based on main `bd97655f618f45e22793b37a3c025351289d1b0c`.

The builder shortened an HTML failure body before the classifier saw it. An executed query's OOM/timeout after the HTML preamble was consequently downloaded four times before splitting. The HTTP error now carries one non-enumerable `responseBody` property containing the complete body already checked against the existing cumulative download budget. Its message retains the existing HTTP status and sanitized 160-character excerpt. Both normal logging and uncaught-error inspection stay short. The classifier accepts the error itself (and retains string compatibility).

Reading the full body also exposes dispatcher/admission timeouts. Immediate subdivision requires `runtime error: Query …` with timeout/OOM, rather than treating a dispatcher `request_read_and_idx::timeout` as an executed query. Generic Gateway timeout and server-busy responses keep their backoffs. HTTP 429 still fails after four attempts without splitting. HTTP 400, local persistence errors and download-budget failures remain terminal. Request timeout, backoff durations, download cap, split-depth limit and cache/publication behavior are unchanged.

## Controlled verification

`tests/heritage-builder.test.mjs` evaluates the actual builder source, links the real classifier, geometry and tile encoders, stubs fetch and time, and redirects filesystem operations into temporary directories. Thirty-one regions have seeded empty caches; the remaining parent and its children exercise acquisition. Success cases decode the actual gzip bundles and vector tiles. Failure cases retain a previous-publication sentinel.

All HTML, OOM/timeout messages and geometry in this new test are **synthetic**. The realistic HTML/ODbL preamble is not claimed to be an upstream capture. No existing upstream evidence or fixture was modified.

- Long HTML OOM and executed-query timeout beyond 160 sanitized characters: parent fetched once, four children fetched once each, duplicate `w42` IDs published once, every emitted tile decoded.
- Original main producer/classifier with these same two targeted tests: both fail with **4 parent fetches instead of 1**. The fixed source passes.
- Server-busy dispatcher timeout and generic Gateway timeout: four parent attempts, waits of 30/60/120 seconds, then children.
- HTTP 429 containing OOM text: four attempts, no children; HTTP 400 with the same body: one attempt.
- ENOSPC/EACCES writes fail after one successful download, outside the classifier. Invalid JSON, body-read failure and ordinary network failure retry and cache only the recovered response.
- Exact 1,500,000,000-byte budget accepted; one byte over rejected before HTTP classification; cumulative bytes include unsuccessful attempts. The byte counter is stubbed for these budget cases, without allocating gigabytes.
- HTTP 200 incomplete remarks discard partial ID `w99`; client timeout splits immediately. Repeated heavy failures stop at depth six. HTTP error messages and inspected errors do not expose the full body.

Local validation on Node **24.19.0**:

```sh
node --experimental-vm-modules --test tests/heritage-builder.test.mjs tests/heritage.test.mjs
npm test
npm run build
node --check scripts/build-heritage.mjs
node --check scripts/heritage-data.mjs
node --check tests/heritage-builder.test.mjs
node --check styles/app.mjs
git diff --exit-code -- styles/world.style.json styles/major-stations.geojson
git diff --check
```

Results: **28/28 focused tests**, **526/526 full unit tests**, build, syntax, committed generated-asset reproducibility and whitespace checks passed. No lint script is defined. CI uses Node 22; its result must be checked separately on the published head.

## Workflow effects and unrun stages

The current site PR workflow validates/builds and assembles user-owned data artifacts. Its dependency planner selects **no browser groups** for this focused diff. The unconditional public OpenRailwayMap context guard, service-worker exclusion and safe browser matrix are untouched. No browser check, public ORM tile request, whole-map/basemap acceptance, real Overpass acquisition or manual workflow dispatch was performed locally. The separately known generic PMTiles Range-response fixture gap is untouched.

Merging changes to either heritage script triggers `heritage.yml` on main. It may acquire all 32 regions from Overpass, publish the `heritage-data` branch, and dispatch the site workflow after successful publication. The monthly schedule and manual trigger remain unchanged. This corrective PR does not merge, disable CI or use skip-ci; the parent owns final acceptance, merge and post-merge monitoring.
