# PR173: current-main overview rendering correction

Source: [9f4d256a5fde7c48e56d8957f613f0584e9b8618](https://github.com/c933103/openrailwaystyle/commit/9f4d256a5fde7c48e56d8957f613f0584e9b8618). Source tree: `a177afcb01765de1a479bd708e86744936b571d8`.

The two parents are the previous PR173 head `05c9f22eead75ed2c7e21efc4a29bce9ee8ca3f4` and accepted main `caf03eb96f7cb32859c4e522179fbd8abac4f989` (tree `5770a12671bf968c8ff683f3f55adf01e73bc3b7`, including PR177). Integration was conflict-free. Local and published source trees match exactly. The delta from main is 25 files; the correction on top of the clean merge touches six files. Source identity and per-file Git hashes are in the archive.

## Findings addressed individually

- Original source-contract P1 (`discussion_r4236120636`): both `railroads` and `railroads_north_america` are declared under `railBackbone`. The current composition, contract checks and build pass. This declaration was already on the old head.
- Original provider-fixture P1 (`discussion_r4236120640`): the existing shared catch-all fixture fulfills metadata and empty vector tiles without egress. The new `rail-backbone-fixture.test.mjs` explicitly proves the production `papers.reearth.land` metadata URL, its emitted tile URL and actual first-party bytes pass through the guarded transport with no provider fetch. The new renderer check intercepts the exact metadata URL and supplies synthetic geometry for both source layers. No provider allowlist or public tile access was added.
- Original point-publication P2 (`discussion_r4236120642`): this was still present. Visible curated points now publish before eligible provider name requests or rare-Han fonts settle. Names already made renderable in the same language can be retained. Stale generations, sources and languages cannot publish old data.
- New selected-dot P2 (`discussion_r4239547535`): selecting a below-tier dot uses the existing provider name resolver for that selected entity only. Its current tile and four neighbors bound a failed lookup; the existing tile-promise cache shares repeated selections. A closed or changed panel and a newer language prevent stale updates. Departure caching now includes the supplied names as well as position, so an unnamed lookup cannot mask the later named match.

## Local validation

- Node v24.19.0, within the repository's supported engine range; reused installed dependencies have an identical package-lock.json.
- Build, committed style/major-station reproducibility, JavaScript syntax and `git diff --check`: pass.
- Final native suite: **1,038 tests passed, zero failed/skipped/cancelled**, 98.5 seconds (`full-tests-final.log`). Earlier full run: 1,037 passed before the final failed-provider regression was added; it is retained separately.
- Focused selected-hub tests: 6 passed, covering immediate points, per-selection lazy lookup, repeated clicks, bounded failure, Close, replacement station and language races. Existing rare-Han readiness tests now require the anonymous point to remain present while its name waits.
- Source-contract, shared guarded fixture and CI-plan checks: 18 passed.
- Real MapLibre fixture: eight tightly grouped points per active source remain present at zooms 3, 4, 5, 6, 7, 8 and 12 while fewer names render. A positive label control is required. Both backbone source layers appear only at zooms 4–6. Full source/marker/name/request samples and a z12 screenshot are archived. This checker is included in normal rail-fixture CI.
- Baseline negative control: the two new regression tests fail against the clean current-main merge before the fixes, specifically because the unresolved point is absent and selecting the deferred dot starts zero provider lookups. `baseline-red-valid.log` retains both failures.

## Retained unsuccessful attempts

The first test-harness attempt selected a curated identity absent from generated GeoJSON, causing a TypeError rather than testing production behavior; this was corrected to an existing hub with an explicit test tier. The first guarded-fixture harness omitted `unroute`; that harness failure is retained. Those setup failures are not product findings or valid negative controls (`startup-regressions.log`, `baseline-red.log`, `fixture-contract.log`). A two-point browser setup allowed both labels to fit using different variable anchors, so it did not force a collision; the final fixture uses eight nearby points and retains both the positive-label and collision-suppression assertions. Earlier successful runs and final successful runs are stored separately where available.

## Review and release status at publication

Old-head Code review found the selected-dot P2; old-head Security review completed with no issues. Those are not reviews of the new source. Fresh Code and standalone Security review requests for `9f4d256` are [6103288214](https://github.com/c933103/openrailwaystyle/pull/173#issuecomment-6103288214) and [6103289159](https://github.com/c933103/openrailwaystyle/pull/173#issuecomment-6103289159). New exact-head [CI run 38094909997](https://github.com/c933103/openrailwaystyle/actions/runs/38094909997) is pending at this checkpoint. The PR thread is the current acceptance record.

This evidence does not authorize or claim a merge/deployment. Production checks must still read actual deployed assets; the deployment workflow was not changed. Curated hubs and regional inventories are selective. Complete worldwide station points remain [issue175](https://github.com/c933103/openrailwaystyle/issues/175), and the authentic fifth background remains separate. Synthetic geometry does not prove live provider availability or worldwide completeness.
