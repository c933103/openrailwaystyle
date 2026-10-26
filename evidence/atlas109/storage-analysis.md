# Supplemental relation retention and publication-size check

Application source: `88bee49d4c20aa4fbebdd501b503587f2dba7e49`, identical tree in
merged commit `5d729533f5eef9a2e110cc6da1e8809b8b9769a6`.

## Verified bounds

`scripts/service-relations.mjs` retains at most two revision identities, two
contradictory tag variants per identity and eight source samples per variant:
at most 32 source references per supplemental envelope. The allowlist contains
23 keys; each accepted tag string is at most 1,024 UTF-16 code units. One invalid
or oversized selected value withholds that observation's entire projection.
These are per-envelope count/value bounds, not a global compressed-byte budget.
The existing accepted frontier and stage/pending records each carry their own
envelope. Production currently has 16 acquisition stages, plus migration state;
the generic route table itself does not impose a total route/stage byte cap.
Source-reference string lengths are also not separately capped here.

The committed 90-observation regression checks revision/variant/source limits,
reverse order, regrouping and duplicate replay. The additional local command
`node storage-probe.mjs /path/to/checkout` tests the unchanged authentic fixture
with 1,000 repeat observations. Exact duplicates leave the envelope identical;
with only source snapshot/provenance changing, its one variant stops growing
at eight samples and the envelope at observation 1,000 equals observation 8.
Thus unchanged repeated observations do **not** accumulate an indefinite
supplemental snapshot history. The eight entries are deterministic samples,
not a promise to retain every source timestamp or the latest eight.

## Measurements, not a global forecast

The fixture's 115 members and original file bytes remain unchanged. One route
stored as a single accepted stage plus accepted frontier measures:

| Projection | Raw NDJSON bytes | gzip level 9 bytes |
| --- | ---: | ---: |
| Existing core without supplemental | 11,941 | 1,357 |
| One supplemental observation | 13,477 | 1,631 |
| Delta for that observation | +1,536 | +274 |
| Supplemental with eight synthetic source-provenance samples | 19,379 | 2,144 |

The last row uses explicitly synthetic acquisition provenance in the local
probe. Its difference is not solely tag storage. These numbers cannot establish
a global gzip multiplier or guarantee all future service publication sizes.
No global table was rewritten and no provider was queried.

## Current stored artifact and concrete residual risk

Read-only Git metadata at service-data commit
`f9a22be8acea83328572bdfccfe2ee1242338a89` identifies
`service-routes.ndjson.gz`, blob `0073219de57ed33b5f6c5d566ab5f7abdfdb7be5`,
as **87,235,649 stored bytes**. The artifact's producer at
`scripts/build-service-routes.mjs:205` explicitly writes `gzipSync(...,{level:9})`.
This is the stored gzip artifact size, not a measured uncompressed NDJSON size;
the global artifact was not decompressed for this check. Its manifest, generated
2026-10-25T23:20:15.370Z, reports 11,759 retained relations and 274,321 ways;
per-stage retained-relation counts sum to 11,915 (not a count of serialized
frontier/pending objects).

Service publication still copies/pushes that single blob. It has no final-output
size guard or chunking. The repository informally says '100 MB' in
`scripts/build-mainline-snapshot.mjs:88`, and that other pipeline uses 40 MiB
chunks plus a 512 MiB archive budget. Those safeguards do **not** apply
to the service table. Incoming service acquisition limits of 50 MB/run and
100 MB/day limit provider downloads, not retained gzip size.

[GitHub's current official limit](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github),
verified 2026-10-26 at 08:29 UTC, blocks files larger than **100 MiB**
(**104,857,600 bytes**), not decimal 100 MB. The current artifact is unchanged
and below that limit, leaving **17,621,951 bytes** of headroom. This corrects the
earlier repository-only comparison against informal decimal '100 MB'; the
fixture measurements and replay bounds are unchanged. Bounded per-relation
history does not prove that future global output will fit. Additional metadata, route inventory growth or other retained evidence
can eventually exceed the single-blob publication limit. That is a concrete
pre-existing publication-format risk amplified by growth, **not an observed
over-limit output, an excuse to rewrite data now, or a new merge gate**.
A measured future output and separately scoped publication-format guard/chunking
may be needed; neither has been claimed or implemented by this metadata repair.
