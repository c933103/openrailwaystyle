# PR240 platform-length cancellation: validation evidence

Source: [3364ed3956167a7d2940a7ad3ba14c4f38aebcb4](https://github.com/c933103/openrailwaystyle/commit/3364ed3956167a7d2940a7ad3ba14c4f38aebcb4),
tree `70c4c7b9330a345324ada58e1da26ca90c07ba0c`, based on
`a486084d2b06fe99aa70ed19a22bcb99f4d8eec0`.
[PR240](https://github.com/c933103/openrailwaystyle/pull/240) is the working issue
and contains the compact investigation and final executable regressions.

Remote tree readback verifies all 14 intended changed blobs and all 764 untouched
base blobs. The publication receipt is in the archive. The local final files
still matched all 14 published blob hashes after validation. Historical source
archives are preserved on the base tree and are not duplicated here.

## Completed local checks

Node 24.19.0, npm 11.9.0 and the existing pinned dependencies. Fixture calls only;
no public-provider tile downloads or new benchmark.

- `npm run build`: pass; generated `styles/world.style.json` remains identical.
- Changed source/test syntax, `git diff --check`, and published blob hashes: pass.
- `node --test tests/platform-measure-cancellation.test.mjs`: **5/5 pass**.
- Identical five tests against unchanged base platform source: **three expected
  cancellation failures, both eligible-zoom controls pass**.
- `node --experimental-vm-modules --test --test-concurrency=1 tests/platform*.test.mjs tests/elevation*.test.mjs tests/sw-install.test.mjs`:
  **115/115 pass**, no skips or cancellations.
- Controlled actual-reader probe: zoom 19 to 18 leaves **three loads / one hidden
  completion** on base, and **one load / zero hidden completions** with the fix.
  The retained first fetch may finish; no transport-abort claim is made.
- Resumed and uninterrupted measurements have exactly equal lengths, metadata
  and visited tiles. Pending/completed first tiles are reused on resume.

## Preserved failures and limitations

- The initial new tests expected the UI callback to contain the geometry
  reader's `tiles` field. The existing UI intentionally stores that separately.
  The final tests assert the complete raw result including its tile list, and
  separately assert the unchanged UI properties. `focused-initial.log` retains
  the five failed test-development assertions; product logic was unchanged.
- The initial parallel focused run (platform/elevation/SW/startup files) ended
  **215/216 passing**, with a startup subprocess failure and no failing assertion
  reported. It is retained as a failed run.
- `node --experimental-vm-modules --test --test-concurrency=1 tests/*.test.mjs`
  ended **2,212/2,214 passing** after 331.63 seconds. Departure-availability and
  startup subprocesses terminated; no detailed cause was emitted by that reporter.
  The count is incomplete because those subprocesses did not finish. It is not
  equivalent to a full aggregate pass.
- A diagnostic rerun with `--max-old-space-size=512 --test-concurrency=1 --test-reporter=tap`
  on departure-availability and startup passed the departure file but explicitly
  exhausted the startup V8 heap: **223 passing assertions, one failed subprocess**.
- Isolated startup with `--max-old-space-size=1024` likewise reports heap
  exhaustion: **110 passing assertions, one failed subprocess**. At 1536 MiB it
  completed all **123 startup assertions**, then received **SIGKILL** before a
  successful runner completion. The latter is still a failed run. These probes
  establish their own resource limits, not the proven cause of the earlier exits.
- Pinned Playwright Chromium is absent. A system-Chromium launch exits at a
  sandbox socket permission failure. No local browser test pass is claimed.

No test assertion, CI workflow or threshold was weakened to address these
execution limits. Existing hosted aggregate/browser gates and exact-head review
remain required. Their final outcomes belong in the PR receipt; this archive
does not assert merge, deployment or physical-device acceptance.

## Archive and reproduction

`manifest.json` identifies every member's length and SHA-256 and the complete
ZIP hash. `logs.zip` contains 17 original logs/receipts/probe files; it includes
both successful and failed attempts. The original probe expects the application
checkout in a sibling `source/` directory. For ordinary reproduction use the
five committed tests at the source SHA above, which do not need the archive.

The source patch removes unnecessary continuation for this zoom interruption.
Injected call counts are not production bytes, real-device CPU or GPU memory
measurements, and wider #150/#138/#176 resource obligations remain open.
