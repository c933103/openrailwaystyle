// Satellite/Hybrid imagery: Sentinel-2 cloudless (EOX, free) wherever it has
// native detail, and Esri World Imagery, when the deployment configures an
// ArcGIS Location Platform key, only where EOX cannot cover: finer than EOX's
// 10 m (z14 at the equator) and outside Sentinel-2's acquisition band. EOX
// remains the fallback for any tile Esri cannot serve. A quota or
// authorization failure (the free tier ends with the service privilege
// removed) switches the whole device to EOX for a while instead of
// re-requesting every tile from Esri.
export const EOX_TILES = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg';
export const EOX_MAX_ZOOM = 14;
// NASA's WMTS capabilities advertise Blue Marble on a 256px z0–8 grid.
// This is a historical composite, not current or high-resolution imagery.
export const GIBS_MAX_ZOOM = 8;
export const GIBS_TILES = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
export const GIBS_ATTRIBUTION = '<a href="https://nasa-gibs.github.io/gibs-api-docs/">NASA EOSDIS GIBS</a> / NASA Earth Observatory Blue Marble';
export const ESRI_TILES = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_MAX_ZOOM = 18;
export const IMAGERY_MAX_ZOOM = 19;
export const REGIONAL_ATTRIBUTION = 'USDA, <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>; © <a href="https://www.swisstopo.admin.ch/">swisstopo</a>; © <a href="https://www.ign.fr/">IGN</a>';
const REGIONAL = [
  {id:'CHE', bounds:[5.95,45.81,10.5,47.81], url:'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg'},
  {id:'FRA', bounds:[-5.5,41.3,9.6,51.1], url:'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM_0_19&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'},
  {id:'USA', bounds:[-125,24,-66,50], url:'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'},
];
function insideRing([x,y],ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function interior(point,polygons) {
  return polygons.some(rings=>{
    if(!insideRing(point,rings[0]) || rings.slice(1).some(r=>insideRing(point,r)))return false;
    for(const ring of rings)for(let i=1;i<ring.length;i++) {
      const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dy=b[1]-a[1];
      const t=dx||dy?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy))):0;
      if(Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy)<0.03)return false;
    }
    return true;
  });
}
// Conservative country interiors prevent rectangular bounds selecting neighboring
// countries. This is a request guard, not proof of tile-level imagery completeness.
let regionData;
export async function regionalImagery(z,x,y) {
  if(z<15 || z>IMAGERY_MAX_ZOOM)return null;
  const {IMAGERY_REGIONS}=await (regionData ||= import('./imagery-regions.mjs?v=20261127-flat-reference-order-1'));
  const w=x/2**z*360-180,e=(x+1)/2**z*360-180,n=tileLatitude(z,y),s=tileLatitude(z,y+1);
  for(const provider of REGIONAL) {
    const [west,south,east,north]=provider.bounds;
    if(w<west || e>east || s<south || n>north)continue;
    if([[w,n],[e,n],[e,s],[w,s]].every(p=>interior(p,IMAGERY_REGIONS[provider.id])))return provider;
  }
  return null;
}
// Sentinel-2 systematically acquires land between 56° S and 84° N (ESA mission
// requirements); EOX documents no coverage of the poles.
export const EOX_SOUTH = -56, EOX_NORTH = 84;
export const ESRI_ATTRIBUTION = 'Powered by <a href="https://www.esri.com/">Esri</a> | Esri, Vantor, Earthstar Geographics, and the GIS User Community';
export const PROVIDER_ATTRIBUTION = {ESRI:ESRI_ATTRIBUTION,GIBS:GIBS_ATTRIBUTION,
  CHE:'© <a href="https://www.swisstopo.admin.ch/">swisstopo</a>',
  FRA:'© <a href="https://www.ign.fr/">IGN</a>',
  USA:'USDA, <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>'};
export const ESRI_OFF_KEY = 'atlas-imagery-esri-off-until';
export const ESRI_OFF_MS = 6 * 60 * 60 * 1000;
const AUTH_STATUS = new Set([401, 403, 498, 499]);

// Whether EOX has native detail somewhere in a tile: the tile reaches the
// acquisition band, and at its edge nearest the equator it is no finer on the
// ground than EOX's z14 at the equator. Web Mercator tiles grow finer towards
// the poles, so the zoom at which EOX runs out falls with latitude (z13 from
// 60°, z12 from 75.5°).
const tileLatitude = (z, y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;
export function eoxCovers(z, y) {
  const north = tileLatitude(z, y), south = tileLatitude(z, y + 1);
  if (south > EOX_NORTH || north < EOX_SOUTH) return false;
  const nearest = south <= 0 && north >= 0 ? 0 : Math.min(Math.abs(south), Math.abs(north));
  return z <= EOX_MAX_ZOOM + Math.log2(Math.cos(nearest * Math.PI / 180));
}

const fill = (template, z, x, y) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
const imageType = response => /^image\//i.test(response.headers?.get?.('content-type') || '');

// Reads the deployment's imagery & admin configuration; any failure means EOX only.
export async function loadImageryConfig(url, {fetcher = fetch, timeout = 3000} = {}) {
  try {
    const response = await fetcher(url, {cache: 'no-store', signal: AbortSignal.timeout(timeout)});
    if (!response.ok) return {};
    const config = await response.json();
    if (!config || typeof config !== 'object') return {};
    const out = {};
    if (typeof config.esriKey === 'string' && /^[A-Za-z0-9._-]{20,}$/.test(config.esriKey)) {
      out.esriKey = config.esriKey;
    }
    if (typeof config.googleMapsKey === 'string' && /^[A-Za-z0-9._-]{20,}$/.test(config.googleMapsKey)) {
      out.googleMapsKey = config.googleMapsKey;
    }
    if (typeof config.githubClientId === 'string' && /^[A-Za-z0-9._-]{10,}$/.test(config.githubClientId)) {
      out.githubClientId = config.githubClientId;
    }
    if (typeof config.adminRepo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.adminRepo)) {
      out.adminRepo = config.adminRepo;
    }
    if (typeof config.authBackendOrigin === 'string' && config.authBackendOrigin) {
      try {
        const parsed = new URL(config.authBackendOrigin);
        if (parsed.protocol === 'https:' && parsed.pathname === '/' && !parsed.search && !parsed.hash) {
          out.authBackendOrigin = parsed.origin;
        }
      } catch {}
    }
    return out;
  } catch { return {}; }
}

// Keyless GIBS fills the southern acquisition gap; a configured key also
// enables Esri's higher-resolution imagery.
export function applyImageryConfig(source, {esriKey} = {}) {
  source.tiles = ['atlasimagery://{z}/{x}/{y}'];
  source.maxzoom = IMAGERY_MAX_ZOOM;
  source.attribution = `${esriKey ? ESRI_ATTRIBUTION + '; ' : ''}${GIBS_ATTRIBUTION}; ${REGIONAL_ATTRIBUTION}; ${source.attribution}`;
  return source;
}

// Cancel one tile's wait without aborting an ancestor used by other tiles.
function waitForSignal(promise, signal) {
  if(!signal)return promise;
  if(signal.aborted)return Promise.reject(signal.reason || new DOMException('Aborted','AbortError'));
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason || new DOMException('Aborted','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}

export function createImageryProtocol({esriKey = '', fetcher = fetch, storage, now = Date.now, monotonic = () => performance.now(), timeoutSignal = () => AbortSignal.timeout(15000), resample = resampleTile} = {}) {
  // Reading localStorage itself throws when the browser denies storage.
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  const read = () => { try { return Number(storage?.getItem(ESRI_OFF_KEY)) || 0; } catch { return 0; } };
  let offUntil = read();
  const esriActive = () => Boolean(esriKey) && now() >= Math.max(offUntil, read());
  const disableEsri = () => {
    offUntil = now() + ESRI_OFF_MS;
    try { storage?.setItem(ESRI_OFF_KEY, String(offUntil)); } catch { /* private mode: this session only */ }
  };
  const providers = new Map();
  const delivered = (url,provider,data,signal) => {
    signal?.throwIfAborted();providers.delete(url);providers.set(url,provider);
    while(providers.size>4096)providers.delete(providers.keys().next().value);
    return {data};
  };
  const ancestors = new Map();
  const bytes = async (url, signal) => {
    const response = await fetcher(url, {signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  };
  // EOX ends at z14: deeper tiles crop and enlarge their z14 ancestor, which
  // several children share, so keep a few pending/settled ancestors.
  const eox = async (z, x, y, signal) => {
    if (z <= EOX_MAX_ZOOM) return bytes(fill(EOX_TILES, z, x, y), signal);
    const depth = z - EOX_MAX_ZOOM, ax = x >> depth, ay = y >> depth, key = `${ax}/${ay}`;
    if (!ancestors.has(key)) {
      const timeout=timeoutSignal();
      const pending = waitForSignal(bytes(fill(EOX_TILES, EOX_MAX_ZOOM, ax, ay),timeout),timeout);
      pending.catch(() => { if (ancestors.get(key) === pending) ancestors.delete(key); });
      ancestors.set(key, pending);
      while (ancestors.size > 8) ancestors.delete(ancestors.keys().next().value);
    }
    signal?.throwIfAborted();
    const data=await waitForSignal(ancestors.get(key),signal);
    signal?.throwIfAborted();
    return waitForSignal(resample(data, depth, x - (ax << depth), y - (ay << depth)),signal);
  };
  const regionalPauses = new Map();
  const polarAncestors = new Map();
  const southern = async (z, x, y, signal) => {
    const depth=Math.max(0,z-GIBS_MAX_ZOOM), factor=2**depth;
    const az=z-depth, ax=Math.floor(x/factor), ay=Math.floor(y/factor), key=`${az}/${ax}/${ay}`;
    signal?.throwIfAborted();
    if (!polarAncestors.has(key)) {
      const timeout=timeoutSignal();
      const pending=waitForSignal((async()=>{
        const response=await fetcher(fill(GIBS_TILES,az,ax,ay),{signal:timeout});
        if (!response.ok || !imageType(response)) throw new Error(`GIBS imagery unavailable: HTTP ${response.status}`);
        return response.arrayBuffer();
      })(),timeout);
      pending.catch(()=>{if(polarAncestors.get(key)===pending)polarAncestors.delete(key);});
      polarAncestors.set(key,pending);
      while(polarAncestors.size>8)polarAncestors.delete(polarAncestors.keys().next().value);
    }
    const data=await waitForSignal(polarAncestors.get(key),signal);
    signal?.throwIfAborted();
    return depth ? waitForSignal(resample(data,depth,x-ax*factor,y-ay*factor),signal) : data.slice(0);
  };
  const tile = async (params, controller) => {
    const match = /^atlasimagery:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url);
    if (!match) throw new Error('Invalid imagery tile');
    const [z, x, y] = match.slice(1).map(Number), signal = controller?.signal;
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(z) || z > IMAGERY_MAX_ZOOM || x >= 2**z || y >= 2**z) throw new Error('Invalid imagery tile');
    const esri=async()=>{
      if(!esriActive() || eoxCovers(z,y))return null;
      const depth=Math.max(0,z-ESRI_MAX_ZOOM),factor=2**depth,ax=Math.floor(x/factor),ay=Math.floor(y/factor);
      try {
        const response=await fetcher(`${fill(ESRI_TILES,z-depth,ax,ay)}?token=${encodeURIComponent(esriKey)}`,{signal});
        if(response.ok && imageType(response)) {
          const data=await response.arrayBuffer();
          return delivered(params.url,'ESRI',depth?await waitForSignal(resample(data,depth,x-ax*factor,y-ay*factor),signal):data,signal);
        }
        if(AUTH_STATUS.has(response.status) || (response.ok&&!imageType(response)))disableEsri();
      }catch(error){if(signal?.aborted)throw error;}
      return null;
    };
    if(z<=ESRI_MAX_ZOOM){const result=await esri();if(result)return result;}
    let regional;
    try {regional=await waitForSignal(regionalImagery(z,x,y),signal);}catch{/* Optional region metadata unavailable: retain global imagery. */}
    signal?.throwIfAborted();
    if(regional && monotonic()>=(regionalPauses.get(regional.id)||0)) {
      try {
        const response=await fetcher(fill(regional.url,z,x,y),{signal});
        const header=response.headers?.get?.('retry-after'), seconds=/^\d+(?:\.\d+)?$/.test(header||'')?Number(header):NaN;
        const pause=!Number.isNaN(seconds)?seconds*1000:Math.max(0,Date.parse(header)-now());
        if(pause>0)regionalPauses.set(regional.id,monotonic()+pause);
        if(response.status===429)regionalPauses.set(regional.id,Math.max(regionalPauses.get(regional.id)||0,monotonic()+60000));
        if(response.status===401 || response.status===403)regionalPauses.set(regional.id,Infinity);
        if(response.ok && imageType(response))return delivered(params.url,regional.id,await response.arrayBuffer(),signal);
      }catch(error){if(signal?.aborted)throw error;}
    }
    // Native regional z19 wins; elsewhere retain Esri's z18 detail by cropping.
    if(z>ESRI_MAX_ZOOM){const result=await esri();if(result)return result;}
    if (tileLatitude(z,y) < EOX_SOUTH) {
      try { return delivered(params.url,'GIBS',await southern(z,x,y,signal),signal); }
      catch(error) { if(signal?.aborted)throw error; }
    }
    return delivered(params.url,'EOX',await eox(z,x,y,signal),signal);
  };
  return {tile, esriActive, providerFor:({z,x,y})=>providers.get(`atlasimagery://${z}/${x}/${y}`)};
}

// Crop the (dx, dy) child at `depth` levels below a 256 px tile and scale it
// back to 256 px. Browsers only; tests inject their own resampler.
export async function resampleTile(data, depth, dx, dy) {
  const image = await createImageBitmap(new Blob([data]));
  // Measure the decoded ancestor rather than assuming 256 px tiles.
  const width = image.width / 2 ** depth, height = image.height / 2 ** depth;
  const canvas = new OffscreenCanvas(256, 256), context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, dx * width, dy * height, width, height, 0, 0, 256, 256);
  image.close?.();
  return (await canvas.convertToBlob({type: 'image/jpeg', quality: 0.9})).arrayBuffer();
}

// MapLibre 5.24's renderable tile manager includes fallback parents and fading
// tiles. Tile/load/texture identity keeps credits stable through cached panning
// and safe when the renderer recycles GPU textures for a different provider.
// Unknown/evicted provenance retains the conservative full credit union.
export function installImageryAttribution(map,protocol,{eoxAttribution='',polarImagery=()=>false}={}) {
  const records=new WeakMap(),credits={...PROVIDER_ATTRIBUTION,EOX:eoxAttribution};
  const all=Object.values(credits).filter(Boolean).join('; ');
  const update=()=>{
    const source=map.getSource('satellite');if(!source)return;
    const manager=map.style?.tileManagers?.satellite;
    const publish=attribution=>{
      if(source.attribution===attribution)return;
      source.attribution=attribution;
      map.fire('sourcedata',{sourceId:'satellite',dataType:'source',sourceDataType:'metadata'});
    };
    if(typeof manager?.getRenderableIds!=='function' || typeof manager?.getTileByID!=='function'){publish(all);return;}
    const providers=new Set();let unknown=false;
    if(manager.used)for(const id of manager.getRenderableIds()) {
      const tile=manager.getTileByID(id);if(!tile?.texture)continue;
      if(!tile.tileID?.canonical){unknown=true;continue;}
      const cached=records.get(tile);
      let provider=cached?.texture===tile.texture && cached.timeAdded===tile.timeAdded ? cached.provider : undefined;
      if(!provider) {
        provider=protocol.providerFor(tile.tileID.canonical);
        if(provider)records.set(tile,{texture:tile.texture,timeAdded:tile.timeAdded,provider});
      }
      if(provider)providers.add(provider);else unknown=true;
    }
    if(polarImagery())providers.add('GIBS');
    const attribution=unknown?all:[...providers].sort().map(id=>credits[id]).filter(Boolean).join('; ');
    publish(attribution);
  };
  // Completed raster loads carry the Tile, also when a pooled texture is
  // reused and a coarse browser clock gives consecutive loads the same time.
  const loaded=event=>{if(event.sourceId==='satellite' && event.tile?.state==='loaded')records.delete(event.tile);};
  const destroy=()=>{map.off('render',update);map.off('sourcedata',loaded);map.off('remove',destroy);};
  map.on('render',update);map.on('sourcedata',loaded);map.on('remove',destroy);return destroy;
}
