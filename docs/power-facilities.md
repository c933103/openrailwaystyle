# Railway energy supply facilities

The Power view adds electricity supply facilities, locomotive fuel and coal
supplies, and water supplies for steam locomotives. They follow the recorded
OpenStreetMap use of each facility. A roadside filling station, utility
substation or municipal water tank is not classified as a railway supply just
because it is near a track. Fuel facilities are labelled as locomotive fuel
unless a fuel type is actually recorded; diesel is not assumed.

At regional zoom, railway power plants appear from zoom 10 and traction
substations from 11. Generators and converters appear from 12. Locomotive fuel,
coal and water facilities appear from 13, and traction feeding points from 14.
The markers use **E** for electricity, **F** for liquid fuel, **C** for coal and
**W** for steam water. Selecting a marker shows its recorded type, status,
operator, voltage, frequency, contents and output where available. Former and
planned supplies follow the existing planned/former infrastructure setting;
former supplies have hollow markers. Text references follow the Labels setting.

The legend uses the same circular E/F/C/W symbols, colours and lifecycle
appearance as the map. With planned/former infrastructure enabled, a hollow
sample appears beside each filled sample; the existing track-line keys remain
separate. Its servicing labels are “Train refuelling point (fuel type where
mapped)”, “Steam engine coaling” and “Steam engine water”. These legend categories
share marker metadata with the mapped facilities; they do not establish a fuel
or confirm that a facility is usable. The wider selection, wording and
presentation audit remains open in [issue #115](https://github.com/c933103/openrailwaystyle/issues/115).

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

General-grid generation whose railway customers are not recorded in OSM cannot
be identified from the tags. Facilities missing the railway use tags do not
appear as railway supplies. The map shows mapped supplies, not a live power
network, operating status feed or proof that a steam facility remains usable.

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
split decisions for 28 days. Uncached quadrants start with a uniform 45° × 45°
query grid (32 cells), before making any requests. This fixed plan creates no
failure checkpoint and retains the same failure classification. Completed larger
responses take precedence, so the six coarse regions acquired by the first v2
production run remain reusable. Planned cells share the existing depth ceiling;
only explicit execution-limit responses can subdivide them further.
Each run has hard limits of 96 requests, 100 MB of
downloaded response bodies and one hour, with three attempts per query and at
most six subdivision levels. HTTP request/authentication failures, malformed
JSON, unknown error remarks and incomplete geometry terminate immediately.
HTTP 408/429/500/502/503/504 and temporary transport failures retry the same box;
they never cause spatial fan-out. Connection/header/body timeouts and opaque
fetch deadlines are transport failures too: a stalled connection does not
establish a spatial query failure. Only explicit Overpass query timeout or
memory-limit responses can subdivide after exhausting retries. Retry-After is
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
