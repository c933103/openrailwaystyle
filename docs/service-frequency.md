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

The station departure board and the Service view's frequency widths have
different data paths. `styles/departures.mjs` asks Transitous for a nearby
station's upcoming trains. `scripts/rebuild-service-frequency.mjs` currently
applies only the audited published headways in `styles/service-headways.json`
to the cached OSM routes. Although the worldwide pipeline compiles timetable
profiles, this rebuild deliberately does not match those profiles to OSM
routes yet (tracked in #111). A usable Ginza Line departure board therefore
does not currently give its mapped line a frequency profile. A subdued line
means **no matched frequency profile**, not that no timetable exists. A
limited list of upcoming departures is not an all-day, peak or off-peak rate.

Each departure expands its complete trip using the opaque Transitous `tripId`
retained through within-list and cross-feed reconciliation. The viewer uses
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
inventory gates and caches. Processing keeps raw GTFS ZIPs in runner caches. Assembled snapshots publish manifest and inventory rather than
per-feed derived archives; this release is not a substitute for future
internal route matching, which is tracked in #111. Site maps draw only OSM
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
heap and complete-inventory checks. The public release contains only the
aggregate manifest, inventory and tiles, not per-feed derived archives.

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
stops in the downloadable dataset, with no map geometry. If any active trip in a
route remains unmapped, the route's mapped frequency is unknown, avoiding an
undercount from its successfully matched subset.

Calendar/direction route IDs are consolidated only with the same agency,
reference/name, mode and colour **and connected served stations**. Disconnected
networks with the same name stay separate. Original IDs remain in metadata.
Matching timetable routes to OpenStreetMap routes is not yet implemented (#111);
proximity alone will not be enough to reconcile them.
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
node scripts/assemble-global-frequency.mjs /path/to/frequency-output
```

`--inventory-only` records eligibility without requesting feeds; `--shard N
--shards 8` reproduces a worker. All eight inventories must be present before
assembly. The manifest fixes catalogue/input hashes and actual outcomes.

For a published snapshot, `python3 scripts/load-frequency-snapshot.py` followed
by `node scripts/rebuild-service-frequency.mjs` rebuilds the OSM service tiles
with published headways and writes the manifest (including the covered frequency
periods) and credits; the snapshot's feeds add no lines. `npm run build` and
`npm test` validate the app. `--fixtures` is reserved for the browser regression
check that timetable fixtures draw nothing.
