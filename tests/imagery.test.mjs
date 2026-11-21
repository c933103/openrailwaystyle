import test from 'node:test';
import assert from 'node:assert/strict';
import {loadImageryConfig, applyImageryConfig, createImageryProtocol, eoxCovers, ESRI_MAX_ZOOM, ESRI_OFF_KEY, ESRI_OFF_MS, ESRI_ATTRIBUTION, GIBS_ATTRIBUTION, IMAGERY_MAX_ZOOM, regionalImagery, installImageryAttribution} from '../styles/imagery.mjs';

const KEY = 'AAPTxy8BH1VEsoebNVZXo8HurEOF051kAEKlhkOhBEc9BmTEST';
const bytes = text => new TextEncoder().encode(text).buffer;
const image = text => ({ok: true, status: 200, headers: new Headers({'content-type': 'image/jpeg'}), arrayBuffer: async () => bytes(text)});
const reply = (status, type = 'application/json') => ({ok: status >= 200 && status < 300, status, headers: new Headers({'content-type': type}), arrayBuffer: async () => bytes('{}')});
const memory = () => { const values = new Map(); return {getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v))}; };
const text = data => new TextDecoder().decode(data);

function harness(esriReply, {storage = memory(), now = () => 1000} = {}) {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    if (url.includes('arcgis.com')) { const r = esriReply(url); if (r instanceof Error) throw r; return r; }
    return image('eox ' + url.match(/g\/(\d+\/\d+\/\d+)/)[1]);
  };
  const resampled = [];
  const resample = async (data, depth, dx, dy) => { resampled.push([text(data), depth, dx, dy]); return bytes(`crop ${depth} ${dx} ${dy}`); };
  return {calls, resampled, storage, protocol: createImageryProtocol({esriKey: KEY, fetcher, storage, now, resample})};
}
const get = (protocol, z, x, y, signal) => protocol.tile({url: `atlasimagery://${z}/${x}/${y}`}, {signal}).then(r => text(r.data));

test('the deployment configuration enables Esri only with a well-formed key', async () => {
  const json = value => async () => ({ok: true, json: async () => value});
  assert.deepEqual(await loadImageryConfig('x', {fetcher: json({esriKey: KEY})}), {esriKey: KEY});
  for (const value of [{}, {esriKey: ''}, {esriKey: 'short'}, {esriKey: 'has spaces in it but is long enough'}, null])
    assert.deepEqual(await loadImageryConfig('x', {fetcher: json(value)}), {}, JSON.stringify(value));
  assert.deepEqual(await loadImageryConfig('x', {fetcher: async () => ({ok: false, status: 404})}), {});
  assert.deepEqual(await loadImageryConfig('x', {fetcher: async () => { throw new TypeError('offline'); }}), {});
});

test('the deployment configuration validates optional static GitHub Pages Google Maps and admin fields', async () => {
  const json = value => async () => ({ok: true, json: async () => value});
  const gmapsKey = 'AIzaSyTestGoogleMapsStaticPagesKey12345';
  assert.deepEqual(
    await loadImageryConfig('x', {
      fetcher: json({
        esriKey: KEY,
        googleMapsKey: gmapsKey,
        githubClientId: 'Iv1.10671435client',
        adminRepo: 'c933103/openrailwaystyle',
        authBackendOrigin: 'https://10671435.xyz/',
      }),
    }),
    {
      esriKey: KEY,
      googleMapsKey: gmapsKey,
      githubClientId: 'Iv1.10671435client',
      adminRepo: 'c933103/openrailwaystyle',
      authBackendOrigin: 'https://10671435.xyz',
    },
  );
  assert.deepEqual(
    await loadImageryConfig('x', {
      fetcher: json({
        googleMapsKey: 'short',
        githubClientId: 'bad space',
        adminRepo: 'not-a-repo',
        authBackendOrigin: 'http://insecure.example.com',
      }),
    }),
    {},
  );
});

test('keyless southern fallback and optional Esri share the imagery protocol', () => {
  const eox = {type: 'raster', tiles: ['https://tiles.maps.eox.at/x/{z}/{y}/{x}.jpg'], maxzoom: 14, attribution: 'EOX credit'};
  const untouched = structuredClone(eox);
  applyImageryConfig(untouched, {});
  assert.deepEqual(untouched.tiles,['atlasimagery://{z}/{x}/{y}']);
  assert.ok(untouched.attribution.includes(GIBS_ATTRIBUTION));
  assert.ok(!untouched.attribution.includes(ESRI_ATTRIBUTION));
  const esri = applyImageryConfig(structuredClone(eox), {esriKey: KEY});
  assert.deepEqual(esri.tiles, ['atlasimagery://{z}/{x}/{y}']);
  assert.equal(esri.maxzoom, IMAGERY_MAX_ZOOM);
  assert.ok(esri.attribution.startsWith(ESRI_ATTRIBUTION) && esri.attribution.includes('EOX credit'), 'both providers credited');
  assert.match(ESRI_ATTRIBUTION, /Powered by .*Esri.*Vantor, Earthstar Geographics, and the GIS User Community/);
});

test('Esri tiles are requested with the key and returned as served', async () => {
  const h = harness(() => image('esri'));
  assert.equal(await get(h.protocol, 15, 100, 200), 'esri');
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0], new RegExp(`^https://ibasemaps-api\\.arcgis\\.com/arcgis/rest/services/World_Imagery/MapServer/tile/15/200/100\\?token=${KEY}$`));
});

test('a quota or authorization failure switches the device to Sentinel-2 for the back-off period', async () => {
  for (const failure of [reply(403), reply(498), reply(499), reply(401), reply(200, 'application/json')]) {
    let now = 1000; const h = harness(() => failure, {now: () => now});
    assert.equal(await get(h.protocol, 10, 1, 2), 'eox 10/2/1', `status ${failure.status} falls back for this tile`);
    assert.equal(h.protocol.esriActive(), false);
    assert.equal(Number(h.storage.getItem(ESRI_OFF_KEY)), 1000 + ESRI_OFF_MS);
    h.calls.length = 0;
    assert.equal(await get(h.protocol, 10, 3, 4), 'eox 10/4/3');
    assert.ok(h.calls.every(url => !url.includes('arcgis')), 'no Esri request while switched off');
    const later = createImageryProtocol({esriKey: KEY, storage: h.storage, now: () => 1000 + ESRI_OFF_MS - 1, fetcher: async () => image('x')});
    assert.equal(later.esriActive(), false, 'another page on the device honours the back-off');
    now = 1000 + ESRI_OFF_MS;
    assert.equal(h.protocol.esriActive(), true, 'Esri is tried again after the back-off');
  }
});

test('other Esri failures fall back for that tile only', async () => {
  for (const failure of [reply(500), reply(404), new TypeError('Failed to fetch')]) {
    const h = harness(() => failure);
    assert.equal(await get(h.protocol, 9, 5, 6), 'eox 9/6/5');
    assert.equal(h.protocol.esriActive(), true, String(failure.status ?? failure.message));
  }
});

test('beyond Sentinel-2 zoom the fallback crops a shared z14 ancestor', async () => {
  const h = harness(() => reply(503));
  assert.equal(await get(h.protocol, 16, 4 * 100 + 1, 4 * 200 + 3), 'crop 2 1 3');
  assert.equal(await get(h.protocol, 16, 4 * 100 + 2, 4 * 200 + 0), 'crop 2 2 0');
  assert.deepEqual(h.resampled.map(r => r[0]), ['eox 14/200/100', 'eox 14/200/100']);
  assert.equal(h.calls.filter(url => url.includes('eox')).length, 1, 'children share one ancestor request');
});

test('a cancelled tile is not silently replaced and storage failures keep the session switch', async () => {
  const controller = new AbortController(); controller.abort();
  const h = harness(() => new DOMException('Aborted', 'AbortError'));
  await assert.rejects(get(h.protocol, 10, 1, 1, controller.signal), {name: 'AbortError'});
  const broken = {getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }};
  const b = harness(() => reply(403), {storage: broken});
  assert.equal(await get(b.protocol, 10, 1, 1), 'eox 10/1/1');
  assert.equal(b.protocol.esriActive(), false);
  await assert.rejects(get(b.protocol, 10, 1, 1).then(() => b.protocol.tile({url: 'atlasimagery://bad'}, {})), /Invalid imagery tile/);
});

test('denied storage access and a failed Esri body download still yield EOX imagery', async () => {
  const realm = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new DOMException('denied', 'SecurityError'); }});
  try {
    const protocol = createImageryProtocol({esriKey: KEY, fetcher: async url => url.includes('arcgis') ? reply(403) : image('eox'), resample: async () => bytes('x')});
    assert.equal(await get(protocol, 10, 1, 1), 'eox');
    assert.equal(protocol.esriActive(), false, 'the refusal is kept for this session');
  } finally {
    if (realm) Object.defineProperty(globalThis, 'localStorage', realm); else delete globalThis.localStorage;
  }
  const truncated = {ok: true, status: 200, headers: new Headers({'content-type': 'image/jpeg'}), arrayBuffer: async () => { throw new TypeError('network error'); }};
  const h = harness(() => truncated);
  assert.equal(await get(h.protocol, 10, 7, 8), 'eox 10/8/7');
  assert.equal(h.protocol.esriActive(), true, 'a transport failure is not a refusal');
});

const tileY=(lat,z)=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);

test('EOX covers a tile where it has native detail: z14 at the equator, falling with latitude, inside 56° S–84° N',()=>{
  for(const [lat,z,covered] of [[0,14,true],[-0.001,14,true],[0,15,false],[35.7,13,true],[35.7,14,false],[59,13,true],[60.5,13,false],[60.5,12,true],
    [76,11,true],[76,12,false],[84.5,3,true],[84.5,8,false],[-55,10,true],[-60,5,true],[-60,8,false],[-80,2,false]])
    assert.equal(eoxCovers(z,tileY(lat,z)),covered,`${lat}° z${z}`);
});

test('with a key, Esri is used only where EOX cannot cover the tile',async()=>{
  const h=harness(()=>image('esri'));
  const x=(lon,z)=>Math.floor((lon+180)/360*2**z);
  for(const [lat,lon,z] of [[0,30,14],[35.68,139.76,13],[60.5,10,12],[51.5,0,8]])
    assert.equal(await get(h.protocol,z,x(lon,z),tileY(lat,z)),`eox ${z}/${tileY(lat,z)}/${x(lon,z)}`,`EOX directly at ${lat}° z${z}`);
  assert.equal(h.calls.filter(url=>url.includes('arcgis')).length,0,'no Esri request where EOX has native detail');
  for(const [lat,lon,z] of [[0,30,15],[35.68,139.76,14],[60.5,10,13],[-70,0,6],[84.5,0,8]])
    assert.equal(await get(h.protocol,z,x(lon,z),tileY(lat,z)),'esri',`Esri at ${lat}° z${z}`);
});

 test('keyless Antarctic imagery uses and shares its declared z8 NASA ancestor', async () => {
  const calls=[], crops=[];
  const protocol=createImageryProtocol({fetcher:async url=>{calls.push(url);return image('gibs');},
    resample:async(data,depth,dx,dy)=>{crops.push([text(data),depth,dx,dy]);return bytes('crop');}});
  assert.equal(await get(protocol,12,3900,3501),'crop');
  assert.equal(await get(protocol,12,3901,3502),'crop');
  assert.equal(calls.length,1);assert.match(calls[0],/GoogleMapsCompatible_Level8\/8\/218\/243\.jpeg$/);
  assert.deepEqual(crops,[['gibs',4,12,13],['gibs',4,13,14]]);
});
 test('NASA failure falls back and aborts never start or silently replace requests', async () => {
  const calls=[];
  const protocol=createImageryProtocol({fetcher:async url=>{calls.push(url);return url.includes('gibs.')?reply(503):image('eox');}});
  assert.equal(await get(protocol,8,240,230),'eox');assert.equal(calls.length,2);
  const c=new AbortController();c.abort();
  await assert.rejects(get(protocol,8,240,230,c.signal),{name:'AbortError'});assert.equal(calls.length,2);
  await assert.rejects(get(protocol,8,256,230),/Invalid imagery tile/);
});

 const tileX=(lon,z)=>Math.floor((lon+180)/360*2**z);
 test('regional imagery selects country interiors and excludes neighboring countries and borders',async()=>{
  for(const [lon,lat,id] of [[8.54,47.37,'CHE'],[2.35,48.85,'FRA'],[-97.74,30.27,'USA']])
    assert.equal((await regionalImagery(16,tileX(lon,16),tileY(lat,16)))?.id,id);
  for(const [lon,lat] of [[-79.38,43.65],[7.85,48],[9.19,45.46],[-99.13,19.43],[-149.9,61.2]])
    assert.equal(await regionalImagery(16,tileX(lon,16),tileY(lat,16)),null,`${lon},${lat}`);
  assert.equal(await regionalImagery(14,tileX(2.35,14),tileY(48.85,14)),null);
 });
 test('keyless orthophotos precede EOX crops and failed providers retain an observed pause',async()=>{
  const calls=[];let clock=0,refuse=true;
  const protocol=createImageryProtocol({monotonic:()=>clock,fetcher:async url=>{
    calls.push(url);
    if(url.includes('geo.admin.ch'))return refuse?{...reply(429),headers:new Headers({'Retry-After':'120'})}:image('swiss');
    return image('eox');
  },resample:async()=>bytes('eox crop')});
  const x=tileX(8.54,16),y=tileY(47.37,16);
  assert.equal(await get(protocol,16,x,y),'eox crop');assert.equal(calls.filter(x=>x.includes('geo.admin')).length,1);
  refuse=false;clock=119999;assert.equal(await get(protocol,16,x,y),'eox crop');assert.equal(calls.filter(x=>x.includes('geo.admin')).length,1);
  clock=120000;assert.equal(await get(protocol,16,x,y),'swiss');
 });
 test('French service uses its current PM_0_19 matrix and regional abort remains an abort',async()=>{
  const calls=[],c=new AbortController();
  const protocol=createImageryProtocol({fetcher:async url=>{calls.push(url);return image('regional');}});
  assert.equal(await get(protocol,19,tileX(2.35,19),tileY(48.85,19)),'regional');
  assert.match(calls[0],/TILEMATRIXSET=PM_0_19/);
  c.abort();await assert.rejects(get(protocol,19,tileX(2.35,19),tileY(48.85,19),c.signal),{name:'AbortError'});assert.equal(calls.length,1);
 });

 test('a canceled NASA consumer settles without canceling a shared ancestor for its sibling',async()=>{
  let complete,upstream;const canceled=new AbortController();
  const protocol=createImageryProtocol({fetcher:(_url,options)=>{upstream=options.signal;return new Promise(resolve=>complete=resolve);},resample:async()=>bytes('crop')});
  const a=get(protocol,12,3900,3501,canceled.signal), b=get(protocol,12,3901,3502);
  await new Promise(resolve=>setImmediate(resolve));canceled.abort();
  await assert.rejects(a,{name:'AbortError'});assert.equal(upstream.aborted,false);
  complete(image('gibs'));assert.equal(await b,'crop');
 });
 test('hung shared NASA fetches and bodies time out, fall back and remove their cache entry',async()=>{
  for(const phase of ['fetch','body']) {
    let clock=new AbortController(),calls=0;
    const protocol=createImageryProtocol({timeoutSignal:()=>clock.signal,fetcher:async url=>{
      if(!url.includes('gibs.'))return image('eox');
      calls++;if(calls>1)return image('gibs');
      if(phase==='fetch')return new Promise(()=>{});
      return {...image('gibs'),arrayBuffer:()=>new Promise(()=>{})};
    }});
    const pending=get(protocol,8,240,230);await new Promise(resolve=>setImmediate(resolve));
    clock.abort(new DOMException('Timed out','TimeoutError'));assert.equal(await pending,'eox');
    clock=new AbortController();assert.equal(await get(protocol,8,240,230),'gibs');assert.equal(calls,2);
  }
 });
 test('EOX shared ancestor wait also settles on consumer cancellation and on timeout',async()=>{
  const timeout=new AbortController(),cancel=new AbortController();let calls=0;
  const protocol=createImageryProtocol({timeoutSignal:()=>timeout.signal,fetcher:async()=>{calls++;return new Promise(()=>{});}});
  const a=get(protocol,16,100,100,cancel.signal),b=get(protocol,16,101,100);
  await new Promise(resolve=>setImmediate(resolve));cancel.abort();await assert.rejects(a,{name:'AbortError'});
  timeout.abort(new DOMException('Timed out','TimeoutError'));await assert.rejects(b,{name:'TimeoutError'});assert.equal(calls,1);
 });

test('provider attribution follows rendered textures, mixed fallback, cached panning and removal',async()=>{
  let regional=true;const protocol=createImageryProtocol({fetcher:async url=>url.includes('geo.admin')&&!regional?reply(503):image('tile'),resample:async data=>data});
  const c={z:16,x:tileX(8.54,16),y:tileY(47.37,16)};
  await get(protocol,c.z,c.x,c.y);assert.equal(protocol.providerFor(c),'CHE');
  const first={texture:{},tileID:{canonical:c}},second={texture:{},tileID:{canonical:{z:12,x:1,y:1000}}};
  await get(protocol,12,1,1000);assert.equal(protocol.providerFor(second.tileID.canonical),'EOX');
  let visible=[first],polar=false;const events=new Map(),source={attribution:'initial'},fired=[];
  const manager={used:true,getRenderableIds:()=>visible.map((_,i)=>String(i)),getTileByID:i=>visible[+i]};
  const map={getSource:()=>source,style:{tileManagers:{satellite:manager}},on:(type,fn)=>events.set(type,fn),off:(type,fn)=>{if(events.get(type)===fn)events.delete(type);},fire:(...args)=>fired.push(args)};
  const destroy=installImageryAttribution(map,protocol,{eoxAttribution:'EOX credit',polarImagery:()=>polar});
  events.get('render')();assert.match(source.attribution,/swisstopo/);assert.doesNotMatch(source.attribution,/Esri|IGN|EOX/);
  visible=[first,second];events.get('render')();assert.match(source.attribution,/swisstopo/);assert.match(source.attribution,/EOX credit/);
  visible=[second];events.get('render')();assert.equal(source.attribution,'EOX credit');
  regional=false;await get(protocol,c.z,c.x,c.y);assert.equal(protocol.providerFor(c),'EOX');
  visible=[first];events.get('render')();assert.match(source.attribution,/swisstopo/,'old cached texture keeps original credit after newer fallback');
  const recycled={texture:first.texture,tileID:second.tileID};visible=[recycled];events.get('render')();assert.equal(source.attribution,'EOX credit','GPU texture reused by another tile does not retain Swiss credit');
  visible=[first];events.get('render')();assert.match(source.attribution,/swisstopo/);
  first.state='loaded';events.get('sourcedata')({sourceId:'satellite',tile:first});events.get('render')();assert.equal(source.attribution,'EOX credit','same tile and texture reload with unchanged clock refreshes provider');
  first.texture={};events.get('render')();assert.equal(source.attribution,'EOX credit','replaced texture uses actual fallback');
  polar=true;events.get('render')();assert.match(source.attribution,/NASA/);
  polar=false;manager.used=false;events.get('render')();assert.equal(source.attribution,'');
  manager.used=true;visible=[{texture:{},tileID:{canonical:{z:10,x:1,y:1}}}];events.get('render')();assert.match(source.attribution,/Esri/);assert.match(source.attribution,/swisstopo/,'unknown provenance retains all possible credits');
  const count=fired.length;events.get('render')();assert.equal(fired.length,count,'unchanged attribution emits no event');
  delete map.style.tileManagers;source.attribution='stale';events.get('render')();assert.match(source.attribution,/Esri/,'unavailable renderer API restores conservative union');
  destroy();assert.equal(events.size,0);
});
test('failed and canceled image requests never establish a provider credit',async()=>{
  const p=createImageryProtocol({fetcher:async()=>{throw Error('offline');}}),c={z:2,x:1,y:1};
  await assert.rejects(get(p,2,1,1));assert.equal(p.providerFor(c),undefined);
  const controller=new AbortController();controller.abort();await assert.rejects(get(p,2,1,1,controller.signal));assert.equal(p.providerFor(c),undefined);
});

test('z19 retains Esri z18 ancestor detail outside native regional coverage',async()=>{
  const calls=[],crops=[],x=tileX(139.76,19),y=tileY(35.68,19);
  const p=createImageryProtocol({esriKey:KEY,fetcher:async url=>{calls.push(url);return image('esri');},resample:async(data,...crop)=>{crops.push(crop);return data;}});
  assert.equal(await get(p,19,x,y),'esri');assert.match(calls[0],new RegExp(`/tile/18/${Math.floor(y/2)}/${Math.floor(x/2)}\\?token=`));
  assert.deepEqual(crops,[[1,x%2,y%2]]);assert.equal(p.providerFor({z:19,x,y}),'ESRI');
  calls.length=0;crops.length=0;await get(p,19,tileX(2.35,19),tileY(48.85,19));assert.match(calls[0],/data.geopf.fr/);assert.equal(crops.length,0);
});
