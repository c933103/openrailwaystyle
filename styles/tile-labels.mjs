import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import encode from 'vt-pbf';
import {chooseName, mergeStationTranslation, stationLanguages, stationPending} from './map-model.mjs';
import {hanRegion, chineseArea} from './han-region.mjs';
import {decodeLoadingGauges, wayId} from './loading-gauge-list.mjs';
export {hanRegion, chineseArea};

export function readTile(data) {
  const tile = new VectorTile(new Pbf(new Uint8Array(data)));
  // vector-tile creates a new object on each feature() call. Retain mutations
  // and the original integer geometry/extent rather than round-tripping GeoJSON.
  for (const layer of Object.values(tile.layers)) {
    const features = Array.from({length:layer.length},(_,i)=>layer.feature(i));
    layer.feature = i => features[i];
  }
  return tile;
}
const features = tile => Object.values(tile.layers).flatMap(layer=>Array.from({length:layer.length},(_,i)=>layer.feature(i)));
export const tileCoordinates = url => {
  const match = /\/(\d+)\/(\d+)\/(\d+)(?:\.[a-z.]+)?(?:[?#].*)?$/i.exec(url || '');
  return match && {z:+match[1],x:+match[2],y:+match[3]};
};
// Han-name region and Chinese naming area (mainland China, Taiwan, Hong Kong
// or Macau) of a point, as label properties. The region decides; the area
// only distinguishes places within it.
export function locate(lon, lat) {
  const atlas_han = hanRegion(lon, lat);
  return {atlas_han, atlas_zh: atlas_han === 'cjkv' ? chineseArea(lon, lat) : ''};
}
// Record the Han-name region at each feature's centre. Every tile URL used
// by the map ends in z/x/y, so every labelled feature has a location.
export function locateFeatures(tile, coordinates) {
  if (!coordinates) throw new Error('Label tile has no z/x/y coordinates');
  const {z,x,y} = coordinates, n = 2 ** z;
  for (const f of features(tile)) {
    const [w,s,e,north] = f.bbox();
    const tx = x + (w+e)/2/f.extent, ty = y + (s+north)/2/f.extent;
    Object.assign(f.properties, locate(tx/n*360-180, Math.atan(Math.sinh(Math.PI*(1-2*ty/n)))*180/Math.PI));
  }
}
export function writeLabels(tile, lang) {
  for (const f of features(tile)) {
    f.properties.atlas_name = chooseName(f.properties,lang);
    f.properties.atlas_language = lang;
  }
  const result = encode(tile);
  return result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength);
}
export function localizeTile(data, lang, coordinates) {
  if (!data?.byteLength) return data;
  try {
    const tile = readTile(data);
    locateFeatures(tile,coordinates);
    return writeLabels(tile,lang);
  } catch (error) {
    // A labelling failure must not hide map data; styles fall back to the
    // names recorded in the tile.
    console.error('Map labels unavailable:', error?.message || String(error));
    return data;
  }
}

export function installLabelProtocols(maplibregl, pmtilesProtocol, fetcher = fetch, {dataRoot} = {}) {
  // Only current-view requests are made. Keep a bounded cache of successful
  // responses so language changes can reuse downloaded station tiles.
  const cache = new Map();
  async function get(url, signal, json = false) {
    if (cache.has(url)) {
      const data = cache.get(url); cache.delete(url); cache.set(url,data); return data;
    }
    const response = await fetcher(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
    if (!response.ok) throw new Error(`Map names returned ${response.status}`);
    const data = json ? await response.json() : await response.arrayBuffer();
    cache.set(url,data);
    while(cache.size>160) cache.delete(cache.keys().next().value);
    return data;
  }
  // Railway tiles: tracks side by side are counted from zoom 13 in a worker,
  // off the page's main thread (track-worker.mjs). Other zooms pass through.
  let trackWorker, nextJob = 0;
  const trackJobs = new Map();
  function countTracks(data, z, y, stations = []) {
    if (z < 13 || !data?.byteLength || typeof Worker === 'undefined') return data;
    if (!trackWorker) {
      trackWorker = new Worker(new URL(`track-worker.js${new URL(import.meta.url).search}`, import.meta.url));
      trackWorker.onmessage = ({data:{id,data:result,error}}) => {
        const job = trackJobs.get(id); trackJobs.delete(id);
        if (!job) return;
        if (error) { console.warn('Track counts unavailable:', error); job(job.data); } else job(result);
      };
      trackWorker.onerror = () => { for (const job of trackJobs.values()) job(job.data); trackJobs.clear(); };
    }
    return new Promise(resolve => {
      const id = nextJob++, copy = data.slice(0);
      resolve.data = data; trackJobs.set(id, resolve);
      trackWorker.postMessage({id, data:copy, z, y, stations}, [copy]);
    });
  }
  maplibregl.addProtocol('atlasrail',async (params,controller)=>{
    const url = params.url.replace(/^atlasrail:\/\//,'');
    if (params.type === 'json') {
      const data = await get(url,controller.signal,true);
      // The track-count label points are a layer of their own; declared so
      // MapLibre accepts style layers that use it.
      const vectorLayers = Array.isArray(data.vector_layers) ? [...data.vector_layers.filter(l => l.id !== 'atlas_track_counts'), {id:'atlas_track_counts', fields:{tracks:'Number'}, minzoom:13}] : data.vector_layers;
      return {data:{...data,tiles:data.tiles.map(t=>`atlasrail://${t}`),...(vectorLayers && {vector_layers:vectorLayers})}};
    }
    const response = await fetcher(url,{signal:controller.signal});
    if (!response.ok && response.status !== 204) throw new Error(`Railway tile returned ${response.status}`);
    const data = await response.arrayBuffer(), coordinates = tileCoordinates(url);
    if (!coordinates) return {data};
    const stations = coordinates.z >= 13 ? await trackStations(url, coordinates, controller.signal) : [];
    return {data: await countTracks(data, coordinates.z, coordinates.y, stations)};
  });
  // Stations near a railway tile, for leaving track counts out of stations:
  // from the provider's station tile one zoom up (shared by four railway
  // tiles, and kept in the cache), as fractions of the railway tile, with a
  // radius by station size. Without them, counts are still given.
  const STATION_RADIUS = {large: 400, normal: 250};
  async function trackStations(url, {z, x, y}, signal) {
    const address = url.replace(/\/railway_line_high\/\d+\/\d+\/\d+/, `/standard_railway_text_stations/${z - 1}/${x >> 1}/${y >> 1}`);
    if (address === url) return [];
    try {
      const tile = readTile(await get(address, signal)), stations = [];
      for (const layer of Object.values(tile.layers)) for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i), p = f.properties;
        if (f.type !== 1 || p.state && p.state !== 'present' || /tram/.test(`${p.feature} ${p.station}`)) continue;
        for (const ring of f.loadGeometry()) for (const q of ring) stations.push({
          x: ((x >> 1) + q.x / layer.extent) * 2 - x, y: ((y >> 1) + q.y / layer.extent) * 2 - y,
          radius: STATION_RADIUS[p.station_size] || 150,
        });
      }
      return stations;
    } catch (error) {
      if (signal?.aborted) throw error;
      return [];
    }
  }
  // Overview tiles (zoom 0–6) carry way IDs but no loading gauge: add it
  // from the published way ID list (data/loading-gauge.json, about 250 kB
  // compressed, fetched once and only for this view). Without the list the
  // tiles pass through and lines show as not recorded.
  let loadingGauges;
  function loadingGaugeList() {
    loadingGauges ||= (dataRoot ? fetcher(new URL('loading-gauge.json', dataRoot)) : Promise.reject(new Error('no data location')))
      .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then(decodeLoadingGauges)
      .catch(error => { console.warn('Loading gauge list unavailable:', error.message); loadingGauges = undefined; return new Map(); });
    return loadingGauges;
  }
  maplibregl.addProtocol('atlaslg',async (params,controller)=>{
    const url = params.url.replace(/^atlaslg:\/\//,'');
    if (params.type === 'json') {
      const data = await get(url,controller.signal,true);
      return {data:{...data,tiles:data.tiles.map(t=>`atlaslg://${t}`)}};
    }
    const [response, list] = await Promise.all([fetcher(url,{signal:controller.signal}), loadingGaugeList()]);
    if (!response.ok && response.status !== 204) throw new Error(`Railway tile returned ${response.status}`);
    const data = await response.arrayBuffer();
    if (!data.byteLength || !list.size) return {data};
    const tile = readTile(data);
    for (const f of features(tile)) {
      const value = list.get(wayId(f.properties.id));
      if (value) f.properties.loading_gauge = value;
    }
    const result = encode(tile);
    return {data: result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength)};
  });
  maplibregl.addProtocol('atlasbase',async (params,controller)=>{
    const [,lang,url] = /^atlasbase:\/\/([^/]+)\/(.+)$/.exec(params.url) || [];
    if (!url) throw new Error('Invalid basemap request');
    const result = await pmtilesProtocol.tile({...params,url:`pmtiles://${url}`},controller);
    if (params.type === 'json') return {...result,data:{...result.data,tiles:result.data.tiles.map(t=>t.replace('pmtiles://',`atlasbase://${lang}/`))}};
    return {...result,data:localizeTile(result.data,lang,tileCoordinates(url))};
  });
  // A tile below the provider's first zoom, made from its children at that
  // zoom: points only (station tiles), duplicates across child buffers
  // dropped by id.
  async function childTiles(requestURL, target, signal) {
    const match = /\/(\d+)\/(\d+)\/(\d+)(\.[a-z.]+)?$/i.exec(requestURL.pathname);
    const [z, x, y] = match.slice(1, 4).map(Number), n = 2 ** (target - z);
    const layers = {}, seen = new Set();
    for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) {
      const child = new URL(requestURL);
      child.pathname = requestURL.pathname.slice(0, match.index) + `/${target}/${x*n+dx}/${y*n+dy}${match[4] || ''}`;
      const tile = readTile(await get(child.href, signal));
      for (const [name, layer] of Object.entries(tile.layers)) {
        const out = layers[name] ||= {features: []};
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i), key = `${name}:${f.properties.id ?? f.id}`;
          if (f.type !== 1 || seen.has(key)) continue;
          const scale = 4096 / f.extent;
          const geometry = f.loadGeometry().flat().map(p => [Math.round((dx*f.extent + p.x)*scale/n), Math.round((dy*f.extent + p.y)*scale/n)])
            .filter(([px, py]) => px >= 0 && px < 4096 && py >= 0 && py < 4096);
          if (!geometry.length) continue;
          seen.add(key);
          out.features.push({type:1, id:f.id, tags:f.properties, geometry});
        }
      }
    }
    const result = encode.fromGeojsonVt(layers, {version:2, extent:4096});
    return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
  }
  maplibregl.addProtocol('atlasstation',async (params,controller)=>{
    let [,lang,url] = /^atlasstation:\/\/([^/]+)\/(.+)$/.exec(params.url) || [];
    if (!url) throw new Error('Invalid station request');
    const signal = controller.signal;
    if (params.type === 'json') {
      // A fragment on the source URL (never requested) can override the
      // provider's zoom range. underzoom=N builds tiles below zoom N from
      // their zoom-N children, for providers that return nothing there.
      const [address, fragment = ''] = url.split('#');
      const data = await get(address,signal,true), options = new URLSearchParams(fragment);
      const zoom = key => { const value = Number(options.get(key)); return Number.isInteger(value) && value >= 0 ? {[key]:value} : {}; };
      const underzoom = zoom('underzoom').underzoom;
      return {data:{...data,...zoom('minzoom'),...zoom('maxzoom'),tiles:data.tiles.map(t=>`atlasstation://${lang}/${t}${underzoom ? `#underzoom=${underzoom}` : ''}`)}};
    }
    const [address, fragment = ''] = url.split('#');
    const coordinates = tileCoordinates(address), target = Number(new URLSearchParams(fragment).get('underzoom'));
    const underzoom = coordinates && Number.isInteger(target) && target > coordinates.z ? target : 0;
    url = address;
    const candidates = stationLanguages(lang), fetched = new Set();
    let primary, primaryData;
    for (;;) {
      // Fetch the first listed language some station could still use.
      const wanted = primary && new Set(features(primary).flatMap(f=>stationPending(f.properties,lang,fetched)));
      const candidate = primary ? candidates.find(c=>!fetched.has(c) && wanted.has(c)) : candidates[0];
      if (!candidate) break;
      fetched.add(candidate);
      signal.throwIfAborted();
      const requestURL = new URL(url);
      if(candidate === 'local') requestURL.searchParams.delete('lang');
      else requestURL.searchParams.set('lang',candidate);
      let translated, data;
      try { data=await (underzoom ? childTiles(requestURL, underzoom, signal) : get(requestURL.href,signal)); translated=readTile(data); }
      catch(error) {
        if(!primary || signal.aborted) throw error;
        // One unavailable translation must not hide an otherwise loaded station.
        console.warn('Station translation unavailable',candidate,error.message);
        continue;
      }
      if (!primary) {
        primary=translated; primaryData=data;
        try { locateFeatures(primary,tileCoordinates(url)); }
        catch (error) { console.error('Station labels unavailable:', error?.message || String(error)); }
      }
      const byId=new Map(features(translated).map(f=>[String(f.properties.id ?? f.id),f.properties]));
      for(const f of features(primary)) mergeStationTranslation(f.properties,byId.get(String(f.properties.id ?? f.id)),candidate);
    }
    try { return {data:writeLabels(primary,lang)}; }
    catch (error) {
      console.error('Station labels unavailable:', error?.message || String(error));
      return {data:primaryData};
    }
  });
}
