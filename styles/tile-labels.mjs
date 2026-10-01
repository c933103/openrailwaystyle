import {ByteCache} from './byte-cache.mjs';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import encode from 'vt-pbf';
import {chooseName, mergeStationTranslation, stationLanguages, stationPending, ORM, ownerColor} from './map-model.mjs';
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

export function installLabelProtocols(maplibregl, pmtilesProtocol, fetcher = fetch, {dataRoot, timeout = 12000} = {}) {
  // Only current-view requests are made. Keep a bounded cache of successful
  // responses so language changes can reuse downloaded station tiles.
  const cache = new ByteCache();
  // Downloads still under way, shared by everyone asking for the same URL
  // (neighbouring track-count tiles ask for the same railway tiles at once).
  // Each request has its own 12-second limit; a download is cancelled only
  // when every request waiting on it has been cancelled or run out of time.
  // One running longer than that limit counts as stuck: a new request starts
  // a fresh download rather than join it.
  const loading = new Map();
  function get(url, request, json = false) {
    if (cache.has(url)) {
      return Promise.resolve(cache.get(url));
    }
    let entry = loading.get(url);
    if (!entry || Date.now() - entry.started >= timeout) {
      const controller = new AbortController();
      entry = {controller, waiting: 0, started: Date.now(), promise: (async () => {
        const response = await fetcher(url,{signal:controller.signal});
        if (!response.ok) throw new Error(`Map names returned ${response.status}`);
        const data = json ? await response.json() : await response.arrayBuffer();
        cache.set(url,data);
        return data;
      })()};
      loading.set(url, entry);
      const current = entry;
      entry.promise.then(() => {}, () => {}).then(() => { if (loading.get(url) === current) loading.delete(url); });
    }
    const current = entry, signal = AbortSignal.any([request, AbortSignal.timeout(timeout)]);
    current.waiting++;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        if (--current.waiting === 0) { if (loading.get(url) === current) loading.delete(url); current.controller.abort(signal.reason); }
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) { cancel(); return; }
      signal.addEventListener('abort', cancel, {once: true});
      current.promise.then(data => { signal.removeEventListener('abort', cancel); resolve(data); },
        error => { signal.removeEventListener('abort', cancel); reject(error); });
    });
  }
  // Track counts: a vector source of their own (atlastracks://14/x/y; see
  // track-tiles.mjs), counted in a worker off the page's main thread
  // (track-worker.mjs) from the provider's zoom-14 railway tiles (the ones
  // the map shows at zoom 14) with their neighbours, station areas and
  // stations, all through the shared cache. MapLibre enlarges zoom-14 tiles
  // beyond, so a place has the same count at every zoom.
  let trackWorker, nextJob = 0;
  const trackJobs = new Map(), counted = new Map();
  const orm = path => `${ORM}/${path}`;
  const optional = promise => promise.catch(error => { if (error?.name === 'AbortError') throw error; return null; });
  // Shared by the zoom-13 and zoom-14 tiles that need it, so not cancelled
  // with any one request (get's own timeout still applies).
  const never = new AbortController().signal;
  function countZoom14(x, y) {
    const signal = never, key = `${x}/${y}`;
    if (counted.has(key)) return counted.get(key);
    const job = (async () => {
      const around = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const n = 2 ** 14, tx = (x + dx + n) % n, ty = y + dy;
        if (ty >= 0 && ty < n) around.push(optional(get(orm(`railway_line_high/14/${tx}/${ty}`), signal)).then(data => data && {dx, dy, data}));
      }
      const [tiles, areas, stations] = await Promise.all([Promise.all(around),
        optional(get(orm(`standard_railway_grouped_station_areas/14/${x}/${y}`), signal)), optional(get(orm(`standard_railway_text_stations/14/${x}/${y}`), signal))]);
      if (!tiles.some(t => t && !t.dx && !t.dy)) throw new Error('Railway tile unavailable');
      if (!trackWorker) {
        trackWorker = new Worker(new URL(`track-worker.js${new URL(import.meta.url).search}`, import.meta.url));
        trackWorker.onmessage = ({data:{id,result,error}}) => {
          const done = trackJobs.get(id); trackJobs.delete(id);
          if (done) done(error ? Promise.reject(new Error(error)) : result);
        };
        trackWorker.onerror = event => { for (const done of trackJobs.values()) done(Promise.reject(new Error(event.message || 'Track worker failed'))); trackJobs.clear(); };
      }
      // Copies go to the worker: the cache keeps the originals.
      const copy = list => list.filter(Boolean).map(t => ({...t, data: t.data.slice(0)}));
      const own = data => data && data.slice(0);
      return new Promise(resolve => {
        const id = nextJob++;
        trackJobs.set(id, resolve);
        const message={id,tiles:copy(tiles),areas:own(areas),stations:own(stations),y};
        trackWorker.postMessage(message,[...message.tiles.map(t=>t.data),message.areas,message.stations].filter(Boolean));
      });
    })();
    counted.set(key, job);
    job.catch(() => counted.delete(key));
    while (counted.size > 64) counted.delete(counted.keys().next().value);
    return job;
  }
  maplibregl.addProtocol('atlastracks', async (params, controller) => {
    const coordinates = tileCoordinates(params.url);
    if (!coordinates || typeof Worker === 'undefined') return {data: new ArrayBuffer(0)};
    const {z, x, y} = coordinates, features = [];
    let extent = 4096;
    if (z === 14) {
      const result = await countZoom14(x, y);
      extent = result.extent;
      for (const p of result.points) features.push({x: p.x, y: p.y, p});
    }
    const layers = {atlas_track_counts: {features: features.map(({x: px, y: py, p}) => ({type: 1, geometry: [[Math.round(px), Math.round(py)]], tags: {tracks: p.tracks, ...(p.tunnel && {tunnel: true}), ...(p.station && {station: true})}}))}};
    const out = encode.fromGeojsonVt(layers, {version: 2, extent});
    return {data: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)};
  });
  maplibregl.addProtocol('atlasrail',async (params,controller)=>{
    const url = params.url.replace(/^atlasrail:\/\//,'');
    if (params.type === 'json') {
      const data = await get(url,controller.signal,true);
      return {data:{...data,tiles:data.tiles.map(t=>`atlasrail://${t}`)}};
    }
    // MapLibre transfers this buffer to its worker, detaching it. Keep the
    // cache's original for language changes, return visits and track counts.
    return {data: (await get(url, controller.signal)).slice(0)};
  });
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
  // Owner view: the railway tiles with each line's owner colour added
  // (owner_color, from the name; ownerColor).
  maplibregl.addProtocol('atlasowner',async (params,controller)=>{
    const url = params.url.replace(/^atlasowner:\/\//,'');
    if (params.type === 'json') {
      const data = await get(url,controller.signal,true);
      return {data:{...data,tiles:data.tiles.map(t=>`atlasowner://${t}`)}};
    }
    const data = await get(url, controller.signal);
    if (!data?.byteLength) return {data: new ArrayBuffer(0)};
    const tile = readTile(data);
    for (const f of features(tile)) {
      const color = ownerColor(f.properties.owner);
      if (color) f.properties.owner_color = color;
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
      return {data:primaryData.slice(0)};
    }
  });
}

