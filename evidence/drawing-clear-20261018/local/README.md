# Drawing Clear: local acceptance

Tested source: `54c98b616b659259ad5149a6b2cbe02c7c068824`; tree `481555d1d93e8785da068e7c55d398865f9f37fe`. Base: `891e97ade75a4f156cc7b752375673e7a6e849aa`.

All baseline source files were compared to the pinned GitHub recursive tree before editing. All 14 published changed blobs match tested local bytes; `source-manifest.json` records their SHA-256 and Git identities. Code/tests and the compact contract are on [PR245](https://github.com/c933103/openrailwaystyle/pull/245); this additive branch stores logs separately.

## Commands and outcome

- Node24.19.0, npm11.9.0, Linux temporary native execution workspace. Dependencies reused from the previous verified checkout; package-lock and packages are unchanged.
- `node --test tests/drawing-clear.test.mjs` on the exact predecessor application: 20 tests, 15 failed, five healthy controls passed (`predecessor.txt`). The new test file supplies the identical expectations to both versions.
- Same focused command after correction: 20/20 passed (`focused.txt`).
- `node --experimental-vm-modules --test --test-name-pattern='drawing toolbar clears' tests/startup.test.mjs`: 1/1 passed (`toolbar.txt`). This was before only the coordinated token bump; the full final aggregate reruns it afterward.
- `npm run build`: passed; 259 layers, reproducible generated style (`build.txt`).
- `npm test`: final source, 2,467/2,467 passed, zero failures/cancellations/skips (`aggregate.txt`).
- App/test syntax, unchanged generated-style comparison and `git diff --check`: passed (`checks.txt`).
- Playwright's default binary was absent (`browser-launch.txt`). The installed `/usr/bin/chromium` then failed at launch because socket creation is prohibited (`browser-system-launch.txt`). No native browser acceptance is claimed and no launch policy was relaxed. Required hosted browser groups remain pending at this receipt.

Tests use synthetic fixtures and real application/class/DOM handlers. The startup harness blocks unmocked Node networking. No public-provider tile downloads or benchmarks were made. The reproduction is a UI-state defect, not a real-world source coverage finding.

## Behavior and limits

Clear recognizes finished features, unfinished points and a pending extension, retains the same explicit deletion confirmation, and uses the existing clear implementation. Accept/decline, paused drawing, saved/draft combinations, an extension with all points undone, persistence/reload, no resurrection on Finish/cancel, repeated empty clicks, initialization and new drawing afterward are covered. The real service worker returns exact new offline toolbar bytes while retaining the prior token for old tabs; cache generation is unchanged. No existing assertion/deadline/gate changed.

Exact-head Codex Code and required CI must pass before the parent merges. Advisory Security is reported at its actual head/status and is not an invented mandatory gate. Deployment and served-byte verification are not claimed here. All source/provider/domain holds remain unchanged.
