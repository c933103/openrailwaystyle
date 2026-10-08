# PR #145 integrated recovery verification — 8 October 2026

The [review finding](https://github.com/c933103/openrailwaystyle/pull/145#discussion_r4213750669) is valid when recovery happens **without idle**. Idle already calls `updateStatus`. A callback inside `noteSourceData` would run before app error bookkeeping is cleared, so the app now updates status after the entire transaction. Actual metadata/tile success is required; `isSourceLoaded` alone is insufficient. Remaining failed tiles and unrelated errors retain their warnings. Before style readiness, status text updates without querying rendered features.

Five app-level regression tests fail before the fix and pass afterward. They exercise one-tile recovery without idle, early style events, partial recovery, loaded-but-errored sources, unrelated errors, metadata success, duplicate events, cancellation, source replacement and disposal. Timers are controlled; these event sequences initiate no additional retry requests.

## Integration and safeguards

Normal local merge `dbec2bb541ad29797130a00ff8c6072f9baf60ee` has parents original PR head `8606e6b80a862b8b4c92d7fcd68a4ced0ce43c81` and main `66f152b8191ff1cdf1818f10f52f20061cb66ba1`. Four conflicts were resolved individually. Main's public ORM context guard, service-worker exclusion, public-host cache exclusion, loopback redirect restrictions, `browser-tiles-v2-no-public-orm` cache keys, pinned PMTiles 4.2.1 fixture, deployed fixture smoke, heritage correction and empty-track fast path are retained. The browser cache also defensively yields public ORM requests to the guard even if its handler is invoked directly.

The safe `rail-fixture` CI group runs both `check-orm-fixture-browser.mjs` (including its imported no-idle/partial-recovery helper) and `check-rail-overview-browser.mjs`. The provider-dependent geographic audits stay local-only. No PR #144 public-provider bypass was imported. Workflow trigger destinations remain unchanged; publishing this branch runs PR validation, not deployment or acquisition. No manual dispatch, skip-ci, merge or provider load test was performed.

Track-counter merge resolution preserves the nine-railway-input first phase and empty fast path, with four active requests and five queued requests cancelled when the last reader leaves. Amplification counts remain 27 for one nonempty tile, 48 then 60 for a nonempty 2×2 pan, and 16 then 20 for empty input. Peak concurrency is now four. Station fixture responses are valid empty responses, rather than wrongly carrying the railway source-layer name rejected by the branch's validator.

## Actual browser observations

Used the already-installed `/usr/bin/chromium`, version **151.0.7922.173**, through Playwright 1.56.1's supported `launchServer({executablePath})`. No browser was downloaded. The attempted pinned-browser installer had previously received HTTP 403 `Domain forbidden` and was not retried. Production MapLibre **5.24.0** and PMTiles **4.2.1** distribution assets were verified by the unchanged fixture's pinned SHA-256 checks. CI uses its own pinned Chromium 141 and is a separate required gate.

Both `http://127.0.0.1:4173/` and `http://127.0.0.1:4174/openrailwaystyle/` passed:

- Real Atlas/MapLibre rendered the synthetic Wuhan line at zooms 6 and 7.
- Initial z14 requests: **61 total / 61 unique** (25 railway, 18 station-area, 18 raw station); east pan: **72 total / 72 unique**, adding **11**. Assertions retain the **65 initial / +13 pan** ceilings.
- All 16 known catalogue contracts retain their local metadata path (unit coverage); the browser observed **zero known-source metadata requests**. The explicit unknown endpoint used fallback metadata exactly once.
- Real Chromium-generated site-origin Referer and User-Agent assertions passed for intercepted provider requests, including z14 requests. No public ORM traffic left the fixture.
- Two actual tile requests failed with synthetic HTTP 520. The first tile recovered and painted the railway while the warning remained for the second tile. After the second recovered, status became “Explore the rail network · click a line or station”. Throughout recovery, an unrelated local GeoJSON source was held pending, `map.loaded()` remained false, and **zero idle events occurred between the failure observation and final recovery**.
- Separate generated-layer check passed **54/54** combinations: nine modes × globe/Mercator × −0.1/0/0.1 zoom. Pixel checks verified visible strokes. Its zoom-7 Infrastructure check also passed with Speed hidden.

The fixture catalogue adaptation recognizes direct `/dataset/z/x/y` URLs. The counted set is the union of raw track inputs and shared visible railway URLs. Localized station display requests (`?lang=en`) remain separately recorded: the old `/__orm-fixture` path split excluded them from the raw-input measurement, and they are distinct URLs, not failed deduplication. Empty GeoJSON-VT results now emit a valid zero-length provider body; encoding an empty layer produced nonempty bytes with no decoded layer and correctly failed production validation. No ceilings or deduplication assertions were relaxed.

## Reproduction and artifacts

```sh
npm test
npm run build
node --experimental-vm-modules --test tests/startup.test.mjs tests/rail-provider-recovery.test.mjs tests/track-work.test.mjs tests/rail-loading.test.mjs tests/browser-cache.test.mjs tests/ci-plan.test.mjs
node scripts/check-orm-fixture-browser.mjs
node scripts/check-rail-overview-browser.mjs
# With a local server exposing styles/ under /openrailwaystyle/:
ATLAS_FIXTURE_BASE_URL=http://127.0.0.1:4174/openrailwaystyle/ node scripts/check-orm-fixture-browser.mjs
```

Local Node **24.19.0**: **560/560 full tests passed**; build, changed JavaScript syntax, generated style/station reproducibility and whitespace checks passed. Module versions are synchronized at `20261008-rail-recovery`, PWA shell 17.

The checks write `browser-review/orm-fixture-evidence.json` (request counts and timestamped status/source events), `orm-network-ledger.json`, z7/z14 screenshots and `rail-outage-before.png`, `rail-outage-partial.png`, `rail-outage-after.png`. The safe rail-fixture CI job uploads these with its normal artifact. The negative-zoom checker writes its own JSON and screenshots.

This is **rail-only synthetic acceptance**. The unrelated generic PMTiles Range-response archive fixture gap is unchanged; the local layout fixture's empty basemap does not establish whole-map/basemap correctness. Other browser groups and Node 22 verification remain exact-head CI gates. No live-provider geographic completeness or end-to-end phone performance improvement is claimed. The parent owns final review/CI acceptance and merge.
