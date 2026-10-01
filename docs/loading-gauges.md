# Loading-gauge dimensions

[Rendering reference](rendering.md) · [Documentation index](README.md)

Loading gauge view shows height above the rail and maximum full width in the
legend and the clicked-line details. The maximum width and height can occur at
different points of a shaped outline: they do not describe a rectangle that a
train or load may fill. Vehicle length, curve overthrow, suspension movement and
the profile's application rules still matter.

Metric figures retain the source precision (up to a millimetre); imperial figures
are rounded to the nearest inch. A historic approximation stays labelled as
approximate after conversion. Unknown tags remain unknown. Profiles sharing a
colour are grouped only when their dimension descriptions also match.

## Historical and regional entries

| Tag | Height (m) | Full width (m) | Measurement basis and source |
| --- | ---: | ---: | --- |
| W5 | approximately 3.965 | approximately 2.740 | Historic stationary-vehicle outline in the W5 comparison, [ITS Leeds Working Paper 285 (1989)](https://eprints.whiterose.ac.uk/id/eprint/2271/1/ITS66_WP285_uploadable.pdf), Figure 1, printed p. 3 (PDF p. 6). This is a historical comparison, not a current normative coordinate table. |
| W9Plus | 3.965 | 2.796 | Withdrawn upper load outline in [GB Railway Data's gauge diagrams](https://railmap.azurewebsites.net/Public/GaugeDiagram), entry `W9P (Withdrawn)`. Its extrema match W9 but its corners differ. |
| W11 | 3.896 | 2.625 | Withdrawn upper load outline from the same dataset, entry `W11 (Withdrawn)`. These are profile extrema, not just the container's dimensions. |
| W7a | 3.635 | 2.525 | RSSB GERT8073 coordinate table 10; upper load outline including fastening tolerance. |
| W9a | 3.866 | 2.625 | RSSB GERT8073 coordinate table 14; upper load outline including fastening tolerance. |
| EBV 1 / EBV O1 | 4.530 | 3.290 | Swiss upper kinematic reference profile, AB-EBV 18.2/47.2, sheet 7 N. |
| EBV 2 / EBV O2 | 4.630 | 3.290 | Same reference, sheet 8 N. |
| EBV 3 / EBV O3 | 4.630 | 3.290 | Same reference, sheet 9 N; wider upper corners than O2 despite equal extrema. |
| EBV 4 / EBV O4 | 4.700 | 3.290 | Same reference, sheet 10 N; the sheet specifies an infrastructure application. |
| FS | 4.300 | 3.200 | [UIC Loading Guidelines, volume 1, 1 April 2026](https://uic.org/IMG/pdf/uic_loading_guidelines-volume_1_01.04_2026.pdf), table 1.7, RFI (FS) / FN, PDF p. 87. |

The W9Plus and W11 values are calculated from the published original coordinates
in GB Railway Data's [public diagram data](https://railmap.azurewebsites.net/API/Public/GaugePoints/):
height is the greatest `y`, full width twice the greatest `x`. The provider
attributes the diagrams to RSSB and GB Railway Data. W11 has a widest
half-width of 1312.5 mm and a highest point of 3896 mm; W9Plus has a widest
half-width of 1398 mm and a highest point of 3965 mm. These historical outlines
are explicitly marked as withdrawn, rather than treated as current standards.

The W7a and W9a coordinates are readable in RSSB's public
[GERT8073 issue 4.1 consultation draft](https://consultations.rssb.co.uk/_entity/sharepointdocumentlocation/04beccec-f538-ed11-a81b-000d3adc28dd/2ab10dab-d681-4911-b881-cc99413f07b6?file=04.+GERT8073.pdf),
tables 10 and 14, and agree with the provider's diagram data. The table's existing
W6A–W12 dimensions use the issue 4.1-era profiles. RSSB subsequently revised W10
and W12 in [issue 5 (2025)](https://www.rssb.co.uk/standards-catalogue/CatalogueItem/gert8073-iss-5);
an OSM gauge name does not state which standard edition was used to assess a
route. This reference is a map comparison, not a route-clearance assessment.

The Swiss figures come from the dimensioned drawings in the
[BAV AB-EBV, consolidated 1 July 2024](https://www.bav.admin.ch/dam/de/sd-web/0jHc7IGNkQrY/ab-ebv-2024.pdf),
PDF pp. 134–137 (individual sheets dated 1 November 2020). Each has a maximum
half-width of 1645 mm. These are **kinematic reference profiles**, labelled
“Reference profile” in the map. They must not be confused with smaller static
vehicle dimensions obtained by applying the associated rules, or with the larger
space reserved around a train. The four EBV tags remain separate entries.

## Metro categories

These tags identify broad systems rather than one dimensioned clearance profile.
The map therefore provides a **named vehicle example** in both the legend and
details. Example dimensions are kept separate from gauge-envelope dimensions in
the data model; they are not used as a gauge height for colouring or ranking.

| Tag | Example train | Height (m) | Width (m) | Source |
| --- | --- | ---: | ---: | --- |
| deep-tube | London Underground 1992 Stock | 2.869 | 2.620 over doors | [TfL Rolling Stock Data Sheet, second edition](https://foi.tfl.gov.uk/FOI-1538-2021/1538-2021-Rolling_Stock_Data_Sheet_2nd_Edition.pdf), Central line vehicle table. |
| subsurface | London Underground S Stock | 3.682 | 2.920 over doors | [TfL S Stock information sheet, July 2010](https://foi.tfl.gov.uk/FOI-0158-2021/S%20Stock%20information%20sheet%20July%202010.pdf), vehicle details. |
| Kleinprofil | Berlin JK | 3.160 | 2.400 | [Stadler / BVG JK datasheet (2024)](https://unternehmen.bvg.de/wp-content/uploads/2024/01/Stadler_Datenblatt-U-BAHN_VOM_TYP_JK.pdf). |
| Großprofil / Grossprofil | Berlin J | 3.425 | 2.650 | [Stadler / BVG J datasheet](https://unternehmen.bvg.de/wp-content/uploads/2021/04/Datenblaetter-U-Bahn-J.pdf). |

An example train does not establish a route's maximum permitted dimensions.
London tunnel diameters are not substituted for train height or width.

## Maintaining the reference

The entries and formatter are in `styles/map-model.mjs`. Keep the measurement
basis, edition and source with each addition. In particular, do not substitute
container height for height above rail, a half-width for full width, or vehicle
dimensions for a structure gauge. British W categories are not strictly nested.
Run the map tests and regenerate `styles/world.style.json` when adding codes or
changing colour expressions.
