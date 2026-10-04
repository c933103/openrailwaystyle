import {seabedContourOpacity} from '../../styles/bathymetry.mjs';
import {ORM} from '../../styles/map-model.mjs';
import {annotateLayers} from '../../styles/layer-semantics.mjs';
import {createSources, GLYPHS} from './sources/index.mjs';
import {baseFills, baseLines, placeLayers, countryLayers} from './layers/base.mjs';
import {backgroundLayers} from './layers/backgrounds.mjs';
import {reliefLayers, contourLayers, contourLabels} from './layers/terrain.mjs';
import {buildingLayers} from './layers/buildings.mjs';
import {createRailwayLayers} from './layers/railway.mjs';
import {lifecycleLayers} from './layers/lifecycle.mjs';
import {stationLayers} from './layers/stations.mjs';
import {infrastructureContextLayers} from './layers/infrastructure.mjs';
import {roadLayers, constraintLayers} from '../planning-style.mjs';
import {contextLayers} from '../context-style.mjs';
import {assertSourceContracts} from './source-contract.mjs';

// Bottom to top. MapLibre places labels in reverse order, so country names,
// station names and track badges have explicitly ordered priority here.
// Each call owns its layer objects: runtime localization/units may mutate them.
export function composeStyle({majorStationData, curatedFilter}) {
  const rail = createRailwayLayers(), lifecycle = lifecycleLayers();
  const stations = stationLayers(curatedFilter), infrastructure = infrastructureContextLayers();
  const context = contextLayers(), constraints = constraintLayers(), roads = roadLayers();
  const [background, ...fills] = baseFills;
  const layers = structuredClone([
    background, ...backgroundLayers, ...fills,
    ...reliefLayers,
    ...context.areas, ...constraints.areas, ...buildingLayers,
    ...context.lines, ...constraints.lines,
    ...contourLayers, ...baseLines, ...contourLabels,
    ...rail.overviewPrefix, ...roads.roads, ...rail.overview,
    ...rail.structures, ...infrastructure.street,
    ...rail.infrastructureTracks, ...rail.thematic, ...rail.details,
    ...lifecycle.lines, ...rail.values,
    ...stations.platforms, ...stations.dots, ...placeLayers,
    ...infrastructure.crossings,
    ...roads.names, ...constraints.labels, ...context.labels,
    ...rail.names, ...lifecycle.names, ...rail.badges,
    ...stations.names, ...countryLayers,
  ]);
  layers.splice(layers.findIndex(l=>l.id==='water')+1,0,{id:'terrain-bathymetry',type:'raster',source:'bathymetry',paint:{'raster-fade-duration':0,'raster-resampling':'linear'}});
  for(const layer of layers)if(['terrain-seabed-contours','terrain-seabed-contours-close'].includes(layer.id))layer.paint['line-opacity']=seabedContourOpacity();
  annotateLayers(layers);
  // Preserve the first frame's default Speed view, before saved settings apply.
  for (const layer of layers) {
    if (layer.metadata['atlas:initial-hidden']) {
      layer.layout ||= {};
      layer.layout.visibility = 'none';
    }
  }
  const style = {
    version: 8,
    name: 'Railway Atlas — world',
    metadata: {
      description: 'Worldwide railway atlas with independent cartography and multiple data providers',
      'openrailwaystyle:rail-data': ORM,
    },
    glyphs: GLYPHS,
    sources: createSources(majorStationData),
    layers,
  };
  assertSourceContracts(style);
  return style;
}
