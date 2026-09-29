# Transport interchanges, destinations and planning context

## Transport interchanges and passenger destinations

The Transport and Destinations display options are enabled by default, remembered with the other settings, and included in shared links. They use the existing worldwide OpenMapTiles archive; no live Overpass calls or additional tile service are introduced.

- Civil airports with IATA codes and international airports are labelled from zoom 8 where supplied by the tiles. Other civil airfields enter at zoom 12; private and military airfields are omitted. Airport grounds/runways and mapped ferry routes provide alignment context.
- Bus/coach stations, ferry terminals and cable-car stations have distinct framed icons and names from zoom 12 where available; local bus stops, taxi stands and bicycle rentals appear from zoom 15, with bicycle parking from zoom 17. Harbours/marinas appear from zoom 15 and are not treated as passenger interchanges.
- Hospitals, universities, malls/markets, stadiums, theme parks and visitor attractions receive labels; schools and smaller civic/cultural destinations enter later. Industrial/commercial, retail, education, hospital and major recreation grounds have light coloured fills and outlines. Generic commercial polygons are not asserted to be office parks.
- Railway station names retain placement priority. All context names use the existing shared language selection and fallback rules. Click a facility or area for its mapped type. At zoom 14+, station panels list transport facilities within 500 m straight-line distance from loaded tiles, deduplicating tile buffers. This shows possible transfer context, not a verified walking route or timetable connection.

Coverage and first appearance depend on the provider's source zooms (most detailed POIs are available at zoom 14). OpenMapTiles land-use polygons often contain only a class, without a name; available named POIs supply the labels. Government/community/historic facilities without polygon geometry receive point symbols. Absence in these tiles does not prove that no facility exists. These layers describe potential trip destinations, not measured passenger numbers.

`tests/context.test.mjs` checks category distinctions, area coverage, rail placement priority, proximity/deduplication and settings. `scripts/check-context-browser.mjs` verifies real Hong Kong POIs/areas, Heathrow at regional scale, language switching, inspection and toggles in Chromium, before and after deployment.

## Roads and planning context

The subdued base network includes ordinary roads, cycling paths and hiking / walking trails. Local bus stops, taxi stands and bicycle rentals enter at zoom 15, bicycle parking at 17. The station panel lists mapped nearby terminals first, then local facilities; straight-line proximity does not verify a walking connection.

Protected areas, military grounds, religious institutions and heritage sites have a separate display control. Indigenous territories tagged `boundary=aboriginal_lands` are purple, separate from administrative borders and conservation boundaries. These are mapped planning context, not a determination of legal boundaries or permission to build. Coverage depends on the source tiles.
