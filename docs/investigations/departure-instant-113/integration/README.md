# Integration with merged departure-envelope handling

PR #194's original reviewed head `291de12a25150531cf797c2e1b7b02d29dc2cd78`
was integrated with main `370bcfb1db684d80520ea43430e1cbb5bdb360dd`, the merge
of PR #193. All 524 upstream blobs matched GitHub's tree before construction
([verification](baseline-verification.json)). The earlier investigation, rejected
approach, original fixtures, logs and review are preserved unchanged one directory
above this record.

## Composition

- Apply the reviewed exact-instant final-veto diff unchanged to the merged parser.
  PR #193's per-board envelope validation remains intact.
- Keep upstream browser acceptance and its stable fixture-clock correction
  unchanged, including partial malformed-board and all-malformed recovery cases.
- Combine the independent user-guide paragraphs rather than dropping either.
- Seven shared token files were compared after removing only their differing
  release identifiers; all remaining bytes agreed before composition.
- Use one fresh token, `20261012-departure-instant-2`.
- Preserve both older cache fixtures/regressions and add exact immediate-#193
  app/parser bytes in `departure-instant-envelope-predecessor.json.gz`, with
  two upgrade tests. The [old-token control](baseline-cache.log) fails 2/2;
  successor cases pass in the focused and full suites.

No reconciliation rule beyond the already reviewed final veto is changed.
No live provider query, URL/domain change or unrelated project work is included.
The original time-precision, shared-ID, missing-schedule and broader identity
limitations remain applicable. #113 and #129 remain open.

## Final local verification

Node v24.19.0:

- [Focused parser, schedule DOM and cache suite](focused.log): 186/186 passed.
- [Full aggregate](full-suite.log): 1,416/1,416 passed, none skipped or cancelled.
- [Build](build.log), syntax, generated-style reproducibility and whitespace:
  all exit 0; generated world style unchanged.
- [Seeded invariant replay](monotonicity.json): 12,000 multi-board cases with
  zero newly formed groups (8,267 baseline versus 2,664 successor groups).
- [Independent integration review](integration-review.md): no blocker; 366
  envelope probes, 35 browser-clock checkpoints, 56 detailed clock checks and
  two age controls passed. The [14 composition cases](composition-probe.json)
  and [12,000 immediate-upstream lineage cases](monotonicity-integration.json)
  also passed. [The HTML byte-diff check](index-token-only-proof.json) confirms
  that only two asset query strings changed and existing legal text is unchanged.
- [Frozen source hashes](frozen-source-manifest.json) and [upstream-relative
  diff](source.diff) bind the integration evidence.

The [original-head Codex review](https://github.com/c933103/openrailwaystyle/pull/194#issuecomment-6116596894)
found no major issues on `291de12a25`. It is not approval of this integrated
successor. A fresh exact-head review and hosted CI/browser acceptance are required
after publication. The local Unix-socket browser restriction is unchanged and
was not bypassed; unit/DOM/cache results are not native-browser acceptance.
