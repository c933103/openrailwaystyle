# Service frequency data

[Documentation index](README.md)

In Service view, choose **Route width → By frequency**, then **Peak** or
**Off-peak**. Peak offers Morning and Evening separately. The same width scale
applies to all profiles. Equal width remains the default. These settings persist
in the existing cookie and shared map links.

## Current coverage

The first matched source is [MTR's published average train headways](https://www.mtr.com.hk/en/customer/services/train_service_index.html),
retrieved on 3 October 2026. [The numerical dataset](../styles/service-headways.json)
retains all 28 published rows, including weekend values. Seventeen whole-route
rows can currently be matched: Island, Tsuen Wan, South Island, Tuen Ma,
Disneyland Resort and Airport Express, plus Light Rail 505, 507, 610, 614, 614P,
615, 615P, 705, 706, 751 and 761P.

These are estimated hourly rates from published headways, not exact timetable
departure counts. Both ends of a range are retained; width uses `60 / longest
reported interval`, the lower hourly bound. AM and PM peak are separate. The
operator's categories are retained without inventing their clock windows.
Non-peak excludes the source's early-morning/late-night exceptions. Disneyland's
park-closed interval is a separate condition, not covered by its normal profile.
751P's own interval is unpublished and remains unknown; 751's profile does not
add its supplementary trains.

Kwun Tong, Tseung Kwan O, Tung Chung and East Rail have section/branch-specific
rows. They are retained in the dataset but remain unmapped until their track
segments have been audited. They must not receive a single trunk value across
every branch. A matching reference alone is insufficient: the importer checks
network, railway kind and Hong Kong geometry as well. No OSM relation count is
interpreted as a number of trains.

The [HSL GTFS-derived dataset](../styles/hsl-frequency.json) contains 47 rail
routes and 1,298 stop-pair segments for Monday 5 October 2026, from feed version
`2026-10-02 04:54:09`, valid 1 October–29 November. It preserves both directions,
branches, zeros and unavailable values. Its reference windows are configured
07:00–09:00, 15:00–18:00 and 13:00–14:00 in Europe/Helsinki; these are not claimed
operator peak definitions. Helsinki has no routes in the current published OSM
service snapshot, so this dataset is prepared but explicitly unmatched and does
not determine map widths. Stop-pair endpoints are auditing data, not straight
lines to paint as railway geometry. HSL supplies the feed under
[CC BY 4.0](https://www.hsl.fi/en/hsl/open-data): © HSL 2026, timetable delivered
2 October 2026. The original feed URL, hash, version and date are preserved.

## Rendering and availability

Reference widths at the existing middle map scale are 1.5px at 1 departure/h,
2px at 2/h, 2.5px at 4/h, 3px at 6/h, 4px at 12/h, 5px at 24/h and 5.5px at
30/h or above, with interpolation and the existing zoom scaling. This bounded
scale is not proportional stroke area. The same rate receives the same width
across profiles; the scale is never normalized to the busiest visible route.

Unmatched or missing profiles use a subdued 3.5px baseline, with an explicit
unavailable detail state, rather than zero or a different period. Published
MTR headways become unavailable after their 30-day review interval. This is a
freshness rule, not a claim that the operator guarantees a 30-day timetable.
Old tiles without frequency properties remain usable. Route colours retain
identity. Shared-track offsets are calculated from the actual widths and a
small gap; names and click selection change with the chosen profile too.

Site assembly rebuilds tiles from the already published OSM table using
`scripts/rebuild-service-frequency.mjs`. It makes no Overpass requests, changes
no snapshot branch, and creates no per-route or per-viewport timetable calls.

## Reproduce and refresh

```sh
# Download/parse the official headway page once; abort if its schema changes.
python3 scripts/import-service-headways.py
# Or reuse the downloaded page with an explicit retrieval date.
python3 scripts/import-service-headways.py --html /path/to/page.html --checked YYYY-MM-DD

# Download the licensed HSL ZIP from the URL recorded in the config, then:
python3 scripts/gtfs-frequency.py /path/to/hsl.zip \
  --config styles/data-src/hsl-frequency-config.json \
  --date 2026-10-05 --out styles/hsl-frequency.json

# After loading the published service-data snapshot:
node scripts/rebuild-service-frequency.mjs
npm run build
npm test
```

For a new HSL extraction, choose a documented service date within the feed's
validity and update its retrieval/attribution metadata. The compiler streams
stop times and retains rail trips only. It applies calendar exceptions, prior
service days, half-open windows and upstream-anchor offsets. Exact frequency
templates are expanded without double counting; non-exact headways are labelled
estimates. Missing times remain unknown. Overlapping frequency intervals,
broken references, invalid dates and ambiguous/nonexistent DST window boundaries
fail explicitly rather than silently creating rates.

Future feeds need source permission, documented windows and audited
route/pattern/track matching before their values can be rendered. Prepared data
does not mean worldwide mapped coverage. Refresh numerical sources and derived
data in a reviewed PR; do not change the freshness timestamp without fetching
the source again.
