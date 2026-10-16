# Hidden tile-mask work: revision 3 candidate receipt

## Finding and source

The naturally failed controls job at exact main commit
`66aa30018560aa6ca6c4cbca7e7ead4d0c2dc63b` is not treated as a transient failure.

- Run: https://github.com/c933103/openrailwaystyle/actions/runs/38861819797
- Job: https://github.com/c933103/openrailwaystyle/actions/runs/38861819797/job/116849517041
- Artifact: https://github.com/c933103/openrailwaystyle/actions/runs/38861819797/artifacts/12029967820
- Phase: desktop detail 1 to detail 2 (25%), real-idle acceptance failed at 60,001 ms.

The existing same-page-clock probe recorded 63 frames, with 56,273.6 ms total
frame duration and 54,924.2 ms inside synchronous tile-mask calls (97.6%). It
recorded 663,438 mask submissions, 25,956 hidden-layer mask calls and 1,707
stencil clears. Of 70 observed completed station fetches, 41 body reads took
over 500 ms; their median body duration was 1,204.1 ms and median overlap with
recorded frame intervals was 99.606%. The last recorded frame ran from page
72,546.1 to 73,781.3 ms with 1,222.9 ms in mask calls. The final observed empty
station body began at 72,545.7 and resolved at 73,787.7 ms.

These calculations use one document's performance clock only. They establish
synchronous main-thread/native mask work occupying the failing window and
aligning with delayed body completion. They do not time GPU completion or
prove that this candidate eliminates every intermittent timeout. Fixture
fulfillment was at most 55 ms and no request failure was recorded. No live
provider tile request or unchanged controls rerun was made by this investigation.

Pinned MapLibre 5.24.0 invokes `_renderTileClippingMasks` before `renderLayer`
checks `layer.isHidden(zoom)`. Loaded empty tiles remain renderable. Hidden
layers can therefore change stencil state and submit masks although they
cannot paint. The existing source-map-verified decision harness reproduces
that behavior on the exact current Atlas style.

Earlier PR218's single pair had seven exact nonempty pixel/dispatch matches
and less mask work, but its guarded transition settled later. That historical
result remains limited and unchanged. It did not establish a timeout repair.
The new natural failure supplies the previously missing same-clock frame/body
alignment; it does not retroactively change the earlier experiment's outcome.

## Bounded candidate

`installHiddenTileMaskGuard` in the already-precached `styles/map-controls.mjs`
is installed immediately after map construction. It returns before every mask
side effect when the existing renderer predicate says the layer is hidden.
Otherwise it preserves the original receiver, all arguments and return value.
It reads current zoom/layout for each call, is idempotent per painter, leaves
the shared prototype alone and throws explicitly if the pinned private boundary
is missing. The app also reinstalls it on the synchronous public
`webglcontextrestored` event, after MapLibre replaces the painter and before
the next scheduled frame. Normal restoration behavior remains unchanged.
No immutable vendor bytes, source-map pins, attribution backport or
legacy-library recovery rules change.

The page's complete shell version advances to `20261016-hidden-tile-masks-1`,
including direct and transitive imports. The actual existing service worker is
unchanged. A new regression verifies coherent app/guard updates on navigation,
old-tab retention and execution of the guard returned from the updated cache.

The existing decision harness now exercises the production installer. The
one-pair browser diagnostic also uses that exact installer and explicitly
selects the untouched prototype method for its baseline. Preparation uses the
same current app in both arms; the measured transition selects the method.
All seven exact nonempty RGBA/visible-dispatch comparisons and sensitivity
controls remain. The separate normal controls checker, its scenario, real-idle
predicate, 60-second deadline, provider budgets and fixture transport guard
remain byte-identical. The diagnostic workflow is additionally triggered by
changes to the production guard/app.

## Regression-first and validation

- Before the fix, the new actual-startup regression failed: a hidden layer
  reached the original painter once where zero calls were required.
- Four new helper contract tests failed before implementation.
- After implementation, 11 helper/pinned-painter tests passed, and the actual
  startup regression passed. The pinned painter's representative Atlas case
  fell from 9,856 to 3,168 mask submissions, with zero hidden submissions and
  equal visible dispatch/abstract stencil coverage. This is a decision count,
  not browser timing or a replay of unrecorded historical tile identities.
- `npm run build` passed; generated `styles/world.style.json` is unchanged.
- Syntax and `git diff --check` passed.
- Initial parallel focused/aggregate runs were not accepted: subprocesses
  exited with SIGKILL. An overlapping standalone startup retry also received
  SIGKILL. No assertion failure has yet been found in those outcomes. They are
  preserved, not erased or called passing. The revision-1 serial aggregate
  then passed all 1,892 tests, zero skips (351.7 s). Revision-2 serial aggregate later failed with startup.test.mjs SIGKILL (1,891 pass, one failed file, 377.6 s); no assertion failure was reported.
- Local WebGL execution is blocked. The Playwright-pinned Chromium binary is
  absent. A single launch of installed Chromium 154.0.8037.57 aborted at
  `socket() failed: Operation not permitted`; no bypass or repeat was attempted.
  Therefore current-candidate pixel/controls/browser acceptance remains unrun
  locally and must pass in authorized hosted CI before merge.

## Provenance and remaining gates

Source files were materialized by matching their Git blob IDs against the
exact 66aa300 tree. 504 source/assets files were recovered; unneeded historical
investigation archives and `img/hack4rail-logo.jpg` were not materialized.
The local baseline commit exists only to create a diff and must not be published.
The frozen 20-path manifest records base blobs, candidate blobs, SHA-256s and
byte lengths. Compact code/tests/docs belong on the application branch; this
receipt and bulky logs/captures belong in the designated evidence location.

Candidate patch SHA-256:
`2ab698bd6572289310a3431edae034c36eb688f06909e320ea777df389c8237a`.

Revision 1 (`9ef4708889dde426def19fd6037c61186bc92bf0662646d7782519de5bee9dad`)
is preserved. Independent review found that MapLibre replaces its painter on
WebGL restoration, losing an initial-only guard. A new actual-startup regression
fails on revision 1 and passes after the public-event listener fix. It covers
two replacement painters, visible-call forwarding, duplicate-event idempotence
and leaving the discarded painter untouched. Both targeted app-startup tests
pass on revision 2.

Independent review of the production correction passes 28 guard/painter/probe tests, two actual-startup
install/restoration tests and one executable cache-upgrade test; syntax and
diff checks pass. Build/style reproducibility passes on final v2.

Final v3 serial aggregate passed 1,895/1,895 tests, zero failures/skips
(295.7 s), with the ordinary Node heap. Exact-head Codex review, normal required CI and current-candidate nonempty WebGL equality
acceptance remain outstanding. Merge remains subject to current-head review and required CI.

## Offline startup harness correction (revision 3)

A bounded-heap startup diagnostic on v2 was halted after an unintended HTTPS
request to example.org. Its payload was not captured at that point. The
unchanged invocation was not repeated. Read-only source inspection
found native-realm default fetch parameters escaped the JSDOM window mock.
An explicit deny-all offline recorder then confirmed the source-derived path:
GET `https://example.org/openrailwaystyle/data/traction/power/power-methods.geojson`,
`cache: no-cache`, AbortSignal present, no explicit headers or body. The stack
was power-facilities.mjs:122 through applySettings/styleReady and the Power
facilities startup test. The recorder never called original fetch/HTTP/socket
functions; this confirmation sent no request. It does not establish whether
any earlier request completed.

The only v2-to-v3 source delta is tests/startup.test.mjs. The DOM harness now
rejects native fetch, HTTP and socket fallbacks, asserts no unmocked request
at suite end, and retains an exit failure guard for late calls. Imported
fetch-using factories explicitly receive their window's fixture fetcher.
The fixture supplies empty valid power collections by default. A two-window
regression proves the native power loader actually receives each mock and
checks the URL/options; guard rejection paths are also tested. Before fixture
injection the regression and unmocked-request hook failed; after correction
four focused offline/install/restoration tests pass.

The v3 full startup run with an intentionally small 512MiB heap cap failed
with explicit V8 heap exhaustion/SIGABRT after 47 passes (27.5 s); this is
retained separately from earlier unexplained SIGKILL results. No unmocked
network assertion fired before heap exhaustion. Independent offline-harness review passes, including all 20 source hashes and
four focused tests. The final ordinary-heap serial aggregate passes all 1,895
tests with zero skips or failures (295.7 s); build/style reproducibility passes.
The small-heap failure remains preserved and is not relabelled as passing.

Frozen v2 remains at patch SHA-256
`0c089d9d3b1014a3a83a9741e88671d09db0f144d95363a3bdb5f1269819b4e8`.
V3 manifest SHA-256:
`853611dbd3f30f8a8f52a252cfbe30a58b193f1fa806936f47193a67c8d781ae`.

## Archive contents

The three patches preserve each candidate without repeating historical source
trees. Source hashes identify all 20 final files. The selected logs include
failure-first regressions and independent checks. Long aggregate/heap logs
are clearly labelled excerpts with original log hashes and line numbers.
The original natural-failure artifact is linked above. No evidence files
are added to the application PR.

The first v3 manifest retained v2 patch/reason metadata. Independent review
caught this receipt-only defect; corrected fields and all file identities
were reverified. Source and tests were unchanged by that correction.
