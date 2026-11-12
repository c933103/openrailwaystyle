# Independent review: PR196 same-script composite-alias correction

## Result

**Pass on the reviewed bytes. No remaining blocker found within the authorized bounded scope.**

The correction resolves the published P2 reproducer while requiring independent, complete map-supplied evidence for both components of a newly accepted same-script composite. It does not restore arbitrary substring matching.

- Review comment: https://github.com/c933103/openrailwaystyle/pull/196#discussion_r4245569333
- Exact published predecessor: `d252a702de3cdd322e2f5c0a9bb4e5db3a37d079`
- Original pre-PR base: `b5a73c3aa03498259c2fd531b9644d52ae94db69`
- Reviewed `styles/departures.mjs` SHA-256: `d02f92b770b8a1dab63f0e186634891a2b444f1b573432bde04c63151d890d8e`
- Reviewed `tests/departure-stop-names.test.mjs` SHA-256: `f82ed0b5538026e557b93e25261915c5b0c328f174d376d1b3686e4d16e854c3`
- Reviewed `tests/departure-availability.test.mjs` SHA-256: `e1b39c20f70edee4f90f7f34cde3cfe8e0f454db9641b72dda6ad7fcc1c7c701`
- Reviewed `scripts/check-departures-browser.mjs` SHA-256: `396447781bddeb3f2ad81f2d5332301907761c918b2ac4a42720db7975372808`

The independent review made no implementation changes or live provider requests. Tests used local files and synthetic fetch responses. GitHub reads were limited to the review comment and exact predecessor source.

## Exact predecessor reproduction

With station names `['München Hbf', 'Munich']`, three nearby rail candidates were supplied:

1. `München Hbf`, ID `a`, latitude `.001`.
2. Either `München Hbf / Munich` or `München (Munich)`, ID `b`, latitude `.0011`.
3. `Munich Park`, ID `wrong`, latitude `.0001`.

Station position was `(0,0)` and candidate longitude was 0.

For both composite forms, the exact published predecessor returned `['a']`; the reviewed correction returns `['a','b']`. Removing the independently supplied `Munich` alias keeps the result at `['a']` in both predecessor and correction. The nearer `Munich Park` record never becomes a compatible match.

This confirms that the new behavior repairs the reported lost second operator, rather than relying on the unmatched-nearest fallback.

## Algorithm review

The incremental production diff is confined to `stopName` and `pickStops`:

- After the existing Unicode, station-word and labelled-platform normalization, `stopName` records two explicit slash-separated or parenthesized components.
- These components do not become unconditional alternate names.
- `pickStops` constructs `suppliedAliases` only from each supplied station name's complete normalized form (`name.names[0]`). It does not collect inferred bilingual/operator fragments or recursively inferred composite aliases.
- A candidate gains compatibility through the new branch only when it has two nonempty normalized components and every component is present in that independently supplied set.
- Existing complete-name and bilingual compatibility remains unchanged, including the native-component conflict guard and complete normalized equality exception.
- Neither arbitrary suffix removal nor substring containment was added.

The two-part limit is deliberate. This review does not claim support for arbitrary nested or multi-part composites, or that native/Latin inference has become a general-purpose language translation system.

## Independent verification

### Focused repository tests

Command:

`node --experimental-vm-modules --test tests/departure-stop-names.test.mjs tests/departures.test.mjs tests/departure-availability.test.mjs tests/sw-install.test.mjs`

Result: **155 passed, 0 failed, 0 skipped**.

Log: [independent-focused.log](independent-focused.log).

This includes the supplied/absent same-script alias tests, injected-fetch board identities, DOM rows and both journey links, cache reuse, original substring collisions, prior compatibility controls, malformed/partial-board behavior and service-worker upgrades.

### Independent adversarial/permutation checks

Script: [independent-adversarial.mjs](independent-adversarial.mjs).

Log: [independent-adversarial.log](independent-adversarial.log).

Results: **504 positive and 558 negative checks, 1,062 total**, plus two bounded request/planner integration scenarios.

Coverage:

- Latin, Cyrillic and native-script alias pairs, with numeric names retained.
- Slash and parenthesized forms in both alias orders.
- Fullwidth slash/parentheses through NFKC normalization.
- Composite names with an explicitly labelled `Track B1` suffix.
- Either required alias missing, in all candidate orders.
- Same-script prefixes/suffixes, Central/North, Terminal 1/Terminal 10 and 中央/中央公園 remain distinct without complete independent alias evidence.
- Operator-only inferred fragments cannot supply independent evidence (`JR 東京` does not authorize `JR / Other`).
- Composite-derived fragments cannot supply transitive evidence (`Alpha / Beta` does not authorize `Alpha / Gamma`).
- Three-part and suffixed composites are not accepted by the bounded new branch.
- When the valid composite is nearer than the exact-name candidate, it legitimately supplies both journey IDs; absent-alias controls select only the exact candidate.
- Request counts remain one lookup plus one or two boards, as appropriate.

### Previous independent regressions

The prior independent review script was rerun unchanged against the new source. All five previously repaired findings and **1,050 numeric-boundary comparisons** still pass.

Log: [prior-regressions.log](prior-regressions.log).

### Static and scope checks

- `git diff --check` passes.
- `node --check styles/departures.mjs` passes.
- `node --check scripts/check-departures-browser.mjs` passes.
- 400 m radius, rail modes, finite coordinates, distance ordering, two-board cap and unmatched-nearest fallback are unchanged.
- Board request construction, trip identity, row merging, cache keys/expiry, rendering and planner implementation are unchanged by the follow-on production diff.
- Asset-version/cache-delivery changes from the original PR remain intact; the follow-on changes do not alter their implementation.
- Browser additions remain synthetic fixture routes behind the existing network guard and cover both alias-presence states in all 24 candidate orders. This reviewer inspected the browser additions but did not duplicate the browser run.

## Other verification and limits

The implementation owner separately reported final results of **1,483/1,483 full tests**, **194/194 departure-focused tests**, and a passing Chromium run including the 24 new same-script scenarios. Local WebKit execution remains blocked by the previously reported missing host libraries. Those full-suite/browser runs are not claimed as independently executed by this reviewer.

This review establishes the bounded source and fixture behavior above. It does not establish current live timetable coverage or deployment status. Recheck if the reviewed source hashes change.
