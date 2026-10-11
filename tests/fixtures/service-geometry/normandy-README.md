# Historical Normandy compiled fixture

`normandy-20261005.json.gz` is the unmodified archived compiled Normandy
timetable from the successful October 5, 2026 workflow, before PR #104.
It is **not the raw GTFS ZIP**, a fresh download, or a synthetic timetable.

- Repository: https://github.com/c933103/openrailwaystyle
- Issue: https://github.com/c933103/openrailwaystyle/issues/107
- Original fix: https://github.com/c933103/openrailwaystyle/pull/104
- Workflow: https://github.com/c933103/openrailwaystyle/actions/runs/37291043442
- Producer commit: `c039337f4cb7c7fc3f997521196df758633832d3`
- Compile job: https://github.com/c933103/openrailwaystyle/actions/runs/37291043442/job/111701464944
- Compile/reference date: October 5, 2026. Retrieved October 4; checked October 5.
- Shard artifact: `worldwide-frequency-shard-4`, ID `11337683948`.
- Assembled artifact: `worldwide-frequency-snapshot`, ID `11338486417`.
- Original member: `feeds/fr_base-de-donnees-multimodale-des-reseaux-de-transport-public-normands.json.gz`.
- The assembled artifact contains the same compiled member byte-for-byte.
- Compressed: 15,279 bytes; SHA256
  `9de5d10c8f35d51670115e582100ab1212843f76f63ab365afe699e6db22fbff`.
- Expanded: 556,608 bytes; SHA256
  `7e96edecf52cb72663149e2e4385ea51bcc31ea8c438c46558b98042bbd542b0`.

The exact original two archived terminal tile gzip files are also retained:

- `normandy-20261005-12-2074-1408.pbf.gz`: original Saint-Lazare publication,
  six Normandy features; SHA256
  `ed7efd6d54028c4f1a057c5ac187a56740d95fa20234647a83b374932d906ac3`.
- `normandy-20261005-12-2074-1409.pbf.gz`: original Montparnasse publication,
  four Normandy features; SHA256
  `86fe7a5427612ed6f7797e6f0bdcbfeb3eb979f58a5f8630f4f8d519feb1688a`.

`normandy-metadata.json` preserves complete source attribution, source dates,
URLs, archive hashes and file sizes. Tests verify both compressed and expanded
hashes and bound gzip expansion. No mutable release or network input is used.

## Source and licence

Recorded upstream: https://transport.data.gouv.fr/resources/81942/download

Recorded processed input:
https://api.transitous.org/gtfs/fr_base-de-donnees-multimodale-des-reseaux-de-transport-public-normands.gtfs.zip

The raw ZIP was not acquired for this regression. Its recorded SHA256 is
`2d66b46d7cef1f86e8534aaf33e3bd947b85828c5108ce2d488800cd762641b4`;
CITYWAY feed version 16291.

Licence: Licence Ouverte / Open Licence 2.0 (`etalab-2.0`).
Official dataset and attribution requirements:
https://transport.data.gouv.fr/datasets/base-de-donnees-multimodale-des-reseaux-de-transport-public-normands

Official licence text:
https://github.com/etalab/licence-ouverte/blob/master/open-licence.txt

Source attribution: Base De Donnees Multimodale Des Reseaux De Transport Public
Normands; Nomad Train (SNCF, Région Normandie); Semo (Val-de-Reuil, Louviers,
Seine Eure Agglo); SN'go! (Vernon, Les Andelys, Seine Normandie Agglo);
Rézo'Bus (Bolbec, Lillebonne, Port-Jérôme, Caux Seine Agglo); Cap Cotentin
(Cherbourg, Agglo. du Cotentin); Altobus (Communauté Urbaine d'Alençon);
SLAM (Saint-Lô Agglo); Bybus (Bayeux Intercom); Brittany Ferries;
Bagnoles de l'Orne. No official endorsement is implied.

## Reproduction and limits

The fixture has 203 compiled two-coordinate path segments and three canonical
rail route records, two mapped. The compiler deliberately segments supplied
shapes into individual edges. **These counts do not establish how many vertices
were in each raw GTFS shape.** The representative TER name `Paris - Deauville`
groups 24 original route IDs, so it does not identify every edge as that journey.

The test replays the real production assembly and rebuild commands with absent,
present and expired timetable states. A test-only `--import` preload pins
`Date.now`; present and expired use exactly the same historical gzip bytes.
The unchanged source reports 197 available segments on October 5: six of its
203 segments have only null profiles, four of those already expired. The
expired replay reports zero available segments without rewriting those facts.
The full 203-segment feed must add no Service geometry, identities, rates or
shared-service slots. All 43 rebuilt OSM tiles must remain identical, while
stale standalone timetable and orphan Service tiles are physically removed.

`normandy-probes.json` identifies every one of the six Saint-Lazare and four
Montparnasse terminal-linked source segments by its original index and route ID.
Each zoom 9, 12 and 16 point is interpolated along that real segment in the map's
Web Mercator projection. No invented segment is labelled authentic. Mutation
controls use original compiled geometry at regional zooms and the original
archived PBF records at the terminal's native zoom 12 and overzoom 16, retaining
their original integer geometry and properties in the same Service source.

The positive OSM fixtures remain the existing pinned legacy Paris rows. They
do not certify current OSM completeness, raw-node geometry, live rendering or
regional services beyond that subset. The separately maintained synthetic
shape/stop controls remain useful for cases this authentic fixture does not
contain.
