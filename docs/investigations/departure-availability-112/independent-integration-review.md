# Independent integration recheck after Power legend PR #189

## Disposition

No blocking integration finding. Power work and the bounded partial-departure correction coexist correctly in the frozen candidate. The unchanged final aggregate repeat passed 1306/1306; the first run’s single timing-sensitive failure remains disclosed below.

## Reviewed identity

- Accepted main: `5f44f5525c0467466f68fdba56a40b48d1249aa6`.
- Accepted source tree: `e370563398815d9eb05d9aceb44f9af848047161`, independently read from GitHub and verified against the local baseline.
- Frozen integrated source patch SHA-256: `6ce4571f556931296807b0cb4051d78b07bc5c89d5e8bb6ffb3cbad35f678295`.
- Reviewed 14-file manifest: `review-integrated-source-manifest.json`, SHA-256 `43ef19f12aebb4d3fa27457ede90afa2b61d7eced9f68846ba78978cb3739268`.

## Preservation and conflict resolution

All 429 files outside the intended partial-departure change set match the accepted GitHub tree's blob hashes. Eleven changed files are byte-identical to the original independently reviewed partial-status correction. The remaining three overlap files were verified exactly:

- `styles/app.mjs`: only the coherent release-token replacement and the previously reviewed departure-renderer hunk differ from accepted #189. Its Power symbol imports, legend rendering, lifecycle samples and help behavior remain intact.
- `tests/startup.test.mjs`: only the three departure-result mocks change; the Power legend regression and all other accepted content remain intact.
- `tests/sw-install.test.mjs`: only the departure upgrade test's prior release changes to `20261011-power-legend-1`; the Power app/CSS/metadata upgrade test remains intact.

The application HTML, app imports and dependent versioned module graph consistently use `20261011-departure-availability-1`. The immediate-prior Power version is explicitly exercised by the departure byte-refresh and old-tab retention test. Power CSS, shared marker metadata, real map layer definitions, documentation and browser tests are unchanged from accepted #189. Numeric departure-label behavior remains unchanged.

## Independent checks

- Focused integrated suite: **116 passed, 0 failed/cancelled/skipped**, run serially against startup/Power DOM, service-worker upgrades, departure availability, facility metadata/layers and full-train schedule tests (`review-integrated-focused.log`).
- Controlled real-app Chromium departure checker: passed all original schedule/selection/keyboard checks and partial-empty/rows, both source orders, cached warning, normal expiry recovery, all-failed eviction, newer-selection DOM coverage, pending Close and cached reopening (`review-integrated-departures-chromium.log`).
- Controlled Chromium Power smoke: passed on desktop and mobile, active → former → active with every view transition, exact point labels/colors, dimensions/glyph bounds, decorative accessibility and zero page errors (`review-integrated-power-chromium.log`). All four resulting legend screenshots are byte-identical to the accepted #189 review screenshots (`review-integrated-power/screenshot-parity.json`).
- Static accepted-blob preservation and source equivalence results: `review-integration-static.json`.
- Cached-diff whitespace check passed. Source hashes still match after the independent tests.

## Aggregate observation and limits

The implementer's first integrated aggregate finished with 1305/1306 passing. The sole failure was the unchanged full-train lazy-expansion test's `calls === 1` assertion after a fixed 20 ms delay, which observed zero calls. That test and its production expansion behavior were not changed by this correction. It passed unchanged in the independent 116-test serial run. The unchanged aggregate repeat passed **1306/1306**, with zero failures, cancellations or skips in 94.537 seconds (`integrated-full-suite.log`); the reviewer inspected its terminal summary. The first failure remains in `integrated-full-suite-first.log`. Its cause is unestablished; no timeout, assertion or source change was made between runs.

WebKit remains unavailable locally because its required browser binary is absent. Browser checks use guarded synthetic providers and do not establish live geographic/timetable coverage. Service-worker upgrade tests execute production worker code with synthetic cache/fetch implementations rather than native browser interception. Neither #112 nor #129 is closed by this bounded correction.
