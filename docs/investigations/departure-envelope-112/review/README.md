# Independent review: malformed stop-board envelopes

## Result

No blocking finding in the frozen 13-path candidate based on main
`f9bd326c6a2a3738daafd36a58a16f9a2251c5a8`. The bounded source correction is accepted
by this independent review. The implementer's recorded build and repository
aggregate are green: 1,380/1,380 tests, no skipped or cancelled tests, build exit 0,
generated style unchanged and diff check exit 0. I inspected those records rather
than rerunning the heavy aggregate. Hosted browser CI and any release/deployment
checks remain separate gates; this review does not claim that they have finished.

The correction validates only the consumed top-level stop-board envelope, inside
each per-stop promise. A non-null, non-array object with an array-valued `stopTimes`
is successful. Legitimate empty arrays remain successful. Invalid shapes reject
before `Promise.allSettled` reports success, preserving healthy sibling rows and
the existing partial-result status. Full row-schema validation remains out of scope.

## Source binding and scope

- Frozen manifest SHA-256: `21335394fcce7876763df348c9511ac5acbc7ff06d4b70e4d8d123f0411d1aec`.
- Candidate `styles/departures.mjs` SHA-256: `30f6c147858bdfbe3b4f2b0579ca7f7c8a7b9aa6d60be7a21cf43b14e4d3c231`.
- Candidate departures Git blob: `c50190ccb6e26ab28fd0b85978009845ec61de62`.
- Baseline departures Git blob: `a56d65c755ab3e6c4cb00fe7d0b8a466111a0254`.
- Independently verified each of the 13 manifest paths against size, SHA-256 and Git
  blob hash. The other 467 baseline blobs remain unchanged. All baseline modules
  used by the negative probe match the provided main-commit tree's blob hashes.
- Verified the compressed predecessor fixture's app/departures text against both
  its SHA-256 fields and exact main-commit Git blob hashes.
- Reviewed the complete source/test/browser/doc diff. Runtime changes outside
  `departures.mjs` are coherent release-version replacements only. Selected-stop
  limits, request URLs/budget, signal forwarding, identity reconciliation, cache
  keys, cache lifetime, renderer and existing empty/no-match wording are unchanged.
- `git diff --check` passes.

## Independent negative and positive checks

`probe.mjs` runs 366 independently constructed cases without provider/network calls.
It uses real `Response.json()` decoding rather than only returning mocked JS values.

- Baseline: 82 pass, **284 fail**. Failures distinguish false successful empty
  boards from truthy non-array values that lose a healthy sibling after settlement.
- Frozen candidate: **366 pass, 0 fail**.
- 26 body/envelope shapes: empty, whitespace, truncated/trailing JSON; top-level
  null, booleans, numbers, strings, arrays and objects; missing `stopTimes`; null,
  boolean, numeric, string, object and array-like object `stopTimes` values.
- Both selected-stop orders and both explicitly controlled response-completion
  orders, each with legitimate empty and populated sibling boards.
- Preserved safe stop-result fields, healthy rows, signal identity, `n=30`, rail-mode
  query, unchanged inputs, the two-stop cap and exactly one lookup plus two board
  requests, including an unselected third candidate.
- Positive controls for empty/populated arrays with unused extension fields and
  unchanged duplicate-row reconciliation.
- Production cache/renderer extracted from actual app source and run in JSDOM:
  partial empty/populated results, both English/Japanese redraw directions,
  translated journey labels, no requests at exactly 60 seconds, normal refresh
  only on opening after 60 seconds, no board Retry button, no leaked response text.
- All 26 malformed cases tested for generic all-failed UI, failed-cache eviction,
  ordinary reopening, recovery to a legitimate no-match result, and translated
  cached no-match behavior. Complete-empty, no-match and partial-empty are distinct.

The implementation's repository tests also add 19 malformed JS-envelope values,
including `undefined` values that cannot be encoded in JSON. The browser additions
are fixture-only: seven representative malformed envelopes, both sibling orders,
empty/populated siblings, cached partial status, expiry and all-malformed recovery.
They retain the existing Chromium/WebKit flow and external-egress guard. Their
actual browser execution is a hosted-CI gate, not a result of this local review.

## Contract and limitations

The source-contract investigation established that official MOTIS v1 and the
current documented handler require an object containing a `stopTimes` array:

- [Original v1 schema](https://github.com/motis-project/motis/blob/v2.0.0/openapi.yaml#L254-L270)
- [Current documented schema](https://github.com/motis-project/motis/blob/v2.10.2/openapi.yaml#L2433-L2462)
- [v1/current route registration](https://github.com/motis-project/motis/blob/v2.10.2/include/motis/motis_instance.h#L110-L113)
- [Array-producing handler](https://github.com/motis-project/motis/blob/v2.10.2/src/endpoints/stop_times.cc#L503-L645)

This is synthetic source/contract evidence, not a claim that production Transitous
returned malformed responses or a new claim about timetable coverage. No live
provider request, retry policy, publishing or merge was performed by this reviewer. The verified local Unix-socket browser restriction was
respected; no local browser launch or bypass was attempted. Hosted browser checks
remain required. Unrelated completed work and explicit stops remain untouched.

## Reproduce

From a checked-out candidate with the project's pinned dependencies installed:

```sh
node docs/investigations/departure-envelope-112/review/probe.mjs .
```

Run the same script with a checkout of the baseline commit as its path argument
for the negative control. The script's JSON summary contains failures and exits
nonzero when any case fails. `baseline-probe.json` and `frozen-probe.json` are the
recorded normalized summaries; `frozen-source-manifest.json` binds the candidate.
