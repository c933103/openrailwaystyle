# Power snapshot acceptance, 2026-10-14

Source: `1c786c5a90d9e0e69d9c19a1909b68b023c4a824` (merged #206).
Published data: `71bed1de58c6a4a27f0b82702e00ee94286be24a`, `power/`.
Build: https://github.com/c933103/openrailwaystyle/actions/runs/38429333760
Deployment: https://github.com/c933103/openrailwaystyle/actions/runs/38434308659

`receipt.json` records the actual dataset, source, hashes, all eight local and
all eight live geometry cases, environment and test-harness failures. Real data
was acquired from OSM; the existing signals and energy-supply caches were reused.
Only unrelated/external map data is replaced with explicit fixtures in browser
checks. The methods response is an actual first-party HTTP read, verified before
its unchanged bytes reach the page. The guard still rejects unmocked provider
requests and redirects. No public map-provider tiles were downloaded.

Run from this repository root, with supported Node, dependencies installed using
`npm ci --ignore-scripts` and Playwright Chromium available. Fetch the three
published `power-methods.geojson`, `power-methods.geojson.gz` and
`methods-manifest.json` files into a directory. For example, use the immutable
data commit above, or the canonical live URLs under
https://c933103.github.io/openrailwaystyle/data/traction/power/.

```sh
node evidence/power-methods-acceptance-20261014/verify-published-power-data.mjs /tmp/power-files > /tmp/power-files-verification.json
MAP_BASE_URL=https://c933103.github.io/openrailwaystyle/ node evidence/power-methods-acceptance-20261014/check-published-power-browser.mjs /tmp/power-files
```

The browser runner reads that validator receipt to choose genuine sample IDs.
It avoids reparsing the entire dataset in the Node observer. The normal check
covers both viewports and all four present categories. In a high-latency test
network, use batches while retaining the same per-case assertions and digest:

```sh
MAP_BASE_URL=https://c933103.github.io/openrailwaystyle/ POWER_CHECK_VIEWPORT=mobile POWER_CHECK_CATEGORIES=ground-level_power_supply,charging_station node evidence/power-methods-acceptance-20261014/check-published-power-browser.mjs /tmp/power-files
```

Local verification uses the actual application and published dataset, with a
preview server and runner in the same process. The live test uses the deployed
application. Its aggregate results are six successful cases from the first
combined attempt and two successful cases from the final mobile batch; the
combined attempt itself did not finish successfully. Geometry remains sourced
from OpenStreetMap under ODbL-1.0. These counts describe mapped features, not an
inventory of every physical installation or proof of current operating status.
