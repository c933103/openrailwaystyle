# Current benchmark contract migration receipt

Date: 2026-10-12. Status: tested source published; draft/review and hosted CI tracked in the application PR. No merge or deployment claimed.

## Source and scope

- Base: `85e7c7bfcd8c561f21ee9b000572b559c4928641` (main); all 691 tracked blob identities were verified against the GitHub tree before editing.
- Tested/published source: `5b1f1e14d756b12c92e6f104f3634b8687119410`; tree `bcb3a975a2af1476a186239f7416d5be57147797`.
- Changed: repository working guidance, contribution link, timetable contract documentation, matcher benchmark harness and its regression test. No application source, dependency, workflow, product data, fixture archive or old result changed.
- Original report remains in the application tree and reachable at the base commit: `docs/investigations/timetable-evidence-benchmark-20261009.json`, SHA-256 `0f308522f83304e6684bc700c3f8f5abb14e7107a5ad19ea437f6eede1542ca4`.
- New CI contract: execute current compiler/matcher with a compact synthetic cohort; check all four outcomes, current source provenance and metric/report shape. Historical source byte identity no longer blocks ordinary edits. No performance threshold was weakened; the old test contained no time/RSS threshold.

## Verification

Environment: Linux 6.18.44 x86_64, Node 24.19.0, npm 11.9.0, Python 3.12.14, repository-lockfile dependencies. No provider requests or downloads.

| Command/check | Result |
| --- | --- |
| `node --test tests/timetable-matching.test.mjs` | 115/115 pass, 0 skipped |
| `npm test` | 1,500/1,500 pass, 0 skipped; 104.484 seconds |
| `npm run build` | Pass; 242 generated style layers |
| `git diff --exit-code -- styles/world.style.json styles/major-stations.geojson` | Pass; generated product inputs unchanged |
| `node --check styles/app.mjs` and benchmark harness syntax | Pass |
| `git diff --check` and changed relative Markdown links | Pass |
| `node scripts/benchmark-timetable-matching.mjs` | 10,000 trips, 24 calls, 28 profiles, two patterns, 10,000 observations; all four expected outcomes across three repetitions (12 results); six emitted source hashes match tested bytes |
| Existing `scripts/ci-plan.mjs` against the five changed paths | No browser inputs affected; no browser groups required by the unchanged planner |
| `python3 negative-controls.py` from the tested checkout | Both positive controls pass; all four deliberate regressions fail |

The first aggregate attempt was interrupted by the execution tool without a final test result. Its partial output is preserved once as `tests-attempt1-incomplete.log`; a fresh authorized retry passed. This incomplete attempt is not counted as a passing aggregate.

## Negative controls

The disposable copy contains only the relevant current sources and compact observation fixture, no historical reports.

- Clean current source: pass.
- Harmless comment edits to all six measured sources: pass without editing or adding a historical report.
- Report hashes replaced by false values: fail.
- Unbound negative outcome omitted from the report: fail.
- Source-work limit reason broken in the matcher: fail.
- Candidate-work limit reason broken in the matcher: fail.

`negative-controls.py` reproduces these checks; `negative-controls.log` preserves their outcomes. Production matcher/timezone/compiler bytes remain unchanged. Existing compiler output equality, identity integrity, fixture isolation and upgrade/security assertions are retained by the passing aggregate.

## Limits

No live-provider, geography, browser rendering, deployment or production-resource claim. Default-cohort timings are environment-specific diagnostics, not a cross-run performance comparison. Hosted CI and independent current-head review remain separate acceptance stages. Existing archives and holds are unchanged. Raw run material is on this evidence ref, outside the application PR's changed files.
