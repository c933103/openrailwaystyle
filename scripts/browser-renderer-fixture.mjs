import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// The UI suite uses the real production renderer, not a renderer mock. Keep
// its external distribution download outside page/reload timings, and serve
// exactly the same verified bytes to every page, including the real PMTiles
// client required by deployed mode (which deliberately has no PMTiles shim).
// Live-map checks still use the actual site/CDN path without this fixture.
export async function rendererFixture() {
  const hashes = {
    'maplibre-gl@5.24.0/dist/maplibre-gl.js': '45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb',
    'maplibre-gl@5.24.0/dist/maplibre-gl.css': 'ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732',
    'pmtiles@4.2.1/dist/pmtiles.js': 'afc49d216fd24c0a3c0ff3cd2e0c62d6cdaf062854c3dced778dcab168824f79',
  };
  const assets = new Map();
  for (const [name, expected] of Object.entries(hashes)) {
    const url = `https://cdn.jsdelivr.net/npm/${name}`;
    let body;
    try { body = await readFile(`node_modules/${name.replace(/@[^/]+/, '')}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!body) {
      const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`Renderer fixture ${name}: HTTP ${response.status}`);
      body = Buffer.from(await response.arrayBuffer());
    }
    assert.equal(createHash('sha256').update(body).digest('hex'), expected,
      `Renderer fixture must match production library: ${name}`);
    assets.set(url, {body, contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript'});
  }
  return assets;
}

// Real MapLibre rendering with empty external providers for layout/gesture tests.
export async function installEmptyMapProviders(context, base, {firstParty = 'fixture', rendererAssets} = {}) {
  if (!['fixture', 'network'].includes(firstParty)) throw new Error(`Unknown first-party fixture mode: ${firstParty}`);
  const style = firstParty === 'fixture' ? JSON.parse(await readFile('styles/world.style.json','utf8')) : null;
  if (style) style.sources.stationMajor.data={type:'FeatureCollection',features:[]};
  const renderer = rendererAssets ?? await rendererFixture();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==','base64');
  if (firstParty === 'fixture') {
    await context.addInitScript(()=>{window.pmtiles={Protocol:class{tiles=new Map();tile=async params=>({data:params.type==='json'?{tilejson:'3.0.0',minzoom:0,maxzoom:14,tiles:['pmtiles://fixture/{z}/{x}/{y}']}:new ArrayBuffer(0)});},FetchSource:class{getKey(){return 'fixture';}},PMTiles:class{}};});
  }
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()),path=url.pathname,asset=renderer.get(url.href);
    if(asset)return route.fulfill(asset);
    if(url.href.startsWith(base)){
      // A deployment smoke test must exercise the published style, PMTiles
      // client and first-party /data/ responses instead of checkout copies.
      if(firstParty === 'network') return route.continue();
      if(path.endsWith('/major-stations.geojson'))return route.fulfill({json:{type:'FeatureCollection',features:[]}});
      if(path.endsWith('/world.style.json'))return route.fulfill({json:style});
      if(path.includes('/data/polar/'))return route.fulfill({status:404,body:''});
      if(path.includes('/data/'))return route.fulfill({json:{tiles:[],features:[],countries:{}}});
      return route.continue();
    }
    if(/\.(png|jpg|jpeg)$/.test(path))return route.fulfill({contentType:'image/png',body:png});
    if(/\/\d+\/\d+\/\d+(?:\.pbf)?$|\/fonts\//.test(path))return route.fulfill({contentType:'application/x-protobuf',body:Buffer.alloc(0)});
    return route.fulfill({json:{tilejson:'3.0.0',minzoom:0,maxzoom:16,tiles:['https://fixture.invalid/{z}/{x}/{y}']}});
  });
}
