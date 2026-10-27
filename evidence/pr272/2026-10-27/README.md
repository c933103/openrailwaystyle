# PR272: terrain fixture resolution follow-up

Source: [`f38b73b03ac88b88318664c778658e074e5b40ab`](https://github.com/c933103/openrailwaystyle/commit/f38b73b03ac88b88318664c778658e074e5b40ab), tree `896cc38b06de66b261d7399d42ca55b7cd9cd6af`, sole parent `1e2958d7a1a27220cee3a568215a23b7f0cc1b9d`. All 820 remote file modes/blobs match local commit `33a533e1967156e1589983f911fa3aca2d22050a`; only commit metadata differs. The base remains `5d729533f5eef9a2e110cc6da1e8809b8b9769a6`.

## Observed hosted failure and independent diagnosis

[Run 40421738303](https://github.com/c933103/openrailwaystyle/actions/runs/40421738303) tested the previous head: 2,726/2,726 Node tests passed with zero failures/skips, and five browser shards passed. In [context job 121922431801](https://github.com/c933103/openrailwaystyle/actions/runs/40421738303/job/121922431801), six checks passed but `check-terrain-3d-browser.mjs` timed out at its original 45-second predicate: terrain source present, sea < -750 m, land > 250 m. Artifact 12698431799 did not contain terrain3d state or a terrain3d screenshot, so it does **not** identify the failed conjunct. The original log excerpt, artifact inventory/hash and shard timings are preserved here. Deploy/record remained skipped.

A CPU regression executes the installed pinned MapLibre 5.24.0 `Terrain`, `TerrainTileManager`, `MercatorTransform`, covering and DEM interpolation code, with synthetic cached DEM values and texture handles. The old camera zoom 11.3 selects DEM z10 for both queried points: sea -875 m, land -875 m. The corrected zoom 12.3 selects the intended z11 composite: sea -875 m, land 340 m. Thus the old fixture could not meet its positive-land predicate even with correctly loaded tiles. This independently proves a necessary fixture correction, not that the aggregate hosted timeout proves a production protocol defect or excludes other causes.

## Bounded change and checks

Three files change: the browser fixture, its shared camera configuration/failure capture, and a regression test. Production code is unchanged. The 45-second deadline, signed-height thresholds, real worker requirement and request-count assertions remain unchanged. On failure the checker now saves actual terrain/source/pitch, source/style readiness, DEM requests/counts, worker replies/errors, map/page errors and a screenshot before cleanup; it rethrows the original failure.

- Node 26.12.1: 39 focused renderer/terrain/deadline tests passed, zero failures/skips.
- Final diagnostics refinements: 2 tests passed, zero failures/skips. The earlier pinned-renderer negative-control proof is unchanged.
- `npm run build`, generated style/major-stations reproducibility, changed-module syntax and `git diff --check` passed.
- No further local aggregate or browser launch was attempted. Previous local SIGKILL/undercount results and the local browser environment restriction remain accurately preserved in [the first repair archive](https://github.com/c933103/openrailwaystyle/blob/6de14bb476a4e36e0a51dae86623071832eb1082/evidence/pr272/2026-10-26/README.md). These are not browser/WebGL acceptance.
- New exact-head Code review was requested in [comment 6430503593](https://github.com/c933103/openrailwaystyle/pull/272#issuecomment-6430503593). [Natural hosted run 40425501815](https://github.com/c933103/openrailwaystyle/actions/runs/40425501815) is in progress at publication. Prior-head results do not substitute for new full/browser/worker/WebGL acceptance and artifact inspection. Nothing has been merged or deployed.

`source-binding.json` records hashes and exact source/run identities. `fixture-results.tar.gz` contains the compact patch, focused/build logs, prior hosted validation/prerequisite inspection, failed-check excerpt, shard timings and original artifact inventory. `SHA256SUMS` binds the published files. This evidence branch preserves the previous source/evidence tree; it does not change application deployment inputs.
