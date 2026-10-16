# Independent review of cancellation-evidence correction

Acceptance: no additional code blocker found in parser Git blob `6522f7ae921ca7ad8443ccf4a774956c84a7b1a6`, SHA-256 `ff37bfffa62d4938aabd7dfd041d39475b8ec3b56b13d343dfa010a8c6689922`. The tested new regression file is Git blob `ba894811f28d1867c1abbd38dbc2ec1e6265ab22`; both match the frozen revision-2 report.

This supersedes the earlier implementation acceptance for the cancellation-evidence graph. Codex identified a real missing case: adding an expired competitor could remove a pre-veto candidate edge and unlock cancellation transfer into a previously rejected subgroup. The earlier tuple/parity checks did not establish cancellation eligibility under that transformation.

## Reviewed correction

Only the expanded cancellation-evidence path requests `allCandidates:true`. It preserves every compatible minute-level edge, then applies the existing whole-component duplicate-list, exact-instant and destination vetoes plus the known-line and upcoming-group intersection guards. Upcoming row grouping is unchanged. Adding an ordinary witness can enlarge an evidence component but cannot erase its edges. A component surviving duplicate-list rejection has at most one row per list, so its accepted edges also satisfy the previous uniqueness condition. Rejected components are not regrouped into safe-looking cancellation subgroups.

The expanded pass now uses pairwise compatibility, O(N^2), rather than running uniqueness scans for each edge. Ordinary upcoming grouping retains its existing worst-case O(N^3). Acquisition and provider request counts are unchanged.

## Independent checks

- `node --test tests/departure-expired-cancellation.test.mjs tests/departure-identity.test.mjs tests/departure-instant.test.mjs tests/departure-platform.test.mjs tests/departure-destinations.test.mjs tests/departure-labels.test.mjs`: 145/145 passed, zero skips.
- A local `node --input-type=module` synthetic driver ran 288 targeted row/list permutations: all three cancellation flags, upcoming versus expired conflict witnesses, and exact-seconds, lexical destination, numeric destination and known-line conflicts. Every revised result matched the baseline upcoming output without borrowed cancellation.
- All 24 targeted case combinations rejected an in-memory negative mutation restoring the prior uniqueness-filtered expanded graph.
- The same driver used deterministic seed 717113 for 12,000 generated cases, with 24,000 sampled permutations and 12,000 expired ordinary-witness insertions. Every non-cancellation output field matched the pre-feature baseline, and provider inputs were unchanged. Ordinary-witness insertion unlocked cancellation in 9 prior-graph cases and zero revised-graph cases. In 70 cases the revision conservatively removed cancellation after additional ambiguity evidence.
- No project source was changed by this review and no provider/network calls were made.

## Limits

These are synthetic parser/DOM checks and code inspection, not exhaustive proof of real-world cross-feed identity. No full aggregate, build, hosted browser, deployment, or new cache simulation was rerun for this correction by the reviewer. The earlier browser limitation remains: local launch stopped because the Playwright executable was missing. Final frozen-source aggregate checks, exact-head Codex review and required browser/CI gates remain binding. Baseline file blobs were available, but the checkout was materialized and did not contain the claimed upstream commit/tree objects.

## Evidence files
- `independent-revision-ambiguity.log`: SHA-256 `b21d2dc720434da748f22c4b3e94a109bc821cb87f2f8126c6906840de5e45c6`, 427 bytes.
- `independent-revision-targeted.log`: SHA-256 `61c3739a97c539ee0fe6941c4031e3bdcedf3cfa09610a6af65b292d05b8667c`, 14730 bytes.
