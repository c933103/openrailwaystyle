# Reviewed operator context — 15 October 2026

Baseline: `7b4165ba9f54d0c09f7c94e953fdd6abe156f237`. Related: #111, #112.
This bounded correction does not complete either broader issue.

The held feed declares agency `Toei`, name `都営地下鉄 Toei Subway`, URL
`https://www.kotsu.metro.tokyo.jp/`. The retained OSM Arakawa service declares
operator `東京都交通局`, ref `SA`, relation `1952418`. Its operator's
[home page](https://www.kotsu.metro.tokyo.jp/) and
[Arakawa page](https://www.kotsu.metro.tokyo.jp/toden/) establish the brand/operator
relationship. Review checked 2026-10-15; exclusive UTC expiry 2026-11-14.

The registry pins the feed, original ZIP SHA-256 and unchanged agency ID/name/URL.
It supplies operator context only. Mode, ref/name, whole supplied path, section
boundaries, ambiguity, calendar validity and duplicate/conflict checks remain.
Used assertions retain their IDs/evidence URLs and cap published expiry. Source
or declaration changes withhold the assertion. Direct declarations are independent.
Assembly explicitly loads the registry; bind-only rebuilds need no registry read.
Matcher revision 3 uses the existing main-only, deduplicated refresh mechanism.

## Immutable replay inputs and results

- [Worldwide run 38580722095](https://github.com/c933103/openrailwaystyle/actions/runs/38580722095),
  shard 6 artifact `11907992148`, ZIP SHA-256
  `508c9dd6dba5493106721f61d62e82c30b186a45369b517f99ae63b091449105`.
- Its `feeds/jp_tokyo-rail.json.gz`: SHA-256
  `aab4ccb2b967525a1eb4a460fcd6c1f2e2d9f0950d1acb93a9b1bce594f69825`.
  Original GTFS ZIP SHA-256
  `5b2c2f846189b681ddfaab173e2c669ee0ef88bbb9883ef996aa487c9e04267c`.
  Reference service date 2026-10-19; 127 routes, 34,519 segments.
- OSM `service-data` commit `f01a6fd8417cc044652f8dd4849fbc63b7690f8c`,
  `service-routes.ndjson.gz` SHA-256
  `531d08bff2e7917af511f494fc74c770a2b9a598c87f79e2bc303c5890033b8c`.
  Select the 309 Japan-stage relations and their 7,410 associated ways, preserving
  original records, geometry and memberships. Replay at 2026-10-15T00:00:00Z.

| Held single-feed replay | Without assertion | With assertion |
| --- | ---: | ---: |
| Matched services with usable profiles | 15 | 16 |
| Applied section records | 2,496 | 2,556 |
| Distinct applied OSM ways | 614 | 627 |
| Missing identity candidates | 106 | 105 |
| Failed path corroboration / ambiguous | 5 / 1 | 5 / 1 |

All 2,496 previous section bindings and their complete profile/source records
remain equal. The 60 added records belong only to Arakawa relation `1952418`.
The four Toei subway services were already matched through their network names;
the increment is **one service**, not five. Other feeds can still introduce
conflicts in worldwide assembly; this is not a live coverage claim.

Rebuilt Ōji tile `12/3637/1611` contains Arakawa AM rates 12/12.5 and hour-08
rates 13/14/15. Evaluating the actual production paint expression yields AM widths
4/4.041667. The decoded features retain `toei-tokyo-rail-20261015` and both
official evidence URLs. No GTFS geometry is displayed.

To reproduce, extract the pinned compiled feed and OSM gzip above. Use
`readTable`, `routeStages` and `wayRoutes` from `scripts/service-routes.mjs` to
select the Japan records. Run `createTimetableMatcher(table,{now,operatorBindings})`
twice: once with `{schema:1,bindings:[]}`, once with the JSON registry from
`scripts/timetable-operator-bindings.json`. Add the unchanged feed and call
`finish()`. Compare records by `(way,relation,line,edge)` and their binding hashes.
Pass the corrected result through `bindTimetableSections` and `buildTiles`;
decode the specified tile's `service_routes` layer and evaluate
`serviceFrequencyPaint({serviceWidth:'frequency',frequencyPeriod:'peak',peakPhase:'am'},now).width`
using the pinned MapLibre `createExpression` evaluator at zoom 12.

## Acceptance

Node 24.19.0, locked dependencies installed with
`npm ci --ignore-scripts --no-audit --no-fund`.

| Command | Local outcome |
| --- | --- |
| New positive operator-binding regression on baseline matcher | Fails: 0 rather than 3 sections |
| `node --test tests/data-maintenance.test.mjs tests/timetable-frequency.test.mjs tests/service-frequency-workflow.test.mjs tests/frequency-artifact-staging.test.mjs` | 75 pass, zero fail/skip |
| `node --test tests/service-normandy-geometry.test.mjs tests/service-paris-geometry.test.mjs tests/timetable-frequency.test.mjs` | 53 pass, zero fail/skip |
| `npm run build` and `git diff --exit-code -- styles/world.style.json` | Pass, 259 layers; committed style unchanged |
| `npm test` | 1,676 pass, zero fail; one existing unreadable-file/root skip |
| `node scripts/check-timetable-frequency-browser.mjs` | Chromium declared and operator-binding cases pass actual rendered widths; WebKit cannot launch without system libraries |
| `node --check scripts/timetable-operator-bindings.mjs`, `node --check scripts/timetable-frequency.mjs`, `node --check scripts/assemble-global-frequency.mjs`, `git diff --check` | Pass |

The fixture compiler computes the synthetic ZIP's real hash before the test
constructs its operator assertion. Positive/negative coverage includes unchanged
source data, feed/revision/agency/URL mismatches, URL-hash conflict, review validity,
direct-identity independence, mode/ref/path rejection, ambiguity, cross-source
conflicts, actual duplicate archives, source-proof retention, varied scripts,
invalid/bounded assertions and compiler-to-publication-to-MVT counts.
Existing bilingual, hourly, overnight, equal-width and short-working checks remain.

Local WebKit dependency installation was blocked by executor `setgroups`
restrictions. Hosted browser results, current-head review, merge and actual live
delivery are recorded separately in the PR; none is asserted by this replay.
Bulky inputs/logs stay outside the application branch. JR's formal-name and
rapid/local service-pattern reconciliation remains unresolved; no JR alias is added.
