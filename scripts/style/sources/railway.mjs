import {ORM} from '../../../styles/map-model.mjs';

export const RAIL_ATTRIBUTION = '<a href="https://www.openrailwaymap.app/">OpenRailwayMap</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>';

// Logical datasets are shared by several MapLibre sources. The adapter
// chooses the protocol at runtime; separate source IDs retain view-specific
// loading and the existing shared byte-cache behavior.
export const RAIL_DATASETS = Object.freeze({
  standardOverview: {endpoint:'standard_railway_line_low', minzoom:0, maxzoom:6},
  speedOverview: {endpoint:'speed_railway_line_low', minzoom:0, maxzoom:6},
  electricOverview: {endpoint:'electrification_railway_line_low', minzoom:0, maxzoom:6},
  controlOverview: {endpoint:'signals_railway_line_low', minzoom:0, maxzoom:6},
  gaugeOverview: {endpoint:'track_railway_line_low', minzoom:0, maxzoom:6},
  operatorOverview: {endpoint:'operator_railway_line_low', minzoom:0, maxzoom:6},
  detail: {endpoint:'railway_line_high', minzoom:7, maxzoom:16},
});

export const RAIL_SOURCE_VARIANTS = Object.freeze({
  network: {dataset:'standardOverview', transform:null},
  speed: {dataset:'speedOverview', transform:null},
  electric: {dataset:'electricOverview', transform:null},
  control: {dataset:'controlOverview', transform:null},
  gaugeLow: {dataset:'gaugeOverview', transform:null},
  loadingLow: {dataset:'standardOverview', transform:'loading-gauge'},
  ownerLow: {dataset:'operatorOverview', transform:'owner'},
  ownerRail: {dataset:'detail', transform:'owner'},
  axleLow: {dataset:'standardOverview', transform:'axle'},
  axleRail: {dataset:'detail', transform:'axle'},
  railway: {dataset:'detail', transform:null},
});

export const railwayVector = (path, minzoom, maxzoom) => ({
  type:'vector', url:`${ORM}/${path}`, minzoom, maxzoom, promoteId:'id',
  attribution:RAIL_ATTRIBUTION,
});

export function railwaySources() {
  const sources = Object.fromEntries(Object.entries(RAIL_SOURCE_VARIANTS).map(([id, variant]) => {
    const {endpoint, minzoom, maxzoom} = RAIL_DATASETS[variant.dataset];
    return [id, railwayVector(endpoint, minzoom, maxzoom)];
  }));
  return {
    ...sources,
    // Track counts always derive from z14 tiles to remain stable at any zoom.
    trackCounts: {type:'vector', tiles:['atlastracks://{z}/{x}/{y}'], minzoom:14, maxzoom:14, attribution:RAIL_ATTRIBUTION},
    platforms: railwayVector('standard_railway_platforms', 17, 22),
    platformEdges: railwayVector('standard_railway_platform_edges', 17, 22),
    railwaySignals: railwayVector('railway_signals', 16, 22),
    stationEntrances: railwayVector('standard_station_entrances', 16, 22),
    stationLow: railwayVector('standard_railway_text_stations_low', 4, 6),
    // This fragment tells the adapter to derive z6 from four z7 children;
    // the fragment itself is never sent to the provider.
    stationMed: {...railwayVector('standard_railway_text_stations_med', 6, 7), url:`${ORM}/standard_railway_text_stations_med#minzoom=6&maxzoom=7&underzoom=7`},
    stations: railwayVector('standard_railway_text_stations', 8, 16),
    crossings: railwayVector('points_of_interest', 15, 18),
  };
}
