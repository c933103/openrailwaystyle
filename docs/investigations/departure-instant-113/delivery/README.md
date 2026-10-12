# Delivered exact-instant departure merge veto

The bounded correction in [PR #194](https://github.com/c933103/openrailwaystyle/pull/194)
is merged as `dea9f68e9d4c585c29ff225c4c052e689dac849b`, deployed and verified.
The merge, exact-head-reviewed candidate `87255f8`, and hosted PR test merge
`83874a0` share tree `268b0fe8945644cfe6dda468ccbab322a324fac2`
([source lineage](accepted-source-lineage.json)).

The implementation and its conservative limits remain as described in the
[original investigation](../README.md) and [integration record](../integration/README.md).
Different scheduled instants cannot merge through the old minute bucket; the
original ambiguity graph stays intact so the change does not unlock new matches.
This does not establish complete one-real-train identity. [#113](https://github.com/c933103/openrailwaystyle/issues/113)
and [#129](https://github.com/c933103/openrailwaystyle/issues/129) remain open.

## Deployment lineage and terminal gates

- The direct merge-triggered site run
  [38198361889](https://github.com/c933103/openrailwaystyle/actions/runs/38198361889)
  was canceled while queued, before any jobs ran. It did not fail application tests.
- The direct reference run
  [38198361850](https://github.com/c933103/openrailwaystyle/actions/runs/38198361850)
  passed. Its assemble log explicitly records dispatch of
  [site successor 38199070602](https://github.com/c933103/openrailwaystyle/actions/runs/38199070602)
  on the accepted merge. The new pending main deployment replaced the earlier
  queued push run while the preceding main deployment finished.
- That pinned successor completed successfully: validation, all six browser
  groups, aggregate browser checks, Pages deployment and hosted published-site
  verification. The `record` job was skipped for this main workflow as configured.

[Exact run lineage](successor-lineage.json) and [final job receipt](final-workflow-receipt.json)
identify the bounded runs. No manual dispatch or restart of the superseded run
was needed. No unrelated later scheduled runs were monitored.

[Hosted controls output](successor-controls-excerpt.log) identifies merge
`dea9f68e` and token `20261012-departure-instant-2` and confirms the departures
checker passed in Chromium and WebKit. This includes trip expansion, cached and
interrupted flows, malformed lookup and per-board malformed-envelope recovery.
[Hosted deployment output](successor-deploy-excerpt.log) records the exact Pages
deployment, deployed tile checks and independent-reference/railway renderer gates.

## Actual served bytes and controlled behavior

[First served verification](first-served-verification.json) and [final post-success
verification](final-served-verification.json) are independent first-party reads.
Both match all 14 affected/supporting files to the accepted merge byte-for-byte.
The generated bundle identifies that exact merge and release token. The files
include the parser, app, schedule renderer, worker, cache-related support modules
and stylesheet; report hashes make their content inspectable.

The downloaded application bytes passed:

- [186 unit/DOM/cache tests](served-unit.log), including the 30 exact-instant
  regressions plus the preserved identity, platform, availability, trip and
  service-worker lifecycle cases in those suites.
- [366 envelope probes](served-envelope.log).
- [12,000 immediate-predecessor identity cases](served-monotonicity.log), with
  zero newly formed merge groups: 8,267 baseline groups versus 2,664 successor.
- [14 envelope/identity composition cases](served-composition.log).

Only first-party GETs were used, with redirects rejected. Behavioral checks
replace provider responses with synthetic fixtures. No live timetable-provider
requests or local native browser launch were used. Worker/DOM tests are simulated
lifecycle checks, not native browser service-worker interception coverage; hosted
browser results above remain separate evidence.

The initial checker omitted the supporting `power-facilities.mjs` file needed by
an existing cache test, so that harness run had 185 passes and one missing-file
failure ([diagnostic](initial-checker-diagnostic.log)). The checker was corrected
to fetch and verify that 14th file, with no production-source change. Both complete
subsequent runs passed. The failed harness result is not presented as an
application defect or a successful verification.

## Reproduce

Use a checkout of accepted merge `dea9f68e9d4c585c29ff225c4c052e689dac849b`
and its pinned dependencies (`npm ci --ignore-scripts`, supported Node.js runtime).
The checker uses the checkout's test harness and historical fixtures but imports
application/worker bytes fetched from the published site.

```sh
node /path/to/check-served-departure-instant.mjs /path/to/accepted-checkout /tmp/atlas-served-check
```

[Checker source](check-served-departure-instant.mjs). Future deployments can
legitimately cause its exact-byte/commit checks to fail; this record describes
the stated observation window, not an indefinite availability promise.
