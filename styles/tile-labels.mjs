import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import encode from 'vt-pbf';
import {chooseName, mergeStationTranslation, stationLanguages, stationNameResolved} from './map-model.mjs';

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
export function writeLabels(tile, lang) {
  for (const f of features(tile)) {
    f.properties.atlas_name = chooseName(f.properties,lang);
    f.properties.atlas_language = lang;
  }
  const result = encode(tile);
  return result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength);
}
export function localizeTile(data, lang) {
  if (!data?.byteLength) return data;
  return writeLabels(readTile(data),lang);
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
    return {...result,data:localizeTile(result.data,lang)};
  });
  maplibregl.addProtocol('atlasstation',async (params,controller)=>{
    const [,lang,url] = /^atlasstation:\/\/([^/]+)\/(.+)$/.exec(params.url) || [];
    if (!url) throw new Error('Invalid station request');
    const signal = controller.signal;
    if (params.type === 'json') {
      const data = await get(url,signal,true);
      return {data:{...data,tiles:data.tiles.map(t=>`atlasstation://${lang}/${t}`)}};
    }
    let primary;
    for (const candidate of stationLanguages(lang)) {
      signal.throwIfAborted();
      const requestURL = new URL(url);
      if(candidate === 'local') requestURL.searchParams.delete('lang');
      else requestURL.searchParams.set('lang',candidate);
      let translated;
      try { translated=readTile(await get(requestURL.href,signal)); }
      catch(error) {
        if(!primary || signal.aborted) throw error;
        // One unavailable translation must not hide an otherwise loaded station.
        console.warn('Station translation unavailable',candidate,error.message);
        continue;
      }
      if (!primary) primary=translated;
      const byId=new Map(features(translated).map(f=>[String(f.properties.id ?? f.id),f.properties]));
      for(const f of features(primary)) mergeStationTranslation(f.properties,byId.get(String(f.properties.id ?? f.id)),candidate);
      if(features(primary).every(f=>stationNameResolved(f.properties,lang))) break;
    }
    return {data:writeLabels(primary,lang)};
  });
}
