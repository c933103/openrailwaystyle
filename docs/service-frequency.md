# Service frequency data

[Documentation index](README.md)

Service view offers **Route width → By frequency**, then the periods some applied
source covers, as listed in `profiles` in `frequency-manifest.json`. With only
published headways applied, that is **Peak → Morning / Evening** and **Off-peak**;
**Overnight** and **Hour** (00–23) appear once a source covers them, and a shared
link to an uncovered period falls back to off-peak. Equal width remains the default
in standard and watch layouts; selecting an hour changes widths, offsets and click
selection together. One shared scale applies across regions and periods. Settings
persist in shared links. Unknown is not zero.

## Station departures and frequency coverage

The station departure board asks Transitous for upcoming trains. Frequency
widths use complete, calendar-aware timetable counts for dated agency-local
windows. A short departure list cannot establish peak or all-day frequency.
The worldwide assembly now matches those compiled counts to existing OSM
service sections and publishes `profiles.json.gz`; the site rebuild applies
that artifact to its cached OSM routes. Timetable geometry supplies matching
evidence only and never becomes a displayed line.

Matching requires compatible rail modes, a declared operator/network and
reference or name, plus coverage of the supplied timetable path by the OSM
service. A feed-scoped `gtfs:route_id` can also establish the declared identity.
Grouped OSM relations retain each relation's localized operator aliases and
route IDs within their original feed namespace.
Names are normalized for Unicode typography; arbitrary agency IDs are not
operator names. A spelled-out agency acronym is accepted only when the feed
uses that exact acronym as its agency ID. Tram/light-rail modes share a compatible
family. Different candidates remain ambiguous. These are corroborated source
declarations, not independent certification of upstream metadata.

Rates attach separately to each original OSM edge. Every sampled interior point,
including midpoints between supplied interval boundaries, and both ends must
resolve to the same measurement, with compatible
alignment; counts cannot extend beyond a short working's terminus. An OSM edge
crossing a rate boundary is withheld, rather than receiving one branch's rate.
Distinct same-feed route records are not summed or collapsed. Duplicate feeds can supply a measurement once only when their original ZIP
hash, compiler input signature, agency and original route scope agree, along
with every profile, date, timezone and counting definition. Equal rates from
different archives or compilations do not prove duplicate trains: unresolved
overlap and conflicting measurements stay unavailable.
The pipeline retains its calendar, overnight, hourly and headway semantics.
Each section binds to its OSM coordinates, service identity and memberships;
changed bindings are withheld at the site rebuild. Coverage and conflicts are
reported in `frequency-manifest.json`.

Matching remains conservative and partial: unsupported shapes, paths outside
the OSM snapshot, unresolved operator aliases and conflicting source structures
remain gaps under #111. The spatial comparison uses 50 m sampling and a 120 m
maximum lateral tolerance, requires at least 500 m of supplied path, and rejects
very long edges, polar paths and antimeridian jumps. It does not certify exact
physical track identity or a complete station crosswalk. A subdued line means
**no current matched frequency profile** for that section and period; it can
still have an independently available departure board.

Each departure expands its complete trip using the opaque Transitous `tripId`
retained through within-list and cross-feed reconciliation. Its selected stop
uses that trip observation's own scheduled arrival or departure, including
when another feed supplies the board's preferred presentation. The viewer uses
the documented MOTIS `trip` itinerary: origin, intermediate stops and terminus,
including stay-seated continuations and scheduled skipped stops. It shows
arrival/departure times with local dates, platforms, live changes and
cancellations; repeated stops on loops remain separate. It does not derive a
schedule from the route name or another service. Missing identities and failed
requests are reported explicitly; failures have a Retry action.

Trip requests are made only when expanded. Concurrent requests are shared;
the bounded 64-entry cache expires after one minute and evicts failed requests.
Station board request limits are unchanged. Timetable text is explicitly
selectable, and dragging text does not expand the train. The complete renderer
is included in the versioned PWA shell. The Chromium/WebKit browser check uses
the actual Atlas station click handler and local timetable fixtures; no public
timetable or tile provider is contacted by automation.

API contract: [MOTIS OpenAPI](https://github.com/motis-project/motis/blob/master/openapi.yaml),
served by [Transitous](https://transitous.org/api/).

## Worldwide discovery and updates

The source registry is assembled from **three independently credited inputs**:

- Transitous's [licence inventory](https://github.com/public-transport/transitous/blob/main/website/data/license.json), which is **not** the full Transitous source catalogue.
- All Transitous [`feeds/*.json` regional source definitions](https://github.com/public-transport/transitous/tree/main/feeds), pinned to one Git commit. These recover entries missing from the licence inventory, including `jp_japan-rail`.
- The [Mobility Database feed CSV](https://files.mobilitydatabase.org/feeds_v2.csv), pinned as the input to each catalogue generation. Transitous `mdb-id` references reconcile with Mobility Database IDs; an exactly matching original feed URL also reconciles entries. The pipeline does **not** merge feeds just because their operators, names, or geographic areas look similar.

The [normalizer](../scripts/frequency_catalogue.py) emits the complete catalogue,
lineage entries and a reconciliation report. The report binds the exact combined
catalogue bytes to the pinned Transitous commit and source URLs, the licence JSON
SHA-256, a digest of the exact parsed feed-definition snapshot, and the Mobility
Database CSV SHA-256. The feed snapshot digest hashes a compact, key-sorted JSON
map of filenames to their content SHA-256s (UTF-8, default ASCII escaping). Both production compiler steps
require that matching report. Each shard and the assembled manifest retain this
composite `catalogue_provenance`; a combined catalogue has no single
`catalogue_url`. Assembly rejects missing/mismatched provenance across shards.
A local input without a report is explicitly `local-unverified`, while the
standalone default records only the actual Transitous licence URL it downloads.
Legacy shards remain readable with `legacy-unverified` provenance, without
inferring source identities they did not record. Each source retains links to its
originating registry and original feed URL, names, available publisher credits,
licence identifiers, terms URLs and structured usage restrictions. A missing
catalogue licence field, an unidentified/URL-only licence, or even a generic
"NoDerivatives" label **does not bar normal end-user consumption of timetable
information and factual frequency calculations**. SPDX/terms metadata is
retained for provenance and credits, **never used as a licence whitelist or
proxy for permission to run a timetable analysis**. Only a separately verified,
source-bound term explicitly forbidding this application's actual use can
restrict an individual source, and must link to the operative terms. Source
rules must bind to the exact publisher URL, not an inferred company, country
or SPDX family. Conflicting upstream claims remain inspectable.
This policy does not purport to grant permission to redistribute GTFS archives:
Atlas publishes attributed aggregate results, not those archives.

The [worldwide workflow](../.github/workflows/service-frequency.yml) builds
one reproducible catalogue, runs offline regressions and validates inventory
eligibility. Scheduled refreshes run every Monday at **02:41 UTC**; an explicitly
requested `workflow_dispatch` can refresh earlier, retaining its optional
`service_date` input. These production events compile every entry in eight
deterministic shards. Source fixes enter production data at the next scheduled
or explicitly requested refresh, rather than triggering a full scan on merge.
Pull requests and relevant main-branch pushes validate immutable PR-head or
push-commit SHAs using the existing
compiler, geometry, streaming-reader, inventory/assembly, profile and catalogue
fixtures. The test process runs as the ordinary runner user in a temporary
network namespace with only loopback enabled for local HTTP fixtures. It does
not acquire a live catalogue, download public feeds, restore production caches
or publish snapshots. Locked dependency installation precedes this process
and disables package lifecycle scripts. Separate PR-number and push-ref
concurrency supersedes stale fixture checks without replacing or cancelling a
queued/running production refresh. Existing path filters remain precise:
docs/test-only changes can trigger PR fixtures but not the frequency push
workflow; ordinary site/unit CI is unchanged. Scheduled and explicitly requested
refreshes retain the eight-shard pipeline, budgets,
inventory gates and caches. Processing keeps raw GTFS ZIPs in runner caches. Assembled snapshots publish OSM-bound section-count aggregates, manifest and
inventory rather than per-feed derived archives. Further source/station
reconciliation and coverage remain tracked in #111. Site maps draw only OSM
routes, and never draw raw GTFS shape copies.

All entries have inspectable status and a reason code. `excluded` applies
only to an independently verified ban on this particular application use, or
a documented separate project provider-jurisdiction restriction; it must
**never** mean that a licence identifier is missing or forbids publishing
derived *datasets*. `no_rail` requires a successfully inspected GTFS routes
table. `retry_pending` means the original source is currently inaccessible or
the parser/compiler needs repair (404, access denial, timed-out request,
invalid URLs, row/byte budget, memory or calendar-horizon failure, etc.).
This is a queue of unresolved work, **not a decision to discard that
operator**. HTTP 408/429/5xx and transient network failures receive bounded
retries; after failure of a Transitous processed URL, the compiler tries
published original source links from reconciled catalogue lineage. Successful
fallback records the original download URL and prior endpoint errors.
Every acquisition candidate and redirect must satisfy the project's provider
and exact-source reviewed-use rules. Downloads require public HTTP(S)
destinations, retain verified HTTPS host identity, and preserve normal range
and conditional-cache semantics. Local HTTP fixtures use an in-process test
injection; catalogue metadata and production CLI settings cannot enable it.
Retried sources retain their unsuccessful attempts and a recommended next
action; subsequent scheduled runs try them again. If every remote source is
unavailable but a locally cached ZIP was **successfully retrieved/checked
within the past 30 days** from a still-listed source, the compiler may
recalculate profiles offline for the requested service date. It verifies the
ZIP and service calendar, records `offline_cached` and the failed endpoints,
and **does not move the last successful source-check time forward**. Expired,
corrupt, mismatched-source or out-of-calendar caches are not treated as
current service. No fabricated rail frequencies are shown during outages.
Countries scanned, countries with **compiled** sources, and countries with
**mapped** compiled feeds are separate metrics; even mapped compiled
timetables are **not yet necessarily applied to OSM Service routes**.

The source inventory remains incomplete where source registries omit
providers, URLs require inaccessible credentials, original publishers do not
identify their actual terms, or public feeds have stale dates, 404s, invalid
GTFS, or valid large input beyond current parsing/memory limits. The
[gtfs-data.jp](https://gtfs-data.jp/) repository publishes source-specific
licences; the CSV crosswalk and Transitous metadata do **not** yet implement a
complete authoritative gtfs-data.jp API enrichment, and this remains open
under #110. Likewise, a successful eligibility inventory is not evidence
of improved compilations or country coverage: these need a verified full
run. Current tests cover positive and negative rights cases, URL-only terms,
missing metadata, overlapping source identities, new Japanese source
discovery, provenance, and distinct pipeline failure classifications.

The [October 8, 2026 pre-fix run](https://github.com/c933103/openrailwaystyle/actions/runs/37732419672)
reported 2,039 catalogue entries: 1,220 excluded, 635 `no_rail`,
106 compiled and 78 failed, with 66 catalogue countries and 86 feeds with
mapped segments. These remain **baseline** observations, not an after-change
coverage claim. All 1,220 old exclusions were caused by the *same incorrect
licence-whitelist review reason*, but not all are proven usable rail feeds.
A rerun must reconcile every old and newly discovered source and publish
updated outcomes before #110 can close.

The public site currently uses only headways already matched to OSM routes;
absence of linked timetable data is **unknown**, not zero. The published
snapshot does not itself add timetable lines or map tiles. Details of the
service identity and time windows follow below.

The [reconciled catalogue check on 8 October 2026](https://github.com/c933103/openrailwaystyle/actions/runs/37789156615)
found 5,487 distinct sources before the latest policy and source-recovery
corrections. The initial version still excluded one source solely for a generic
licence-derived restriction; the current implementation has removed that
exclusion. The October 9 follow-up catalogue run reported 5,486 entries,
5,481 pending, five separate project-policy exclusions and zero licence-based
exclusions. These dated discovery results are not proof of compiled or mapped
rail services, and this integration does not acquire a fresh catalogue.

## Resource limits and coverage expansion

Relevant main-branch merges run offline frequency validation alongside normal
site validation, without starting production acquisition. Scheduled or explicitly
requested refreshes acquire sources; successful aggregate publication starts
another site build. PR checks never acquire or publish. The October 9 pinned discovery result had
5,481 pending candidates, compared with 819 non-excluded entries in the older
2,039-entry run. Those cohorts differ and are not a reconciled rail-coverage
count. Processing demand can grow materially; fixture-only PR validation and
retained assembly optimizations do not establish a production load reduction.
The completed [October 9 refresh](https://github.com/c933103/openrailwaystyle/actions/runs/37929168720)
used 652.7 compile runner-minutes across eight shards. Separating refresh events
avoids incidental full scans after source merges; it does not make a scheduled
scan cheaper. Explicit provider `Retry-After` deadlines are retained in the
existing best-effort shard cache as described below. General failure backoff,
origin-wide scheduling and measured production resource reductions remain
separate work. The October 9 run predates these receipt counters.

Catalogue acquisition has a 30-minute job ceiling. The Transitous clone and
sparse materialization each have a 600-second timeout with a 30-second kill
grace. Mobility CSV retrieval has a 300-second per-transfer timeout, three
retries and a 900-second retry window. Failure stops dependent compilation,
assembly and publication; it leaves the last valid published release intact.

Production retains eight deterministic compile shards with 180-minute job
ceilings. Per-feed limits remain 600 MB downloaded, 3 GB process address space,
600 seconds for geometry compilation plus a 600-second stop-pair fallback, and
a 1,500-second outer subprocess deadline. Each source has at most eight
candidate URLs; each HTTP operation has at most three attempts with 45-second
connection/read timeouts. Retry-After waits above eight seconds defer that retrieval rather than
sleeping in the worker. Assembly retains its 90-minute job ceiling, 5.5 GB Node
heap and complete-inventory checks. The public release contains the OSM-bound section aggregate,
manifest, inventory and empty standalone tile index, not per-feed archives.

### Retained explicit Retry-After deadlines

On the existing retryable HTTP statuses (408, 425, 429, 500, 502, 503 and 504),
a positive numeric or HTTP-date `Retry-After` with a representable finite
epoch deadline becomes a per-endpoint receipt.
The final attempt records the hint too. An unchanged source is not contacted
before its retained deadline, including conditional GET, range reads, full ZIP
downloads and already known redirect targets. Hints up to eight seconds keep
the existing bounded in-run wait; longer hints defer acquisition without
capping the provider deadline. Missing, invalid, zero or past hints retain the
existing bounded retries; a 404 or unrelated failure is not labelled a throttle.

Receipts live at `frequency-cache/retry-after/<url_sha256>.json` inside the
existing Actions shard cache. Schema 1 contains only `schema`, `url_sha256`,
`status`, `observed_at` and `not_before` (UTC epoch seconds), with an optional
`rollback_anchor`. Identity is SHA-256 of the exact UTF-8 source URL, including
its operational query values; neither those values nor a raw URL/header are
stored in the receipt. Different query-valued sources remain separate.
Compiler, service-date or output cache-signature changes do not erase a known
endpoint deadline. A changed source URL has a distinct receipt. Requested
redirect aliases and the final endpoint are both remembered once observed.

A receipt is read with a 4 KiB limit and strict schema, status, identity and
finite-time validation. Invalid or unknown-schema receipts count as cache
misses and are discarded without echoing their contents. If the wall clock
moves behind the recorded observation (including an accidentally future
observation), the original full delay is anchored once to the new clock and
retained across processes. If the clock reaches the original observation,
its original absolute deadline applies again. This is conservative: one small
rollback can extend waiting to less than two original intervals while the
clock subsequently advances; repeated clock changes cannot guarantee elapsed
real time. Long valid provider hints are not shortened. Invalid current clocks
fail acquisition rather than bypassing a known deadline.

A valid matching previously retrieved ZIP can still be recompiled locally
while its source is held, preserving its original `checked` and `retrieved`
timestamps. Permitted alternatives are still considered. If no usable cache
or alternative exists, a held source stays `retry_pending`; a set of only
retained holds has `source_retry_after` / `retrieval` classification. A first
HTTP failure and mixed failures retain their concrete source-error category.
Access-review holds and explicit source policy checks precede receipt use.

Per-feed inventory `acquisition_metrics` reports observed HTTP request attempts,
retained deferrals, receipt record/clear/expiry/corruption/clock events,
conditional 304s, offline archive uses and compiled-cache hits. Missing counters
mean zero for completed instrumented attempts. A killed process or absent
response may lack counters. They are diagnostics, not a production savings
claim. Receipts are best-effort per endpoint within each restored shard cache,
not a durable global origin scheduler: cache eviction, an unsuccessful cache
save, a new shard or unsupported receipt version can lose a known deadline.
A numeric hint beyond the bounded parser or finite epoch representation defers
the current acquisition and increments `unpersistable_hints`; it is
not silently capped, but a later run cannot remember that unsupported hint.
There is no new credential store, access grant or generic failure cooldown.

Source-failure logs, compiled provenance/agency/route metadata, shard inventories
and final aggregate metadata redact URL userinfo, query **values** and fragments.
Endpoint paths and parameter names stay visible for diagnosis. A sibling
`<field>_sha256` is the SHA-256 of the exact original UTF-8 URL: it preserves
same-path/different-query identity and cache validation across runs. It is an
identity fingerprint, not encryption or an authorization credential. Legacy
cache URLs migrate after matching the complete current source URL; redacted
display URLs never become retrieval inputs or cache-identity comparisons.

The pinned operational `catalogue/catalogue.json` is passed between acquisition
and compile jobs as a GitHub Actions staging artifact with ordinary public
source URLs. Ordinary public query parameters can be required for retrieval;
they are not all secrets and cannot simply be removed. Staging artifacts and
the retained raw cache are separate from the aggregate-only release. This
redaction does not claim to sanitize historical artifacts or arbitrary secrets
embedded in paths/free text. Confirmed private access material requires stopping
the affected publication/acquisition path and separate private review.

Before writing a new staging catalogue, explicitly recognized signed-storage
grants and URL credentials are redacted with full-URL fingerprints. An affected
schedule source remains `retry_pending` / `source_access_review`, with no
acquisition candidate until its access or a separately declared public
alternative is reviewed. An unsigned endpoint is never invented by stripping a
signature. Recognized access material in ancillary metadata is redacted without
disabling an unrelated ordinary timetable source. This is a narrow access-data
boundary, not a general ban on query-valued URLs or unknown licence metadata.

These are per-feed and per-job limits, **not** a global run byte/request budget
or cross-shard origin scheduler. Measuring the expanded workload and designing
those aggregate controls remain separate follow-up work. Existing 2 GB expanded
archive, 512 MB table, three-million table-row and ten-thousand retained-stop-row
limits also remain unresolved scalability constraints for valid large feeds.

## Geometry and service identity

The compiled geometry below is kept for matching timetable routes to
OpenStreetMap routes; it is never drawn as a Service route.

Supplied GTFS shapes are clipped to served stops and split at station projections
and source vertices. Collinear vertices within 15 cm are reconciled; differently
densified express/reverse paths can therefore share atomic intervals. Adjacent
tracks are not identified merely by proximity. Timetable paths do not identify
individual physical tracks. Station coordinates are never connected with invented
straight lines, and GTFS records never acquire fabricated OSM relation IDs.

For missing/unusable shapes, the same compiler can match ordered stop patterns
against the **already published** OSM branch/metro geometry. No new Overpass
requests are made. Rail, metro, tram, monorail and funicular infrastructure are
kept separate. Station snap errors, disconnected graphs, excessive detours and
near-equivalent alternative paths are withheld. The existing snapshot is not a
complete mainline graph; matching therefore cannot fill every shapeless feed.
Matched OSM geometry retains its ODbL licence/attribution.
Shape distances and snap searches use local latitude, so unrelated equatorial
and northern shapes cannot alter each other's 200 m acceptance threshold.

If geometry compilation exceeds its budget, a separately bounded timetable-only
pass retains the source frequencies with an explicit geometry timeout audit.
Unmatched routes retain their computed parent-station-pair frequency data and
stops in the internal matching cache, with no map geometry. If any active trip in a
route remains unmapped, the route's mapped frequency is unknown, avoiding an
undercount from its successfully matched subset.

Calendar/direction route IDs are consolidated only with the same agency,
reference/name, mode and colour **and connected served stations**. Disconnected
networks with the same name stay separate. Original IDs remain in metadata.
Timetable-to-OSM section matching uses the identity and path corroboration
described above; proximity alone never establishes a match. Remaining station
identity, source and variant reconciliation gaps are tracked in #111.
Explicit `R-Bus` replacement platforms are excluded; other misclassified replacement
services depend on upstream route typing and appear in source audit limitations.

## Counts, windows and expiry

The default reference is the next Monday, or an explicitly supplied date. AM is
07:00–09:00, PM 16:00–18:00, off-peak 12:00–14:00 and overnight 00:00–05:00 in **each agency timezone**. Each of the 24 hours also has its own half-open one-hour window, including 23:00–24:00. Prior service days supply post-midnight trips, so overnight-running systems can retain their scheduled service. These 28 profiles force a new compilation cache signature.
These are configured comparison windows, not asserted operator peak definitions.
Calendar exceptions can make the reference date a holiday. They are scheduled,
dated profiles, not live departures or a guarantee of service.

Each traversal contributes at the departure from the preceding served stop;
pass times between stops are not inferred. Repeated traversals are retained.
Calendar exceptions, all relevant prior service days (including GTFS times beyond
48 hours), half-open windows, timezone/DST boundaries and GTFS frequencies are
applied. Exact templates expand once; non-exact headways are labelled estimates.
Missing times stay unknown. Broken references, overlapping frequency intervals,
invalid dates and ambiguous/nonexistent DST boundaries fail explicitly.
A reference beyond every retained rail calendar's horizon fails explicitly
instead of becoming a future zero-frequency profile. Unrelated bus calendars
and feed-wide metadata cannot extend that horizon. Within a current feed,
expired rail routes remain unknown and are listed in the calendar audit.
Constituent service-calendar validity is retained before route IDs consolidate.
Each path keeps the earliest expiry of its contributing trip patterns, so a
current branch cannot refresh an expired branch, even within one route ID.
Multi-day departures extending the final service day are included in that
horizon and expiry calculation.

Counts are divided by the window duration. Width uses the lower directional rate
when both path directions are represented; a single-direction path retains its
own rate. Details retain both directional rates. At the existing middle zoom,
1/h → 1.5px, 2/h → 2px, 4/h → 2.5px, 6/h → 3px, 12/h → 4px, 24/h → 5px and
30/h or above → 5.5px, with interpolation and existing zoom scaling. The scale is
bounded per service and never normalized to the busiest visible route.

Shared-path offsets, labels and click selection follow actual widths. Local
tram/light-rail/monorail/funicular bundles are recalculated at zoom 10. GTFS
profiles expire at the earlier of their route's calendar/feed validity in local time and the 30-day
successful source-verification interval. The original retrieval date stays separate; a confirmed HTTP 304 can verify an unchanged annual feed. Bundles expire together to keep offsets consistent.
Unknown/expired profiles use subdued baseline widths; known zero stays distinct.
Loaded tabs reevaluate expiry on their timer and on resume.

The pre-existing MTR headway table remains a separate dated estimate source.
Only its 17 audited whole-route rows match OSM geometry; section-specific rows stay
unmatched. Their published AM/PM/non-peak categories have no invented clock windows.
It has no hourly or overnight observations; those selections remain unavailable for this source.
No OSM relation count is interpreted as a train count.

## Reproduce

Pin Transitous source definitions and the Mobility Database CSV, then
reconcile metadata before compiling. The published workflow automates
this sequence. For an existing locally assembled catalogue:

```sh
python3 scripts/frequency_catalogue.py \
  --licences /path/to/transitous/website/data/license.json \
  --feeds-directory /path/to/transitous/feeds \
  --transitous-ref PINNED_GIT_SHA \
  --mobility-csv /path/to/feeds_v2.csv \
  --output /path/to/catalogue.json \
  --report /path/to/catalogue-report.json

python3 scripts/global-service-frequency.py --catalogue /path/to/catalogue.json \
  --catalogue-report /path/to/catalogue-report.json \
  --cache /path/to/gtfs-cache --output /path/to/frequency-output \
  --date 2026-10-12 --rail-graph /path/to/published/branch-lines.ndjson.gz
node scripts/assemble-global-frequency.mjs /path/to/frequency-output \
  /path/to/published/service-routes.ndjson.gz
```

`--inventory-only` records eligibility without requesting feeds; `--shard N
--shards 8` reproduces a worker. All eight inventories must be present before
assembly. The manifest fixes catalogue/input hashes and actual outcomes.

For a published snapshot, `python3 scripts/load-frequency-snapshot.py` followed
by `node scripts/rebuild-service-frequency.mjs` rebuilds the OSM service tiles
with matched timetable counts and published headways, verifies each OSM section
binding and writes the manifest (including covered periods) and source credits.
The snapshot's feeds add no lines. `npm run build` and
`npm test` validate the app. `--fixtures` is reserved for the browser regression
checks that only existing OSM services draw, with matched fixture counts applied
where the OSM snapshot corroborates their identity and paths.

## Pinned source-reference resolution

Reference names and legacy `.gtfs.zip` catalogue keys are not evidence of a
static timetable. `frequency_references.py` independently resolves Transitous
`transitland-atlas` declarations against the exact Transitland Git commit stored
in the pinned Transitous tree, and `mobility-database` declarations against the
already supplied Mobility export. The metadata job fetches that immutable commit
with a shallow, blob-filtered checkout of `feeds`, verifies `HEAD`, and hashes the
files actually parsed. It never follows `--remote`, executes an upstream fetch
program, or calls a provider to resolve a reference. A failed checkout or malformed,
empty or over-budget metadata input is recorded as unavailable; its references
remain explicit and unresolved.

The old row universe, filenames, stable IDs and shard ownership are preserved.
The filename remains a compatibility identity key; a new `source_resolution`
object, schema 1, supplies the actual acquisition decision:

- `state`: `schedule`, `non_timetable_format`, `unresolved` or `ambiguous`
- `specs`, `identity_state`, complete `declarations` with exact reference IDs,
  pinned source-list/file URLs, JSON pointers, original file/blob and declaration
  hashes, upstream skip/reason, endpoint roles and declared format metadata
- `ordinary_static_declarations` retains independent same-name static URL sources,
  including their exact definition pointers, hashes, upstream skip metadata and
  access state; unsupported transport options never establish public access
- `selected_static_declaration` and nullable `processed_filename` with its
  evidence basis; neither an unresolved reference nor upstream skip alone
  establishes a processed archive
- `acquisition_alias_of` and `alias_source_sha256` for a matching existing direct
  acquisition owner; both historical catalogue identities remain present

Only the selected static endpoint enters acquisition lineage. Realtime and GBFS
endpoints remain separate evidence, never GTFS fallback URLs. An override retains
any inherited authorization requirement; its URL alone does not prove public
access. Authenticated Mobility lineage is not independent public-static proof.
Withheld original identities remain excluded even when a separately published
processed archive or distinct public static primary is usable. Original and
`url-override` identities remain distinct. Authorization descriptions retain only
the type, parameter name and public documentation; no credential value, custom
request body, encrypted payload or arbitrary HTTP options is copied. Unsupported
transport options remain `transport_options_required`/`review_required`, separately
from actual `authorization_required`; they never lower TLS requirements. Existing
access-grant holds and one-way redaction remain in force. Upstream `skip` describes
Transitous behavior; it is not an Atlas licence or provider-policy exclusion.
Published GTFS metadata can independently establish an existing usable timetable
when a companion reference is unavailable. A uniquely resolved public static
reference also remains usable when its missing companion explicitly declares
GTFS-RT; an untyped missing companion still requires metadata resolution.

### Endpoint-role precedence and disagreements

The pinned official resolver maps `static_current` to GTFS,
`realtime_trip_updates`/`realtime_vehicle_positions`/`realtime_alerts` to GTFS-RT,
and `gbfs_auto_discovery` to GBFS. The project implementation follows those roles.
A narrowly supported legacy mismatch is recorded explicitly: an Atlas record
labelled `spec=gtfs` whose recognized roles are **exclusively** realtime is typed
as GTFS-RT with `spec_precedence=endpoint_roles_legacy_rt_label`. Both the original
label and the mismatch remain in the declaration. This is supported by the pinned
[`gohrt.com` HRT RT declaration](https://github.com/transitland/transitland-atlas/blob/e2c827fdc0540577eb8e0d668d80ce290a948498/feeds/gohrt.com.dmfr.json)
and [`syncromatics.com` Kenosha RT declaration](https://github.com/transitland/transitland-atlas/blob/e2c827fdc0540577eb8e0d668d80ce290a948498/feeds/syncromatics.com.dmfr.json),
and by the inspected
[Transitous resolver](https://github.com/public-transport/transitous/blob/afcc88b467259bae36c25964dbb1db165d2afb31/src/transitland.py).
This refinement replaces the initial proposal's blanket spec-disagreement hold:
it prevents those RT companions from hiding independently evidenced static feeds,
without converting a conflicting reference into a static candidate.

Other explicit format/role conflicts remain unresolved or ambiguous, including
Mobility declarations whose explicit spec disagrees with the export data type. Missing
current endpoint roles do not become a new verified static source; the Microsoft
Shuttles declaration is one such case, while its separately published static
source remains available. Missing metadata, duplicate Atlas IDs, invalid overrides,
unknown companions and different static references collapsed under one name
cannot be resolved by a name/suffix guess. Acquisition schema validation reconciles
all static identities and differing declaration options before honoring a selected
reference; a malformed selection cannot hide another static source. Identical declaration occurrences keep
all pointers. Different options under one reference identity are visible conflicts.
Four regression groups retain the original collapsed-name evidence: Burlington
GTFS+RT, TransIt GTFS+authorization-held RT, Milwaukee GTFS+RT, and Slobozia's two
distinct GBFS references. Slobozia's two identities are not assigned to a guessed
city/operator.

### Outcomes, aliases and compatibility

Format-aware inventory schema 3 preserves all identities. `non_timetable` with
reason `non_timetable_format` reports a verified format, never `no_rail` or a
licence exclusion. Unresolved/ambiguous metadata uses `retry_pending` with
`unresolved_source_reference`/`ambiguous_source_reference` and an explicit metadata
resolution next step; neither receives provider requests. Existing policy/access
checks take precedence and remain unchanged.

Exact-source aliases use `source_alias`/`duplicate_static_source`, retain the
existing direct owner and its cache, and produce no duplicate request or compiled
contribution. This requires the exact original URL identity and a compatible
static source whose complete original candidate set is identical, without a
distinct ordinary source or active processed candidate. Discovery requires the
owner to pass its own policy/access/resolution checks; otherwise the alias is held
with an explicit ambiguity result. A shared operator,
host, redacted display URL or similar path is insufficient. Complete-inventory
assembly validates target existence, complete source fingerprint sets, compatible
policy/access/resolution state, direct ownership and
absence of self-references/cycles; aliases cannot own compiled output or bypass a
target's restriction. Historical target results are not copied onto aliases.

Reconciliation report schema 4 and provenance schema 2 bind both repository pins,
all actual input digests and explicit metadata availability. Old schema-2 reports
and old inventories remain readable without retroactively claiming reference
resolution. The report's `legacy_transitous_candidate_sources` replaces the old
misleading `transitous_schedule_source` counter. Assembly retains separate format
and alias status/reason counts; compiled/no-rail totals and the all-shards/row-count
invariant remain unchanged. The published manifest stays schema 3 and no standalone
timetable tiles are introduced.

Parsing caps are 4,096 directory entries, 4 MiB per file, 32 MiB total, 50,000
records, 64 KiB per record, 4,096 characters per projected string and 64 source
declarations per legacy row. Failure never publishes a partial reference index.
The normalizer has no provider network code. Production cadence, eight-shard
structure, Retry-After receipts, byte/time budgets and PR/main-push offline gates
are unchanged.

### October 9 frozen evidence

The [full before/after ledger](investigations/catalogue-reference-ledger-20261009.json)
compares the exact held 5,489-row catalogue with baseline main
`741b5e858710fb20fa55533eacd330142ad1c271`, using Transitous
`afcc88b467259bae36c25964dbb1db165d2afb31` and its Transitland gitlink
`e2c827fdc0540577eb8e0d668d80ce290a948498`. The gitlink is reproducible metadata;
Transitous production uses `--remote`, so it does not establish their actual
production resolver revision. The original Mobility export was not reacquired:
this frozen overlay uses its already-normalized static lineage, while controlled
fixtures separately test Mobility RT/missing/duplicate cases.

All 5,489 IDs remain. All 2,836 existing direct-owner rows and both existing access
holds remain byte-equivalent under the same compact row serialization. The overlay
adds 1,876 declaration records across 1,454 rows. It records 131 non-timetable rows,
11 aliases, 32 unresolved and two ambiguous reference outcomes; 38 changed
discovery outcomes lie outside the focused 141-row cohort and every one is listed.
The ledger distinguishes these proposed discovery outcomes from the historical
runtime results. It also lists all 332 changed candidate lists by original-URL
hash, all 11 unique owners and the exact spec/role disagreements.

Within the [focused attribution](investigations/catalogue-reference-attribution-20261009.json),
145 declarations correspond to 141 legacy rows: 132 GBFS declarations across 131
rows, ten static GTFS declarations, and three RT companions. The updated discovery
produces 131 explicit non-timetable rows, seven existing-source aliases and three
unmatched static candidates. Ten recovered source links do not mean ten new feeds.
No provider endpoint, production refresh or held archive was used for this replay;
no new coverage, successful availability or production savings is claimed. The
historical 5,489-row published scope and 652.7 compile runner-minute baseline remain
historical measurements.

The later access-proof review supersedes the earlier 228/227 candidate-change
checkpoints. It withholds authenticated originals alongside usable published
processed feeds, and holds 23 additional Mobility references plus Metro
Christchurch when no distinct public candidate is evidenced. Christchurch retains
its GTFS declaration and source identity, but its unsupported header transport
setup is `review_required`; only the parameter name
`Ocp-Apim-Subscription-Key`, never its value, explains the evidence. The ledger
records all per-row withheld fingerprints, surviving candidates and the exact
checkpoint comparison. These are metadata-based discovery holds, not new runtime
access results or a no-rail classification.

The 330-to-332 refinement also binds authorization to the original declared URL
when an override exists: SF Bay Area and SFMTA retain their independently
published processed candidates while the authenticated originals are withheld.
This is separate from the two pre-existing access-held rows, which remain
byte-equivalent. Schema validation compares actual endpoint URLs as well as
recorded fingerprints, rejects contradictory access states and malformed lineage,
and does not let selection hide an unknown non-companion. New aliases also reject
legacy owners with authenticated Mobility metadata; the owner rows and their
existing discovery policy are not rewritten by that compatibility check.

For new-schema rows, original acquisition URLs must be covered by explicit static
endpoint, ordinary-source or published/Mobility evidence; an unrelated row.source
cannot borrow a different source's proof or a stale display fingerprint. Unknown
upstream skip metadata cannot establish an active processed archive, although
independent published processed proof and verified public originals remain usable.
Non-companion reference conflicts retain strict ambiguity precedence; a missing
reference with independent public proof or a held/conflicting RT companion does
not erase that independently usable primary.

Reference evidence also uses one bounded allowlist shared by the Python catalogue
and compiler and the JavaScript assembler (`frequency-reference-schema.json`).
Ordinary static proof requires its source type, GTFS spec, URL and fingerprint,
explicit Boolean skip state, and complete definition URL/pointer/digest. Missing
or malformed proof cannot authorize an original or processed acquisition.

At staging and publication boundaries, invalid reference graphs are projected onto
known fields. Complete safe declaration provenance and authorization type/parameter
name/info URL remain available; unsupported nested fields are discarded. Repaired
graphs are explicitly unresolved, with selection, alias and processed proof
cleared. Existing URL redaction and original-source fingerprints still apply,
including authorization documentation URLs. The same projection covers every
outcome, compiled source attribution, and staged shard inventory copies as well
as the merged inventory/manifest. It does not rewrite internal compiled timetable
payloads or historical archives. Valid legacy rows without reference metadata keep
their existing behavior.

Controlled cross-language fixtures exercise malformed ordinary proof, nested
unknown fields, held outcomes, staged copies, URL redaction and idempotence. The
5,489-row pinned replay and its full candidate/discovery ledger remain byte-identical
to the access-proof checkpoint above. This is offline validation, with no new
provider request or production availability/coverage claim.

Publication proof on a reference row requires both complete normalized lineage
and separately supplied membership context. Transitous records bind their filename,
delivery and exact pinned licence origin to the row. The producer derives a
secret-free schema-1 index from the actual licence input bytes: pinned source URL,
input SHA-256, and filename/array pointer/canonical record SHA-256/exact original
source SHA-256 per record. It does not publish raw licence records, source URLs or
credential values. The raw input hash remains historical evidence.

The report binds the exact catalogue and index bytes, index count, input hash and
pin. Production passes the generated index through the existing catalogue-job
Actions artifact to discovery and compile with `--publication-index`. The consumer
checks the catalogue/report first, then the bounded index and each row's
`source_resolution.publication_evidence`. The trusted boundary is the explicit
producer/report/artifact handoff, not a serialized verified flag. A caller replacing
all supplied inputs controls their own input trust; this is not an independent
upstream signature or source-authenticity guarantee. Compile workers receive only
the relevant record as a separate trusted parent argument, never as row authority.

Index limits are 4 MiB, 20,000 records and unique filenames/pointers; the producer
bounds the raw input at 32 MiB and individual canonical records at 1 MiB. Duplicate
JSON fields and non-finite numbers are rejected. Invalid/missing index, mismatched
report or absent membership withholds publication-dependent proof. Old schema-2/3
reports remain readable but cannot supply this new authority. Catalogue-only mode
ignores audit verification assertions. Independently public ordinary/resolved
static sources remain usable without publication context. An empty source can
prove a processed archive when real membership matches; a redacted original URL
cannot become downloadable merely because its retained digest matches the index.
Mobility proof still requires its complete generated record and explicit public
authentication metadata. Legacy/direct-owner handling is unchanged.

The same bounded projection covers recognized lineage on reference rows, including
Transitous feed definitions and resolved Transitland identities. Malformed lineage
retains safe fields but puts the row on an explicit hold, so stripping an unknown
field cannot manufacture acquisition proof. Rows without `source_resolution` keep
their existing handling. Assembly reconciles projected alias and owner graphs
before accepting a `source_alias`; an owner link that would disappear on publication
is rejected instead of being counted as a usable alias.

Both languages use the explicit URI grammar in the shared descriptor, rather than
relying on differing permissive parser behavior: bounded ASCII HTTP(S) URIs,
ordinary hostnames or punycode, canonical IPv4, bracketed IPv6 and ports 0–65535.
Non-ASCII URL components require percent encoding; short/noncanonical numeric
hosts, invalid escapes, whitespace, backslashes and out-of-range ports are held.
The query count and the size of its redacted representation are bounded too.
Unsupported metadata remains unresolved, never a rail/licence exclusion. The
frozen 6,332 reference URL fields already fit this grammar, and the full catalogue
and ledger remain unchanged in the controlled replay.
For reference evidence and its recognized lineage only, publication also renders
accepted URIs with the shared grammar. It removes userinfo, fragment and query
values without invoking a second hostname parser. This preserves cross-language
publication stability and original fingerprints; it is still syntactic metadata
handling, with public-address/TLS/access checks enforced separately at acquisition.
Other legacy publication handling is unchanged; the IPv6 compatibility exception
is described below.


#### Resource identity and the publication-membership correction

Exact original URL fingerprints remain audit identities. Display sanitization,
request-resource identity and upstream authenticity are separate concepts.
Reference authorization holds additionally compare the same lexical HTTP resource
key used by acquisition: scheme/host case, trailing hostname dot, default port,
empty path versus `/` and fragment omission. Path/params and query bytes/order
remain distinct, as do HTTP and HTTPS. Userinfo is never erased to mint a public
request identity. No DNS, redirect or provider-specific equivalence is inferred.
These holds filter every returned candidate, including the processed endpoint;
a genuinely distinct verified processed alternative remains available. When a held
query URL has already been redacted, compatible visible resource/query-name shapes
remain unresolved access uncertainty, with an explicit missing-original-identity
reason. This does not equate hidden values: fully raw distinct query-value
controls remain separate.

Aliases require both matching original fingerprints and compatible visible
canonical endpoint components. Recoverable raw URLs must match their recomputed
hashes; already query-redacted URLs also need compatible visible components.
Matching display text alone does not equate hidden query values. A copied owner
hash cannot equate another host, path or visible query. These checks affect alias
acceptance, without changing the existing acquisition owner's rows or policy.

Legacy publication preserves an already publication-safe, supported IPv6 URL
byte-for-byte when the shared reference display would leave it unchanged. This
avoids compressing an expanded literal and detaching its recoverable display from
the exact original fingerprint. URLs needing redaction still use the existing
redactor. Historical rewritten displays do not gain raw-identity authority, and
alias validation, acquisition, access holds and reviewed terms are unchanged.

On the frozen inputs, the secret-free index contains 2,040 records, including one
NeTEx record that does not itself establish GTFS membership. Exactly 1,120 reference
rows gain membership evidence. All 5,489 IDs/order, 2,836 direct-owner rows and two
existing access-held rows are preserved. The complete candidate/discovery ledger
is unchanged: 332 candidate-list changes versus main, 176 discovery changes with
38 outside the 141-row cohort, and all 11 aliases. These are offline results, not
new provider availability, timetable coverage or measured live savings. The earlier
byte-identical catalogue statements describe the preceding checkpoints; this
correction intentionally adds the 1,120 membership records.


Without the separate context, this same frozen catalogue intentionally changes
148 candidate lists and holds 115 additional publication-dependent rows; 5,191
rows remain pending, 151 retry-pending, 131 non-timetable, 11 aliases and five
excluded. This is an offline catalogue-only compatibility measurement, not a
production change. A missing index does not rewrite legacy owners or existing
access holds, and independently evidenced public sources remain available.

#### Reference holds through retrieval and cache reuse

A reference row's declared access holds apply before DNS/connect at every redirect
hop, including range metadata, full downloads and conditional requests. The same
exact/canonical/uncertain resource checks used for candidate selection apply here.
A held destination is an explicit access-review outcome, not a licence exclusion
or observed HTTP denial. Independently public alternatives remain available.

Successful reference acquisition writes a bounded internal `request_provenance`
cache receipt (schema 2, `resource_normalization: http-resource-syntax-v2`):
candidate fingerprint, terminal resource fingerprint,
artifact kind/digest, and at most 64 deduplicated checked hop records. Each record
contains only a sanitized display URL and exact/resource/visible-resource hashes.
Reference cache metadata reads have a 1 MiB cap and strict JSON parsing; malformed
bytes are never echoed. No raw query values, credentials or headers are retained.
Rail archives bind their
full ZIP digest; successful no-rail decisions bind the inspected routes metadata.
Failed retry chains are not attributed to the accepted representation.
Every range/full response must retain the same terminal resource before its bytes
are consumed. Equal ETags at different terminals cannot join representations.

Conditional and If-Range validators are sent only to their bound terminal resource.
A changed-terminal 304 cannot certify old bytes; an independently fetched public
representation may establish new provenance instead. Same-terminal 304 revalidation
retains the historical hop evidence and adds checked current hops. Current holds
are checked against every retained intermediate and terminal identity before cache
revalidation, offline fallback or compiled-output reuse.

Old or malformed reference receipts do not manufacture destination proof. An old
cache with access-held alternatives stays on disk but cannot be reused without
sufficient destination evidence. This is explicit cache-provenance uncertainty,
not a claim of a new unauthorized request during offline reuse. A reference cache
without a receipt is destination-unverified and cannot be
reused, including when the row has no declared access hold. Normal permitted
refresh or public fallback can establish a new receipt; unsuccessful refresh
keeps the old bytes without advancing `checked`/`retrieved`. Legacy/direct-owner
behavior remains unchanged. No raw archive
purge or rewrite of historical destination evidence is introduced.

Assembly also validates an alias's own semantic public-static proof after safe
projection: a complete selected resolved GTFS declaration, consistent roles/access,
no conflicting static identities/options, and no hold affecting its resource.
Held real-time companions and genuinely distinct held ordinary sources do not
invalidate a supported public primary. Empty/unproven alias declarations, active
processed-source contradictions and access-held aliases are rejected. Owner rows
and historical no-rail outcomes are never copied to aliases.

Alias-owner authentication compatibility treats finite parsed JSON numeric zero
(`0`, `0.0`, `0e0`, negative zero, or a literal that underflows to zero)
equivalently across Python and JavaScript. Existing
public string/null markers remain supported; booleans, arrays/objects, nonfinite
and nonzero numbers do not establish a public owner. This check does not rewrite
owner bytes or change legacy acquisition or reference-proof authentication rules.
Parsed-value compatibility is not authentication of external metadata.

#### Versioned reference resource identity

Reference holds, cache receipts, terminal validators and alias visible-binding
checks use the same `http-resource-syntax-v2` comparison contract in Python and
JavaScript. The ordered steps follow [RFC3986 syntax normalization](https://www.rfc-editor.org/rfc/rfc3986#section-6.2.2)
and [IPv6 address spelling](https://www.rfc-editor.org/rfc/rfc5952#section-4):

1. Parse the existing supported grammar, retaining scheme/host case normalization,
   effective-port, trailing-dot and fragment handling. Canonicalize a valid IPv6 literal
   to compressed lowercase address spelling, without DNS resolution.
2. Reconstruct the transport's path including nonempty final params. Its existing
   empty final params delimiter handling stays unchanged.
3. In one nonrecursive pass over path and query separately, decode only ASCII
   unreserved percent-encoded octets and uppercase other valid `%HH` triplets.
   Malformed escapes receive no current resource identity.
4. Remove only complete `.`/`..` path segments after that pass. Preserve repeated
   slashes, trailing-slash distinctions and non-dot segments such as `..;x`.

Encoded reserved delimiters stay encoded. `%252f` and `%252F` remain distinct;
query order, repeated parameter order, `+` versus `%20` and distinct values stay
distinct. Dot removal never applies to queries. There is no DNS/CNAME or
provider-specific equivalence. Original URL hashes, request/Host bytes and
publication displays are unchanged; normalized compatibility alone cannot replace
the original-hash checks required for alias ownership or establish authenticity.

Schema-1 receipts retain their prior lexical identity rules. Strict old shape,
candidate/display/hash, artifact and current source-policy validation must pass
before compatibility;
unknown versions/normalizers and malformed receipts remain invalid. Valid old
receipts are destination-unverified when the row has held static identities.
Without holds, a valid public historical archive can remain usable offline, but
does not supply conditional freshness authority, advance `checked`/`retrieved` or
mint a schema-2 receipt. Fresh checked acquisition establishes the current version.
Hidden query values are never reconstructed. Unsuccessful held/invalid reuse
leaves the archive and historical receipt intact.

The old lexical key also remains explicitly in existing global reviewed-terms
matching. This preserves legacy owner policy rather than silently broadening
those matches as part of reference identity normalization.

Reference resource admission also applies the existing catalogue host grammar
to both the original ASCII hostname and the effective resolver hostname, before
DNS/connect. Numeric-looking hosts must be canonical four-octet IPv4 literals;
padded, octal, hexadecimal, short, integer and numeric trailing-dot spellings are
unsupported. Fullwidth numeric IDNA aliases are rejected rather than translated
into an authorized endpoint. Canonical IPv4, valid bracketed IPv6 and supported
DNS names remain available, including numeric prefixes such as `123.example.test`.
No DNS-based equivalence or address reinterpretation establishes access.

Candidate and every checked endpoint must pass that admission in both schema-1
and schema-2 reference receipts, before their version-qualified hash validation.
Unsupported-host historical receipts remain unresolved even without another
declared hold, rather than gaining public-offline authority. Existing supported
v2 keys and schema markers are unchanged. A historical candidate that no longer
matches supported current candidates records explicit cache-identity uncertainty
without reconstructing a raw URL or fingerprint from its display. Supported
public fallback remains usable; unsuccessful reuse preserves old archive/receipt
bytes. Global legacy/direct-owner transport and reviewed-terms matching are
unchanged by this reference-only admission correction.

Reference metadata/proof URLs use a credential-free authority grammar. Userinfo
(including username-only or escaped forms) is unsupported, and the resource
parser requires an explicit path/query boundary after the authority. This keeps
raw staged alias validation aligned with Python acquisition admission; an
invalid graph retains an unresolved hold after safe projection. Literal or
encoded `@` in path/query and fragment-only public URLs remain supported.
Historical/current receipt admission already rejects credential-bearing
authorities; supported identity hashes and schema markers are unchanged.

Before reference cache revalidation or offline reuse, every retained candidate,
intermediate and terminal must also satisfy current provider and exact-source
policy. This check precedes schema-1 compatibility. An available raw candidate
must match its recorded display/resource binding; a query-free endpoint retains
its existing lexical-policy identity. Hidden query values are never reconstructed.
If safe visible evidence cannot exclude a relevant current denial, reuse remains
policy-unverified. Supported public receipts remain reusable when every policy
restriction is demonstrably excluded, and permitted fresh alternatives remain
available. Confirmed cached restrictions use `source_cache_policy_restriction`;
unknown policy eligibility uses `unresolved_source_cache_policy`. These are
retriable cache outcomes, not observed requests, HTTP failures or feed exclusions.
Existing global lexical reviewed-terms semantics and legacy-owner cache handling
are unchanged. No original archive or historical receipt is purged or rewritten
when reuse fails.
