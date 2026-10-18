# Endpoint-height state regression evidence

- Repository: `c933103/openrailwaystyle`
- Baseline: `7d80b87b9db0f1baa02e9e9f911b9d7554a2b0db`
- Reviewed candidate: `c9b70df212e65ab2c88c3aa4f542ae8c40c88388`
- Candidate tree: `1a706ce75f032ba53877b6314db64b3b5ae344ab`
- PR: https://github.com/c933103/openrailwaystyle/pull/244
- Environment: Linux, Node v24.19.0, npm 11.9.0, Python 3; UTC 18 October 2026.

## Results

The original-source regression suite reproduced **18 failures** and retained **2 healthy controls**. The actual elevation loader resolved failed synthetic terrain reads to null endpoints, yet the distance tool still reported “Finding heights…”. The first pending request also retained ownership across explicit same-key measurements.

On the candidate, focused drawing/elevation/cache tests passed **173/173**, the full-application toolbar test passed **1/1**, and the final-source aggregate passed **2,441/2,441** with zero skips or failures. The earlier aggregate passed 2,440 tests before the final toolbar test was added; it is retained separately and does not substitute for final-source acceptance. Eight original-versus-fixed healthy comparisons have exactly equal rendered GeoJSON and status text across metric/imperial, rising/falling, sea-level and negative-height inputs.

Build, committed-style equality, JavaScript syntax and whitespace checks passed. Initial dependency installation failed because its default npm cache path was unavailable; `npm ci --ignore-scripts --cache /tmp/atlas-oct18-npm-cache` succeeded. Both logs are retained. No package or lockfile change was made.

Playwright's pinned headless shell was absent. The installed system Chromium was then tried and failed at process startup with `socket() failed: Operation not permitted`. No local real-browser acceptance is claimed. Required hosted browser and CI checks, current-head Codex review, merge and deployment remain separate gates.

## Commands

Run from a checkout with the pinned dependencies installed:

```sh
node --test tests/measure-height-state.test.mjs
node --experimental-vm-modules --test tests/measure-height-state.test.mjs tests/elevation*.test.mjs tests/draw*.test.mjs tests/sw-install.test.mjs
node --experimental-vm-modules --test --test-name-pattern='measurement toolbar' tests/startup.test.mjs
NODE_OPTIONS=--max-old-space-size=4096 npm test -- --test-concurrency=1
npm run build
git diff --exit-code -- styles/world.style.json
node --check styles/app.mjs
node --check styles/draw.mjs
git diff --check
node compare-healthy.mjs /path/to/candidate-checkout
```

The retained initial baseline test file should be placed at `tests/measure-height-state.test.mjs` in a temporary baseline checkout to reproduce its 20-test negative run. It is evidence only, not a replacement for the candidate's 21-test suite. The comparison script reads the baseline's immutable Git object and the candidate working drawing module; `healthy-comparison.json` records their SHA-256 values.

## Archive and boundaries

`logs.zip` retains the raw successful and failed local attempts, baseline test source, build output and browser-launch limitations. `manifest.json` binds every archive member and each published code/test/document blob. Healthy comparison output and its script are also directly readable alongside this receipt.

Only the measurement state, ownership, valid-value boundary and explanatory guide changed beyond the coordinated asset version. No new provider access, source acquisition, network policy, timeout, request/byte budget, assertion tolerance, cache-generation purge, or held domain/source work. Synthetic endpoint loaders performed no provider requests. This bounded repair does not complete #136/#112 or establish worldwide terrain quality. Earlier refs and evidence remain reachable.
