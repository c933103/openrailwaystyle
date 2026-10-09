# Development and deployment

[Documentation index](README.md) · [Project overview](../README.md)

## Prerequisites

Use Node.js 22 (the version used in CI), npm, Git, Python 3 and pip. The commands
below use a POSIX shell. Viewing the map requires an internet connection and a
WebGL-capable browser; external tiles are not bundled for offline use.

## Build the application

```sh
git clone https://github.com/c933103/openrailwaystyle.git
cd openrailwaystyle
npm ci --ignore-scripts
npm run build
npm test
```

Run the remaining commands from the repository root. The build generates the
style and browser bundle; load the published data before starting the map.

## Load published map data

These steps mirror the assembly in [site.yml](../.github/workflows/site.yml).
They use published snapshots and do not run a new Overpass extraction. Snapshot
branches must already exist in the source repository; the commands below use
this project's published data even when developing a new fork.

```sh
snapshot_dir=$(mktemp -d)
git clone --depth 1 --single-branch --branch rail-data https://github.com/c933103/openrailwaystyle.git "$snapshot_dir/rail-data"
git clone --depth 1 --single-branch --branch street-data https://github.com/c933103/openrailwaystyle.git "$snapshot_dir/street-data"
git clone --depth 1 --single-branch --branch crossing-data https://github.com/c933103/openrailwaystyle.git "$snapshot_dir/crossing-data"

mkdir -p styles/data
cp "$snapshot_dir/rail-data/manifest.json" styles/data/
cat "$snapshot_dir"/rail-data/lifecycle.pmtiles.part-* > "$snapshot_dir/lifecycle.pmtiles"
python3 -m venv "$snapshot_dir/venv"
"$snapshot_dir/venv/bin/pip" install pmtiles==3.8.1
"$snapshot_dir/venv/bin/python" scripts/unpack-snapshot.py "$snapshot_dir/lifecycle.pmtiles"
node scripts/build-overview-tiles.mjs
cat "$snapshot_dir"/rail-data/lifecycle.geojson.gz.part-* > styles/data/lifecycle.geojson.gz

if [ -f "$snapshot_dir/rail-data/loading-gauge.json" ]; then
  cp "$snapshot_dir/rail-data/loading-gauge.json" styles/data/
fi
if [ -d "$snapshot_dir/rail-data/polar" ]; then
  cp -R "$snapshot_dir/rail-data/polar" styles/data/
fi

# Optional axle-load lookup; no new extraction is needed.
if git ls-remote --exit-code --heads https://github.com/c933103/openrailwaystyle.git axle-data; then
  git clone --depth 1 --single-branch --branch axle-data https://github.com/c933103/openrailwaystyle.git "$snapshot_dir/axle-data"
  cp "$snapshot_dir/axle-data/axle-load.json" styles/data/
fi

mkdir -p styles/data/street-running
cp -R "$snapshot_dir/street-data/12" "$snapshot_dir/street-data/index.json" "$snapshot_dir/street-data/manifest.json" "$snapshot_dir/street-data/street-running.geojson.gz" styles/data/street-running/

mkdir -p styles/data/level-crossings
cp -R "$snapshot_dir/crossing-data/5" "$snapshot_dir/crossing-data/9" "$snapshot_dir/crossing-data/index.json" "$snapshot_dir/crossing-data/manifest.json" styles/data/level-crossings/

# Optional historic areas; without them the planning context shows none.
mkdir -p styles/data/heritage
if git ls-remote --exit-code --heads https://github.com/c933103/openrailwaystyle.git heritage-data; then
  git clone --depth 1 --single-branch --branch heritage-data https://github.com/c933103/openrailwaystyle.git "$snapshot_dir/heritage-data"
  cp -R "$snapshot_dir"/heritage-data/* styles/data/heritage/
else
  echo '{"tiles":[]}' > styles/data/heritage/index.json
fi
```

For the facility overlays, load the validated `traction-data` snapshot as well:

```sh
git clone --depth 1 --single-branch --branch traction-data https://github.com/c933103/openrailwaystyle.git "$snapshot_dir/traction-data"
mkdir -p styles/data/traction
cp -R "$snapshot_dir/traction-data/power" "$snapshot_dir/traction-data/signals" styles/data/traction/
```

The temporary directory holds downloaded archives and a Python virtual environment;
keep it until assembly finishes. Published data and generated vendor files are
not source changes to commit. For extraction, refresh and publication details,
see [data maintenance](data-maintenance.md).

## Preview locally

```sh
node scripts/serve.mjs
```

Open [http://localhost:4173](http://localhost:4173). The local server serves
`styles/` on loopback only; production remains a static site without an application
backend. Directory URLs ending in `/` use `index.html`. Missing/unreadable files
and non-file paths return 404. If a file read fails after a response starts, that
response is closed and the preview remains available for subsequent requests.
Byte-range responses for archive assets remain supported.

## Source layout and generated files

| Path | Purpose |
| --- | --- |
| `styles/index.html`, `styles/app.mjs`, `styles/app.css` | Application page, controls and presentation |
| `styles/map-model.mjs` | Map semantics and shared display rules |
| `scripts/build-style.mjs`, `scripts/style/compose-style.mjs` | Generates station data and composes the atlas-owned rendering stack |
| `scripts/style/sources/`, `scripts/style/layers/` | Provider definitions and cartographic modules |
| `scripts/style/source-contract.mjs`, `styles/layer-semantics.mjs` | Consumed source schema and semantic visibility/localization controls |
| `styles/world.style.json`, `styles/major-stations.geojson` | Generated style and curated station labels, committed and checked for reproducibility |
| `styles/tile-labels.mjs`, `styles/han-region.mjs` | Label selection and geographic name rules |
| `styles/track-count.mjs`, `styles/track-tiles.mjs` | Track grouping and tile loading |
| `scripts/` | Build tools, data preparation, preview server and browser checks |
| `tests/` | Automated tests |
| `.github/workflows/` | Validation, Pages deployment and snapshot maintenance |

For worldwide style changes, edit the relevant layer/source modules and the explicit composition, run
`npm run build`, and commit the resulting `styles/world.style.json` with the
source changes. The build also creates the browser localization bundle and
copies the pinned contour library with its licence into `styles/vendor/`;
generated vendor files are not committed.

## Validation

For application changes, the main local checks are:

```sh
npm run build
git diff --exit-code -- styles/world.style.json
npm test
node --check styles/app.mjs
```

The reproducibility check expects an up-to-date committed style; while developing
a style change, inspect and include the generated diff before expecting it to pass.

For rendering changes, run fixture-safe browser checks against the
locally served site. CI uses synthetic responses for every external map
provider and the real MapLibre renderer. The shared browser harness blocks
unmocked network requests before egress, including later fixture handlers
that try `route.continue()` or `route.fetch()`. Service workers and WebSockets
are blocked; HTTP redirects are rejected rather than followed. Only loopback
HTTP and the explicitly selected first-party deployment path may be fetched.
The old external tile cache is not used by the harness or CI:

```sh
npx playwright install --with-deps chromium
node scripts/check-orm-fixture-browser.mjs
node scripts/check-platform-browser.mjs
node scripts/check-platform-stations-browser.mjs
node scripts/check-infrastructure-browser.mjs
node scripts/check-signal-power-browser.mjs
node scripts/check-globe-browser.mjs
```

The fixture test verifies actual railway-line rendering near Wuhan at zoom
levels 6 and 7 with **synthetic**, provider-shaped vector tiles. Platform,
signal and power tests also use generated geometry. Bathymetry uses a generated
PMTiles ocean/island mask and a Terrarium shallow-shelf/deep-basin PNG, exercising
the real archive client, DEM worker and depth worker. Latin labels use a local
DejaVu fixture; the packaged CJK fonts are still tested as real first-party bytes.
World-frequency tests retain the assembled OSM service data and only replace
external providers, so the Hong Kong positive rendering assertion remains intact. Post-deployment Chromium
checks use the same synthetic railway fixture against the published page. They
test rendering integration, **not real-world railway geometry or live tile
availability**, which must be assessed separately.

Service-worker installation/upgrade tests in `tests/sw-install.test.mjs` and
`tests/startup.test.mjs` execute the actual old/new worker sources with synthetic
fetch/cache implementations. The browser matrix has always blocked registered
service workers; its Cache Storage/Web Crypto upgrade checks and PWA guidance
checks retain that scope. Dedicated map workers run normally under the guarded
browser context, with an explicit worker-egress regression. This is not a claim
of native browser service-worker network-interception coverage.

The matrix's Node preparation reads local snapshots/fixtures. Playwright's
Node-side route fetches share the same pre-request guard. Outside that matrix,
the intentionally live single station-search probe and actual deployed-byte
verification reject redirects before following them. Package installation,
GitHub snapshot reads and first-party deployment reads remain real network work;
the whole deployment workflow is not an offline sandbox.

The broader geographic regression tests previously run in CI (Japan–Korea
lines, worldwide layer and station density, real context features and
infrastructure) are still available, but now require independently hosted
OpenRailwayMap-compatible data. Set
`ATLAS_TEST_ORM_URL=http://127.0.0.1:4174/` (your own server) before
invoking `check-map-browser.mjs`, `check-major-stations-browser.mjs`,
`check-context-browser.mjs` or `check-planning-browser.mjs`. They are
**not** a substitute for the fixture-safe public CI checks. Other external
providers remain blocked in these audits too; supply local fixture routes for
any additional data they need. No option re-enables public provider egress. Screenshots are
written to `browser-review/`. For the published provider conditions and
remaining uncertainties see [external services](external-services.md).

`tests/context.test.mjs` covers category distinctions, area coverage, rail
placement priority, proximity/deduplication and settings. The separate
`node scripts/check-search-api.mjs` probes the public station-search API and CORS;
CI treats its external-service failure as non-blocking.

For documentation-only changes, check relative links, heading anchors, command
accuracy and `git diff --check`; no new application tests are needed.

## GitHub Pages

The workflow [site.yml](../.github/workflows/site.yml) builds and validates the
style before publishing `styles/`. In a new fork:

1. Enable Actions if GitHub has disabled inherited workflows.
2. Set **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. Ensure complete `rail-data` and `street-data` snapshots have been published in
   the fork; see the [data workflows](data-maintenance.md). The site workflow
   waits for these branches and fails if they remain unavailable.
4. Run **Validate and deploy world railway map** if the initial push occurred
   before Pages was enabled.

Deployment runs from `main` after validation, not from pull requests. URLs are
relative so the repository subpath works. The workflow uploads a reviewable site
artifact and browser screenshots, verifies deployed vector-tile bytes, and runs
browser checks against the published map.

## Served code version

Expand the map's bottom-right information button to see the executing asset build and a link to its source commit. Carto keeps this attribution open. The commit and its repository URL are embedded into the existing cached label-code bundle by `scripts/build-browser.mjs` from CI's `GITHUB_SHA`, `GITHUB_REPOSITORY` and `GITHUB_SERVER_URL`; they are not fetched from the latest branch head. Fork builds link to their own repository. An older cached page therefore reports its own build. A mixed cached bundle reports both asset versions. Local builds without `GITHUB_SHA` say “Development build”; a commit supplied without a repository is shown without a link.
