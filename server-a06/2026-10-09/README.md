# Atlas A06: partial recovery of server-baseline evidence

**Status: 47 of 83 original planned files recovered; 36 remain unavailable. The original full package did not survive a replaced execution workspace. This is a partial evidence checkpoint.**

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

Twenty-eight files were read back from content-addressed GitHub blobs and checked against their pre-loss SHA-256 values. Another nineteen were restored through verified identical content, known zero-byte identities or deterministic reconstruction that matched the exact original hash. These include the original CSV, package manifest, output identities and all six stdout logs. No replacement-host workload measurement was substituted.

## What is missing

The unrecovered files include the original raw timing/progress samples, raw V8 CPU profile, complete metrics JSON/per-run metrics, reconstruction/measurement helpers, the sanitized fixture archives and their manifest. See the ledger for the exact list. The available CSV and summaries preserve results but do not recreate the missing raw measurements.

The frozen report, reconstruction guide and original manifest describe a complete package that existed before workspace replacement. **They must not be read as a claim that every referenced file is present here. The partial snapshot is not a complete runnable reproduction bundle.** Previously recorded test/verification results remain historical observations; missing helpers cannot be rerun from this partial snapshot.

## Safety and remaining work

No original credential-bearing dataset was published. The proposed safe fixtures had deliberately removed potential-access query values and retained attribution; their lost archives are not replaced by the unredacted inputs. Original workflow artifacts and source revisions remain recoverable through their existing services, but any repack must have its actual new identity unless the original hash is reproduced exactly. Known expiring Actions links alone do not establish durable retention.

Current live release exposure remains unverified. No production code, main-branch reference, deployment or provider acquisition is changed by this evidence checkpoint. Missing originals remain open; any future replacement-host measurement must be clearly separated with a new run ID and environment record.

## Clarification preserved alongside the frozen records

The historical reconstruction-verification JSON labels a count of 29 as negative tests. The preserved test log actually records **29 tests total: 27 negative cases and 2 clean success cases**. That field name was inaccurate; the original file is retained unchanged for hash fidelity.
