# Browser-fixture clock correction

Follow-through on initial #193 head `d47389a7e6296208512bd4110d6271046d693c52`
found a fixture-only timing defect before hosted browser acceptance was claimed.
The existing shared departure was ten minutes in the future, but six existing
cache-expiry steps plus 28 new steps advance the mock clock by over 34 minutes.
The production row filter correctly ages that row out, invalidating later
healthy-sibling assertions for an unrelated reason.

Only the reused cache-test row's arrival/departure now use the same far-future
2099 convention as the Node fixtures. Initial train-schedule fixtures retain
their original timestamps. All 34 explicit 60,001-ms cache-clock advances,
cache assertions, requests and renderer behavior remain unchanged. No production
module changes, clock resets or weakened assertions are included.

The [clock replay](../check-browser-clock.mjs) extracts the actual stop helper and
shared row expression from the browser script and calls production
`departureRows` at all 35 clock checkpoints. With no setup delay, the old fixture
passes 11 checkpoints and fails 24; the corrected fixture passes 35/35. A real
setup delay could only age the old row sooner.

```sh
node docs/investigations/departure-envelope-112/check-browser-clock.mjs .
```

Recorded negative/positive logs, the successor frozen manifest, final aggregate,
build and independent timing review accompany this report. The original source
manifest and evidence remain above as a record of the initial PR head. The
successor changes only the browser script among those 13 source/test paths;
the parser and other production modules are byte-identical.

Hosted dual-engine browser acceptance and exact-head Codex review remain required.
No local browser launch or provider request was used for this correction.
