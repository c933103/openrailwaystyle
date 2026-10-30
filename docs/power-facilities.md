# Railway energy supply facilities

Power is intended to represent the whole electricity grid and the railway fuel
supply chain, including train servicing. The current implementation covers the
railway-related facilities selected below; the whole-grid and wider production,
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
Facilities are drawn as they are mapped, the way topographic maps draw built
structures: a facility mapped as an area (depot, tank footprint, coaling stage,
substation, power station) is its outline with one neutral man-made fill; one
mapped as a line is a line; one mapped as a point (water crane, small supply
point) is a small plain dot. All kinds share the same ink: there are no
pictograms, no colour by supply group and no type or name text on the map,
following OpenStreetMap's standard style and OpenInfraMap, which print names
or values but never type words. Planned and former facilities are fainter with
a dashed outline and follow the planned/former infrastructure setting.
Selecting a facility shows its recorded type, status, operator, voltage,
frequency, supplies, contents and output where available.

The maintenance snapshot keeps each facility's geometry (Overpass `out geom`):
closed ways and multipolygon relations become areas with their holes, open
ways lines, nodes points. A relation without rings keeps its centre point.
Cached Overpass responses are reused only for the exact current query, so
earlier centre-point responses are not mixed into a shape snapshot.

The Power legend is a fixed key, not a list of what is in view: every current
system with its voltage range (lighter is lower voltage), the facility drawing
(an outlined area and a dot, with their planned/former forms when that setting
is on), and every means-of-delivery stroke. Track strokes are not labelled with
type words either; the legend explains them.

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

## Means of power delivery and traction, charging and catenary equipment

Power view draws how power reaches the train, and how the train is propelled
or held, as strokes beside or along the track from zoom 10. Several can show on
one track (for example `electrified=contact_line;rail`):

| Recorded tag | Stroke |
|---|---|
| `electrified=contact_line` | the track colour alone (overhead contact line) |
| `electrified=rail` | dashed, one side, in the system colour (third rail) |
| `electrified=4th_rail` | dashed on both sides (third and fourth rail) |
| `electrified=ground-level_power_supply` | dotted light centre line |
| `electrified=inductive` | dash-dot, one side, in the system colour |
| `propulsion=linear_motor` | purple centre line |
| `rack=*` (`yes`, `abt`, `strub`, `riggenbach`, …; not `no`), or `traction=rack` | dark ladder ticks along the track |
| `traction=cable` | dark long dashes, one side |

Funiculars (`railway=funicular`, about 2,600 OSM ways) are cable-hauled by
definition and take the cable stroke from the provider's `feature=funicular`;
`traction=cable` (about 15 ways, e.g. street cable cars) still comes from the
snapshot. In the Infrastructure view funiculars have their own track colour
and rack railways the same ladder ticks as here.

Aerial cableways and lifts show in the Infrastructure and Power views from zoom
12, drawn as OSM Carto draws them: a thin grey cable with dark ticks. Cable cars,
gondolas and mixed lifts (`aerialway=cable_car|gondola|mixed_lift`, about 3,200
OSM ways) have close ticks; chair, drag, T-bar, J-bar and platter lifts have
sparse ticks. They come from the basemap's `transportation` layer
(OpenMapTiles `class=aerialway` and its `subclass`), so no snapshot is needed;
other `aerialway=*` values and stations are not drawn as lines. They stay over
hybrid imagery and are left to the Carto raster, which already draws them.
Clicking one shows its name, kind and OSM way. The name comes from the basemap's
`transportation_name` layer under the same feature id, and the link uses the
existing basemap id rule (OSM id × 10 + type), checked for aerialways against the
live archive and the OSM API. Lines merged at lower zooms carry other ids and get
no link.

`rack=*` (about 2,100 positive OSM ways in October 2026, against 34 for
`traction=rack`) is read straight from the provider's detailed railway tiles,
which carry it as `rack`; the track inspector names the rack system. The
maintenance snapshot keeps the rarer `traction=rack`.

Lifecycle prefixes are honoured; planned and former tracks are faded and follow
the planned/former setting. The legend draws each sample from the same stroke
definitions as the map. Method labels appear from zoom 12 and follow Labels;
clicking a stroke shows its method, propulsion, traction, recorded
voltage/frequency, conductor contact position (`electrified:rail`) and OSM way.
Power colours still follow the electrical system. The supplement keeps these
tags because the provider's railway line tiles carry voltage/frequency but
discard `electrified`; overhead contact line, by far the most common, is the
electrified track without another recorded means. Unknown method or low DC
voltage alone never establishes third rail. Snapshots built before the
per-method fields existed are read from their recorded method until the next
snapshot replaces them.

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
