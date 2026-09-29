# Lifecycle snapshot (construction, proposed, former lines)

## Why a snapshot

The upstream railway tiles exclude planned/construction lines at zoom 7 and former infrastructure until still higher zooms. A **published worldwide lifecycle snapshot** fills that gap without sending viewer requests to Overpass. Railways under construction appear at every zoom, proposed railways from zoom 5, and former (disused, abandoned, razed) lines from zoom 7. The snapshot tiles start at zoom 5; `scripts/build-overview-tiles.mjs` derives zoom 0–4 tiles holding only construction from them during the site build. The snapshot continues unchanged through zoom 11, and the ordinary detail tiles take over at zoom 12. Full way geometries cross viewport and extraction boundaries without clipping gaps.

## Extraction and storage

The maintenance build (`.github/workflows/snapshot.yml`) extracts disjoint world regions sequentially, subdivides dense regions when necessary, deduplicates OSM way IDs, retains name translations, and produces a PMTiles archive plus an ODbL GeoJSON database. It refuses to publish an incomplete extraction and checks the north–south extent of 남부내륙선. The manifest records each region’s OSM timestamp and feature count. The `rail-data` branch stores the published files; ordinary site builds unpack the archive into compressed static vector tiles without rerunning extraction. A compact tile index skips empty areas. This avoids GitHub Pages’ unreliable compressed archive range responses; the browser decodes whole tile files instead. The raw Overpass responses are kept in the `overpass-cache` release (the Actions cache expires after a week unused), so a rebuild after a change to `scripts/lifecycle.mjs` needs no Overpass queries.

## Scheduled updates

A scheduled run on Monday, Wednesday and Friday at 03:23 UTC (night across Europe, where most users of the public Overpass server are) asks Overpass only for ways changed since the previous run (`scripts/snapshot-delta.mjs`): changed planned, construction and former ways with geometry, and the IDs of changed operating ways, so a line that opens disappears from the snapshot within a few days. It also re-downloads the oldest ~5 MB of full region responses (`scripts/refresh-snapshot-cache.mjs`), catching what change queries miss, such as deleted ways (the whole world is renewed about every eight weeks), and fetches the loading gauge of every railway way as a CSV list of way IDs (`scripts/build-loading-gauge-list.mjs`, about 4 MB), which colours the zoom 0–6 overview of the Loading gauge view, since no overview tiles carry loading gauge.

## Overpass usage

A run is about 40 queries and 10 MB, within the Overpass API wiki's guidance for regular applications (under 100 queries and 10 MB a day); a region file larger than 5 MB still goes whole, so an occasional run is larger. Map visitors never query Overpass.

## Publishing

Each run publishes the snapshot and redeploys the site; the manifest records each region's OSM date and the time changes were applied up to. `rail-data` is replaced by a single commit on each publish, so the repository keeps only the current snapshot. For faster global refreshes, use planet/regional dumps or your own Overpass instance rather than querying public servers more often.

## Lifecycle line patterns

Lifecycle patterns are shared between style and SVG legend: construction uses long blocks; proposed uses spaced round dots; disused uses dash-dot; abandoned / removed uses sparse paired dashes. The same patterns apply to regional and detailed data, including the speed view.
