import {numericSpeed, referenceDetailEligible} from './map-model.mjs?v=20261127-board-event-1';
import {terrain3DEnabled} from './terrain-3d.mjs?v=20261127-board-event-1';

// Source-event reconciliation and the visible availability diagnostics.
export function mapErrorMessage({railRecovery, stationFailures, errors, settings, terrain3DSelected}) {
  const railFailed=railRecovery?.hasFailures();
  const failed=[...new Set([...errors.keys(),...(railRecovery?.failedSourceIds()||[]),
    ...['stations','stationMed'].filter(id=>stationFailures?.hasSourceFailure(id))])];
  const stationFailed=failed.some(id=>['stations','stationLow','stationMed'].includes(id));
  const trackFailed=failed.some(id=>['railway','network','speed','electric','control','gaugeLow','ownerLow','ownerRail','axleLow','axleRail','loadingLow'].includes(id));
  if(railFailed||stationFailed||trackFailed){
    const kind=stationFailed&&trackFailed?'station and track data':stationFailed?'station data':'railway data';
    return 'OpenRailwayMap '+kind+' unavailable. '+(railFailed?'Retrying failed tiles. ':'')+
      'Independent map references remain where available; detail may be missing.';
  }
  if (failed.includes('terrain3d') && terrain3DEnabled(settings.relief, terrain3DSelected)) {
    return '3D elevation tiles could not load. Terrain geometry is incomplete; check your connection or reload.';
  }
  if (failed.length === 1 && failed[0] === 'bathymetry') {
    return 'Bathymetry tiles could not load. Seabed shading may be incomplete.';
  }
  return 'Some map data could not load. Check your connection or reload to retry.';
}
export function updateMapStatus(context) {
  const {railRecovery, stationFailures, errors, sourceFailureStates, applyRailReferenceState, applyStationFallbackState, status, map, ready, settings} = context;
  const railFailed = railRecovery?.hasFailures(); // prune before reconciling ownership
  for (const [id, failures] of sourceFailureStates) {
    if (!failures.current()) sourceFailureStates.delete(id);
    else if (failures.hasFailures() && !errors.has(id)) errors.set(id, {source:failures.source, failures});
  }
  for (const [id, error] of errors) {
    if (error.failures && !error.failures.current()) errors.delete(id);
    else if (error.stationOwned && !stationFailures?.hasSourceFailure(id)) errors.delete(id);
    else if (error.recoveryOwned && !railRecovery?.hasSourceFailure(id, error.source)) errors.delete(id);
    else if (error.failures && !error.failures.hasFailures() &&
      !railRecovery?.hasSourceFailure(id, error.source) && !stationFailures?.hasSourceFailure(id)) errors.delete(id);
  }
  applyRailReferenceState();
  applyStationFallbackState();
  if (errors.size || railFailed || ['stations','stationMed'].some(id=>stationFailures?.hasSourceFailure(id))) {
    status.classList.add('error'); status.textContent = mapErrorMessage(context); return;
  }
  // Keep the last complete non-error status until the camera's frame is ready.
  // Live source errors are reconciled above even during this transition.
  if (context.deferStatusCensus && !status.classList.contains('error')) return;
  status.classList.remove('error');
  status.textContent = map.getZoom() < 4 ? 'Worldwide coverage · click a line' : 'Explore the rail network · click a line or station';
  // Early source events may precede style.load; status text is safe then,
  // but rendered-feature queries require the style to be ready.
  if (!ready || context.deferStatusCensus) return;
  // Visible diagnostics make source availability inspectable without exposing
  // internal map objects or relying on a generic "loaded" flag.
  const features = map.queryRenderedFeatures();
  const trackLayer = map.getStyle().layers.find(layer => layer.id === `${settings.mode}-tracks`);
  const reference = features.some(f => ['rail-basemap-reference','infrastructure-basemap-reference'].includes(f.layer?.id) && referenceDetailEligible(f, map.getZoom(), trackLayer));
  const detailed = features.some(f => f.layer?.id === `${settings.mode}-tracks` || f.layer?.id === `${settings.mode}-metro-overview` || settings.mode === 'service' && f.layer?.id === 'service-routes');
  const detailSource = settings.mode === 'owner' ? 'ownerRail' : settings.mode === 'axle' ? 'axleRail' : 'railway';
  if (reference && !detailed && map.isSourceLoaded(detailSource)) {
    status.textContent = 'Only basemap railway reference is visible here; detailed railway data is unavailable.';
  }
  const tracks = features.filter(f => ['railway','speed','network','electric'].includes(f.source));
  const stations = features.filter(f => f.source.startsWith('station') || f.layer?.id.startsWith('station-basemap-fallback-'));
  status.dataset.renderedTracks = String(tracks.length);
  status.dataset.renderedStations = String(stations.length);
  const regional = features.filter(f => f.source === 'inactiveRegional');
  status.dataset.lifecycleNames = JSON.stringify([...new Set(regional.map(f=>f.properties.name).filter(Boolean))]);
  status.dataset.renderedRailNames = String(features.filter(f=>f.layer.id.endsWith('-names') && !f.layer.id.startsWith('station-')).length);
  status.dataset.renderedPlanned = String(regional.filter(f => f.properties.state === 'proposed').length);
  status.dataset.renderedConstruction = String(regional.filter(f => f.properties.state === 'construction').length);
  status.dataset.renderedFormer = String(regional.filter(f => !['proposed','construction'].includes(f.properties.state)).length);
  status.dataset.numericSpeeds = String(tracks.filter(f => numericSpeed(f.properties.maxspeed) !== null).length);
}
