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

## Worldwide discovery and updates

The source registry is assembled from **three independently credited inputs**:

- Transitous's [licence inventory](https://github.com/public-transport/transitous/blob/main/website/data/license.json), which is **not** the full Transitous source catalogue.
- All Transitous [`feeds/*.json` regional source definitions](https://github.com/public-transport/transitous/tree/main/feeds), pinned to one Git commit. These recover entries missing from the licence inventory, including `jp_japan-rail`.
- The [Mobility Database feed CSV](https://files.mobilitydatabase.org/feeds_v2.csv), pinned as the input to each catalogue generation. Transitous `mdb-id` references reconcile with Mobility Database IDs; an exactly matching original feed URL also reconciles entries. The pipeline does **not** merge feeds just because their operators, names, or geographic areas look similar.

The [normalizer](../scripts/frequency_catalogue.py) emits the complete catalogue,
lineage entries and a reconciliation report. Each source retains links to its
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
eligibility. Main-branch runs compile every entry in eight deterministic
shards. Pull requests validate the immutable PR head using the existing
compiler, geometry, streaming-reader, inventory/assembly, profile and catalogue
fixtures. The test process runs as the ordinary runner user in a temporary
network namespace with only loopback enabled for local HTTP fixtures. It does
not acquire a live catalogue, download public feeds, restore production caches
or publish snapshots. Locked dependency installation precedes this process
and disables package lifecycle scripts. PR-number concurrency supersedes stale
fixture checks without cancelling a production refresh. Production push,
scheduled and manual refreshes retain the eight-shard pipeline, budgets,
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
