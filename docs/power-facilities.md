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
