import {basemapSources} from './basemap.mjs';
import {railwaySources} from './railway.mjs';
import {atlasSources} from './atlas.mjs';
import {terrainSources} from './terrain.mjs';

export {GLYPHS} from './basemap.mjs';

// Preserve the established source order as well as source IDs. Adapter
// initialization and the serialized style stay unchanged by extraction.
const SOURCE_ORDER = [
  'openmaptiles', 'network', 'speed', 'electric', 'control', 'gaugeLow',
  'loadingLow', 'ownerLow', 'ownerRail', 'axleLow', 'axleRail', 'axleBranch',
  'railway', 'trackCounts', 'stationMajor', 'platforms', 'platformEdges',
  'platformLengths', 'platformNumbers', 'railwaySignals', 'stationEntrances',
  'stationLow', 'stationMed', 'stations', 'inactiveRegional', 'crossings',
  'crossingsOverview', 'crossingsDetail', 'branchLines', 'serviceRoutes',
  'streetRunning', 'contours', 'seabedContours', 'seabedContoursClose',
  'satellite', 'carto', 'relief',
];

export function createSources(majorStationData) {
  const sources = {
    ...basemapSources(),
    ...railwaySources(),
    ...atlasSources(majorStationData),
    ...terrainSources(),
  };
  const extra = Object.keys(sources).filter(id => !SOURCE_ORDER.includes(id));
  const missing = SOURCE_ORDER.filter(id => !sources[id]);
  if (extra.length || missing.length) {
    throw new Error(`Atlas source order needs updating (extra: ${extra.join(', ')}; missing: ${missing.join(', ')})`);
  }
  return Object.fromEntries(SOURCE_ORDER.map(id => [id, sources[id]]));
}
