# Independent review: translated departure-board cache identity

## Disposition and source identity

No blocking finding for the bounded successor addressing [the #190 review finding](https://github.com/c933103/openrailwaystyle/pull/190#discussion_r4242802242).

- Published baseline commit: `1ad2a047832936cdec511c99dc78463af4a675ef`.
- Baseline tree: `63585398781bce8c59ae1bd353563101503ca6bc`, independently verified through GitHub and the local source baseline.
- Frozen successor tree: `3fbe3aefc4964325c3146cb40e62ac20ccc984a2`.
- Frozen 11-file successor patch SHA-256: `7b88c2c6dd91671220f34667b3e64bc4f89bff82103cbb37b5b2961bb09c2237`.
- Reviewed file manifest: `review-translated-source-manifest.json`, SHA-256 `bb4c51d57760620ca94be0fb0c5d90c8ac76a694e3190e20f70f64b4fa88186b`.

All 11 file hashes and the candidate tree were rechecked after the independent tests. No source changes occurred during those runs.

## Finding and correction

The earlier browser fixture supplied only `name`; its language redraw did not change the matching-name set. It therefore did not cover the production failure in which translated `displayName` changed the cache key and bypassed the one-minute cache. This gap is reproduced and corrected here.

The successor changes only the cache-identity mechanism, its release token, tests and documentation:

- Known OSM objects use an explicitly namespaced type/ID tuple, including across source representations and coordinate quantization.
- Other identifiers are source/source-layer scoped; numeric ID zero is retained. Exact coordinates distinguish tile-local IDs and nearby points. Stable raw names are the fallback when an identifier is unavailable.
- A separate named/unnamed state permits the first useful named lookup for a deferred hub. An older unnamed rejection cannot evict the newer named result.
- Names supplied to stop matching, selected-stop and per-request limits, expiry, error handling, departure identity and row presentation remain unchanged.
- Translated headings and journey-link names still update while cached data and partial status are retained.
- The asset graph advances coherently to `20261011-departure-availability-2`. Exact current/previous app and departure module bytes are tested online and offline against both `20261011-power-legend-1` and `20261011-departure-availability-1`.

A source comparison strips only the new identity helper, its key-use hunk and the release-token change; the rest of `app.mjs` exactly matches the previously reviewed file. Power legend behavior and the earlier partial-board correction are preserved. See `review-translated-static.json`.

## Independently executed checks

1. **Focused successor suite: 121 passed, zero failures/cancellations/skips**, serially running `startup`, `sw-install`, `departure-availability` and `train-schedule` tests (`review-translated-focused.log`).
2. Identity regressions cover Japanese→English and English→Japanese, partial-empty and partial-with-rows, ordinary expiry recovery, different IDs at the same coordinates, OSM node/way namespaces, source/source-layer scopes, ID zero, nearby points within the old rounding bucket, raw-name fallback, normalized OSM representations with different quantized coordinates, and late unnamed rejection after named success.
3. Production startup tests retain actual deferred-hub naming and stale/closed/newer-selection behavior. The original partial-result and full-train schedule regressions continue to pass.
4. **Expected baseline browser failure:** built the exact published baseline and ran the strengthened current Chromium fixture against it. The initial schedule checks passed; actual translated redraw then lost the warning (`0 !== 1`, `settings redraw retains the warning`). The browser had already confirmed the translated heading and journey-link name (`review-translated-baseline-browser.log`). This is the reported defect, not a startup/transport failure.
5. **Successor browser pass:** the same strengthened Chromium fixture passed against the frozen successor. It tests both selected-stop orders, usable and empty partial results, actual heading/journey-name translation without extra requests, normal expiry recovery, all-failed eviction, no match, pending Close and cached reopening (`review-translated-successor-browser.log`).
6. Cached diff whitespace check passed; no unstaged tracked-source differences remain.

## Aggregate and limits

The implementer's final full suite passed **1324/1324**, with zero failures, cancellations or skips in 96.771 seconds (`translated-redraw-full-suite.log`). The reviewer inspected the terminal result; this aggregate was not rerun independently.

Both independent browser runs used the existing Chromium binary and the guarded synthetic-provider harness. WebKit remains unavailable locally; the committed checker remains dual-engine. No live provider requests, geographic coverage or timetable accuracy were verified. Worker upgrade tests use production worker code with synthetic cache/fetch implementations, not native browser service-worker interception.

This is a bounded correction to #190. Broader #112/#129 coverage and frequency-matching work remains open. Merge and publication decisions remain with the coordinating owner.
