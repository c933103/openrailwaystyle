# PR241 nested display-field correction receipt

Final tested source: [90bbbd6801af6db1886eee2d3d25336c61990d1a](https://github.com/c933103/openrailwaystyle/commit/90bbbd6801af6db1886eee2d3d25336c61990d1a).
Predecessor: `71c4c312058509d377af8d97c21e82fae09fa766`.
Working record: [PR241](https://github.com/c933103/openrailwaystyle/pull/241).
The earlier evidence archive remains unchanged and reachable from its original commit.

## Demonstrated follow-up

An object-valued nested geocoder name could override a usable outer name and render
`[object Object]`. Object-valued facility reference/kind/operator fields also rendered
that text; a malformed facility name silently became “Unnamed facility.” These rows
were incorrectly reported as complete. The archived before/after JSON executes the
actual search submission and rendering block, using only controlled responses.

The existing response boundary now validates facility display fields and operator
lists plus nested geocoder name/tag dictionaries. Valid siblings and later explicit
recovery remain intact. This is the same bounded correction, with no unrelated
refactor or separate PR.

## Acceptance and limits

- New field regression: 26 failures on the predecessor, 5 passing controls.
- Final focused model/DOM/selection/cache coverage: 241 passed, no failures.
- Full-application search/version subset: 5 passed.
- Build, generated-style equality, syntax and diff checks: passed.
- Final serial aggregate: 2338 passed, one startup child-process failure.
- Isolated startup at 1024 MiB: 110 passed before SIGABRT; its log records JavaScript
  heap exhaustion. The earlier 1536 MiB attempt ended with SIGKILL. Neither is a clean
  aggregate pass; hosted aggregate acceptance remains required.
- The installed browser process socket remains blocked; no local real-browser
  acceptance or live-provider validation is claimed.

The bounds tests execute the pinned MapLibre 5.24.0 LngLatBounds implementation and
actual result-selection path. Ordinary bounds, zero-width longitude, the documented
Nominatim -180..180 dateline extent and an explicit 170..-170 antimeridian interval
remain accepted. MapLibre adjusts the last interval to 170..190. Both longitude
orders are intentional; malformed numeric/range/latitude extents use the valid point.
[Nominatim output contract](https://nominatim.org/release-docs/latest/api/Output/#boundingbox).

## Replay

Run the commands in manifest.json at the tested source. To reproduce the field gap,
check out the predecessor and copy predecessor-field-regressions.test.mjs into
`tests/search-field-validation.test.mjs`, then run that file with Node's test runner.
The probe-display-fields.mjs script takes the checkout directory as its argument.
The manifest binds every archive member and the exact 15-file source delta from main.

Hosted CI/browser gates, exact-head review, merge and deployment remain outstanding.
This archival evidence branch must not be merged into main.
