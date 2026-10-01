# Axle-load interpretation and maintenance

The Axle load view uses explicit `axle_load` (physical capacity) and `maxaxleload` (legal limit) on railway ways first; if both are valid, it colours by the lower value, then supported load categories in `railway:track_class`. Colours vary continuously with metric tonnes; imperial labels use US short tons. An EN category specifies a reference load model, including wagon geometry and mass per metre; an axle-load colour alone does not establish vehicle compatibility.

| Codes | Axle load (t) | Mass per metre (t/m) |
| --- | --- | --- |
| A | 16 | 5 |
| B1, B2 | 18 | 5, 6.4 |
| C2, C3, C4 | 20 | 6.4, 7.2, 8 |
| D2, D3, D4, D5 | 22.5 | 6.4, 7.2, 8, 8.8 |
| E4, E5, E6 | 25 | 8, 8.8, 10 |
| CE | 20 | 8 |
| CM2, CM3, CM | 21 | 6.4, 7.2, 8 |
| F, G | 27.5, 30 | Not inferred |

Italian L suffixes retain the reference load and an additional-restrictions note. D4xL retains its distinct code: its reference geometry is not interchangeable with ordinary D4. Numeric US/Canadian classes and `excepted` describe track quality/speed rather than axle load. Finnish superstructure classes A/B1/B2/C1/C2/D cannot be interpreted as their identically named European categories; the extraction separately identifies Finland's ways. If the lookup is unavailable, ambiguous A/B1/B2/C2 tile classes are conservatively left unknown. Explicit railway axle limits still take precedence.

Sources checked on 2026-10-01:

- [OSM key definition and national distinctions](https://wiki.openstreetmap.org/wiki/Key:railway:track_class).
- [EN 15528:2021, CEN standard preview](https://cdn.standards.iteh.ai/samples/69915/931c5243c7c643a782f87e777289f1ea/SIST-EN-15528-2022.pdf), line-category scope and Annex A reference wagons.
- [RFI Network Statement 2026, June 2026 edition](https://www.rfi.it/content/dam/rfi/rfi_en/railway-infrastracture/ns_2026_june26/Network%20Statement%202026_June%202026%20edition.pdf), Table 2.3 and operating restrictions.
- [OSM railway axle capacity](https://wiki.openstreetmap.org/wiki/Key:axle_load).
- [OSM maximum axle-load units](https://wiki.openstreetmap.org/wiki/Key:maxaxleload).

A live Overpass count on 2026-10-01 found **709 railway ways** tagged with `maxaxleload` using the extraction's rail/narrow-gauge/light-rail/subway/monorail/funicular filter. Road limits are excluded. Taginfo reports 65,639 ways carrying `axle_load`; the extraction includes this railway-specific tag too, using the same railway filter. The details retain both explicit tags when present.

`node scripts/build-axle-load-list.mjs` runs as part of snapshot maintenance. It fetches railway IDs and values without geometry, plus a small Finnish classification lookup. Refresh is limited to once per 28 days; the prior validated lookup is reused on service failure. `snapshot/axle-load.json` is published on `rail-data` and copied into the site. The compact encoding reuses loading-gauge varint ID groups. The browser fetches and decodes this file only when the Axle load sources are visible, never calls Overpass, and shares the result between overview, detailed and branch tiles.
