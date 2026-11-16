# Named-domain extraction audit

Checked against the full WS4 specification before freezing the refresh filter.
The plan asks for **locomotive H2 dispensers**. Their railway=fuel type already
selects the entire object, including raw fuel descriptors. Adding all road fuel
amenities or changing the filter for those descriptors would expand the task
unnecessarily. Explicit fuel:h35, fuel:h50, fuel:h70 and fuel:LH2 offerings now
join the existing fuel:hydrogen compatibility key in locomotive classification.
No/unknown/contradictory values remain raw and do not establish hydrogen supply.
Sources: [gaseous hydrogen](https://wiki.openstreetmap.org/wiki/Key:fuel:h70),
[liquid hydrogen](https://wiki.openstreetmap.org/wiki/Key:fuel:LH2).

| Named plan domain | Existing final selection | Retained evidence |
| --- | --- | --- |
| Grid plants, generators, lines, minor lines, cables, substations, converters and transformers | All power keys and lifecycle power keys; substation/transformer hints | Explicit type, voltage/frequency, source tags; frequency_converter included |
| Insulators, neutral-section signals and trackside servicing | Railway, lifecycle railway and railway namespaces | Explicit railway/electricity signal tags |
| Coal extraction, processing, yards, silos and conveyors | Resource/industrial families; named man_made storage/conveyor values | Coal resource/content and industrial type |
| Water works, pumping, steam/water pipelines and tanks | Named man_made families plus railway supplies | Explicit contents/substance; unspecified pumps stay unknown |
| Oil/gas fields, wells, refineries and bulk depots | Industrial/resource families and petroleum_well | Explicit site type; well fuel subtype is not invented |
| Diesel/biofuel/HVO/LNG storage and pipelines | Storage/pipeline man_made values | Raw substance/content and fuel values |
| Loading racks and locomotive fueling | Railway families | Explicit railway=fuel/loading_rack; raw fuel:* |
| BESS | Power families and substation hints | substation=storage or generator:source=battery on mapped power objects |
| Railway battery charging stations/islands | Railway families; vehicle-hint selection for existing charger builder | Existing traction snapshot and explicit railway charging types |
| H2 electrolysis, pipelines and tanks | Industrial and man_made pipeline/storage families | Explicit hydrogen type/substance/content |
| Locomotive H2 dispensers | Railway=fuel and lifecycle variants | Canonical explicit hydrogen offerings, preserved verbatim |
| Track propulsion, dual voltage and contact attributes | Railway ways; electrified/propulsion/traction supplement | Whole tags retained for the power-method builder |

This is a **selection audit**, not a claim that every presentation detail is
finished. The existing candidate boundary retains incomplete-world and actual
viewport-budget gates. Circuit/rack semantics and client rendering are separate
reviewed increments. A numerical definition of major civil plants and full
three-phase overhead presentation remain outside this filter freeze; their
underlying tagged railway/power objects are already selected.

The region identity remains
`7e451e59edde52cbe7cd5fb40e747dfa6e271a35d0c364922271d588c2028af9`;
the gap identity remains
`overpass:958d2e4e6150ae21ec52dc46f79b2f25bed0db9f15ee588f4924bda77c3c74c6`.
