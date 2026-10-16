# Terrain painter arrival-batch correction

## Preserved failure

The PR232 measurement at source
`d0ae45cc984aed44aaac0aa4fd1e742efc6eee5e` failed its required natural
terrain comparison. [Run 38907364746, artifact 12049071433](https://github.com/c933103/openrailwaystyle/actions/runs/38907364746/artifacts/12049071433)
remains the original failure; it is not replaced or reclassified by this analysis.
The extracted comparison JSON has SHA-256
`365b34f7db8622f4adf21aacce371e91262812f2d4a5281ac149a829dfc4beaa`.

All seven RGBA comparisons had zero changed bytes. Both original controls
transitions settled. The natural final terrain frame dispatched 360 visible
layer calls with no prepared cached tiles in the baseline, versus 234 calls
with seven cached tiles in the guarded arm. The cold/warm samples matched;
they cannot waive the natural failure.

## Concrete input-history evidence

Both penultimate terrain frames ended with all 20 terrain textures cached.
Between that frame and the final frame:

- Baseline visible DEM coordinates grew from 9 to 29.
- Guarded visible DEM coordinates grew from 25 to 29.
- Both arms had the same final source/terrain/layer identities.
- Final preparation did not change either incoming cache population.

The pinned MapLibre map's source-data callback calls
`TerrainTileManager.freeRtt(e.tile.tileID)`. That method invalidates terrain
textures for the arriving tile and its ancestor/descendant overlaps. The 20
newly visible baseline DEM coordinates invalidate all 20 terrain caches. The
four newly visible guarded coordinates (`811`, `311`, `111`, `011`) invalidate
13 and retain exactly `z33`, `1733`, `y33`, `1633`, `1f33`, `x33`, `1533`.

The compact fixture `tests/fixtures/controls-painter-dem-arrivals.json` preserves
those observed keys, canonical constructor inputs, expected retained tiles,
source hash and artifact link. The offline regression runs the real pinned
tile-ID relationships, terrain manager, render pool, texture painter and terrain
compositor. It produces 360 and 234 calls with either guard setting, exactly
matching the failed artifact's cache identities and ordered abstract composites.

This establishes a sufficient, artifact-specific input-history explanation.
The artifact does not record every source-data event, so it does not prove that
no other invalidation occurred. It is CPU control-flow/coverage evidence, not
WebGL pixel, worker-timing or original timeout-causation proof.

## Bounded scheduling correction

Only the isolated terrain pixel fixture gets a source-arrival barrier. A
scheduled renderer callback reads the currently requested source tiles. If any
source metadata or tile decoding is incomplete, the callback is recorded and
returns before entering the renderer. Normal source-data completion already
calls the pinned map's `_update` and `triggerRepaint` methods; the final
completion schedules the renderer after the whole outstanding batch is ready.
A renderer frame may request its next source batch in the usual way.

The original idle listener is registered before the synchronous terrain action
batch, in the same browser task. This closes a separate IPC timing window where
a fast arm could settle before the later idle-registration call and receive an
extra post-settlement repaint. The loaded/tile/motion/backing-size predicates
and 60-second deadline are unchanged.

The barrier has no timer, request retry, extra redraw, source setter, cache
assignment, fingerprint change or forced cold/warm state. It never enters the
application or original detail-1 to detail-2 controls transition. It changes
synthetic terrain fixture scheduling, so a hosted run of the correction is a
new, separately identified measurement, not a replay of historical timing.

Every actual renderer invocation now records complete source inputs and the
resulting source state. Both arms must have exactly equal invocation sequences
and source identities, plus equal per-frame terrain identities, incoming and
prepared caches, coordinate-bearing layer dispatch and resulting caches.
Deferred partial-batch observations remain in the artifact; they may differ
because arrival timing/order is the controlled nuisance input. Missing,
truncated or failed evidence rejects the comparison.

Both predicates validate the complete evidence schema before comparing values.
Every terrain snapshot needs exact ordered cache-to-terrain coverage with boolean
slot entries, complete source revisions/coordinates and visible-layer identities.
Batch sources require revision and usage fields; dispatch records require pass,
layer, coordinates and texture flags. Explicit empty slot/coordinate/dispatch
arrays are valid where appropriate; absent or malformed fields fail even when
both arms are identically incomplete.

The prior final natural dispatch/cache/identity gate remains mandatory, as do
all seven exact nonempty pixel comparisons and both cold/warm samples. A
cache-changing guard still changes an observed natural boundary or dispatch;
there is no later reset that can convert its failure to success.

## Validation and remaining acceptance

Offline tests cover:

- Actual archived 360/234 histories with the guard both enabled and disabled
- Different source completion orders and different counts of pending callbacks
- The pinned `_update`/`triggerRepaint` path resuming on source completion
- A guard-caused cache eviction and an equal-count cached-coordinate substitution
- Changed intermediate cache state, changed source/coordinate identity, missing
  evidence, truncation, failed source tiles, and never-completing source loads
- The original natural gate and pixel/cold/warm comparisons remaining binding

Run `node --experimental-vm-modules --test tests/controls-painter-*.test.mjs`,
`npm run build`, style reproducibility and the aggregate `npm test` on the exact
candidate. Record final results in the PR receipt.

Local browser execution was checked before application work: the pinned
Playwright executable is absent, and the installed Chromium aborts during
startup because `socket()` is not permitted. No local WebGL success is claimed.
The correction requires independent review and a new exact-head, fixture-only
hosted diagnostic. An unequal batch, cache, dispatch, image, timeout or missing
observation remains a failure; no unchanged-head rerun is proposed.
