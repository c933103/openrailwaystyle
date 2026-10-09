# A06 rich-record-only experiment

## Decision

Keep the candidate unmerged. All correctness gates passed and all four pairs showed lower candidate wall/CPU measurements, but the approximately two-percent paired median difference is small, order-sensitive and observed during concurrent shared-host test activity. It is promising evidence for further controlled measurement, not an established production speedup or justification to merge now. No pair was discarded and no additional source change was made to chase a positive result.

## Bounded change and identities

Fresh main was pinned at `802062b5c44718e6baf3d36db5010ee42799368c`. The candidate changes only `scripts/gtfs-service.mjs`: rich display-record construction and insertion now occur inside the existing non-summary branch. Profile projection, display-window parsing, route/agency checks, mapped-route accounting and expiry/availability logic remain outside that branch and unchanged. Parsing and validation were not bypassed.

The patch SHA-256 is `b5585de1a23d8a3a97e0ed4f866819aeff8b1b3bb5c1d3fefb88399d9828d473`. The candidate is an unmerged patch over the base, not a claimed new main commit. Configurations record both this revision description and full source digests; the `source_commit` field denotes the base revision. The only differing source file was verified before measurement.

All eight runs used the same Node.js 24.19.0 executable, installed dependency tree, frozen sanitized inputs/reference, final identity-enforcing harness and resource bounds from replay cohort `41704fa7`. Source/dependency/runtime/reference fingerprints were checked before and after each run, and all 121 input identities were checked before timing. All 117 output identities and coverage matched exactly afterward. No timestamp fields were stripped or clock overrides introduced.

## Results

Negative changes mean the candidate used less time or memory.

| Pair/order | Control wall s | Candidate wall s | Wall change | CPU change | Peak RSS change |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1: control/candidate | 36.352694 | 34.826090 | −4.199% | −3.428% | +0.346% |
| 2: candidate/control | 35.073217 | 34.822441 | −0.715% | −1.398% | −4.389% |
| 3: control/candidate | 36.595099 | 35.352606 | −3.395% | −2.720% | +6.129% |
| 4: candidate/control | 34.071948 | 33.821727 | −0.734% | −1.717% | −9.628% |

- Median paired change: **−2.065% wall**, **−2.219% CPU**, **−2.022% peak RSS**.
- Median paired absolute change: −0.7466 s wall, −0.9492 CPU-seconds and −11,834 KiB peak RSS.
- Control wall range: 34.0719–36.5951 s; candidate: 33.8217–35.3526 s. The raw between-run spread is larger than the smaller paired effects.
- Control CPU range: 41.6294–43.5106 CPU-s; candidate: 40.7258–42.3271 CPU-s.
- Candidate wall/CPU were lower in 4/4 pairs. Peak RSS was lower in 2/4 and higher in 2/4, spanning −9.63% to +6.13%; no reliable memory reduction is claimed.
- Separate group medians, which are not the median paired effect: control/candidate wall 35.7130/34.8243 s, total CPU 42.2988/41.3738 CPU-s and peak RSS 596,396/583,036 KiB.

## Order, contention and limitations

The pre-recorded order was AB/BA/AB/BA and did not change. Control-first pairs had median wall change −3.797% and CPU change −3.074%; candidate-first pairs had −0.725% wall and −1.558% CPU. Candidate-first wall savings were 0.2508 and 0.2502 seconds, approximately one completion-poll interval. That does not prove the savings were caused by polling, but it limits how confidently such small wall differences can be interpreted.

Other local tests were running concurrently on this shared host. Sampled one-minute load ranged from about 1.18 to 2.70. Per-run available-memory and load samples are retained; they cannot isolate background interference or make the host exclusive. A load average is not a direct CPU-utilization measure. No post hoc correction or selective exclusion was applied.

Each run used fresh source/input copies and a fresh process, but copies and identity checks warmed filesystem caches. These were not cold-cache measurements. The common bounds were 1,536 MiB Node old-space, 2,048 MiB sampled RSS guard, 300 s wall, 300/305 CPU seconds and 256 MiB per output file. Monotonic wall completion was polled every 250 ms; `wait4` supplied CPU and peak RSS. Preparation and final hashing were excluded.

Four non-independent shared-host pairs are insufficient for a population confidence claim. The result is not compared with the old Intel host's baseline or with the later-discovered Node.js 22 binary. The measured runtime stayed Node.js 24.19.0 throughout. Original recovery remains 57/83; these eight new executions do not restore missing originals.

## Correctness and checks

- All eight runs: 117 exact sanitized output files, 2,039 inventory entries, 106 compiled/summary feeds, 86 mapped feeds, 66 countries, zero tiles.
- Thirty-two new equivalence/error cases passed: normal feature rendering and summary output, null/zero/missing rates, missing/short geometry, duplicate segments, feed/route/segment/review expiry, boundary equality and unchanged route/agency/profile/window errors for compiled-JSON-style inputs.
- Thirty-seven focused existing source tests passed for both control and candidate, including timetable, streaming reader, assembly, service-route and frequency behavior.
- Source, dependency, runtime, reference and input fingerprints were enforced for every measured run; all raw logs, samples and identities are retained.

The next useful measurement would be a separately labelled rerun in a quieter, better-controlled window with balanced treatment order and a finer wall-completion method applied equally to both variants. Preserve this result unchanged. Do not merge this optimization or claim a general gain on these observations alone.
