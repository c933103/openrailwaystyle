# Share unfinished elevation-profile tiles under cache pressure

Related: #150 (client/upstream resources), #138 (provider failure handling)
and the A04/A05 card in #176. Their broader acceptance remains open.

## Verified defect and bounded correction

Base: `395f8bc749a555e29b399a4a3cf941692f53517a`.
The elevation loader's 64-entry raw and repaired caches contain unfinished
promises. A sufficiently long or overlapping profile evicts a pending tile;
a later sample for that same tile starts another download and repair. The
application creates up to 201 samples with `alongLine`, so the limit can be
exceeded by one profile without repeated user actions.

Controlled fixture results, using the actual loader and profile sampler:

| Input | Base fine-tile loads | Corrected fine-tile loads |
| --- | ---: | ---: |
| 66 samples, 65 distinct tiles | 66 | 65 |
| 201-sample out-and-back profile, 101 distinct z14 tiles | 138 | 101 |

These counts are injected-loader calls with deliberately unsettled responses,
not public-provider HTTP requests or transferred-byte measurements. No external
terrain or railway tile was downloaded. They establish duplicate request
suppression for these interleavings, not production traffic savings, server CPU,
device frame time, general memory improvement or GPU performance.

Keep pending work in separate maps until it settles. Only successful completed
raw/repaired pixels enter their respective 64-entry LRU caches. Completed hits
promote recency; pending entries cannot be evicted into duplicate work. A failed
fine tile remains `null` for its shared readers and a later request can retry.
A failed coarser reference retains the existing usable-fine-tile repair behavior.
The pixel repair/sampling algorithms, profile sample limit, source URLs and
request policy are unchanged. This does not add cancellation, timeouts or a
global concurrency limit to elevation requests.

## Checks and limits

- Temporary source was checked against the base Git tree: all 596 present
  tracked files matched. Omitted historical investigation archives and one
  unrelated logo were not reconstructed or modified.
- Six offline cache regressions: all pass with the correction. The same final
  tests against base fail five cases and pass the failed-reference compatibility
  control. The exact 201-sample path catches 138 versus 101 fine-tile calls.
- Coverage includes overlapping profiles, failures and retry, completed-cache
  eviction/recency, pending z14 repair references, and unmodified raw pixels.
- Existing terrain-repair and elevation tests remain required. Release tests
  also check the new elevation module through the actual service-worker source,
  retaining old tabs and making the new version available offline.
- Asset version `20261017-elevation-pending-cache-1`, shell generation 35.
  The generated application style is unchanged.
- Parent source review found no blocking issue in pending/completed separation;
  that was source inspection, not independent hosted execution.

Exact commands, aggregate results, immutable bulky-evidence links and subsequent
current-head Codex/CI outcomes belong in the PR receipt. Hosted browser checks
remain required before merge. No merge, deployment, public-provider or physical
device acceptance is claimed here.
