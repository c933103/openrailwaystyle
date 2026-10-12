# Independent successor review: browser fixture clock horizon

## Finding and correction

The original #193 fixture expansion introduced a deterministic fixture-only timing
failure. Its reusable healthy row was set to real start plus ten minutes, but the
mocked browser clock advances six minutes in the existing partial/no-match cases,
then another 28 minutes in the new malformed-envelope cases. Production correctly
filters departures older than one minute. With zero setup delay, the shared row
therefore disappears at expiry step 11 (`660,011` ms after start). The first new
populated scenario affected is the array envelope in a/b stop order. Actual setup
time can only shorten the original row's useful horizon.

The reviewed successor changes only the cache-test row's arrival and departure to
`2099-01-01T12:00:00Z`. This isolates cache-expiry behavior from unrelated ageing of
a synthetic service during the 34-minute mock-clock exercise. The change matches
the existing Node fixture convention and does not require restructuring scenarios.
The original full-trip fixture still uses its unmodified real-time `Date.now()`
plus ten-minute schedule.

The earlier independent 366-case matrix used a 2099 fixture, so it did not expose
this separate browser-harness timing defect. This successor review supplies the
missing exact-browser-row horizon check.

## Exact-source review

- Predecessor browser-script SHA-256: `67f51839ec4e9c14d0f7a63e6cbe76970a6933d0514c85c0e86a5af71ca69bd8`.
- Successor browser-script SHA-256: `58809e88eb0e62f8501e3f7a9fa314e56417c343f7fe9bd9c523000c3c03bcec`.
- Successor source-manifest SHA-256: `29c222f9f303b36fbd9290dd688bf45a6c5dcfabb3008d1dbd595c7662db9f14`.
- Production parser remains SHA-256 `30f6c147858bdfbe3b4f2b0579ca7f7c8a7b9aa6d60be7a21cf43b14e4d3c231`.

All 13 successor manifest paths were checked. Only the browser-script hash changed;
the other 12 source paths are identical to the previously reviewed candidate.
Replacing the single new timestamp expression with its predecessor reproduces the
entire predecessor script's exact SHA-256. Thus all assertion text, request counts,
real-time trip setup, scenario order, and all 60,001-ms expiry increments remain
byte-identical. No cache reset or assertion weakening was introduced.

## Independent checks

`probe-fixture-clock.mjs` extracts the actual browser stop helper and cache-row
expression, evaluates them at a deterministic reference time, and runs production
`departureRows` over the resulting fixtures.

- Predecessor: healthy row survives 11/35 clock positions and is filtered at the
  remaining 24, beginning at step 11.
- Successor: healthy row survives all 35/35 clock positions.
- All 28 malformed scenarios retain their expected empty/populated row counts at
  all 56 before/after-expiry checkpoints.
- At final step 34, the healthy row remains available to the all-malformed recovery
  and pending Close/reopen scenarios.
- Two explicit age-cutoff controls confirm that the original row remains at exactly
  one minute old and is filtered one millisecond later. The far-future fixture does
  not alter production age filtering.
- Existing `tests/departures.test.mjs`: 10/10 pass, no skipped/cancelled tests. Its
  historical-departure regression still drops the old 04:30 service against the
  fixed 05:00 reference; no test or parser was changed.

Recorded results are in `clock-replay.json` and `departure-tests.log`. The
implementer's separate exact-row replay agrees: predecessor 11 pass / 24 fail,
successor 35 pass / 0 fail. Repository aggregate rerun and hosted Chromium/WebKit
validation are separate gates; no hosted-browser outcome is claimed here.

## Decision and limits

Accepted as a fixture-only correction with no blocking source finding. The original
production-parser review remains applicable because its bytes are unchanged.
Hosted dual-engine validation remains required. No browser workaround or live
service calls were used. No publication or merge was performed by this reviewer.

To reproduce from a repository checkout with pinned dependencies installed, run
this directory's `probe-fixture-clock.mjs` with the repository root as its sole
argument. The probe verifies exact successor/predecessor source binding before
running its assertions. `successor-source-manifest.json` binds the reviewed source.
