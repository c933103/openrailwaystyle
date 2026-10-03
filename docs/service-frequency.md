# Service frequency data

[Documentation index](README.md)

Service view offers **Route width → By frequency**, then **Peak → Morning / Evening**
or **Off-peak**. Equal width remains the default. One shared scale applies across
all regions and periods, with persisted settings/shared links. Unknown is not zero.

## Mapped sources

The reviewed [feed registry](../styles/data-src/service-frequency-sources.json)
currently supplies these actual mapped weekday profiles for **Monday 5 October 2026**:

| Network | Region | Rail route records | Path segments | Reference windows, local time | Permission |
| --- | --- | ---: | ---: | --- | --- |
| Helsinki Region Transport (HSL) | Europe | 47 | 25,334 | AM 07–09; PM 15–18; off-peak 13–14 | CC BY 4.0 |
| MTA New York City Transit | North America | 29 | 19,102 | AM 07–09; PM 16–18; off-peak 12–14 | MTA data terms |
| MassDOT / MBTA, Boston | North America | 22 | 21,076 | AM 07–09; PM 16–18; off-peak 12–14 | MassDOT Developers License Agreement |
| Auckland Transport | Oceania | 4 | 27,397 | AM 07–09; PM 16–18; off-peak 12–14 | CC BY 4.0 |
| MTR, Hong Kong | Asia | 17 audited whole routes | Existing OSM ways | Operator AM / PM / non-peak categories; no clock windows supplied | Published headway estimates |

Route records include variants such as New York express services and temporary
HSL lines; 102 GTFS records are not a claim about 102 unique branded lines.
Coverage is **partial worldwide**, not complete continents. The registry records
uncovered regions and blocked/prepared sources explicitly. Africa has no integrated
source. Current Santiago redistribution terms remain under review. Toei and the
DELFI-derived German regional feed lack shapes. Buenos Aires marks its feed
suspended. These do not silently become frequency-bearing routes.

The first GTFS compilation withheld **zero trips** from all four mapped feeds.
Source URLs, ZIP hashes, feed versions, retrieval dates, timezone, service date,
licence, attribution and geometry audit are retained in the downloadable
[derived datasets](../styles/frequency). Source configs link primary permissions.
The site publishes `frequency-credits.html` and
`data/service-routes/frequency-manifest.json`; route details carry the same source
credit and dates. MTA's regular feed excludes most temporary service changes;
no real-time accuracy is implied. No operator logos are used.

## Geometry and counts

The existing OSM service snapshot has no Europe, America or Oceania service
relations yet. The build therefore combines its existing geometry with **supplied
GTFS rail shapes**. It works even when an OSM service snapshot is absent. It never
joins station coordinates with synthetic straight lines, fabricates OSM relation
IDs, makes new Overpass requests, or fetches timetable feeds from the viewer.

`scripts/gtfs-shapes.py` projects each trip's stop pattern onto its own supplied
shape, clips non-service tails, splits paths at station projections and source
vertices, and reconciles collinear vertices within 15 cm. Differently densified
shared paths and reverse shapes therefore share atomic intervals. Distinct nearby
paths stay separate. These are timetable path geometries, not a claim to identify
individual railway tracks. Paths with differing geometry are not assumed identical
because their endpoints, route reference or colour match.

Each train contributes once to each path interval it traverses, with canonical
geometric directions kept separately. Branches receive their own trains; express
trips add to the trunk they traverse despite skipped stops. The time anchor is the
departure at the preceding **served** stop; pass times between stops are not inferred.
Counts are divided by the configured window duration. Width uses the lower rate
when both path directions are represented; a one-direction path retains its own
rate. Details preserve both directional rates where available.

Calendar exceptions, prior service-day trips, local timezone/DST boundaries,
half-open windows and GTFS frequencies are applied. Exact frequency templates
are expanded without double-counting; non-exact headways are labelled estimates.
Missing times remain unknown. Invalid intervals, broken references, invalid dates
and ambiguous DST boundaries fail. A missing, remote or ambiguous shape is withheld;
if an active rail trip cannot be mapped, its entire route's frequency becomes
unknown instead of understating frequency by counting only mapped trips.

Rail route types are filtered before retaining stop times. A configurable
`exclude_platform_codes` filter removes explicitly identified replacement-bus
trips (e.g. Victoria's `R-Bus`) rather than painting bus paths as rail. New feeds
need an audit of their route IDs, replacement services and shapes before registry
inclusion. Future OSM coverage overlaps also require source reconciliation;
adding an already covered network must not duplicate services.

## Scale and expiry

At the existing middle zoom, 1/h → 1.5px, 2/h → 2px, 4/h → 2.5px, 6/h → 3px,
12/h → 4px, 24/h → 5px and 30/h or above → 5.5px, with interpolation and existing
zoom scaling. The scale is bounded, never normalized to the busiest visible route.
Shared-path offsets use actual widths plus a small gap; label positions and click
selection follow the same offsets. Local tram/light-rail bundles are recalculated
when they first become visible at zoom 10.

GTFS profiles expire at the earlier of feed validity (agency local time) and the
30-day source review interval. MTR headways expire after 30 days. This is a review
rule, not an operator guarantee. A bundle uses its earliest source expiry so widths
and offsets stay consistent. Unknown or expired profiles are subdued baseline
3.5px lines with explicit unavailable details; known zero has its own narrow state.
Loaded tabs reevaluate expiry automatically and on resume. Old tiles remain usable.

MTR estimates retain 28 published rows, ranges and weekend values. Only 17 audited
whole routes are attached; section-specific Kwun Tong/Tseung Kwan O/Tung Chung/East
Rail rows remain unmapped. Width is `60 / longest reported headway`, with both rate
bounds retained. No OSM relation count is interpreted as a train count.

## Refresh and reproduce

Fetch each registered official URL into `CACHE/<feed-id>.zip`; retain the originals
unchanged. The offline refresh command makes no network requests and compiles all
requested feeds successfully before replacing outputs:

```sh
python3 scripts/refresh-service-frequency.py --cache /path/to/cache \
  --date 2026-10-05 --retrieved 2026-10-03
# --feed hsl can rebuild one registered source.
node scripts/rebuild-service-frequency.mjs
npm run build
npm test
node scripts/check-service-frequency-browser.mjs
node scripts/check-world-frequency-browser.mjs
```

Refresh in a reviewed PR, checking actual permissions, feed validity, geometry
audit, replacement services and directional sample counts. Do not advance a
retrieval timestamp without fetching that source. Site assembly uses committed,
reviewed derived gzip data; upstream availability does not break a deployment or
cause an unreviewed data change. The reusable compiler accepts further registered
licensed GTFS feeds rather than requiring hardcoded per-route headway values.

For auditing stop-pair counts separately, `scripts/gtfs-frequency.py` without
`--geometry` retains parent-station pairs. That output alone is not mapped coverage.
