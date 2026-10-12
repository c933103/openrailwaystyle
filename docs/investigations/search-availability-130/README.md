# Search availability: partial-empty results

Related: [#130](https://github.com/c933103/openrailwaystyle/issues/130),
[#112](https://github.com/c933103/openrailwaystyle/issues/112).

## Verified defect and boundary

Baseline: main `dea9f68e9d4c585c29ff225c4c052e689dac849b` after the merged
numeric-name, departure-envelope and departure-instant corrections. All 587
repository blobs were checked against GitHub before this change; see
[baseline verification](baseline-verification.json).

When either remote search fails and the other returns a valid empty array,
the application displayed:

> No matching facility or place found. Try a local name or railway code.
> (station search unavailable)

The equivalent place-search failure has the same defect. The promise settlement
already retains the failure reason at source level; it is the leading blanket
no-match statement that overstates the completed search. This is **not** an
all-source outage incorrectly converted to success: all failed with no local
matches already reports unavailable. Healthy sibling rows and local drawn
station results already survive and must keep doing so.

All reproductions use synthetic responses supplied to the actual application
code. They do not establish a live provider outage, real-world search coverage,
or the existence/absence of any particular station.

## Sources and intended meaning

`styles/app.mjs` submits the query to the OpenRailwayMap public facility endpoint
(`api.openrailwaymap.org/v2/facility`, limit 8) and Nominatim
(`nominatim.openstreetmap.org/search`, limit 10, namedetails and extratags).
The selected language is included in the Nominatim URL unless local names are
selected. The facility source is node-oriented; the geocoder can supply area
stations and ordinary places. The source distinctions and attribution remain
unchanged.

When the map is ready, matching drawn station features also enter through
`drawnStationQueries` and `tileStations` in `styles/map-model.mjs`, respecting
the visible station layers and zoom. `searchResults` reconciles those facilities
with geocoder railway results and ordinary places. Numeric-name identity guards
from #191 remain unchanged. Search is a bounded, source-dependent lookup, not
an exhaustive inventory of every railway facility worldwide.

This correction changes the shared final status composition, rather than
changing requests, introducing a second status model, or altering selection and
reconciliation. It distinguishes:

| Source outcome and usable results | Display |
| --- | --- |
| Both remote searches succeed, no result | Existing completed no-match wording |
| One source fails, no usable result | “No matches from the available sources. Search incomplete: … unavailable.” |
| One source fails, healthy results remain | Existing counts/results plus explicit incomplete notice naming the failed source |
| Both sources fail, matching drawn stations remain | Local results/counts plus both-source incomplete notice |
| Both sources fail, no local match | Existing search-unavailable wording |

Successful empty results cannot establish that a place does not exist outside
the actual provider coverage and currently drawn station set. The help page
and user guide now state that limit and explain incomplete results.

## Lifecycle preservation

- Both source URLs, query parameters, result limits and deduplication stay intact.
- Facility cancellation remains five seconds; whole-search timeout remains eight.
- HTTP 429 still pauses facility requests for ten minutes.
- Nominatim requests remain submitted on demand with one-second spacing.
- Successful place responses, including valid empty arrays, retain their
  query-and-language cache key and existing 50-entry in-page limit. Failures
  remain uncached. No automatic retry is added.
- Replaced searches still cannot replace the latest results/status; a search
  cancelled while queued does not consume a geocoder request.
- The page asset token is advanced to `20261012-search-availability-1`, together
  with its versioned module imports. Exact predecessor application bytes are
  retained in the compressed test fixture for installed-app upgrade testing.

## Reproduction and validation

Run from the repository root after the documented dependency setup:

```sh
node --test tests/search-availability.test.mjs
node --experimental-vm-modules --test tests/search-availability.test.mjs tests/search-api.test.mjs tests/search-numeric-names.test.mjs tests/sw-install.test.mjs
node --experimental-vm-modules --test --test-name-pattern='full app search|Causeway Bay search|every versioned file' tests/startup.test.mjs
npm run build
git diff --exit-code -- styles/world.style.json
node --check styles/app.mjs
npm test
git diff --check
```

- [Exact predecessor behavior](baseline-regressions.log): 3 passing controls,
  14 failing assertions among 17 tests. Eight failures directly reproduce
  partial-empty station/place HTTP, transport, JSON and response-envelope
  failures. Other red assertions establish the explicit incomplete wording
  across surviving rows and lifecycle cases; these are not 14 independent bugs.
- [Successor behavior](successor-regressions.log): 17/17 pass.
- [Full application predecessor](baseline-full-app.log): the real app's DOM
  submission/rendering path fails the partial-empty regression.
- [Full application successor](successor-full-app.log): 3/3 pass, including
  the four-outcome DOM scenario, delayed-label search and coherent asset imports.
- [Focused suite](focused.log): 57/57 pass. Includes existing API and numeric
  identity tests plus installed service-worker cache behavior.
- [Predecessor cache guard](baseline-cache.log): fails before the asset token
  bump. The successor receives the actual corrected app bytes, retains old-tab
  bytes under their old version and serves the corrected bytes offline.
- [Aggregate suite](full-suite.log): 1435/1435 pass, no skips or cancellations.
- [Build](build.log), syntax, generated-style reproducibility and whitespace
  checks: exit 0; adjacent `.exit` files retain the command outcomes.

The focused harness executes the real search block with real DOM nodes and
production model functions. The startup test executes the entire real app
against its existing mocked renderer/dependencies. These are DOM/VM checks,
not a screenshot, real-renderer or live-provider test. Existing hosted browser
groups and exact-head CI still need to pass before merge. No new live source
acquisition or manual workflow dispatch is required.

## Scope remaining open

This fixes only the verified partial-search wording defect. Broader #130
search identity/coverage and #112 coverage, ingestion, matching and freshness
work remain open. Malformed individual result rows, language changes during an
already-submitted lookup, and geographic source completeness are not newly
validated or redesigned by this correction. URL/domain work is not included.

[Independent review](review/README.md) found no blocking issue: 114/114 focused
tests passed, the exact predecessor failed the expected search/full-app/cache
regressions, and a separate eight-scenario matrix verified both versions. The
reviewer verified all 587 baseline blobs and final 13-file hashes. Its optional
cache-retention wording clarification is included in the user guide. Merge,
deployment and exact served-asset verification remain separate gates; this
report does not claim those have completed.
