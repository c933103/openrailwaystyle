# Independent integration review after PR #193

## Verdict and examined bytes

No integration blocker found. The previously reviewed final-group veto is
preserved, and the merged board-envelope validation and browser-clock correction
remain intact. This review is hash-bound local integration evidence; the prior
Codex review of another head does not substitute for new exact-head review or
hosted checks on the eventual successor commit.

Upstream baseline: merged [PR #193](https://github.com/c933103/openrailwaystyle/pull/193),
commit `370bcfb1db684d80520ea43430e1cbb5bdb360dd`.
Local reconstructed snapshot: `33825af54f6209aa0e856891d6eb38277f0e138f`.
All **524** local baseline blob identities were independently compared with the
saved upstream tree and matched.

Integrated `styles/departures.mjs` SHA-256:
`15ae7b38773512932d40a407c6c3168c224f618c11a1c406d872b2afb6e561e0`.
[Manifest](integration-review-manifest.json) binds 17 reviewed source, test,
fixture, and documentation files. Their hashes were rechecked after execution
and remained unchanged. No production files were modified by this reviewer.

## Integration preservation checks

- The module section before `stationDepartures`, including `departureRows`, is
  byte-identical to the previously accepted final-veto implementation.
- `stationDepartures` and the remainder of the integrated parser are
  byte-identical to merged PR #193. The envelope validation remains inside each
  individual stop promise before `Promise.allSettled` results are consumed.
  Non-null, non-array objects with array-valued `stopTimes` succeed; malformed
  envelopes preserve healthy siblings or follow the existing all-failed path.
- `scripts/check-departures-browser.mjs`, `tests/departure-availability.test.mjs`,
  and the original envelope predecessor fixture are byte-identical to upstream.
  The far-future shared row, 34 clock advances, seven malformed shapes, both
  source orders, partial cache checks, and all-malformed recovery remain intact.
- Seven other production files differ from upstream only by replacing
  `20261011-departure-envelope-1` with `20261012-departure-instant-2`.
  They also equal the prior exact-instant branch after normalizing its token.
  A source scan found 29 departure-token occurrences, all using the new token.
- The original 30 exact-instant tests, amended highlight tests, historical
  predecessor fixture, and all 33 existing investigation-evidence files are
  unchanged from the earlier reviewed branch.
- The user guide retains upstream malformed-envelope behavior alongside the
  exact-instant requirement, fallback, precision tradeoff, and unchanged
  same-minute ambiguity veto.
- The cache test diff adds four tests without removing upstream cases: two
  historical exact-instant cases and two immediate-PR193 upgrade cases.

The new compressed predecessor fixture identifies the actual merged upstream
commit and envelope token. Both embedded app/parser texts exactly equal their
baseline Git blobs, and their SHA-256 fields match independently computed hashes.
It therefore tests the actual immediate release transition, rather than just a
synthetic version-label change. Both older fixture histories remain available.

## Executed verification

All checks below are fixture-only, using Node v24.19.0:

- Relevant departure, identity, label, platform, availability, highlight DOM and
  simulated service-worker suites: **186 passed, 0 failed**, none skipped.
- Reused PR193 independent envelope probe: **366 passed, 0 failed** across 26
  malformed body shapes, source/completion orders, healthy empty/populated
  siblings, cache expiry, all-failed eviction, and error-message privacy.
- Actual browser-fixture row replay: **35/35** clock checkpoints passed.
- Detailed clock probe: **56** malformed-case before/after checkpoints, **35**
  horizon checkpoints, and **2** age-boundary controls passed. The browser script
  hash remains `58809e88eb0e62f8501e3f7a9fa314e56417c343f7fe9bd9c523000c3c03bcec`.
  No browser was launched; this checks the real fixture expressions through the
  production parser, not native rendering or network interception.
- [Integration composition probe](composition-probe.mjs): **14/14** passed.
  Malformed siblings preserve two same-minute distinct trains, their cancellation
  isolation, partial statuses, request signals, and the three-request bound;
  healthy two-board unequal-instant cases remain separate in either list order.
- [Immediate-upstream monotonicity probe](monotonicity-integration.mjs): **12,000**
  seeded boards with two to four lists passed. Baseline produced 8,267 merged
  groups; integrated successor produced 2,664. No new merge group was formed and
  observation lineage was neither lost nor invented. [Result](monotonicity-integration.json).
  The unchanged original-baseline probe independently returned the same counts.
- Parser, app, and browser-script syntax checks and `git diff --check` passed.

The immediate-baseline monotonicity probe uses the newly committed PR193
predecessor fixture. Its baseline parser SHA-256 is
`30f6c147858bdfbe3b4f2b0579ca7f7c8a7b9aa6d60be7a21cf43b14e4d3c231`.

Parent-generated aggregate evidence was also inspected: **1,416 passed, 0 failed**,
none skipped or cancelled; build exit status was 0. Those were not separately
rerun by this reviewer and remain distinct from the independently executed checks
above.

## Remaining acceptance and limitations

New exact-head Codex review and hosted browser/CI acceptance must target the
published successor. This local review does not establish those outcomes and does
not authorize merging or deployment.

The earlier bounded-review limitations still apply. Exact time is a final veto,
not proof that matching labels describe one real train. Precision disagreements,
conflicting shared IDs, and mixed-time candidate groups may remain separate.
Existing cross-feed/source-lineage limitations and broader #113/#129 work remain
open. The integration introduces no observed expansion of those limitations.
