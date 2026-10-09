# Offline timetable identity evidence and matching contract

[Service frequency](service-frequency.md) · [#111](https://github.com/c933103/openrailwaystyle/issues/111) · [#109](https://github.com/c933103/openrailwaystyle/issues/109) · [#112](https://github.com/c933103/openrailwaystyle/issues/112)

## Implemented boundary

This is an **opt-in, offline prerequisite**, not worldwide timetable application.
The compiler can retain a bounded identity sidecar. A separate pure contract can
check supplied, reviewed identity assertions against that sidecar and an exact
OSM snapshot. No production registry, acquisition query, publication path,
geometry builder, frequency aggregator or renderer enables or calls the matcher.
Current compiled schema 1 fields and their values remain unchanged. Without the
explicit option, `matching_evidence` is absent. With it, that field is additive;
existing `segments`, geometry endpoints, `stops`, profiles, source metadata and
route consolidation retain their previous meanings. The existing feed parser can
read the additional object, but the current production workflow does not request
it or publish it. A registry/configuration field cannot enable capture.

The current map therefore still publishes **zero standalone timetable tiles**.
Geometry-bearing feed counts are not OSM-match counts. This increment does not
resolve the Ōji availability contradiction or establish a general service
classifier. #109, #111 and #112 remain open.

## Capture an already-held GTFS fixture

```sh
python3 scripts/gtfs-frequency.py held-fixture.zip \
  --config held-fixture-config.json --date 2026-10-05 \
  --geometry --matching-evidence --out /tmp/compiled-review.json
```

Use already authorized local data. The command makes no network request. The
flag does not authorize downloading, exposing or publishing a provider feed.
Do not add raw ZIPs or real captured sidecars to source control without the
existing attribution, access and publication review. Keep credentials, acquisition
URLs and other unnecessary private metadata out of matching assertions. Source
identity uses the configured feed ID and exact ZIP SHA-256, not a public URL.

### Sidecar schema 1

- `status`: `captured` or `incomplete`; bounded machine-readable `reasons`.
  `captured` means retained evidence, **not a verified OSM match**.
- `source`: feed ID, exact ZIP SHA-256, reference service date and compiled
  service-validity boundary. The outer compiled source keeps full existing
  provenance and attribution, including when capture is incomplete.
- `patterns`: content-hashed records scoped to the feed and ZIP revision,
  original source route ID, separately labelled consolidated route ID, agency ID,
  route ref, original direction and shape ID, and ordered calls. Each call keeps
  the original platform/stop ID, parent-station ID and pickup/drop-off flags.
  Branches, short workings, express patterns, loops and directions are not reduced
  to an unordered station set or to the display route's combined frequency.
- `observations`: distinct source-trip identities, service/calendar ID, pattern
  link, timezone, validity, current/future/expired state, applicable service dates,
  ordered departure offsets and unexpanded frequency intervals with `exact_times`.
  Blank time remains `null`; a departure beyond 24:00 retains the full offset.
  Each complete observation also has a content fingerprint binding its pattern,
  calendar state and validity to the exact feed revision and reference date.
  The matcher validates the bounded observation schema and this binding before
  using current-service evidence. Hashes guarantee consistency, not independent
  proof of source truth or a signature from the provider.
- `stops`: deduplicated actually referenced stops/platforms and parents, with
  names and coordinates as source evidence. Names/coordinates do not establish
  station equality. This is separate from the old segment `stops` field, which
  represents geometry endpoints in a shape build.

The original route association is saved before canonical route consolidation.
Identical simultaneous trips with different `trip_id` remain separate
observations. An observation ID is feed/revision/trip scoped; it identifies a
source template, not a globally deduplicated real train. Later occurrence identity
must include the service day and frequency-instance origin. Equal IDs in other
feeds, identical departure times or identical shapes are insufficient to merge
observations. Cross-source duplicate-service reconciliation is not implemented.

The evidence is reference-date-specific. Applicable service dates and timezone
preserve the compiler's existing GTFS noon-minus-twelve-hours anchor, midnight and
DST handling; the collector neither recomputes rates nor introduces a second
calendar implementation. Missing departure evidence remains distinct from a
valid calendar exception that yields zero. Existing 28-profile results are
unchanged, including unknowns and real zeros.

### Resource bounds

Limits are checked independently of the existing GTFS expanded-byte, table-row
and per-trip-row budgets:

- 16 MiB serialized sidecar, including its envelope
- 10,000 original routes, 10,000 patterns, 100,000 source observations
- 50,000 retained stop/platform/parent records
- 512 calls per pattern; 128 frequency intervals per observation
- 367 candidate service days; 1,024 UTF-8 bytes per retained string
- Feed-wide source-ID audit per table: 100,000 IDs and 4 MiB of ID bytes,
  checked before rail filtering. Hitting this audit cap withholds evidence only.

Exceeding a limit or finding incomplete identity evidence discards **all** partial
sidecar arrays and records `incomplete`. It does not silently truncate a pattern,
assert zero service, accept a partial matching inventory or fail a previously
valid legacy compile. Duplicate route/trip/stop/agency/calendar IDs are likewise
incomplete, including rail/bus collisions in either source-row order. Once an
audit is incomplete, its state is released and the legacy filtered compile
continues unchanged. These bounds deliberately withhold very large/complex feeds until an
appropriate partitioned evidence format is designed. They do not claim that such
feeds have no railway service. Collector memory is bounded by record and byte
caps plus one bounded record; it reuses the compiler's already retained input
rather than retaining another whole GTFS dataset.

## OSM and matching inputs

`captureOsmServiceEvidence(relation, snapshot)` is a pure helper for original,
complete relation declarations. It retains the revision, source snapshot,
identity/GTFS tags, ordered stop/platform members and track-member references,
with a separate content fingerprint. It performs no acquisition, changes no
existing `service-relations.mjs` reconciliation fingerprint, and does not infer
station parents or feed identity from a bare GTFS route tag. Existing production
OSM extraction does not yet call it or acquire the necessary station crosswalks.

`matchTimetablePattern` accepts:

1. One captured timetable sidecar and exact pattern ID.
2. Explicit feed ID, source SHA-256, reference date, OSM snapshot, review expiry,
   current epoch seconds, and an assertion that the supplied candidate inventory
   is complete for this pattern. Unknown/partial search coverage fails closed.
3. Reviewed service candidates with independently established eligibility,
   captured OSM declaration, positively eligible way IDs, and reviewed variants.
   Each variant describes one direction, ordered OSM served-station sequence and
   its exact section-way IDs. The section must belong both to the declaration
   and the positively eligible set. The contract does not invent sections.
4. Reviewed, feed/revision/snapshot-scoped station crosswalks. Every actually
   served GTFS call must have one consistent verified OSM station identity.
5. Either a reviewed feed/revision-scoped source-route binding, or a reviewed
   agency/operator binding with the exact route ref and verified served pattern.

The `verified` and `eligible` fields are assertions supplied by a future audited
reconciliation pipeline or controlled test fixture. **This function checks their
consistency; it does not independently establish their real-world truth.** A
caller cannot substitute an unreviewed label comparison for those prerequisites.
In particular, OSM `gtfs:route_id` alone carries no feed context, and neither a
network name, a repeated line ref nor geometric proximity is a verified binding.

The contract requires explicit direction IDs for this initial increment. Missing
directions and conditional pickup/drop-off calls remain missing evidence. Calls
with both pickup and drop-off prohibited do not count as served-stop proof.
Stop order and repetitions matter. A whole-route pattern, a branch, an express
pattern and a short working need their own reviewed variants. This strict first
contract does not yet implement general many-to-many service reconciliation.

The candidate search is bounded to 256 candidates, 1,024 crosswalk rows, 32 route
bindings and 128 variants per candidate, plus 100,000 total inspected OSM/variant
references. OSM capture itself is bounded to 10,000 members, 512 served members
and 32 identity tags, scanning at most 256 raw tag keys before withholding
capture. Pattern, call, observation, source-envelope and captured-OSM records have explicit
bounded field whitelists before canonical hashing; nested/oversized values or
unsupported extra fields are rejected rather than recursively traversed or
copied to results. Every bounded array must be dense with owned entries before
hashing, comparison or selection. Holes and inherited numeric slots cannot
substitute for evidence; JSON nulls are accepted only where the field permits
unknown values, such as a missing departure time. Resource-limit outcomes remain
`missing_evidence`.

### Outcomes

- `verified`: exactly one reviewed service/section/direction variant satisfies
  the exact source/snapshot, identity, station and eligibility requirements.
- `missing_evidence`: absent/incomplete capture, unresolved directions, station
  proof, eligibility, search coverage, variants or resource limits.
- `no_eligible_service`: the complete supplied candidate inventory is empty or
  explicitly excludes every candidate. An eligible candidate lacking a binding
  remains missing evidence; this says nothing about worldwide rail coverage.
- `ambiguous`: more than one verified variant remains; never choose the first.
- `conflicting`: inconsistent identity, crosswalk or content fingerprints.
- `stale`: expired feed/review/observation validity or mismatched source/OSM pins.

A plausible stale, conflicting or incomplete alternative prevents a verified
first candidate from winning. A supplied same-feed/agency operator assertion
remains relevant beside an exact route binding, even without a route ref;
conflict or uncertainty is distinct from absent or differently scoped evidence.
A same-feed/agency alternative must have a bounded, content-consistent and
snapshot-current OSM declaration before its ref can establish irrelevance. Its
validation counts toward the shared work cap even when the intact ref differs.
Every result says
`frequency_status: "not_evaluated"`; it supplies no rate or profile. A successful
identity decision alone must never copy a consolidated route's frequency onto
all matched branches. Unknown is not zero.

## Validation and next dependencies

```sh
node --test tests/timetable-matching.test.mjs
python3 scripts/benchmark-timetable-evidence.py
python3 scripts/benchmark-timetable-evidence.py --trips 12000 --unique-patterns
npm test
npm run build
git diff --check
```

The benchmark creates controlled synthetic ZIPs in a temporary directory, runs
fresh processes, checks identical legacy output hashes, and records elapsed time,
peak RSS and sidecar size/status. It generates no public-provider traffic. The
optional `--baseline-compiler` accepts the saved, reviewed baseline compiler for
A/B measurements. These are bounded controlled fixtures, not a worldwide
production-resource estimate.

The saved [Paris/Normandy acceptance in #147](https://github.com/c933103/openrailwaystyle/pull/147)
remains the geometry regression boundary. Its archived two-coordinate compiled
edges are not proof that the original raw GTFS shapes had two coordinates.
This increment does not edit those fixtures or restore standalone GTFS lines.

Before production activation, the next work is source-aware OSM identity and
station acquisition/reconciliation under #109, including conflicting revisions,
then reviewed source-overlap/occurrence deduplication and per-section/direction
aggregation. Publication needs an immutable OSM-snapshot-bound profile artifact,
strict source/snapshot mismatch rejection, truthful status propagation under
#112, valid attribution links and access review. Existing per-feed derived
links must not be activated against files that are not actually published.
Opt-in capture must not become a reason to rescan every provider; merge-time
refresh behavior is handled separately in #167.

### Controlled measurement on 2026-10-09

[Full machine-readable A/B results](investigations/timetable-evidence-benchmark-20261009.json)
record the exact measured source hashes. With 10,000 trips, 240,000 stop rows and
28 profiles, median compile times across three fresh-process pairs were 9.587 s
for the saved parent, 9.726 s with capture disabled, and 10.477 s with capture
enabled. Median peak RSS was 111,736 / 111,696 / 144,756 KiB respectively. Enabled
capture retained 2 patterns, 10,000 distinct observations and a 5,825,203-byte
sidecar. All nine legacy output hashes were identical within the cohort.

A separate 12,000-trip, 288,000-stop-row unique-pattern adversary reached the
16 MiB evidence cap and returned a 329-byte `incomplete` sidecar with no retained
arrays. Its legacy output still matched both controls; enabled peak RSS was
179,068 KiB. These observations support keeping capture explicitly opt-in and
bounded; they do not justify enabling it across the production registry yet.
