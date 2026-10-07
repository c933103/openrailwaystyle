// One-shot branch maintenance; removed after the validated changes are committed.
import {readFile, writeFile, readdir, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
async function edit(path, action) {
  let source = await readFile(path, 'utf8');
  const replace = (before, after) => {assert.ok(source.includes(before), `${path}: missing ${before.slice(0, 100)}`); source = source.replace(before, after);};
  await action(replace, () => source, value => {source = value;});
  await writeFile(path, source);
}
await edit('styles/tile-labels.mjs', (replace, get, set) => {
  replace("import {ByteCache} from './byte-cache.mjs';", "import {createRequestPool} from './request-pool.mjs';\nimport {railTileMetadata, zoomOverrides, railTileNeedsGlyphs} from './rail-source-catalog.mjs';");
  replace('const storedGlyphs = data => withGlyphs(data, tileTextBlocks(data));', 'const storedGlyphs = (data, url) => url && !railTileNeedsGlyphs(url) ? data : withGlyphs(data, tileTextBlocks(data));');
  let source = get();
  const begin = source.indexOf('  // Only current-view requests are made.'), end = source.indexOf("  maplibregl.addProtocol('atlasglyph'", begin);
  assert.ok(begin >= 0 && end > begin);
  source = source.slice(0, begin) + `  const pool = createRequestPool({fetcher, timeout, retries: tileRetries});
  function get(url, signal, json = false, priority = 0) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const metadata = json && railTileMetadata(url, ORM);
    return metadata ? Promise.resolve(metadata) : pool.get(url, signal, {json, priority});
  }
` + source.slice(end);
  set(source);
  replace("({data:await get(glyphRequestURL(params.url),controller.signal)})", "({data:(await get(glyphRequestURL(params.url),controller.signal,false,1)).slice(0)})");
  replace('get(orm(`${source}/14/${tx}/${ty}`), signal)', 'get(orm(`${source}/14/${tx}/${ty}`), signal, false, 2)');
  set(get().replaceAll('storedGlyphs(data)', 'storedGlyphs(data,url)'));
  replace("const [response, list] = await Promise.all([fetcher(url,{signal:controller.signal}), loadingGaugeList()]);\n    if (!response.ok && response.status !== 204) throw new Error(`Railway tile returned ${response.status}`);\n    const data = await response.arrayBuffer();", "const [data, list] = await Promise.all([get(url,controller.signal).then(data=>data.slice(0)), loadingGaugeList()]);");
  set(get().replaceAll('storedGlyphs(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength))', 'storedGlyphs(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength),url)'));
  replace('storedGlyphs(await axleTile(await get(url,controller.signal)))', 'storedGlyphs(await axleTile((await get(url,controller.signal)).slice(0)),url)');
  replace("const data = await get(address,signal,true), options = new URLSearchParams(fragment);\n      const zoom = key => { const value = Number(options.get(key)); return Number.isInteger(value) && value >= 0 ? {[key]:value} : {}; };\n      const underzoom = zoom('underzoom').underzoom;", "const data = await get(address,signal,true), {underzoom, ...ranges} = zoomOverrides(fragment);");
  replace("...data,...zoom('minzoom'),...zoom('maxzoom'),tiles:", '...data,...ranges,tiles:');
  replace("const layers = {}, seen = new Set();\n    for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) {", "const layers = {}, seen = new Set(), children = [];\n    for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) {");
  replace("      const tile = readTile(await get(child.href, signal));\n      for (const [name, layer] of Object.entries(tile.layers)) {", "      children.push(get(child.href,signal).then(data=>({dx,dy,data})));\n    }\n    for (const {dx,dy,data} of await Promise.all(children)) {\n      const tile = readTile(data);\n      for (const [name, layer] of Object.entries(tile.layers)) {");
  replace('return {axleTile, stationTile};', 'return {axleTile, stationTile, requestStats:pool.stats, dispose:pool.dispose};');
});
await edit('styles/app.mjs', replace => {
  replace("  unitStyle(style);\n  styleLanguage = settings.language;", `  // Known rail metadata is local; only visible tiles enter the shared queue.
  // Include unlabelled overview/platform sources, not only text sources.
  for (const source of Object.values(style.sources)) {
    if (source.type === 'vector' && source.url?.startsWith(ORM+'/')) source.url='atlasrail://'+source.url;
  }
  unitStyle(style);
  styleLanguage = settings.language;`);
  replace("  map.on('remove', () => railRecovery.dispose());", "  map.on('moveend', () => railRecovery.wake());\n  map.on('remove', () => {railRecovery.dispose();labelProtocols.dispose?.();});");
  replace("  map.on('sourcedata', e => { if (e.isSourceLoaded && e.sourceId) {\n    errors.delete(e.sourceId);\n    otherMetadataRetries.delete(e.sourceId);\n    railRecovery.noteSourceData(e);\n  } });", "  map.on('sourcedata', e => {\n    railRecovery.noteSourceData(e);\n    if (e.isSourceLoaded && e.sourceId) {errors.delete(e.sourceId);otherMetadataRetries.delete(e.sourceId);}\n  });");
});
await edit('scripts/style/layers/railway.mjs', replace => {
  replace("const width = ['interpolate', ['linear'], ['zoom'], 0, 0.6, 4, 1.15", "// World-scale railways need a full CSS pixel, including negative camera zoom.\n  const width = ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 1.15");
});
await edit('scripts/check-map-browser.mjs', replace => {
  replace("return map.queryRenderedFeatures([[point.x-95,point.y-95],[point.x+95,point.y+95]],{layers:['speed-tracks']})\n      .filter(f=>f.source==='railway'&&['LineString','MultiLineString'].includes(f.geometry.type)).length;", "const sources=['railway','ownerRail','axleRail'];\n    const layers=map.getStyle().layers.filter(l=>sources.includes(l.source)&&l.id.endsWith('-tracks')&&l.layout?.visibility!=='none').map(l=>l.id);\n    return map.queryRenderedFeatures([[point.x-95,point.y-95],[point.x+95,point.y+95]],{layers})\n      .filter(f=>sources.includes(f.source)&&['LineString','MultiLineString'].includes(f.geometry.type)).length;");
});
await edit('scripts/ci-plan.mjs', replace => replace("{group: 'map', checks: ['check-map-browser.mjs']}", "{group: 'map', checks: ['check-rail-overview-browser.mjs', 'check-map-browser.mjs']}"));
for (const entry of await readdir('styles')) {
  if (!/\.(mjs|html|css)$/.test(entry)) continue;
  await edit(`styles/${entry}`, (replace, get, set) => set(get().replaceAll('20261007-rail-recovery', '20261007-rail-performance')));
}
await edit('styles/sw.js', replace => replace('CACHE = `${PREFIX}15`', 'CACHE = `${PREFIX}16`'));

await writeFile('tests/rail-provider-recovery.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import {createRailProviderRecovery,isRetryableRailError} from '../styles/rail-provider-recovery.mjs';
function fixture(){
 const timers=new Map(),reloads=[],source={url:'atlasrail://https://openrailwaymap.app/railway_line_high',setUrl(){reloads.push('metadata');}};
 let id=0,active=true;
 const map={getSource:()=>source,refreshTiles:(id,tiles)=>reloads.push({id,tiles})};
 const recovery=createRailProviderRecovery(map,{active:()=>active,setTimer:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimer:id=>timers.delete(id)});
 return {map,source,recovery,reloads,timers,setActive:v=>active=v,next(){const [id,t]=timers.entries().next().value;timers.delete(id);t.fn();}};
}
const tile=(x=1)=>({state:'errored',tileID:{canonical:{z:7,x,y:2}}});
test('only failed tiles are refreshed, not healthy source data or metadata',()=>{
 const f=fixture(),t=tile();
 f.recovery.noteError({sourceId:'railway',tile:t,error:new Error('Map names returned 520')});
 assert.equal(f.timers.size,1);f.next();
 assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}]);
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',isSourceLoaded:true}),false);
 assert.equal(f.recovery.hasFailures(),true);
 t.state='loaded';assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:t}),true);
 assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);f.recovery.dispose();
});
test('multiple failed tiles share a timer and preserve separate recovery evidence',()=>{
 const f=fixture(),a=tile(1),b=tile(2);
 for(const t of [a,b])f.recovery.noteError({sourceId:'railway',tile:t,error:new Error('Failed to fetch')});
 assert.equal(f.timers.size,1);f.next();assert.equal(f.reloads[0].tiles.length,2);
 a.state='loaded';f.recovery.noteSourceData({sourceId:'railway',tile:a});assert.equal(f.recovery.hasFailures(),true);
 b.state='reloading';f.next();assert.equal(f.reloads.length,1,'do not restart already loading tiles');
 f.recovery.dispose();
});
test('HTTP status takes priority over AJAXError text; cancellation is not an outage',()=>{
 for(const status of [403,404])assert.equal(isRetryableRailError(new Error('AJAXError: '+status)),false);
 for(const status of [408,429,503,520])assert.equal(isRetryableRailError({status,message:'provider response'}),true);
 assert.equal(isRetryableRailError(new Error('net::ERR_ABORTED')),false);
 assert.equal(isRetryableRailError(new Error('expression invalid')),false);
});
test('hidden/offline maps do no retries and disposal removes timers',()=>{
 const f=fixture();f.setActive(false);
 f.recovery.noteError({sourceId:'railway',tile:tile(),error:new Error('Failed to fetch')});assert.equal(f.timers.size,0);
 f.setActive(true);f.recovery.wake();assert.equal(f.timers.size,1);
 f.setActive(false);f.next();assert.equal(f.reloads.length,0);
 f.setActive(true);f.recovery.wake();f.recovery.dispose();assert.equal(f.timers.size,0);
});
test('source replacement discards obsolete failures and metadata needs a metadata success event',()=>{
 const f=fixture();f.recovery.noteError({sourceId:'railway',error:new Error('Failed to fetch')});
 f.next();assert.deepEqual(f.reloads,['metadata']);
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',isSourceLoaded:true}),false);
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',sourceDataType:'metadata'}),true);
 f.recovery.noteError({sourceId:'railway',tile:tile(),error:new Error('Failed to fetch')});
 f.map.getSource=()=>undefined;f.recovery.wake();assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);f.recovery.dispose();
});
test('provider matching does not accept a host embedded in another host',()=>{
 const f=fixture();f.source.url='https://openrailwaymap.app.attacker.invalid/railway_line_high';
 assert.equal(f.recovery.noteError({sourceId:'railway',error:new Error('Failed to fetch')}),false);f.recovery.dispose();
});
`);
await writeFile('tests/rail-loading.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import {railTileMetadata,zoomOverrides,railTileNeedsGlyphs,RAIL_TILE_RANGES} from '../styles/rail-source-catalog.mjs';
import {installLabelProtocols} from '../styles/tile-labels.mjs';
import {railwaySources} from '../scripts/style/sources/railway.mjs';
import encode from 'vt-pbf';
const origin='https://openrailwaymap.app';
test('all catalog ranges match the generated source contract, including the station underzoom override',()=>{
 for(const source of Object.values(railwaySources())){
  if(!source.url)continue;const [address,fragment='']=source.url.split('#');
  const data={...railTileMetadata(address),...zoomOverrides(fragment)};
  assert.equal(data.minzoom,source.minzoom,address);assert.equal(data.maxzoom,source.maxzoom,address);
 }
 assert.equal(railTileMetadata(origin+'.evil.invalid/railway_line_high'),null);
 assert.equal(railTileMetadata(origin+'/new_unknown_endpoint'),null);
});
test('absent and invalid station zoom options do not become zero',()=>{
 assert.deepEqual(zoomOverrides(''),{});assert.deepEqual(zoomOverrides('minzoom=&maxzoom=bad'),{});
 assert.deepEqual(zoomOverrides('minzoom=0&maxzoom=7&underzoom=7'),{minzoom:0,maxzoom:7,underzoom:7});
});
test('known hidden-source metadata causes zero network requests',async()=>{
 const handlers={};let fetched=0;
 const protocols=installLabelProtocols({addProtocol:(name,fn)=>handlers[name]=fn},{},async()=>{fetched++;throw new Error('network must not be used');});
 try{
  for(const endpoint of Object.keys(RAIL_TILE_RANGES)){
   const result=await handlers.atlasrail({type:'json',url:'atlasrail://'+origin+'/'+endpoint},new AbortController());
   assert.equal(result.data.vector_layers[0].id,endpoint);
  }
  const result=await handlers.atlasstation({type:'json',url:'atlasstation://en/'+origin+'/standard_railway_text_stations'},new AbortController());
  assert.equal(result.data.minzoom,8);assert.equal(result.data.maxzoom,16);assert.equal(fetched,0);
  console.log('RAIL_METADATA_NETWORK_REQUESTS',fetched,'for',Object.keys(RAIL_TILE_RANGES).length,'endpoints');
 }finally{protocols.dispose();}
});
test('zoom-seven railway geometry is not delayed by optional rare-Han fonts',async()=>{
 const handlers={};let fonts=0;
 const tile=encode.fromGeojsonVt({railway_line_high:{features:[{type:2,geometry:[[[1,1],[100,100]]],tags:{id:'way-1',name:'𠮷',feature:'rail',state:'present'}}]}});
 const protocols=installLabelProtocols({addProtocol:(name,fn)=>handlers[name]=fn},{},async()=>({ok:true,arrayBuffer:async()=>tile.buffer.slice(tile.byteOffset,tile.byteOffset+tile.byteLength)}),{rareGlyphs:async()=>{fonts++;}});
 try{
  const result=await handlers.atlasrail({type:'arrayBuffer',url:'atlasrail://'+origin+'/railway_line_high/7/104/52'},new AbortController());
  assert.ok(result.data.byteLength);assert.equal(fonts,0);
  await handlers.atlasrail({type:'arrayBuffer',url:'atlasrail://'+origin+'/railway_line_high/9/416/208'},new AbortController());
  assert.equal(fonts,1,'retain the text/glyph path where railway names are drawn');
  assert.equal(railTileNeedsGlyphs(origin+'/speed_railway_line_low/0/0/0'),false);
 }finally{protocols.dispose();}
});
`);
execFileSync('npm', ['run','build'], {stdio:'inherit'});
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (key === 'metadata') {const metadata=Object.fromEntries(Object.entries(value.metadata).filter(([name])=>!name.startsWith('atlas:')));if(Object.keys(metadata).length)result.metadata=canonical(metadata);}
    else result[key]=canonical(value[key]);
  }
  return result;
};
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const style=JSON.parse(await readFile('styles/world.style.json')), baseline=JSON.parse(await readFile('tests/fixtures/style-composition-baseline.json'));
for(const source of baseline.sources)assert.equal(digest(style.sources[source.id]),source.sha256,'unexpected source change '+source.id);
const allowed=/^(infrastructure|speed|electrification|control|gauge|loading|axle|owner|service)-(branch-overview|overview)(-system-[23])?$/;
const changed=[];
for(const expected of baseline.layers){
 const layer=style.layers.find(layer=>layer.id===expected.id), hash=digest(layer);
 if(hash===expected.sha256)continue;
 assert.ok(allowed.test(expected.id),'unexpected cartographic change '+expected.id);changed.push(expected.id);expected.sha256=hash;
}
assert.ok(changed.length);await writeFile('tests/fixtures/style-composition-baseline.json',JSON.stringify(baseline,null,2)+'\n');
await mkdir('docs/investigations',{recursive:true});
await writeFile('docs/investigations/rail-loading-20261007.md', '# Railway loading and world-scale visibility\n\nKnown OpenRailwayMap XYZ source metadata is resolved locally: inactive railway views no longer each require an external TileJSON request before the map can start. Unknown endpoints still fetch their own metadata. The catalog is tested against the composed source ranges. This is not a guarantee of tile-provider availability.\n\nThe railway adapters share a byte-bounded request pool: six requests overall, at most four per origin, shared same-URL work, visible geometry before derived counts, cancellation before dispatch and timeouts measured from dispatch. HTTP failures are not cached as empty tiles. Retryable requests share one bounded retry; 403/404 are not retried. Track-count geometry and More detail remain intact. The loading-gauge path also shares the pool. Station underzoom children load concurrently through its bounds, rather than four serial requests.\n\nMissing station zoom parameters previously passed through Number(null), incorrectly producing zero. Only present, valid fragment parameters now override a source range. Rail tiles below the railway-name threshold do not wait for optional fonts; named detail and station labels keep their glyph handling.\n\nRecovery refreshes only failed, visible tile coordinates, retains healthy geometry, and requires actual successful tile data rather than treating isSourceLoaded as proof of recovery. It pauses offline/hidden and discards obsolete source/tile failures.\n\nWorld-scale major railway strokes are one CSS pixel instead of 0.6. MapLibre 5.24 already clamps negative camera zoom to tile zoom zero, and its layer visibility check does not treat minzoom=0 as a cutoff; simply changing that value would not diagnose the report. A deterministic browser test uses the actual generated rail layers at -0.1, 0 and 0.1, in both globe and Mercator, across all nine views. The live Wuhan check remains separate and now queries the active track layer rather than an invisible Speed layer.\n\nThese changes do not provide a worldwide independent fallback dataset during an upstream outage. The request-count regressions are controlled tests, not a claimed end-to-end speedup on a particular phone or network.\n');
console.log('Reviewed overview paint changes:',changed.join(', '));
