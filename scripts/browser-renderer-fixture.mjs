import {pmtilesFixtureResponse} from './pmtiles-browser-fixture.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {BROWSER_LIBRARIES} from './browser-libraries.mjs';
import {gzipSync} from 'node:zlib';

// Empty, explicitly synthetic reference wire responses for unrelated UI
// checks. Real source acceptance uses the published pipeline and never this.
const referenceGeneration='0'.repeat(24),referenceEmpty=gzipSync(Buffer.from([26,0]));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const referenceIndex=JSON.stringify({schema:1,complete:true,generation:referenceGeneration,
 tiles:[{key:'0/0/0',bytes:referenceEmpty.length,sha256:hash(referenceEmpty)}]});
const referenceManifest={schema:1,complete:true,generation:referenceGeneration,minzoom:0,maxzoom:6,
 license:'ODbL-1.0',wayCount:1,oldestSource:'2026-10-09T20:00:00Z',newestSource:'2026-10-09T20:00:00Z',
 sources:Array.from({length:8},()=>({source:'empty synthetic UI wire fixture'})),indexSha256:hash(referenceIndex)};

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
const latinGlyphs = readFile(new URL('../tests/fixtures/browser-glyphs/0-255.pbf', import.meta.url));

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
      if(path.endsWith('/data/mainline-reference/manifest.json'))return route.fulfill({json:referenceManifest});
      if(path.includes('/data/mainline-reference/')&&path.endsWith('/index.json'))return route.fulfill({contentType:'application/json',body:referenceIndex});
      if(path.includes('/data/mainline-reference/')&&path.endsWith('.pbf.gz'))return route.fulfill({contentType:'application/octet-stream',body:referenceEmpty});
      if(path.includes('/data/polar/'))return route.fulfill({status:404,body:''});
      if(path.includes('/data/'))return route.fulfill({json:{tiles:[],features:[],countries:{}}});
      return route.continue();
    }
    if(path.endsWith('.pmtiles'))return route.fulfill(pmtilesFixtureResponse(route.request().headers().range));
    if(/\.(png|jpg|jpeg)$/.test(path))return route.fulfill({contentType:'image/png',body:png});
    if(path.includes('/fonts/'))return route.fulfill({contentType:'application/x-protobuf',body:await latinGlyphs});
    if(/\/\d+\/\d+\/\d+(?:\.pbf)?$|\/fonts\//.test(path))return route.fulfill({contentType:'application/x-protobuf',body:Buffer.alloc(0)});
    return route.fulfill({json:{tilejson:'3.0.0',minzoom:0,maxzoom:16,tiles:['https://fixture.invalid/{z}/{x}/{y}']}});
  });
}
