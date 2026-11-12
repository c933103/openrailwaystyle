# Independent review: wrapped station proximity

Date: 2026-10-12

Baseline: `c933103/openrailwaystyle` main at `50b8063813909067343fd3b1eb778104aa32f324` (using the baseline source checkout already verified by the implementation task).

## Verdict

No must-fix defect found in the bounded candidate. The implementation correctly uses the short longitude delta for departure stop distance and both station-search proximity predicates. It preserves the existing independent distance, latitude, naming, identity, request, and cache rules. This is source-and-fixture validation, not verification of real provider coverage or deployed behavior.

## Code and behavior reviewed

- `styles/departures.mjs`: wrapping is limited to the longitude delta in `metres`. The mean-latitude cosine, Earth-radius constant, Euclidean local-distance approximation, and inclusive 400 m limit remain unchanged. Coordinates are not modified. The returned candidates retain their original object identity.
- `styles/map-model.mjs`: both `near` predicates wrap the longitude delta. Both preserve the original strict 0.004-degree latitude and cosine-scaled longitude limits; this remains a rectangle, not the departure calculation's circle. Existing tile-result ranking already wraps longitude and is unchanged.
- Matching and identity: full-name/numeric/bilingual logic is unchanged. Exact OSM type-and-ID matches remain independent of name/distance; a node and way sharing a number are still distinct unless the existing name/proximity rule independently matches them. Named departure matches continue to outrank/filter competing unmatched candidates. The existing nearest-stop fallback when no name matches has not been removed.
- Provider requests and UI: unchanged request construction preserves original station coordinates, encoded stop IDs, signal forwarding, one reverse lookup, and at most two board requests. Partial-result handling, 60-second cache semantics, translated redraw reuse, and detached-result protection are unchanged and passed the applicable tests.
- Cache-first deployment: all 28 literal current-page version references plus the application fallback consistently use `20261012-station-antimeridian-1` across the seven version-bearing source files. No previous `20261012-departure-stop-names-1` token remains in non-vendor runtime sources. Startup version-alignment and actual-source simulated service-worker checks passed.
- The added user-guide paragraph accurately limits the claim to nearby matching and explicitly avoids implying expanded provider coverage.

## Independent evidence

1. Node v24.19.0 focused suite: **314 passed, 0 failed**, with no skipped/cancelled tests. Command:
   ```sh
   node --experimental-vm-modules --test tests/station-antimeridian.test.mjs tests/departure*.test.mjs tests/context.test.mjs tests/startup.test.mjs tests/sw-install.test.mjs
   ```
   This includes both seam directions, exact +180/-180 equivalence, ordinary-longitude controls, complete and partial DOM boards, numeric-name negatives, bilingual positives, type-scoped OSM identity, cap/order checks, and startup/cache regression coverage.
2. Standalone new regression test against unchanged baseline implementations: **9 failures and 3 passes**, as expected. The passing baseline cases are ordinary-longitude controls and unchanged OSM identity behavior. The candidate's same 12 tests pass within the focused suite.
3. Seeded independent invariant check (`0xc933103`): **60,000 assertions passed**. For 10,000 generated valid-latitude nearby coordinate pairs, all three candidate paths agree with the unchanged baseline behavior translated to an ordinary-longitude origin. Each case is also tested with a randomly selected ±3-world-copy longitude offset. Test longitude normalization uses `atan2(sin, cos)`, independently of the candidate modulo expression.
4. **100 independent boundary assertions passed** across latitudes −85°, −60°, 0°, +60°, +85° and both seam directions: 399.999/400.001 m departure cases, plus 0.003999/0.004001-degree scaled-longitude and latitude search cases. No radius expansion was observed.
5. **15 invalid-coordinate/mode-filter assertions passed**; frozen inputs are preserved; an independently injected partial board failure retains the selected two-stop result and exactly three total requests.
6. Syntax checks passed for `styles/app.mjs`, `styles/map-model.mjs`, and `styles/departures.mjs`.

The independent invariant harness overrides the global fetch function to fail on accidental use; all station responses are explicitly injected fixtures. No real external provider requests were made.

## Reviewed source fingerprints (SHA-256)

- `styles/departures.mjs`: `0bfe068a31c79f4670c4f9fb7c24206c7aa51ab5d8bfb28e08ece4c0199b863a`
- `styles/map-model.mjs`: `5137a2566ffa0e0e209d70df0c48c5e7a5252dd2ad684e50acd71f0b79bcab2e`
- `tests/station-antimeridian.test.mjs`: `c49a98caf8317a954632c8020bf3cf6b7ba4bdc33f014c945ac4578ea57f815b`
- `tests/departure-availability.test.mjs`: `9625fda0b413aa124d6e7667d33b0d42895fd037e4d5cb293d94ec335af5518c`

## Limits

This review did not independently rerun the full aggregate suite, rebuild, exercise a native browser, or inspect a deployed commit. Those gates belong to the implementation/delivery task. It does not certify global input-schema hardening, new geographic coverage, spherical-distance accuracy at extreme latitudes, or unrelated station-search behavior. No production code was changed or published during this review.
