# Preserve numbered departure destinations

Related to #113 and #129; their broader source-identity requirements remain open.

## Reproduction and correction

On base `d8b70d02adf9babf72eb33c9d4ce2ba16ec9d3f0`, two otherwise
compatible simultaneous observations for Terminal 1/Terminal 10, Central/Central 2,
or 中央1/中央10 collapse into one departure. The destination containment test
allows one name to consume only part of another number. Cancellation, live
prediction, platform and trip context can then be carried to the wrong retained row.
These are controlled synthetic inputs, not a verified live-provider incident.

The correction compares numeric destination components only when accepting the
final merge group. Conflicting components reject that entire group. The original
minute-level compatibility and ambiguity graph stay unchanged: the veto cannot
remove a competitor, create a previously ambiguous merge or split a group into
newly mergeable subgroups. Exact scheduled instants remain required.

Joined components such as `1-1`, `1/2` and `1.1` remain distinct from `1`.
Bilingual names may repeat one identical component (`第1航廈 Terminal 1`).
Numeric components are normalized with NFKC; this does not equate every numeral
script. Numbers in additional service descriptions are not guessed away, so this
conservative guard may retain duplicate-looking rows. It is not a complete
destination-equivalence model or proof of cross-source train identity.

The regression retains the required 桜木町 / `(普通 Local) 桜木町 Sakuragichō`
case, exact same-board observations, live state and current request/cache limits.
Versioned module pins and PWA shell generation advance together.

## Validation

Environment: Linux, Node 24.19.0, pinned package dependencies. All unchanged
application/source/test files were checked against the base GitHub blob IDs;
historical investigation archives were not reconstructed or used as test gates.

- New destination test file on exact predecessor: 14 failures, 8 passing controls.
- New destination file on successor: 22/22 passed.
- `node --experimental-vm-modules --test tests/departure*.test.mjs tests/train-schedule*.test.mjs tests/sw-install.test.mjs tests/startup.test.mjs`: 331/331 passed.
- `npm run build`, generated-style reproducibility, JavaScript syntax and
  `git diff --check`: passed.
- First `npm test`: 1,527/1,528 passed; unchanged platform-length timed-retry
  assertion expected 2 attempts and observed 1. Its failure is preserved.
- Unchanged `tests/platform*.test.mjs` rerun: 42/42 passed. Full `npm test`
  rerun without concurrent browser work: 1,528/1,528 passed, no failures/skips.
  The concurrency difference is recorded, not asserted as the failure's cause.
- Guarded `scripts/check-departures-browser.mjs`: all Chromium scenarios passed,
  including distinct numbered destinations, isolated cancellation, both stop
  orders, cached close/reopen and existing request/failure/recovery checks.
  WebKit did not start: host shared libraries including `libgtk-4.so.1`,
  `libgraphene-1.0.so.0` and `libwoff2dec.so.1.0.2` are absent. The combined local
  command therefore failed; no local WebKit pass is claimed. Hosted CI remains
  required for both engines.
- A separate reviewer inspected the diff and full parsing/merge flow, reran all
  22 destination regressions and found no blocking issue.

The [immutable evidence archive](https://github.com/c933103/openrailwaystyle/tree/95138d5f6c0608009e92c92fe9b5b678a7b5297e/evidence/departure-destinations-20261013)
contains the original failures, successor logs, source SHA-256 manifest and
independent-review receipt. Bulky logs stay on that evidence branch.
No real timetable or map-provider requests were made by these controlled checks.

At publication, exact-head Codex review and hosted CI are pending. This document
does not claim merge, deployment, worldwide coverage or completion of #113/#129.
