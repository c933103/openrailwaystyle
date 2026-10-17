# Elevation-profile gap correction: validation receipt

**Update:** all hosted PR checks subsequently passed. See the [hosted validation
addendum](hosted/README.md) for exact terminal results, source identity, artifacts
and remaining boundaries. The initial local-only receipt below is preserved.

Application source: `84c0258018e5223f852cd273feaa1264efa2a7e0`.
Baseline: `b194d78cd32496489ebfa94ee774620a33f27617`.
Related scope: #136, #112 and #106. Broader terrain/source acceptance remains open.

## Outcome

The production profile renderer formerly connected observations across failed
height samples. The `[0, null, 100]` reproduction over 100 m drew one line/fill
and asserted a 100% steepest gradient. The correction preserves two isolated
points, no connecting line/fill, and unavailable connected ascent/descent and
gradient. Partial UI summaries and hover readouts describe the missing data.

The complete application change is 15 files, including compact tests,
documentation and the coordinated asset-version/shell upgrade. The published
tree was checked against baseline and the expected Git blobs: exactly those
15 changes, zero removed files. No raw logs or historical source bundles are
added to the application branch.

## Verified checks

Environment: Linux, Node.js 24.19.0. Existing local dependencies were reused;
`npm ls --depth=0` exited 0. No fresh dependency installation was claimed.

- `npm run build`: passed; generated `world.style.json` remains unchanged.
- `node --check styles/app.mjs`, `node --check styles/elevation.mjs`, and
  `git diff --check`: passed.
- From the source root:
  `node --max-old-space-size=1536 --experimental-vm-modules --test --test-concurrency=1 tests/*.test.mjs`:
  **2,370 passed, zero failed/skipped/cancelled**, 352.251 seconds.
- `node --experimental-vm-modules --test --test-concurrency=1 tests/elevation*.test.mjs tests/sw-install.test.mjs`:
  **88 passed**, including the immediately preceding shell release.
- The 15-case new regression suite passes on the candidate. Running the same
  tests against baseline source gives **10 failed / 5 passed**. The failures
  include the new segment API absent from baseline and the independently
  exercised wrong slope, missing-gap UI, fake zero, retry and zero-length
  behavior. Positive complete profiles and interruption guards remain passing.
- A seeded comparison of **500 fully observed, nonzero-length profiles** found
  exact equality of every summary field between baseline and candidate.
- The actual elevation loader's synthetic failed tile produces a UI gap and
  recovers on explicit retry while retaining healthy cached tile bytes.

The first aggregate invocation accidentally ran from the temporary checkout's
parent rather than the repository root. It finished **2,141 passed / 126 failed**;
its log is preserved as `initial-aggregate-wrong-cwd.log`. The correct-root run
above supersedes that invocation, without changing tests to hide its failures.

## Remaining validation boundary

Local real-browser validation could not start. The pinned Playwright Chromium
binary is absent; the installed `/usr/bin/chromium` then aborts because its
Unix socket is prohibited (`Operation not permitted`). Both actual launch
failures are preserved. DOM/SVG tests are not a real-browser rendering pass.
Required hosted CI, exact-head independent/Codex review and any subsequent
merge/deployment remain separate gates. This receipt claims none of them.

The new probes/tests use synthetic heights and terrain bytes. No public map
tile benchmark, provider-policy change, acquisition dispatch, VPN/network
change, domain activation, review request or merge was performed for this fix.

`candidate-files.json` binds the application bytes. `publication.json` records
remote tree verification. Reproduction scripts accept a source checkout path
so the retained Git sources can be used without a duplicated source archive.
The source-verification record lists 603 locally materialized baseline files
and omitted historical docs/assets; all test prerequisites used by the final
aggregate were present. Existing repository files omitted locally were
preserved unchanged through the base Git tree during publication.
