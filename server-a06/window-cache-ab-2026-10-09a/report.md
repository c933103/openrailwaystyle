# A06: lazy feed-window cache, independent Node 22 paired experiment

## Result and decision

Caching the stable feed-level window string once per feed reduced measured wall time and CPU in all four balanced pairs on this host. The median paired reduction was **9.66% wall time** and **7.23% CPU**, with all 117 expected raw outputs identical in every run. This is a useful measured candidate for code review. It remains an unmerged evidence patch; it is not a production capacity or general speedup guarantee. Peak memory was mixed, so no memory improvement is established.

The earlier rich-record-only patch remains separate and held unmerged. These results do not rehabilitate that inconclusive experiment and are not pooled with it, the older Node 24 cohort or the original host.

## Frozen scope and correctness

- Cohort `window-cache-ab-20261009a`, Node.js **22.23.3**, exact binary SHA256 `fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48`.
- Both variants retain comparison base `802062b5c44718e6baf3d36db5010ee42799368c`, verified as main at 06:08:33 UTC. Before timing, main advanced to `cce34eb12a31ebd3259bfa6bec308952c71da8c6` through preview-server changes in docs/server/tests. The frozen cohort explicitly retains the earlier base rather than claiming the later source was measured.
- The only executed-source difference is `scripts/gtfs-service.mjs`: declare one per-feed undefined cache and replace repeated window-string construction with lazy nullish assignment at the original position. Patch SHA256 `d554d7b987e05e676e30635fe70f905e652746f559cf0c0e1b2ca3345e93568b`. The rich display-record construction remains unchanged.
- Input scope: immutable parsed-JSON feed objects. Route/agency checks and segment-profile projection still happen before first evaluation. Empty/all-unmapped feeds do not evaluate malformed windows; valid empty strings remain cached; each feed gets a new cache. Error order, profiles, validation and expiry are preserved. Getters and mutating iterables are outside the stated input contract.
- 38 equivalence/error cases pass. Focused existing source tests pass 37/37 for each variant. Two prior, untimed full-data correctness executions match 117/117 outputs per side; their raw logs and identity receipts are kept separately and are not performance samples.
- Each timed run freshly copies and verifies all 121 frozen sanitized inputs, checks source/dependencies/runtime/reference identities before launch and source provenance afterward, and compares all 117 raw outputs without removing fields. All eight gates pass. Coverage remains 2,039 inventory entries, 106 compiled summary feeds, 86 mapped feeds, 66 countries, zero tiles, 664,872 available segments and 1,045 routes with profiles.
- The frozen reference contains 1,220 excluded, 635 no-rail and 78 failed catalogue entries. Those inherited statuses are preserved, not new acquisition failures from these offline runs.

## Measurements

The fixed order was control/candidate, candidate/control, control/candidate, candidate/control. No pairs were dropped or added.

| Pair | Order | Control wall s | Candidate wall s | Wall change | CPU change | Peak RSS change |
|---|---|---:|---:|---:|---:|---:|
| 1 | AB | 37.483 | 33.385 | −10.93% | −7.11% | +3.60% |
| 2 | BA | 36.416 | 32.820 | −9.87% | −9.04% | −5.87% |
| 3 | AB | 36.448 | 33.807 | −7.25% | −5.11% | −11.46% |
| 4 | BA | 36.435 | 32.994 | −9.44% | −7.36% | +12.20% |

- Wall medians: control **36.441 s**, candidate **33.190 s**. The median of paired percentage changes is **−9.66%**, range −10.93% to −7.25%; median paired absolute change is −3.518 s. A ratio of the two group medians is a different statistic and is not substituted for the paired result.
- Total CPU medians: control **44.728 CPU-s**, candidate **41.691 CPU-s**. Median paired change **−7.23%**, range −9.04% to −5.11%; median paired absolute change −3.250 CPU-s.
- Peak RSS medians: control **451,598 KiB**, candidate **455,456 KiB**. Two pairs improve and two worsen; paired range −11.46% to +12.20%. The median paired percentage happens to be −1.14%, while the group median is higher for the candidate. Neither supports a memory benefit claim.
- Order check: mean wall change is −9.09% for AB and −9.66% for BA. Mean CPU change is −6.11% AB and −8.20% BA. Both directions support the time/CPU result, although only two pairs occur in each order.

Exact values, user/system CPU, raw progress/memory/load samples and per-run input/output identities are in [runs](runs/) and [analysis](analysis/summary.json). These are descriptive four-pair observations, not independent population samples or a confidence interval.

## Timing method and limits

The common harness starts a monotonic wall interval immediately before launching the bounded Node child. Its main thread blocks in `os.wait4(pid, 0)` and captures wall completion immediately after return, before output hashing or thread joins. A separate 250 ms sampler records memory/load and enforces guards; it never reaps or determines completion. Scheduler wakeup latency remains possible, but the former 250 ms completion-polling quantization is removed equally for both variants. CPU and peak RSS come from `wait4` child usage; Python sampling overhead is not counted as child CPU but shares the host.

Limits are unchanged: 1,536 MiB Node heap; 2,048 MiB RSS guard; 300 s wall; 300/305 s soft/hard CPU; 256 MiB per output file; core dumps disabled. Every non-null termination reason rejects the run, even if a signal handler exits zero. After direct-child reaping, unexpected remaining members of the owned process group are killed and flagged before any next run. Eleven normal and optimized-Python supervisor controls cover these cases, raw byte capture, interruption/reaping and a descendant retaining stdout. Eight identity-helper controls and seven analysis controls pass under both normal and optimized Python.

All eight actual runs exited zero, with null termination reasons and no capture/cleanup errors. A preventive recheck also found null guard reasons and successful gates in all eight already-published rich-record runs; their historical measurements remain unchanged.

## Environment and contention

Measured interval: **2026-10-09 06:19:09.858–06:24:00.180 UTC**, inside the coordinated 06:19–06:26 deferral window. Known local testing workers were asked to defer heavy tests, and coordinating work avoided heavy local tests. This does not establish exclusive access: remote CI/browser research could continue, unrelated background activity was not controlled, and worker acknowledgments are recorded separately in [measurement conditions](measurement-conditions.json).

The same shared host reports AMD EPYC 9V74, nine affinity CPUs, 10,206,508 KiB total memory and no swap. Cgroup limit files inspected were absent, so no stronger quota claim is made. Across 1,120 monitor samples, one-minute load ranged **0.0615–1.4829** and available memory **7,728,660–8,142,324 KiB**. All inputs were local. Fresh file copies, dependency/source/input hashing and prior correctness checks warm caches; these are not cold-cache runs. Optional per-process I/O counters remain unavailable and were not retried through another source.

The cached Node 22.23.3 binary was copied locally and hash-verified; no runtime download occurred. Historical CI used major Node 22, but its exact minor/build is not established here. The older Node 24 timing cohort remains valid as its own runtime-labelled evidence, not a comparator for runtime improvement.

`Date.now()` is unmodified. Exact raw output identity at the observed time is required; no generated timestamps or expiry-dependent fields were stripped. All 117 files, totaling 41,772,459 logical bytes per run, match the frozen sanitized reference.

## Retention and next action

Retain the patch, frozen plan, helper/test sources, raw metrics/logs, identities, analysis and safety/hash manifests. Reuse the already-durable sanitized shard inputs and reconstructed reference pack without duplicating working input/output trees, runtime binaries or dependencies. The original recovery remains **57/83, with 26 originals missing**; this new cohort does not replace or recover them.

Proceed to a separately reviewed code change only after deciding its CI/data-access boundary. The pinned repository's ordinary PR trigger for `scripts/gtfs-service.mjs` starts `service-frequency.yml`, including catalogue/provider acquisition; merely opening a normal code PR would therefore introduce external traffic beyond this offline experiment. Publishing this evidence branch does not merge the patch, change main, deploy, or request a provider workflow rerun. Fresh-read current workflows before any subsequent code PR. Preserve the richer validation path and avoid combining this small cache change with the earlier rich-record patch or a parser rewrite.
