# Controls painter: single hosted diagnostic result

The original intermittent controls settlement timeout remains unresolved.
The experimental guard removed mask work in this pair; **no settlement-speed
improvement or original-timeout repair is established**. There was no rerun.

## Provenance

- Code PR: https://github.com/c933103/openrailwaystyle/pull/218
- Measured PR head: `8c0b485d903544f5b5ef66ea0f1b66ca034431b2`
- Actual checkout commit: `e8e158b9176dd228e1279dff37fe9586c5b3721c`
- Both commits have the identical Git tree `6ec5e1def8d3abed22e64b03551dd27f3466595e`.
  GitHub's default PR checkout used a generated merge commit. Codex correctly
  flagged the missing explicit head checkout for future runs. The actual
  commit is recorded in the raw manifest, and tree equality reconciles this
  completed measurement without pretending the commit IDs are identical.
- Run: https://github.com/c933103/openrailwaystyle/actions/runs/38790857890
- Job: https://github.com/c933103/openrailwaystyle/actions/runs/38790857890/job/116614712989
- Original artifact: https://github.com/c933103/openrailwaystyle/actions/runs/38790857890/artifacts/12000186878
- Original ZIP SHA-256: `d3a4886215083a8b4467958ccb3023622060bff8506d1702278624e898ba88ae`
- `artifact.zip` preserves those exact 261,721 bytes, including bounded JSON,
  fourteen screenshots and the local server log. `summary.json` and
  `historical-comparison.json` are derived, not replacement captures.
- Browser: Chromium `141.0.7390.37`, Playwright build 1194, identical fresh
  processes/contexts and SwiftShader arguments, baseline first then guard.
- Renderer: pinned MapLibre `5.24.0-atlas.1`, attribution-only backport.
  Original runtime method SHA-256 in both arms/maps:
  `9585137cd6b7c5f08721b1b029c591b5a15b4f6ff1660a10c57dc45396e556e5`.
  Six original source/runtime hashes and application/style/pool/adapter hashes
  are retained in the raw JSON manifest.

## Natural result

Both arms passed the unchanged real-idle acceptance and 60-second deadline.
Each observed all 176 transition fetches through body completion, with no
truncation, request failures or page errors. Fixture counts were identical:
371 provider-shaped responses, 184 nonempty synthetic vector responses and
29 synthetic DEM responses; zero unknown routes. Provider-shaped URLs were
locally fulfilled under the existing transport guard, not live downloads.

| Observed transition | Baseline | Hidden-mask guard |
| --- | ---: | ---: |
| Action through settlement, Node ms | 7,137 | 8,516 |
| Synchronous mask time, page ms | 1,474.3 | 68.8 |
| Mask draw submissions | 21,668 | 13,564 |
| Frames | 4 | 5 |
| Stencil clears | 56 | 37 |
| Fetch start to body end, median page ms | 13.00 | 10.95 |
| Last body end to capture stop, page ms | 3,085.6 | 3,905.0 |

The guarded arm settled later despite less mask work. Fixed order, different
frame scheduling and one observation per arm prohibit a statistical speed
claim. Mask time measures synchronous JS/native execution, not GPU completion.
Aggregate pixel-case draw totals also depend on frame count and are not
per-frame workload equivalence claims.

All seven nonempty WebGL states had **zero changed RGBA bytes** and identical
final visible dispatch: Mercator hidden, shown, hidden again, zoom 4,
pitch/rotation, globe and terrain. The visibility control changed 16,128 blue
pixels to 27,904 red pixels; hiding restored the exact original hash. Other
states retained actual blue geometry and 8–77 queried line features. Stencil
resets were exercised. These finite fixtures support the guard's compatibility
on this pinned renderer; they are not universal rendering proof.

## Comparison with the immutable failure

Original run: https://github.com/c933103/openrailwaystyle/actions/runs/38723466393/job/116397579843

Original JSON: https://github.com/c933103/openrailwaystyle/tree/e62125dd09787d56c3ae829e765e6ec5a2accad1/evidence/controls-settlement-20261015

The final 128 retained request URL multisets match exactly across the original
failure and both new arms. Compare their own Node lifecycle durations only:

| Same 128-request tail | Original failure | Baseline | Guard |
| --- | ---: | ---: | ---: |
| First start to final finish, ms | 53,732 | 461 | 394 |
| Median fixture fulfillment to response, ms | 1,195 | 3 | 3 |
| Median fixture fulfillment to finish, ms | 1,292.5 | 5 | 5 |
| Fulfillment to finish over 500 ms | 116 | 0 | 0 |

The old fixture handlers were at most 25 ms overall. Its request clock reached
87,701 ms with four requests still pending, then the final request finished at
90,152 ms. Those are elapsed request-clock positions, **not** an 87-second
measured stall. Only the retained tail can be directly reconstructed here.
Requests continued progressing in approximately four-wide batches; neither a
permanent pool deadlock nor a provider delay is demonstrated.

In the new baseline, the largest mask frame takes 1,447.7 ms in masks and
begins **1,568.8 ms after the last body already completed**. That particular
frame cannot cause the preceding request waits. The guarded arm also retains
3,905 ms between final body completion and capture stop, versus 3,085.6 ms
baseline. This localizes this pair's residual time beyond body consumption,
but it does not identify the original failure's mechanism. Never subtract
Node and page timestamps or clocks from different documents/runs.

## Missing observation and next bounded decision

The actual failing run has no same-clock body/frame/actor alignment. Its Node
response/finish delays cannot distinguish delayed browser/network event
delivery from main-thread/native work, and the passing CPU capture cannot
supply the missing historical schedule. The current pair does not observe
custom-protocol completion, actor send/receive, tile-load acceptance or GPU
completion. The post-body gap therefore remains unassigned.

Keep the guard isolated. The next useful observation, if separately pursued,
is a bounded same-clock custom-protocol/actor/tile-load trace aligned with
fetch/body/frame spans in the **next naturally occurring fixture controls
failure**, preserving the 60-second gate and original scheduling. Record
both enqueue and completion boundaries, not another CPU-only profile or
repeated A/B pairs. Until that exists, do not ship this as the timeout remedy.

No production file, provider budget, URL157/source185 hold or existing
acceptance gate changed. Raw bulk stays on this evidence branch, outside the
code PR. This result neither closes the original investigation nor promotes
the renderer guard to production.
