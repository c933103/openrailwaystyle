import {OVERVIEW_ZOOM, DETAIL_ZOOM} from '../../crossing-data.mjs';
import {SIGNAL_OVERVIEW_ZOOM, SIGNAL_ZOOM} from '../../signals-data.mjs';
import {HERITAGE_MIN_ZOOM, HERITAGE_MAX_ZOOM} from '../../heritage-data.mjs';

const ATTRIBUTION = '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors, ODbL</a>';
const snapshot = (protocol, minzoom, maxzoom, extra = {}) => ({
  type:'vector', tiles:[`${protocol}://{z}/{x}/{y}`], minzoom, maxzoom, ...extra, attribution:ATTRIBUTION,
});

export function atlasSources(majorStationData) {
  return {
    electricFacilities: {type:'geojson',data:{type:'FeatureCollection',features:[]},attribution:'<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>'},
    axleBranch: snapshot('axlebranch', 4, 9),
    // Kept inline for existing installed workers. The application defers
    // this GeoJSON source until the overview needs it.
    stationMajor: {type:'geojson', data:structuredClone(majorStationData),
      attribution:'<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a> · <a href="https://www.wikidata.org/">Wikidata, CC0</a>'},
    platformLengths: {type:'geojson', data:{type:'FeatureCollection', features:[]}},
    platformNumbers: {type:'geojson', data:{type:'FeatureCollection', features:[]}},
    railwaySignalSupplementOverview: snapshot('signaltiles', SIGNAL_OVERVIEW_ZOOM, SIGNAL_OVERVIEW_ZOOM, {promoteId:'id'}),
    railwaySignalSupplement: snapshot('signaltiles', SIGNAL_ZOOM, SIGNAL_ZOOM, {promoteId:'id'}),
    inactiveRegional: snapshot('railtiles', 0, 10, {promoteId:'osm_id'}),
    crossingsOverview: snapshot('crossingtiles', OVERVIEW_ZOOM, OVERVIEW_ZOOM),
    crossingsDetail: snapshot('crossingtiles', DETAIL_ZOOM, DETAIL_ZOOM),
    // The provider's low-zoom mainline data omits these operating branches.
    branchLines: snapshot('branchtiles', 4, 9),
    serviceRoutes: {...snapshot('servicetiles', 7, 12), attribution:ATTRIBUTION+' · <a href="frequency-credits.html">Frequency sources</a>'},
    streetRunning: snapshot('streettiles', 12, 12),
    // Historic areas the basemap's park layer does not hold (heritage-data.mjs).
    heritageAreas: snapshot('heritagetiles', HERITAGE_MIN_ZOOM, HERITAGE_MAX_ZOOM),
  };
}
