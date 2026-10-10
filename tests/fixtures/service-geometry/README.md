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

## Relation member metadata

`overpass-meta-relation-10003040.json` is a real configured-endpoint response,
with contributor `user`, `uid` and `changeset` fields removed recursively.
All other response values, including the ordered member declarations, remain.

- Source: https://overpass-api.de/api/interpreter
- Method: GET (an initial POST returned HTTP 406; no large extraction was run)
- Query: `[out:json][timeout:25];rel(10003040);out meta;`
- Received: 2026-10-07 around 04:12 UTC (HTTP 200)
- Dataset time: 2026-10-07T04:09:50Z
- Relation: https://www.openstreetmap.org/relation/10003040, version 25
- Relation timestamp: 2026-06-12T01:19:51Z
- Shape: 115 full ordered node/way member declarations with type/ref/role
- Selection: the same pinned published service-data table as the way fixture

This uses separate, un-clipped relation metadata output, exactly as the
production query now does. Relation member geometry is unnecessary. A geometry
fragment or a list lacking full member references is not proof that a member
was deleted. The fixture intentionally returns no ways; it establishes no
positive railway eligibility and its unreturned members remain unresolved.
It validates metadata layout, not a claim that this real relation has been
incorrectly rerouted in production. Reroute/conflict cases are synthetic.
