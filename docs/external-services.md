# External provider conditions: OpenRailwayMap (issue #138)

Reviewed on 2026-10-07. This is an audit of the published terms for the
**public OpenRailwayMap service hosted at `openrailwaymap.app`**, not a legal
interpretation of every third-party data source used by Railway Atlas.

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
| Generic browser response cache | `scripts/browser.mjs` cached all external GET responses (200/204/206), including public railway tiles, seven days; miss used `route.continue()` | **Confirmed risk**: repeated CI runs could fetch provider map tiles automatically; cache hits do not fix initial collection. Cache now excludes public ORM URLs; cache generation bumped to invalidate mixed entries. |
| Browser smoke and geographic tests | `check-map-browser.mjs`, `check-context-browser.mjs`, `check-planning-browser.mjs` requested many global regions; deployment also ran these after publishing | **Confirmed risk**: automated map-tile requests. Not part of public CI or post-deploy steps anymore. Early guard requires local provider if manually invoked. |
| Synthetic WebGL tests | `check-platform*`, `check-infrastructure-browser.mjs`, `check-signal-power-browser.mjs`, new `check-orm-fixture-browser.mjs` | Provider TileJSON/tiles replaced by generated/recorded local fixtures; no provider tile downloads required. |
| Facility search | `https://api.openrailwaymap.org/v2/facility` | Separate domain and unverified service policy. `check-search-api.mjs` remains a separately flagged non-blocking check; do not infer that `.app` tile conditions settle it. |
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

The remaining 27-request rail-bearing single-tile cost is retained because the
current counter uses all three neighbour halos for cross-tile line joining and
station-boundary behavior. Reducing those inputs further without a replacement
data model would change established counts. A larger reduction should use
precomputed/self-hosted count data rather than silently truncating neighbours.

## CI safeguards and geographic testing

1. `scripts/browser.mjs` installs an `openrailwaymap.app` network guard on
   **every** Playwright context and disables service workers (which may bypass
   route interception). By default it aborts public ORM requests, rather
   than silently allowing cache misses to hit the network.
2. Individual deterministic tests intercept the real provider URL pattern
   with `page.route()`, fulfill it using in-process metadata and tile fixtures,
   and inspect browser-generated Referer/User-Agent headers without allowing
   a network download. The `check-orm-fixture-browser.mjs` test exercises
   the real Atlas page and MapLibre, including Wuhan at z6 and z7, with
   synthetic railway vector tiles. Its railway geometry is **not evidence of
   real Wuhan OSM content**.
3. The `BROWSER_TILE_CACHE` helper excludes `openrailwaymap.app` entirely.
   GitHub Actions' cache key changed from `browser-tiles-v1` to
   `browser-tiles-v2-no-public-orm` to avoid replaying previously fetched
   public tiles. Other external providers are **not** declared compliant by
   this change and remain within the broader scope of #138.
4. The complete, real-geography checks (`check-map-browser.mjs`,
   `check-context-browser.mjs`, `check-planning-browser.mjs`, and
   `check-major-stations-browser.mjs`) are **local-only** until populated
   with independently licensed fixtures or tested against a locally hosted
   OpenRailwayMap dataset. They are not run as automated public-provider tests
   in PR CI or post-deploy CI.

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
Other external basemap/glyph/terrain providers can still affect these
full-geography audits and require separate review.

## Remaining issues (not resolved by this change)

- **Attribution visibility:** confirm with the operator whether attribution
  inside the collapsed ⓘ control qualifies as "clear"; consider making the
  provider name persistently readable if not.
- **TileJSON and health-probe classification:** confirm whether limited,
  backoff-controlled automated requests for metadata at `openrailwaymap.app`
  count as permitted API use, and whether any further request limits apply.
  PR #145's outage recovery must not be read as blanket permission.
- **Real-geometry coverage:** the offline z6/z7 fixture proves rendering
  integration but does not establish that the published Wuhan/China railway
  network contains the correct lines. Run a self-hosted real-data audit with
  relevant OSM extracts or a separately permitted dataset.
- **Other third-party services:** terms/headers/availability for
  `api.openrailwaymap.org`, Transitous, Overpass, En Liberté,
  Mapzen/AWS terrain, EOX imagery, OSMF Standard, glyph/CDN sources and
  others remain separate #138 inventory items, not automatically permitted.
- **Header verification:** a real Chromium session's `Referer`/user-agent
  should be inspected without spoofing, across redirects and nested tile
  requests. The October 5 reported 403 is an observed symptom, not a
  request-level authorization audit.
