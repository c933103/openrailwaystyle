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
| MapLibre railway layers: infrastructure, speed, control, gauge, loading gauge, owner, electrification, stations, signals, entrances, platforms, crossings | Logical `https://openrailwaymap.app/<dataset>` metadata in `rail-source-catalog.mjs`; recognized XYZ tile requests use the upstream **comma-separated composite** endpoints via `railProviderTileURL`. The actual outgoing URL may differ from the logical style URL. | Public *interactive* browser use is governed by public-app conditions. CI requests to live map tiles are prohibited; isolated with synthetic responses. |
| Language-dependent station tiles and label adapters | `atlasstation://`, `atlasrail://`, `atlastext://` and other protocols wrap `openrailwaymap.app` TileJSON/tile requests (`styles/app.mjs`, `styles/tile-labels.mjs` and generated browser bundle) | A custom URL scheme does not change the classification of its underlying HTTP requests. Browser CI blocks requests to the public hostname at the network boundary. |
| Track-count expansion when users view z14+ (default option enabled) | The z14 counter uses 3x3 halos of track geometry, station areas and station points; logical requests share the *physical composite endpoint URL* in the bounded pool. | The numbers in the historical measurement below predate composite-endpoint routing. In the current model, station areas and station points can share one composite tile fetch instead of two. A no-track halo still skips station dependencies. No numerical operator threshold is published, so fixture measurements are not a compliance verdict. |
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

### Composite track-count request bounds

The composite-routing regression uses in-process MVT fixtures, with no public
provider traffic. A rail-bearing count tile retains all **27 logical inputs**:
nine railway, nine station-area and nine station-point tiles. Those inputs now
share **18 physical downloads** because both station datasets use the same
composite endpoint. A cold 2x2 viewport uses **32** physical downloads; an east
pan adds **8**. A definitely empty track halo still skips station inputs
(**16** cold and **4** additional). Per-origin transport concurrency stays at **4**.
Worker transfer ownership remains separate: all 27 inputs receive distinct
private buffers, while the cache retains the 18 physical originals. Each worker
input reads only its named MVT layer, including when other layers have colliding
feature IDs or plausible station geometry.

The real-MapLibre 1280x800 Infrastructure fixture enforces **45** cold requests
and **9** additional east-pan requests as ceilings, derived by collapsing the
historical station-area/station-point pairs below. It requires both railway and
station physical endpoints, composite routing and exact-URL deduplication.
This run observed **43** cold requests and **8** additional requests. Geometry
filtering, partial-outage recovery and genuine browser request headers remain
required. These synthetic measurements do not establish live availability or
operator-approved traffic limits.

### Historical track-count request amplification (before composite routing)

Measured on 2026-10-07 with deterministic in-process vector-tile fixtures; **no
public OpenRailwayMap tile traffic was sent**. These are historical physical
request counts **before** the 2026-10-23 adaptation to combined Martin endpoints,
not a forecast of present-day public traffic. The updated client deduplicates
station-areas and station-points dependencies against one composite URL; the
real-MapLibre synthetic fixture now asserts the composite limits above. Atlas computes
at z14 and overzooms those count tiles above z14.

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
  that the interaction actually issues track-count dependencies and at that time
  enforced 65/13 as regression ceilings, so a future reduction was allowed but an
  unnoticed increase is not. Symbol placement is deliberately not used as the
  completion gate because collision handling may legitimately hide every badge.

The three halo datasets and their geometries remain necessary for cross-tile
joining and station-boundary behavior, but **27 no longer means 27 HTTP
requests** after composite routing. Further reduction of geometry work requires
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
| Esri World Imagery (Satellite/Hybrid, when configured) | `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=…` through `atlasimagery://`, source max zoom 18; the key comes from the `ESRI_API_KEY` repository variable, written into `imagery-config.json` only by the production deploy | ArcGIS Location Platform: 2M basemap tiles free, then billed or blocked; Esri removes the service privilege when the free tier ends. A 401/403/498/499 or non-image response switches the device to EOX for 6 hours (`localStorage`); other failed Esri tiles fall back to EOX individually, and above z14 the EOX z14 ancestor is cropped. Attribution: "Powered by Esri" plus Esri, Vantor, Earthstar Geographics, and the GIS User Community (World Imagery item credits). Tiles are not cached by the service worker. Esri's placeholder image for areas without deep imagery is not detected. The key is public in the browser and must be restricted to the site's referrer in the ArcGIS dashboard. Without the variable the site keeps the direct EOX source unchanged. |
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

## Permanent-response retry classification

The basemap wrapper and non-ORM metadata reload handler use the existing
request-pool/rail HTTP policy: **408, 429 and 500–599** are retryable; other
HTTP failure responses (including 400, 401, 403, 404, 410, 416, 422 and 451)
are not. Classification accepts explicit status fields and the pinned
PMTiles 4.2.1 `Bad response code:` / MapLibre `AJAXError:` messages. A known
permanent status takes precedence over generic network wording. Recognized
transport failures and `TimeoutError` remain retryable. Intentional aborts,
malformed archive/JSON errors and unknown exceptions do not trigger retries.
The basemap's 20-second range deadline now reports `TimeoutError`, distinct
from a consumer's cancellation.

Retry ownership and maximum budgets are explicit:

- **Basemap:** one initial protocol attempt plus two retries after 0.5 and
  2 seconds for transient failures. A failed shared archive is replaced only
  if another consumer has not already replaced it. Permanent failures keep
  their original error and do not cause archive replacement. Cancellation
  during backoff settles immediately and starts no further range requests.
- **PMTiles internals:** ordinary HTTP errors have no inner retry. The pinned
  client retains its one small-archive 416 range correction and one ETag
  repair for directory/tile reads. An exhausted ETag repair is not retried by
  Atlas. These protocol repairs are not a new general HTTP retry allowance.
- **Other metadata:** one initial source load plus at most three reloads
  after 5, 15 and 45 seconds. Duplicate error events share the pending timer;
  a permanent failure, actual metadata success, changed source/URL or map
  removal retires it. MapLibre marks metadata failures as loaded, so that
  flag alone cannot suppress recovery.
  A request-pool adapter can still make two transport attempts per source
  load (maximum eight across this existing metadata budget). Direct metadata
  sources make at most four transport attempts.
- **No nested basemap reloads:** `atlasbase://` owns its retries, so the app's
  metadata handler does not repeat its three-attempt budget. Previously a
  permanent basemap metadata response consumed three wrapper attempts. The
  outer handler could multiply that to twelve if the source reported unloaded
  after failure (the pinned MapLibre instead reports loaded). The new owner
  rule prevents multiplication in either case; the permanent header failure
  has one actual range request.

`tests/pmtiles-retry.test.mjs` exercises the actual pinned FetchSource,
Protocol and caches with synthetic header, leaf-directory, metadata and tile
ranges. It counts permanent/transient requests, shared-consumer work,
cancellation and the existing 416 repairs. `tests/provider-retry.test.mjs`
and the startup harness cover status serialization and metadata timer
ownership. `scripts/check-provider-retries-browser.mjs` checks real MapLibre
403/503 metadata events, successful transient recovery and the unrelated
permanent failure's retained status under the fail-closed fixture guard.

This is a bounded retry-classification correction, not a provider-policy or
availability verdict. PMTiles 4.2.1 does not expose response `Retry-After`
headers to this wrapper; its existing fixed transient backoff remains a
separate limitation. The glyph/request pool's existing `Retry-After` handling,
rail demand-driven recovery, terrain deadlines and source/data holds are
unchanged.

### Partial map-source recovery

Map error presentation records each failed non-rail tile independently, tied to
its source instance. A loaded sibling or successful metadata response cannot
clear an unresolved tile; metadata failures require metadata success. Multiple
world copies remain independent. Source replacement retires obsolete evidence,
and renderer-cache retirement does not assert that a provider recovered. A known
failed cached tile restores its warning if reused without a fresh error event.
Hidden layers retain their unresolved evidence. This bookkeeping does not add
requests, retry budgets or cache invalidation, and does not change the dedicated
rail/station recovery mechanisms.

Source-less failures (including glyph errors without resource identity) cannot
be matched to a later source success and remain a generic warning until the map
is replaced/reloaded. A tile error with unusable identity likewise cannot be
cleared by an unrelated success. Provider-specific wording and source-less glyph
recovery remain separate work, as do the wider availability/coverage requirements
in #112. The earlier #138 comments describe residual work, but GitHub marks that
issue closed; this increment is tracked under #112 and does not close it.

`tests/source-failures.test.mjs` and startup tests cover exact resource recovery,
metadata/tile mixtures, world copies, replacement, cancellation and cached reuse.
The guarded provider browser check exercises actual MapLibre vector and raster
403 failures beside healthy tiles, then recovers the failed tiles individually.
All provider responses in these checks are synthetic; no current provider
availability, usage-policy compliance or worldwide coverage is inferred.
