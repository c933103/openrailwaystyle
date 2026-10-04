import { MODES } from './map-model.mjs?v=20261004-pr76-repair1';

const VERSION = 1;
const VALUE_LABELS = /^(speed|electrification|control|gauge|loading|axle|owner)-labels$/;
const RUNTIME_LAYER = /^(drawing|measure)-|^polar-caps$/;

// Convert the existing layer catalog once, at build time. This is also the
// compatibility adapter for a previously cached style without Atlas metadata.
// New layer modules can declare these fields directly; their declarations win
// over this adapter. The browser reads the declared semantics, not layer names.
function legacySemantics(layer) {
  const id = layer.id;
  const mode = MODES.find(mode => id.startsWith(`${mode}-`));
  const station = id.startsWith('station-');
  const inactive = id.startsWith('inactive-');
  const terrain = id.startsWith('terrain-');
  const names = id.endsWith('-names') && !station;
  const runtime = RUNTIME_LAYER.test(id);
  let group = layer.source === 'openmaptiles' || id === 'background' ? 'basemap' : 'railway';
  let category = layer['source-layer'] || layer.type;
  let views = mode ? [mode] : [];
  let settings = mode ? [VALUE_LABELS.test(id) && 'labels', layer.source === 'trackCounts' && 'trackCounts'].filter(Boolean) : [];

  if (station) {
    group = 'stations'; category = id.startsWith('station-former-') ? 'former' : 'current';
    views = []; settings = ['stations', ...(category === 'former' ? ['inactive'] : [])];
  }
  if (inactive) { group = 'lifecycle'; views = []; settings = ['inactive']; }
  // Railway names historically override the general view rule. In particular,
  // service names follow names, rather than the numeric-label setting.
  if (names) { category = 'names'; views = id.startsWith('service-') ? ['service'] : []; settings = ['names', ...(inactive ? ['inactive'] : [])]; }
  if (id.startsWith('platform-')) {
    group = 'platforms'; category = 'geometry'; views = ['infrastructure'];
    settings = ['platform-lengths', 'platform-numbers'].includes(id) ? ['labels'] : [];
    if (id === 'platform-lengths') category = 'length';
    if (id === 'platform-numbers') category = 'number';
  }
  if (/^infrastructure-(signal|entrance)-references$/.test(id)) settings = ['labels'];
  if (terrain) { group = 'terrain'; category = layer.type; views = []; settings = ['relief']; }
  for (const categoryName of ['transport', 'destinations', 'constraints']) {
    if (id.startsWith(`context-${categoryName}-`)) { group = 'context'; category = categoryName; views = []; settings = [categoryName]; }
  }
  if (runtime) { group = 'runtime'; category = id === 'polar-caps' ? 'polar' : id.startsWith('drawing-') ? 'drawing' : 'measure'; }
  const background = ['carto', 'satellite'].includes(id) ? id : null;
  if (background) { group = 'background'; category = background; }

  return {
    'atlas:semantics-version': VERSION,
    'atlas:group': group,
    'atlas:category': category,
    'atlas:views': views,
    'atlas:settings': settings,
    // Preserve the catalog's default layout separately from runtime policy:
    // platform layers acquire Infrastructure gating before the map starts.
    'atlas:initial-hidden': Boolean(mode && mode !== 'speed'),
    // Context currently uses basemap geometry and follows its background
    // suppression. Preserve that independently from its semantic group.
    'atlas:base-map': layer.source === 'openmaptiles' || id === 'background' || terrain,
    'atlas:terrain': terrain,
    'atlas:runtime': runtime,
    'atlas:background': background,
    'atlas:localize': layer.type === 'symbol' && id !== 'speed-labels' && id !== 'platform-lengths' && !terrain && (layer.source === 'openmaptiles' || station || names),
  };
}

// Annotation changes metadata alone: layer order, expressions, paint, filters,
// source contracts, and the builder's initial visibility remain untouched.
export function annotateLayers(layers) {
  for (const layer of layers) layer.metadata = {...legacySemantics(layer), ...layer.metadata, 'atlas:semantics-version': VERSION};
  return layers;
}

export function getLayerSemantics(layer) {
  return layer.metadata?.['atlas:semantics-version'] === VERSION ? layer.metadata : legacySemantics(layer);
}

export const isBaseMap = layer => getLayerSemantics(layer)['atlas:base-map'];
export const shouldLocalizeLayer = layer => layer.type === 'symbol' && getLayerSemantics(layer)['atlas:localize'];

// Undefined leaves the visibility of drawing, measurement, and custom polar
// layers under their own control, as before. Ordinary layers always resolve to
// a boolean so first-frame setup and later changes share the same policy.
export function layerVisibility(layer, settings) {
  const semantics = getLayerSemantics(layer);
  const runtime = semantics['atlas:runtime'];
  const views = semantics['atlas:views'] || [];
  const requirements = semantics['atlas:settings'] || [];
  let visible = runtime ? undefined : (!views.length || views.includes(settings.mode)) && requirements.every(key => settings[key]);
  const background = semantics['atlas:background'];
  if (background === 'carto') visible = settings.background === 'carto';
  else if (background === 'satellite') visible = ['satellite', 'hybrid'].includes(settings.background);
  else if (settings.background === 'satellite' && !runtime) visible = false;
  else if (settings.background === 'hybrid' && semantics['atlas:base-map']) visible = false;
  else if (settings.background === 'carto' && semantics['atlas:base-map'] && !semantics['atlas:terrain']) visible = false;
  return visible;
}
