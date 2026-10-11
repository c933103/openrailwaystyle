# Independent worldwide OSM railway reference (#181)

This reference prevents a failed live overview provider from removing mapped
major corridors at zoom 0–6, including a negative camera zoom. It is neutral
geometry beneath every thematic railway layer. Its native z6 tiles remain
visible through z7; existing z7+ detailed tracks draw above them. The reference
ends at z8 and does not replace close-zoom infrastructure or branch overlays.

## Source and publication boundary

`mainline-reference.yml` acquires dated PBF exports from **all eight** Geofabrik
continent roots: Africa, Antarctica, Asia, Australia/Oceania, Central America,
Europe, North America and South America. These provider extracts include
complete crossing ways, including cross-border node references. Overlap is
deduplicated by OSM way ID and version; conflicting same-generation geometry
fails the build. The manifest records exactly this provider coverage, rather
than claiming a comparison against every object in the unfiltered planet.

Only `railway=rail|narrow_gauge` is eligible. Explicit `usage=main`,
`usage=branch` and absent usage remain distinct. `service=*`, inactive lifecycle
and other explicit usages are excluded from this major-corridor reference.
High-speed priority comes only from `highspeed=yes`. An absent high-speed tag
stays absent. No speed, power, control, gauge, owner or timetable is inferred.

Low-zoom simplification of isolated short OSM ways can erase entire corridors.
The compiler therefore joins degree-two paths using **shared OSM node IDs**
and identical mapped classifications. It does not join coincident coordinates
or choose a path at a fork. Each rendered chain has a stable content ID, and
its archive lists every original way ID/version. Versioned normalized source
geometry is retained in `ways.ndjson.gz.part-*`; join the parts in their
manifest order before decompressing. All derived data remains ODbL 1.0.

One source generation must include all eight dated continents, valid checksums,
consistent source timestamps, complete geometry, indexed tile digests, actual
OSM acceptance controls and passing renderer checks. Partial downloads never
replace the previous live generation. The draft PR stages only
`mainline-preview-186`; reviewed main uses `mainline-data`. Site assembly
requires and verifies the complete generation before deployment. A SHA-256
fingerprint binds the published result to acquisition, compiler and renderer
acceptance inputs. Site readiness waits for that fingerprint and pins the
verified data commit, so an older branch cannot satisfy a changed build.

The runtime pins the generation named in its manifest. Only an absent tile in
the verified complete index is empty. A manifest/index error, timeout, HTTP
failure, changed digest, oversized tile or decompression failure remains an
error. The independent layer cannot clear an OpenRailwayMap outage state.
Publication retains the preceding generation's immutable render URLs for
one additional refresh; older source archives remain in their Git commits.
Sites omit archival source parts and serve only runtime assets and audits.

## Bounded acquisition and measurements

Each source is downloaded once per dated checkpoint, with two concurrent
continent jobs maximum. A PBF is limited to 48 GiB, a generation to 144 GiB of
PBF downloads, checked with eight HEAD requests before downloading any body.
Each continent is constrained to its planned byte count, including cached
exports. An exported continent is limited to 4 GiB uncompressed, and the complete
tile set to 256 MiB compressed. Each tile is limited to 8 MiB decoded / 2 MiB
compressed. Source archives are split into approximately 40 MiB blobs; combined
source archives are limited to 512 MiB; two-generation publication is limited
to 1 GiB. Only current and previous render tiles are copied into the site.
Completed filtered exports are cached across retries; raw continental PBFs
are deleted after filtering. A monthly scheduled refresh avoids a daily
world download. A missing dated export fails explicitly instead of silently
substituting a different date or source.

The manifest measures acquisition bytes and seconds per continent, filtered
export bytes, classified way counts, emitted feature counts by zoom, largest
tile, total tile bytes, compiler duration and peak RSS. Browser review records
latency distributions for each geography, projection, zoom and device profile.
No public OpenRailwayMap tile is downloaded by this pipeline or its tests.
The cost inputs are measured transfer/storage bytes and runner time; monetary
cost depends on the account's bandwidth, storage and Actions rates.

## Acceptance checks

Synthetic unit/browser fixtures check parser failures, classification,
deduplication, shared-node topology, cycles, dateline splitting, buffered tile
edges, rendering filters, negative zoom, failed live overview tiles and the
z6–7 handoff. They make **no real-source completeness claim**.

The source build separately requires actual OSM ways at Beijing, Wuhan, Tokyo,
Seoul, Taipei, Mumbai, Moscow, Chicago, Toronto, London, Paris, Madrid, Berlin,
Milan, Warsaw, an Alpine crossing, Cape Town, Sydney, São Paulo and Kalgoorlie.
These are regression controls, not the acquisition boundary. Source geometry
and emitted tile chains are checked independently at z0–6. The browser checks
the corresponding chain identities and painted pixels at z−0.1/0/3/4/5/6/7,
in Mercator and globe views, with desktop Chromium, an Android-size Chromium
viewport and WebKit. The Android profile is not a physical-device test.

```sh
node scripts/build-mainline-snapshot.mjs mainline-input mainline-output
node scripts/verify-mainline-snapshot.mjs mainline-output
node scripts/check-mainline-reference-browser.mjs
MAP_BASE_URL=https://10671435.xyz/ node scripts/check-mainline-reference-browser.mjs --published
```

The published check reads real first-party manifests, audits, renderer modules
and tile bytes. It replaces only the live thematic overview with an explicit
503 fixture; no public tile-server scraping is needed. Issue #181 remains open
until the complete worldwide dataset, reviewed code, successful deployment and
this published acceptance report are verified.

## Primary source conditions

- Geofabrik: <https://www.geofabrik.de/en/data/download.html>
- Complete ways / dated snapshots: <https://download.geofabrik.de/technical.html>
- Public Overpass commons: <https://dev.overpass-api.de/overpass-doc/en/preface/commons.html>
- OSM attribution / ODbL: <https://www.openstreetmap.org/copyright>
- Osmium export errors and metadata: <https://docs.osmcode.org/osmium/latest/osmium-export.html>

Geofabrik offers raw OSM extracts for download and reuse under ODbL with
attribution. Public Overpass guidance identifies world scraping by stitched
bounding boxes as inappropriate. This pipeline uses the export service and
local filtering instead of either public Overpass scraping or ORM tiles.
