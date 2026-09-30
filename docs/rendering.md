# Map rendering and data interpretation

[Documentation index](README.md) · [Project overview](../README.md)

## Speed and units

Maximum-speed colouring uses eight bands plus an explicit unknown category.

The railway provider’s `maxspeed` field is normalized to km/h. Where directions differ it represents the preferred direction, or the larger directional limit if no preference is recorded. Its `speed_label` preserves the original units and both directions. Bare numbers mean km/h; `mph` is explicit. `A / B` means OSM-way forward/backward, `A (B)` means preferred/opposite, and `-` means missing. Unknown/non-numeric values stay grey; a high-speed classification is never used to invent a speed limit.

These are mapped infrastructure limits, not train operating speeds, temporary restrictions or timetable information.

Display options switch between metric and imperial units: imperial colours speeds by round mph bands (< 25 … ≥ 185), shows track labels in mph (labels already tagged in mph are kept as tagged, others are converted from the numeric limit), draws contours at foot intervals and switches the scale bar and detail values.

## Station hierarchy

The provider’s station size is based on OSM route importance, not passenger numbers. Major stations have larger markers and first choice of label placement: each importance tier is its own map layer — heavy rail (large, normal, small, then halts), metro, light rail, people movers, monorail, funicular and tram, then former and planned stations from zoom 12 — because MapLibre orders labels by sort key only within a tile, but places layers top-down across all tiles; less complete route mapping can understate station importance.

Major stations appear from zoom 6. From zoom 7, regional stations use the provider’s spaced selection without discarding stations classified as small; closer views add more stations with collision spacing. Halts and tram stops appear from zoom 11.

By mode, metro stations appear from zoom 8 (the first station tiles that carry them), light rail, monorails and people movers from 10, and trams, funiculars and tram stops from 11, so a tram stop never shows before a metro station. The provider's size counts routes, so a busy people mover can be "large" and most metro stations "small"; names and markers are therefore sized by mode too: heavy rail and metro by station size, light rail and people movers a step smaller than any metro station, trams, funiculars and monorails smaller still. Where markers meet at street zoom, the higher-capacity station's is drawn on top.

Before zoom 12 a marker and its name are placed together with collision detection. From zoom 12 individual markers remain visible when labels collide. Worldwide coverage means global source coverage, not a guarantee that every railway, station or speed is mapped.

## Branch lines at overview zooms

Below zoom 7 the provider's tiles hold main lines only. From zoom 4 the atlas adds operating branch lines from its own [branch-line snapshot](data-maintenance.md#branch-line-snapshot), drawn under the main lines in the same colours, so a line such as the Ban'etsu West Line no longer disappears when zooming out. The snapshot is filled region by region (Japan first); regions not yet fetched show main lines only below zoom 7. Train protection on these lines is read from the `railway:<system>` tags, approximating the provider's own choice of first system.

## Railway structures and track counts

Bridge outlines and tunnel dashes from zoom 7 (the upstream zoom 0–6 overview tiles carry no bridge or tunnel data); click a railway for recorded speed, voltage, frequency, gauge and operator.

Running tracks side by side, counted from the mapped geometry in the browser (`styles/track-count.mjs`, `styles/track-tiles.mjs`; OpenStreetMap maps each track separately and the railway tiles carry no count): from zoom 14 the Infrastructure view puts a boxed number on the middle track of each group of running tracks that keep alongside each other (each within 30 m of the next; between two tunnel tracks 12 m, or 35 m for tracks of the same named line). Sidings, yards, spurs and crossovers are not counted; the count is the most common one over about 300 m along the line; counts are always made on zoom-14 railway tiles with their eight neighbours (a separate `atlastracks` source), so they are the same at every zoom; inside the provider's station areas (areas holding only subway stations leave surface tracks labelled) running tracks are not labelled. Tracks in tunnels count with those beside them on the surface or on viaducts (a line quadrupled with one pair underground, like Keiō's or Odakyū's, or the Ueno–Tokyo Line above the Shinkansen, is one group); a group wholly in tunnels has a grey-blue badge.

Stations get their own amber badge: every track across the station's area (or within 100 m of a station with no area), sidings included since platform and passing tracks are often mapped as such, yards, spurs and crossovers not; the number is the most tracks one cross-section meets, smoothed over three sections 20 m apart. Tracks on every level count, underground platforms included. One badge per station, written by the tile holding its point; it is always drawn, even over a station name.

Checked against known track counts in Tokyo, Ōmiya, Takasaki, Nagoya, Hong Kong, Hualien, Berlin, Paris, London, New York, Zürich and on single-track lines; results follow how completely and consistently tracks are tagged in OpenStreetMap.

## Railway lifecycle

The upstream railway tiles exclude planned/construction lines at zoom 7 and former infrastructure until still higher zooms. A **published worldwide lifecycle snapshot** fills that gap without sending viewer requests to Overpass. Railways under construction appear at every zoom, proposed railways from zoom 5, and former (disused, abandoned, razed) lines from zoom 7. The snapshot tiles start at zoom 5; `scripts/build-overview-tiles.mjs` derives zoom 0–4 tiles holding only construction from them during the site build. The snapshot continues unchanged through zoom 11, and the ordinary detail tiles take over at zoom 12. Full way geometries cross viewport and extraction boundaries without clipping gaps.

Lifecycle patterns are shared between style and SVG legend: construction uses long blocks; proposed uses spaced round dots; disused uses dash-dot; abandoned / removed uses sparse paired dashes. The same patterns apply to regional and detailed data, including the speed view.


See [snapshot maintenance](data-maintenance.md#railway-lifecycle-snapshot) for extraction and publication.

## Satellite and hybrid backgrounds

Satellite shows [EOxCloudless](https://cloudless.eox.at) imagery alone (Sentinel-2, 2025 edition, 10 m per pixel; EOX IT Services GmbH, CC BY-NC-SA 4.0, free for non-commercial use with attribution). Hybrid draws the railways, stations, track counts and level crossings of the chosen view over the imagery; the drawn base map (land use, roads, places, terrain and planning context) is hidden in both. The imagery source stops at zoom 14, close to its own resolution, and is enlarged beyond; EOX's free service applies rate limiting under heavy load.

## Terrain and boundaries

Station symbols use orange markers and bold names with halos, while retaining collision spacing. First-level regional boundaries use OSM admin levels 3/4 where supplied by the basemap; subdivision conventions and coverage differ by country.

Land and seabed shading comes from [Mapzen Terrain Tiles hosted by AWS](https://registry.opendata.aws/terrain-tiles/), including NOAA ETOPO1 bathymetry. See [terrain credits](../styles/terrain-credits.html) for source credits.

Contours are calculated in the browser using the pinned maplibre-contour library, reusing the DEM cache with hillshade. Brown lines show land elevation and blue lines show negative seabed elevation, labelled in signed metres. Fine / index intervals are 200 / 1,000 m at zoom 7, 100 / 500 m at 9, 50 / 250 m at 11, 20 / 100 m at 13, and 10 / 50 m at 15.

Ocean bathymetry is generally much coarser than land elevation; extra zoom does not create survey detail.

Beyond 85.05° N and S, where the terrain tiles end, the globe's relief and contours come from NOAA ETOPO 2022 at 60 arc-seconds (about 1.85 km), prepared in advance rather than in the browser. This is not a navigation chart.

## Transport interchanges and passenger destinations

The Transport and Destinations display options are enabled by default, remembered with the other settings, and included in shared links. They use the existing worldwide OpenMapTiles archive; no live Overpass calls or additional tile service are introduced.

- Civil airports with IATA codes and international airports are labelled from zoom 8 where supplied by the tiles. Other civil airfields enter at zoom 12; private and military airfields are omitted. Airport grounds, runways (grey lines, taxiways narrower) and mapped ferry routes provide alignment context.
- Bus/coach stations, ferry terminals and cable-car stations have distinct framed icons and names from zoom 12 where available; local bus stops, taxi stands and bicycle rentals appear from zoom 15, with bicycle parking from zoom 17. Harbours/marinas appear from zoom 15 and are not treated as passenger interchanges.
- Hospitals, universities, malls/markets, stadiums, theme parks and visitor attractions receive labels; schools and smaller civic/cultural destinations enter later. Hotels, motels, hostels and guest houses appear from zoom 14 as a bed symbol. Industrial/commercial, retail, education, hospital and major recreation grounds have light coloured fills and outlines. Generic commercial polygons are not asserted to be office parks.
- Railway station names retain placement priority. All context names use the existing shared language selection and fallback rules. Click a facility or area for its mapped type. At zoom 14+, station panels list transport facilities within 500 m straight-line distance from loaded tiles, deduplicating tile buffers. This shows possible transfer context, not a verified walking route or timetable connection.

Coverage and first appearance depend on the provider's source zooms (most detailed POIs are available at zoom 14). OpenMapTiles land-use polygons often contain only a class, without a name; available named POIs supply the labels. Government/community/historic facilities without polygon geometry receive point symbols. Absence in these tiles does not prove that no facility exists. These layers describe potential trip destinations, not measured passenger numbers.

## Roads, buildings and planning context

The subdued base network includes ordinary roads, cycling paths and hiking / walking trails. Local bus stops, taxi stands and bicycle rentals enter at zoom 15, bicycle parking at 17. The station panel lists mapped nearby terminals first, then local facilities; straight-line proximity does not verify a walking connection.

Ordinary building footprints appear faintly from zoom 13, with outlines from zoom 15. They remain visible when Destinations is disabled. Destination symbols, labels and area fills are subdued so railway stations retain prominence.

Protected areas, military grounds, religious institutions and heritage sites have a separate display control. Indigenous territories tagged `boundary=aboriginal_lands` are purple, separate from administrative borders and conservation boundaries. These are mapped planning context, not a determination of legal boundaries or permission to build. Coverage depends on the source tiles.

## Rail-road interfaces

Infrastructure view adds level crossings and ochre roadbeds for explicitly mapped street-running tracks (zoom 13+). Only `embedded=yes` or road `embedded_rails` tags qualify; trams and adjacent roads do not imply sharing. See [street-running snapshots](data-maintenance.md#street-running-snapshot) for publication and refresh behaviour.

Level crossings are shown from zoom 11, together with tram tracks and service tracks: dark brown for road crossings (`railway=level_crossing`), light brown for pedestrian ones (`railway=crossing`). Up to zoom 14 they come from the project's own [worldwide crossing tiles](data-maintenance.md#level-crossing-snapshot) as a small × for every crossing (all drawn, none hidden by label placement), each clickable and linking to its OpenStreetMap node. From zoom 15 the provider's `points_of_interest` tiles draw × symbols whose details give the mapped equipment.
