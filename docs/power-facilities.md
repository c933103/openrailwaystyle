# Railway energy supply facilities

Power is intended to represent the whole electricity grid and the railway fuel
supply chain, including train servicing. The current implementation covers the
railway-related facilities, traction power lines and rail-served fuel and
coal sites selected below; the whole-grid and wider production,
storage and rail-connected transfer coverage required by
[issue #114](https://github.com/c933103/openrailwaystyle/issues/114) is not yet
implemented. Missing markers do not establish that supplies are absent.

The current snapshot follows recorded OpenStreetMap attributes. Proximity alone
is not proof of railway use, a siding connection or train servicing. These
selection limits are implementation limits, not the intended domain boundary.
A facility marker is not a live availability report or proof that it is usable.

At regional zoom, railway power plants appear from zoom 10 and traction
substations from 11. Generators and converters appear from 12. Train refuelling,
fuel storage, coaling and water facilities appear from 13, and traction feeding
points from 14.
The markers use **E** for electricity, **B** for battery train charging,
**F** for train refuelling and railway fuel storage, **C** for steam engine
coaling and **W** for steam engine water and railway water storage. Selecting a
marker shows its recorded type, status,
operator, voltage, frequency, contents and output where available. Former and
planned supplies follow the existing planned/former infrastructure setting;
former supplies have hollow markers. Text references follow the Labels setting.

The legend uses the same circular E/B/F/C/W symbols, colours and lifecycle
appearance as the map. With planned/former infrastructure enabled, a hollow
sample appears beside each filled sample; the existing track-line keys remain
separate. Its servicing labels are “Train refuelling point (fuel type where
mapped)”, “Steam engine coaling” and “Steam engine water”. These legend categories
share marker metadata with the mapped facilities. The same category list supplies
the legend labels and help paragraph, which share their storage and coverage limits. F and W also represent stored
fuel and water; storage alone does not establish a train servicing point. The
infobox retains the specific facility type, such as Railway fuel tank. The wider
selection, wording and
presentation audit remains open in [issue #115](https://github.com/c933103/openrailwaystyle/issues/115).

Supply details preserve independent source attributes. Named `fuel` values and
positive `fuel:*` declarations are displayed together as **Recorded supplies**.
These can include additives such as AdBlue, so this row does not claim that every
item is a fuel. The original `fuel` value is retained as **Fuel tag**, and the
original `fuel:*` declarations as **Fuel tags**, including negative or conflicting
values. Generic `fuel=yes`, `no` or `unknown` values do not establish a supply
type. Missing types at a mapped train refuelling point read **Not recorded**;
diesel is never inferred. Nested `fuel:*:*` attributes remain raw declarations
rather than separate supply types.

`plant:source` and `generator:source` have separate energy-source rows, and
`content` remains **Stored contents**. Hydro, solar or wind generation is not
presented as train fuel; fuel storage is not evidence of a refuelling point.
Water tanks/towers recorded only as railway-use storage have neutral **Railway
water tank/tower** names. An explicit `railway=water_tank`, `water_tower` or
`water_crane` servicing tag, including lifecycle prefixes, retains the steam
servicing classification. Existing category-only snapshots and provider facility
classifications remain readable. These source declarations do not certify present
availability.

The OpenRailwayMap `electrification_substation` source supplies traction
substation footprints from zoom 13. Its import accepts polygon ways tagged
`power=substation` and `substation=traction`; its tile properties contain only
`id` and `name`. The supplementary worldwide snapshot includes nodes, ways and
relations and retains the original tags and exact OSM object identity.

The supplementary selection includes:

- `railway=fuel`, `coaling_facility`, `water_tower`, `water_tank`, `water_crane`,
  `power_supply` and `preheating`, including lifecycle prefixes.
- `railway:electricity=power_supply`, a traction feeding point. This differs
  from `railway=power_supply`, which can be an auxiliary power socket.
- Traction substations; plants, generators, converters and transformers with
  explicit railway use or a recorded 16.7/16.67 Hz traction frequency.
- Water towers and storage tanks explicitly tagged for railway use; storage
  tanks also need recorded water or fuel contents.

The current selection omits general-grid facilities without one of these
railway-use hints; this does not imply that the electricity grid serves no
trains, nor satisfy the whole-grid requirement. The map shows mapped supplies,
not a live power network, operating status feed or proof that a steam facility remains usable.

`scripts/build-power-facilities.mjs` queries every world quadrant, preserving
completed raw responses and splitting resource-limited regions. The snapshot
publishes only after all regions complete. `traction-facilities.yml` is manual
or code-change triggered and adds no schedule. It publishes `traction-data`
with `power/power-facilities.geojson` and its coverage manifest. The application
loads this file on demand in the Power view and reuses it after language or
view changes. Visitors never query Overpass.

Primary references:

- [OSM railway supply tagging](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging)
- [Traction substations](https://wiki.openstreetmap.org/wiki/Tag:substation%3Dtraction)
- [Traction feeding points](https://wiki.openstreetmap.org/wiki/Key:railway:electricity)
- [Power frequency tagging](https://wiki.openstreetmap.org/wiki/Key:frequency)
- [Provider import](https://github.com/hiddewie/OpenRailwayMap-vector/blob/master/import/openrailwaymap.lua)
- [Provider tile properties](https://github.com/hiddewie/OpenRailwayMap-vector/blob/master/import/sql/tile_views.sql)

## Railway traction power lines

Power also draws railway traction power lines from zoom 10, beneath the tracks
so they never hide track colours. Overhead and minor lines are solid amber;
cables are dashed. Former and planned lines are faded and dashed and follow the
planned/former infrastructure setting. Selecting a line shows its type, status,
the evidence that selected it, operator, owner, voltage, frequency, circuits
and OSM way.

A `power=line`, `minor_line` or `cable` way, including lifecycle prefixes, is
selected when either source fact holds:

- its `frequency` records a traction frequency (16.7, 16.67 or 16.666 Hz),
  including lines that also carry other circuits, such as `50;16.7`; or
- its mapped geometry reaches a railway electricity facility selected by the
  rules above (traction substation, railway power plant or generator, converter,
  traction transformer or traction feeding point): the line shares a node with
  the facility, or its geometry enters or ends on the facility's mapped area
  (a vertex inside it, or a segment meeting its outline). A multipolygon's
  member ways are joined into rings, and its holes are not part of the area.

A line that merely passes near such a facility, reaches only an ordinary utility
substation, or reaches an auxiliary `railway=power_supply` socket is not
selected. Conductors tagged `line=bay` or `busbar` are substation equipment
and are excluded. A line ending close to a node-mapped substation without a
shared node is not counted as connected. An operator name, voltage, or a track
running alongside never establishes railway use.

This covers dedicated railway supply networks and the grid connections that
reach mapped railway facilities. It is not the civil electricity grid, which
remains open in [issue #265](https://github.com/c933103/openrailwaystyle/issues/265).
Railway supply in 50/60 Hz countries is often taken directly from the grid,
so where the connection is not mapped into a railway facility the map shows no
supply line; that absence does not establish that the railway has none.

`scripts/build-traction-lines.mjs` collects the lines worldwide with the same
staged acquisition, retry, budget and publication checks as the conductor-rail
supplement (`scripts/staged-overpass.mjs`). Its query reuses the reviewed
facility selection and searches once for lines near those facilities. A line
crossing a region boundary can be returned by each region; the builder combines
the evidence from every region, so the result does not depend on region order. `traction-facilities.yml` publishes `power/traction-lines.geojson`
with its digest-bearing manifest; site assembly accepts snapshots made before
this file existed and validates it once present.

## Rail-served fuel and coal sites

Power shades fuel sites (brown) and coal sites (grey) from zoom 11 when a
railway siding is mapped as entering them. They draw beneath the tracks, and
names follow the Labels setting from zoom 14. Areas are used rather than
markers, so a served site is not mistaken for an **F** train refuelling point
or **C** coaling point. A site whose only entering siding is disused,
abandoned or planned is drawn faded and dashed with the planned/former setting.
Selecting a site shows the evidence for its energy role, recorded storage
contents and how many sidings enter it.

A site needs both kinds of evidence:

- **Energy role.** Its own tags (`industrial=fuel_depot`, `oil_depot`,
  `refinery`, `oil`, `gas`, `natural_gas`, `lng`, `hydrogen` or `coal`, or
  `resource=coal`, `lignite` or `anthracite`), or a `landuse=industrial` area
  holding a `storage_tank`, `silo` or `bunker_silo` whose `content` records a
  fuel or coal (for example `oil`, `diesel`, `gas`, `lpg`, `hydrogen`, `coal`).
  Contents such as water, grain or vegetable oil do not qualify. Many tank
  farms carry no industrial subtype, so recorded storage contents are
  essential evidence.
- **Rail link.** A siding, spur or yard track, or a track with
  `usage=industrial`, whose mapped geometry enters the site area: a vertex
  inside it or a segment meeting its outline. Passing nearby is not a link.
  A multipolygon's holes are not part of the site, for either storage or
  sidings, and are kept in the published area.

Point-mapped sites have no area to test and are not selected. A site mapped
without any of the role evidence above, or whose siding stops short of the
mapped boundary, is not shown; its absence does not establish that it is not
rail-served. Being rail-served does not mean the site refuels trains or that
deliveries continue.

`scripts/build-energy-sites.mjs` collects the sites worldwide with the shared
staged acquisition (`scripts/staged-overpass.mjs`). A site crossing a region
boundary sees only that region's sidings and storage; the builder combines the
evidence from every region. `traction-facilities.yml` publishes
`power/energy-sites.geojson` with its digest-bearing manifest; site assembly
accepts snapshots made before this file existed.

## Conductor rails, charging and catenary equipment

Power view also draws a dashed parallel line for mapped `electrified=rail`,
`4th_rail` and `ground-level_power_supply` tracks from zoom 10. Method labels
appear from zoom 12 and follow Labels; clicking the geometry shows its method,
recorded voltage/frequency, conductor contact position and OSM way. Colour still
follows the electrical system. The supplement keeps these methods because the
provider's railway line tiles carry voltage/frequency but discard `electrified`.
Unknown method or low DC voltage alone never establishes third rail.

**B** markers show battery train charging from zoom 12. Selection accepts an
explicit `railway=charging_station`, or `amenity=charging_station` /
`man_made=charge_point` with explicit rail-vehicle tags (such as `train=yes`).
Railway landuse, a nearby station and an operator name alone are insufficient;
station car-park chargers must not become train chargers. This accepts explicit
source tags and does not prescribe a new OSM tagging convention. Charger socket
and output tags are retained in the details. An ordinary power socket or an
electrified terminal is not automatically classified as a battery charger.
Facilities absent from the source data remain absent from the map.

Catenary masts and portals use the provider's `electrification_catenary` endpoint
from zoom 16, with mapped references from 18. Clicking a mast or portal links to
the original OSM node or way. All these layers are independent of Destinations;
planned/former conductor rails and chargers follow the existing inactive setting.

The maintenance-only `build-power-methods.mjs` writes
`power/power-methods.geojson` and `power/methods-manifest.json` on `traction-data`.
It covers every world quadrant and caches exact completed queries and spatial
split decisions for 28 days. Each run has hard limits of 96 requests, 100 MB of
downloaded response bodies and one hour, with at most three attempts per query and at
most six subdivision levels. HTTP request/authentication failures, malformed
JSON, unknown error remarks and incomplete geometry terminate immediately.
HTTP 408/429/500/502/503/504 and temporary transport failures retry the same box;
they never cause spatial fan-out. Connection/header/body timeouts and opaque
fetch deadlines are transport failures too: a stalled connection does not
establish a spatial query failure. An explicit Overpass query timeout or
memory-limit response subdivides immediately: repeating the same execution-limited
box consumes capacity and a later transport failure can obscure its limit evidence.
Transport and admission failures still retry the same box, without subdivision. Retry-After is
honoured up to five minutes; longer waits or an exhausted time budget stop the
run for later resumption. Completed child boxes and split decisions survive
failed runs, so resumption does not repeat failed parent queries. Refresh mode
ignores both kinds of checkpoint.

The query first collects bounded amenity/charge-point candidates, then applies
the 14 railway-use hints within that named set. This factors the original 240
selectors into 32 spatial primary searches and 14 local hint filters without
changing their raw selection or the geometry/classification rules. It avoids
repeating common railway/landuse value scans for every charger lifecycle key.
The query uses a separate v2 checkpoint namespace: v1 responses and split
decisions are preserved, while expensive-query split routes are not carried
into the optimized query. Completed v2 queries and v2 split decisions remain
resumable. Existing facility v6 caches and the published data schema are unchanged.

Publication requires a nonempty, deduplicated dataset, exact coverage of all
eight world quadrants without gaps/overlaps, and a SHA-256 digest tying the
manifest to the GeoJSON. Failed acquisition preserves prior output. Files are
staged after validation and the manifest is replaced last. Both the traction
publisher and site assembly reject incomplete or mismatched supplement files;
legacy snapshots lacking both files remain usable while the first build is
pending. The published files and coverage must be inspected separately from
fixture rendering checks. Overpass's [admission and rate-limit documentation](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)
distinguishes HTTP 504 admission failures from query execution limits.
The existing v6 supply cache remains separate and reusable. The facility workflow
validates both datasets before publishing. Rendering code alone does not supply
new geometry: the supplementary snapshot must finish and be deployed too.
Same-language style replacement restores cached facility and method data into the
new MapLibre sources without downloading again.
