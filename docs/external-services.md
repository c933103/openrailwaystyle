# External service inventory and conditions (issue #138)

The independent OSM reference pipeline for #181 uses dated Geofabrik PBF
exports and local Osmium filtering. Its acquisition policy, bounds,
attribution, failure states and exact-source acceptance are documented in
[mainline-reference.md](mainline-reference.md). It never fetches ORM tiles.

The OpenRailwayMap policy audit below is dated 2026-10-07. Runtime inventory
and CI boundaries were reconciled on 2026-10-19 against
[`dbdab03b024c92dd7bd3c2328d562e50e1a7653b`](https://github.com/c933103/openrailwaystyle/tree/dbdab03b024c92dd7bd3c2328d562e50e1a7653b).
That reconciliation inspected source only: no live provider calls or new
runtime measurements, and no re-verification of published service terms.
The ORM audit applies to the **public service at `openrailwaymap.app`**;
it is not a legal interpretation of every data source used by Railway Atlas.

## Primary policy and verified requirements

Source: [OpenRailwayMap-vector USAGE.md](https://github.com/hiddewie/OpenRailwayMap-vector/blob/master/USAGE.md)
(repository of the service operator). The published terms say:

| Access type | Published condition | Railway Atlas treatment |
| --- | --- | --- |
| Third-party, public map application | Tile use allowed without registration for an application open to the public without registration, provided attribution is **clear** | Atlas exposes `OpenRailwayMap` and `© OpenStreetMap contributors` as source attributions (`scripts/style/sources/railway.mjs`). The UI collapses these under the ⓘ control: **whether this is sufficiently clear remains unverified**. Do not label it fully compliant on that basis alone. |
| Automated map-tile retrieval | **Not permitted**, including automated or bulk tile downloads. Operator directs automated deployments to a **local OpenRailwayMap setup**. | Standard CI and deployed-site smoke tests use synthetic fixtures, never public tiles. Full geographic verification needs a local server. Caching a previous automated fetch does **not** authorize that fetch. |
| API usage | Allowed from applications **and automated processes**, with limited request counts | Do not interpret this as permission for CI to download map-tile bodies. Classification of TileJSON metadata/health probes is not explicit; see unresolved questions. |
| Request identification | Genuine `Referer` for browsers or `User-Agent` for automated clients; they must not be faked | Atlas does not set a fabricated provider Referer/User-Agent. `styles/index.html` declares `strict-origin-when-cross-origin`, so Chromium should send the site's true origin as Referer for HTTPS provider requests. The synthetic browser integration test intercepts **TileJSON and tile-body requests**, inspects the browser-supplied Referer and User-Agent, and fails if either is absent or Referer is not the site's origin—no public service request is sent by the test. This verifies the pinned test browser's headers, **not all possible production browsers or configurations**. A 403 for a scripted request missing Referer is **not** permission to run automated tile downloads after adding Referer. |
| Enforcement | Service access may be blocked without notice | Treat HTTP 403 and outages as provider conditions, not evidence of missing railway geometry. |

The policy's explicit scope is `openrailwaymap.app`. Do **not** assume it
automatically governs `api.openrailwaymap.org` (Atlas facility search API);
separate terms for that host have **not been verified**.

## Request inventory and observed risk

| Atlas request path | Endpoint / transport | Automation risk and disposition |
| --- | --- | --- |
| MapLibre railway layers: infrastructure, speed, control, gauge, loading gauge, owner, electrification, stations, signals, entrances, platforms, crossings | `https://openrailwaymap.app/<dataset>` TileJSON and tile URLs; see `scripts/style/sources/railway.mjs` | Public *interactive* browser use is governed by public-app conditions. CI requests to live map tiles are prohibited; isolated with synthetic responses. |
| Language-dependent station tiles and label adapters | `atlasstation://`, `atlasrail://`, `atlastext://` and other protocols wrap `openrailwaymap.app` TileJSON/tile requests (`styles/app.mjs`, `styles/tile-labels.mjs` and generated browser bundle) | A custom URL scheme does not change the classification of its underlying HTTP requests. Browser CI blocks requests to the public hostname at the network boundary. |
| Track-count expansion when users view z14+ (default option enabled) | The z14 counter uses 3x3 halos of track geometry, station areas and station points; exact URLs share in-flight/cache entries. | **Measured with local fixtures only:** one cold rail-bearing tile = 27 distinct requests; cold 2x2 viewport = 48 instead of 108 logical candidates; one-tile east pan adds 12. Track geometry is now fetched first; station areas and points then load in parallel only when needed. A railway halo whose returned track bodies are all zero-length skips both station datasets (cold zero-length 2x2 fixture = 16). No numerical operator threshold is published, so this is a volume measurement, not a compliance verdict. |
| Major-stations placement/baseline audit | `scripts/check-major-stations-browser.mjs` used Playwright `route.fetch()` to fetch live `standard_railway_text_stations_low/med` responses for baseline comparison | **Confirmed risk**: direct automated tile downloads, even if deduplicated for comparison. Now explicitly requires `ATLAS_TEST_ORM_URL`; its `route.fetch` points to loopback data only. |
| Legacy browser response cache | `cacheOtherOrigins` in `scripts/browser.mjs` is retained for cache-format regression tests, but the harness and CI no longer install it | Historical caching did not authorize initial automated retrieval. The current guard blocks every unmocked third-party request, including a legacy cache miss through `route.continue()`; this is not an ORM-only exclusion. |
| Browser smoke and geographic tests | `check-map-browser.mjs`, `check-context-browser.mjs`, `check-planning-browser.mjs` requested many global regions; deployment also ran these after publishing | **Confirmed risk**: automated map-tile requests. Not part of public CI or post-deploy steps anymore. Early guard requires local provider if manually invoked. |
| Synthetic WebGL tests | `check-platform*`, `check-infrastructure-browser.mjs`, `check-signal-power-browser.mjs`, new `check-orm-fixture-browser.mjs` | Provider TileJSON/tiles replaced by generated/recorded local fixtures; no provider tile downloads required. |
| Facility search | `https://api.openrailwaymap.org/v2/facility` | Separate domain and unverified service policy. `check-search-api.mjs` remains a separately flagged non-blocking live check on non-PR site workflow events; PRs use synthetic fetch/CORS fixtures. Do not infer that `.app` tile conditions settle it. |
| Recovery probe in PR #145 | Shared, backoff-limited TileJSON health probe with MapLibre source reload | Recovery when a real user's provider is down is distinct from CI permission. **TileJSON is metadata, not a vector tile body**, but whether the operator classifies this particular endpoint as a limited automated API request is not established. Browser-generated genuine request identification still applies. |
| Offline and in-memory caching | `styles/sw.js` retains app shell/libs/selected fonts rather than public provider tiles. `styles/byte-cache.mjs` bounds in-memory raw byte caching | No prohibited automated/bulk request demonstrated **from these caches alone**; their presence is not independent permission for other automated tile retrieval. |

The service operator policy does not enumerate a quantitative API rate limit.
No particular number of calls, retry cadence or TileJSON polling allowance
has therefore been certified as compliant.

### Track-count request amplification measurement

Measured on 2026-10-07 with deterministic in-process vector-tile fixtures; **no
public OpenRailwayMap tile traffic was sent**. Atlas computes at z14 and
overzooms those count tiles above z14, so this covers z14+ interaction.

- Cold rail-bearing single count tile: **27 distinct requests** (three 3x3
  dataset halos). Track geometry is fetched first; the two station datasets
  then run in parallel, so peak dependency concurrency is **18** rather than
  the previous all-at-once 27.
- Cold rail-bearing 2x2 viewport: **48 distinct requests**, not 108 logical
  candidates, because overlapping halos collapse to one 4x4 union per dataset.
- Pan that 2x2 viewport east by one count tile: **12 new requests**.
- Cold 2x2 viewport whose track-tile responses are all zero-length: **16
  distinct requests** (track geometry only); the same east pan adds **4**.
  Non-empty payloads retain the full dependency path even if malformed or
  otherwise undecodable, so this shortcut cannot silently broaden itself.
- A real MapLibre 1280×800 Infrastructure-view fixture at z14 requested **65
  distinct track-count dependencies** after in-flight/cache sharing: 25 track
  geometry, 20 station-area and 20 station-point tiles. Panning east by 512 px
  added **13** requests (5 + 4 + 4), for 78 total. The browser fixture verifies
  that the interaction actually issues track-count dependencies and enforces
  65/13 as regression ceilings, so a future reduction is allowed but an
  unnoticed increase is not. Symbol placement is deliberately not used as the
  completion gate because collision handling may legitimately hide every badge.

The remaining 27-request rail-bearing single-tile cost is retained because the
current counter uses all three neighbour halos for cross-tile line joining and
station-boundary behavior. Reducing those inputs further without a replacement
data model would change established counts. A larger reduction should use
precomputed/self-hosted count data rather than silently truncating neighbours.

## Non-rail map providers and first-party assets

These are application request paths, not a fresh audit of provider policies.
No API key or custom identifying header is configured at these inspected
map/glyph/DEM call sites. That does not establish what a provider requires or
what headers every browser sends. Hosted-service limits, identification,
caching permission and availability remain unverified unless stated otherwise.

| Dependency | Runtime endpoint and transport | Current handling and limits |
| --- | --- | --- |
| En Liberté basemap | `https://tuiles.enliberte.fr/planet.pmtiles`; PMTiles HTTP `Range` reads wrapped in `atlasbase://`; also supplies the bathymetry water mask | Shared archive with a 20 s per-range abort timeout; the label wrapper evicts failed archives and retries twice after 0.5/2 s. OSM/En Liberté attribution is declared. These are application settings, not provider-approved budgets. [Definitions][basemap-source], [initialization][map-initialization], [wrapper][basemap-wrapper]. |
| En Liberté remote glyphs | `https://tuiles.enliberte.fr/fonts/{fontstack}/{range}.pbf`, wrapped in `atlasglyph://`; local CJK families are removed from `fontstack` | Shared pool: 12 s deadline from dispatch, one retry after at least 1 s for retryable failures, concurrency 4 per origin / 6 total. `Retry-After` can extend the delay and origin cooldown. Remote glyph licence and hosted-service conditions have not been established by this inventory. [Fontstack filtering][glyph-filter], [adapter][glyph-adapter], [pool][request-pool]. |
| EOX Satellite/Hybrid | `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg`; raster tiles, source max zoom 14 | Source/help declare EOX, modified Copernicus Sentinel data 2025, and CC BY-NC-SA 4.0/non-commercial use. This records the application's licence notice, not a new verification of provider terms or service limits. [Source][basemap-source], [credits][licence-notices]. |
| OSM Standard (Carto background) | `https://tile.openstreetmap.org/{z}/{x}/{y}.png`; raster tiles, source max zoom 19 | Ordinary browser caching; no offline/prefetch support. OSM attribution is declared and the help links the OSMF tile policy. Current header/policy/attribution acceptance remains unverified. [Endpoint][carto-source], [source][basemap-source], [help][source-notices]. |
| Mapzen Terrain Tiles / AWS | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`; relief, contours, bathymetry, measure heights and elevation profiles, including coarser/finer repair reads | Relief/contour `DemSource` has a 20 s timeout and cache size 200. The separate elevation reader shares pending work and bounds each completed-tile cache to 64. Main reads have a 20 s end-to-end deadline including body/decode; optional repair has a separate 5 s total budget. Missing main tiles stay unknown; failed optional repair retains usable fine heights. Worker repair references share active reads separately from their 32-entry successful cache and use a 5 s budget; failed/abandoned references are not cached. The existing outer DemSource 20 s deadline still applies to the whole worker request. [Endpoint][dem-source], [initialization][map-initialization], [elevation reader][elevation-source], [repair worker][dem-worker]. |

Elevation deadlines are application budgets, not provider-approved request
limits. Close, replacement and measurement edits cancel their subscriptions;
another consumer of the same tile keeps its request. The last departing
consumer aborts the transport, and a late non-cooperative response cannot
populate the cache or replace newer work. No automatic retry is added. Failed
main tiles can be retried by reopening a profile or using the existing Retry
heights control. Successful fine results retain the existing completed cache,
even if optional repair was unavailable. Worker reference failures are evicted,
so a later tile request can obtain recovered repair inputs.

The profile has at most two asynchronous phases: 20 s for its main reads and
5 s for optional repair. Repair timeout preserves the original fine tile; it
never manufactures a zero height. Partial main failures remain explicit chart
gaps and exclude unknown stretches from statistics. These bounds cover pending
asynchronous work while the JavaScript event loop runs; browser suspension and
synchronous decoding/repair CPU are not wall-clock execution guarantees.

`tests/terrain-deadlines.test.mjs` uses controlled never-settling headers,
bodies and decoders, cancellation, late settlement and cache recovery; existing
profile-gap and measurement-state tests retain their assertions. The guarded
`check-terrain-deadlines-browser.mjs` exercises the actual app and renderer with
real default 20 s deadlines, synthetic PNGs, partial-profile recovery, Close
and measurement retry. No provider traffic or current-service claim is needed.

MapLibre 5.24.0 with the Atlas attribution backport, PMTiles 4.2.1, the
contour/worker bundles, packaged Chinese Noto WOFF2 files and rare-Han slices
are **first-party runtime assets**. The jsDelivr URLs in current code identify
verified legacy-cache compatibility entries, not current startup downloads.
Installed-font fallback and optional packaged fonts are distinct from the
remote glyph endpoint above. npm installation and upstream font acquisition
are build/maintenance dependencies, not browser CDN dependencies. See the
[library loader][library-loader], [legacy-cache handling][legacy-libraries],
[browser build][browser-build] and [font provenance][font-provenance].

The [basemap wrapper][basemap-wrapper] retries every non-cancelled exception;
it does not classify permanent HTTP responses or honor `Retry-After` itself.
The separate [non-ORM metadata handler][metadata-retries] can reload a source
up to three times after 5/15/45 s and has no HTTP-status exclusion in its
condition. The combined budget has not been measured here. Non-rail error
bookkeeping is source-based (or `resource` for source-less errors), not a
verified per-provider/per-failed-tile recovery contract. Those runtime limits
remain follow-on work in #138; this documentation correction does not fix them.

[basemap-source]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/scripts/style/sources/basemap.mjs#L1-L19
[map-initialization]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/app.mjs#L1532-L1550
[basemap-wrapper]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/tile-labels.mjs#L300-L322
[glyph-filter]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/tile-labels.mjs#L18-L25
[glyph-adapter]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/tile-labels.mjs#L147-L159
[request-pool]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/request-pool.mjs#L7-L98
[licence-notices]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/index.html#L180-L188
[carto-source]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/map-model.mjs#L180-L183
[source-notices]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/index.html#L174-L188
[dem-source]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/map-model.mjs#L821
[elevation-source]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/elevation.mjs#L8-L87
[dem-worker]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/dem-worker.mjs#L12-L42
[library-loader]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/app.mjs#L110-L146
[legacy-libraries]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/sw.js#L20-L35
[browser-build]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/scripts/build-browser.mjs#L20-L46
[font-provenance]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/fonts/README.md
[metadata-retries]: https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/styles/app.mjs#L1773-L1823

## CI safeguards and geographic testing

1. [`scripts/browser.mjs`](../scripts/browser.mjs) installs the fail-closed
   [`browser-network-guard.mjs`](../scripts/browser-network-guard.mjs) on
   **every** Playwright context. All unmocked third-party requests are blocked
   before egress, including later handlers using `route.continue()` or
   `route.fetch()`. Only loopback HTTP and explicitly selected first-party
   deployment paths may be read. Redirects are rejected, WebSockets are
   blocked, and registered service workers are disabled because they can
   bypass route interception. Dedicated map workers run under the guard.
2. Individual deterministic tests intercept the real provider URL pattern
   with `page.route()`, fulfill it using in-process metadata and tile fixtures,
   and inspect browser-generated Referer/User-Agent headers without allowing
   a network download. The `check-orm-fixture-browser.mjs` test exercises
   the real Atlas page and MapLibre, including Wuhan at z6, z7 and z8, with
   synthetic railway vector tiles. Its railway geometry is **not evidence of
   real Wuhan OSM content**.
3. The legacy external disk cache is **not installed by the harness or CI**.
   Retained cache-format utilities are regression-test code, not a route to
   provider egress. Every external map provider needs an explicit fixture;
   this includes basemap, glyph, raster and terrain requests as well as ORM.
   See the [harness setup](https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/scripts/browser.mjs#L29-L53)
   and [legacy-cache scope](https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/scripts/browser.mjs#L100-L103).
4. The complete, real-geography checks (`check-map-browser.mjs`,
   `check-context-browser.mjs`, `check-planning-browser.mjs`, and
   `check-major-stations-browser.mjs`) are **local-only** until populated
   with independently licensed fixtures or tested against a locally hosted
   OpenRailwayMap dataset. They are not run as automated public-provider tests
   in PR CI or post-deploy CI.
5. This boundary describes the browser matrix, **not an offline deployment
   workflow**. Package installation, GitHub snapshot reads and first-party
   deployment verification remain real network work. Outside the matrix,
   [the site workflow](https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/.github/workflows/site.yml#L142-L158)
   runs the one-request station-search probe on non-PR events; PRs run its
   synthetic positive/negative fetch and CORS tests. The
   [live probe](https://github.com/c933103/openrailwaystyle/blob/dbdab03b024c92dd7bd3c2328d562e50e1a7653b/scripts/check-search-api.mjs#L1-L17)
   makes one fetch with a 20 s abort timeout, no retry, and redirects rejected
   before following them. See [development validation](development.md#validation)
   for the fixture and service-worker coverage limits.

To run the real-data geographic audits using your own locally installed
OpenRailwayMap service (with your own local tiles/data), set the local HTTP
base URL and run the desired test:

```sh
export ATLAS_TEST_ORM_URL=http://127.0.0.1:4174/
node scripts/check-map-browser.mjs
node scripts/check-major-stations-browser.mjs
```

`ATLAS_TEST_ORM_URL` only accepts `http://localhost`, `http://127.0.0.1`
or `http://[::1]` loopback endpoints; redirects from the local HTTP server
are not followed. **Do not set this to a hosted proxy that fetches public
OpenRailwayMap tiles on the test's behalf**. The local service needs compatible
TileJSON, vector tiles and enough geographic coverage for the assertions.
Other external basemap/glyph/terrain providers remain blocked in these
full-geography audits too: supply local fixture routes for any data they need.
No option re-enables public provider egress.

## Remaining issues (not resolved by this change)

- **Attribution visibility:** confirm with the operator whether attribution
  inside the collapsed ⓘ control qualifies as "clear"; consider making the
  provider name persistently readable if not.
- **TileJSON and health-probe classification:** confirm whether limited,
  backoff-controlled automated requests for metadata at `openrailwaymap.app`
  count as permitted API use, and whether any further request limits apply.
  PR #145's outage recovery must not be read as blanket permission.
- **Real-geometry coverage:** the offline z6/z7/z8 fixture proves rendering
  integration but does not establish that the published Wuhan/China railway
  network contains the correct lines. Run a self-hosted real-data audit with
  relevant OSM extracts or a separately permitted dataset.
- **Other third-party services:** terms/headers/availability for
  `api.openrailwaymap.org`, Transitous, Overpass, En Liberté,
  Mapzen/AWS terrain, EOX imagery, OSMF Standard and remote glyph sources
  remain separate #138 inventory items, not automatically permitted. Build-time
  package/font acquisition is separate from first-party runtime asset delivery.
- **Header verification:** a real Chromium session's `Referer`/user-agent
  should be inspected without spoofing, across redirects and nested tile
  requests. The October 5 reported 403 is an observed symptom, not a
  request-level authorization audit.

## Re:Earth Papers overview backbone (PR173)

The production `railBackbone` source reads
`https://papers.reearth.land/naturalearth_transport/tilejson.json`. Map initialization
can request that metadata; loading/panning at zooms 4–6 automatically requests the
view's transport tiles. Direct browser requests expose the requested tile areas,
the client's IP address and ordinary request headers to the hosting service.
The in-app Sources and Licences sections disclose this separately from the
detailed/thematic OpenRailwayMap data. No retention policy or service-level
guarantee is inferred here.

The [official Re:Earth Papers README](https://github.com/reearth/reearth-papers)
lists `naturalearth_transport` as Natural Earth transport, MVT, public domain,
and documents the [provider attribution page](https://papers.reearth.land/attribution).
[Natural Earth's own terms](https://www.naturalearthdata.com/about/terms-of-use/)
confirm that its vector/raster data may be used and modified without permission.
These data rights do not themselves establish unlimited hosted-service usage
rights. No separate Papers-specific hosted-service policy was established in
this check. Automated Atlas checks continue to fixture this host with no provider
egress. The vectors are generalized context, not verified present-day operating
railways, and do not fill the separate worldwide station-point inventory gap.
