# Station query-limit acquisition repair — PR #252

Application head: `9bebdf1a7cc3c9b94a3abc458f08ad8196d895eb`.
Application tree: `b0d3796ae446fc16408d01886cb6a824338178de`.
Parent: `6de40f479d6eb0e4004552b42668555916341d82`.
Local commit `2e857202f53a9d055faa2cb874a4b4de343c92f3` has the identical application tree. The GitHub connector published that tree because the local Git CLI has no push credential.

Node v24.19.0, Linux, root UID. Dependencies installed by `npm ci --ignore-scripts --no-audit --no-fund`.
All station acquisition tests inject synthetic fetch responses. No provider fetch implementation is available to the entrypoint under test.

## Reproduction

The initial 23-case actual-entrypoint regression was run against the parent executable, before applying the production repair: **5 pass, 18 fail**. The failures cover lost HTTP execution-limit diagnostics, incorrect JSON dispatcher/maxsize subdivision, ignored error-body bytes, unbounded error-stream consumption and final-region handling. These are synthetic controlled reproductions, not captured public-provider incidents.

The initial baseline command used Node's default reporter, so its preserved output is named baseline.txt.gz rather than TAP. The final test file adds additional controls; it is not represented as the exact earlier baseline file.

## Final validation

- `node --experimental-vm-modules --test --test-reporter=tap tests/station-builder.test.mjs tests/station-acquisition.test.mjs tests/station-overview.test.mjs`: **37 pass, 0 fail, 0 skip**.
- `node --experimental-vm-modules --test --test-concurrency=2 --test-reporter=tap tests/*.test.mjs`: **2,619 pass, 0 fail, 1 skip**, 128.959 seconds.
- The pre-existing unreadable-file test in tests/preview-server.test.mjs skips on root UID/Windows; no test or gate was changed to introduce this skip.
- `npm run build`, generated world.style.json/major-stations.geojson equality, both changed runtime modules' syntax, and `git diff --check`: pass.
- Hosted CI/current-head review, merge and deployment are separate. This archive does not claim them.

## Integrity

The compressed files use gzip mtime zero. SHA-256 values below describe the decompressed original bytes.

| File | Original bytes | SHA-256 |
| --- | ---: | --- |
| baseline.txt.gz | 32135 | 13d4daff3d9da3a7abbfc81cea550f302153a557564c6198e2738831a6bf3fb8 |
| focused.tap.gz | 8000 | 30337ee2771642c4463a9e7aa4ed66a291eb2a615ec0b798f0154079cad44e1f |
| aggregate.tap.gz | 621856 | 424c2a6b7a270bf12a9d5d4ff33260f579829529d730cb5d2686710ce557e601 |

## Outcome and limits

Only explicit executed-query timeout/memory diagnostics can subdivide a region. HTTP error diagnostics have a 64 KiB allowance; successful bodies retain 15 MiB. HTTP 429/503, busy admission/dispatcher messages, generic gateway failures, permanent HTTP errors, truncated diagnostics and aborts retain the checkpoint. The one-request-per-run schedule and complete-only publication boundary are unchanged.

The observed [scheduled run](https://github.com/c933103/openrailwaystyle/actions/runs/39220152731) deferred on HTTP 502; its old log does not contain the body and cannot prove this defect caused that particular failure. The checked checkpoint remains incomplete: 21,500 records, 24 completed and 14 pending regions, updated 2026-10-19T06:38:57.386Z. No complete worldwide station or renderer acceptance is claimed.

The [Overpass operator documentation](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) distinguishes capacity admission from limits reached during query execution. PR #246 runtime integration is already merged. Soviet-topo preview #251 remains separate.
