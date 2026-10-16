# Controls painter source-batch diagnostic proof

Application PR: https://github.com/c933103/openrailwaystyle/pull/233

Published diagnostic source: b9b6e2286877150f29d5523c82afa8509e78c521, tree 8b3581cdc1de6bcb3fd24fb398812e014817fe59, parent 8b3a0e7ff55bed0f4cd6f28e5b69a2ef7bb134dc. The complete 767-entry non-tree remote source set was verified against the unchanged main base plus exactly 10 frozen diagnostic files.

Reviewed patch SHA-256: 7ec340f4e3e0095fcd205c6183d27e83c937ae18ce5a63ad6b2168548c78c1ac.

The local implementation checks used those exact diagnostic bytes over PR232 application source d0ae45cc984aed44aaac0aa4fd1e742efc6eee5e: 48 focused tests, 2146 aggregate tests, build, style reproducibility, syntax and scoped diff checks passed. Independent review ran 49 focused/deadline tests and accepted v2. Every diagnostic old blob was identical on main and PR232. Exact-head hosted CI and fixture browser evidence remain prerequisites before merge.

No local browser success is claimed: the pinned Playwright executable is missing and installed Chromium fails before application execution with socket() EPERM. The archived original natural mismatch remains failed. It is included byte-for-byte with its recorded SHA-256; there is no tolerance waiver or relabelled controlled cold/warm sample.

## Files

- proof-summary-v2.json: source-backed findings and validation summary
- independent-review-v2.txt: independent acceptance and limitations
- publication-proof-v2.zip: old/new frozen patches and manifests, original rejected review, corrected review, test/build output, browser startup failures, pinned arrival replay, and original failed comparison JSON
- publication-proof-v2-manifest.json: each archived member's byte count and SHA-256

ZIP SHA-256: 9775ae5b7f9506cdb47f387c8700d4a6acc77b743f3061fd3f4aabdaf60609a2 (173600 bytes).

Historical artifact: https://github.com/c933103/openrailwaystyle/actions/runs/38907364746/artifacts/12049071433
Original artifact ZIP SHA-256: a022e2000d039c894db4d0051e4758908594e4f926e69d232263098423d1f031
Included original report SHA-256: 365b34f7db8622f4adf21aacce371e91262812f2d4a5281ac149a829dfc4beaa
