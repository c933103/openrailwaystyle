# Runtime station proximity across the antimeridian

Date: 2026-10-12. Related work: #112 (truthful availability), #130 (search).
This bounded correction does not complete either broader issue.

## Reproduction and cause

Baseline: main commit `50b8063813909067343fd3b1eb778104aa32f324`.
The actual runtime functions were called with synthetic records, without real
provider requests. A station at `(0, +179.999)` and a same-named timetable stop
at `(0, -179.999)` are approximately 222.39 m apart. Baseline departures reject
the stop, and both search paths retain a duplicate result. Reversing the
coordinates gives the same failure. Exact `+180/-180` coordinates fail too.
An equivalent ordinary-longitude 222 m case succeeds; a 2.335 km wrapped case
stays outside the existing bounds. See [reproduction.json](station-antimeridian-20261012/reproduction.json).

The shared error class is direct longitude subtraction in three local runtime
proximity calculations: `departures.mjs` stop distance and `map-model.mjs`
facility/geocoder and tile/found-result reconciliation. Tile-result ranking
already wraps longitude. Acquisition and snapshot matching are outside this fix.

## Correction and preserved behavior

Use the shortest signed longitude difference in all three affected calculations.
Keep the same mean-latitude scale and inclusive 400 m departure radius; search
keeps its existing strict latitude/scaled-longitude 0.004-degree rectangle.
Keep complete-name, numeric and bilingual identity checks, exact OSM type-and-ID
identity, nearest-stop fallback, original request coordinates, cancellation
signals, one lookup and at most two boards, availability status and cache rules.

The page and all literal current asset imports advance together to
`20261012-station-antimeridian-1`, so a cache-first installed shell can retrieve
the changed modules. The cache implementation and retention policy are unchanged.

## Validation

- [Baseline regressions](station-antimeridian-20261012/baseline.log): 87 tests,
  74 pass, 13 fail. All 13 failures are the new wrapped-proximity/DOM cases.
- [Focused candidate](station-antimeridian-20261012/focused.log): 144/144 pass,
  including stop names, availability, numeric search names, context and the new
  standalone seam fixtures.
- [Full clean suite](station-antimeridian-20261012/full-suite.log): 1499/1499
  pass, zero skipped, on Node v24.19.0. The
  [initial local run](station-antimeridian-20261012/initial-local-suite.log)
  had one browser-inventory failure caused by a previous task's untracked local
  checker; it was moved outside the temporary checkout before the clean rerun.
  The helper was never a repository change.
- [Build](station-antimeridian-20261012/build.log) passes. Generated committed
  `world.style.json` and station data remain byte-identical to baseline.
- Syntax checks for application, map model and departures pass; whitespace
  checks pass on changed source, tests and user-guide prose.
- [Independent review](station-antimeridian-20261012/independent-review.md): no
  must-fix finding, [314 focused tests](station-antimeridian-20261012/independent-focused.log),
  [60,000 seeded rotation/world-copy comparisons, 100 boundary checks and 15 invalid-input checks](station-antimeridian-20261012/independent-invariants.log).
  The [independent baseline run](station-antimeridian-20261012/independent-baseline.log)
  confirms 9/12 new standalone tests fail before the fix.
- [Existing browser regression](station-antimeridian-20261012/browser.log):
  Chromium passes the full departure fixture sequence, including partial
  availability, close/reopen, translated redraw, expiry and malformed responses.
  WebKit could not launch locally because seven host shared libraries are absent;
  hosted CI must establish that result. The new seam-to-board rendering cases
  run through the production renderer with a controlled JSDOM and injected feeds.

To rerun the portable independent comparison, use a separate checkout of baseline
`50b8063813909067343fd3b1eb778104aa32f324` and run from the candidate root:

```sh
node docs/investigations/station-antimeridian-20261012/independent-invariants.mjs /path/to/baseline
```

## Limits and next gate

These are synthetic algorithm, request and rendering regressions. They do not
establish live timetable coverage, provider availability, new acquisition,
global geospatial redesign, or deployed-byte delivery. Exact-head Codex review
and hosted CI must be checked before readiness/merge; broader #112 and #130 work
remains open. The custom-domain PR #157 remains on hold.
