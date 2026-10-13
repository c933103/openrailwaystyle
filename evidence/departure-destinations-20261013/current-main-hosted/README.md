# PR 200 combined-tree hosted acceptance

Verified 2026-10-13 UTC. Source head a432422c4cb5f24beebb54599544d276d4f28ea7.
GitHub's tested merge 21018a0845a0fe16c4cb2e868bb334e4f109164f has exact source tree c2cf035e0cc7d44cd2cf056a82096c9cfbea4618, matching local acceptance and the preserved two-parent union.

- Codex exact-head review: clean, https://github.com/c933103/openrailwaystyle/pull/200#issuecomment-6138939291 . Zero review threads at final gate.
- Reference run 38351246319: success, https://github.com/c933103/openrailwaystyle/actions/runs/38351246319 .
- Site run 38351246290: success, https://github.com/c933103/openrailwaystyle/actions/runs/38351246290 . Validation, all six browser groups, aggregate and status recording passed. site/browser-checks=success; PR deployment skipped.
- Controls job 115147248836 passed numbered-destination isolation, cancellations, both board orders and cached reopening in Chromium and WebKit. Exact excerpts retained; https://github.com/c933103/openrailwaystyle/actions/runs/38351246290/job/115147248836 .

## Natural hosted data reuse
The plan selected reuse=true for production dataset commit 6238b333143a8061e171346e009b0cb1b1e6cfd1. All extraction was skipped, and the pinned complete dataset passed verification before fresh renderer acceptance. There was no manual workflow dispatch or new provider-data acquisition.

Published preview commit: 6fa296fb25333009dc6b6d04a0efd3957be79c93.
Source date 2026-10-11, generation 8b430e70e32c08a25a1c4aac and original generated time 2026-10-13T04:15:22.644Z are preserved.
Data-input digest d89f5bc2b5f33bc95a9bf982b732d1ef80284751fabf34a3d2c501e916996779.
New full acceptance digest b79a2ff61780ddcd3714d0063219d0ffcce39775745bbda9545173ac7dad5059.
Fresh report: 840 actual-OSM renderer observations, 18 app observations, zero provider requests; median 338 ms, p95 892 ms.
Retained report SHA256 3b1fd640c1bfd3bc2d2650430ce8b241d84b667c32b810afa4dfe038d03f1056 was independently recomputed from the fetched bytes. The original manifest/report blobs are preserved unchanged here.

All technical pre-merge gates are complete for this head. The PR remains draft and unmerged at this receipt. Broader issues #113 and #129 remain open. No production deployment is claimed.
