# Cancel platform-length work below its display threshold

Related: #150 (resources), #138 (provider handling), and the A04/A05 scope in
#176. This bounded correction does not close their broader acceptance.

## Defect and correction

Base: `a486084d2b06fe99aa70ed19a22bcb99f4d8eec0` (merged PR #239).
Platform lengths are measured and displayed from zoom 19. Platform references
remain visible from zoom 17. Dropping from zoom 19 to 18 therefore kept the
platform in the desired set, so the active measurement was not cancelled.
It continued reading neighbouring tiles and computing a hidden length.

A controlled three-tile line reproduces this using the actual
`createPlatformLengths` and `createPlatformTileGeometry` implementations.
The first tile response is held while the map drops to zoom 18:

| Observation | Base | Correction |
| --- | --- | --- |
| Measurement signal after zoom drop | live | aborted |
| Total fixture tile loads after releasing the first response | 3 | 1 |
| Hidden completed measurement | 1 | 0 |

The correction aborts the measurement when the existing zoom-19 eligibility
is lost, as it already does when a platform leaves the viewport. It retains
the existing tile-reader contract: an already requested shared tile may finish
and remain cached. This does not cancel that network fetch. No further neighbour
is requested by the cancelled measurement.

Returning to zoom 19 restarts measurement without provider-failure backoff and
reuses that first tile, whether its response is still pending or completed.
The resumed result and visited-tile list exactly equal an uninterrupted
measurement: 1,253.238219698226 metres for this deliberately synthetic line,
with all three required tiles visited. Eligible zoom-19/20 changes continue the
same active measurement. No geometry, display threshold, API reference lookup,
source policy, output precision or required CI gate changes.

## Verification contract

- Five offline regressions cover zoom 17/18 interruption, quick zoom-back before
  the abort settles, completed/pending tile reuse and eligible zoom 19/20 controls.
- The identical tests on the base fail the three cancellation cases; both
  eligible-zoom compatibility controls pass. The correction passes all five.
- The page and its transitive modules use asset version
  `20261017-platform-measure-zoom-1`, shell generation 36. Service-worker tests
  exercise exact current platform module bytes and retention of older tabs.
- The temporary checkout's 598 available tracked files matched the base Git
  tree. Historical investigation archives and one unrelated logo were absent;
  neither is reconstructed or changed by this PR.
- Build, full tests, focused tests and browser results, including any failures
  or environment limits, are recorded in the PR receipt. Existing hosted
  fixture-safe browser and aggregate gates remain required before merge.

All tile loads here are injected fixture calls. No public-provider tile was
downloaded, and these counts do not establish production bandwidth, device CPU,
GPU memory, physical-phone or general performance improvement.
