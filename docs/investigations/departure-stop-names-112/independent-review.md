# Independent review: departure stop-name compatibility

Repository: `c933103/openrailwaystyle`

Base: `b5a73c3aa03498259c2fd531b9644d52ae94db69`

Scope: proposed changes against the pinned base, including the new `tests/departure-stop-names.test.mjs`, browser/DOM regressions, asset version changes and service-worker upgrade test.

Reference: https://github.com/c933103/openrailwaystyle/issues/112#issuecomment-6119264172

## Outcome

**Pass on the final reviewed bytes; no remaining blocker found within the bounded scope.** The implementation owner addressed the initial three findings and two final compatibility edge cases. Independent final focused tests pass **148/148**; all five review reproducers and **1,050 additional numeric-boundary comparisons** pass. The review uses synthetic local fixtures and pinned-baseline comparisons, not current live-feed claims.

Final reviewed SHA-256:

- `styles/departures.mjs`: `d54f80bed0944db459155ffb078b93c37d9d3ba702d50f676f220b7dd229cd5f`
- `tests/departure-stop-names.test.mjs`: `25b90b14501d049c90197d635765becbf4ef74919e6ed3670cbd4ddb89ea91a0`

The separate final full-suite and browser results are recorded in the accompanying README; the independent checks below are a focused review, not an independent full-suite/browser rerun.

The independent review made no implementation changes or live provider requests.

## Initial R1 — resolved — P2: A shared operator prefix becomes a station alias

Initial-patch location: `styles/departures.mjs:27-30,37-39,46-50`.

The bilingual parser treats any Latin/non-Latin combination as two alternate full station names. Splitting both selected station names and candidate names, then intersecting all generated strings, allows a common operator label to establish identity even when the native station names disagree.

Reproducer:

- Selected station: `{lat:0, lon:0, names:['JR 東京']}`.
- Candidates: `JR 東京/right-a` at latitude `.001`, `JR 東京/right-b` at `.0011`, and `JR 神田/wrong` at `.0001`; all are STOP/REGIONAL_RAIL at longitude 0.
- Baseline: `['right-a','right-b']`.
- Patch: `['wrong','right-a']`, in all six candidate orders.

Both composite names generate `jr`. The wrong nearer stop consumes the first board slot, removes the second correct board, and supplies both journey-planner IDs. A mocked `stationDepartures` integration also produces request IDs `wrong,right-a` within the unchanged three-request bound. This is a newly introduced false-positive match, rather than the retained unmatched-nearest fallback.

Recommendation: distinguish a compatible complete bilingual name from matching arbitrary derived fragments on both sides. Do not treat operator-only text as a verified station alias merely because it uses a different script. Add this negative regression beside positive `東京 Tōkyō/東京` and distinct-operator tests.

## Initial R2 — resolved — P2: Alphabetic labelled platforms are lost

Initial-patch location: `styles/departures.mjs:35`.

The platform-removal expression accepts only a decimal number with an optional Latin suffix. A clearly labelled alphabetic platform remains in the normalized station identity and is discarded once another exact-name candidate exists.

Reproducer:

- Selected station: `Central` at `(0,0)`.
- Candidates: `Central/main` at `.001`, `Central (Platform A)/platform-a` at `.0011`, and `Unrelated/other` at `.0001`.
- Baseline: `['main','platform-a']`.
- Patch: `['main']`, in all six candidate orders.

The same restriction affects `Track A` and other recognized labels with alphabetic platform identifiers. This is directly relevant to preserving legitimate multiple stops/platform decorations. Extend only explicitly labelled metadata; do not restore arbitrary suffix/prefix containment. Include an alphabetic-platform positive and a genuinely different suffixed station negative.

## Initial R3 — resolved — P2: Station-word normalization fails when combined with a parenthesized bilingual alias

Initial-patch location: `styles/departures.mjs:30,37-39`.

Bilingual parsing runs on raw normalized text before station words are removed. The pattern allows a final closing parenthesis, but cannot parse `東京 (Tōkyō) Station`. The later `simplify` call removes `Station` and punctuation only from the unsplit full name, leaving a combined string rather than the native alias.

Reproducer:

- Selected station: `東京` at `(0,0)`.
- Candidates: `東京/native` at `.001`, `東京 (Tōkyō) Station/bilingual` at `.0011`, and `Unrelated/other` at `.0001`.
- Baseline: `['native','bilingual']`.
- Patch: `['native']`, in all six candidate orders.

This composes two compatibility classes the patch already claims to support: explicit parenthesized bilingual names and station-word normalization. Normalize recognized metadata in a way that preserves alias boundaries before parsing, and add a composed regression.

## Verified positives and unchanged boundaries

Independent command:

`node --experimental-vm-modules --test tests/departure-stop-names.test.mjs tests/departures.test.mjs tests/departure-availability.test.mjs tests/sw-install.test.mjs`

Final result: **148 passed, 0 failed, 0 skipped**. Log: [independent-focused.log](independent-focused.log). Earlier initial/revised runs passed 140 and 146 tests respectively.

- Original Terminal 1/Terminal 10, Central/Central Park and 中央/中央公園 permutations pass.
- Added numeric, native-script prefix/suffix, fullwidth, supplied alias, bilingual, station-word and numeric-platform positives pass as written.
- Rail-only and finite-location eligibility, 400 m distance, default two-stop cap and unmatched-nearest fallback remain unchanged in source and pass focused regressions.
- Candidate matching is evaluated before distance ordering and cap. Inputs are not mutated.
- `stationDepartures` retains one reverse-geocode request plus at most two board requests, fixed `n=30`, mode filters, encoded IDs and AbortSignal propagation. No request broadening was introduced.
- Existing malformed/partial-board states, cache reuse/expiry, failure eviction, trip identity and row-merging tests in the focused set pass.
- DOM tests cover both from/to planner IDs for the original collision families and cache reopening without extra requests.
- The browser script uses synthetic Transitous routes and the existing loopback-only network guard; no live-provider path was added. Browser execution was not independently repeated by this reviewer.
- All changed `app.mjs` lines are asset-version token changes. The cache key, 60-second expiry, board rendering and planner construction remain untouched.
- Versioned page/CSS/module imports consistently use `20261012-departure-stop-names-1`; no previous token remains in the searched source modules. Existing service-worker logic reads the page version and retains old/new version-specific assets. The added immediate-predecessor case and all service-worker tests pass.
- `git diff --check` and `node --check` for `styles/departures.mjs`, `styles/app.mjs` and `scripts/check-departures-browser.mjs` pass.
- An earlier full-suite log reported **1468 passed, 0 failed**; the accompanying README records the final rerun after the added review regressions.
- Source changes do not alter the delivered row/search/availability behavior from PR193/194/195 or make domain/deployment changes.

## Reproduction artifact

[independent-review.mjs](independent-review.mjs) compares all five review findings against the pinned baseline, checks all six candidate permutations, asserts each final fix, runs a mocked request/planner integration for R1, and performs 1,050 numeric-boundary comparisons across Latin, Han, Cyrillic and Greek prefixes. Execute with:

`node docs/investigations/departure-stop-names-112/independent-review.mjs`

The latest observed output is saved in [independent-adversarial.log](independent-adversarial.log); it confirms all five findings are repaired. The script uses local files and synthetic fetch responses only.

The passing conclusion applies to the final SHA-256 identities above; rerun these checks if the matcher changes again. The initial findings are retained below as the review history and reproducible rationale for the corrections.


## Final revision check

The owner preserved native-component provenance, accepted alphabetic/alphanumeric labelled platforms and moved station-word normalization before bilingual parsing. The initial three reproducers now return the expected baseline associations. The final focused result is **148 passed, 0 failed, 0 skipped** in [independent-focused.log](independent-focused.log).

Additional observations were reported to the owner and repaired before final verification:

1. `東京 1 Tōkyō` versus `東京 1Tōkyō` normalize to the same complete name. An intermediate provenance guard rejected the second form because greedy script splitting yielded native portions `東京1` and `東京`. The final matcher accepts complete normalized equality before applying conflicting-native rejection, and the regression passes.
2. `Central (Platform 1/2)` was excluded when `Central` had an exact candidate. The final matcher preserves labelled combined/range identifiers; both `Platform 1/2` and `Track 2-3` pass baseline-positive regressions.

These observations do not call for relaxing original numeric/same-script boundaries or restoring substring matching.


## Deliberate scope

Explicit `station.names` aliases remain authoritative. Complete native/Latin components are inferred conservatively. Arbitrary same-script provider/operator/location qualifiers remain meaningful unless they are recognized station words or explicitly labelled platform/track metadata. No expansion to arbitrary suffix removal or substring matching was requested by this review. Native-script variants that were not baseline-compatible and were not explicitly supplied as independent aliases are not claimed to be newly supported.
