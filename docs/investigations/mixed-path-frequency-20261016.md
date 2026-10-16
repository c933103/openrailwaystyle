# Shared intervals for mixed timetable paths

Base: `96d0073383fe2b780e598663d0650fff0b42e816` (tree
`15998e71168d16ec6407be5e19b8017fa5682b79`). Related: #111 and #122.

## Confirmed failure

A single feed can supply a shape for a full working and omit it for a short
working. The latter is already supported through a verified path on the saved
railway graph. Both paths can map successfully while using different segment
boundaries. A shaped A–C trip and a graph-matched A–B trip then produce overlapping
A–C and A–B measurements instead of a combined A–B count and the remaining B–C
count. Their separate counts either conflict during OSM binding or, if every
period agrees, are treated as one equal measurement and undercount the shared
section. This is reproducible with a tiny synthetic feed and local graph; no live
provider request is needed.

## Correction

Use one indexed, cached geometric partition for supplied shapes and verified
railway paths before accumulating trips. Retain the existing 15 cm collinearity
threshold, distinct parallel tracks, every traversal, both directions and each
original preceding served-stop anchor. Counts are accumulated by the existing
route/calendar/profile logic. No route matching, cross-feed duplicate rule,
OSM geometry or Equal-width behavior is relaxed.

The end-to-end equal-measurement regression gives the full and short workings
4/h each. Before the fix, the existing three OSM sections all receive 4/h. After
the fix, only their shared section receives 8/h; both remaining sections keep
4/h. The unequal-count regression recovers the previously withheld shared 6/h
section while its remainder retains 4/h.

Compiler-source hashes already invalidate the compiled-feed cache. Aggregate
revision 4 lets the existing main-only maintenance process request a refreshed
snapshot. Code publication alone does not prove refreshed data or deployment.

## Verification

Commands run from the repository root on Node 24.19.0 and Python 3.12:

- New Python cases against the original compiler: 9 failing subcases across the
  40-method suite; the nearby-track/missing-path negative control stays valid.
- New end-to-end cases against the original compiler: both fail, one because the
  shared section is absent and one because 8/h is incorrectly published as 4/h.
- Focused compiler, matcher, matching-contract, width and maintenance tests: 185
  passed, zero failed/skipped (including the 40 Python compiler methods).
- `npm run build`, committed-style/station reproducibility, Python/JavaScript syntax and
  whitespace checks pass.
- `npm test`: 2,149 passed, zero failed/skipped; 103.9 seconds.
- The real-renderer checker now includes mixed-source AM, selected-hour,
  overnight and Equal cases in Chromium and WebKit. Local execution stops before
  launch because the pinned Playwright Chromium executable is absent. No local
  browser pass is claimed; exact-head hosted checks remain required.

Fixtures cover either source providing the full or short working, opposing
and unequal directions, separate branches, same-time distinct trips, repeated
traversals, calendar removals, prior service days, future/expired variants,
original departure anchors, nearby parallel tracks and missing graph paths.
Existing duplicate-feed conflicts, period/timezone disagreements, zero/unknown,
OSM binding and unchanged service geometry tests remain binding.

## Limits

This fixes one verified mixed-path aggregation defect. It does not establish
worldwide completeness, resolve unknown source overlaps or replace the remaining
verified stop/service identity work in #111. No new timetable source or provider
fetch is added. Keep #111 and its broader acceptance work open.
