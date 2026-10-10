// Actual pre-fix compiled Normandy publication replay, using the same production
// renderer acceptance assertions as the separate synthetic Paris sensitivity gate.
import {checkParisServiceGeometryBrowser} from './check-paris-service-geometry-browser.mjs';
import {buildNormandyAcceptanceVariants} from './normandy-service-geometry-fixture.mjs';

await checkParisServiceGeometryBrowser({
  fixtureBuilder: buildNormandyAcceptanceVariants,
  reportPrefix: 'normandy-service',
  title: 'Paris: historical Normandy publication regression',
  caption: 'Authentic October 5, 2026 compiled Normandy snapshot; unchanged archived input. Pinned legacy Paris OSM positives. This is compiled geometry, not an inspection of raw GTFS shapes.',
  attribution: 'OSM-derived paths © OpenStreetMap contributors (ODbL 1.0). Normandy compiled extract: Nomad Train (SNCF, Région Normandie) and attributed dataset publishers, October 5, 2026, Licence Ouverte 2.0. Full attribution is preserved with the fixture.',
  scope: 'Authentic pre-PR104 October 5 compiled Normandy snapshot and archived terminal PBF sensitivity; all width profiles on production rebuilt Paris OSM-positive tiles. Raw GTFS shape structure, current live coverage and broader issue107 closure are not claimed. Paris rates remain unknown.',
});
