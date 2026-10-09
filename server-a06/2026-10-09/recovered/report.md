# Atlas A06: frozen-input offline server assembly baseline

Measured 2026-10-09 UTC. This establishes a reproducible baseline and a next experiment; no optimization was applied and no performance improvement is claimed.

## Result

Three fresh-copy replays of the historical assembly completed successfully. Median wall time was **92.91 seconds**, median total CPU time **101.24 CPU-seconds**, and median wait4-reported peak RSS **849.5 MiB**. Every replay produced **all 117 reference files byte-for-byte**, without normalization or replacing generated results with reference files. The additional instrumented diagnostic also matched all 117 files.

| Run | Wall s | User CPU s | System CPU s | Total CPU s | Peak RSS KiB | Peak RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 86.274 | 85.362 | 7.566 | 92.928 | 869,852 | 849.5 |
| 2 | 94.043 | 95.417 | 7.746 | 103.163 | 871,828 | 851.4 |
| 3 | 92.914 | 94.470 | 6.769 | 101.240 | 826,956 | 807.6 |

All baseline exit codes were 0. Wall range: 86.27–94.04 s; peak-RSS range: 807.6–851.4 MiB. Three repetitions are a small sample, not a capacity estimate or statistical performance guarantee.

## Exact workload and provenance

- Repository: [c933103/openrailwaystyle](https://github.com/c933103/openrailwaystyle)
- Historical source: [6f43c9f9ca998ea5b3081655b6a43bb29ae51713](https://github.com/c933103/openrailwaystyle/tree/6f43c9f9ca998ea5b3081655b6a43bb29ae51713)
- Frozen workflow: [37732419672](https://github.com/c933103/openrailwaystyle/actions/runs/37732419672)
- Exact workflow assembly command: `node --max-old-space-size=5500 scripts/assemble-global-frequency.mjs frequency-output`
- Eight original shard ZIPs: **23,644,310 bytes**; merged input: **121 files / 38,350,621 bytes**.
- Eight schema-2 inventories: 2,039 catalogue entries, service date **2026-10-12**, catalogue SHA-256 `106dfacfd4b8b7db7682f09f2506011cd40868e989241c8f3405bdbfdc99096e`.
- 106 compiled feeds, 5,132 logged rail services/routes, **2,164,308,370 inflated JSON bytes**. Gzip footer totals agree with the earlier full-inflation validation.
- Seven stale feed files are genuine frozen inputs. The historical assembler removes them; they were restored for every fresh-copy repeat.
- During measurement, no provider/catalogue/GTFS/ORM reacquisition, workflow rerun/dispatch, production change, deployment, release update or publication was performed. Subsequent publication of this cleared evidence snapshot is a separate step and does not change production data or code.

The source export contains the complete transitive runtime closure and relevant workflow/docs/tests, not a full historical Git checkout. All 18 exported source/reference files match the historical Git blob SHA-1s; SHA-256 values are also recorded. The historical tree contains no AGENTS.md or .agents instructions. Existing installed dependencies were copied independently: 81 installed package version/integrity metadata records match the historical lockfile. Installed dependency bytes were not redownloaded and compared to registry tarballs. Existing checkout files were read only and remain clean at their original commit `2d708cca35b29f50a2ca776a664c8770cffc1d35`; no other checkout was modified.

## Coverage and output identity

Every measured output preserves:

- 2,039 inventory entries: **1,220 excluded; 635 no_rail; 106 compiled; 78 failed**
- **106 summary feeds; 86 mapped feeds; 66 countries; 0 tiles**
- All 106 retained feed byte hashes and all eight shard-inventory byte hashes
- `manifest.json`: **2,537,952 bytes**, SHA-256 `cfa237aafcd64a0c68e352dd13cef3ed9f078f5dbdca8c59c23e2e9a98a2b38b`
- `inventory.json`: **4,509,525 bytes**, SHA-256 `2a9f3a7a085be10d335693a23ae0523de26d379d83360e4aeb611580ee960185`
- `tiles/index.json`: **12 bytes**, SHA-256 `7d8f1de8b7de7bc21dfb546a1d0c51bf31f16eee5fad49dbceae1e76da38e5c3`

Output storage is **117 files / 41,773,734 bytes**, a net increase of **3,423,113 bytes**. The seven removed stale feeds total 3,624,376 bytes; the three generated files total 7,047,489 bytes. File-content sizes are distinct from allocated filesystem blocks, which are also recorded in raw metrics.

The matching snapshot ZIP is artifact **11531261635**, 21,041,294 bytes, SHA-256 `a15bb59efae3c4f7b039471e31b764d964473664b1ecc00acf1bee408869b312`. Its CRC and all 117 extracted hashes were rechecked locally. Each of the eight input ZIPs was also rechecked against GitHub's SHA-256, ZIP CRC and every merged-file payload. Original inputs remain unchanged after all runs.

The summary code uses `Date.now()` for availability/expiry. No timestamp fields were stripped and the clock was not frozen: the raw generated results happened to match the historical snapshot exactly at these replay times. Later dates can legitimately change availability fields. A future semantic comparison must show any such raw differences explicitly. **This frozen run has 86 mapped feeds, not the later release's 88.**

## Environment and measurement limits

- Linux 6.18.44 x86-64; Intel Xeon Platinum 8573C exposed by `/proc/cpuinfo`
- 9 visible/affinity CPUs, affinity 0–8; host MemTotal 10,206,504 KiB (~9.73 GiB); no swap
- **Node.js 24.19.0 / V8 13.6.233.17-node.51**. Historical workflow requested **Node.js 22**. This is a historical-source/data replay on a different Node major, not a faithful GitHub-runner hardware/runtime reproduction.
- Overlay filesystem; approximately 27 GB available at preflight. No filesystem or network-security changes were made.
- Cgroup hierarchy reports `0::/`, but cpu.max, memory.max, memory.current/peak/events, cpuset and pids.max files are not exposed. Actual cgroup quotas/limits therefore remain unknown. Visible CPUs/RAM are not an assurance of dedicated capacity.
- Shared executor, uncontrolled background work, no CPU pinning/exclusivity. Observed conditions:
- Run 1: observed 1-minute load 1.33–2.77; minimum host MemAvailable 5.75 GiB.
- Run 2: observed 1-minute load 2.41–3.23; minimum host MemAvailable 5.90 GiB.
- Run 3: observed 1-minute load 1.64–2.41; minimum host MemAvailable 5.84 GiB.
- Every repeat uses a new Node process, a complete copied source closure, and a fresh input directory. Files were already read for integrity checks, and OS caches were not flushed: **warm/uncontrolled filesystem cache**, not cold I/O. There is no warmed V8 process shared between repeats.
- Linux `os.wait4` supplies per-child user/system CPU and reported peak RSS. `/usr/bin/time` is unavailable. Proc status samples every 0.2 s supplement memory/load observations; `/proc` samples and wait4 RSS can differ slightly, and neither is a cgroup memory peak.
- Child `/proc/<pid>/io` access was denied. Those optional byte-I/O counters are unavailable and were not retried or obtained through an alternative route. Raw wait4 block-operation fields are kernel resource-accounting outputs, not byte-I/O measurements.
- Timed wall duration covers Node launch through observed exit; polling adds up to roughly 0.2 s of completion-detection delay. Copying, hashing, tests and reference comparison are outside the timed interval. Monitoring/tee overhead and uncontrolled host scheduling remain limitations.
- Each run was bounded to 900 s wall, CPU soft/hard limits 600/630 s, a sampled 7 GiB RSS guard, a 768 MiB host-available-memory guard, and Node's exact historical 5,500 MiB old-space setting. No bound triggered; each clean child was reaped before the next run.

An initial invalid harness launch is excluded completely. Optional child-I/O access raised PermissionError; stdout/stderr were empty and the exec returned terminal exit 1. Review also caught a source-entry symlink that would bypass the script's main-entry guard. Clean runs use copied source files and record all 106 feed-completion lines. The invalid attempt is retained separately and is not called a workload result. Separate tool executions have isolated PID views, so no independent cross-namespace inspection of the invalid child's lifecycle is claimed.

## Diagnostic finding and bounded next experiment

A separate fourth replay enabled V8 `--cpu-prof` at a 1,000 µs sampling interval. It took **86.90 s wall**, **102.07 CPU-seconds**, and **886.4 MiB** reported peak RSS. Its timing is excluded from baseline aggregates; the different numbers are not a speedup.

Of 86.64 s of main-thread sampled-time weights (68,002 samples):

- **57.11%** falls within the feed-reader/parsing call tree; `parseFrequencyFeed` self time is 31.60%, and its `item` helper 24.72%
- **20.38%** falls within `timetableFeatures`
- 4.28% garbage collection; 8.34% idle; 9.89% other work

These are sampled main-thread elapsed-time weights, not exact OS CPU shares. Native/background gzip work is incompletely represented. They support a parsing/summary CPU hotspot hypothesis and do not establish production network, catalogue-import or server-concurrency bottlenecks.

Recommended first bounded experiment: add a `summaryOnly` fast path inside `timetableFeatures` that preserves route/agency validation, mapped-route sets, availability/expiry semantics, profile null handling and the exact summary shape while avoiding unused record/property/window-string construction. This targets an observed ~20% sampled region with a smaller correctness surface than changing the streaming parser. Keep the full non-summary path unchanged, expand focused tests for edge cases, then compare baseline/candidate in interleaved fresh-copy replays under the same Node version and fixed reference time for expiry-sensitive comparisons. Require all 117 output files and all coverage counts to match and report CPU/RSS/wall tradeoffs. This patch is proposed only, not implemented.

If that experiment succeeds and parsing still dominates, evaluate streaming summary accumulation or parser allocation reduction as a separate change, with the existing malformed-JSON, Unicode, chunk-boundary and source-verification safeguards intact. Do not replace the parser with whole-feed JSON strings merely because that looks simpler; the bounded reader was designed to avoid national-feed string-size failures. Avoid parallel feed loading as the first change because it can multiply memory use.

## Checks completed

- 3 streamed-reader tests passed
- 3 focused inventory/pruning/large-feed assembly tests passed
- 3 uninstrumented real-input assemblies and 1 CPU-profile real-input assembly completed, all byte-identical to the reference
- All original archive payloads, all input hashes, all snapshot hashes and source blob hashes verified
- Minimal-retention reconstruction independently recreates all 117 reference files and hashes
- Full application/browser/build suites were not run; no application code was changed

## Publication and durable reproducibility proposal

Publish this report, cleared raw measurement evidence and structured metrics under a dedicated evidence path associated with [issue #150](https://github.com/c933103/openrailwaystyle/issues/150), on the existing evidence branch. No remote branch/comment/upload occurred during measurement. Subsequent evidence publication is recorded by the evidence-branch commit and issue #150 links.

The historical code commit and lockfile are already GitHub-addressable. The frozen data is currently verified only in Actions artifacts, which **expire on 2026-10-22 between 05:37:52 and 05:53:23 UTC**. Those links alone are not long-term reproducibility. The current `service-frequency-data` release is a later mutable snapshot: its manifest SHA-256 `caa617b79006282d2a2b77d299a34b90d94fa3ba24a88c637ab1e58fe3d4f526` and inventory SHA-256 `fb85f751a2ec6acdf1959baaa2f39b74ad9ba615f1a1a3cd58ed48e7fc686395` differ. It cannot stand in for these frozen reference bytes. No other durable GitHub copy of these exact data inputs was verified.

Safety review found possible access/authentication query values in inherited source metadata. The original shards and original metadata pack are **not cleared for public retention** and remain local, unchanged. Existing availability in a source catalogue or older output does not establish permission to republish them. The precise original archive and file hashes remain in safe provenance manifests.

For durable offline reproduction, a separately labelled derived fixture set removes nonempty access-like query values while preserving query names, all other URL bytes, attribution, licences and timetable content. This set is **not byte-identical to the original inputs**. The transformation changes eight input files: seven shard inventories and one compiled feed's source metadata, with 23 query-value occurrences removed. Timetable arrays, routes, agencies, geometry and profiles are unchanged. Only the modified gzip member is recompressed; original files are never overwritten. The eight sanitized shard archives retain the original member sets, and the matching sanitized reference pack contains the three exact equivalently transformed generated files. Original and derivative hashes, sizes and the exact transformation are recorded in `sanitization-manifest.json`.

Publish only the cleared report/metrics/logs/profile/hash manifests and the explicitly sanitized derivative set after its verification. Do not upload any original archive/reference metadata pack, all working directories, duplicate retained feeds or node_modules. Source code remains pinned to its GitHub commit. Safe baseline publication does not mean the original raw dataset has durable public retention. Pin evidence links to the final publication commit and verify remote bytes before claiming publication.

See `publication-manifest.json` for payload hashes and proposed repository paths. Publication status and verified commit links are recorded in issue #150; measurement results do not depend on publication timing.

## Current-main compatibility check

Fresh main is `906cdaef46dec857f6c813966f7f0f88195673ad` (PR #155 merged), not the earlier `51cd5b2`. Assembly, streaming reader, timetable summarizer, workflow and focused tests retain the historical blobs. The imported service-routes module now includes relation/geometry provenance modules; the package files add pinned browser packages. The exported current runtime closure and all consumed existing dependency versions/integrity metadata were verified. Added browser-only packages are not required or installed for this assembly closure.

A separate current-code original-input correctness replay (run 05) passed all 117 raw-reference byte checks with identical coverage. Its single-run timing is excluded from the historical baseline aggregates and is not evidence of a speedup. No optimization has been applied; the proposed small summary-only experiment must follow baseline publication and independent review.

## Sanitized derivative verification

The final derivative fixture replay (run 07) succeeded with **117/117 byte-identical files against the equivalently sanitized reference**, preserving 2,039 inventory entries, 106 summary feeds, 86 mapped feeds, 66 countries and the original status totals. This does not make the derivative files byte-identical to the original inputs or original expected output. Its measurements are separate and are not pooled into the original baseline. An earlier derivative trial (run 06) predates conservative uid removal and is excluded from the proposed publication.

The final metadata audit covers URL user-info, credential/authentication/header fields, signed-URL parameter patterns and unresolved opaque access parameters. No nonempty flagged query values, URL user-info or unresolved credential/header fields remain in the published derivative metadata. The `input_signature` field is retained as a compiler content/cache SHA-256, verified against historical compiler source and 64-hex value shape; it is not an authentication signature. Full-package scanning and clean archive reconstruction results accompany the publication manifest. Current live release exposure remains unverified.

## Reconstruction-helper hardening

Before publication, reconstruction path/hash/size checks were changed to explicit exceptions that remain active under optimized Python. The helper authenticates the reference tar before extraction and rejects unsafe manifest read paths, symlinks, duplicate/unexpected members and inconsistent sizes before any output write. The accompanying negative tests cover both normal and optimized Python, and the unchanged retained artifacts reconstruct cleanly. Supplied analysis now reads raw/ directly without moving files and preserves published metrics.
