# Energy overlay camera budget acceptance

`node scripts/check-energy-viewport-browser.mjs` measures cold energy-data
response bodies requested by the pinned MapLibre renderer. It uses the production
energy sources, layers, mode-visibility rules and `createEnergyNetworkProtocol`.
All other providers are replaced by fixtures. This is an isolated overlay demand
check, not a full-app frame-rate, terrain-mesh or worldwide coverage measurement.

Each sample creates a fresh browser context, renderer and protocol cache. Desktop
1365×900/DPR 1 and phone 412×915/DPR 2.625 views exercise zooms 5, 7.75, 8, 11.75,
12, 14 and 16: tier boundaries and native zoom-14 overscaling included. Each zoom
has north-up, rotated, pitched Mercator and pitched globe cases, including 60°
and 80° pitch. The latter applies the application's high-pitch LOD constants;
the cached-tile limit also matches the app. Camera centres cycle through the
Equator, Nuuk latitude and the dateline. Two additional cold non-Power controls
must issue no energy protocol or HTTP requests.

The default data is a compact synthetic point fixture encoded by the real tile
and bundle builders. Each active fixture sample must render nonempty geometry.
The renderer's requested protocol coordinates and every delivered energy HTTP
body are retained in `browser-review/energy-viewport-budget.json`. Metadata is
included, compressed bundle bodies are counted in full, and repeated responses
are counted again. HTTP headers, fonts and other map datasets are outside this
energy-overlay budget. A missing file, failed response, renderer error, absent
request evidence, changed camera or total of **350,000 bytes or greater** fails.
No feature is discarded to satisfy the threshold.

The prior `measure-energy-network.mjs` report computes a conservative north-up
flat window from unique bundle sizes. It cannot establish rotated/pitched/globe
request counts, nor repeated reads after the protocol's 24-bundle cache evicts
an entry. The browser report records those requests directly instead of treating
a per-file limit or an index of unique files as a viewport total.

For an already-built local candidate, run the same guarded check with
`ENERGY_NETWORK_CANDIDATE=/absolute/path/to/candidate`. Its manifest, index and
bundle structure are validated first; requested bodies come only from that
local directory. Each populated tier also adds six camera views centred on an
actual tile from its largest compressed bundle. The north-up hotspot must fetch
that bundle, so empty geographic samples cannot certify metadata alone. Their
SHA-256 identities remain in the report. Sparse candidate
views may legitimately have no rendered features, but must still supply cold
manifest/index request evidence. This option neither acquires data nor publishes
it. Run the existing complete-source and current-selection-filter gates as well.

A passing fixture report verifies the harness and protocol; a passing local
candidate report verifies only these sampled cameras and their recorded bytes.
Both explicitly retain `worldwideBudgetVerified: false`. Fresh complete world
data, geographic coverage and additional worst-case views remain necessary
before the project's worldwide 350 KB viewport goal can be claimed.
