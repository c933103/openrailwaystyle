# Atlas #109 supplemental metadata validation

Application PR: https://github.com/c933103/openrailwaystyle/pull/271

Final source: `88bee49d4c20aa4fbebdd501b503587f2dba7e49`.
Base: `021ac76a61f8803134c7647fcc15f0a6b7920516`.
Environment: Linux, Node v24.22.1, existing lockfile-pinned dependencies.
The isolated checkout was fetched to the final remote commit and clean before
the final full run. No live provider queries or raw fixture rewrites were made.
These are local test results, not a CI/review/merge/deployment receipt.

| Output | Command / outcome |
| --- | --- |
| `full-final.log` | `npm test`: 2,716 passed, 0 failed/skipped/cancelled; npm and wrapper exit 0 |
| `focused-final.log` | `node --test tests/service-relation-supplemental.test.mjs tests/service-relation-history.test.mjs tests/service-relation-properties.test.mjs tests/service-geometry-acquisition.test.mjs tests/service-geometry-metadata.test.mjs tests/service-routes.test.mjs`: 129 passed, 0 failed/skipped/cancelled |
| `build-final.log` | `npm run build`: passed; chained generated style/station equality, `node --check styles/app.mjs`, changed-module syntax and `git diff --check` all passed; wrapper exit 0 |
| `unchanged-paths-recheck.log` | `node --experimental-vm-modules --test tests/controls-painter-boundaries.test.mjs tests/startup.test.mjs`: 152 passed, 0 failed/skipped/cancelled; exit 0 |
| `initial-full.log` | Initial candidate-development `npm test`: 2,704 passed / 2 failed whole test processes, 0 skipped/cancelled; failure records name `controls-painter-boundaries.test.mjs` and `startup.test.mjs` |

The initial run overlapped other local testing and candidate edits; it is **not**
attributed to the final exact source. Its complete original output is retained,
including both failures. The initial shell used `npm test > log 2>&1; tail ...`,
so its wrapper returned 0 and did not separately capture npm's exit status.
The test report establishes failure, not its cause. The output provides no
underlying signal/exit-code diagnostic for those two processes. They are in
unchanged source paths, but focused rechecks passing does not prove they were
unrelated or concurrency-caused. No failure gate was removed or weakened.

The final full run used explicit status capture and returned 0. It covered
the new metadata tests and every existing Node aggregate test, including the
unchanged unrelated-tag omission assertion and Python suites invoked by those
tests. The focused tests cover authentic archived values and core hashes,
old/new same-revision arrival orders, newer snapshots, replay, pending/discard/
commit, NDJSON, stage retirement, explicit supplemental contradictions,
bounded reducer algebra, representative tile bytes/grouping/diagnostics,
production acquisition persistence and production headway rebuild equality.

`manifest.json` records byte lengths, SHA-256 digests and Git blob identities of
the original outputs. General raw positive/negative classification coverage
remains unresolved under #109. Supplemental context does not establish service
eligibility and is not activated in the matcher.

## Positive timetable-binding probe

`node matching-probe.mjs /path/to/checkout` replays a verified synthetic OSM
snapshot using the repository's existing local timetable fixture. At the exact
final source it confirms 3 identical positive sections, 0 stale sections when
the old artifact is bound against the supplemental table, 6 byte-identical
tiles with actual nonzero timetable profiles, and 0 sections for an agency
matching only the supplemental brand. `matching-probe.json` records the result.
Whole-input `osm_sha256` inventory hashes appropriately differ because NDJSON
now retains more evidence; section-binding identities, matching outcomes and
tile bytes do not. This probe does not make a live or general classifier claim.

## Retention/size follow-through

`storage-analysis.md`, `storage-probe.mjs` and `storage-probe.json` document
per-envelope bounds, a 1,000-observation plateau test, raw/gzip fixture sizes and
the existing service publication's single-blob size risk. They do not claim a
measured global post-change output or a new acceptance gate.
