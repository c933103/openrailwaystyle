# Atlas A06: partial recovery of server-baseline evidence

**Status: 57 of 83 original planned files recovered; 26 remain unavailable. The original full package did not survive a replaced execution workspace. This is a partial evidence checkpoint.**

The preserved historical measurements report three offline assembly runs with a median **92.91 s wall**, **101.24 CPU-seconds** and **849.5 MiB** wait4-reported peak RSS. All 117 outputs matched the frozen same-run snapshot at measurement time, preserving 2,039 inventory entries, 106 summary feeds and 86 mapped feeds. Node.js 24.19.0 differed from the historical workflow's Node.js 22. No performance improvement is claimed.

## Start here

- [Complete availability ledger](recovery-ledger.json): every original path, byte length, pre-loss SHA-256 and current recovery status
- [Frozen historical report](recovered/report.md): observations, environment limits and the earlier verification results
- [Verified original metrics CSV](recovered/metrics.csv)
- [Preserved CPU-profile summary](recovered/evidence/cpu-profile-summary.json): the original raw CPU profile is missing
- [Original output identities](recovered/evidence/original-output-identity.json)
- [Historical package manifest](recovered/publication-manifest.json): lists the planned full package, including missing files
- [Current partial-payload checksums](partial-manifest.json)

## What survived

The [original 47/83 checkpoint](https://github.com/c933103/openrailwaystyle/tree/3386e0a7294956c2c8b2f709869863b0f3e3b89d/server-a06/2026-10-09) remains preserved in history. It contained 28 files read back from GitHub plus 19 exact-hash reconstructions. Ten more originals are now recovered: eight sanitized shard ZIPs, the sanitization manifest and the run-07 output-identity record. Every restored original matches its pre-loss byte length and SHA-256. [New recovery helpers and provenance](recovery-updates/2026-10-09-exact-derivatives/recovery-receipt.json) are labelled separately and do not count as original helpers or new measurement runs.

## What is missing

The 26 unrecovered originals are 7 metrics JSON files, 12 timed progress/memory logs, 1 raw V8 CPU profile, 5 original measurement/reconstruction helpers and 1 sanitized reference tarball container. The eight sanitized shard archives and their manifest are now available. See the ledger for the exact list. The available CSV and summaries preserve results but do not recreate missing raw measurements.

The frozen report, reconstruction guide and original manifest describe a complete package that existed before workspace replacement. **They must not be read as a claim that every referenced file is present here. The partial snapshot is not a complete runnable reproduction bundle.** Previously recorded test/verification results remain historical observations; missing helpers cannot be rerun from this partial snapshot.

## Safety and remaining work

No original credential-bearing dataset was published. The eight recovered sanitized shard archives are byte-identical to the previously cleared derivatives: potential-access query values are removed and attribution retained. Restored original input ZIPs remain private and are not substituted for these cleared artifacts. Original workflow artifacts and source revisions remain recoverable through their existing services, but any repack must have its actual new identity unless the original hash is reproduced exactly. Known expiring Actions links alone do not establish durable retention.

Current live release exposure remains unverified. No production code, main-branch reference, deployment or provider acquisition is changed by this evidence checkpoint. Missing originals remain open; any future replacement-host measurement must be clearly separated with a new run ID and environment record.

## Clarification preserved alongside the frozen records

The historical reconstruction-verification JSON labels a count of 29 as negative tests. The preserved test log actually records **29 tests total: 27 negative cases and 2 clean success cases**. That field name was inaccurate; the original file is retained unchanged for hash fidelity.
