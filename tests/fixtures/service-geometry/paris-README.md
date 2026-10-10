# Pinned Paris service geometry acceptance fixture

`paris-osm-01.ndjson` and `paris-osm-02.ndjson` together contain **verbatim
published source rows**, in their original order: 2,094 complete way rows and
119 required route-relation rows. Files are split below 300 KB for text-only
publication. The combined extract is 425,600 UTF-8 bytes.

Source: [service-data at ba3ffbbfa24cb72d01a07022b526cced30b39cd7](https://github.com/c933103/openrailwaystyle/tree/ba3ffbbfa24cb72d01a07022b526cced30b39cd7),
`service-routes.ndjson.gz`. Its SHA-256, extract hashes, full selection rule,
source/build baseline hashes, counts and limitations are in
`paris-metadata.json`. No new external acquisition is required by the tests.

Selection uses bbox `[2.15,48.76,2.45,48.95]`: retain the **entire unchanged way
row** when a vertex lies in the box **or any segment crosses the box**, then
include every relation referenced by accepted or pending memberships. Never
bridge separate line fragments, clip way coordinates or fabricate provenance.

Reproduce from an already available copy of the exact pinned gzip:

```sh
node scripts/paris-service-geometry-fixture.mjs --extract /path/to/service-routes.ndjson.gz
```

These are real OSM-derived **legacy simplified** coordinates. Raw node
sequences, unsimplified geometry, source snapshot times and way revisions are
not present. Production hydration must keep their geometry provenance
`unknown`; this fixture does not certify completeness or current live coverage.

Positive controls:

- Saint-Lazare: Transilien L relations 12142599 / 12142600, ways 58191909 /
  58191938, probe `[2.32388,48.87712]`. Production groups the two directions
  under the existing lowest relation identity 12142599.
- Montparnasse: Métro 6 relation 123912, way 677923266, probe
  `[2.31975,48.84188]`.

`paris-adversary.json` is **explicitly synthetic**. Its four supplied two-point
chords and four shapeless stop pairs have invented service counts and an
invented agency. Both pass through actual compiled-feed production inputs.
Farther negative controls cover z7–11; nearby clear-space controls cover native
z12 and browser overscaling at z16. They are intentionally separate from all
legitimate track paths. Present and expired copies exercise availability
independence, never a genuine Normandy timetable.

The helper copies unchanged production CLI code into temporary workspaces,
executes actual worldwide assembly and service rebuild for absent, present and
expired inputs, and returns their actual decompressed MVT output. Tests decode
all native z7–12 tiles, compare complete geometry and properties, verify real
positive locations and negative off-track space, assert physical stale-output
removal, and confirm zero standalone timetable tiles. Same-layer fault
injection proves that spatial assertions catch forbidden geometry even with a
plausible `relation-…` identity. Baseline and currently executing build hashes
are reported separately.

This synthetic fixture does **not** reproduce the original feed or close issue
#107. The separate [historical Normandy fixture](normandy-README.md) now pins the
recovered pre-fix compiled snapshot; do not conflate its evidence with this
synthetic control. Raw GTFS shape structure remains uninspected.

Real data © OpenStreetMap contributors,
[ODbL 1.0](https://www.openstreetmap.org/copyright).
