# A06 replacement-host offline replay

## Result and scope

This new cohort, `replay-20261009a`, establishes a reproducible local assembly baseline on the replacement host. It does not replace the original host's observations or restore its missing raw files. Original recovery is permanently recorded as 57/83 unless exact missing originals later reappear. No new provider, catalogue, GTFS or ORM acquisition occurred; all input data came from the existing cleared sanitized GitHub artifacts.

The historical implementation is pinned to `6f43c9f9ca998ea5b3081655b6a43bb29ae51713`. Three repeated runs, `historical-02`, `historical-03` and `historical-04`, are the baseline. The initial calibration, a separate CPU-profile run, current-code correctness check and final harness check are excluded from baseline statistics.

| Run | Wall seconds | User CPU | System CPU | Total CPU | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| historical-02 | 34.319911 | 38.802079 | 1.924684 | 40.726763 | 575504 |
| historical-03 | 33.320665 | 39.050379 | 1.814681 | 40.865060 | 571560 |
| historical-04 | 34.074577 | 38.541940 | 1.975704 | 40.517644 | 573108 |
| Median | 34.074577 | 38.802079 | 1.924684 | 40.726763 | 573108 |

Peak RSS median is 559.6758 MiB. Median component CPU values need not sum to the median of per-run total CPU. The raw JSON values and recomputable CSV are retained.

## Correctness and time-sensitive data

All measured executions matched 117 complete sanitized reference file hashes and byte lengths. There was no field stripping, timestamp normalization or reference substitution. The coverage is 2,039 inventory entries; statuses excluded 1,220 / no-rail 635 / compiled 106 / failed 78; 106 summary feeds; 86 mapped feeds; 66 countries; zero tiles. The matched manifest has 664,872 available segments and 1,045 routes with profiles.

Assembly calls the unchanged `Date.now()` for each feed. `availableSegments` and `routesWithProfiles` depend on feed review/validity and route/segment expiry. Those fields matched at the recorded actual UTC run times. A later replay may legitimately differ after expiry; the harness saves raw differences and fails the exact-identity gate rather than silently relaxing it.

The source at freshly read main `c62d457a3177f8ae6fe7c75d29e5aa82f8d807ef` was also replayed once. Assembly, streaming reader and timetable-summary files are byte-identical to the historical revision. The imported service-route module and package metadata differ. The current-code check still matched all 117 outputs. Its single timing is not a second baseline or an optimization comparison.

## Environment, bounds and comparability

- Runtime: Node.js 24.19.0. Historical workflow used Node.js 22; no Node22 executable was present in the inspected installed-runtime locations. Node24.21.0 was also available but was not used.
- Replacement host: AMD EPYC 9V74, nine available CPU affinity slots, about 9.73 GiB memory, no swap. The earlier host reported an Intel Xeon Platinum 8573C. Cgroup limit files were not exposed; no claim of unlimited physical resources is made.
- This is a shared host, with uncontrollable background work. Per-run load averages and available-memory observations are retained. It is not an exclusive-host benchmark or production-capacity forecast.
- Each run used a fresh source/input copy and a fresh Node process. Copying and hash verification warmed filesystem caches; caches were not dropped. None is a cold-cache result.
- Node old-space limit 1,536 MiB; sampled RSS guard 2,048 MiB; 300 s wall guard; 300/305 s CPU limit; 256 MiB individual-file limit. Bounds apply only to these child processes.
- Monotonic wall timing covers process launch through reaping. A 250 ms polling interval adds up to one interval of completion-detection latency. `wait4` reports child user/system CPU and peak RSS. Preparation, source/input copying and final output hashing are outside the timed interval.
- Optional per-process I/O-byte counters remain unavailable. An earlier denial was not retried or bypassed.

The new 34.07 s median versus the previous host's 92.91 s median is not evidence of a code improvement. Hardware, resource conditions and measurement settings differ. The complete new raw evidence is retained so a future same-host A/B comparison does not depend on the lost originals.

## Reconstructed artifacts and integrity controls

The eight durable sanitized ZIPs retain their previously cleared exact hashes. The new reference pack contains only `inventory.json`, `manifest.json` and `tiles/index.json`; unchanged feed bytes come from those ZIPs. Its 423,898-byte SHA-256 is `b3023bd75669f6c6d376759311a7fd411a329ce27bc1221fde7e4a15cfcad2b4`, explicitly different from the missing original tar container. It reconstructs the same 121 input and 117 expected files.

The extraction helper validates paths, archive hashes, declared/member sizes, exact member sets and file types before any output. It rejects links, path traversal, duplicate and unexpected members; TAR inflation is bounded. Fifty extraction tests passed, covering normal and optimized Python. Eighteen historical source tests passed. A setup-only test failure arose because the copied dependency directory was not named `node_modules`; correcting that local directory restored Node's nested package resolution. The failing setup log is retained. Calibration overlapped the final source tests and is excluded from baseline repetitions.

The baseline and profile used the preserved executed v1 harness. Source and dependency versions were inspected beforehand; per-run source copies and complete installed-dependency/runtime fingerprints were checked afterward. These are honestly labelled retrospective receipts, not a claim that v1 enforced admission checks. The current-code run used retained v2 with pre/post source/dependency/runtime checks. Original metrics were not rewritten.

The final helper adds explicit pinned source/dependency/Node/replay-manifest checks before launch and complete copied-input checks before timing. Only six individually listed, non-executed Python test cache files are excluded from portable source identity; unexpected JavaScript or dependency files remain covered. Ten focused controls passed under both normal Python and `-O`, including changed code/dependencies/runtime/manifest, exact cache exclusions and correct matching counts when an extra output exists. An additional final-harness correctness replay passed the complete final path separately. Seven identity-builder controls also passed under normal and optimized Python, including rejection of a reused cohort ID, changed source, wrong dependency versions and unsafe links.

Installed dependency versions match historical lock entries, and actual installed-file digests are retained. Packages were copied from an existing installation, not independently re-downloaded or rehashed against registry tarballs. Reproduction records a distinct local dependency/runtime fingerprint rather than claiming another machine has an identical installed build.

## Bottleneck and bounded next experiment

The separate V8 profile attributes 66.16% of weighted main-thread samples to the streaming reader, 18.16% to timetable summarization, 4.25% to garbage collection and 2.87% to idle time. These are exclusive sample-time shares, not total-process CPU shares; gzip worker-thread work is not fully represented. `parseFrequencyFeed` accounts for 38.28%, its JSON item parser 27.54%, and `timetableFeatures` itself 15.77%. Captured completion intervals identify the two large French ZOU feeds as the longest individual feed intervals, around 3.15–3.48 seconds, but those intervals combine read/parse/summary and capture scheduling.

Parsing dominance does not justify a custom parser or weaker validation. The smallest next candidate is a `summaryOnly` path that avoids constructing rich display records, profile projection objects and repeated display-window strings that are discarded during summary-only assembly. It must still validate route/agency references, inspect the same profile values, preserve expiry/null-rate behavior and produce identical summaries; regular feature rendering must remain unchanged.

Before claiming benefit: implement that change separately; run existing tests plus explicit full-vs-summary equivalence cases; then perform interleaved same-host baseline/candidate repetitions using the same Node binary, dependencies, frozen inputs, time policy and resource bounds. Require all 117 output hashes and coverage to match before comparing wall/CPU/RSS. No candidate code or performance gain is included in this report.
