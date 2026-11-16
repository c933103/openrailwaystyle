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

## Regional and processing contract follow-up

The following inspection pins provider source to
[`2c4195dd90b91a8dde5cfa3e27a1167f64808a41`](https://github.com/mapterhorn/mapterhorn/tree/2c4195dd90b91a8dde5cfa3e27a1167f64808a41).
Only public documentation, source code and catalogue metadata were retrieved;
no terrain tile or source elevation raster was downloaded for this assessment.

The published [archive inventory](https://download.mapterhorn.com/download_urls.json)
retrieved on 2026-11-16 has SHA-256
`6824004ca43c0e15f7476fafa8b9bf5b96fe15a954b58f41a6649f4e3d458aff`.
Bounding-box membership gives these limited, reproducible observations:

| Sample coordinate | Listed archives covering the point | Interpretation |
| --- | --- | --- |
| Nuuk, −51.72°, 64.18° | `planet.pmtiles`, `6-22-16.pmtiles` | A regional archive exists; its south boundary is 64.16810689799152°, so this sample says nothing about coverage farther south |
| McMurdo, 166.67°, −77.85° | `planet.pmtiles` | No regional high-zoom archive is listed at this point |

The [GLO-30 source file inventory](https://github.com/mapterhorn/mapterhorn/blob/2c4195dd90b91a8dde5cfa3e27a1167f64808a41/source-catalog/glo30/file_list.txt)
includes `N64_00_W052_00` and `S78_00_E166_00`. This establishes input-list
membership, not which source won a pixel in a deployed tile, its validity, or
its native local accuracy. The provider's
[coverage viewer implementation](https://github.com/mapterhorn/mapterhorn/blob/2c4195dd90b91a8dde5cfa3e27a1167f64808a41/website/coverage/index.html)
uses a separate source-coverage vector layer. Inspect that layer and actual app
views at both points before assigning local provenance. No ArcticDEM or REMA
credit follows from the geocell names or regional archive bounds.

The pinned Greenland [metadata](https://github.com/mapterhorn/mapterhorn/blob/2c4195dd90b91a8dde5cfa3e27a1167f64808a41/source-catalog/dkgreenland/metadata.json)
records 2 m and CC BY 4.0, but supplies no vertical datum. The Danish
[official surface-model description](https://geodata-info.dk/srv/api/records/f134d900-fb29-482e-b413-6b8ddfdce3ae)
includes buildings and vegetation. Denmark's
[GVR2016 definition](https://www.klimadatastyrelsen.dk/Media/638167943246531698/005-GVR2016.pdf)
uses a geoid realization and a Nuuk mean-water-level origin; that document does
not prove these particular source rasters use GVR2016. Obtain their CRS and
vertical-reference metadata before claiming compatibility with GLO-30 EGM2008.

### Missing data, source seams and bathymetry

The provider's pinned
[reprojection code](https://github.com/mapterhorn/mapterhorn/blob/2c4195dd90b91a8dde5cfa3e27a1167f64808a41/pipelines/aggregation_reproject.py)
uses cubic-spline resampling into EPSG:3857 and destination nodata −9999. That
command does not itself establish a common vertical datum across all sources.
The [merge implementation](https://github.com/mapterhorn/mapterhorn/blob/2c4195dd90b91a8dde5cfa3e27a1167f64808a41/pipelines/aggregation_merge.py)
fills missing samples from subsequent sources. In its source-boundary smoothing
branch, residual −9999 samples are changed to zero before Gaussian blending
and output. The [encoder](https://github.com/mapterhorn/mapterhorn/blob/2c4195dd90b91a8dde5cfa3e27a1167f64808a41/pipelines/utils.py)
writes three-channel, lossless 512-pixel WebP and applies zoom-dependent height
rounding. These are source-code observations, not a measured defect in a
particular deployed tile. They establish why neither an alpha mask nor a
single decoded sentinel can be assumed to identify all missing data, and why
new shoreline smoothing would compound existing source processing.

Atlas currently derives ordinary seabed from its Mapzen/ETOPO-derived DEM and
uses separate ETOPO 2022 data in the polar cap. NOAA's
[ETOPO1 FAQ](https://www.ncei.noaa.gov/sites/default/files/2023-01/Frequently%20Asked%20Questions.pdf)
states a generic sea-level datum and no general conversion of contributing
vertical datums. Treating this as exactly identical to EGM2008 is unsupported.
A land DEM replacement therefore cannot also replace the bathymetry source by
changing one shared URL. Retain the ocean mask as a separate classifier and
preserve signed land heights; unknown data and ocean are distinct states.

### Bounded migration sequence

1. Introduce an explicit provider contract in a separate candidate: source URL,
   native size, source maximum zoom/overzoom policy, encoding, validity policy,
   attribution and separately identified bathymetry. Keep production selection
   unchanged while fixtures exercise that contract.
2. Route readout/profile, hillshade/contours and 3D land through their designated
   provider, retaining the existing seabed input. `terrain-3d.mjs` currently
   asserts 256×256 height arrays; normalize a 512-pixel land grid at this boundary
   or generalize the whole consumer with an explicit sampling contract.
3. Test affine ramps and signed lowlands at 256/512 sizes, point/area registration,
   seam continuity, masked ocean recovery, valid zero versus unknown zero,
   original and wider repair radii, reference/witness dimensions, source failure,
   cache isolation and worker/page parity. Source zoom changes need an explicit
   overzoom test at McMurdo, where a regional archive is not listed.
4. Inspect representative app views with permitted browser access and record
   tile provenance, shoreline/lowland height comparisons and request/decode costs.
   Accept the switch only after the regional licence/datum/validity contracts,
   all consumers and browser measurements are evidenced. Metadata inspection
   alone is insufficient to activate the replacement.
