# Per-board stop-time envelope validation

Bounded follow-up to [#112](https://github.com/c933103/openrailwaystyle/issues/112)
and [#129](https://github.com/c933103/openrailwaystyle/issues/129), based on main
`f9bd326c6a2a3738daafd36a58a16f9a2251c5a8`. All 479 baseline blobs were matched
against GitHub's tree before editing; see [baseline verification](baseline-verification.json).
Both wider issues remain open.

## Finding and contract

`d.stopTimes || []` previously treated missing/falsey fields as successfully empty
boards. Truthy non-array fields could instead fail during row processing, after
the promises settled, and discard a healthy sibling's rows. These are reproduced
source-level behaviors with synthetic responses, not evidence of any malformed
production Transitous response.

The historical [MOTIS v1 schema](https://github.com/motis-project/motis/blob/v2.0.0/openapi.yaml#L254-L270)
requires an object with an array-valued `stopTimes`. [Transitous API documentation](https://transitous.org/api/)
currently points to MOTIS v2.10.2: its [v1 and v6 routes share a handler](https://github.com/motis-project/motis/blob/v2.10.2/include/motis/motis_instance.h#L110-L113),
and its [response schema](https://github.com/motis-project/motis/blob/v2.10.2/openapi.yaml#L2433-L2462)
and [response construction](https://github.com/motis-project/motis/blob/v2.10.2/src/endpoints/stop_times.cc#L503-L645)
retain an array for valid empty responses. No live provider query was needed.

## Bounded change

Validate only the consumed envelope inside each selected stop's promise:
non-null non-array object, with an array-valued `stopTimes`. Malformed envelopes
reject using a generic error. The existing settlement logic preserves healthy
boards and its per-stop outcome, or rejects when no board succeeds.

Row parsing, matching, stop selection, request budget, abort signals, identity,
cache timing, and partial-warning text are unchanged. Unknown response fields
are accepted; this is not full row-schema validation. The coherent asset token
is `20261011-departure-envelope-1`, with exact predecessor app/module bytes in
`tests/fixtures/departure-envelope-predecessor.json.gz` for cache-upgrade tests.

## Recorded checks

Node v24.19.0, 2026-10-11 UTC:

- [Baseline regression control](baseline-regressions.log): 23/24 fail before the
  fix; the valid-envelope positive control passes. [Exit code](baseline-regressions.exit).
- [Baseline cache-upgrade control](baseline-cache.log): 2/2 fail with unchanged
  predecessor version. [Exit code](baseline-cache.exit).
- [Focused parser/DOM suite](focused.log): 69/69 pass.
- [Final aggregate](full-suite-final.log): 1,380/1,380 pass, zero failures,
  skipped or cancelled. [Exit code](full-suite-final.exit).
- [Build](build.log), [generated-style check](generated-style.exit), and
  [whitespace check](diff-check.exit): exit 0; world style unchanged.
- Independent [frozen probe](review/frozen-probe.json): 366/366 pass, versus
  [284 failures out of 366 on the baseline](review/baseline-probe.json).
  [Reproducible probe](review/probe.mjs).
- [Frozen source manifest](frozen-source-manifest.json) binds all 13 changed
  source/test/fixture files; [text diff](frozen-source.diff) records the edits.

The main matrix includes 19 malformed envelope/field shapes, valid empty and
populated lists, extension fields, both selected-stop orders, healthy sibling
preservation, bounded calls/signals, partial cache expiry, all-malformed generic
failure/eviction, and normal reopening. The independent probe adds raw JSON
parse failures, both completion orders, and translated cached partial redraws.

Reproduce from the repository root:

```sh
npm run build
node --experimental-vm-modules --test tests/departure-availability.test.mjs
node --experimental-vm-modules --test tests/*.test.mjs
node docs/investigations/departure-envelope-112/review/probe.mjs "$PWD"
git diff --check
```

## Browser acceptance boundary

`scripts/check-departures-browser.mjs` adds 28 malformed/healthy partial cases
(seven representative envelopes, both selected-stop orders, empty/populated
siblings), plus all-malformed eviction/recovery in both orders. They run through
the real Atlas renderer with synthetic HTTP JSON responses, existing transport
guards and no live provider requests. Screenshot cases cover malformed partial
empty, partial rows and complete failure in Chromium and WebKit.

Local browser launch was not attempted because the current environment restricts
the required Unix-socket launch path. Hosted Chromium/WebKit acceptance and
Codex review are publication gates still pending at this initial evidence commit.
Node DOM/cache checks are not native browser service-worker interception coverage.
