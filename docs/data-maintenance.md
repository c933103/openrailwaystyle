# Data sources and maintenance

[Documentation index](README.md) · [Project overview](../README.md)

## Sources and attribution

The quiet base-map layers, colours and design originate in this repository. Its global base source is `https://tuiles.enliberte.fr/planet.pmtiles`. Railway data comes from the independently hosted [OpenRailwayMap vector service](https://openrailwaymap.app/), whose [usage policy](https://github.com/hiddewie/OpenRailwayMap-vector/blob/master/USAGE.md) permits clearly attributed public applications without registration. The site loads only the current view and has no offline downloader or tile prefetcher. Attribution remains visible on the map and on the ? help page (with its licences and terms of use). The site does not copy the provider’s GPL rendering code; its new railway styling is independently authored against the documented tile fields.

The repository code is licensed under [Apache 2.0](../LICENSE). Map data and third-party assets retain their own licences and attribution requirements. Lifecycle and street-running GeoJSON databases are distributed under ODbL; see their manifests and downloads on the **?** help page. Terrain sources are credited in [terrain-credits.html](../styles/terrain-credits.html), and language-boundary sources are detailed in [label regions](labels.md#geographic-regions-and-boundary-sources).

## Railway lifecycle snapshot

The maintenance build (`.github/workflows/snapshot.yml`) extracts disjoint world regions sequentially, subdivides dense regions when necessary, deduplicates OSM way IDs, retains name translations, and produces a PMTiles archive plus an ODbL GeoJSON database. It refuses to publish an incomplete extraction and checks the north–south extent of 남부내륙선.

The manifest records each region’s OSM timestamp and feature count. The `rail-data` branch stores the published files; ordinary site builds unpack the archive into compressed static vector tiles without rerunning extraction. A compact tile index skips empty areas. This avoids GitHub Pages’ unreliable compressed archive range responses; the browser decodes whole tile files instead.

The raw Overpass responses are kept in the `overpass-cache` release (the Actions cache expires after a week unused), so a rebuild after a change to `scripts/lifecycle.mjs` needs no Overpass queries.

A scheduled run on Monday, Wednesday and Friday at 03:23 UTC (night across Europe, where most users of the public Overpass server are) asks Overpass only for ways changed since the previous run (`scripts/snapshot-delta.mjs`): changed planned, construction and former ways with geometry, and the IDs of changed operating ways, so a line that opens disappears from the snapshot within a few days.

It also re-downloads the oldest ~5 MB of full region responses (`scripts/refresh-snapshot-cache.mjs`), catching what change queries miss, such as deleted ways (the whole world is renewed about every eight weeks), and fetches the loading gauge of every railway way as a CSV list of way IDs (`scripts/build-loading-gauge-list.mjs`, about 4 MB), which colours the zoom 0–6 overview of the Loading gauge view, since no overview tiles carry loading gauge.

A run is about 40 queries and 10 MB, within the Overpass API wiki's guidance for regular applications (under 100 queries and 10 MB a day); a region file larger than 5 MB still goes whole, so an occasional run is larger. Map visitors never query Overpass.

Each run publishes the snapshot and redeploys the site; the manifest records each region's OSM date and the time changes were applied up to. `rail-data` is replaced by a single commit on each publish, so the repository keeps only the current snapshot.

For faster global refreshes, use planet/regional dumps or your own Overpass instance rather than querying public servers more often.

## Polar caps

Web Mercator tiles, which every map source here uses, end at 85.05° N and S; on the globe the two caps beyond (about 550 km from each pole to the edge) are drawn from data prepared in a polar projection (`scripts/build-polar.mjs`, published with the railway snapshot): water, ice shelves, runways and place names from OpenStreetMap, and relief shading and contours from NOAA ETOPO 2022 (60 arc-second).

Carto alone uses the restored finer contour bands: 100 m land / 20 m seabed from equatorial zoom 9, and 50 m / 10 m from zoom 11 (with corresponding independent feet-based intervals). The 2×2 and 4×4 tiles are requested only where viewed. Other backgrounds keep band zero; satellite/hybrid retain black caps. Carto also loads static 4×4 OSM detail tiles for roads, paths, waterways, taxiways, aprons, buildings and named facilities/peaks. Detail starts at equatorial zoom 10, facility labels at 12 and building footprints at 13; metre-precision encoding preserves small station buildings. Changing away from Carto cancels pending detail requests and releases detailed meshes. Existing off-view byte/count budgets remain in force.

These are the existing caps **beyond 85.05°**, not replacement tiles for the entire Arctic or Antarctic. Restoring isoline density does not increase DEM resolution: ETOPO's **surface** product is still sampled on a 1.5 km polar grid. This includes the ice surface in ice-covered terrain and seabed at negative elevations; it must not be described as subglacial bedrock or a detailed local survey. Each index records the source/product/grid metadata. Separate ice/bedrock terrain products require the terrain-source work described elsewhere.

The lifecycle workflow prepares these assets with `scripts/build-polar.mjs`, both on its regular schedule and when maintenance source changes reach `main`. OpenStreetMap cap queries are renewed every four weeks; detail acquisition is split into four cached longitude sectors per cap. HTTP-200 timeout/partial responses are rejected before caching. If a source is unavailable a validated cached copy is used. Builds are staged and replace both caps only when complete; the workflow restores the previous published assets first and retains them after a failed rebuild. On a first run without cached data the optional caps are omitted rather than publishing a partial build. A maintenance operator can run `node scripts/build-polar.mjs` separately without rebuilding the railway archive; visitors never issue Overpass queries.

## Street-running snapshot

The workflow [street-running.yml](../.github/workflows/street-running.yml) runs weekly on Sunday at 03:27 UTC and can be run manually. It builds a validated worldwide Overpass extract of explicitly mapped shared roadway, then publishes the complete tiles atomically to `street-data`. Failed refreshes retain the last published snapshot.

Each website build copies `12/`, `index.json`, `manifest.json` and `street-running.geojson.gz` into `styles/data/street-running/`. The manifest and ODbL GeoJSON download are linked under About. Visitors do not make Overpass requests. See [rail-road rendering](rendering.md#rail-road-interfaces) for qualifying tags and display zooms.

## Level-crossing snapshot

The workflow [crossings.yml](../.github/workflows/crossings.yml) keeps a worldwide table of OpenStreetMap level crossings (about 1.2 million `railway=level_crossing` and `railway=crossing` nodes) and publishes it with its tiles to `crossing-data`, one commit replaced each time. `scripts/build-crossings.mjs` queries Overpass one region at a time (45° squares, split into quarters where a query times out, with the split remembered), in CSV with an end marker so a truncated response is rejected. Each crossing is flagged *minor* when every railway way through it is a tram, light rail, funicular or miniature railway, a service track (`service=*`) or street running (`embedded=yes`); the query returns the major crossings, a marker row, then the minor ones.

- The first run fetches every region (about 45 MB). A table from before the minor flag (no `version: 2` in `regions.json`) is fetched anew the same way, since a change query cannot fill in the flag for unchanged crossings.
- The weekly run (Sunday 04:17 UTC) fetches the crossings changed since the previous run, then refreshes in full the regions checked longest ago, about 5 MB, which removes deleted and retagged crossings.
- A table under 900,000 crossings, or more than 5% smaller than the last, is not published; the last snapshot stays.

Each website build copies the tiles (`5/` overview, `9/` detail), `index.json`, `manifest.json` and the ODbL table `crossings.tsv.gz` into `styles/data/level-crossings/`. Before the first snapshot exists the site deploys without them. See [rail-road rendering](rendering.md#rail-road-interfaces) for how they are drawn.

## Branch-line snapshot

OpenRailwayMap's zoom 0–6 tiles hold main lines only (`usage=main`), so branch lines (`usage=branch`, for example most JR local lines) appeared only from zoom 7. The workflow [branch-lines.yml](../.github/workflows/branch-lines.yml) keeps a worldwide table of operating branch lines (`railway=rail` or `narrow_gauge`, `usage=branch`, not service track), and of metro lines (`railway=subway`, not service track), which the provider's tiles hold only from zoom 10, simplified to about 50 m, and publishes it with tiles to `branch-data` (branch lines at z4–6, metro lines at z7–9), one commit replaced each time. `scripts/build-branch-lines.mjs` converts the tags to the fields of OpenRailwayMap's railway tiles (speed, current, gauge, loading gauge and train protection systems), so each view colours them as it colours the detailed tracks. The first three distinct protection systems occupy adjacent colour bands; the full recorded list remains available for inspection.

- Regions are fetched in stages, in this order: Japan; the Koreas, Taiwan, Hong Kong, Macau and Guangdong; the rest of China; Russia; the rest of Europe; India; the rest of Asia; the US and Canada; the rest of the Americas; the rest of the world. Countries fetched in an earlier stage are left out of later downloads.
- One stage per run, every six hours (minute 41), each run capped at 220 MB of downloads, with a 15-second pause between requests, and no run starts once 900 MB were downloaded in the last 24 hours (manual and push-triggered runs count too): under the public Overpass server's guidance of about 1 GB and 10,000 requests a day. A stage too large for one run continues in the next; a query that times out is split into quarters.
- A snapshot from before concurrent train-control fields were added (`version` below 3 in `state.json`) has every stage fetched again in order, keeping its existing lines and maintenance history until each stage is replaced.
- Once every stage is in, a run refreshes the stage checked longest ago when it is two weeks old, removing deleted and retagged lines; a refresh that would remove more than 20% of a stage's lines keeps them instead (an incomplete response is the likelier cause) and is tried again at the stage's next refresh.

Each website build copies the tiles, `index.json`, `manifest.json` (stages, counts, last run) and the ODbL table `branch-lines.ndjson.gz` into `styles/data/branch-lines/`.

## Urban rail services

The Service view draws metro, light rail, tram, monorail and commuter rail services along the tracks they run on; no tile provider carries them. The workflow [service-routes.yml](../.github/workflows/service-routes.yml) keeps a worldwide table of OpenStreetMap route relations (`type=route` with `route=subway`, `light_rail`, `tram` or `monorail`, or `route=train` with `service=commuter` or `urban`; never other trains) and the track ways they list, and publishes it with tiles (z7–12, light rail, trams and monorails from z10) to `service-data`, one commit replaced each time (`scripts/service-routes.mjs`, `scripts/build-service-routes.mjs`).

- Both directions and variants of a service are one route: the same kind, network, reference and colour (and name, without a reference), in the same place. Relations with that key that share a track or lie within about 10 km of each other are grouped when the tiles are made, from every relation any box or stage found, so two cities' "Metro" line 1 stay apart and a line whose branch was found in another box is still drawn once. Its name drops the direction ("(Southbound)", ": A → B"); it links to its lowest relation id.
- A stage's pass stages everything it finds (memberships, route details, geometry) and commits it only when complete; a rejected refresh changes nothing.
- The table records which stage found each route and each way's routes by stage; a stage's refresh replaces only its own part, so routes another stage found on a shared way stay.
- Each tile feature is one route on one way, with its place (`i` of `n`) among the routes on that way, so the style draws routes sharing a track side by side; ways run west to east so that a route keeps its side from one way to the next.
- Regions are fetched in the branch lines' stages and with the same mechanics (splitting, refresh every two weeks, the 20% guard), every six hours at minute 11, each run capped at 50 MB and no run once 100 MB were downloaded in 24 hours, so with the branch lines (up to 900 MB) the public server's guidance of about 1 GB a day holds.

Each website build copies the tiles, `index.json`, `manifest.json` and the ODbL table `service-routes.ndjson.gz` into `styles/data/service-routes/`; until the first run publishes, the Service view shows the tracks only.

## Published data and caches

| Location | Contents | Updated by |
| --- | --- | --- |
| `rail-data` branch | Lifecycle archive parts, manifest, loading-gauge list and optional polar assets | `snapshot.yml` |
| `axle-data` branch | Compact railway axle capacity/load-category lookup and snapshot date | `axle-load.yml` |
| `street-data` branch | Street-running static tiles, index, manifest and GeoJSON | `street-running.yml` |
| `crossing-data` branch | Level-crossing table, region state, static tiles, index and manifest | `crossings.yml` |
| `overpass-cache` release | Raw responses for rebuilding the lifecycle snapshot | `snapshot.yml` |
| `styles/data/` in the built site | Assembled published snapshots | `site.yml` |

Use the published snapshots for local development; [setup instructions](development.md#load-published-map-data) avoid a new worldwide extraction. The workflows are the executable source of truth for schedules and publishing steps; update this guide when they change.

## Curated major stations

The reviewed source is `styles/data-src/major-stations.json`; the build generates the versioned `styles/major-stations.geojson` and bundles the same data in `world.style.json` for the first upgrade from the previous installed worker. This initial list contains 181 independently checked priority candidates across ten regions. It is not the map's complete station inventory: provider stations fill the remaining space at zooms 4–6 beneath the curated hubs, including the provider copy of a curated identity. Zoom 3 retains the previous globe selection. The curated selection admits closer candidates at each regional band without deferring the previously selected hubs; collision placement determines the labels actually visible on screen. The band spacing and padding live in `MAJOR_STATION_DENSITY` in `scripts/major-stations.mjs`. Chicago Union, New York Penn, Tokyo, Taipei, Beijing and Shanghai retain their principal-hub priority; adjacent secondary terminals can remain deferred to the ordinary provider labels.

For edits, choose a passenger-network role first, then verify the OSM object and an independently linked Wikidata identity/coordinate. `mappedFeature` records whether the object is a railway/public-transport station or a station building; never relabel a stop area, bus terminal or subway point as heavy rail. Coordinates come from OSM nodes or Wikidata CC0 for mapped areas/buildings. Keep one plain `name` only as a human-readable maintenance note beside the coordinates; it is never emitted to map data. Do not store `name:*` translations here. Display names and translations are read from the identified OSM object at runtime. Keep type/ID aliases, country, metro, region, minimum eligibility zoom, manual priority, verification date and source/basis links. No passenger counts are asserted without a source. Cross-check the country against the station’s Wikidata `P17` claim and ISO country code (following a constituent country’s parent if needed); record `countryEvidence` and `countrySource`. The build rejects conflicts. Country checks cover every candidate. The Nigeria Lagos entry uses mapped Mobolaji Johnson Station; the unresolved Cusco candidate was excluded after a homonymous Philippine station was detected.

Run `npm run build` and commit both generated files, then `npm test`. Review derived tiers and the Chicago/NY/Tokyo sanity checks after changes; a newly verified candidate can defer a nearby label. Check globe zoom 3, regional zooms 4–6, language switching, source release at zoom 7 and station inspection. The runtime makes no Overpass, Nominatim or facility API calls to rank these stations. When the curated overview is used, it reads the fixed station identities from the OpenStreetMap API in batched requests and caches their current `name`/`name:*` tags for seven days; the request list is the curated identities, not the user's viewport. Those OSM tags alone supply curated display names. Cached one-time Wikidata and direct OSM object/selected-station-area reads were used for the identity audit; unresolved candidates were excluded.

See [Axle load](axle-load.md) for the new view, national class distinctions, source references and the 28-day snapshot refresh.

Curated hubs carry no names: the client names them from the provider's station tiles by OSM identity ([label rules](labels.md)). When the provider keys a hub's grouped station on an OSM object other than the curated one, add that object to the entry's `osmAliases`; the provider's station feature API lists every OSM object in a group.

## Railway signals and traction supplies

The manual or code-change-triggered `traction-facilities.yml` workflow prepares
worldwide railway energy supply facilities and the railway signals omitted by
the provider's direction-dependent signal source. It adds no schedule. Every
world partition must complete before either dataset replaces `traction-data`;
partial/error Overpass responses are rejected. Complete raw regions are kept
for retries. The site workflow validates both manifests before copying
`power/` and `signals/` under `styles/data/traction/`.

Run `node scripts/build-power-facilities.mjs` and `node scripts/build-signals.mjs`
for local maintenance. These builders use the public Overpass service; map
visitors only fetch the resulting static files. See [power facilities](power-facilities.md)
for the tag rules and primary references.
