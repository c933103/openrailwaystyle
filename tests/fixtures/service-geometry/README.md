# Service geometry metadata fixture

`overpass-meta-way-4853887.json` is a real, successful configured-endpoint
response, with `user`, `uid` and `changeset` fields removed recursively. Other
response values are retained. It is not a synthetic response.

- Source: https://overpass-api.de/api/interpreter
- Method: POST
- Query: `[out:json][timeout:25];way(4853887);out meta geom qt;`
- Received: 2026-10-07T02:33:32Z (HTTP 200)
- Generator: Overpass API 0.7.62.11 87bfad18
- Dataset time: 2026-10-07T02:32:36Z
- Way: https://www.openstreetmap.org/way/4853887, version 38
- Way timestamp: 2026-01-04T04:25:23Z
- Raw HTTP response: 3,131 bytes (1,073 bytes with gzip level 9)
- Shape: 31 ordered node IDs and 31 finite coordinate positions
- Selection: existing published service-data commit
  `ba3ffbbfa24cb72d01a07022b526cced30b39cd7`

Data © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright).
This fixture validates one complete live metadata/geometry layout. The source
conflict, missing-position and lifecycle regressions use explicitly synthetic
observations; this fixture does not claim those failure modes occurred here.
