# Cancellation evidence correction, revision 2

Candidate `33123c8444f1341eb2b7a7250ec1a3e0d1b25526`, tree `eb56d7a2256b1e28a7212dd09798d94722293daf`, based on main `96d0073383fe2b780e598663d0650fff0b42e816`. All 770 remote source blob entries match the frozen 12-file manifest; only the parser and new regression file differ from candidate `170ba997cadd5ab932d242866fe0c7859f5553db`. The nine-file version-only delta remains identical, using `20261016-crossfeed-cancellation-1`.

## Review finding and correction

[Codex P2](https://github.com/c933103/openrailwaystyle/pull/235#discussion_r4296512718) identified a real omission: an ordinary expired competitor could remove a minute-level uniqueness edge and unlock cancellation in a subgroup previously rejected for exact-time identity. A related case hid a second known line from a wildcard cancellation. Both reproduced against the first candidate, whose acceptance is superseded for this graph behavior.

The expanded expired-evidence graph now retains every compatible minute-level edge. Adding expired observations can enlarge a component but cannot remove an ambiguity witness. Existing whole-component duplicate-list, exact-time and destination vetoes still apply, followed by the known-line and upcoming-group intersection guards. Rejected components are never regrouped. Upcoming grouping remains unchanged, and only cancellation can cross expiry. No provider, acquisition, cache algorithm or request-limit changes.

## Final-source checks

- 17/17 targeted regression tests pass, including the three new ambiguity-edge tests across flags and row/list permutations.
- 387/387 focused departure/train-schedule checks pass.
- Build, generated-output equality, syntax and whitespace checks pass.
- Complete serial aggregate: 2,164/2,164 pass, zero failures/skips, 368.7 seconds, Node 24.19.0. Command: `node --experimental-vm-modules --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs`.
- Independent revision review accepts the exact parser/test blobs: 145 focused tests, 288 targeted permutations, 24 rejected prior-graph controls, and 12,000 generated ordinary-witness insertion checks / 24,000 permutations. The prior graph incorrectly unlocked cancellation in nine generated insertions; this revision did so in zero. Raw compact logs and the reviewer’s report are included.

## Retained failures and limits

The initial revision aggregate was interrupted by an executor recovery after test 589. The tool reported `executor key changed during session recovery`; the process was absent and no exit status existed. Its incomplete log is retained as interrupted, neither passed nor failed. All frozen file hashes survived recovery; the complete rerun above passed. Earlier candidate failures remain preserved on the evidence branch and are not reclassified.

Local Playwright could not launch because the pinned Chromium executable is absent. The production browser regression is unchanged; hosted Chromium/WebKit and required CI must pass on this new exact head. A fresh Codex review is required. No merge, deployment or installed-client acceptance is claimed. Related broad issues #113 and #129 remain open.

Combined patch SHA-256: `22493b76d709afb7dd9df6131c9c896a9ac6652fed19cabb8aff78cb87b0dd5c`. Per-file hashes are in `manifest.json`; commands and raw-log hashes are in `results.json`. Historical candidate evidence remains reachable at commit `abf3347e4b271380fa8dcf8e024cda00dd3644e7`.
