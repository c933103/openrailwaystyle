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

Use an indexed, cached geometric partition for each route’s supplied shapes and
verified railway paths before accumulating trips. Retain the existing 15 cm collinearity
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

## Original patch verification

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

## Review correction: near-collinear endpoints

Codex identified a remaining endpoint mismatch on head
`e0a0f3ba3e78dad945140f862df6269fcd6bfa7c`: a graph path offset by about 5.6 cm
retained endpoint tuples different from its supplied shape. An inserted off-line
interior vertex could also reverse the following interval's lexicographic
direction. The new near-offset end-to-end regression reproduces 4/h instead of
8/h on that head; the compiler regression suite produces 11 failing subcases,
including a direct direction assertion.

The correction reconciles compatible endpoint clusters first, projects interior
vertices onto those intervals, and assigns deterministic shared coordinates
before splitting. Each coordinate cluster and displacement is bounded to 15 cm.
The 16.7 cm parallel-track control stays separate. Both travel directions,
input ordering and latitude-aware positive/negative distances are covered.

A further review fixture supplies a central full path with interior short paths
11 cm to either side. Choosing one side by coordinate order, or inserting two
raw vertices at the same progress value, invents lateral/diagonal edges. The
regression fails in all four order/direction combinations on the intermediate
candidate. Incompatible neighbourhoods now retain their source coordinates;
interior cuts are projected onto their own interval and zero-progress edges
are never emitted. The 0/11/22 cm control also keeps all three tracks rather than
choosing an arbitrary pair. Dense vertices along one line remain usable.

Where ownership is ambiguous, an affected active pattern uses the existing
route-scoped incomplete-geometry gate: geometry remains auditable but rates
are unknown. Reconciliation itself is now partitioned by route and actual contributing
eligibility, rather than applying that scope only to the final unknown flag.
The existing contribution function determines eligibility, including calendar
exceptions, inactive weekdays, headway windows and prior-day extended-hour trips.
Other partitions can supply projected cuts but cannot move a current working or
create its ambiguity. Explicit source-edge ownership preserves a source
polyline's dense slight bends; only served portions of supplied shapes enter the
partition. Two longitudinal samples from one source cannot establish competing
tracks merely because another path shares a nearby coordinate. Graph ownership
is tied to each normalized path, not its rail mode: distinct same-mode tracks
remain independent evidence, while shared full/short path vertices retain
continuity. Adjacent graph workings may also retain continuity at an actual local
degree-two graph vertex; distant connections and junctions do not supply that
proof. The exact route-isolation, expired/future, removed-service, weekday,
prior-day and dense-bend review cases are retained as regression tests.

A noncontributing interval can reuse a unique existing contributor interval when
both corresponding endpoints stay within 15 cm of its original source. This is
one-way: current coordinates do not change and no new connecting edge is created.
The hour-only and hour-plus-AM end-to-end cases retain the same selected-hour
coverage. Final checks use unrounded served-extent witnesses and distance to the
original supporting edge, independently of output-coordinate rounding. Both
bounds apply to reconciliation and one-way alignment: clipping an oblique shape
at stops must not compound its initial rounding with another 15 cm allowance.
An affected interval retains bounded source geometry and is withheld. World-copy
shifts use exact multiples of 360°, avoiding rounded
midpoint shifts and missing endpoint keys. Projection lookup grids are released
before reconciliation. These compact offline cases are not a nationwide timing
or memory benchmark.

An end-to-end equal-rate fixture proves genuinely ambiguous unknowns survive
publication and MVT binding without changing OSM geometry or Equal mode.

Final local correction validation is recorded in the exact-head PR receipt.
Earlier intermediate candidates passed 2,150 and 2,151 tests at concurrency 4. A default
aggregate and isolated unchanged DOM retry received SIGKILL; those failures
are retained. These earlier results do not validate the final scoped correction.

Exact-head hosted checks and Codex re-review remain required. The earlier head's
successful Chromium/WebKit mixed-path runs do not establish the correction's
acceptance. Final results belong in the PR's exact-head validation receipt.
