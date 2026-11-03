# Data sources and maintenance

[Documentation index](README.md) · [Project overview](../README.md)

## Sources and attribution

The quiet base-map layers, colours and design originate in this repository. Its global base source is `https://tuiles.enliberte.fr/planet.pmtiles`. Railway data comes from the independently hosted [OpenRailwayMap vector service](https://openrailwaymap.app/), whose [usage policy](https://github.com/hiddewie/OpenRailwayMap-vector/blob/master/USAGE.md) permits clearly attributed public applications without registration. The site loads only the current view and has no offline downloader or tile prefetcher. Attribution remains visible on the map and on the ? help page (with its licences and terms of use). The site does not copy the provider’s GPL rendering code; its new railway styling is independently authored against the documented tile fields.

The repository code is licensed under [Apache 2.0](../LICENSE). Map data and third-party assets retain their own licences and attribution requirements. Lifecycle and street-running GeoJSON databases are distributed under ODbL; see their manifests and downloads on the **?** help page. Terrain sources are credited in [terrain-credits.html](../styles/terrain-credits.html), and language-boundary sources are detailed in [label regions](labels.md#geographic-regions-and-boundary-sources).

## One Overpass dataset at a time

The Overpass-based datasets below (lifecycle, level crossings, street-running, escalators and elevators, aerialways, historic areas, station points, branch lines, urban services, and traction facilities and signals) are started by one workflow, [osm-updates.yml](../.github/workflows/osm-updates.yml), every six hours from 03:23 UTC. It runs the due workflows one after another, never in parallel: the public Overpass server asks regular users not to run several scripts at once, and GitHub starts scheduled runs hours late or skips them, so separate schedules could not keep the workflows apart. Each dataset keeps its own workflow, branch, checks and publication.

Every builder step of these workflows runs with `--import ./scripts/overpass-meter.mjs`, which counts what the builder downloads through `fetch`, per host, and prints one `OVERPASS_USAGE {"script":…,"bytes":…,"requests":…,"hosts":{…}}` line to the log and the step summary when it exits, failed runs included. Bytes are those read, after content decoding, plus the rest of the declared `Content-Length` of a body the builder did not read to its end (an error it rejected unread, a cancelled stream); `unread` counts such responses and `unmeasured` those among them without a declared length, which make the total a lower bound. That is how the download is checked against the guidance for the public instance on the [Overpass API wiki page](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances): less than 10,000 queries and 1 GB a day, processed in no more than 10 minutes, for one-off use, and for something set up to use it regularly those numbers divided by 100 (less than 100 queries and 10 MB a day), summed over every dataset. The check uses the logs of real runs, not a benchmark. A full download is one-off use; routine change updates are regular use.

The meter also stops a run from asking a host that does not answer. After 3 requests in a row to one host fail without any answer (a refused, reset or timed-out connection), that host is not asked again until 60 seconds after the last failure. Requests in between fail at once with the same `fetch failed` that a dead connection gives, so every builder handles them as it handles an outage: it keeps its data and asks again later. After the pause, one request goes through. Another failure starts a new pause; any answer, even an HTTP error, ends it. The requests not sent appear as `skipped` in the `OVERPASS_USAGE` line.

The reason is that a dataset stays due in `osm-updates.yml` until a run succeeds. On 2026-11-02, during an outage, the lifecycle snapshot was started 5 times and asked overpass-api.de about 97 times per run, getting almost no data. Every builder's own retry wait before a decision that splits a region is at least the pause (heritage waits 120 s before its last attempt), so a split still rests on a request that was actually sent. `OVERPASS_STOP_AFTER` and `OVERPASS_COOLDOWN_MS` change the two numbers, for tests.

`scripts/osm-update-plan.mjs` decides what is due from each workflow's last successful run on `main`, whatever started it (a rebuild after a builder change refreshes the data too):

| Dataset | Due |
| --- | --- |
| Lifecycle | Monday and Friday from 03:00 UTC |
| Level crossings, street-running, escalators and elevators, aerialways | Sunday from 03:00 UTC |
| Historic areas | The 3rd of each month from 21:00 UTC |
| Station points, branch lines, urban services, traction facilities and signals | Every run |

A due time that passes without a successful run (a late, skipped or failed run) is caught up by the next one. A dataset also runs when one of its builder files changed since the commit its last successful run used; such a push to `main` starts the scheduler at once. The dataset workflows have no schedule or push trigger of their own, so they never run in parallel with it. Two kinds of change are left out on purpose and need a manual run: a dataset's own workflow file, and widely shared files such as `styles/map-model.mjs`, which every asset-version bump touches. A failed dataset does not stop the others. A manual run of the scheduler can update one dataset, or all; each dataset workflow can also still be run on its own. The traction run (energy supplies, means of power delivery and signals) keeps completed region responses and brings each up to date with its changes once a week, so most runs make a few small change requests; it republishes `traction-data` and redeploys the site only when something other than the manifests' build times changed.

## Regions: one tree for every dataset

Every worldwide Overpass dataset is fetched by the same region tree (`scripts/world-regions.mjs`): the eight 90-degree quadrants of the world, each split into quarters (south-west, south-east, north-west, north-east) as far as a dataset needs. A dataset only chooses how coarse to start in each quadrant (`worldRegions(size)`, the size the same everywhere or chosen per quadrant): power methods, electricity signals and energy supplies start with whole quadrants; level crossings, signals, historic areas and station points with 45-degree quarters; the lifecycle snapshot with whole quadrants in the south and quarters in the north. A region the server cannot answer is split into its quarters, and each dataset remembers its splits, so a small dataset makes few requests and a dense one as many as it needs. The coverage checks (`tilesWorld`, `regionDepth`) are shared too. Railway ways, branch lines and service routes use country stages instead (below), whose rest-of-the-world remainder is again eight quadrants of this tree.

## Geofabrik coverage gaps

The planned extract pipeline (#330) reads Geofabrik region extracts instead of asking Overpass for whole-world crawls. The eight Geofabrik continents do not add up to the whole world. **Measure Geofabrik coverage gaps** (`osm-gaps.yml`, run by hand) measures where they leave it uncovered, before any dataset relies on them.

- **Inputs.** It reads Geofabrik's region index (`index-v1.json`, with each region's boundary polygon) and Natural Earth 1:10m land and minor islands.
- **Method** (`scripts/measure-osm-gaps.mjs`).
  - The gap is the world minus the union of the continent polygons. A polygon drawn past ±180° is folded back into the world.
  - It reports the gap polygons and the land inside them, with area and extent.
  - It also reports the overlaps between continents, which the extract assembly must deduplicate.
  - A continent missing from the index fails the run rather than appearing as a gap.
- **Output.** The report goes to the step summary and the `osm-gaps` artifact. Nothing is pushed or published. Its download is logged per host by the same meter as the data builds.

The same workflow also plans which Geofabrik files the extract pipeline would download (`scripts/plan-osm-regions.mjs`, step B1 of #330):
- **Size rule.** A region is kept whole when its PBF is at most 8 GiB, so one GitHub runner (14 GB of disk) can download and filter it. A larger region is replaced by its usable children. Sizes come from HEAD requests, one region at a time, for the **dated** files (`<region>-YYMMDD.osm.pbf`), as `mainline-reference.yml` uses. The date is the workflow's `source_date` input, or two days ago (UTC). Geofabrik keeps daily dated files for about a week. A `-latest` URL is not used: Geofabrik redirects it, the largest files to outside mirrors. Only HTTPS on `download.geofabrik.de` is asked, and any redirect stops the plan.
- **Coverage on land.** Coverage is counted in land cells: Natural Earth 1:10m land and minor islands on a 0.1° grid (`scripts/land-raster.mjs`). Geofabrik's polygons carry sea buffers of different widths, so their areas do not show what land they cover. The land is read from the same public-domain files as the gap measurement: 2 requests to GitHub.
- **Aggregates.** Geofabrik lists groups such as `us`, `us-west` or `alps` beside the countries or states they combine. Siblings are taken from the most land down. One whose land lies at least 90% inside the siblings still kept is not used; once dropped, it no longer counts as cover. Of two identical regions, exactly one is kept.
- **Gap filling.** A split can lose land that Geofabrik lists elsewhere: `russia` is under neither `asia` nor `europe`. Uncovered land is filled greedily from any other region in the index, the one adding the most uncovered land first, and descended like the continents when over the limit. A region whose own land is already at least 90% covered, or that adds fewer than 100 land cells, is not used.
- **Oversized regions.** A region over the limit with no usable children is kept and marked `oversized`. It is never dropped, and the plan is invalid.
- **Split gaps.** Each split reports the area, and the land, of its parent that its children leave uncovered.
- **Remainder.** Everything the planned regions do not cover is the remainder. It is later covered from Overpass (B0b). Its land is reported per 10° tile. More than 50,000 km² of remainder land makes the plan invalid: Overpass carries small islands, not countries.
- **Overlaps.** Planned regions sharing more than 1% of their land with another are listed. That is a warning, because the extract assembly deduplicates them.
- **Output.**
  - `plan.json` and `plan.md` go to the `osm-gaps` artifact and the step summary. Each region records its land km² and whether it came from the descent or a gap fill.
  - An invalid plan is still written, with `valid: false` and its problems, and the job fails. Nothing may take a plan whose `valid` is not `true`.
  - Nothing is downloaded beyond the index, the land files and the HEAD requests.

**Measure Geofabrik region extracts** (`osm-extract.yml`, run by hand, step B2 of #330) is the first form of the extract pipeline. It only measures: nothing is pushed, published or kept beyond the run's artifacts.
- **Plan.** It makes the region plan as above. `scripts/extract-run.mjs matrix` refuses a plan whose `valid` is not `true`, a region over the limit, more than 256 regions (one matrix), or more than 100 GiB in all, before any download.
- **One job per region**, largest first, at most 2 at a time (`scripts/acquire-region-extract.mjs`):
  - **Requests.** Three to `download.geofabrik.de`, over HTTPS and never redirected: HEAD, the `.md5` sidecar, the file. They are logged per host by the meter.
  - **Checks before keeping the download.** The HEAD size must be the planned size and fit the disk with 4 GiB to spare. The download is stopped past that size or after 90 minutes, and kept only when its MD5 matches the sidecar. The file's `osmosis_replication_timestamp` must fall on the planned day or one day either side.
  - **Filter.** One `osmium tags-filter` with the union of every dataset's selection (`scripts/extract-filter.mjs`), then `osmium check-refs`. The raw download is deleted as soon as it is filtered, or when any step fails.
  - **Record.** `extract.json` holds the sizes, SHA-256 of both files, the object counts, the timestamps, and the download and filter times. Only the record is uploaded; the filtered file is deleted at the end of the job.
- **Filter selection.** The filter is intended to select at least what the Overpass queries do, subject to the Unicode limitation below. `tests/extract-filter.test.mjs` reads every key the current queries test and fails when one is neither selected nor listed as a refinement. A refinement is a key that only narrows objects already selected, such as `usage` on railway ways. osmium matches values with case. For the `usage` and `landuse` railway hints, the filter selects all ASCII case combinations of short substrings, including mixed-case hints such as `rAiLwAy`. This can also select unrelated values containing those substrings; the resulting size and filter cost are unmeasured. Non-ASCII case equivalence in Overpass is not proven covered, so full Unicode parity remains an open limitation. The polar basemap stays on Overpass: its roads, buildings and water would bring most of each region's data.
- **Report.** The last job lists every region measured and every region not measured, with totals, in the step summary and the `extract-report` artifact.

## Railway lifecycle snapshot

The maintenance build (`.github/workflows/snapshot.yml`) extracts disjoint world regions sequentially, subdivides dense regions when necessary, deduplicates OSM way IDs, retains name translations, and produces a PMTiles archive plus an ODbL GeoJSON database. It refuses to publish an incomplete extraction and checks the north–south extent of 남부내륙선.

The manifest records each region’s OSM timestamp and feature count. The `rail-data` branch stores the published files; ordinary site builds unpack the archive into compressed static vector tiles without rerunning extraction. A compact tile index skips empty areas. This avoids GitHub Pages’ unreliable compressed archive range responses; the browser decodes whole tile files instead.

The raw Overpass responses are kept in the `overpass-cache` release (the Actions cache expires after a week unused), so a rebuild after a change to `scripts/lifecycle.mjs` needs no Overpass queries.

A run on Monday and Friday, started from 03:23 UTC by the scheduler above (night across Europe, where most users of the public Overpass server are), brings every cached region response up to date with only its changes since its own database time: an Overpass augmented diff of the region's query, and the difference when the query changed (`updateElements` in `scripts/overpass-adiff.mjs`). Unlike the earlier `changed` filter, augmented diffs also report ways deleted from OSM or no longer tagged as planned, construction or former, and a way whose nodes moved, so a line that opens or is deleted disappears from the snapshot within a few days, and no region is re-downloaded on a timer. A region Overpass does not answer keeps its data and catches up next run. A region whose changes cannot be used (over the time limit, unreadable, removing over 5% of its ways) is downloaded in full by that run's region steps. Each region file records its query. Files cached before that were all made by the current query, which has not changed since the cache began on 2026-09-22. Each region update also logs its changes with their time (`delta.json`, `recordChanges` in `scripts/snapshot-delta.mjs`): a way shared with a region whose update failed takes the logged state wherever it is newer than that region's copy, deletions included, and an entry is pruned once every region is newer.

A region downloaded in full is split into its quarters, and the split remembered (`.split`), only when Overpass reports an executed-query time or memory limit, in a JSON remark or an HTTP 5xx body. A network failure, HTTP 429, 503 or a busy gateway leaves it whole: after three attempts the run stops and the next run asks for it again, so an outage never leaves the world in more pieces.

It also fetches the loading gauge of every railway way as a CSV list of way IDs (`scripts/build-loading-gauge-list.mjs`, about 4 MB), which colours the zoom 0–6 overview of the Loading gauge view, since no overview tiles carry loading gauge.

A run is about 40 queries and 10 MB, within the Overpass API wiki's guidance for regular applications (under 100 queries and 10 MB a day); a region file larger than 5 MB still goes whole, so an occasional run is larger. Map visitors never query Overpass.

Each run publishes the snapshot and redeploys the site; the manifest records each region's OSM date and the time changes were applied up to. `rail-data` is replaced by a single commit on each publish, so the repository keeps only the current snapshot.

For faster global refreshes, use planet/regional dumps or your own Overpass instance rather than querying public servers more often.

## Polar caps

Web Mercator tiles, which every map source here uses, end at 85.05° N and S; on the globe the two caps beyond (about 550 km from each pole to the edge) are drawn from data prepared in a polar projection (`scripts/build-polar.mjs`, published with the railway snapshot): water, ice shelves, runways and place names from OpenStreetMap, and relief shading and contours from NOAA ETOPO 2022 (60 arc-second).

Atlas Map and Carto use the finer contour bands: 100 m land / 20 m seabed from equatorial zoom 9, and 50 m / 10 m from zoom 11 (with corresponding independent feet-based intervals). The 2×2 and 4×4 tiles are requested only where viewed. Satellite/Hybrid retain black caps. Both drawn maps load the existing static 4×4 OSM detail tiles from equatorial ground zoom 10. Carto draws building footprints from ground zoom 13. Atlas Map uses the ordinary camera zoom for paint, layer min/max zoom, layout visibility and contour filters; ground zoom selects only its polar assets. It samples the current authored paint and layer order for airport areas, buildings/outlines, runways/taxiways, contours and waterways; roads and paths remain exclusive to Carto, as do detailed facility labels from zoom 12. Contour draw ranges retain each elevation and minor/major classification, evaluating depth-dependent opacity from the live style, including its feet-to-metres conversion. The four contour GPU meshes and existing off-view byte/count budgets remain unchanged. Switching to imagery or leaving both caps cancels pending detail requests and releases detailed meshes. Metre-precision detail encoding preserves small station buildings.

These are the existing caps **beyond 85.05°**, not replacement tiles for the entire Arctic or Antarctic. Restoring isoline density does not increase DEM resolution: ETOPO's **surface** product is still sampled on a 1.5 km polar grid. This includes the ice surface in ice-covered terrain and seabed at negative elevations; it must not be described as subglacial bedrock or a detailed local survey. Each index records the source/product/grid metadata. Separate ice/bedrock terrain products require the terrain-source work described elsewhere.

The lifecycle workflow prepares these assets with `scripts/build-polar.mjs`, both on its regular schedule and when maintenance source changes reach `main`. OpenStreetMap cap queries are renewed every four weeks; detail acquisition is split into four cached longitude sectors per cap. HTTP-200 timeout/partial responses are rejected before caching. If a source is unavailable a validated cached copy is used. Builds are staged and replace both caps only when complete; the workflow restores the previous published assets first and retains them after a failed rebuild. On a first run without cached data the optional caps are omitted rather than publishing a partial build. A maintenance operator can run `node scripts/build-polar.mjs` separately without rebuilding the railway archive; visitors never issue Overpass queries.

## Street-running snapshot

The workflow [street-running.yml](../.github/workflows/street-running.yml) runs weekly on Sunday, started by the scheduler above, and can be run manually. It builds a validated worldwide Overpass extract of explicitly mapped shared roadway, then publishes the complete tiles atomically to `street-data`. `street-data` also keeps `elements.json.gz`, the OSM elements the features are made from, which the site does not copy. A run asks only for their changes since their `osmBase`, however old, and for the difference when the query changed (`scripts/overpass-adiff.mjs`, `updateElements`); the change requests share six minutes. The features are converted from all elements on every run, so changed conversion code needs no download. The full download is the fallback. Failed refreshes retain the last published snapshot.

Each website build copies `12/`, `index.json`, `manifest.json` and `street-running.geojson.gz` into `styles/data/street-running/`. The manifest and ODbL GeoJSON download are linked under About. Visitors do not make Overpass requests. See [rail-road rendering](rendering.md#rail-road-interfaces) for qualifying tags and display zooms.

## Escalator, moving-walkway, elevator and aerialway snapshot

The workflow [conveying.yml](../.github/workflows/conveying.yml) runs weekly on Sunday and when its builder changes (both started by the scheduler above), or manually. `scripts/build-conveying.mjs` makes one worldwide Overpass query for every way with `conveying=*` (not `no`) or `highway=elevator`, with no length threshold (taginfo: about 36,000 and 8,300 ways in October 2026). It refuses an extract under 10,000 ways. Tiles are zoom 14 only, where the lines first draw, unsimplified at 8192 units per tile (about 0.3 m at the equator); MapLibre rounds tile coordinates to that grid, so coarser tiles would lose short pieces even when overzoomed. The extract keeps only the values views colour by: `owner` with its owner colour, and `maxspeed` in km/h (mph converted). Only `main` publishes the tiles, index, manifest and ODbL `conveying.geojson.gz` to `conveying-data`; a failed refresh keeps the last snapshot. `conveying-data` also keeps `elements.json.gz`, the OSM elements (tags and geometry) the features are made from; the site does not deploy it. A run with published elements asks only for what changed since their database time, however long ago (`osmBase` in its manifest): an Overpass augmented diff of the query that selected them (`query` in the manifest), applied element by element (`scripts/overpass-adiff.mjs`). When the query has changed, the new query's ids at the database time of those changes show the difference: stored elements it no longer selects are dropped, and only the elements it newly selects are downloaded, by id, at that time. The new query runs alone, so no set or default set of the old one can reach it. Elements the conversion cannot use mean the full download, not a failed run. The features are converted from all elements on every run, so changed conversion code needs no download. The manifest records `update`. A full download remains only for a first run without elements, a query whose output form changed or with an output before its last, a failed or unreadable request, or changes that would remove over 5% of the ways.

Aerial cableways and lifts have their own workflow, [aerialways.yml](../.github/workflows/aerialways.yml) (Sunday and when its builder changes, both started by the scheduler above, or manually), so either snapshot can refresh without the other. `scripts/build-aerialways.mjs` uses the escalator build's bounded acquisition (at most three requests and their waits in one 52-minute budget) for every way with `aerialway=cable_car|gondola|mixed_lift|chair_lift|drag_lift|t-bar|j-bar|platter`. It refuses fewer than 5,000 and writes zoom-12 tiles (where they first draw; they are long lines) with their names, `owner`, owner colour and `maxspeed`. Like the escalator build, `aerialway-data` also keeps `elements.json.gz` (not deployed). A run asks only for the changes since their `osmBase`, however old, and for the difference when the query changed. The features are converted from all elements on every run, so changed conversion code needs no download. The full download is the fallback. Only `main` publishes them to `aerialway-data`; the site build stages it into `styles/data/aerialways/`, or an empty index until the first snapshot.

`styles/conveying.mjs` reads the tags: an escalator is `highway=steps` with `conveying`, a moving walkway is any other way with `conveying`, and an elevator is a `highway=elevator` way. One plain `forward`, `backward` or `reversible` value gives arrows; `yes` or mixed values give none. A backward way is stored reversed, so each arrow points along its line. The tiles carry only `kind` and `arrows` (plus the OSM id).

Each website build copies the snapshot into `styles/data/conveying/`; until the first one exists it writes an empty index and the map draws none. In every view the lines show from zoom 14 and the arrows from zoom 16, one per mapped piece (both ways for a reversible piece). They are not clickable. Visitors do not make Overpass requests.

## Level-crossing snapshot

The workflow [crossings.yml](../.github/workflows/crossings.yml) keeps a worldwide table of OpenStreetMap level crossings (about 1.2 million `railway=level_crossing` and `railway=crossing` nodes) and publishes it with its tiles to `crossing-data`, one commit replaced each time. `scripts/build-crossings.mjs` queries Overpass one region at a time (45° squares, split into quarters where a query times out, with the split remembered), in CSV with an end marker so a truncated response is rejected. Each crossing is flagged *minor* when every railway way through it is a tram, light rail, funicular or miniature railway, a service track (`service=*`) or street running (`embedded=yes`); the query returns the major crossings, a marker row, then the minor ones. Each row also carries the crossing tags the details panel shows (`styles/crossing-tags.mjs`: barriers, lights, bells, activation, reference, name and so on); the table stores them as JSON and the detail tiles carry them, so clicking a crossing needs no request. Overpass CSV does not escape values and OSM tag values may hold tabs and line breaks, so columns are separated by the unit separator (U+001F); a line that does not start a row continues the previous value. A row with an extra separator keeps its position and kind, with its tags marked unreadable rather than shifted.

- The first run fetches every region (about 45 MB, somewhat more with the tags). A table from an older format (`version` in `regions.json` below 3: before the minor flag or the tags) is fetched anew the same way, since a change query cannot fill these in for unchanged crossings.
- The weekly run (Sunday, started by the scheduler above) asks each region for its changes by Overpass augmented diff over the crossings and the railway ways through them (`crossingChangesQuery`). Crossings deleted or no longer tagged as crossings are removed; every crossing that may have changed — its own change, or a change to a railway way through it, a deleted way included (its former nodes) — is read again by id with the region query's columns and minor logic (`crossingRowsQuery`, in groups of 2,000, halved when too big). The changes are exact, so no region is downloaded again on a schedule. A crossing that only left a region's selection (`visible="true"`: moved into another region, or retagged) is read again by id and removed only if it is no crossing anywhere. A table made by another query or row code (`extraction` in `regions.json`: the region query and `crossing-rows.mjs`, the parsing into the table; not the tile code, tag labels or regions, whose changes rebuild the tiles from the stored table) A table or rebuild checkpoint of the same query and row code from before that code moved to `crossing-rows.mjs` (main at `cec0af882`) counts as current while the code still has the version that move gave it, so the move adds no download, or kept by the earlier change query (no `extraction`), is downloaded in full once instead, since changes alone would leave unchanged crossings with the old rows.
- Every request of a run describes one database time, the run's start minus an hour, which is the time saved for each region: change requests end there (`[adiff:"<since>","<until>"]`), and the rows read again and full region downloads are of that time (`[date:]`). The stored table is therefore exactly the state at its saved time, so a crossing created after it and deleted before the next run is never kept. A server whose data does not reach that time yet counts as unavailable for that region. A region's changes, its quarters included, are applied to the table only when every request for it succeeded, so a region deferred midway publishes none of them. A region keeps only the crossings inside it among those it reads again: one elsewhere, reached through a way that also runs in this region, is left to its own region, whose changes report the same way. A crossing that moved out of a region loses its row there (unless the region it moved to has already stored its current row); that region's own changes add it.
- Each 45° region's changes are asked from that region's own time (`changes` in `regions.json`; `since` is the oldest), oldest first. A region Overpass stays unavailable for (five failed attempts) keeps its time and is asked first next run, while every other region's changes are published; after two such regions in a row the rest wait too. A change request that runs out of time or memory is split into quarters. A run with a deferred region still ends red, so the scheduler retries it in six hours rather than a week; a run where no region could be fetched publishes nothing.
- HTTP capacity and queue-full responses retry the same region, even when their heading says “Gateway Timeout”. The builder makes at most five attempts, waiting 1, 2, 3 and 4 minutes before retries; persistent overload fails the build without subdividing the region or replacing the last snapshot. Query timeout, memory and incomplete-response failures retain the bounded subdivision path.
- A table under 900,000 crossings, or more than 5% smaller than the last, is not published; the last snapshot stays.

Full rebuilds stage each successfully parsed leaf (including empty leaves) and
each subdivision decision in the separate `crossing-rebuild-work` branch. The
workflow saves validated staging after ordinary acquisition failures, using the
existing `contents: write` permission; the existing `actions: write` permission
remains for site deployment. This follows the facilities workflow's failure-time
preservation and the station workflow's separate work-branch pattern. The website
never reads staging. Incremental changes and rolling refreshes do not use it.

The checkpoint binds the exact endpoint, query, parser/tag-source hashes, table
version, bbox topology, acquisition traversal prefix and payload checksums to the previous published
`crossing-data` commit (or its verified absence). A changed published commit
invalidates the old epoch, so a successfully published acquisition cannot be
relabelled as new data. Restoring validates every leaf before provider requests.
Owned corrupt, stale or incompatible generations are discarded as a whole;
unrecognized ownership, malformed state files and unexpected paths fail closed
without replacing their content. Branch writes use the exact restored commit as
a force-with-lease and reconcile uncertain pushes against the exact new commit.

An epoch has no age limit (until 2026-11 it expired after 14 days). A rebuild
interrupted by a long Overpass outage resumes from its staged leaves, rather
than discarding them and starting the worldwide crawl again (#330: data is
never discarded for its age). This is safe because the next incremental update
starts from the epoch's original watermark, so every change made during the
acquisition window is applied. An epoch is still discarded when its identity
(query, source, parser, schema or previous snapshot) changes, or when its
timestamps lie in the future. A resumed build may therefore contain an
observation window of days, or of months after a long outage; it is not a
simultaneous worldwide observation.
The original one-hour-overlap `since` watermark remains unchanged, and
`acquisition.startedAt`, `observationStartedAt` and `observationCompletedAt` record
the acquisition window. `manifest.generated` records the current build time;
`version`/`tableVersion` describe the table schema. These are separate concepts.
Observation timestamps are local request/response times: this CSV supplies no
pinned OSM database/source revision, so schema v3 and build time do not establish
source freshness.
The next incremental update still starts from the original watermark.

Staging has hard limits: 4 MiB state, 4,096 leaf/split records, 16 MiB compressed
per leaf, 128 MiB compressed total, 128 MiB decoded per leaf and 512 MiB decoded
total, with bounded decompression. The failed October 16 acquisition logged
about 56 MB of cumulative provider downloads, including retries/errors; that is
not a recovered payload-size measurement. Parsed JSON can be larger than CSV,
so decoded limits allow expansion while individual Git blobs stay below 16 MiB.
Only one epoch is reachable at the work-branch tip; Git may retain old unreachable
objects. Source branches contain code, compact tests and this contract, not
downloaded payloads or bulky run logs.

Each local payload and state file uses a temporary-file rename. Durable remote
progress is flushed only by the post-acquisition workflow step: cancellation,
hard timeout, abrupt runner loss or a failed checkpoint push can still lose work
since the last durable checkpoint. No older missing responses are reconstructed.
The count guards and success-only atomic `crossing-data` branch publication stay
in place. Merging changes to these scripts or their workflow into `main` triggers
the existing real acquisition workflow; an eventual merge is not offline-only.

Each website build copies the tiles (`5/` overview, `9/` detail), `index.json` and `manifest.json` into `styles/data/level-crossings/`; the ODbL table `crossings.tsv.gz` is offered from the `odbl-tables` release (below). Before the first snapshot exists the site deploys without them. See [rail-road rendering](rendering.md#rail-road-interfaces) for how they are drawn.

## Historic-area snapshot

The basemap's `park` layer holds only national parks, protected areas and nature reserves, with the class taken from the free-text protection title, so historic areas cannot be picked out of it. The workflow [heritage.yml](../.github/workflows/heritage.yml) builds a worldwide table of OpenStreetMap areas (closed ways and multipolygon or boundary relations) tagged `historic=archaeological_site`, `historic=battlefield` or `historic=district`, `protect_class=22` (cultural protected areas), or `heritage=1` (World Heritage). It publishes tiles for zooms 10–12 to `heritage-data`, one commit replaced each time. The map overzooms the zoom-12 tiles beyond that. `scripts/build-heritage.mjs` and `scripts/heritage-data.mjs` do the work:

- Regions are 45° squares, split into quarters where a query times out or runs out of memory.
- A busy or failing server (HTTP 5xx, 429 or no response) is retried after 30 s, 1 min and 2 min. If the region still fails with a server error or no response, it is split into quarters, down to six levels, because smaller queries may still succeed. A rate limit (429) that outlasts the retries fails the run instead, since smaller queries would only add requests. One region therefore cannot fail the whole run, as it did in run 37254966281.
- The workflow keeps no cache between runs, so each run starts from the regions the published snapshot covered (`coverage` in its `manifest.json`): a region split last month is asked for in its parts, with their split depth, not whole again. Coverage that does not tile the world exactly, or a missing snapshot, falls back to the 45° squares. A rejected query (other 4xx) still fails the run.
- The snapshot also keeps each region's elements (`elements/`, with the region's query and database time), which the site does not deploy. A region with them takes only its changes since that time, an Overpass augmented diff, however long ago; when its query changed, only the difference (`updateElements` in `scripts/overpass-adiff.mjs`). Only a region without stored elements, or whose change request fails, is downloaded in full, and `HERITAGE_REFRESH=1` forces that. A changed way without geometry is refused rather than dropped from the map. Change requests count towards the 1.5 GB cap.
- A response with an Overpass remark (partial data) is rejected. An empty world is not published.
- Multipolygon rings are joined from their member ways. Each hole goes to the outer ring around it, and holes outside every outer ring are dropped. An area crossing the antimeridian is kept as one shape.
- Each area keeps its OSM id, its kind and the `name` keys the label languages read; other tags are dropped.
- The run is monthly (the 3rd, from 21:23 UTC, started by the scheduler above), on a manual run, and when the builder changes on `main`. The download is capped at 1.5 GB.

The tiles are published in bundles (`styles/tile-bundles.mjs`): one file per zoom-8 tile, holding every zoom 10–12 tile under it, gzip-compressed together.
- The first worldwide build had 70,530 areas in 142,087 tiles: 49 MB in 142,087 files, plus a 2 MB index every visitor downloaded first.
- As bundles the same tiles are 3,131 files and 11.6 MB, with a 28 KB index. The largest bundle is 396 KB.
- A map view at zoom 10–12 needs one to four bundles. Each bundle is fetched whole, because GitHub Pages applies byte ranges to its gzip-encoded responses, so a range-based archive such as PMTiles would read wrong bytes.
- The page keeps the last 24 bundles it decoded. A bundle request is shared by all the tiles that need it.

Each website build copies the bundles, `index.json` and `manifest.json` into `styles/data/heritage/`.
- Until the first snapshot exists the site deploys with an empty index and shows no historic areas.
- The map still reads a snapshot in the earlier one-file-per-tile layout (manifest version 1), whose index lists `tiles` rather than `bundles`. A site deployed between this change and the next build therefore keeps showing historic areas.

## Railway ways: one download for three datasets

Branch lines, urban service routes and power-delivery methods select many of
the same ways (a fifth of the service routes' track ways are branch lines;
nearly half of the power-method ways are in one of the other two).
`scripts/railway-ways.mjs` asks for all three in one request per stage region,
each element once, and gives each dataset the view its own query returned.
`scripts/build-railway-ways.mjs`
([railway-ways.yml](../.github/workflows/railway-ways.yml)) runs that query
through the branch lines' stages and pacing (one stage per run, 220 MB per run
and 900 MB a day, a refresh every two weeks, splits recorded) and keeps each
region's raw response: `regions/<stage>/` holds the last complete pass,
`next/<stage>/` a pass in progress, which replaces it only when complete.

A complete stage due for its refresh is not downloaded again: each stored
region takes the changes since its database time, two Overpass augmented
diffs (`railwayWaysQueries`: the route relations, then the ways up to the
same time, since Overpass documents augmented diffs for one output), applied
to its stored elements (`updateElements` in `scripts/overpass-adiff.mjs`).
When the query changed, each part also takes only the difference: the new
query's ids at that time, with the newly selected elements downloaded by id.
A stopped pass keeps every region as it was and resumes with the rest; when
every region is done the stage's `completed` time advances, so the datasets
built from the store take it again. Only a stored region whose query cannot
be compared with the current one needs a full pass.

- Only the server's own report that a query ran out of time or memory splits a
  region. Gateway errors, a busy server and stalled or cut-off transfers retry
  the same region and defer it, since they say nothing about its size and a
  split is kept for later passes.
- Every dataset's view must accept a response before it is stored.
- A stage complete in the store must have every region its pass recorded:
  reading it stops with an error otherwise, rather than passing for a stage
  that lost its data.
- The store is a cache that can be downloaded again, so it is kept as the
  assets of the `railway-ways-store` release (as `traction-facilities-cache`
  is), not as git history (`scripts/railway-ways-release.mjs`). Nothing is
  replaced in place: each run uploads new generation-named assets, the stage
  archive it changed (`stage-<stage>-<generation>.tar.zst`) and then its state
  (`state-<generation>.json`, naming every stage's archive). Loading takes the
  newest state whose archives are all present, so a run that stopped half way
  leaves the previous generation in use; older generations are deleted after
  the new state is up, keeping the previous one.

The scheduler above starts it every six hours, before branch lines and service
routes. Their workflows load the newest usable generation
(`railway-ways-release.mjs load <directory> RAILWAY_WAYS_STORE`) and are built
from it with no Overpass request; when it cannot be loaded (no release yet, or
GitHub unreachable), the run warns and downloads as before. Power methods keep
their own world-quadrant download until every stage in the store is complete
with its current parts (`leaves.key`, `stageLayoutKey` in
`scripts/download-stages.mjs`); the stages cover the whole world through the
rest-of-the-world remainder below (`STAGES_COVER_WORLD`).
`traction-facilities.yml` loads the store for them.

Branch lines can already be built from the store: with `RAILWAY_WAYS_STORE`
set to a copy of `railway-ways-data`, `scripts/build-branch-lines.mjs` makes no
Overpass request (`scripts/railway-ways-branch.mjs`). Each stage complete in
the store replaces the lines it owns; a line belongs to the first stage whose
regions return it; stages not yet in the store keep their lines; a stage that
would lose over a fifth of its lines keeps them. Without the variable it
downloads as before, which stays the fallback.

Service routes can be built from the store too: with `RAILWAY_WAYS_STORE` set,
`scripts/build-service-routes.mjs` makes no Overpass request. Each stage
complete in the store and not yet taken (`storeCompleted` in its state) goes
through the same pass and completion as a downloaded one (the route and way
evidence, the 20% guard, geometry health), with the stored region's time and
query as its provenance. Without the variable it downloads as before.

## Branch-line snapshot

OpenRailwayMap's zoom 0–6 tiles hold main lines only (`usage=main`), so branch lines (`usage=branch`, for example most JR local lines) appeared only from zoom 7. The workflow [branch-lines.yml](../.github/workflows/branch-lines.yml) keeps a worldwide table of operating branch lines (`railway=rail` or `narrow_gauge`, `usage=branch`, not service track), and of metro lines (`railway=subway`, not service track), which the provider's tiles hold only from zoom 10, simplified to about 50 m, and publishes it with tiles to `branch-data` (branch lines at z4–6, metro lines at z7–9), one commit replaced each time. `scripts/build-branch-lines.mjs` converts the tags to the fields of OpenRailwayMap's railway tiles (speed, current, gauge, loading gauge and train protection systems), so each view colours them as it colours the detailed tracks. The first three distinct protection systems occupy adjacent colour bands; the full recorded list remains available for inspection.

- Regions are fetched in stages, in this order: Japan; the Koreas, Taiwan, Hong Kong, Macau and Guangdong; the rest of China; Russia; Europe A–G (below); India; the rest of Asia; the US and Canada; the rest of the Americas; the rest of the world. The shared definitions are in `scripts/download-stages.mjs`. The rest of the world is the remainder of all the others: the globe in eight tiles, each taking everything in its box minus what every other stage's part selects where its box overlaps the tile (`remainderSelection`). Nothing can fall between the stages: places outside every stage box (Mauritius, Réunion, Cape Verde, Greenland, Antarctica), in no country or one no stage names, a country's territory beyond its stage's box, and the open sea are all in it; an element another stage selects from beyond the tile can come twice, which merging tolerates. Parts that share one box share one area set, and a part with exclusions of its own is subtracted as a named difference. Europe uses a separate country-area request for each country, rather than a continent-sized bounding box. Turkey, Cyprus and the Caucasus fetched in Europe A are left out of the later Asia downloads. All of Kazakhstan, including its European portion, is downloaded in Asia.
- One stage per run, every six hours (started by the scheduler above), each run capped at 220 MB of downloads, with a 15-second pause between requests, and no run starts once 900 MB were downloaded in the last 24 hours (manual and push-triggered runs count too): under the public Overpass server's guidance of about 1 GB and 10,000 requests a day. A stage too large for one run continues in the next; a query that times out is split into quarters. The regions a complete pass fetched are recorded with the stage (`leaves` in `state.json`), and its next refresh starts from them, so a request already known to time out is not repeated every two weeks (`scripts/download-stages.mjs`, shared with the service routes). A change to a stage's parts starts it from the parts again.
- Both branch and Service acquisition count HTTP error bodies toward the run and rolling daily allowances. A response cut off by the remaining allowance preserves its original queued region, unless a successful response itself exceeds the full configured run allowance before any region is accepted or split. Reduced daily balance and earlier failed-response bytes are not evidence that a region needs subdivision. Before each retry, an exhausted allowance defers the unchanged region without another backoff delay or request, including when a complete error body ends exactly at the limit. Genuine query time/memory failures and confirmed oversized successful responses retain their existing subdivision rules; neither the limits nor the refresh cadence are increased.
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

Each website build copies the tiles, `index.json` and `manifest.json` (stages, counts, last run) into `styles/data/branch-lines/`; the ODbL table `branch-lines.ndjson.gz` is offered from the `odbl-tables` release (below).

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
- Regions are fetched in the branch lines' stages and with the same mechanics (splitting, refresh every two weeks, the 20% guard), every six hours, after the branch lines, each run capped at 50 MB and no run once 100 MB were downloaded in 24 hours, so with the branch lines (up to 900 MB) the public server's guidance of about 1 GB a day holds.
- Capacity, busy-worker and full-queue diagnostics retry the same box, even when
  the error page also says "Gateway Timeout". Classification uses the full
  diagnostic while logs stay bounded. The existing five attempts, 1/2/3/4-minute
  retry waits and 15-second spacing between boxes remain unchanged. Exhausted
  retries preserve the pending queue and fetched partial data, recording failed
  response bytes in the same budgets; genuine query time/memory limits and
  incomplete JSON still use bounded spatial subdivision.

Each website build copies the tiles, `index.json` and `manifest.json` into `styles/data/service-routes/` (the ODbL table `service-routes.ndjson.gz` stays in the reviewed site, because the service frequencies and their browser checks are built from it, and is removed by the deploy job before publication; it is offered from the `odbl-tables` release, below); until the first run publishes, the Service view shows the tracks only.

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

Verified complete declarations also retain a separate `supplemental` schema-1
evidence envelope in NDJSON. It records only bounded service-identity/context
tags: `brand`, `brand:wikidata`, `network:wikidata`, `operator:wikidata`,
`wikidata`, `network:short/full`, `operator:short/full`, `from`, `to`, `via`,
`interval`, `interval:conditional`, `duration`, `opening_hours`,
`public_transport:version`, `passenger`, `usage`, and
`gtfs:feed/feed_id/source/route_id` (the slash forms denote separate keys).
Other tags, contributor identifiers and changesets remain omitted. Values are
retained exactly, not normalized. Any non-string or over-1,024-code-unit value
withholds that observation's whole supplemental projection as unobserved,
never truncating a value or interpreting a rejected field as absent.

The envelope and its tag variants have separate SHA-256 content fingerprints.
Each variant is bound to the relation ID, version, timestamp and existing core
declaration key; its source references preserve the actual OSM dataset snapshot
and acquisition provenance. **No envelope means unobserved**, not that these tags
were absent at source. An old narrow observation cannot erase compatible richer
evidence, even at a newer snapshot of the same revision. A new revision never
inherits the previous revision's tags. The bounded envelope keeps two highest
revision identities (version, timestamp, then declaration-key order), two
deterministic contradictory tag witnesses per identity and eight source samples
per witness; it is not a full history or acquisition log. Contradictions remain
explicit in each revision's `conflict` flag and do not silently become a selected
classification. Pending evidence stays pending through resume and migration;
only commit changes accepted evidence, and discard preserves accepted bytes.

This repair does **not** widen the deployed core `tags` projection, fingerprint,
observation hash or persisted revision keys. It changes no route view, grouping,
membership eligibility, matcher, tile bytes, acquisition selector or diagnostic
schema. The separate `captureOsmServiceEvidence` helper and station-crosswalk
acquisition described in the [matching contract](timetable-matching-contract.md#osm-and-matching-inputs)
remain inactive. The archived 115-member fixture proves retention of Southern,
Epsom, London Bridge, `00:30`, `Q26334` and other observed context, **not** general
service eligibility. Raw positive/negative classification coverage and the
broader #109 acceptance remain unresolved; these fields alone are not sufficient
classification rules.

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

## ODbL download tables

The four large ODbL tables are not deployed with the website, because GitHub Pages publishes at most 1 GB and the tables are about 193 MB of it:
- `lifecycle.geojson.gz` (from `rail-data`, joined from its parts);
- `crossings.tsv.gz` (`crossing-data`);
- `branch-lines.ndjson.gz` (`branch-data`);
- `service-routes.ndjson.gz` (`service-data`).

**Publish ODbL download tables** (`odbl-tables.yml`, `scripts/odbl-tables.mjs`) copies only these existing public data-branch tables into the release [`odbl-tables`](https://github.com/c933103/openrailwaystyle/releases/tag/odbl-tables). It runs after each producing workflow succeeds, on changes to itself, weekly and by hand. It does not acquire data from providers or change their schedules.

### Publication and cutover contract

1. Validate gzip and record the byte count, SHA-256, data branch and exact source commit. Every asset is named `SHA256-filename`; an uploaded asset is never renamed, overwritten or deleted by this workflow.
2. Reuse matching uploaded assets. Upload changed tables first and require GitHub's `state: uploaded`, `size` and `digest: sha256:…` metadata to match the locally staged bytes. Missing or mismatched metadata fails closed. See the [release-asset API contract](https://docs.github.com/en/rest/releases/assets#get-a-release-asset).
3. Commit a complete generation by uploading its `SHA256-odbl-tables.json` manifest **last**. The newest uploaded manifest by asset ID is the generation pointer. All four table entries, their source/asset bindings and the manifest's own hash are required. Paginate the asset list; never assume the first page contains the current generation. A corrupt newest committed manifest is an error, not permission to silently fall back.
4. The existing `odbl-tables` workflow concurrency group serializes publishers. The publisher also checks for a competing committed manifest before and after its commit. Do not run independent manual publishers outside this group; the GitHub upload API does not provide a multi-asset transaction or compare-and-swap across these checks.
5. The Pages deploy job independently reads the complete generation and pins Help's downloads and manifest link to its immutable URLs in the deploying repository. Only then does it remove the service-route table and upload Pages. The service table still stays in the reviewed artifact for the existing frequency/browser checks. Release metadata and the small manifest are verified; this is not a second download of the large tables.

**First cutover:** before the first complete generation exists, the deploy gate fails and the previously deployed site remains live, with its existing local downloads. After the initial publisher succeeds, rerun **Validate and deploy world railway map** if its gate ran first. Do not bypass this gate or manually remove the old published downloads. Pull-request checks are fixture-only for this gate and do not create a release.

**Failures and recovery:** a failed table or manifest upload leaves earlier uploaded assets and their URLs intact. A manifest upload left in `starter` state is not committed. A retry may remove only a zero-byte `starter` at the exact expected hash-name, then upload it again; it cannot delete an uploaded version. If an upload response is lost, read and verify its metadata before deciding whether it failed. A missing data branch retains its last verified entry; an initial missing branch prevents a complete generation. Other git/API failures stop the run. If a newest uploaded manifest or table is corrupt, investigate that generation before rerunning; do not treat it as absent or weaken the checks.

**Retention and costs:** previous uploaded versions remain available so older deployed/cached HTML does not acquire broken links. Identical table hashes are reused, and a run with no changed table hashes adds no manifest. Each changed table adds its compressed bytes, plus a small manifest for the new generation. This increases release storage/asset count over time; no automatic cleanup is introduced. Any retention change needs a separate reviewed migration that preserves consumers. Each metadata listing costs one release request plus one request per 100 assets. Deployment downloads only the current manifest (at most 64 KiB), not approximately 193 MB of tables; publication reads the same existing data branches and uploads only missing hash-named bytes.

The data branches keep their copies, because other workflows read them. The original ODbL attribution and licence remain in the Help panel, manifest and release notes.

## Published data and caches

| Location | Contents | Updated by |
| --- | --- | --- |
| `rail-data` branch | Lifecycle archive parts, manifest, loading-gauge list and optional polar assets | `snapshot.yml` |
| `axle-data` branch | Compact railway axle capacity/load-category lookup and snapshot date | `axle-load.yml` |
| `street-data` branch | Street-running static tiles, index, manifest and GeoJSON | `street-running.yml` |
| `crossing-data` branch | Level-crossing table, region state, static tiles, index and manifest | `crossings.yml` |
| `heritage-data` branch | Historic-area static tiles, index, manifest and each region's elements | `heritage.yml` |
| `overpass-cache` release | Raw responses for rebuilding the lifecycle snapshot | `snapshot.yml` |
| `styles/data/` in the built site | Assembled published snapshots | `site.yml` |

Use the published snapshots for local development; [setup instructions](development.md#load-published-map-data) avoid a new worldwide extraction. The workflows are the executable source of truth for schedules and publishing steps; update this guide when they change.

## Worldwide station-point acquisition

The [station workflow](../.github/workflows/station-points.yml) checkpoints at
most one Overpass region per run. Only a complete generation is published to
`station-points-data`; in-progress records stay on `station-points-work`. The
[rendering contract](rendering.md#completed-worldwide-osm-station-marker-source)
describes the complete-only runtime integration and remaining coverage limits.

A complete generation is then kept current with changes instead of a new
cycle: each run makes one worldwide request for the changes since the
generation's database time (`changesSince` in its state, at first its cycle's
start), an Overpass augmented diff of the region query
(`stationChangesQuery`, `scripts/overpass-adiff.mjs`). Deleted stations and
ones no longer tagged as stations leave, changed ones replace their record
unless older, and new ones join; a result losing over 5% of the stations is
refused. The regions of a cycle are read over days, so the first changes
after a cycle, which start from its start, also drop any record edited after
it that they do not mention: that element matched the query at neither end,
so it was created and went again while the regions were read. A generation
A cycle keeps every element its query selects (`elements.json.gz` on
`station-points-work`, not published or deployed: type, id, version,
timestamp, tags and a node's position or a way's or relation's centre),
including ones the conversion makes no station of, and records `elements`,
`query` and its version in its state. The records are converted from those
elements on every run, so changed conversion code
(`scripts/station-point.mjs`) needs no download: the generation is
re-converted and published. Changes are applied to the elements. When the
query changes, a complete generation takes the changes of its own query,
then only the difference at their database time: the new query's ids
worldwide, and the newly selected elements by id (`stationSelectionQueries`,
`applyStationSelection`); a run failing after the changes keeps them. Only
when the difference needs over eight requests in all, or the queries cannot
be compared, does a new cycle start; an incomplete cycle of another query
also restarts. A cycle started before elements were kept has records only:
it is updated as before, and one made by another region query or record
conversion (`stationExtraction`: the query and `scripts/station-point.mjs`
with its imports) starts a new cycle, which keeps elements. GitHub refuses
files over 100 MB, so a run whose elements compress to over 90 MiB fails
rather than saving them. The generation is published, and the site redeployed, only when a
cycle completed, the changes altered its stations, or its tiles differ from
the last published ones (`publishedTiles` in the state, a digest of the tile
archives), as after a change to the tile code. A failed change request
keeps the generation and the next run asks again from the same time; its
age never starts a new cycle, since the changes make it exact.

The builder reads successful responses up to 15 MiB, and HTTP error diagnostics
up to a separate 64 KiB limit. An explicit executed-query timeout or memory-limit
diagnostic in a JSON remark or HTTP 5xx body checkpoints a geographic subdivision
for a later run. A busy dispatcher, generic gateway error, HTTP 429/503,
permission/syntax failure, truncated diagnostic or network abort retains the
same region. No outcome adds an immediate retry or publishes partial tiles.
The next generation asks for the regions the previous complete one fetched
(their boxes and split depth), so a region once subdivided for an executed-query
limit is not requested whole again every cycle.
`requestBytes` includes consumed error-body bytes. These decisions are exercised
against the actual executable in `tests/station-builder.test.mjs` with synthetic
responses and no public-provider requests. See the provider's distinction between
[admission limits and executed-query limits](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).

## Curated major stations

The reviewed source is `styles/data-src/major-stations.json`; the build generates the versioned `styles/major-stations.geojson` and bundles the same data in `world.style.json` for the first upgrade from the previous installed worker. This initial list contains 181 independently checked priority candidates across ten regions. It is not the map's complete station inventory: provider stations fill the remaining space at zooms 4–6 beneath the curated hubs, including the provider copy of a curated identity. Zoom 3 retains the previous globe selection. The curated selection admits closer candidates at each regional band without deferring the previously selected hubs; collision placement determines the labels actually visible on screen. The band spacing and padding live in `MAJOR_STATION_DENSITY` in `scripts/major-stations.mjs`. Chicago Union, New York Penn, Tokyo, Taipei, Beijing and Shanghai retain their principal-hub priority; adjacent secondary terminals can remain deferred to the ordinary provider labels.

For edits, choose a passenger-network role first, then verify the OSM object and an independently linked Wikidata identity/coordinate. `mappedFeature` records whether the object is a railway/public-transport station or a station building; never relabel a stop area, bus terminal or subway point as heavy rail. Coordinates come from OSM nodes or Wikidata CC0 for mapped areas/buildings. Keep one plain `name` only as a human-readable maintenance note beside the coordinates; it is never emitted to map data. Do not store `name:*` translations here. Display names and translations are read from the identified OSM object at runtime. Keep type/ID aliases, country, metro, region, minimum eligibility zoom, manual priority, verification date and source/basis links. No passenger counts are asserted without a source. Cross-check the country against the station’s Wikidata `P17` claim and ISO country code (following a constituent country’s parent if needed); record `countryEvidence` and `countrySource`. The build rejects conflicts. Country checks cover every candidate. The Nigeria Lagos entry uses mapped Mobolaji Johnson Station; the unresolved Cusco candidate was excluded after a homonymous Philippine station was detected.

Run `npm run build` and commit both generated files, then `npm test`. Review derived tiers and the Chicago/NY/Tokyo sanity checks after changes; a newly verified candidate can defer a nearby label. Check globe zoom 3, regional zooms 4–6, language switching, source release at zoom 7 and station inspection. The runtime makes no Overpass, Nominatim or facility API calls to rank these stations. Curated hubs carry no names: the client names each hub in view from the provider's zoom-8 station tile, matched by OSM identity, as for other station labels; no OpenStreetMap API request is made, and the tiles requested are those holding the curated hubs in view. Cached one-time Wikidata and direct OSM object/selected-station-area reads were used for the identity audit; unresolved candidates were excluded.

See [Axle load](axle-load.md) for the new view, national class distinctions, source references and the 28-day snapshot refresh.

Curated hubs carry no names: the client names them from the provider's station tiles by OSM identity ([label rules](labels.md)). When the provider keys a hub's grouped station on an OSM object other than the curated one, add that object to the entry's `osmAliases`; the provider's station feature API lists every OSM object in a group.

## Railway signals and traction supplies

The manual or code-change-triggered `traction-facilities.yml` workflow prepares
worldwide railway energy supply facilities, conductor rails and battery train
charging, electrification signals, and the railway signals omitted by the
provider's direction-dependent signal source. It adds no schedule. Every
world partition must complete before either dataset replaces `traction-data`;
partial/error Overpass responses are rejected. Complete raw regions are kept
for retries. The site workflow validates both manifests before copying
`power/` and `signals/` under `styles/data/traction/`.

Run `node scripts/build-power-facilities.mjs`, `node scripts/build-power-methods.mjs`
and `node scripts/build-signals.mjs` (which also builds the electrification
signals; `node scripts/build-electricity-signals.mjs` builds those alone, as a
fallback) for local maintenance. These builders use the public Overpass service; map
visitors only fetch the resulting static files. See [power facilities](power-facilities.md)
for the tag rules and primary references.

### Required aerialway snapshot at deployment

Aerialway geometry comes only from `aerialway-data`. The site build must fetch
that branch and validate its manifest, nonempty unique tile index and every
indexed compressed vector tile before publishing. Missing branches, failed
fetches, empty indexes and missing/corrupt tiles fail the build; they are not
replaced with an empty snapshot. This preserves the last successful deployment
when refresh data is unavailable. A new fork must publish its first valid
snapshot before deploying. The existing 5,000-feature acquisition floor and
zoom-12 contract are unchanged. This structural check does not claim complete
worldwide OSM coverage or freshness, and does not start a new extraction.
