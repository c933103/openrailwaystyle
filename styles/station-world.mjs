// Runtime-only installation of a completed Atlas-owned worldwide OSM station
// snapshot. Incomplete or missing acquisition never changes live station layers.
// Source: station-points-data, built by station-overview.mjs and published only
// after an exhaustive geographic checkpoint. No public Overpass/ORM tile fanout.
import {createBundleReader} from './tile-bundles.mjs?v=20261023-polar-paint-2';

export const WORLD_STATION_SOURCE = 'stationWorld';
export const WORLD_STATION_DOTS = 'station-world-dots';
export const WORLD_STATION_PROTOCOL = 'stationworldtiles';
export const WORLD_STATION_SUPERSEDED_DOTS = Object.freeze([
  'station-major-dots', 'station-stationLow-dots', 'station-stationMed-dots',
  'station-provider-dots', 'station-curated-fallback-dots',
  'station-basemap-fallback-dots',
]);
const ATTRIBUTION = '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors, ODbL</a>';
const TILE_KEY = /^(3|4|5|6|7)\/(\d{1,3})\/(\d{1,3})$/;
const manifestValid = m => m && m.complete === true && m.schema === 1 &&
  m.license === 'ODbL-1.0' && m.minzoom === 3 && m.maxzoom === 7 &&
  m.polar === 0 && m.pendingRegions === 0 &&
  Number.isSafeInteger(m.completedRegions) && m.completedRegions >= 32 &&
  Number.isSafeInteger(m.stations) && m.stations > 0 &&
  Number.isSafeInteger(m.tiles) && m.tiles > 0 &&
  Number.isSafeInteger(m.bundles) && m.bundles > 0 && m.bundles <= 64;
const indexValid = (i, m) => i && i.zoom === 3 && Array.isArray(i.bundles) &&
  i.bundles.length === m.bundles &&
  new Set(i.bundles).size === i.bundles.length &&
  i.bundles.every(key => {
    if (!/^[0-7]\/[0-7]$/.test(key)) return false;
    const [x,y] = key.split('/').map(Number);
    return x >= 0 && x < 8 && y >= 0 && y < 8;
  });

export function validWorldStationSnapshot(manifest, index) {
  return Boolean(manifestValid(manifest) && indexValid(index, manifest));
}
export function worldStationLayer() {
  return {
    id: WORLD_STATION_DOTS, type: 'circle', source: WORLD_STATION_SOURCE,
    'source-layer': 'atlas_station_points', minzoom: 3, maxzoom: 12,
    filter: ['all', ['==',['get','state'],'present'],
      ['match',['get','feature'],['station','halt','tram_stop'],true,false]],
    layout: {'circle-sort-key':['match',['get','feature'],'station',2,'halt',1,0],
      'visibility':'none'},
    paint: {
      'circle-color':'#ffa323','circle-stroke-color':'#123e52',
      'circle-stroke-width':['interpolate',['linear'],['zoom'],3,0.55,7,1.05,12,1.45],
      'circle-radius':['interpolate',['linear'],['zoom'],3,1.1,5,1.45,7,2.2,12,3.4],
    },
    metadata:{
      'atlas:semantics-version':1, 'atlas:group':'stations',
      'atlas:category':'current', 'atlas:views':[], 'atlas:settings':['stations'],
      'atlas:initial-hidden':false, 'atlas:base-map':false,'atlas:terrain':false,
      'atlas:runtime':false, 'atlas:background':null,'atlas:hide-backgrounds':[],
      'atlas:localize':false,
    },
  };
}
function snapshotSource() {
  return {
    type:'vector', tiles:[WORLD_STATION_PROTOCOL+'://{z}/{x}/{y}'],
    minzoom:3,maxzoom:7,promoteId:'id',attribution:ATTRIBUTION,
  };
}
function validKey(value) {
  const match=TILE_KEY.exec(value);
  if(!match)return false;
  const z=Number(match[1]),x=Number(match[2]),y=Number(match[3]);
  return x < 2 ** z && y < 2 ** z;
}

// The index is small (at most 64 z3 bundles). Fetch it and the manifest before
// ever registering a new source, so old deployments or partial maintenance
// runs do not send any vector tile requests. A snapshot failure is optional,
// not an excuse to hide the curated/ORM/basemap fallback dots.
export async function prepareWorldStationOverlay({
  root,fetcher=fetch,logger=console,signal,
}={}) {
  if (!(root instanceof URL) || root.protocol !== 'https:' && root.protocol !== 'http:')
    throw new Error('World station root must be a local absolute HTTP(S) URL');
  const json = async name => {
    const response=await fetcher(new URL(name,root),{signal,redirect:'error'});
    if(!response.ok)return null;
    // First-party generated assets only; keep the metadata bounded.
    const declared=Number(response.headers?.get?.('content-length'));
    if(Number.isFinite(declared)&&declared>65536)throw new Error('Station metadata oversized');
    const value=await response.text();
    if(value.length>65536)throw new Error('Station metadata oversized');
    return JSON.parse(value);
  };
  let manifest,index;
  try {
    manifest=await json('manifest.json');
    if(!manifestValid(manifest))return null;
    index=await json('index.json');
    if(!validWorldStationSnapshot(manifest,index)) {
      logger.warn?.('Station snapshot has no valid complete tile index; retaining existing markers');
      return null;
    }
  } catch(error) {
    if(error?.name!=='AbortError')logger.warn?.('Worldwide station snapshot not usable:',error.message);
    return null;
  }
  const reader=createBundleReader({root,fetcher,keep:16});
  return {
    manifest,
    // Only the station snapshots that passed the complete index check can
    // register a protocol. Never translate a network error into fake data.
    register(maplibregl) {
      maplibregl.addProtocol(WORLD_STATION_PROTOCOL, async(params,controller)=>{
        const key=String(params.url).slice((WORLD_STATION_PROTOCOL+'://').length);
        if(!validKey(key))throw new Error('Invalid station-world tile coordinate');
        const [z,x,y]=key.split('/').map(Number);
        const bytes=await reader.tile(z,x,y,controller?.signal);
        return {data:bytes || new ArrayBuffer(0)};
      });
    },
    install(map) {
      // A serialized language reload can retain both runtime objects; a fresh
      // style has neither. Reuse the verified protocol/cache in either case.
      if(map.getSource(WORLD_STATION_SOURCE)&&map.getLayer(WORLD_STATION_DOTS))return true;
      // Original visible place labels still paint over the dots, but crossing
      // markers appear beneath them. This intentionally matches PR #202.
      if(!map.getLayer('place_label_city') || !map.getLayer('infrastructure-crossing-overview'))
        throw new Error('Required station/crossing ordering anchors absent');
      if(!map.getSource(WORLD_STATION_SOURCE))map.addSource(WORLD_STATION_SOURCE,snapshotSource());
      map.addLayer(worldStationLayer(),'place_label_city');
      return true;
    },
  };
}

// Preparation belongs to the map session, installation to each loaded style.
// In-flight preparation must never add layers to a superseded/loading style.
export function installWorldStationLifecycle({map,maplibregl,onChange=()=>{},logger=console,...options}) {
  let task,active=false,disabled=false,removed=false,styleReady=false,revision=0;
  const change=(value,force=false)=>{if(force||active!==value){active=value;onChange(value,styleReady);}};
  const loading=()=>{styleReady=false;revision++;change(false);};
  const loaded=async()=>{
    const current=++revision;
    styleReady=true;change(false,true);
    if(disabled||removed)return;
    task ||= prepareWorldStationOverlay({...options,logger}).then(overlay=>{
      if(overlay&&!removed)overlay.register(maplibregl);
      return overlay;
    });
    try {
      const overlay=await task;
      if(!overlay||disabled||removed||current!==revision)return;
      overlay.install(map);
      change(true);
    } catch(error) {
      logger.warn?.('World station snapshot not activated:',error.message);
    }
  };
  const remove=()=>{removed=true;revision++;};
  map.on('styledataloading',loading);
  map.on('style.load',loaded);
  map.on('remove',remove);
  return {disable(){disabled=true;revision++;change(false);}};
}
