# Terrain source assessment

[Rendering reference](rendering.md) · [External service contracts](external-services.md)

Assessment date: 2026-11-16. This records the evidence and remaining acceptance
work for improvement plan #456, workstream 3. It does not switch the production
DEM or certify the plan's proposed source corrections.

## Provider evidence

[Mapterhorn data access](https://mapterhorn.com/data-access/) specifies 512-pixel
Terrarium WebP tiles, an XYZ endpoint and PMTiles downloads. Its examples split
zoom 0–12 from regional zoom 13–17 archives. The [coverage page](https://mapterhorn.com/coverage/)
is the provider's coverage reference; a global archive name does not establish
uniform native resolution or identical provenance everywhere.

The [provider attribution page](https://mapterhorn.com/attribution/) links the
[attribution catalogue](https://download.mapterhorn.com/attribution.json).
The catalogue fetched on the assessment date contained 151 entries; its bytes
had SHA-256 `09f9a9db46bd55a38b4612f0f76a771bd321ed5a75f6e9f3e1170f73eec312c2`.
No entry contained the names ArcticDEM or REMA. This observation does not prove
those products have never contributed indirectly; it means the proposed credits
cannot be justified from this catalogue. Do not invent either attribution or
specific Nuuk/McMurdo coverage from the proposal.

The catalogue identifies `dkgreenland` as a 2 m Greenland model from
Klimadatastyrelsen Danmark under CC BY 4.0, with its
[source page](https://dataforsyningen.dk/data/4780) and
[licence record](https://github.com/mapterhorn/mapterhorn/blob/main/source-catalog/dkgreenland/LICENSE.pdf).
It also lists `glo30` at 30 m with a
[separate Copernicus licence record](https://github.com/mapterhorn/mapterhorn/blob/main/source-catalog/glo30/LICENSE.pdf).
These are source-catalogue facts, not a tile-by-tile provenance audit or a
blanket licence for every source. A migration must carry the applicable source
notices and modification notices, rather than replace them with a generic
Mapterhorn credit.

[Copernicus's product description](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)
identifies its DEM as a DSM including buildings and vegetation. It lists ASTER
among local gap-fill inputs and gives distinct attribution obligations for
original and adapted GLO-30 data. Thus a proposed all-radar, bare-earth,
artifact-free replacement is unsupported. Comparing this surface with a DTM
requires accounting for the different measured surfaces.

The [Copernicus handbook v6.1](https://dataspace.copernicus.eu/sites/default/files/media/files/2026-10/geo1988-copernicusdem-spe-002_producthandbook_i6.1.pdf),
sections 1.1–1.2.2, specifies EGM2008 vertical heights and distinguishes point
from area grid registration. Its accuracy statistics permit local deviations
and treat Greenland/Antarctica differently. Source replacement must reconcile
datum, sample registration, resolution and nodata semantics before comparing
heights or blending a shoreline.

## Repair decisions

A negative elevation is not evidence of ocean or corruption. An incomplete
exception table for named basins cannot classify every depression, reclaimed
area or inland water body. Clamping all other negative land elevations would
silently destroy valid measurements and contours. Preserve signed values and
keep the water mask separate from height validity. No global sign clamp or
basin-table exception mechanism is introduced.

Coast proximity likewise does not establish an erroneous cliff. Unconditional
shoreline smoothing would alter real coastal cliffs, terraces and steep
islands; a mask/DEM alignment or datum mismatch can create apparent seams.
A future local correction needs independent reference evidence, a documented
mask and datum contract, a bounded extent, and fixtures preserving legitimate
cliffs and below-sea-level land. Raising source zoom or upsampling bathymetry
adds no surveyed detail by itself.

Latitude repair in [PR 462](https://github.com/c933103/openrailwaystyle/pull/462)
retains original-radius fault detection independently. Only extra wider-radius
detections require finite contradictory coarse evidence. Synthetic tests cover
polar latitude scaling, missing references, corroborated valleys, real-cliff
shapes and tile-edge faults. These tests establish algorithm behaviour, not
measured accuracy of terrain in Nuuk or McMurdo. The witness-tile set already
has a four-tile bound; arbitrarily truncating it would discard required evidence.

Native image sampling and suffix-preserving reference URLs in
[PR 463](https://github.com/c933103/openrailwaystyle/pull/463) are migration
prerequisites, not proof that every 3D or contour consumer supports a new
provider. Neither PR changes the production endpoint.

## Contour separation

The overview/shelf claim was checked against generated levels, not just a
filter applied to invented feature values. At zooms 7–8, metric overview levels
begin at −200 m and shelf levels are strictly above −200 m. Imperial overview
levels begin at −500 ft while the shelf filter excludes values at or below
−200 ft. The regression in `tests/map.test.mjs` checks both line and label
families at zooms 7, 7.5, 8 and 8.5 and preserves deep negative overview levels.
A blanket positive-only land filter would lose below-sea-level contours.
No production filter change is needed for this tested overlap allegation.

## Source-switch acceptance still to complete

Before selecting a replacement, establish the actual source/coverage and
licensing for the intended regions, verify the service access policy and
operational constraints, and record the exact attribution to display. The
published access formats alone are not an availability guarantee.

Exercise native 256/512 sampling across every consumer: readouts/profiles,
repair reference and witness requests, worker decoding, contour generation,
hillshade and 3D tile geometry. Include nodata, tile seams, wrapping, cached
versions and failed-source fallback. Verify datum/registration compatibility
with the bathymetry and ocean mask instead of assuming all zeroes coincide.

Run fixture-safe browser checks and permitted bounded browser inspection of
representative cliffs, lowlands, coasts and polar transition regions. Record
measured geometry/height differences and request/decode costs with explicit
acceptance criteria. Real-source validation, any justified coastal correction,
full provider migration and its final attribution remain outstanding work;
the safe prerequisites and contour regression do not fulfil those proposals.
