# Distinguish unmatched timetable stops from lookup failure

This is a narrow correction under [#112](https://github.com/c933103/openrailwaystyle/issues/112)
and [#129](https://github.com/c933103/openrailwaystyle/issues/129). Both broader issues remain open.
The baseline is `c35d21dcf3dabe7499cd11ebd3d4f04127806b23`; all 458 source blobs
were verified against its GitHub tree before changes.

## Reproduction and correction

The existing `pickStops` selects up to two guided-mode stops within 400 metres.
An empty selection therefore means only that this lookup did not match a nearby
rail timetable stop. It cannot establish that no published timetable covers the
station. The old renderer made that stronger claim for both empty arrays and
arrays whose candidates were filtered out. The parser also converted any
non-array lookup response into an empty array, presenting malformed successful
HTTP responses as evidence of absent timetable coverage.

The renderer now says “No matching rail timetable stop was found within 400 m.”
Non-array top-level lookup responses reject with a fixed error, reaching the
existing generic loading-failure display and cache eviction. No raw response is
shown to the user. A normal reopening can retry that failed lookup. Valid empty
results remain cached for the existing interval.

Stop scoring, mode eligibility, distance threshold, matching, ordering, the
two-stop cap, provider endpoints and parameters, abort signals, cache keys and
expiry, partial results, all-selected-boards-empty results, and all-board-failed
behavior are unchanged. There is no automatic retry or new provider acquisition.
Individual candidate and stoptimes schema validation are outside this correction.

The asset token changes coherently from `20261011-search-numeric-1` to
`20261011-departure-match-1`. The service-worker source, cache generation and
retention policy do not change. The exact immediate predecessor `app.mjs` and
`departures.mjs` bytes are stored in
[`tests/fixtures/departure-unmatched-predecessor.json.gz`](../../../tests/fixtures/departure-unmatched-predecessor.json.gz)
with source commit and SHA-256 digests. Worker regressions verify the current
modules online and offline and preserve the old modules for existing tabs.
These are deterministic worker-logic tests, not native browser interception tests.

## Validation

- New parser/production-renderer DOM regressions on unchanged baseline: **28 pass,
  17 fail**. The failures demonstrate both the misleading message and malformed
  lookup coercion. See [baseline log](baseline-regressions.log).
- Corrected parser, production-renderer DOM, departure identity and worker-cache
  focused tests: **76/76 pass**, zero skipped. See [focused log](focused.log).
- `npm run build`, app/departures/browser-checker syntax, `git diff --check`, and
  unchanged generated style/station data checks: pass.
- Independent portable contract challenge: **36/36 pass**, including the
  399.999/400.001 metre controls, eligibility, ordering/cap, parameters/signals,
  error identity, partial success and all-failed behavior. The challenge verifies
  the exact predecessor Git blob hashes before using them.
- First aggregate run: **1353/1354 pass** in 94.7 seconds. The only failure was
  an existing startup integration assertion that still expected the removed
  coverage claim. That assertion now expects the no-match wording; no test
  condition or timeout was weakened. See [first-run log](full-suite-first.log).
- Final aggregate suite: **1354/1354 pass**, zero failures, cancellations or
  skips, in 95.9 seconds. See [final log](full-suite-final.log).
- Independent acceptance: **183/183** focused departures, DOM, startup and
  worker-cache tests pass on the final source. The predecessor fails the
  independent malformed-response negative control as expected. Source review
  found no remaining blocker; hosted dual-engine browser acceptance is still
  required before merge. See [independent review](review/README.md).
- Local Chromium browser validation: **not run past launch**. The executable
  aborted while creating its process-singleton Unix socket (`socket() failed:
  Operation not permitted`). The shell explicitly allows no Unix sockets; one
  auto-reviewed escalated launch was also blocked. The
  [initial launch](browser-launch-first.log) and
  [escalated launch](browser-launch-escalated.log) diagnostics are retained. This is an execution
  restriction, not a failing browser assertion. No alternate route was used to
  bypass it. Required hosted dual-engine fixture CI must pass before merge.

The committed browser checker extends the existing guarded synthetic-provider
fixture with empty/filtered lookup status, close/reopen, real translated heading
and journey-label redraw, cache expiry, malformed response and normal recovery
checks. No live departure requests were made. No claim about real-world timetable
coverage or native browser service-worker network interception is made.

Reproduce local non-browser checks from the repository root:

```sh
node --test tests/departure-availability.test.mjs tests/departures.test.mjs tests/sw-install.test.mjs
node docs/investigations/departure-match-112/independent-contract.mjs .
npm run build
npm test
```

The reviewed 14-file implementation patch SHA-256 is
`b5b27e772b34da53cb3201ab8f09345e76f48ff4b9e3d75410ede010359f6aee`;
[frozen source hashes](frozen-source-manifest.json) identify those exact bytes.
Evidence files added afterward do not change that implementation. Published
failure logs trim trailing whitespace only; their diagnostics and outcomes are
otherwise unchanged.
