# Controls timing diagnostic follow-up

PR: https://github.com/c933103/openrailwaystyle/pull/212

Source: `29e06a435020c7e7af24322827b366d873818c95`; tree `2e5a836fa4a8f1f0a59b5abe070fe4be494a317b`; runtime/base `7b4165ba9f54d0c09f7c94e953fdd6abe156f237`.

The three-file aggregate delta adds a passive timing helper, a controls-artifact call and focused tests. Runtime sources, provider budgets, URL-migration holds, all 83 UI cases and the original real-idle/loaded/tiles/movement/canvas/60-second acceptance gate are unchanged. All 472 active preexisting source/build/test inputs were checked against the authoritative base Git tree. Original failure evidence in the parent directory is untouched.

## Diagnostic review fixes
The initial implementation reset statistics on repeated polls. The first correction still omitted work before the initial predicate; the second could silently reset a timed-out read after its result was discarded. The final helper has no resets or acknowledgement protocol: snapshots are non-destructive, document-lifetime cumulative observations with explicit `timeOrigin` and `startedAt`, counts/totals, maximums and at most 64 timestamped recent entries per statistic. A late read may drain queued observer entries into the cumulative record but cannot erase an interval.

The acceptance duration is the outer `ms` field. Browser timing covers the named document lifetime; compare cumulative counts/totals and relative timestamps between snapshots with matching timing origins. Navigation starts a new document. Do not interpret cumulative maximums as per-settlement measurements.

## Verification
- Final source: 23 focused tests passed; full default-parallel `npm test` passed 1,678/1,678 with zero failed/skipped/cancelled, exit 0.
- Build, generated-style reproducibility, syntax and whitespace passed.
- The late-read regression fails against the preceding helper as intended: 0 ms retained versus 60,000 ms expected.
- Earlier same-source aggregate failures on `0dee8e8` remain explicitly recorded in `local-verification.json`: unchanged platform-extent, schedule-event and globe-drag timing-sensitive checks failed under local aggregate load, then passed isolated replay. These are not retroactively labeled passing aggregates.
- Local Chromium could not launch because of the sandbox socket restriction; no bypass was attempted.
- Exact-head review and [hosted site run 38739936115](https://github.com/c933103/openrailwaystyle/actions/runs/38739936115) are pending at this receipt. Independent reference runs: [38739936208](https://github.com/c933103/openrailwaystyle/actions/runs/38739936208), [38739936289](https://github.com/c933103/openrailwaystyle/actions/runs/38739936289).

## Prior hosted measurements
Each prior diagnostic head passed 83 controls cases and recorded 75 settlements:
- `e106dc4`: first desktop detail-2 / maximum settlement 6,102 ms. [Artifact](https://github.com/c933103/openrailwaystyle/actions/runs/38731080611/artifacts/11970227249).
- `b95c43a`: first detail-2 4,948 ms; maximum 5,126 ms. [Artifact](https://github.com/c933103/openrailwaystyle/actions/runs/38736113731/artifacts/11974732765).
- `0dee8e8`: first detail-2 / maximum 5,776 ms. [Artifact](https://github.com/c933103/openrailwaystyle/actions/runs/38738322737/artifacts/11976425153).

`hosted-observations.json` contains compact metrics, limitations and exact artifact/file hashes. Full generated logs, screenshots and JSON captures are not duplicated into this source branch or this follow-up receipt. The earlier original failure archive remains preserved.

## Remaining bug
The original 60-second timeout has not recurred in these successful runs. Its root cause is not established. Fixture-handler completion is distinct from browser response/body delivery. Use corrected timing and the existing request/tile-state evidence if it recurs; do not describe this diagnostic change or any passing run as a repaired renderer timeout. Merge remains a separate decision after exact-head review and applicable CI.
