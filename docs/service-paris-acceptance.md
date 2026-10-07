# Paris Service geometry acceptance

[Development and validation](development.md#validation) · [Service data](data-maintenance.md#source-aware-relation-membership)

This test-only gate addresses a bounded part of [#107](https://github.com/c933103/openrailwaystyle/issues/107): real Paris OSM-derived service paths remain visible while explicitly synthetic timetable and stop-coordinate candidates cannot create additional lines. It changes no service classifier, acquisition selector, production builder, provider, or UI.

## Positive evidence and its limits

The fixture is a deterministic extract of the published `service-data` archive at
[`ba3ffbbfa24cb72d01a07022b526cced30b39cd7`](https://github.com/c933103/openrailwaystyle/blob/ba3ffbbfa24cb72d01a07022b526cced30b39cd7/service-routes.ndjson.gz).
Its SHA-256 is `ac91e3d45e95248261914a2d54c7d110bc9c0bcebf6dca5ea2cd9052b75178bf`.

The closed bbox `[2.15, 48.76, 2.45, 48.95]` retains a whole stored way when any vertex lies in the bbox or any segment crosses it. The extractor retains all referenced relation rows, including accepted/pending references, preserves original row order and bytes, and never clips or reconnects a selected way. The two plaintext fixture parts contain **2,094 ways and 119 relation rows**, totalling **425,600 bytes**. Their combined SHA-256 is `fdfaf30b3323e750b5470e721dcced41ed00d3c5d98da9a72e302d68c24a9819`.

These are real published OSM-derived **legacy simplified observations**, with unknown source/revision/raw-node provenance. They are not a fresh OSM extraction or newly certified complete source geometry. [Metadata](../tests/fixtures/service-geometry/paris-metadata.json) records source, selection, per-part checksums, baseline production-build hashes, and ODbL attribution.

Nonempty rendering alone cannot pass:

- Saint-Lazare must retain Transilien L at `[2.32388, 48.87712]`, backed by relations 12142599/12142600 and ways 58191909/58191938. The existing builder normalizes the directional pair to relation 12142599.
- Montparnasse must retain Métro 6 at `[2.31975, 48.84188]`, backed by relation 123912 and way 677923266.

This does not establish all expected Paris service coverage or redefine service eligibility around whichever paths the fixture happens to contain.

## Synthetic negative evidence

[`paris-adversary.json`](../tests/fixtures/service-geometry/paris-adversary.json) is visibly labelled synthetic. It contains two-point off-track timetable geometry and stop-coordinate-only candidates, in the compiled feed input shape consumed by the production assembly/rebuild path. Near and overview negative probes avoid legitimate decoded OSM paths and account for zoom-dependent rendering widths.

The separate authentic gate now uses the recovered **October 5 pre-fix compiled Normandy snapshot**, pinned byte-for-byte from the assembled workflow artifact. It covers the historical reported input without changing this synthetic adversary or conflating the two evidence types. See [historical Normandy provenance](../tests/fixtures/service-geometry/normandy-README.md).

The archived compiled fixture has 203 two-coordinate edges, including six ending near Saint-Lazare and four near Montparnasse. The longest is 383.788276 km. Historical compiler `ShapePaths.segments()` emits each shape edge as a pair, so these counts do **not** establish that every raw GTFS shape had only two coordinates. No raw GTFS ZIP was acquired or inspected for this acceptance.

#107 remains open for wider all-path verification, including stale-client/frequency-processing availability concerns. Classification/identity [#109](https://github.com/c933103/openrailwaystyle/issues/109) and regional gaps [#112](https://github.com/c933103/openrailwaystyle/issues/112) remain separate.

## What runs

`tests/service-paris-geometry.test.mjs` and `scripts/paris-service-geometry-fixture.mjs` run unchanged production worldwide assembly and service rebuild commands in temporary isolated workspaces, with timetable absent, present, and expired. The checks decode production MVTs, retain positive memberships and coordinates, reject forbidden geometry and extra shared-track slots, verify no standalone timetable tiles are published, and ensure stale numeric publication directories and orphan feed outputs are removed.

The browser checkers use real MapLibre 5.24.0, the generated production `service-routes` layer, rebuilt fixture MVT bytes, and production frequency paint expressions. A deterministic white background and intercepted fixture requests remove unrelated live-provider outages from this geometry gate. This is a dedicated renderer acceptance harness, not a test of the full app's UI controls or regional acquisition.

The browser matrix is:

- Saint-Lazare and Montparnasse
- z9 overview, z12 native, z16 overscaled
- Timetable absent, present, expired
- Equal, all 28 frequency profiles, then return to Equal

That is **540 positive/negative/state/profile cases per gate**. The authentic Normandy gate repeats the matrix with unchanged archived feed bytes and fixed fresh/expired test clocks, with actual historical terminal-linked chord probes and archived PBF sensitivity. The synthetic gate remains independent. The two gates total **1,080 cases and 24 rejected mutation views**; every active historical chord probe must detect the injected archived geometry. Each checks the nominated real path and painted pixels, forbidden probes, actual decoded rendered geometry, identities, shared-track slots, expected widths/offsets, and opacity. Equal geometry, widths and offsets must stay unchanged through timetable states and Equal → frequency → Equal transitions. The z16 camera centers on the positive and active negative probes together; a pure projection regression and runtime validation require every probe to lie inside the actual pane. Off-screen checks cannot silently pass.

Paris has no matched real headway catalogue entries in this build. Its 28 profiles explicitly exercise **unknown-frequency fallback**, including opacity 0.45, rather than known Paris timetable rates. Existing Hong Kong and synthetic geometry tests retain known-frequency coverage.

The synthetic sensitivity check deliberately inserts forbidden chord MVT features into the **same** service source and layer. At every terminal/zoom, Equal and AM must reject that mutation while retaining the genuine positive path: **12 rejected mutations**. The authentic gate repeats the sensitivity check with the recovered terminal publication geometry, preserving the distinction from synthetic fault injection. This proves that a blank map or an ID-prefix-only check cannot satisfy the gate.

## Run and review

From the repository root, with Node 22 and installed dependencies:

```sh
node --test tests/service-paris-geometry.test.mjs tests/service-normandy-geometry.test.mjs tests/service-geometry-test-framing.test.mjs tests/ci-plan.test.mjs
npx playwright install --with-deps chromium
node scripts/check-paris-service-geometry-browser.mjs
node scripts/check-normandy-service-geometry-browser.mjs
```

The dedicated browser page and service module are intercepted by the checker, so it needs no live basemap or separately running preview server. The MapLibre distribution is checksum-pinned by the existing renderer fixture helper; the first run needs that renderer available locally or from its official CDN distribution. Optional local overrides are `ATLAS_CHROMIUM_EXECUTABLE` and `ATLAS_MAPLIBRE_ASSETS`; overridden renderer bytes must still match the pinned checksums.

The frequency CI group runs both checkers and uploads its results with the existing `browser-review` artifacts. `paris-service-geometry-results.json` and `normandy-service-geometry-results.json` contain all assertions, source/build checksums, original archive metadata, browser version, production manifests, and mutation evidence. Representative PNGs show both terminals in Equal, frequency, expired, return-to-Equal and forbidden-injection states. The forbidden-injection screenshots intentionally show rejected geometry and are not successful production output.

Fixture regeneration requires the exact pinned input, not a live refresh:

```sh
node scripts/paris-service-geometry-fixture.mjs --extract /path/to/pinned/service-routes.ndjson.gz
```

The extractor verifies the archive checksum before writing. Source data is © OpenStreetMap contributors under [ODbL 1.0](https://www.openstreetmap.org/copyright). Synthetic adversary data carries no authentic transport timetable claim.
