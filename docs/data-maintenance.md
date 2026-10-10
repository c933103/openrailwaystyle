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

The workflow [crossings.yml](../.github/workflows/crossings.yml) keeps a worldwide table of OpenStreetMap level crossings (about 1.2 million `railway=level_crossing` and `railway=crossing` nodes) and publishes it with its tiles to `crossing-data`, one commit replaced each time. `scripts/build-crossings.mjs` queries Overpass one region at a time (45° squares, split into quarters where a query times out, with the split remembered), in CSV with an end marker so a truncated response is rejected. Each crossing is flagged *minor* when every railway way through it is a tram, light rail, funicular or miniature railway, a service track (`service=*`) or street running (`embedded=yes`); the query returns the major crossings, a marker row, then the minor ones. Each row also carries the crossing tags the details panel shows (`styles/crossing-tags.mjs`: barriers, lights, bells, activation, reference, name and so on); the table stores them as JSON and the detail tiles carry them, so clicking a crossing needs no request. Overpass CSV does not escape values and OSM tag values may hold tabs and line breaks, so columns are separated by the unit separator (U+001F); a line that does not start a row continues the previous value. A row with an extra separator keeps its position and kind, with its tags marked unreadable rather than shifted.

- The first run fetches every region (about 45 MB, somewhat more with the tags). A table from an older format (`version` in `regions.json` below 3: before the minor flag or the tags) is fetched anew the same way, since a change query cannot fill these in for unchanged crossings.
- The weekly run (Sunday 04:17 UTC) fetches the crossings changed since the previous run, then refreshes in full the regions checked longest ago, about 5 MB, which removes deleted and retagged crossings.
- A table under 900,000 crossings, or more than 5% smaller than the last, is not published; the last snapshot stays.

Each website build copies the tiles (`5/` overview, `9/` detail), `index.json`, `manifest.json` and the ODbL table `crossings.tsv.gz` into `styles/data/level-crossings/`. Before the first snapshot exists the site deploys without them. See [rail-road rendering](rendering.md#rail-road-interfaces) for how they are drawn.

## Historic-area snapshot

The basemap's `park` layer holds only national parks, protected areas and nature reserves, with the class taken from the free-text protection title, so historic areas cannot be picked out of it. The workflow [heritage.yml](../.github/workflows/heritage.yml) builds a worldwide table of OpenStreetMap areas (closed ways and multipolygon or boundary relations) tagged `historic=archaeological_site`, `historic=battlefield` or `historic=district`, `protect_class=22` (cultural protected areas), or `heritage=1` (World Heritage). It publishes tiles for zooms 10–12 to `heritage-data`, one commit replaced each time. The map overzooms the zoom-12 tiles beyond that. `scripts/build-heritage.mjs` and `scripts/heritage-data.mjs` do the work:

- Regions are 45° squares, split into quarters where a query times out or runs out of memory.
- A busy or failing server (HTTP 5xx, 429 or no response) is retried after 30 s, 1 min and 2 min. If the region still fails with a server error or no response, it is split into quarters, down to six levels, because smaller queries may still succeed. A rate limit (429) that outlasts the retries fails the run instead, since smaller queries would only add requests. One region therefore cannot fail the whole run, as it did in run 37254966281. A rejected query (other 4xx) still fails the run.
- A response with an Overpass remark (partial data) is rejected. An empty world is not published.
- Multipolygon rings are joined from their member ways. Each hole goes to the outer ring around it, and holes outside every outer ring are dropped. An area crossing the antimeridian is kept as one shape.
- Each area keeps its OSM id, its kind and the `name` keys the label languages read; other tags are dropped.
- The run is monthly (the 1st, 05:23 UTC), on a manual run, and when the builder changes on `main`. The download is capped at 1.5 GB.

The tiles are published in bundles (`styles/tile-bundles.mjs`): one file per zoom-8 tile, holding every zoom 10–12 tile under it, gzip-compressed together.
- The first worldwide build had 70,530 areas in 142,087 tiles: 49 MB in 142,087 files, plus a 2 MB index every visitor downloaded first.
- As bundles the same tiles are 3,131 files and 11.6 MB, with a 28 KB index. The largest bundle is 396 KB.
- A map view at zoom 10–12 needs one to four bundles. Each bundle is fetched whole, because GitHub Pages applies byte ranges to its gzip-encoded responses, so a range-based archive such as PMTiles would read wrong bytes.
- The page keeps the last 24 bundles it decoded. A bundle request is shared by all the tiles that need it.

Each website build copies the bundles, `index.json` and `manifest.json` into `styles/data/heritage/`.
- Until the first snapshot exists the site deploys with an empty index and shows no historic areas.
- The map still reads a snapshot in the earlier one-file-per-tile layout (manifest version 1), whose index lists `tiles` rather than `bundles`. A site deployed between this change and the next build therefore keeps showing historic areas.

## Branch-line snapshot

OpenRailwayMap's zoom 0–6 tiles hold main lines only (`usage=main`), so branch lines (`usage=branch`, for example most JR local lines) appeared only from zoom 7. The workflow [branch-lines.yml](../.github/workflows/branch-lines.yml) keeps a worldwide table of operating branch lines (`railway=rail` or `narrow_gauge`, `usage=branch`, not service track), and of metro lines (`railway=subway`, not service track), which the provider's tiles hold only from zoom 10, simplified to about 50 m, and publishes it with tiles to `branch-data` (branch lines at z4–6, metro lines at z7–9), one commit replaced each time. `scripts/build-branch-lines.mjs` converts the tags to the fields of OpenRailwayMap's railway tiles (speed, current, gauge, loading gauge and train protection systems), so each view colours them as it colours the detailed tracks. The first three distinct protection systems occupy adjacent colour bands; the full recorded list remains available for inspection.

- Regions are fetched in stages, in this order: Japan; the Koreas, Taiwan, Hong Kong, Macau and Guangdong; the rest of China; Russia; Europe A–G (below); India; the rest of Asia; the US and Canada; the rest of the Americas; the rest of the world. The shared definitions are in `scripts/download-stages.mjs`. Europe uses a separate country-area request for each country, rather than a continent-sized bounding box. Turkey, Cyprus and the Caucasus fetched in Europe A are left out of the later Asia downloads. All of Kazakhstan, including its European portion, is downloaded in Asia.
- One stage per run, every six hours (minute 41), each run capped at 220 MB of downloads, with a 15-second pause between requests, and no run starts once 900 MB were downloaded in the last 24 hours (manual and push-triggered runs count too): under the public Overpass server's guidance of about 1 GB and 10,000 requests a day. A stage too large for one run continues in the next; a query that times out is split into quarters.
- A snapshot from before concurrent train-control fields were added (`version` below 3 in `state.json`) has every stage fetched again in order, keeping its existing lines and maintenance history until each stage is replaced.
- Once every stage is in, a run refreshes the stage checked longest ago when it is two weeks old, removing deleted and retagged lines; a refresh that would remove more than 20% of a stage's lines keeps them instead (an incomplete response is the likelier cause) and is tried again at the stage's next refresh.

| Europe stage | Coverage |
| --- | --- |
| A | Turkey, Cyprus (including Northern Cyprus and Akrotiri/Dhekelia), Georgia, Armenia and Azerbaijan |
| B | Spain, Portugal, Andorra, UK and Ireland; also Gibraltar, Guernsey, Jersey and Isle of Man |
| C | Iceland, Denmark, Norway and Sweden; also Faroe Islands and Svalbard/Jan Mayen |
| D | Finland (including Åland), Estonia, Latvia, Lithuania, Belarus, Ukraine and Moldova |
| E | Italy (with San Marino, Vatican City and Malta), Slovenia, Croatia, Bosnia and Herzegovina, Montenegro, Serbia, Kosovo, North Macedonia, Greece, Bulgaria and Romania |
| F | Metropolitan France (with Monaco), Belgium, Netherlands and Luxembourg |
| G | Germany, Poland, Czechia, Slovakia, Austria, Switzerland, Liechtenstein, Hungary and Albania |

The Russian North Caucasus is already included in the preceding Russia stage.
Spain's Canary Islands and Portugal's Azores and Madeira stay
with their countries; overseas France and Greenland stay outside these Europe
groups.

The download-layout migration is independent of the feature-schema version.
An interrupted old Europe queue is replaced by A–G, while its previously drawn
data remains available until the replacement groups complete and a fresh world
pass has checked the northern African territory the old bounding boxes also
included. Branch ways move
to their new group as they are fetched. Urban services retain both committed
and partially fetched old-Europe memberships until the smaller stages have
committed. The world stage adopts the African data before the old parent is
retired; retirement also applies the 20% deletion guard.
The revised grouping restarts only A, B, E, F, G, Asia and world, whose request definitions changed. Their committed and partial data stays in fallback entries separated by original stage, so Kazakhstan can move from A to the later Asia stage and small countries can move from G to their neighbouring group. The 20% deletion guard applies to each original stage separately, with service routes and ways checked independently. Retirement also waits for a fresh Asia pass, confirming Kazakhstan coverage. Unchanged stages, geometry and the rolling daily download budget are preserved; obsolete part indices cannot resume after the definitions change.

Each website build copies the tiles, `index.json`, `manifest.json` (stages, counts, last run) and the ODbL table `branch-lines.ndjson.gz` into `styles/data/branch-lines/`.

## Urban rail services

The Service view draws metro, light rail, tram, monorail and commuter rail services along the tracks they run on; no tile provider carries them. The workflow [service-routes.yml](../.github/workflows/service-routes.yml) keeps a worldwide table of OpenStreetMap route relations (`type=route` with `route=subway`, `light_rail`, `tram` or `monorail`, or `route=train` with `service=commuter` or `urban`; never other trains) and the track ways they list, and publishes it with tiles (z7–12, light rail, trams and monorails from z10) to `service-data`, one commit replaced each time (`scripts/service-routes.mjs`, `scripts/build-service-routes.mjs`).

- Both directions and variants of a service are one route: the same kind, network, reference and colour (and name, without a reference), in the same place. Relations with that key that share a track or lie within about 10 km of each other are grouped when the tiles are made, from every relation any box or stage found, so two cities' "Metro" line 1 stay apart and a line whose branch was found in another box is still drawn once. Its name drops the direction ("(Southbound)", ": A → B"); it links to its lowest relation id.
- A stage's pass stages everything it finds (memberships, route details, geometry) and commits it only when complete; a rejected refresh changes nothing.
- Memberships of explicitly returned track ways survive missing coordinates. Unreturned members and platform/stop roles are never promoted to track eligibility. The railway-filtered query now requests `out meta geom qt`; transformation retains OSM dataset time, way version/timestamp, ordered node IDs, raw coordinate slots, and bounded acquisition references before simplification. Contributor names/IDs and changesets are not retained. A way version alone cannot date geometry, because moving a member node does not change the way version.
- Geometry reconciliation uses the newest verified OSM dataset snapshot, including an authoritative empty/partial result. It never fills newer gaps with old coordinates or prefers a longer path. At the same snapshot/revision/node sequence, agreeing raw slots can fill each other; conflicting slots remain quarantined even after a repeated observation. Incompatible topology or a source/revision regression quarantines the way. Every resulting segment follows adjacent source node positions. A later consistent source revision can replace the conflict.
- Accepted geometry stays drawn during a pending pass. Pending-only ways resolve all candidates independent of arrival/stage order; commit applies the same resolver, discard leaves accepted evidence unchanged. The accepted source watermark survives stage retirement while any memberships retain the way. Interrupted retired-stage provenance remains in the table until fallback retirement. Existing NDJSON `lines`/`nextLines` load as explicitly unknown provenance, without resetting unrelated download stages. Pure legacy evidence is persisted as an explicit unknown marker referencing these existing lines, avoiding duplicate paths and derived fingerprints. Unknown observations cannot overrule certified evidence or certify freshness. If an unknown update conflicts with accepted legacy geometry, that geometry remains an explicitly stale fallback; a new verified observation replaces it.
- Both `manifest.json` and `frequency-manifest.json` use geometry diagnostic schema 2. `routeRelationsWithPartialGeometry` now includes internal raw-position gaps and drawable conflicts as well as missing whole ways. `waysWithoutGeometry`, `waysWithPartialGeometry`, `waysWithConflicts`, `waysWithUnknownProvenance`, and `waysWithPendingEvidence` distinguish the retained source states. At most 100 detail records include relation IDs, reasons, source/revision time, and bounded missing-position/source samples; full ordered-slot evidence remains in the downloadable NDJSON. These are source-coverage diagnostics, not proof of real-world or regional coverage.
- Each finished acquisition pass stores bounded `state.stages[name].geometry` health, attempt count, affected way samples and retry policy; the publication manifest includes it. Partial, contradictory or unverified evidence marks the stage geometry incomplete even though acquisition finished. Dedicated repair scheduling is deferred: recovery uses the next existing stage refresh, normally after 14 days, under unchanged 50 MB/run, 100 MB/day and time budgets. No bare-way repair query can introduce new service eligibility. Operator-triggered refreshes remain subject to the same limits. This patch does not initiate a worldwide reacquisition.

A narrow exact-way query to the configured endpoint succeeded on 2026-10-07 after two earlier server-busy responses. The [sanitized actual response fixture](../tests/fixtures/service-geometry/README.md) preserves 31 ordered node IDs and coordinates, OSM dataset time and way metadata, and is tested through the resolver. This validates that complete response layout; synthetic tests cover gaps and contradictory responses. The dedicated `check-service-geometry-browser.mjs`, called by the frequency browser job, exercises synthetic newest/shortened/gapped/unavailable/conflicting/pending source outcomes with real generated tiles and the production layer at z12/z16, equal width, all 28 frequency profiles and expired/missing headway fallbacks. These synthetic checks do not validate live regional coverage. Classifier changes, regional user-visible gap reporting and the original Paris/Normandy all-width regression remain open in #107/#112.

Storage was measured against [published service-data commit `ba3ffbb`](https://github.com/c933103/openrailwaystyle/tree/ba3ffbbfa24cb72d01a07022b526cced30b39cd7): 5,842 routes, 128,679 ways, and 496,758 simplified positions. Explicit unknown-provenance migration changes gzip9 size from 5,109,056 to 5,165,137 bytes (+1.10%); all geometry/memberships remain identical and a 500-way Japan subset produces 210 byte-identical tiles. This measures legacy migration only. The live 31-node fixture's single row grows from compact legacy 326 raw / 212 gzip9 bytes to raw-backed 2,025 / 881. A representative multi-region raw-source growth estimate remains open; the simplified archive cannot reconstruct original nodes, and single-row compression cannot establish a worldwide multiplier.
- The table records which stage found each route and each way's routes by stage; a stage's refresh replaces only its own part, so routes another stage found on a shared way stay.
- Each tile feature is one route on one way, with its place (`i` of `n`) among the routes on that way, so the style draws routes sharing a track side by side; ways run west to east so that a route keeps its side from one way to the next.
- Regions are fetched in the branch lines' stages and with the same mechanics (splitting, refresh every two weeks, the 20% guard), every six hours at minute 11, each run capped at 50 MB and no run once 100 MB were downloaded in 24 hours, so with the branch lines (up to 900 MB) the public server's guidance of about 1 GB a day holds.

Each website build copies the tiles, `index.json`, `manifest.json` and the ODbL table `service-routes.ndjson.gz` into `styles/data/service-routes/`; until the first run publishes, the Service view shows the tracks only.

### Source-aware relation membership

Relation output is now `.r out meta`, separately from railway-filtered way
`out meta geom qt` output. Selector bounding boxes do not clip the declared
relation members. Each observation preserves dataset time, relation revision
and timestamp, relevant identity tags, the full ordered type/ref/role list and
up to eight source references; contributor identity and changeset fields are
omitted. A [sanitized actual relation response](../tests/fixtures/service-geometry/README.md#relation-member-metadata)
validates the 115-member metadata layout. Synthetic regressions cover reroutes
and contradictory evidence; this is not a claimed live reroute incident.

A declared member is not proof of railway eligibility. Only ways positively
returned by the existing railway-filtered acquisition establish eligibility.
Absent members remain unresolved even if another service provides their
geometry. Stop/platform roles remain excluded, and missing/malformed or
explicitly partial member lists cannot certify a removal. Complete empty lists
can. No acquisition selector, timetable matching or service classifier changes.

The newest verified source snapshot controls one coherent relation declaration
and its tags. Compatible repeats at that snapshot can combine observed track
eligibility. Older declarations cannot union their removed members back in;
shorter reroutes, role edits and removed labels take effect together. Conflicting
same-snapshot declarations and revision/member/tag contradictions are
quarantined. Persistent accepted watermarks prevent a later stage retirement
from reviving an older route. Other relations sharing the same track stay
independent. Unknown legacy memberships remain explicitly unverified until a
verified declaration replaces them; contradictory new unverified observations
are reported rather than interpreted as source chronology.

Accepted declarations and tags stay fixed during pending work. A new relation
without accepted evidence may draw its pending frontier. Commit, discard,
NDJSON resume and retired-Europe migration keep these boundaries. Way geometry
continues to use its separate source resolver. Pending new-way evidence cannot
leak into an accepted legacy route's memberships.

Geometry diagnostic schema 2 adds a `relations` schema-1 object with sorted
conflict, unknown-provenance, unresolved-member and pending-evidence relation
IDs, plus positively observed memberships whose retained table associations
are unavailable after stage retirement. This is distinct from unresolved
eligibility; a verified empty declaration remains complete. Affected older
stages have their persisted dependency-health status refreshed without
changing their acquisition attempts or original observed outcome.
Details are limited to 100 relations, 20 unresolved IDs per relation and
eight source references; full member declarations stay in NDJSON. Pending
details explicitly identify retained accepted evidence. These are unresolved
eligibility references, not confirmed missing track. Stage health includes
separate relation counts and repair reasons, so complete coordinates alone do
not certify complete service coverage. Acquisition and headway rebuild emit
the same summary. Existing refresh/day/run budgets and repair cadence stay
unchanged. Stored historical stage rows are retained as evidence, but publication
filters them through the accepted relation frontier.

The original Paris/Normandy all-width acceptance remains open under #107,
general classification/identity under #109, and user-visible regional gaps
under #112. No merge, deployment or fresh worldwide extraction is implied.

## Published data and caches

| Location | Contents | Updated by |
| --- | --- | --- |
| `rail-data` branch | Lifecycle archive parts, manifest, loading-gauge list and optional polar assets | `snapshot.yml` |
| `axle-data` branch | Compact railway axle capacity/load-category lookup and snapshot date | `axle-load.yml` |
| `street-data` branch | Street-running static tiles, index, manifest and GeoJSON | `street-running.yml` |
| `crossing-data` branch | Level-crossing table, region state, static tiles, index and manifest | `crossings.yml` |
| `heritage-data` branch | Historic-area static tiles, index and manifest | `heritage.yml` |
| `overpass-cache` release | Raw responses for rebuilding the lifecycle snapshot | `snapshot.yml` |
| `styles/data/` in the built site | Assembled published snapshots | `site.yml` |

Use the published snapshots for local development; [setup instructions](development.md#load-published-map-data) avoid a new worldwide extraction. The workflows are the executable source of truth for schedules and publishing steps; update this guide when they change.

## Curated major stations

The reviewed source is `styles/data-src/major-stations.json`; the build generates the versioned `styles/major-stations.geojson` and bundles the same data in `world.style.json` for the first upgrade from the previous installed worker. This initial list contains 181 independently checked priority candidates across ten regions. It is not the map's complete station inventory: provider stations fill the remaining space at zooms 4–6 beneath the curated hubs, including the provider copy of a curated identity. Zoom 3 retains the previous globe selection. The curated selection admits closer candidates at each regional band without deferring the previously selected hubs; collision placement determines the labels actually visible on screen. The band spacing and padding live in `MAJOR_STATION_DENSITY` in `scripts/major-stations.mjs`. Chicago Union, New York Penn, Tokyo, Taipei, Beijing and Shanghai retain their principal-hub priority; adjacent secondary terminals can remain deferred to the ordinary provider labels.

For edits, choose a passenger-network role first, then verify the OSM object and an independently linked Wikidata identity/coordinate. `mappedFeature` records whether the object is a railway/public-transport station or a station building; never relabel a stop area, bus terminal or subway point as heavy rail. Coordinates come from OSM nodes or Wikidata CC0 for mapped areas/buildings. Keep one plain `name` only as a human-readable maintenance note beside the coordinates; it is never emitted to map data. Do not store `name:*` translations here. Display names and translations are read from the identified OSM object at runtime. Keep type/ID aliases, country, metro, region, minimum eligibility zoom, manual priority, verification date and source/basis links. No passenger counts are asserted without a source. Cross-check the country against the station’s Wikidata `P17` claim and ISO country code (following a constituent country’s parent if needed); record `countryEvidence` and `countrySource`. The build rejects conflicts. Country checks cover every candidate. The Nigeria Lagos entry uses mapped Mobolaji Johnson Station; the unresolved Cusco candidate was excluded after a homonymous Philippine station was detected.

Run `npm run build` and commit both generated files, then `npm test`. Review derived tiers and the Chicago/NY/Tokyo sanity checks after changes; a newly verified candidate can defer a nearby label. Check globe zoom 3, regional zooms 4–6, language switching, source release at zoom 7 and station inspection. The runtime makes no Overpass, Nominatim or facility API calls to rank these stations. Curated hubs carry no names: the client names each hub in view from the provider's zoom-8 station tile, matched by OSM identity, as for other station labels; no OpenStreetMap API request is made, and the tiles requested are those holding the curated hubs in view. Cached one-time Wikidata and direct OSM object/selected-station-area reads were used for the identity audit; unresolved candidates were excluded.

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
