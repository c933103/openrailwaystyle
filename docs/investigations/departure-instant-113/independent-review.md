# Independent review: exact-instant departure merge veto

## Verdict and source binding

No remaining blocker found in the bounded successor. The rejected first approach
had a newly introduced wrong-merge defect; the successor fixes that defect by
preserving the original ambiguity graph and rejecting whole groups at the final
merge step. This is not approval of complete cross-feed identity or closure of
[#113](https://github.com/c933103/openrailwaystyle/issues/113).

Reviewed remote baseline: `f9bd326c6a2a3738daafd36a58a16f9a2251c5a8`.
The local Git commit `2c6b0af3f9dbc37ea897c623db9b53fa3b761d1d` is a reconstructed
snapshot, not the upstream commit. The relevant baseline Git blob IDs for
`departures.mjs`, `departures-ui.mjs`, `app.mjs`, and the original highlight test
match the saved upstream tree.

Examined successor `styles/departures.mjs` SHA-256:
`52338c2e1a57c1c45c31f13e1e16c747b7b8b84af336de077d38eaeaee8940f2`.
[File manifest](reviewed-files.json) binds the reviewed parser, presentation,
asset-token changes, tests, cache fixture, and user-guide bytes. Production files
were not modified by this reviewer. All execution was local and fixture-only.

## Historical contract and the changed highlight fixture

[PR #131](https://github.com/c933103/openrailwaystyle/pull/131) deliberately used
scheduled-minute matching to reconcile overlapping feeds. The old behavior was
therefore intentional, not an accidental violation of an exact-time contract.
This successor intentionally narrows that policy to preserve distinctions
between departures with unequal scheduled instants.

[Commit 594f6f5](https://github.com/c933103/openrailwaystyle/commit/594f6f555d59e9681b29b222b7dbe627a2dade87)
introduced the original highlight fixture with a named observation at 00:00:00,
a linked observation at 00:00:30, and repeated visits to the linked stop. Its
purpose was to prove that the displayed row retained the linked trip's own
scheduled event for highlighting. The differing times were material to that
regression. Changing the positive fixture to equal instants alone would remove
that distinction and would not be an adequate explanation of the behavior change.

The final test set addresses this correctly:

- The original fixture remains available as historical evidence.
- The equal-instant merge test still checks adoption of the linked stop and the
  correct repeated-stop highlight.
- A separate negative test retains the original unequal-time observations,
  keeps both rows, prevents transfer of the trip link, and checks the linked
  row's repeated-stop highlight in both list orders.
- A direct `renderSchedule` regression uses a presentation time different from
  `tripScheduled`, preserving the original downstream precedence requirement.

An independent mutation probe confirmed that removing `tripScheduled`
precedence highlights “Earlier loop” instead of “Selected”; the restored direct
regression is discriminating. The original fixture contained a trip ID on only
one row and different stop IDs, so it did not independently establish that both
observations were the same boarding occurrence.

## Resolved blocker in the first approach

The rejected parser changed pair eligibility to exact time before calculating
mutual uniqueness. This was not purely conservative: removing a competitor could
make an otherwise ambiguous pair uniquely match.

Counterexample, with compatible mode, line and destination:

- Board A: trip a at :00; trip b at :30.
- Board B: trip b at :00, cancelled.
- Baseline: three separate rows; trip a is not cancelled.
- Rejected approach: two rows; cancellation from trip b incorrectly transfers to a.

The result reproduced under both board orders and both orders within board A.
It does not require proving that the two b rows are the same event. They could
represent a precision conflict or two genuine nearby/repeated stop events; in
either case b's cancellation does not establish that a is cancelled. A separate
three-board regression also exercises graph splitting that can unlock a newly
mergeable component.

The successor leaves the original compatibility graph, mutual uniqueness, and
same-list group veto in place. It adds a final requirement that every member of
a group has the same finite scheduled instant. Thus each baseline output group
is either preserved or replaced by its member rows. A previously rejected group
cannot be split and selectively re-merged. Code inspection supports this
monotonic guarantee, and the independent lineage probe checks it empirically.

## Independent verification

Node v24.19.0. Tests performed by this reviewer:

- Relevant departure, identity, labels, platform, availability, schedule DOM,
  and simulated cache suites: **158 passed, 0 failed**.
- The same final 30 instant cases on baseline: **10 passed, 20 failed**.
- Final 30 cases on frozen successor: **30 passed, 0 failed**.
- Independent cancellation counterexample: baseline and successor both pass;
  rejected approach fails.
- Additional probes cover within-minute boundaries, midnight-equivalent offset
  spellings, shared actual times with differing schedules, missing versus invalid
  schedules, retained conflicting shared IDs, no input mutation, and the existing
  simultaneous-distinct-ID limitation.
- [Seeded lineage check](monotonicity-check.mjs): **12,000 synthetic boards** with
  two to four lists. Baseline formed 8,267 multi-observation groups; successor
  formed 2,664. No successor group was absent from baseline's final outputs, and
  contributor lineage was neither lost nor invented. [Result](monotonicity-successor.json).
  The same check rejects the first approach. This finite probe supplements the
  structural argument; it is not exhaustive provider validation.
- The compressed predecessor app/parser texts exactly match their verified
  baseline Git blobs, not merely the hashes included inside the fixture.
- `git diff --check`: passed. Reviewed source hashes remained unchanged through
  the final checks.

Reproduce the independent invariant from the repository root:

```sh
node docs/investigations/departure-instant-113/monotonicity-check.mjs
```

This review did not independently rerun the full aggregate/build or launch a
native browser. Parent-recorded full-suite/build/hosted checks remain separate
acceptance evidence; focused results do not imply those checks passed.

## Remaining limitations and accepted tradeoffs

1. **Precision disagreement can create duplicates.** Equivalent spellings of one
   instant merge; genuinely different parsed values do not. A feed that rounds
   the same train differently may produce duplicate-looking rows. No live feed
   precision mismatch was measured in this review.
2. **Shared IDs do not override differing events.** Identical trip/route/stop IDs
   with a 30-second schedule disagreement remain separate. The IDs are retained,
   not erased, but the matcher does not use them as an identity override. Repeated
   stops and schedule conflicts make an unconditional raw-ID override unsafe.
   A source-aware boarding-occurrence proof could permit reconciliation later.
3. **Broader ambiguity remains conservative.** An unequal-time member can prevent
   merging an otherwise plausible equal-time subset. This is intentional: the
   final veto must not create new matches by removing ambiguity evidence.
4. **Exact time is not sufficient identity proof.** Distinct simultaneous trips
   in different lists still merge when the pre-existing mode/line/destination
   heuristic uniquely matches them. Destination substring matching, incomplete
   source/stop lineage, and the absence of a fuller identity model remain #113
   concerns. The successor does not worsen this through newly formed groups.
5. **Missing schedules retain actual-time fallback.** The finite value tested can
   be derived from actual arrival/departure when the schedule is absent. Invalid
   explicit schedules remain separate. Parsed equality has JavaScript Date's
   millisecond resolution; this is not arbitrary-precision timestamp matching.

The report's historical-contract explanation, rejected-attempt evidence, original
fixture preservation, and explicit broader limits are appropriate. Publish the
successor as a bounded safety correction, not as complete one-real-train identity.
