# Map rendering and data interpretation

[Documentation index](README.md) · [Project overview](../README.md)

For loading gauge view, see the [dimension reference and sources](loading-gauges.md).

## Style and source architecture

Railway Atlas owns the MapLibre style; data providers supply geometry and attributes. `scripts/build-style.mjs` prepares curated station data and calls `scripts/style/compose-style.mjs`. The composition declares the complete bottom-to-top rendering order, including label placement priority, without copying or editing an upstream style.

| Component | Definition | Role |
| --- | --- | --- |
| Basemap | `scripts/style/sources/basemap.mjs` | En Liberté OpenMapTiles-compatible vector geometry and glyphs |
| Railway detail | `scripts/style/sources/railway.mjs` | Shared logical ORM datasets and separate transformed source variants |
| Atlas data | `scripts/style/sources/atlas.mjs` | Published snapshots, curated stations and derived annotations |
| Terrain and imagery | `scripts/style/sources/terrain.mjs` | DEM, contours, satellite and Carto providers |
| Cartography | `scripts/style/layers/` | Atlas-owned land, water, boundaries, terrain, rail views, stations and infrastructure |
| Composition | `scripts/style/compose-style.mjs` | Ordered stack, initial defaults and source-contract enforcement |

`source-contract.mjs` declares the vector source layers and attribute names consumed by the style after adapters enrich them. The build rejects undeclared dependencies. Attributes may be absent on individual features, and this static check does not establish provider availability or completeness. Changing to another OpenMapTiles-compatible provider requires confirming the actual schema and coverage as well as updating its URL and attribution.

Layer metadata declares groups, view restrictions, setting requirements, background suppression and whether text can be localized. The application reads those declarations; a compatibility adapter handles previously cached styles without metadata. Separate owner, axle-load and loading-gauge sources retain their independent loading and shared byte-cache behavior.

The migration regression manifest in `tests/fixtures/style-composition-baseline.json` records ordered layer hashes, source hashes and root rendering settings. Changes to paint, filters, zoom limits, label placement, embedded station data or ordering require deliberate review and baseline updates; `atlas:*` metadata and the project description are excluded. Browser checks complement this definition-level comparison with actual rendering. The initial refactor preserves the reviewed Infrastructure integration's cartography.

## Speed and units

Maximum-speed colouring uses eight bands plus an explicit unknown category.

The railway provider’s `maxspeed` field is normalized to km/h. Where directions differ it represents the preferred direction, or the larger directional limit if no preference is recorded. Its `speed_label` preserves the original units and both directions. Bare numbers mean km/h; `mph` is explicit. `A / B` means OSM-way forward/backward, `A (B)` means preferred/opposite, and `-` means missing. Unknown/non-numeric values stay grey; a high-speed classification is never used to invent a speed limit.

These are mapped infrastructure limits, not train operating speeds, temporary restrictions or timetable information.

The settings switch between metric and imperial units: imperial colours speeds by round mph bands (< 25 … ≥ 185), shows track labels in mph (labels already tagged in mph are kept as tagged, others are converted from the numeric limit), draws contours at foot intervals and switches the scale bar and detail values.

## Station hierarchy

The provider’s station size is based on OSM route importance, not passenger numbers. Major stations have larger markers and first choice of label placement: each importance tier is its own map layer — heavy rail (large, normal, small, then halts), metro, light rail, people movers, monorail, funicular and tram, then former and planned stations from zoom 12 — because MapLibre orders labels by sort key only within a tile, but places layers top-down across all tiles; less complete route mapping can understate station importance.

Zooms 3–6 give reviewed station candidates in `styles/data-src/major-stations.json` priority, with eligibility based on passenger-network role and regional coverage. Zoom 3 preserves its 550 km globe separation and 14-pixel label padding. Regional bands use minimum Mercator separations of 78, 68 and 56 pixels at zooms 4, 5 and 6, and padding of 14, 12 and 10 pixels. Provider stations fill remaining space from zoom 4, so the curated list never caps the worldwide regional inventory. The selection wraps the date line and clamps the poles; globe collision placement still applies. Only one principal station per metro/country enters zooms 3–4. Earlier selections persist, and regional round-robin selection prevents the first region in the file taking all the available space. Additional terminals such as Shinjuku and Grand Central remain deferred when they are too close to Tokyo or New York Penn.

Each generated tier is a separate layer above provider fill at zooms 4–6. Provider duplicates are matched by OSM identity, including aliases and the current cluster-ID suffix, only once the curated replacement reaches its selected tier; stations deferred beyond zoom 6 remain available from the provider. The filter releases at zoom 7 when the curated layers end. Curated names use all recorded OSM translations, `chooseName`/`labelExpression`, and the existing Han-region glyph helpers. The generated GeoJSON is also bundled in the versioned style, so the previous installed worker can cache matching stations before it knows the new standalone file. The app holds that copy outside MapLibre and attaches it only while these labels are relevant, reusing it for language changes. The new worker also caches the standalone file. Curated selection is separate from the provider's mapped `station_size`; panels show its source/basis rather than claiming a ridership measurement. A verified mapped station building can represent a hub whose heavy-rail station point is absent, such as Taipei; its original mapped feature and CC0 point provenance remain recorded in the list.

From zoom 7, regional stations use the provider’s spaced selection without discarding stations classified as small; closer views add more stations with collision spacing. Halts appear from zoom 11, tram stops from zoom 10.

By mode, metro stations appear from zoom 8 (the first station tiles that carry them), light rail, monorails, people movers, trams, funiculars and tram stops from 10, so a tram stop never shows before a metro station. The provider's size counts routes, so a busy people mover can be "large" and most metro stations "small"; names and markers are therefore sized by mode too: heavy rail and metro by station size, light rail and people movers a step smaller than any metro station, trams, funiculars and monorails smaller still. Where markers meet at street zoom, the higher-capacity station's is drawn on top.

Metro tracks are drawn from zoom 7 where data exists (the provider's tiles hold them only from zoom 10); light rail, monorail, tram, funicular and miniature tracks from zoom 10.

Before zoom 12 a marker and its name are placed together with collision detection. From zoom 12 individual markers remain visible when labels collide. Worldwide coverage means global source coverage, not a guarantee that every railway, station or speed is mapped.

## Branch lines at overview zooms

Below zoom 7 the provider's tiles hold main lines only. From zoom 4 the atlas adds operating branch lines from its own [branch-line snapshot](data-maintenance.md#branch-line-snapshot), drawn under the main lines in the same colours, so a line such as the Ban'etsu West Line no longer disappears when zooming out. The snapshot is filled region by region (Japan first); regions not yet fetched show main lines only below zoom 7. Metro lines (`railway=subway`) come from the same snapshot at zooms 7–9, drawn like the detailed tracks in every view (bridges, tunnels and dual gauge included), since the provider's tiles hold them only from zoom 10; regions not yet fetched show metro lines from zoom 10. Train protection on these lines is read from both `railway:<system>` and `railway:train_protection` tags. Refreshed snapshots retain all systems: the first three occupy adjacent colour bands, matching the provider's three-slot limit; additional list values remain available in the infobox. Earlier snapshots require a regional refresh to gain the additional fields.

## Railway structures and track counts

Bridge outlines and tunnel dashes from zoom 7 (the upstream zoom 0–6 overview tiles carry no bridge or tunnel data), or with the track itself for light rail, tram and other urban kinds (zoom 10); click a railway for recorded speed, voltage, frequency, gauge and operator.

Running tracks side by side, counted from the mapped geometry in the browser (`styles/track-count.mjs`, `styles/track-tiles.mjs`; OpenStreetMap maps each track separately and the railway tiles carry no count): from zoom 14 the Infrastructure view puts a boxed number on the middle track of each group of running tracks that keep alongside each other (each within 30 m of the next; between two tunnel tracks 12 m, or 35 m for tracks of the same named line). Sidings, yards, spurs and crossovers are not counted; the count is the most common one over about 300 m along the line; counts are always made on zoom-14 railway tiles with their eight neighbours (a separate `atlastracks` source), so they are the same at every zoom; inside the provider's station areas (areas holding only subway stations leave surface tracks labelled) running tracks are not labelled. Tracks in tunnels count with those beside them on the surface or on viaducts (a line quadrupled with one pair underground, like Keiō's or Odakyū's, or the Ueno–Tokyo Line above the Shinkansen, is one group); a group wholly in tunnels has a grey-blue badge. Light rail and trams are grouped only among themselves (a light rail pair beside a main-line viaduct, as north of Choy Yee Bridge in Tuen Mun, is two pairs). Two ways of a line drawn on the same plan line for more than one probe are two tracks (tunnels stacked one above the other, as south of Austin), while ways meeting end to end are one.

Stations get their own amber badge: every track across the station's area (or within 100 m of a station with no area), sidings included since platform and passing tracks are often mapped as such, yards, spurs and crossovers not; the number is the most tracks one cross-section meets, smoothed over three sections 20 m apart. Tracks on every level count, underground platforms included. One badge per station and kind of railway it serves (an area shared by a light rail stop and a main-line station, like Ho Tin and Tuen Mun, has one for each, counting only that kind's tracks; tram stops have none), written by the tile holding its point and placed inside that tile (on its edge if the widest place lies beyond); it is always drawn, even over a station name. The provider draws one area for a whole stop area group, so differently named stations can share it (Shinjuku and Seibu-Shinjuku, whose area takes in the JR tracks beside it; Nagoya, Kintetsu-Nagoya and Meitetsu-Nagoya). There each surface station of a kind has its own badge, counting its own lines:

- A line goes by its operator, using the provider's operator colour, or by its name where it has no operator. A way with neither (a siding, mostly) takes the operator of the track it leaves.
- An operator's tracks go to the station of that operator in the area. Without one, they go to the station nearest most of their length there.
- Subway stations in such an area count with the surface stations, as the tiles do not say which subway line serves which station.

Station areas and points are read from the same nine tiles as the tracks, so an area reaching into a neighbouring tile is seen whole.

Ways mapped as plain track that are not tracks of their own are recognised from the geometry before counting, since such ways are often left without a `service` tag worldwide. A connector is a way whose ends both leave other tracks at turnouts and which moves across the parallel tracks beside it between its two ends: a single or scissors crossover up to 800 m long, longer than any real one, as a crossover is two turnouts end to end (Tuen Mun's TX32 legs, about 170 m long, were counted as two extra station tracks). It counts neither on the open line nor at a station, as `service=crossover` does. A longer way that ends up on the other side of a track, such as a flyover's approach or a third track, stays a track. A way that runs beside another for half its length or more stays a track, such as a loop or a siding between two tracks. A stub is a way without a `service` tag, shorter than 1.5 km, that leaves a track at a turnout and ends in nothing: a siding or spur. It does not count as a running track on the open line, but still counts at a station (a terminus's platform tracks). Ends at the edge of the tiles read are left alone. Tagging such ways in OpenStreetMap (`service=crossover`, `siding`, `spur`) remains the better fix.

Checked against known track counts in Tokyo, Ōmiya, Takasaki, Nagoya, Hong Kong, Hualien, Berlin, Paris, London, New York, Zürich and on single-track lines; results follow how completely and consistently tracks are tagged in OpenStreetMap.

## Railway lifecycle

The upstream railway tiles exclude planned/construction lines at zoom 7 and former infrastructure until still higher zooms. A **published worldwide lifecycle snapshot** fills that gap without sending viewer requests to Overpass. Railways under construction appear at every zoom, proposed railways from zoom 5, and former (disused, abandoned, razed) lines from zoom 7; metro lines in any state from zoom 7, and light rail, monorail, tram and funicular lines from zoom 10, like operating ones (the snapshot holds no miniature railways). The snapshot tiles start at zoom 5; `scripts/build-overview-tiles.mjs` derives zoom 0–4 tiles holding only construction from them during the site build. The snapshot continues unchanged through zoom 11, and the ordinary detail tiles take over at zoom 12. Full way geometries cross viewport and extraction boundaries without clipping gaps.

Lifecycle patterns are shared between style and SVG legend: construction uses long blocks; proposed uses spaced round dots; disused uses dash-dot; abandoned / removed uses sparse paired dashes. The same patterns apply to regional and detailed data, including the speed view.


See [snapshot maintenance](data-maintenance.md#railway-lifecycle-snapshot) for extraction and publication.

## Satellite and hybrid backgrounds

Satellite shows [EOxCloudless](https://cloudless.eox.at) imagery alone (Sentinel-2, 2025 edition, 10 m per pixel; EOX IT Services GmbH, CC BY-NC-SA 4.0, free for non-commercial use with attribution). Hybrid draws the railways, stations, track counts and level crossings of the chosen view over the imagery; the drawn base map (land use, roads, places, terrain and planning context) is hidden in both. The imagery source stops at zoom 14, close to its own resolution, and is enlarged beyond; EOX's free service applies rate limiting under heavy load.

## Terrain and boundaries

Station symbols use orange markers and bold names with halos, while retaining collision spacing. First-level regional boundaries use OSM admin levels 3/4 where supplied by the basemap; subdivision conventions and coverage differ by country.

Land and seabed shading comes from [Mapzen Terrain Tiles hosted by AWS](https://registry.opendata.aws/terrain-tiles/), including NOAA ETOPO1 bathymetry. See [terrain credits](../styles/terrain-credits.html) for source credits.

The sea also has a continuous depth palette: pale turquoise near sea level,
then progressively bluer at 20, 200, 1,000, 3,000, 6,000 and 11,500 m below
sea level. It reveals shallow reef platforms and atolls where the elevation
data resolves them, including around the Marshall and Spratly Islands, without
requiring OSM reef tags. Existing hillshade and labelled contours remain above
the colours; fine/deep-water lines are fainter so they do not obscure the depth
surface, while shallow and index contours retain more weight. All three follow
the Terrain, seabed and contours setting; satellite
and hybrid retain their imagery.

Depth tiles reuse the existing repaired DEM cache and stop at source zoom 10,
because finer Mapzen tiles lose the seabed values. The basemap's ocean polygons
mask the colour through zoom 14, keeping island holes, lakes and dry land clear.
Only the ocean layer is decoded for this mask, and an inland tile adds no DEM
request. Decoding, colouring, masking and PNG encoding run in a background
worker (`depth-worker.mjs`), so the page's main thread stays free for panning
and zooming; browsers without workers or OffscreenCanvas draw them on the page.
Up to 32 encoded colour tiles are retained. Concurrent basemap/mask
requests share one archive read, with independent cancellation and byte buffers;
no additional raw-vector cache is retained. The mask uses the existing
PMTiles archive; there is no new tile provider or Overpass extraction.

This displays the available depth surface, not a newly surveyed reef outline:
ETOPO1 is approximately one arc-minute (about 1.85 km north–south), so narrow
reef crests and small lagoon details cannot be reconstructed reliably. Mixed
land/sea elevation samples are clamped to sea level inside the ocean mask.
Missing or impossible depths stay transparent. Beyond the Web Mercator limit,
the separately prepared polar caps retain their existing relief and contours.

Contours are calculated in the browser using the pinned maplibre-contour library, reusing the DEM cache with hillshade. Brown lines show land elevation and blue lines show negative seabed elevation, labelled in signed metres. Fine / index intervals are 200 / 1,000 m at zoom 7, 100 / 500 m at 9, 50 / 250 m at 11, 20 / 100 m at 13, and 10 / 50 m at 15.

Ocean bathymetry is generally much coarser than land elevation; extra zoom does not create survey detail.

Beyond 85.05° N and S, where the terrain tiles end, the globe's relief and contours come from NOAA ETOPO 2022 at 60 arc-seconds (about 1.85 km), prepared in advance rather than in the browser. This is not a navigation chart.

## Country and state names

Country names are shown up to zoom 7 in spaced capitals and are placed before station names (the base style faded them out by zoom 6, and station names, placed first, hid most of the rest). States, provinces and prefectures (OpenMapTiles `place` classes `state` and `province`) have their own lighter layer from zoom 4 to 9, below station names in priority.

## Transport interchanges and passenger destinations

The Transport and Destinations display options are enabled by default, remembered with the other settings, and included in shared links. They use the existing worldwide OpenMapTiles archive; no live Overpass calls or additional tile service are introduced.

- Civil airports with IATA codes and international airports are labelled from zoom 8 where supplied by the tiles. Other civil airfields enter at zoom 12; private and military airfields are omitted. Airport grounds, runways (grey lines, taxiways narrower) and mapped ferry routes provide alignment context.
- Bus/coach stations, ferry terminals and cable-car stations have distinct framed icons and names from zoom 12 where available; local bus stops, taxi stands and bicycle rentals appear from zoom 15, with bicycle parking from zoom 17. Harbours/marinas appear from zoom 15 and are not treated as passenger interchanges.
- Hospitals, universities, malls/markets, stadiums, theme parks and visitor attractions receive labels; schools and smaller civic/cultural destinations enter later. Hotels, motels, hostels and guest houses appear from zoom 14 as a bed symbol. Industrial/commercial, retail, education, hospital and major recreation grounds have light coloured fills and outlines. Generic commercial polygons are not asserted to be office parks.
- Railway station names retain placement priority. All context names use the existing shared language selection and fallback rules. Click a transport facility or destination point for its mapped type; museum/cultural destinations, land-use, planning and protected areas, jurisdictions and buildings are visual context only. At zoom 14+, station panels list transport facilities within 500 m straight-line distance from loaded tiles, deduplicating tile buffers. This shows possible transfer context, not a verified walking route or timetable connection.

Coverage and first appearance depend on the provider's source zooms (most detailed POIs are available at zoom 14). OpenMapTiles land-use polygons often contain only a class, without a name; available named POIs supply the labels. Government/community/historic facilities without polygon geometry receive point symbols. Absence in these tiles does not prove that no facility exists. These layers describe potential trip destinations, not measured passenger numbers.

## Roads, buildings and planning context

The subdued base network includes ordinary roads, cycling paths and hiking / walking trails. Local bus stops, taxi stands and bicycle rentals enter at zoom 15, bicycle parking at 17. The station panel lists mapped nearby terminals first, then local facilities; straight-line proximity does not verify a walking connection.

Ordinary building footprints appear faintly from zoom 13, with outlines from zoom 15. They remain visible when Destinations is disabled. Destination symbols, labels and area fills are subdued so railway stations retain prominence.

Protected areas, military grounds, religious institutions and heritage sites have a separate display control. Indigenous territories tagged `boundary=aboriginal_lands` are purple, separate from administrative borders and conservation boundaries. These are mapped planning context, not a determination of legal boundaries or permission to build. Coverage depends on the source tiles.

## Rail-road interfaces

Infrastructure view adds level crossings and ochre roadbeds for explicitly mapped street-running tracks (zoom 13+). Only `embedded=yes` or road `embedded_rails` tags qualify; trams and adjacent roads do not imply sharing. See [street-running snapshots](data-maintenance.md#street-running-snapshot) for publication and refresh behaviour.

Level crossings are shown from zoom 5, so they can be seen across a region hundreds of kilometres wide: dark brown for road crossings (`railway=level_crossing`), light brown for pedestrian ones (`railway=crossing`). They come from the project's own [worldwide crossing tiles](data-maintenance.md#level-crossing-snapshot): an overview set (zoom-5 tiles, each crossing placed within about 150 m, crossings on the same spot drawn once) up to zoom 8, then one clickable point per crossing, linking to its OpenStreetMap node: dots to zoom 10 (a cross cannot be read at that size, and those of a busy network would run together), then a small × for every crossing to zoom 14 (all drawn, none hidden by label placement). Crossings only on tram, light rail, funicular, miniature, service or street-running (`embedded=yes`) tracks are left out of the dots and appear with the × symbols from zoom 11. From zoom 15 the provider's `points_of_interest` tiles draw × symbols whose details give the mapped equipment. Clicking a crossing below zoom 15 shows its tags (barriers, lights, bells, activation and so on) from the detail tiles themselves, without a request; an overview dot (zooms 5–8, where crossings are merged per tile) opens the nearest crossing in the zoom-9 detail tiles.


Infrastructure view shows platform outlines, platform numbers and boarding-edge references from zoom 17. Platform geometry comes from `standard_railway_platforms`; these tiles contain names and typed OSM IDs but omit references. A separate GeoJSON source adds the references returned by `api/feature/openrailwaymap_standard/standard_railway_platforms/<node-, way- or relation-ID>`. Multiple references are shown together; no number is inferred from a platform name or nearby track.

Boarding edges use `standard_railway_platform_edges`. Their references remain visible independently of the full-length lookup, including before a response and when it supplies no valid length. From zoom 19 the edge label also shows its complete length from `api/feature/openrailwaymap_standard/standard_railway_platform_edges/<way id>`, following metric/imperial units. Lengths are never measured from clipped tile geometry or inferred from a platform polygon's perimeter. Platform and edge lookups share one bounded queue of about one request per second, deduplicate objects, cancel when hidden or panned away, cache results, and pause after a 429. Hiding value labels or leaving Infrastructure view stops these lookups.

Mapped railway signals appear from zoom 13 in Infrastructure and Train control, using the dedicated `railway_signals` source plus a worldwide static supplement for signals without a direction tag. References/captions appear from zoom 16. Station entrances remain in Infrastructure from zoom 16, with labels from zoom 17, using `standard_station_entrances`. Purple signal and teal entrance markers use neutral location symbols. Signal inspection shows recorded functions, inactive components and facing direction where supplied; it does not report a live signal aspect. Each point links to its exact OSM node. The value-label setting hides their text while keeping the location markers.

These layers are independent of the original demo styles and remain visible over Hybrid/Carto backgrounds; Satellite hides overlays. Entrances follow the provider's import of `railway=subway_entrance` and `train_station_entrance`. Its direction-table join omits undirected signals, which the Atlas supplement supplies from all worldwide extraction regions. The supplement uses zoom-12 overview and zoom-16 precise point tiles; both overzoom to the marker range and share the provider markers' paint and inspection. Other entrance tags and unmapped facilities remain outside this coverage. The verified source schemas are [tile views](https://github.com/hiddewie/OpenRailwayMap-vector/blob/3c8942fa5c9403fe66fa91485ccec8c9e33a5436/import/sql/tile_views.sql), [signal processing](https://github.com/hiddewie/OpenRailwayMap-vector/blob/3c8942fa5c9403fe66fa91485ccec8c9e33a5436/import/sql/signal_features.sql.mjs) and [entrance import tests](https://github.com/hiddewie/OpenRailwayMap-vector/blob/3c8942fa5c9403fe66fa91485ccec8c9e33a5436/import/test/test_import_entrance.lua).

### Carto background

Carto uses the OSMF Standard raster tiles, with visible attribution and normal browser caching; the service worker never handles these tiles. The drawn basemap and its duplicate place/context labels are hidden, while railway overlays and optional relief/contours remain. Beyond the Mercator limit the custom polar layer uses Carto land, water and ice colours, restored finer contour bands and tiled OSM roads/paths, waterways, airport details, buildings and facility labels. Detailed polar data is loaded and drawn only for Carto; other backgrounds retain their coarsest contours, and satellite/hybrid retain black caps. Older snapshots containing only the coarsest band remain compatible. See [polar data and resolution](data-maintenance.md#polar-caps). The tile URL is centralized as `CARTO_TILES` in `map-model.mjs`. See the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

See [Axle load](axle-load.md) for the new view, national class distinctions, source references and the 28-day snapshot refresh.

## Concurrent train control and railway energy supplies

Control tracks use adjacent longitudinal colour bands for all distinct recorded
systems in provider slots 0–2 at every scale, including branch and metro
overviews. Repeated codes and empty slots do not create extra bands; unknown
codes retain a grey band. Each system keeps its own legend entry even when
colours coincide. Short names in the legend and infobox have full descriptions
on hover, and expandable explanations for touch and keyboard users.

The Power view adds dedicated railway supply facilities independently of
transport and destination context settings. See [railway energy supplies](power-facilities.md)
for supported tags, zooms, lifecycle treatment and source limitations.
