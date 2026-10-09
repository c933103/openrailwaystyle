# Atlas A06: new offline replay cohort, 2026-10-09a

**This is new replacement-host evidence. Original recovery remains 57/83 files, with 26 missing; this cohort does not recover those lost measurements or complete that historical package.**

Three sequential uninstrumented repetitions produced a median **34.07 s wall**, **40.73 CPU-seconds**, and **559.7 MiB peak RSS**. Every run matched all **117** equivalently sanitized reference files byte-for-byte, including the time-sensitive manifest fields. Coverage remained **2,039 inventory entries, 106 compiled/summary feeds, 86 mapped feeds, 66 countries and zero tiles**.

The new timings are **not an optimization or speedup claim** against the earlier host's 92.91 s median. The host CPU, available memory/load, Node memory bound and cache conditions differ. No assembly optimization was implemented.

## Evidence

- [Report](report.md): method, results, limitations and a bounded next experiment
- [Structured summary](analysis/summary.json) and [all-run CSV](analysis/metrics.csv)
- [Raw per-run metrics, stdout, progress/memory samples and output identities](runs/)
- [Raw V8 CPU profile](runs/historical-profile/assembly.cpuprofile) and [sample-weighted analysis](analysis/cpu-profile-summary.json)
- [Environment](environment.json), [storage](storage.json), [historical source hashes](source-file-hashes.json), [dependency verification](dependency-verification.json)
- [Current-code compatibility](current-source-comparison.json)
- [Reconstruction and replay instructions](REPRODUCE.md)
- [New replay manifest](replay-manifest.json) and [new three-file reference metadata pack](reference-metadata-v1.tar.gz)
- [Extraction tests](reconstruction-tests.log), [source tests](source-tests.log), [harness controls](harness-tests.log)
- [Executed-version provenance receipts](executed-provenance-verification.json)

The eight sanitized input ZIPs are reused from the [durable original-recovery checkpoint](https://github.com/c933103/openrailwaystyle/tree/59b739934d629859cb42a3ff2861d5fbb3d01abd/server-a06/2026-10-09/recovered/sanitized-retention). No original access-bearing archive or redundant output tree is added here. Input attribution is retained; metadata URLs must not be exercised. The new reference pack's hash is distinct from the missing original tarball.

The existing [original completeness ledger](../2026-10-09/recovery-ledger.json) remains unchanged. A future paired experiment should use the same host, runtime, frozen inputs, reference time policy and bounds, and verify identical outputs before interpreting a performance difference.
