# PR239: elevation-profile pending cache evidence

Application source: [affb52f90f968e24800ec0b50da92adad61006b2](https://github.com/c933103/openrailwaystyle/commit/affb52f90f968e24800ec0b50da92adad61006b2),
tree `322d63ee487e31f33aa56546450bd3388e92d491`, based on
`395f8bc749a555e29b399a4a3cf941692f53517a`.
[PR239](https://github.com/c933103/openrailwaystyle/pull/239) contains the compact
investigation and executable fixtures. All 14 changed blobs match local source;
the remote tree preserves all 762 unaffected base blobs. No historical archive
or source ref was deleted or rewritten.

## Final local results

Node 24.19.0 with the existing pinned dependency installation. Network data is
synthetic; no public-provider tile fetch or benchmark was performed.

- `node --experimental-vm-modules --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs`:
  **2,242/2,242 pass**, zero failures/skips/cancellations, 305.96 seconds.
- `node --experimental-vm-modules --test tests/elevation-cache.test.mjs tests/elevation.test.mjs tests/dem-repair.test.mjs tests/sw-install.test.mjs`:
  **67/67 pass**. This includes six new cache cases and release upgrade checks.
- Same six cache tests against unchanged base elevation source:
  **five expected failures, one compatibility control passing**.
- `npm run build`, generated `styles/world.style.json` equality,
  `node --check styles/elevation.mjs`, `node --check styles/app.mjs`,
  `git diff --check`, changed-document relative links: pass.
- Browser launch probe: pinned Playwright Chromium executable absent.
  No browser test ran locally. Earlier system-Chromium evidence reports a socket
  permission denial; that route was not retried. Hosted gates remain binding.

## Preserved failed measurements

- The first full aggregate, `node --experimental-vm-modules --test --test-concurrency=2 tests/*.test.mjs`,
  ended **2,212/2,213 passing** with a failed startup subprocess. The output does
  not establish its cause. The isolated startup TAP rerun passed **123/123**;
  the later serial aggregate above is a separate successful run, not a relabeling
  of this failure. Both complete logs are retained.
- The initial focused candidate run passed 16/17. Its new eviction test expected
  a repaired-cache hit to promote the independent raw cache too, although that
  is not the contract. The test was corrected to insert one additional distinct
  tile before asserting eviction from both 64-entry caches. The final test still
  fails against unchanged base and passes the same pending/completed-cache code.
  Its original failed output remains in `focused-initial.log.gz`.

## Interpretation and provenance

The 66-sample fixture starts 66 versus 65 fine loads. The actual 201-sample
out-and-back profile starts 138 versus 101 fine loads, with identical heights.
These are injected-loader calls and deliberately unsettled-response schedules,
not HTTP-byte, CPU, total-memory, frame-time, physical-device or server savings.
The existing terrain algorithm, source URLs and profile limit are unchanged.
Failure/retry and missing-reference compatibility controls remain explicit.

`manifest.json` records every compressed artifact's length/SHA-256 and its
decompressed length/SHA-256. Gzip timestamps are zero; decompression restores the
original logs exactly. The source-verification log lists the absent historical
archives/logo rather than reconstructing them. All remain in the remote tree.

Exact-head Codex/hosted CI and any later merge/deployment are recorded separately
in the PR conversation. This archive itself does not claim those outcomes.
