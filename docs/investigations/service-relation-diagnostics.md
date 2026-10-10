# PR #146: inactive display counts and pending relation diagnostics

## Original Codex finding: retained inactive declarations

[Finding r4213750290](https://github.com/c933103/openrailwaystyle/pull/146#discussion_r4213750290) concerns a newer unnamed/unreferenced relation retained as `active:false`. It must suppress the older identity without appearing as an active route missing geometry.

The correction filters `routeView(route).active !== false` only at the missing-display-geometry diagnostic and published active route totals. Manifest totals, manifest stage totals and newly completed stage counts distinguish active `routes` from raw `retainedRelations`; regional completion logs name both. Active empty, unresolved and conflicted declarations retain their existing gap/source reporting. Pending changes cannot deactivate or reactivate an accepted identity before settlement.

Raw relation/way rows, membership associations, accepted watermarks, serialization, relationSummary, stageGeometryHealth, source counters, dependency history and stageChange/suspiciousChange/ID-loss inputs remain unfiltered. The existing inactive-history test still requires two complete source declarations.

## Separate adjacent finding: pending membership evidence

The pinned original `service-relations.mjs` blob is `d199e636e717053f987b3c9ecc1dc8d74d489f63`, SHA-256 `b08935c056a1c615501192896cbf63bd66adf5f362f2c9683520e8145088d495` (verified locally). Comparing reduced pending evidence with `drawnRelation` hid pending-only complete rows and byte-identical accepted/pending replay. Partial pending rows also vanished from the pending-ID list.

Pending is now determined by the existing reduced membership candidate. Empty next maps and legacy parts without membership evidence gain no new provenance meaning. Sorted IDs, the 100-detail cap, bounded member samples, pending relationStatus and retainedAccepted semantics are preserved. Inactive pending declarations remain pending evidence.

## Integration and validation

Normal merge `00d8779068fcb3d7984dacdcf75cbb19bb2f44b9` joins original #146 head `94950cab0cf26c95bd320db5cce13676da36d2f3` with landed main/#143 `f83f1adbd925a5a12f2f5ebdd07d21d5114996f0`. One conflict in service-routes.mjs was resolved by keeping #143's pending-geometry correction together with #146's relation-aware wayRoutes filtering. The safe six-group matrix, deployed-fixture wrapper, service-geometry check and provider/service-worker/cache/redirect guards match current main. #151 was not imported.

- Red: 12 targeted failures reproduced the two diagnostic/count defects before the fix; 44 existing/control cases passed.
- Green: 160/160 focused relation/geometry/acquisition/property/CI-planning tests and 719/719 full units.
- Regressions cover pending-only complete/partial/inactive declarations, NDJSON restore, identical replay with an equality precondition, reversed two-stage insertion, duplicate replay and separate commit/discard. IDs remain pending until all membership evidence settles. A 102-relation fixture verifies sorted IDs, the 100-detail cap and 20-member samples with full unresolved counts.
- Activation/deactivation tests preserve accepted views before settlement; older replay and removal of the newer owning stage cannot revive a tombstone. A shared active service retains identical encoded tiles, decoded labels/picking identity/slot and unknown-frequency output relative to a sole-active-service control. Active empty declarations still report a geometry gap.
- Actual locally stubbed acquisition verifies manifest and saved state active/retained counts while keeping two complete source declarations. The production frequency rebuild reads that same serialized fixture and emits matching diagnostics without changing the source table. Additional reroute, inactive and pending rebuild cases preserve decoded memberships/properties.
- Installed Chromium 151.0.7922.173, Playwright 1.56.1 and pinned MapLibre 5.24.0: 496/496 native/overscaled synthetic geometry/profile cases passed. Both real-PMTiles root/project deployed-fixture checks passed with delayed setup/capture and unchanged 61/+11 request counts. No browser download.
- Build, syntax, committed style/station reproducibility and whitespace passed on Node 24.19.0. No lint script exists. Exact-head Node 22 CI and automatic reviews remain separate gates.

Raw task evidence: `/tmp/atlas146-red.log`, `/tmp/atlas146-focused-final.log`, `/tmp/atlas146-units-final.log`, `/tmp/atlas146-browser-geometry.log`, `/tmp/atlas146-browser-deployed.log`, plus `browser-review/service-geometry-*` and `browser-review/deployed-{root,project}/`. All added relation cases are synthetic; these checks do not establish live regional coverage, applied real GTFS headways or worldwide feed success.

## Workflow policy and resource limits

#151 remained draft at `8e737efd1a154e5280d04b987c854237a5c0de6a` on inspection; its unrelated catalogue policy is excluded. Current main's service-frequency PR workflow can run eight 180-minute compile shards and 90-minute assembly after retargeting to main, with cached-feed conditional revalidation. Defaults remain 600 MB/feed, 600 compile seconds and 3 GB memory; PR runs do not publish the snapshot.

Service maintenance retains 50 MB/run, 100 MB/rolling day, the 100-minute start budget, 150-minute job, previous service-data state and refresh/skip/publication rules. Read-only refresh at 21:56 UTC found service-data `730b44c656823ff805e81c4d2f58b54f6ebcb870`: 90,539,482 rolling-day bytes, leaving 9,460,518 below the existing 10 MB acquisition-start threshold. This is an observation, not a budget reset or future guarantee. Normal merge can trigger main maintenance and deployment; the parent owns acceptance, merge and monitoring. No live provider acquisition, manual dispatch or public OpenRailwayMap tile traffic was used locally.

## Follow-up P2: unverified refresh must retain committed way associations

[Finding r4224601060](https://github.com/c933103/openrailwaystyle/pull/146#discussion_r4224601060) is valid on published head `2e09109eeb906ab4bf266c49655db9fbe1da6ce4`. Six separate-refresh cases fail before the repair: missing members, malformed members and missing revision timestamps, each with a sole service and an independently active shared service. Each first commits stage A, then refreshes that same stage, restores NDJSON and commits again. The accepted relation frontier survives, but the omitted way loses its route association and rendered geometry. Each case explicitly remains below the suspicious-change threshold. A multi-stage/tombstone negative control already passed.

Settlement now records the reducer's exact rejection condition before mutating the table: accepted membership has a verified snapshot and the incoming candidate has none. For those keys, it retains this stage's previous associations only where the accepted frontier still lists the way as eligible, and rejects the candidate membership delta entirely, including associations held solely by another stage. It does not borrow old associations from other stages or preserve superseded members. Verified removals/reroutes, absent route declarations, inactive tombstones, other shared services and discard retain their existing semantics. The two earlier diagnostic/count fixes are unchanged.

Green on the follow-up: 171/171 focused tests, 730/730 full units, build/syntax/generated-asset reproducibility/whitespace and 496/496 synthetic real-renderer cases. The new actual acquisition regression confirms identical published tile bytes, preserved NDJSON membership and `unverified-source` refresh health without changing the loss guard. Existing verified removal/reroute, source-conflict, dependency-health, pending, commit/discard and ID-loss controls remain green. The root/project deployed-fixture checks passed on the previous head and were not rerun for this settlement-only follow-up; their helpers and all workflow/budget policies are unchanged.

Raw follow-up logs: `/tmp/atlas146-followup-red.log`, `/tmp/atlas146-followup-focused-final.log`, `/tmp/atlas146-followup-units-final.log`, `/tmp/atlas146-followup-browser.log`. No live acquisition, manual workflow dispatch/cancellation or public ORM traffic was used. Exact-head remote CI/review remain separate parent-owned gates.

A pre-publication ownership control additionally caught and removed an overly permissive candidate-association path in the first local repair. It verifies that stage A cannot acquire B-only membership from rejected evidence and that a subsequent successful empty B pass removes B ownership. Two geometry controls confirm that a returned newer certified way can advance geometry independently while uncertified geometry cannot override the accepted source. The ownership control failed before tightening; both geometry controls passed before and after. Raw evidence is `/tmp/atlas146-followup-ownership-red.log`.
