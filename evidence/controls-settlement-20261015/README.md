# Controls settlement timeout, 2026-10-15

Failure source: main 7b4165ba9f54d0c09f7c94e953fdd6abe156f237.
Run: https://github.com/c933103/openrailwaystyle/actions/runs/38723466393/job/116397579843
Original ZIP: artifact 11969196436, SHA-256 3485dada1750a701be897228c540de237afe2f0b6e7f981d008fe9a470e90aaa.
The three JSON files here are exact extracted artifacts, not regenerated observations.

The first desktop detail-2 settlement reached the original 60,000 ms deadline. All intercepted provider fixture callbacks settled within 25 ms; no page exceptions or request failures. Station source had 88 loaded / five loading tiles, with four requests still finishing. Correct canvas 1365x900 at client size 5460x3600 / ratio 0.25. An earlier same-head production run passed, and #201 records the same unresolved failure shape before #211.

Diagnostic draft: https://github.com/c933103/openrailwaystyle/pull/212
Head e106dc46e7cc1f13d5777b1b16f10f96cc165bbf, tree 178798c6f375fc470830434bab45754c81a6d3f4.
Three-file change only: bounded long-task/heartbeat diagnostics, integration into existing settlement artifacts, regression tests. Runtime, provider bounds and URL holds remain unchanged. This is not a repair claim.

Local Node 24.19.0 commands:
- npm run build: pass; generated style and station blobs exactly equal base tree.
- node --test tests/browser-timing.test.mjs tests/map-render-state.test.mjs tests/request-lifecycle.test.mjs: 19 pass.
- npm test: 1,675 tests, 1,674 pass, one fail, zero skipped. Unchanged tests/map.test.mjs globe-drag performance assertion measured 999.916 ms.
- node --test --test-name-pattern='dragging the globe keeps the direction' tests/map.test.mjs: isolated unchanged test passes, 223.216 ms.
- Syntax and changed-file whitespace checks: pass.
- BROWSER_PATH=/usr/bin/chromium node scripts/check-map-controls-browser.mjs: no application execution; Chromium launch failed with socket() Operation not permitted. No bypass was attempted.

Active source/build/test inputs (472 blobs) were verified against the base Git tree; historical investigation archives were not materialized locally. Hosted acceptance and review are tracked on the draft PR. The unresolved root cause must be supported by new evidence before selecting a runtime or harness fix.
