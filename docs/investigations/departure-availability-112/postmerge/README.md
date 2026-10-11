# Merged #190 delivery verification

Observation window: 2026-10-11 19:46–20:33 UTC, before later #191 delivery.

- Reviewed head: `6f18de8225aa936aa9b1d229812a139e8ae65a2e`.
- Merge: `79162dff6808b18461e4c8e33e177ca39effb146`.
- Exact accepted/merged source tree: `3fbe3aefc4964325c3146cb40e62ac20ccc984a2`.
- Release: `20261011-departure-availability-2`.

## Automatic deployment chain

The [merge reference workflow](https://github.com/c933103/openrailwaystyle/actions/runs/38169411518)
completed successfully. Its automatic Redeploy step ran 19:55:19–19:55:21 UTC and
created [site successor 38170038659](https://github.com/c933103/openrailwaystyle/actions/runs/38170038659)
at 19:55:20 on the exact merge SHA. That successor replaced the pending push run
38169411514, which was cancelled without jobs; this was not a failed application
check. The preceding scheduled-data deployment on the older Power merge finished
and released the production queue. No workflow was manually dispatched here.

The direct successor passed validation, all six browser groups, the browser gate,
Pages publication and hosted post-deployment checks. Those included deployed
independent geometry and the published-map local railway fixture. Full selected
metadata and step timestamps are in [workflow-receipt.json](workflow-receipt.json).
Later unrelated refreshes and #191 delivery are outside this completed check.

## Actual served bytes and departure fixture

At 20:23:21 UTC, actual first-party HTTP responses for the index and ten source
assets matched the reviewed files byte-for-byte. The built tile-label bundle
contained the exact merge SHA and availability-2 token. [Asset hashes and sizes](served-bytes.json)
identify every checked file.

The served-app Chromium fixture loaded those actual first-party assets, retained
the repository's provider guard and replaced external providers with synthetic
responses. All existing departure behavior assertions passed: both selected-stop
orders, partial-empty and usable rows, translated headings/journey names with
cached warning and bounded requests, normal expiry recovery, all-failed eviction,
no match, selection, pending Close and cached reopening. The completed run exited
zero. Both partial screenshots were inspected: the warning is legible, empty
partial results do not make a complete-empty claim, and usable rows remain.

### Navigation diagnostics and limits

The initial loopback-derived checker and an identical retry each timed out at the
existing 30-second DOMContentLoaded navigation budget, before departure assertions.
An instrumented run retained that budget: HTML arrived at 7.4 s, app/CSS at 15.6 s,
and imported modules around 24 s; three dependency requests were still pending
at the cutoff. The document was interactive and app execution had not started.
See [request waterfall](navigation-waterfall-30s.json) and the three failure logs.
No failed HTTP response or product defect was established by those timeouts.

A separately approved local production-site run used the existing production
Power checker's 60-second navigation allowance. Only navigation's timeout changed;
behavior assertions, request bounds, expiry checks and provider guards did not.
Its first execution reached DOMContentLoaded at 31.95 s but lost its execution
session before a terminal receipt (the polling tool reported a generic approval
review cancellation, then an unknown process ID). Its partial log is retained and
**is not counted as a pass**. The same 60-second run then completed successfully,
with DOMContentLoaded at 32.35 s and exit code zero. This is explicitly a changed
local navigation budget, not an unchanged passing retry or a CI assertion change.

The passing run's trailing first-party request messages occur after all assertion
summaries and identify browser/context closure. Request-header call-log lines are
omitted from the published logs; the failure headlines and progress remain.
WebKit was unavailable locally; hosted dual-engine validation passed. Service
workers were blocked for browser interception safety; separate VM cache tests
cover upgrade behavior. No live timetable/provider coverage claim is made.

## Evidence and rerun setup

- [Completed served fixture](served-browser-production-budget.log)
- [Initial 30-second failure](served-browser-first.log)
- [Identical retry failure](served-browser-retry.log)
- [30-second diagnostic failure](served-browser-diagnostic.log)
- [Interrupted 60-second run, not a pass](served-browser-production-budget-interrupted.log)
- [Served checker adaptation](served-checker-adaptation.patch)
- [Browser launcher](run-departures-served.mjs)
- [Exact-byte checker](check-departures-served-bytes.mjs)
- [Partial-empty screenshot](departures-partial-empty-chromium.png)
- [Partial-with-rows screenshot](departures-partial-rows-chromium.png)

The adaptation is temporary verification code based on the committed departure
checker: it selects actual Pages assets and Chromium, adds request diagnostics,
and sets only navigation to 60 seconds. Run it from the accepted repository
checkout with its installed Playwright dependencies/browser, applying the patch
to the temporary script path and placing the launcher under `scripts/` as
`run-departures-served.tmp.mjs`. Its proxy comes from the existing environment;
no proxy value or credentials are recorded. Source files and hosted CI checks
were not changed for these runs. Broader #112/#129 remain open.
