# Railway data: speed and stations

## Maximum speed

The railway provider’s `maxspeed` field is normalized to km/h. Where directions differ it represents the preferred direction, or the larger directional limit if no preference is recorded. Its `speed_label` preserves the original units and both directions. Bare numbers mean km/h; `mph` is explicit. `A / B` means OSM-way forward/backward, `A (B)` means preferred/opposite, and `-` means missing. Unknown/non-numeric values stay grey; a high-speed classification is never used to invent a speed limit. These are mapped infrastructure limits, not train operating speeds, temporary restrictions or timetable information.

### Units

Display options switch between metric and imperial units: imperial colours speeds by round mph bands (< 25 … ≥ 185), shows track labels in mph (labels already tagged in mph are kept as tagged, others are converted from the numeric limit), draws contours at foot intervals and switches the scale bar and detail values.

## Stations

The provider’s station size is based on OSM route importance, not passenger numbers. Major stations have larger markers and first choice of label placement: each importance tier is its own map layer — heavy rail (large, normal, small, then halts), metro, light rail, people movers, monorail, funicular and tram, then former and planned stations from zoom 12 — because MapLibre orders labels by sort key only within a tile, but places layers top-down across all tiles; less complete route mapping can understate station importance. Major stations appear from zoom 6. From zoom 7, regional stations use the provider’s spaced selection without discarding stations classified as small; closer views add more stations with collision spacing. Halts and urban stations appear from zoom 11, and tram stops from zoom 13. Before zoom 12 a marker and its name are placed together with collision detection. From zoom 12 individual markers remain visible when labels collide. Worldwide coverage means global source coverage, not a guarantee that every railway, station or speed is mapped.
