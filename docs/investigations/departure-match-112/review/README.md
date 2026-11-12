# Independent review: unmatched timetable-stop reporting

## Verdict

No unresolved source-level blockers in the reviewed correction. The existing successful-empty match result now says “No matching rail timetable stop was found within 400 m.” Non-array reverse-geocode responses reject through the existing generic loading-error path instead of being silently converted into successful empty results.

This is source and local-test acceptance. The dual-engine browser assertions did not run locally: Chromium launch was blocked before assertions by the verified Unix-socket restriction, and packaged WebKit was unavailable. Required hosted browser CI must pass before merge. No live-provider coverage claim is made.

## Exact reviewed scope

- Baseline: `c35d21dcf3dabe7499cd11ebd3d4f04127806b23`.
- Final implementation patch SHA-256: `b5b27e772b34da53cb3201ab8f09345e76f48ff4b9e3d75410ede010359f6aee`.
- All 14 implementation files matched the frozen source manifest before and after independent tests.
- Corrected parser SHA-256: `f2075dfc0bdb58e444d80d7b3517e75d1855aa8c7837d216ef2f25750bb34338`.
- The compressed immediate-predecessor fixture was independently checked against the recorded GitHub baseline tree. Its app blob is `3718acf9fd2b92010e32d248b95fe1c6cd5f0e5d`; departures blob is `1e914c5c75042ec4544c81e493731b1077d0dfba`.

Besides the array-shape rejection and no-match message, production edits only advance the coherent asset token from `20261011-search-numeric-1` to `20261011-departure-match-1`. The renderer/cache block is otherwise byte-identical after normalizing the token and wording. Existing matching, rail modes, 400 m radius, name preference, nearest-stop fallback, two-board cap, request parameters, short-lived cache, partial board results and generic errors are preserved. No broad provider-schema validation was introduced.

## Independently executed checks

- **183/183 pass**, zero failures, skips or cancellations: departures availability, identity, platform and label controls; actual production renderer/cache in a DOM; startup station integration; service-worker exact-predecessor upgrades. Duration: 9.97 seconds. Evidence: `evidence/focused-dom-sw-startup.log` and `.exit`.
- **36/36 pass**: portable `review-contract.mjs` exercises matching parity with the verified predecessor, 399.999/400.001 m boundaries, selection and request bounds, signal forwarding, input immutability, non-array rejection, network/HTTP/JSON error preservation, and partial/all-failed boards in both source orders. Evidence: `evidence/contract-frozen.json`.
- **Negative control behaves as required**: running the same challenge against exact predecessor parser bytes fails with “Missing expected rejection.” Evidence: `evidence/contract-baseline-negative.log` and `.exit`.
- Syntax checks pass for app, departures parser and browser checker. `git diff --check` passes.
- Independently inspected successful-empty and filtered-empty DOM tests, translated English/Japanese redraws, coordinate planner fallback, one-request caching, expiry/recovery, malformed lookup eviction and bounded reopening, and partial-result non-regression coverage.

The implementation's aggregate was also inspected: the first run passed 1353/1354 and exposed one stale startup assertion expecting the old wording. That assertion alone was corrected; the final run passed **1354/1354**, zero failures, skips or cancellations, in 95.91 seconds. The implementation build passed. These aggregate/build commands were run by the implementer, not duplicated by this reviewer.

## Reproduce

From the candidate repository root:

```sh
node /path/to/review-contract.mjs "$PWD"
node --experimental-vm-modules --test \
  tests/departure-availability.test.mjs tests/departures.test.mjs \
  tests/departure-identity.test.mjs tests/departure-platform.test.mjs \
  tests/departure-labels.test.mjs tests/sw-install.test.mjs \
  tests/startup.test.mjs
```

The portable challenge uses only Node built-ins and the checked-in exact-predecessor fixture. It verifies the predecessor Git blob before comparing behavior. Local review did not publish, merge, contact providers or change unrelated project stops.
