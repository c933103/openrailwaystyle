# Service frequency data

[Documentation index](README.md)

Service view offers **Route width → By frequency**, then **Peak → Morning / Evening**
or **Off-peak**. Equal width remains the default. One shared scale applies across
regions and periods. Settings persist in shared links. Unknown is not zero.

## Worldwide discovery and updates

The production source is a catalogue-wide pipeline, not a city allow-list.
[`global-service-frequency.py`](../scripts/global-service-frequency.py) discovers
**every GTFS schedule entry** in the [Transitous worldwide catalogue](https://github.com/public-transport/transitous/blob/main/website/data/license.json).
A local inventory on 3 October 2026 found 2,039 entries; the registry changes over
time. Eligibility is determined by redistribution permission and provider policy,
then actual rail route types, rather than a choice of cities or continents.

[Transitous publishes processed GTFS files](https://transitous.org/sources/) with
syntax/semantic repairs and agency overlap removal. Those processed files are the
pipeline input. The catalogue, original/processed URLs, licence, publisher credits,
GTFS attributions, ZIP hash, reference date, agency timezones and match outcomes are
retained. URL-only/unknown permissions are reported for review, not inferred from
public accessibility. The two previously reviewed MTA/MassDOT permissions are bound
to their exact source URLs in [licence rules](../styles/data-src/frequency-source-rules.json);
these rules do not select which cities to process. Provider jurisdictions/domains
CN, RU, IR and KP are excluded; existing geographic map data stays available.

[The worldwide workflow](../.github/workflows/service-frequency.yml) pins one
catalogue and processes every entry in eight deterministic batches. Byte-range
ZIP inspection reads route metadata before downloading bus-only feeds. Servers
without ranges use a bounded download. Downloads, compilation time and per-feed
failures have explicit budgets/outcomes. Conditional revalidation and content/input
hashes support repeated runs; a failed refresh never advances retrieval timestamps.
Unicode feed names have stable filesystem IDs and remain in the inventory.

Every entry ends as excluded, no rail, compiled or failed. The assembler refuses
missing batches, duplicate feed IDs or inconsistent catalogue/reference dates.
It removes cached outputs absent from the current compiled inventory before
publishing, including retired/failed/excluded feeds and interrupted writes.
It builds static service tiles one feed and one encoded tile at a time; the viewer
never downloads feeds or queries an extraction API. Scheduled main-branch runs
publish the complete snapshot in the `service-frequency-data` data release and
trigger site assembly. PR runs create reviewable artifacts without publishing.
The site uses the published worldwide snapshot; absent data remains unknown.
The four earlier city datasets are now **test fixtures only**.

National outputs can exceed JavaScript's single-string limit. The assembler
streams and decodes their top-level array records, then compacts consecutive
equal-profile edges before tile indexing. Python writes gzip JSON incrementally
and releases stale cached outputs before recompilation.

Coverage is not complete worldwide: a catalogue can omit operators, a feed can be
expired/unlicensed/unavailable, and a geometry match can fail. The site's
`data/service-frequency/inventory.json` records every outcome;
`data/service-frequency/manifest.json` records the actual mapped sources and counts.
`frequency-credits.html`, downloadable per-feed data and route details preserve
provenance. An inventory entry or an unmatched frequency is not mapped coverage.

## Geometry and service identity

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
Encoded tile merging deduplicates exact path/operator/reference/mode matches;
conflicting duplicate-source rates are withheld. Approximate OSM/GTFS paths can
still appear as separate services: proximity alone is not enough to reconcile them.
Explicit `R-Bus` replacement platforms are excluded; other misclassified replacement
services depend on upstream route typing and appear in source audit limitations.

## Counts, windows and expiry

The default reference is the next Monday, or an explicitly supplied date. AM is
07:00–09:00, PM 16:00–18:00 and off-peak 12:00–14:00 in **each agency timezone**.
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
A reference beyond an obsolete calendar's horizon, with no declared feed end,
fails explicitly instead of becoming a future zero-frequency profile.
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
profiles expire at the earlier of feed validity in local time and the 30-day
successful source-verification interval. The original retrieval date stays separate; a confirmed HTTP 304 can verify an unchanged annual feed. Bundles expire together to keep offsets consistent.
Unknown/expired profiles use subdued baseline widths; known zero stays distinct.
Loaded tabs reevaluate expiry on their timer and on resume.

The pre-existing MTR headway table remains a separate dated estimate source.
Only its 17 audited whole-route rows match OSM geometry; section-specific rows stay
unmatched. Their published AM/PM/non-peak categories have no invented clock windows.
No OSM relation count is interpreted as a train count.

## Reproduce

Use the whole catalogue, with an optional local copy for reproducible discovery:

```sh
python3 scripts/global-service-frequency.py --cache /path/to/gtfs-cache \
  --output /path/to/frequency-output --date 2026-10-05 \
  --rail-graph /path/to/published/branch-lines.ndjson.gz
node scripts/assemble-global-frequency.mjs /path/to/frequency-output
```

`--inventory-only` records eligibility without requesting feeds; `--shard N
--shards 8` reproduces a worker. All eight inventories must be present before
assembly. The manifest fixes catalogue/input hashes and actual outcomes.

For a published snapshot, `python3 scripts/load-frequency-snapshot.py` followed
by `node scripts/rebuild-service-frequency.mjs` merges its static tiles into the
existing OSM service tiles. `npm run build` and `npm test` validate the app.
`--fixtures` is reserved for the actual-feed browser regression tests, and those
tiles are restored to the production snapshot after testing.
