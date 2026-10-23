# Polar style parity — PR #255 validation evidence

Source: `610763a00a5854d54ff717d8916452654a61f2b9`, tree `0e94f59c28ffac5526aac46cf3395216760b80e9`.

This evidence branch preserves local validation logs and useful failures without adding them to the application branch. The archive contains no provider tiles, credentials, or duplicate historical source bundles. File and archive SHA-256 hashes are in `manifest.json`.

## Final source results

- `npm run build`; generated world style unchanged; MapLibre style validation reports zero errors; `node --check styles/app.mjs`; `git diff --check` pass.
- `node --experimental-vm-modules --test --test-reporter=tap tests/*.test.mjs`: 2,665 tests, 2,664 passed, zero failed, one existing root-permission skip. This run used the final precommit working tree; the Git data API tree was then verified equal to the local tree and published as the source above.
- `node --experimental-vm-modules --test --test-reporter=tap tests/polar*.test.mjs`: 38 passed.
- `node scripts/run-browser-checks.mjs --concurrency 2 --label guide-610763a check-rail-reference-browser.mjs check-platform-stations-browser.mjs check-signal-power-browser.mjs check-infrastructure-browser.mjs check-terrain-deadlines-browser.mjs check-platform-browser.mjs check-orm-fixture-browser.mjs check-globe-browser.mjs check-polar-browser.mjs check-polar-parity-browser.mjs`: all ten passed against a local server started in the same execution/network namespace. See timings JSON and stdout. Both polar checks exercise both hemispheres; the parity checker samples exact GPU pixels on either side of the Mercator boundary. Shared browser transport blocks unmocked provider egress.
- The idle-settlement parity harness also passed twice before publication. Its failure path was verified by substituting the `0edbc39e6` painter: the unchanged legacy runway-only filter assertion still failed. The final generated bundle was restored byte-for-byte after the substitution.
- Code and security review both completed with no findings on exact source head. Original and subsequent inline review threads are resolved. Hosted reference and controls diagnostic passed. The hosted site browser matrix was still running when this archive was created; its final result must be read from the PR receipt and linked Actions run, not inferred from this archive.

## Preserved failures and negative controls

These logs retain their original outcomes and are not replaced by later passes:

- `polar-negative.log`: original `30913b6` painter fails the overlap gate.
- `polar-camera-negative.log`: `6e308ec` fails authored camera-zoom visibility.
- `polar-dynamic-negative.log`: `92061b6` fails overlapping seabed layer coverage.
- `polar-outline-negative.log`: `5573fb5` fails exact outline seam pixels.
- `polar-airfield-filter-negative.log`: `2464682` fails class-specific airfield filtering.
- `negative-idle.log`: `0edbc39e6` fails legacy property filtering even after native idle settlement.
- `browser-wide-final.log`: earlier broad run retained a mobile platform timeout and interrupted runner; it is not a complete passing aggregate. `platform-recheck.log` is its unchanged isolated passing rerun. The final full guide run independently passed on the source above.
- `browser-2683997.log` and its timings JSON: prior first-render sampling exposed stale ordinary-source filter buckets. The final harness waits for native source/style idle; pixel assertions, tolerances and provider isolation were not weakened.

## Hosted and review links

- [PR #255 and exact-head review state](https://github.com/c933103/openrailwaystyle/pull/255#issuecomment-6310513507)
- [Final site workflow](https://github.com/c933103/openrailwaystyle/actions/runs/39931287433)
- [Final worldwide reference workflow](https://github.com/c933103/openrailwaystyle/actions/runs/39931287447)
- [Final controls diagnostic](https://github.com/c933103/openrailwaystyle/actions/runs/39931287310)

Existing polar snapshot coverage, ETOPO 2022 resolution, GPU budgets, cancellation/cleanup, source provenance, Carto roads and Satellite/Hybrid caps retain their contracts. This evidence does not establish equality of ordinary/polar source geometry or current public provider data. No merge or deployment is claimed.
