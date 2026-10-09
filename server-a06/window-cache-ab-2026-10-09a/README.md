# A06: independent lazy window-cache experiment

This is a new Node.js 22.23.3 paired measurement cohort, `window-cache-ab-20261009a`, using the durable sanitized timetable fixtures. The candidate caches only the feed-level display-window string, lazily at its original first evaluation position. The earlier rich-record candidate is not included.

- [Report and decision](report.md)
- [Frozen experiment plan](experiment-plan.json)
- [Raw run metrics, logs and identity gates](runs/)
- [Descriptive paired analysis](analysis/summary.json)
- [Candidate patch](candidate.patch)
- [Reproduction instructions](REPRODUCE.md)
- [Full-data correctness checks](correctness-summary.json)
- [Blocking-wait4 supervisor and failure controls](measure_replay.py)
- [Publication hashes](publication-manifest.json)

Both variants retain the earlier comparison base `802062b5c44718e6baf3d36db5010ee42799368c`; later preview-server changes are not relabelled into this measurement. The host is shared, caches are warm/uncontrolled, and coordinated deferral of known local tests does not establish exclusive access.

The original historical package remains **57/83 recovered, 26 originals missing**. These new measurements and helpers do not change that count. The [original recovery ledger](../2026-10-09/recovery-ledger.json) remains the authority for original artifacts. Frozen sanitized inputs and expected hashes are reused from the [separate replay bundle](../replay-2026-10-09a/); no duplicate timetable archives or working output trees are included here.
