import {pmtilesFixtureResponse} from './pmtiles-browser-fixture.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {BROWSER_LIBRARIES} from './browser-libraries.mjs';

// The UI suite uses the real production renderer, not a renderer mock. Serve
// exactly the same built, verified bytes to isolated renderer tests. Production
// deployment checks deliberately bypass this fixture for every first-party
// asset, including these libraries, so missing deployed files cannot be hidden.
export async function rendererFixture(base = 'http://127.0.0.1:4173/') {
  const assets = new Map();
  for (const {target,sha256} of BROWSER_LIBRARIES) {
    const body = await readFile(new URL(`../styles/${target}`, import.meta.url));
    assert.equal(createHash('sha256').update(body).digest('hex'), sha256,
      `Renderer fixture must match production library: ${target}`);
    assets.set(new URL(target, base).href, {body, contentType: target.endsWith('.css') ? 'text/css' : 'text/javascript'});
  }
  return assets;
}

// Real MapLibre rendering with empty external providers for layout/gesture tests.
export async function installEmptyMapProviders(context, base, {firstParty = 'fixture', rendererAssets} = {}) {
  if (!['fixture', 'network'].includes(firstParty)) throw new Error(`Unknown first-party fixture mode: ${firstParty}`);
  const style = firstParty === 'fixture' ? JSON.parse(await readFile('styles/world.style.json','utf8')) : null;
  if (style) style.sources.stationMajor.data={type:'FeatureCollection',features:[]};
  const renderer = firstParty === 'network' ? new Map() : rendererAssets ?? await rendererFixture(base);
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
    if(path.endsWith('.pmtiles'))return route.fulfill(pmtilesFixtureResponse(route.request().headers().range));
    if(/\.(png|jpg|jpeg)$/.test(path))return route.fulfill({contentType:'image/png',body:png});
    if(/\/\d+\/\d+\/\d+(?:\.pbf)?$|\/fonts\//.test(path))return route.fulfill({contentType:'application/x-protobuf',body:Buffer.alloc(0)});
    return route.fulfill({json:{tilejson:'3.0.0',minzoom:0,maxzoom:16,tiles:['https://fixture.invalid/{z}/{x}/{y}']}});
  });
}
