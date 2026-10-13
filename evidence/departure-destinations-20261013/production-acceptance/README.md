# PR 200 final production acceptance

PR https://github.com/c933103/openrailwaystyle/pull/200 merged at 2026-10-13T05:57:15Z as a52a7d2b7033d7f1201410b3dd38861069ae2911. Its tree c2cf035e0cc7d44cd2cf056a82096c9cfbea4618 is identical to accepted head a432422c4cb5f24beebb54599544d276d4f28ea7 and the tested merge. Exact-head Codex and the ready-triggered code/security reviews completed clean; Codex +1 was observed at 05:53:41Z, with zero review threads. Local 1546/1546 aggregate and 413/413 focused checks passed, as did all applicable premerge CI.

## Production gates
- Reference https://github.com/c933103/openrailwaystyle/actions/runs/38354064365: success.
- Push site/deployment https://github.com/c933103/openrailwaystyle/actions/runs/38354064394: success.
- Automatic reference-completion redeployment https://github.com/c933103/openrailwaystyle/actions/runs/38354777974: success, completed 06:57:30Z.

Both site runs at a52a7d2 passed all six browser groups, aggregate, Pages publication, exact deployed vector bytes under both encodings, live renderer/app acceptance, and Wuhan z6/z7/z8 plus z14 track-count local fixtures. Hosted Chromium and WebKit passed the numbered-destination, cancellation, both-board-order and cached-reopen checks. Desktop/mobile build metadata and Pages deployment logs bind the shipped artifacts to a52a7d2 and its GitHub source URL.

## Verified data reuse
Production commit 14ac7a47c9acd854bd22f78158a626fcad04b1f3 reused pinned production dataset 6238b333143a8061e171346e009b0cb1b1e6cfd1 with extraction skipped. Original source date 2026-10-11, generation 8b430e70e32c08a25a1c4aac and generated time 2026-10-13T04:15:22.644Z were preserved.
Data digest: d89f5bc2b5f33bc95a9bf982b732d1ef80284751fabf34a3d2c501e916996779.
Full acceptance digest: b79a2ff61780ddcd3714d0063219d0ffcce39775745bbda9545173ac7dad5059.
Fresh production acceptance: 840 renderer + 18 app observations, zero provider requests; median 345 ms/p95 1329 ms. Original production manifest/report blobs are retained unchanged.

## Live acceptance and integrity
Both live reports identify https://c933103.github.io/openrailwaystyle/ as their asset base and contain 840 renderer + 18 app observations with zero provider requests.
- Push deployment: median 348 ms/p95 1422 ms.
- Automatic redeployment: median 337 ms/p95 895 ms.

Downloaded published-map-review artifacts were independently SHA256-checked against GitHub metadata. Each complete raw report was retained as deterministic gzip, with raw/gzip/artifact hashes in the corresponding summary JSON. deployment-excerpts.log retains exact source/build, dataset-reuse, dual-engine destination and live-check evidence.

This completes the bounded fix and production verification, and establishes PR 201's natural post-seeding reuse path in PR and production workflows. Broader #113/#129 remain open. No manual workflow dispatch or new provider extraction was added. Independent cloud-browser static-asset navigation was blocked; actual first-party bytes/live behavior were verified by the successful hosted deployment checks, with revision identity from deployment/artifact metadata.
