# One isolated controls painter comparison

The original intermittent controls settlement timeout remains unresolved.
This diagnostic follows [PR215](https://github.com/c933103/openrailwaystyle/pull/215).
It is neither a production renderer patch nor permission to rerun until a
failure appears. PR216/217 addressed separate acceptance issues.

## Evidence and question

The [original failure](https://github.com/c933103/openrailwaystyle/actions/runs/38723466393/job/116397579843)
retains [immutable JSON](https://github.com/c933103/openrailwaystyle/tree/e62125dd09787d56c3ae829e765e6ec5a2accad1/evidence/controls-settlement-20261015).
Its requests kept completing in approximately four-request batches. Fixture
handlers finished within 25 ms, while the final 128 records have median
fulfilled-to-response latency 1,195 ms and fulfilled-to-finished latency
1,292.5 ms. Progress continued after the 60-second acceptance deadline. This
does not establish a deadlocked pool or a provider defect.

PR215's passing 100 Hz profile contains 846,688 microseconds sampled in
`uniformMatrix4fv`, entirely below `_renderTileMasks` and
`_renderTileClippingMasks`. Pinned MapLibre 5.24.0 prepares clipping masks
before `renderLayer` skips hidden layers. An empty loaded tile is still
renderable, so this can occur even with empty provider fixtures.

The local pinned-source decision test executes the real painter, visibility
and stencil-reference methods with synthetic GPU submission. With the current
Atlas style and failure-shaped 88-loaded-tile source counts, the original
submits 9,856 tile-mask draws, including 6,864 attributed to hidden layers.
A single in-memory visibility guard reduces this to 3,168 draws and stencil
clears from 28 to 9. Visible dispatch and abstract tile-interior stencil
acceptance remain equal. These are synthetic decision counts, not a historical
per-frame replay, real GPU timing, or rendered-pixel proof.

## Isolated implementation

`controls-painter-probe.mjs` defines one source-level experimental guard:
return before `_renderTileClippingMasks` if the same `layer.isHidden(zoom)`
predicate already used by `renderLayer` is true. The CPU regression and hosted
experimental arm use exactly that exported function.

Only the isolated experimental page's painter instance is wrapped. The
production renderer, application, package lock, generated style, vendor
filename/hash, service worker and existing controls checker are unchanged.
The original attribution-only backport remains exactly as published. Neither
bundled/minified source nor a deployed file is patched by this experiment.

The manifest verifies fixed SHA-256 hashes for the original painter, style-layer
and tile source, upstream distribution/source map, and built atlas.1 runtime.
The CPU test also verifies source equality with the pinned distribution map.
Each arm records the original runtime method hash; those hashes must agree.
Current app, style, request-pool, adapter and diagnostic input hashes accompany
the result. No new external software or renderer upgrade is introduced.
Checkout selects the explicit PR head (or event SHA outside a PR). The manifest
reads the actual Git checkout and rejects a different declared source; the
GitHub event/merge SHA is recorded separately rather than mislabeled as the
checkout. A correction-triggered measurement is a distinct run, never averaged
with or substituted for the first result.

## One hosted pair

The dedicated `Controls painter diagnostic` pull-request workflow runs exactly
one baseline arm followed by one guard arm on the same hosted job. Each arm
uses a fresh Chromium process, fresh context, device scale 1 and identical
SwiftShader launch arguments. Browser versions must agree. Fixed order and
host variability remain limitations; one pair is not a statistical speed claim.

Both arms execute the original startup/background/reload/settings action prefix
and first desktop detail-1 to detail-2 transition at 1365×900. Geometry-check
and CPU-sampling overhead from the original suite is not duplicated, so this
is not an exact replay of historical scheduling. The real-idle predicate,
loaded/tiles/motion/backing-size conditions and its 60,000 ms deadline are
preserved. An unsuccessful original transition stays a failed result even if
the independent pixel checks pass. The failed page is closed before pixel
checks so its outstanding work cannot contaminate that phase.

The independent nonempty rendering fixture uses actual buffered vector lines
and polygons crossing tile edges, opaque/translucent fills, alternating source
layers and enough masks to require stencil-ID resets. Both arms run seven
states once: Mercator hidden, shown, hidden again, zoom 4, pitched/rotated,
globe and terrain. The terrain DEM is generated locally by the existing
synthetic fixture helper. Every state must draw real features and more than
1,000 nonwhite pixels. Showing the red layer must visibly change pixels;
hiding it must restore the original image. All 512×512 RGBA bytes and final
visible-layer dispatch sequences must match exactly across arms. No visual
tolerance or timing threshold is loosened to pass the experiment.

This independent check is explicitly registered in the browser-inventory test
under its separate fixture-safe workflow. It is not added to the production
site's recurring browser matrix, and no existing required check is removed.

## Observations and limits

Both arms use the same observation wrappers. They preserve request arguments,
signals, bodies and outcomes and never consume an extra body. They record:

- Page-clock fetch start, header resolution, body-read start and completion
- Page-clock frame begin/end and synchronous tile-mask time/count
- Stencil-clear count and the last frame's visible-layer dispatch
- Independent Node-clock fixture fulfillment/request lifecycle
- Failure-only source/render state and screenshots

The page clock is `performance.now()` milliseconds with its document
`timeOrigin`; Node lifecycle clocks are separate. Do not subtract unrelated
clocks. Synchronous mask time includes JS/native blocking but does not measure
GPU completion or worker CPU. The probe does not instrument custom-protocol
completion or actor queues. If the remaining delay is beyond body completion,
that next boundary remains an explicit missing observation.

Capture has a 60-second page watchdog, 512 request records, 128 retained frames
and 2,048 last-frame dispatch entries, with explicit truncation flags. The
post-acceptance probe read is bounded to two seconds. A blocked page can delay
its watchdog; unavailable reads are reported and cannot pass acceptance.
The experiment has a separate 12-minute outer bound and workflow limit.
Observation wrappers can affect scheduling; this is diagnostic evidence.

All providers receive explicit local fixtures. The unchanged shared browser
transport guard blocks unmocked egress, redirects, WebSockets and service
workers. Only the local preview is allowed; no live provider downloads,
new retries, increased concurrency, deadline extensions or changes to the
URL157/source185 holds are permitted. Browser screenshots and bounded JSON
are retained in the workflow artifact even on failure. Bulky captures are not
committed to the application branch. URL query/fragment/userinfo, bodies,
headers, credentials and arbitrary protocol error messages are not retained
in probe records.

## Interpretation and next decision

Run this pair once on the exact diagnostic head. Preserve its natural result.
Do not rerun to manufacture a timeout. An instrumentation correction would
require a new reviewed head and a separately identified measurement.

Pixel/dispatch failure rejects the guard's rendering equivalence. Passing
equivalence plus lower mask work supports a narrow performance candidate;
it does not prove that the original intermittent timeout was repaired.
Compare frame/mask spans with body completion to decide whether the extra
work contributes materially in this pair. If relevant stalls do not decrease,
do not promote it as the timeout remedy. A missing observation or a passing
original arm is a valid inconclusive result.

No production patch is proposed here. A later source-level upstream fix or
second local backport requires separate exact-head review, complete required
CI, rendering compatibility and integrity/service-worker checks. Do not
silently broaden the attribution-only backport or replace minified blobs.

Local reproduction uses `node scripts/diagnose-controls-painter.mjs` and
`node --experimental-vm-modules --test tests/controls-painter-*.test.mjs`.
The hosted executable is `node scripts/check-controls-painter-browser.mjs`
against the built loopback preview. Local Chromium was already blocked before
application execution by socket permissions; no new local browser claim is
made. Test commands and final-source outcomes are recorded in the PR receipt.
