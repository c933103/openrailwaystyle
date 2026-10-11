# Bounded source/observation/identity comparison, 2026-10-11

Scope: source and observation records plus cross-pattern identities emitted by
`gtfs-frequency.py` and
`timetable_evidence.py`, compared with the offline matcher in PR #168. This is
not a provider audit, live acquisition, production activation or proof that a
resealed record came from the claimed ZIP. Existing source pins and separately
reviewed identity/crosswalk assertions remain necessary.

## Every retained source field

| Field | Collector contract | Verifier evidence |
| --- | --- | --- |
| `feed_id` | Nonempty configured ID, at most 1,024 UTF-8 bytes. | Own complete source shape, bounded context ID, exact equality to context; content hashes bind feed identity. |
| `sha256` | Lowercase SHA-256 of the source ZIP. | 64 lowercase hexadecimal context pin, exact source equality and scoped pattern/observation hashes. The matcher does not reread the ZIP. |
| `service_date` | Gregorian reference date, not today's date. | Exact bounded context/source pin and real Gregorian validation; observation hashes include it; sorted date lists stay within the inclusive 366-day contract window. |
| `valid_until` | Maximum route/trip boundary, with each route initialized to zero. Canonical route consolidation preserves the maximum. | Finite, source/review expiry gating, every observation bounded by source, and newly enforced exact `max(0, observation boundaries)`. Real 1950 compiler fixtures preserve negative observation boundaries and source zero. |

## Every retained observation field

| Field | Collector contract | Verifier evidence |
| --- | --- | --- |
| `id` | Hash of feed ID, ZIP digest and trip ID. | Complete digest shape, recomputation and uniqueness before selection. |
| `trip_id` | Original nonempty trip ID, at most 1,024 bytes. | Bounded field and trip-scoped ID/fingerprint; distinct simultaneous trips remain distinct. |
| `service_id` | Original bounded calendar ID. A single `active` map produces identical date lists for every trip using that ID. | Bounded field/fingerprint; newly checked same-service date-list consistency, independent of observation order. Different calendars may have different dates. |
| `pattern_id` | Content-bound retained pattern reference. | Complete digest, existing validated pattern, matching departure/call count, fingerprint and complete pattern observation coverage. |
| `timezone` | Exact agency timezone string; the compiler constructs `ZoneInfo` before capture. A single agency emits one string. | Newly enforced exact IANA 2026d zone/link catalog and same-agency string consistency. Different agencies may use different zones. No case folding or numeric-offset reinterpretation. |
| `valid_until` | Trip calendar boundary from local-noon-minus-12-hours plus trip extent, or zero when no end exists. | Finite, source upper bound, zero-sentinel semantics and selection expiry. The matcher does not reconstruct absent calendar start/end data. |
| `calendar_state` | Expired takes precedence, then future, otherwise current, relative to the reference date and trip extent. | Exact enum/fingerprint; zero requires expired/no dates, future requires no lookback dates, expired cannot include the reference date. Real overnight/DST fixtures retain current service after the final active date; empty-date current observations remain valid. |
| `active_service_dates` | Sorted unique active dates from the supplied reference-day lookback, shared by service ID. | Dense cap 367, real Gregorian dates, strict ascending uniqueness, inclusive 366-day/reference-date window, state consistency, newly checked same-service consistency. No sorting or dropping supplied dates. |
| `departures` | One nullable offset per ordered call; known values nondecreasing, integers from 0 through 366 days. | Dense cap 512, call-count equality, null distinction, safe integer range and nondecreasing known values across null gaps. Repeated departures remain valid. |
| `frequencies` | At most 128 unexpanded intervals with start/end/headway/exact-times. | Dense exact records; bounded start/end, strict end-after-start, positive safe-integer headway, exact enum, non-overlap. Adjacent or reverse-ordered disjoint intervals remain valid and are not rewritten. |
| `fingerprint` | Hash of feed, revision, reference date and the complete observation. | Recomputed before new timezone/cross-record checks; unsealed changes retain conflicting diagnostics. |

## New, separately reproduced gaps

Before these corrections, all four independent regressions returned `verified`:

1. Resealed `Not/AZone` in a selected observation.
2. Two observations tied to the same agency claiming different valid zones.
3. Two trips tied to the same service ID claiming different active-date lists.
4. Feed validity inflated beyond the maximum of the complete observation set.

Regressions cover selected/unselected/expired records, reversed observation
order, exact aliases, invalid case/offset/path-like inputs, different-agency and
different-calendar controls, and a maximum belonging to another pattern.
Actual Python compiler fixtures cover 1950, both 2024 Helsinki DST transitions,
2026, overnight versus expired trips sharing one calendar, inactive-but-current
service, future service and removal-only calendars. The original dense-array,
work-limit, hash-integrity and 17 prior-finding regressions remain in the suite.
The source-work adversary now uses valid zones and enough bounded observations
to exercise the same byte limit rather than an invalid filler timezone.

## Cross-pattern identity extension

The next review identified stable route metadata and stop-parent identity gaps.
The comparison was extended only to their related captured keys:

| Record/key | Collector contract | Verifier coverage |
| --- | --- | --- |
| Pattern `id` | Complete pattern definition hashed with feed/revision. | Bounded exact shape, unique digest and recomputation before cross-record use. |
| `source_route_id` | One uniquely keyed original route supplies agency and raw reference; one alias mapping supplies compiled ID. | Every repeated source route must retain the same agency, nullable raw reference and compiled ID. An unselected genuine declaration blocks a conflicting selected fallback. |
| `compiled_route_id` | Canonical groups share agency and terminate at one representative route; without consolidation it equals the source ID. | All source aliases using a compiled ID agree on agency. If that representative also has a captured source pattern, its mapping must terminate at itself; alias chains and cycles are rejected. A representative with no captured trips is not spuriously required to have a pattern. |
| `agency_id` | Original route agency, with the existing single-agency fallback. | Bounded per-pattern identity, stable source/compiled route agency and one exact timezone string across all agency observations. |
| `route_ref` | Original nullable short-name string, not the canonical route's display name. | Exact nullable bounded field and stability within one source route. Different canonical aliases can preserve whitespace differences or different raw refs; no normalization or cross-alias ref equality is imposed. |
| `direction_id`, `shape_id` | Trip-specific direction/shape, even for one route. | Existing enums/nullable strings and hashes; different patterns may legitimately retain different values. No cross-pattern equality is imposed. |
| Calls `stop_id -> station_id` | One uniquely keyed stop supplies its parent, or itself when it has no parent. | Every occurrence retains the same parent across calls/patterns, including unselected ones and loops. Several platforms may share a parent. |
| Station parent roots | Retaining a stop also retains its parent; a parent with another parent makes capture incomplete. | If a station ID also occurs as a called stop, it must map to itself. Nested chains and cycles are rejected, without requiring every station to be called directly. |
| Call `pickup_type`, `drop_off_type` | Per-occurrence access, not stop-global metadata. | Existing exact enums, hashes and selected-service semantics. Calls at the same stop may have different access modes. |
| Trip and calendar keys | Distinct trip hashes; one calendar ID supplies one active-date list. | Existing trip uniqueness, pattern observation coverage, source-scoped hashes and same-service date consistency remain intact. Different trip extents can still produce different validity/state. |

Separate pre-fix cases reproduced false verification for conflicting source
route metadata, conflicting parents within a loop, nested station parents and
cross-agency canonical aliases. A separate run of the prior matcher also
confirmed false verification for canonical alias chains and cycles. Regressions
also cover repeated source routes
in either pattern order, altered selected/unselected definitions, canonical
alias chains/cycles, shared station parents, differing per-call access, repeated
served stops and legitimate alias metadata. An actual Python compiler fixture
merges two connected source routes with raw refs ` R ` and `R`, preserves their
original IDs, and verifies a repeated-platform loop plus a root-station call.

The comparison deliberately does not reconstruct canonicalization's omitted
route mode/colour, route-long-name fallback or disconnected-component history.
Those fields are not retained in this sidecar. It also does not validate unused
retained-stop metadata as a new source of station matching authority.

## Explicit limits and intentional differences

- The pinned name catalog comes from the installed Python `tzdata` package's
  public-domain `zones` resource. `scripts/timetable-timezones.mjs` records the
  package/IANA versions and resource SHA-256. It contains names only, no timezone
  transition rules. New names require a reviewed catalog refresh; machine-local
  aliases such as `localtime` are intentionally unsupported.
- The standalone sidecar has its own published numeric/window bounds. Its
  inclusive 366-day offset boundary remains supported, while the compiler has
  an independent stricter whole-day processing budget. This patch does not
  silently redefine that accepted standalone boundary or infer a narrower
  lookback from incomplete upstream compiler state.
- Full calendar bounds, timezone transitions, upstream feed clipping and the
  original ZIP are not retained here. Exact provenance and full calendar truth
  cannot be reconstructed from this sidecar; a content hash is not a signature.
- Observation ordering is intentionally irrelevant to matching. The collector's
  sorted trip traversal is not used to reject equivalent reordered records.
- Retained stop metadata remains bounded but unused for matching. Station proof
  comes from pattern calls and the reviewed crosswalk; this review does not
  broaden into stop metadata, acquisition or renderer auditing.
- Catalog, matcher and benchmark-script hashes are included in the refreshed
  benchmark. Earlier measurements and compiler cohorts remain historical.
