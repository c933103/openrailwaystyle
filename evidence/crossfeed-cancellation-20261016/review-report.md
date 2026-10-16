# Expired cross-feed departure cancellation

## Scope and outcome

Prepared against main `96d0073383fe2b780e598663d0650fff0b42e816`, with the baseline departure parser blob verified as `8501b868bcb0def2c8633fd8a19611ffe2422e84`. Related to #113 and #129; neither broad issue is closed by this change. No provider calls, Work tasks, cache/request-limit changes or frequency-compiler changes.

The reproduced 12:00 UTC cancellation disappeared at 12:10 when another selected feed still predicted 12:14, although it was present before the scheduled time. Same-feed exact-repeat merging already retained it. The cross-feed parser discarded the old cancellation before matching.

The fix preserves the existing upcoming groups, then runs the same ambiguity and identity checks with expired observations present. Cancellation transfers only when the expanded group has exactly the same upcoming members and no conflicting known line labels. Only the boolean flag crosses expiry: live prediction, platform, presentation and the coherent trip/stop/scheduled-instant/event tuple remain the upcoming group's own values. Expired rows cannot become visible or bridge two live groups.

## Frozen application patch

- `styles/departures.mjs`: 30 added / 9 removed lines; extracts existing grouping and adds the conservative cancellation pass.
- `tests/departure-expired-cancellation.test.mjs`: 14 tests, including all three flags, feed/row permutations, unchanged live details, DOM cancellation presentation and correct lazy trip occurrence.
- `scripts/check-departures-browser.mjs`: production click/parser/renderer/cache checks for the three flags in both feed orders, with expired same-list competition controls.

Patch and per-file SHA-256/Git-blob hashes are in `frozen-manifest.json`. Patch SHA-256: `64b34cabc8f6659ef7bb46cb27aecce1ea50c5ba30d35cf7c603f422437c4dd8`.

## Coordinated cache-version delta

A separate token-only delta changes all nine version-bearing entrypoint/import files from `20261016-legend-layout-1` to the unique `20261016-crossfeed-cancellation-1`. Replacing the new token with the old token reproduces each base file byte-for-byte. No cache algorithm, generation, retention, acquisition or provider limit changes.

- `version.patch` / `version-manifest.json`: SHA-256 `f15d6bfd6f6a63892bd7e3fa123d448db77c803390925218765690bb26015985`.
- `combined.patch` / `combined-manifest.json`: complete 12-file patch, SHA-256 `2e4a6f55b72ed505b103626cf744c2bf4ad2a549c0d6817c1ed26a4b56352fb6`.
- The original parser/test patch and its manifest remain unchanged.

## Validation

Node.js 24.19.0, existing pinned dependencies, synthetic inputs only.

- Final targeted `node --test tests/departure-expired-cancellation.test.mjs`: 14/14 pass.
- Prior focused departure + train-schedule suite: 383/383 pass. The final candidate adds one additional line-bridge control; its final full-suite result is recorded separately.
- Baseline parser against the final tests: 7/14 fail, including all cancellation flags and the UI case.
- Naively moving expiry filtering to the end: 8/14 fail, including both wildcard bridge controls.
- Final `npm run build`: pass. Generated style/station data equality, JavaScript syntax checks and `git diff --check`: pass.
- First aggregate run: 2,158/2,159 pass, with an unrelated globe drag timing assertion reporting 729 ms against its unchanged 500 ms bound. Isolated rerun of that test passes. This failed run is retained, not reclassified.
- Final full aggregate `npm test`: 2,161/2,161 pass on the frozen parser/test source.
- Versioned-source build, generated-output equality, syntax and whitespace checks pass. All service-worker upgrade cases passed in the focused run, but its startup worker exited with an unexplained test-process failure. The default-concurrency versioned full aggregate also reported an unrelated painter-test process failure. Both results are retained. The concurrency-2 run completed with 2,160/2,161 passing: one unchanged rare-Han wall-clock retry assertion observed two rather than three attempts at 1,150 ms. After other aggregate runs finished, the complete final-source serial run passed all 2,161 tests with zero failures/skips in 329.4 seconds. Command: `node --experimental-vm-modules --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs`. No test assertions, timing tolerances or gates were changed; the earlier failures remain failed measurements. The exact cause of the earlier process exits is not established.
- The real-browser runner is present and syntax checked, but local execution stopped before browser launch because Playwright Chromium is absent. Chromium and WebKit execution are not claimed; exact-head hosted checks remain required.

## Review and rollout limits

Independent review accepted the exact combined patch without a code blocker. Application candidate commit: `170ba997cadd5ab932d242866fe0c7859f5553db` (tree `45dc83e7c0f37b29d8bb5c92a9d392ee0d49080c`), with all 770 remote blob entries verified: the 12 reviewed changes and every unchanged base blob. Merge remains a separate step after exact-head Codex review and required CI. The separate coordinated version delta is included for rollout. Neither hosted-browser acceptance nor actual deployed/installed-client acceptance has been established; local worker simulation is not a deployment claim. Preserve all existing CI, provider safeguards and broader issue holds.
