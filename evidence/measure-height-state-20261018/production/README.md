# PR244 production delivery

Source `891e97ade75a4f156cc7b752375673e7a6e849aa` (PR244), tree `e2a746da4ccfff8588a61a507cdfd390e10d98d9`, exactly the tree accepted at head `82495d1bdc2d113c8fef740e1346db123e8ff2c4`. Asset token: `20261018-measure-height-state-2`.

## Delivered behavior

Failed/missing endpoint-height results settle as unavailable while retaining distance. The explicit **Retry heights** action can recover without losing endpoint editing or creating background retries. Obsolete requests cannot replace a new measurement; finite zero/negative heights stay valid. The new cache token keeps page/app/drawing updates coherent.

## Terminal natural pipeline

- Production reference [39129044208](https://github.com/c933103/openrailwaystyle/actions/runs/39129044208): success, using the existing data generation with extraction skipped and fresh renderer acceptance.
- First production site [39129044366](https://github.com/c933103/openrailwaystyle/actions/runs/39129044366): success; deployment/published checks finished **13:29:52 UTC**, 18 October 2026. **2,445 tests and all six fresh browser groups passed**. Browser data binding `3eec20a1819631ec65440e7ff9208dd5`.
- The reference-triggered queued run39129454061 was **cancelled before starting**, superseded in the deployment queue by the scheduled urban-service update. It is not counted as a successful run.
- Replacement natural continuation [39131352111](https://github.com/c933103/openrailwaystyle/actions/runs/39131352111): success; deployment/published checks finished **13:59:17 UTC**. **2,445 tests and all six fresh browser groups passed again**, data binding `f471e46d69658dd4566d4cbb1dbb00b0`.
- Both published-map artifacts contain 840 actual-reference samples plus18 actual-app samples with **zero provider requests**, and the Wuhan z6/z7/z8 and z14 local-railway fixture evidence. First median346ms/p951502ms and final median338ms/p95898ms describe those controlled runs only, not a production-speed claim.

## Independent served verification

At **13:32:56 UTC** after the first deployment and again at **14:05:38 UTC** after the continuation, all **12 served-file byte comparisons passed** against final source or the exact merged build. Files: app.mjs, cjk-font.mjs, data-check.html, data-check.mjs, departures-ui.mjs, draw.mjs, elevation.mjs, index.html, layer-semantics.mjs, map-model.mjs, sw.js and vendor/tile-labels.js.

The check uses only the approved Pages origin, rejects redirects, bounds response size/time and writes full response bytes plus SHA256 comparisons. Build metadata for the generated bundle pins the merged commit. The 23 measurement-state regressions also passed using each downloaded draw.mjs; the elevation dependency was the byte-equal verified local final source. No local full-browser pass is claimed.

## Review, artifacts and limits

[Exact-head Code and PR CI receipt](https://github.com/c933103/openrailwaystyle/pull/244#issuecomment-6250157678) establishes clean Code review and required CI before merge. Security remains clean only on historical c9b70df; its metadata has `mergeGateEnabled:false`. No current-head Security pass is claimed and no separate mandatory Security gate was identified.

`production-logs.zip` preserves the available decoded reference/validation/six-group browser logs, metadata snapshots, both served snapshots, check script, merged-build log and replayed regressions. Decoded deploy-job logs could not be retrieved (connector returned “Transport closed”); they are not represented as archived. Their terminal per-step metadata and exact published-map artifacts are preserved instead.

- `published-first.zip`: exact artifact12138585224; SHA256 `4c40d66db0d3f0c2ad123ea3578b3931d40912b39f692ee53e94c41ff050fd17`.
- `published-final.zip`: exact artifact12138911876; SHA256 `97c3e5b4fa24ae75cb11360c3098c0f21a8746e6b18f497059f708e5c8b03a17`.

The larger site/data/browser-group artifact binaries remain in Actions with their recorded IDs/hashes/expiry; this archive does not claim to contain them. Earlier local failures and previous exact-head evidence remain on the same additive evidence history. This is acceptance of the bounded measurement fix and its delivery, not completion of broader #136/#112 or any worldwide source/coverage claim. All provider/domain/source holds remain unchanged.

