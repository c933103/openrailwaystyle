import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import encode from 'vt-pbf';
import {chooseName, mergeStationTranslation, stationLanguages, stationPending} from './map-model.mjs';
import {hanRegion, chineseArea} from './han-region.mjs';
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

export function installLabelProtocols(maplibregl, pmtilesProtocol, fetcher = fetch) {
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
  maplibregl.addProtocol('atlasbase',async (params,controller)=>{
    const [,lang,url] = /^atlasbase:\/\/([^/]+)\/(.+)$/.exec(params.url) || [];
    if (!url) throw new Error('Invalid basemap request');
    const result = await pmtilesProtocol.tile({...params,url:`pmtiles://${url}`},controller);
    if (params.type === 'json') return {...result,data:{...result.data,tiles:result.data.tiles.map(t=>t.replace('pmtiles://',`atlasbase://${lang}/`))}};
    return {...result,data:localizeTile(result.data,lang,tileCoordinates(url))};
  });
  maplibregl.addProtocol('atlasstation',async (params,controller)=>{
    const [,lang,url] = /^atlasstation:\/\/([^/]+)\/(.+)$/.exec(params.url) || [];
    if (!url) throw new Error('Invalid station request');
    const signal = controller.signal;
    if (params.type === 'json') {
      const data = await get(url,signal,true);
      return {data:{...data,tiles:data.tiles.map(t=>`atlasstation://${lang}/${t}`)}};
    }
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
      try { data=await get(requestURL.href,signal); translated=readTile(data); }
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
