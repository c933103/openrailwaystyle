// This is the schema consumed by the composed style, after source adapters
// have added Atlas fields. It describes attribute names used by rendering;
// it does not require every feature to carry every optional attribute, nor
// does a static check establish that a remote provider is currently healthy.
// The localization adapter supports OSM's name:<language> property family.
const LABEL = ['atlas_name', 'label', 'name', 'name:latin', 'name:nonlatin', 'name:*', 'ref'];
const STATION = [...LABEL, 'feature', 'state', 'station', 'station_size'];
const CONTOUR = {contours:['ele', 'level']};

export const SOURCE_CONTRACTS = {
  openmaptiles: {
    landuse:[...LABEL, 'class'],
    landcover:['class', 'subclass'],
    water:['brunnel', 'intermittent'],
    aeroway:['class'],
    park:[...LABEL, 'class'],
    boundary:[...LABEL, 'admin_level', 'claimed_by', 'class'],
    building:[],
    transportation:['brunnel', 'class', 'subclass'],
    waterway:['brunnel', 'intermittent'],
    place:[...LABEL, 'class', 'iso_a2', 'name:en'],
    transportation_name:[...LABEL, 'class'],
    poi:[...LABEL, 'class', 'rank', 'subclass'],
    aerodrome_label:[...LABEL, 'class', 'iata', 'rank'],
  },
  contours:CONTOUR,
  seabedContours:CONTOUR,
  seabedContoursClose:CONTOUR,
  network:{standard_railway_line_low:['feature', 'highspeed', 'service', 'state', 'usage']},
  speed:{speed_railway_line_low:['feature', 'maxspeed', 'state']},
  electric:{electrification_railway_line_low:['electrification_state', 'feature', 'frequency', 'state', 'voltage']},
  control:{signals_railway_line_low:['feature', 'state', 'train_protection0', 'train_protection1', 'train_protection2']},
  gaugeLow:{track_railway_line_low:['feature', 'gaugeint0', 'state']},
  loadingLow:{standard_railway_line_low:['feature', 'loading_gauge', 'state']},
  ownerLow:{operator_railway_line_low:['feature', 'owner_color', 'state']},
  ownerRail:{railway_line_high:['feature', 'owner_color', 'service', 'state', 'tunnel']},
  axleLow:{standard_railway_line_low:['axle_tonnes', 'feature', 'state']},
  axleRail:{railway_line_high:['axle_native', 'axle_tonnes', 'axle_units', 'feature', 'service', 'state', 'tunnel']},
  axleBranch:{branch_lines:['axle_tonnes', 'feature', 'service', 'state', 'tunnel']},
  railBackbone:{railroads:[],railroads_north_america:[]},
  railway:{railway_line_high:[...LABEL, 'bridge', 'electrification_state', 'feature', 'frequency', 'gauge0', 'gauge1', 'gaugeint0', 'gaugeint1', 'highspeed', 'loading_gauge', 'maxspeed', 'owner', 'service', 'speed_label', 'state', 'train_protection0', 'train_protection1', 'train_protection2', 'tunnel', 'usage', 'voltage']},
  branchLines:{branch_lines:['bridge', 'electrification_state', 'feature', 'frequency', 'gaugeint0', 'gaugeint1', 'highspeed', 'loading_gauge', 'maxspeed', 'owner_color', 'service', 'state', 'train_protection0', 'train_protection1', 'train_protection2', 'tunnel', 'usage', 'voltage']},
  inactiveRegional:{lifecycle:[...LABEL, 'bridge', 'feature', 'maxspeed', 'state', 'tunnel']},
  serviceRoutes:{service_routes:[...LABEL, 'colour', 'i', 'n', 'slot']},
  streetRunning:{street_running:[]},
  heritageAreas:{heritage:[...LABEL, 'kind']},
  trackCounts:{atlas_track_counts:['station', 'tracks', 'tunnel']},
  platforms:{standard_railway_platforms:[]},
  platformEdges:{standard_railway_platform_edges:[]},
  railwaySignals:{railway_signals:['railway', 'ref', 'caption']},
  railwaySignalSupplementOverview:{railway_signals:['railway', 'ref', 'caption']},
  railwaySignalSupplement:{railway_signals:['railway', 'ref', 'caption']},
  electricSubstations:{electrification_substation:[]},
  stationEntrances:{standard_station_entrances:['label']},
  stationLow:{standard_railway_text_stations_low:[...STATION, 'id', 'osm_id', 'wikidata']},
  stationMed:{standard_railway_text_stations_med:[...STATION, 'id', 'osm_id', 'wikidata']},
  stations:{standard_railway_text_stations:STATION},
  crossingsOverview:{level_crossings:['kind', 'minor']},
  crossingsDetail:{level_crossings:['kind', 'minor']},
  crossings:{points_of_interest:['type']},
};

const LEGACY_FILTER_OPERATORS = new Set(['==', '!=', '>', '>=', '<', '<=', 'in', '!in', 'has', '!has']);

function expressionFields(expression, fields) {
  if (!Array.isArray(expression) || expression[0] === 'literal') return;
  // A get/has with an explicit object reads that object, not tile properties.
  if ((expression[0] === 'get' || expression[0] === 'has') && expression.length === 2 && typeof expression[1] === 'string') {
    fields.add(expression[1]);
  }
  for (const value of expression.slice(1)) expressionFields(value, fields);
}

function legacyFilterFields(filter, fields) {
  if (!Array.isArray(filter)) return;
  if (LEGACY_FILTER_OPERATORS.has(filter[0]) && typeof filter[1] === 'string' && !filter[1].startsWith('$')) {
    fields.add(filter[1]);
  }
  if (['all', 'any', 'none'].includes(filter[0])) {
    for (const child of filter.slice(1)) legacyFilterFields(child, fields);
  }
}

export function consumedLayerFields(layer) {
  const fields = new Set();
  for (const value of Object.values(layer.layout || {})) expressionFields(value, fields);
  for (const value of Object.values(layer.paint || {})) expressionFields(value, fields);
  expressionFields(layer.filter, fields);
  legacyFilterFields(layer.filter, fields);
  for (const key of ['text-field', 'icon-image']) {
    const template = layer.layout?.[key];
    if (typeof template === 'string') {
      for (const [, field] of template.matchAll(/\{([^{}]+)\}/g)) fields.add(field);
    }
  }
  return fields;
}

export function assertSourceContracts(style) {
  const errors = [];
  for (const layer of style.layers) {
    if (!layer.source) continue;
    const source = style.sources[layer.source];
    if (!source) {
      errors.push(`${layer.id}: unknown source ${layer.source}`);
      continue;
    }
    if (source.type !== 'vector') continue;
    const fields = SOURCE_CONTRACTS[layer.source]?.[layer['source-layer']];
    if (!fields) {
      errors.push(`${layer.id}: undeclared source layer ${layer.source}/${layer['source-layer']}`);
      continue;
    }
    for (const field of consumedLayerFields(layer)) {
      const declared = fields.some(name => name === field || (name.endsWith('*') && field.startsWith(name.slice(0, -1))));
      if (!declared) errors.push(`${layer.id}: undeclared field ${layer.source}/${layer['source-layer']}/${field}`);
    }
  }
  if (errors.length) throw new Error(`Atlas source contract mismatch:\n${errors.join('\n')}`);
}
