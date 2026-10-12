# Search availability: delivery verification

The bounded correction in [PR #195](https://github.com/c933103/openrailwaystyle/pull/195)
is merged and delivery-verified. Related to #130 and #112; broader work remains
open. Both issues were checked open after merge and again at final handoff.

## Accepted source

- Accepted PR head: `e2a5aa9edd0dfff5e4b4453b02323be0ec099cff`.
- Merge: `b5a73c3aa03498259c2fd531b9644d52ae94db69`.
- Both have exact tree `f6eb6cc4c4a4b0c3629ecd18fc3a0bab6b2b5aa0`.
- All 639 merged file blobs match the verification source. See
  [merged source verification](merged-source-verification.json) and
  [path/blob manifest](merged-files.json).
- Asset version: `20261012-search-availability-1`.

The [implementation evidence](../README.md) retains the predecessor failures,
1435-test aggregate, 114-test independent review, source/lifecycle tests and
installed-cache regression. The ready-triggered Code and Security reviews
both completed on the accepted head without reported findings; see the
[review summary](https://github.com/c933103/openrailwaystyle/pull/195#issuecomment-6117358783)
and [acceptance receipt](https://github.com/c933103/openrailwaystyle/pull/195#issuecomment-6117613020).

## Bounded deployment chain

All three runs completed successfully on the merge commit:

| Run | Role | Result |
| --- | --- | --- |
| [38203339532](https://github.com/c933103/openrailwaystyle/actions/runs/38203339532) | Direct merge site deployment | Success |
| [38203339466](https://github.com/c933103/openrailwaystyle/actions/runs/38203339466) | Direct reference build | Success |
| [38204078239](https://github.com/c933103/openrailwaystyle/actions/runs/38204078239) | Reference-triggered site successor | Success |

The reference assemble job's log explicitly identifies the automatic successor
URL at `2026-10-12T04:30:39.8362216Z`; this is the lineage proof, rather than
assuming any later run with the same SHA belongs to this task. See
[successor lineage](successor-lineage.json) and the complete selected
[workflow/job/step outcomes](workflow-receipts.json).

Both site runs passed validation, all six browser groups and deployment,
including hosted deployed-source and published-map fixture checks. Their
provider transport guards were retained. No manual workflow dispatch or
monitoring of unrelated later scheduled runs was used.

## Actual served files and behavior

Three first-party HTTP reads were recorded: after each publication while its
hosted postdeployment checks finished, and a final read after all three bounded
workflows had succeeded. All three returned identical bytes for:

- `index.html`, `app.mjs`, `map-model.mjs`, `platform-length.mjs`, `axle-load.mjs`
- `cjk-font.mjs`, `departures-ui.mjs`, `elevation.mjs`, `layer-semantics.mjs`
- `app.css`, `sw.js`
- The exact versioned `vendor/tile-labels.js?v=20261012-search-availability-1`
  requested by the application

The eleven application assets match the accepted merge source byte-for-byte.
The versioned label bundle matches a local rebuild of that source with exact
merge/repository metadata byte-for-byte; only original response bytes are hashed.
Downloaded JavaScript is not evaluated to discover its identity.

Each read's actual downloaded application/model/cache bytes then passed:

- 57 focused search, numeric-name, API-fixture and service-worker tests
- 3 full-application DOM checks, including the four-outcome partial-empty,
  partial-with-rows, complete-empty and outage scenario

These are the same 60 tests repeated three times, not 180 distinct cases.
Source failures, healthy/local results, valid empty versus outage, timeouts,
cooldown, language-keyed cache reuse/recovery and stale-query behavior remain
covered. Reports contain observation timestamps, hashes, raw byte lengths and
the accepted build metadata:

- [Direct served report](direct-served-verification.json)
- [Automatic-successor served report](successor-served-verification.json)
- [Final served report](final-served-verification.json)
- [Cross-read comparison](served-comparison.json)

Adjacent `*-served-search.log`, `*-served-full-app.log` and `.exit` files retain
the executed results. An interrupted extra verification attempt was not used as
success evidence; reusing its output was correctly rejected by the checker's
fresh-output requirement. The final successful receipt came from a new output.

## Reproduce the served-byte check

Use the accepted source with its documented dependencies already installed,
and choose a new output directory outside the source tree:

```sh
node docs/investigations/search-availability-130/delivery/check-served-search-availability.mjs /path/to/accepted-source /path/to/new-output
```

The [checker review](review-checker.md) records its hash, preconditions and
limits. It requires a fresh output directory, rejects redirects, compares every
claimed downloaded asset before replay, and builds the expected versioned
bundle from accepted local source. Only fixed first-party Pages GETs are made.

The served-code replay uses synthetic search responses, DOM/VM/cache fixtures
and accepted local dependencies. It does not contact live search providers or
launch a local browser. Hosted browser results are separate evidence; these
local replays do not claim a screenshot, real-client service-worker interception,
live-provider coverage or universal propagation to every cached client.

## Completed scope

Partial-empty search now explicitly says no matches came from available sources
and identifies the unavailable source as incomplete search. Healthy remote/local
rows remain visible; complete-empty and total-outage distinctions, selection,
request bounds, cancellation and caching are preserved. This completes delivery
of that correction only. Broader search coverage/identity and availability,
ingestion, matching and freshness work remain open in #130 and #112.
