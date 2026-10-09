# PR #143 pending geometry diagnostic correction

[Finding r4213750495](https://github.com/c933103/openrailwaystyle/pull/143#discussion_r4213750495) reproduced on the original PR head `71d9544a47be577718256190f0c494b6ad206410`: pending-only complete geometry was drawn as fallback and then compared with itself, hiding its pending transaction state. Identical accepted/pending evidence and complete retired-only fallback had the same omission.

The correction counts actual reconciled `nextGeometry` / `retiredGeometry` evidence regardless of whether it equals the drawn frontier. The existing bounded details now include its pending status and source snapshot. Drawing, reconciliation, provenance storage, commit/discard and acquisition semantics are unchanged by this correction.

Current main `0b985913576a16633b785a0e1268b192a216389f` was integrated with normal merge `a173b3647a1983ec417032332db9b08ae5d32470`, whose other parent is the original PR head. No textual conflicts occurred. Inspection confirmed the current safe six-group CI matrix, including PR #153's deployed-fixture wrapper, with the original synthetic geometry checker retained in the frequency group. Public-provider geographic checks remain local-only. PR #146 and #151 were not imported or edited. The existing successful metadata fixture is retained unchanged.

## Validation

Local Node 24.19.0 and installed Chromium 151.0.7922.173 through Playwright 1.56.1; pinned MapLibre 5.24.0 assets, no browser download.

- Red: all five added diagnostic regressions failed with an empty pending-way list (54 existing tests passed).
- Green: 92/92 geometry/acquisition/metadata/lifecycle/browser-fixture/CI-planning focused tests; 651/651 full unit tests.
- New cases cover initial pending-only complete geometry through NDJSON resume and commit/discard, byte-identical accepted/pending evidence through both settlement paths, and retired-only migrated fallback. They retain source timestamps, accepted geometry, encoded tile bytes and decoded shared-service coordinates/identities.
- The actual renderer passed 496/496 synthetic geometry/width-profile cases at native and overscaled zooms. JSON, errors and screenshots are in `browser-review/service-geometry-*`. This covers generated vector tiles and production styles; it does not establish live regional completeness or validate real timetables.
- Build, changed-module syntax, committed style/station reproducibility and whitespace checks passed. No lint script is defined.

Commands: `node --test tests/service-geometry-*.test.mjs tests/ci-plan.test.mjs`, `npm test`, `npm run build`, and `node scripts/check-service-geometry-browser.mjs` using the existing shared Chromium endpoint. Raw red/green logs remain in `/tmp/atlas143-pending-red.log`, `/tmp/atlas143-focused.log`, `/tmp/atlas143-units.log` and `/tmp/atlas143-browser.log` in the task environment. Final remote CI is a separate gate.

## Workflow effects and retained limits

PR #151 remained draft at `8e737efd1a154e5280d04b987c854237a5c0de6a` during inspection. Its catalogue/workflow policy is not part of this PR.

The current `service-frequency.yml` matches `scripts/service-routes.mjs` on PRs. Once based on main, ordinary PR CI may scan the catalogue and run eight worldwide GTFS compile shards (180 minutes each), then assembly (90 minutes). Cached feeds use conditional ETag/Last-Modified revalidation; per-feed defaults remain 600 MB, 600 compile seconds and 3 GB memory. PR runs do not publish the worldwide snapshot. These stages were not run locally or manually dispatched.

Main service maintenance retains 50 MB/run, 100 MB/rolling day, a 100-minute start budget and 150-minute job. Retained `service-data` state, previous-table failure behavior, stage refresh/skip rules and publication guards are unchanged. The original PR adds geometry module paths to its existing main-push trigger. A future merge can therefore run normal service maintenance and site deployment; the parent owns merge and monitoring. No live Overpass acquisition or automated public OpenRailwayMap tile traffic was used for this correction. All provider isolation, service-worker exclusion, retry/backoff and browser assertions remain intact.
