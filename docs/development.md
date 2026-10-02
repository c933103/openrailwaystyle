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
`styles/`; production remains a static site without an application backend.

## Source layout and generated files

| Path | Purpose |
| --- | --- |
| `styles/index.html`, `styles/app.mjs`, `styles/app.css` | Application page, controls and presentation |
| `styles/map-model.mjs` | Map semantics and shared display rules |
| `scripts/build-style.mjs` | Builds the worldwide style from `styles/default.style.json` |
| `styles/world.style.json`, `styles/major-stations.geojson` | Generated style and curated station labels, committed and checked for reproducibility |
| `styles/tile-labels.mjs`, `styles/han-region.mjs` | Label selection and geographic name rules |
| `styles/track-count.mjs`, `styles/track-tiles.mjs` | Track grouping and tile loading |
| `scripts/` | Build tools, data preparation, preview server and browser checks |
| `tests/` | Automated tests |
| `.github/workflows/` | Validation, Pages deployment and snapshot maintenance |
| `ProcessRailway.java`, `justfile`, original example styles | Original Europe extractor and Hack4Rail demos; see [upstream history](upstream.md) |

For worldwide style changes, edit the builder and relevant source modules, run
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

For rendering changes, load the published data and leave the preview server
running in another terminal, then run the relevant browser checks:

```sh
npx playwright install --with-deps chromium
node scripts/check-planning-browser.mjs
node scripts/check-context-browser.mjs
node scripts/check-map-browser.mjs
node scripts/check-major-stations-browser.mjs
node scripts/check-platform-browser.mjs
```

The deployment gate checks real Chromium/WebGL rendering, including zoom-7 panning
in the Japan–Korea view, visibility of 남부내륙선, line names and controls, and the
absence of viewer Overpass requests. The context checks cover Hong Kong facilities,
Heathrow at regional scale, language switching, inspection and toggles; planning
checks cover roads, buildings, boundaries and rail-road interfaces. Curated station checks cover globe labels, language switching and OSM inspection on desktop and touch viewports. Platform checks cover full mapped boarding-edge lengths, asynchronous inspection, the main Units control and immediate kg/lb legend conversion. Screenshots
are saved in `browser-review/` and uploaded by CI. These checks do not establish
that every real-world railway is correctly mapped in OSM.

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

Expand the map's bottom-right information button to see the executing asset build and a link to its source commit. Carto keeps this attribution open. The commit is embedded into the existing cached label-code bundle by `scripts/build-browser.mjs` from CI's `GITHUB_SHA`; it is not fetched from the latest branch head. An older cached page therefore reports its own build. A mixed cached bundle reports both asset versions. Local builds without `GITHUB_SHA` say “Development build”.
