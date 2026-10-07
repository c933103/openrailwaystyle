// Policy-safe integration check: real Railway Atlas and MapLibre, but locally
// generated OpenRailwayMap-shaped tiles. NEVER download provider tiles in CI.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';

const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const line={type:'Feature',properties:{id:'fixture-wuhan-mainline',feature:'rail',railway:'rail',state:'present',usage:'main',service:'',maxspeed:250,gaugeint0:1435},
  geometry:{type:'LineString',coordinates:[[113.8,30.42],[114.35,30.58],[114.92,30.65]]}};
const indexes=Object.fromEntries(['speed_railway_line_low','standard_railway_line_low','railway_line_high'].map(layer=>[layer,
  geojsonvt({type:'FeatureCollection',features:[line]},{maxZoom:16,indexMaxZoom:7,extent:4096,buffer:64})]));
const browser=await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
const errors=[],requests={metadata:0,tiles:0,trackDependencies:[],missingReferer:[],missingUserAgent:[]};
await mkdir('browser-review',{recursive:true});
try {
  // This also fixtures fonts, imagery and the basemap, avoiding unrelated
  // external services during the browser integration check.
  await installEmptyMapProviders(context,base,{firstParty:process.env.MAP_BASE_URL?'network':'fixture'});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  // Page fixtures take precedence over the common context-level network guard.
  // Every would-be provider request is intercepted, including tile bodies.
  // Inspect the *actual browser-generated* headers without sending any request
  // to the public service, and without spoofing Referer or User-Agent.
  await page.route('https://openrailwaymap.app/**',async route=>{
    const request=route.request(),headers=await request.allHeaders(),url=new URL(request.url());
    const ref=headers.referer;
    if(!ref || new URL(ref).origin!==new URL(base).origin)requests.missingReferer.push(url.pathname);
    if(!headers['user-agent'])requests.missingUserAgent.push(url.pathname);
    const path=url.pathname;
    if(path.startsWith('/api/'))return route.fulfill({status:404,body:''});
    // atlastracks:// dependencies are direct provider-shaped z14 paths rather
    // than TileJSON-advertised fixture URLs. Fulfill them locally too, so the
    // real MapLibre viewport can measure request amplification without public
    // provider traffic.
    const countMatch=/^\/(railway_line_high|standard_railway_grouped_station_areas|standard_railway_text_stations)\/14\/(\d+)\/(\d+)$/.exec(path);
    if(countMatch){
      requests.trackDependencies.push(path);
      const [,endpoint,x,y]=countMatch,tile=indexes[endpoint]?.getTile(14,Number(x),Number(y));
      return route.fulfill({contentType:'application/x-protobuf',
        body:tile?Buffer.from(vtpbf.fromGeojsonVt({[endpoint]:tile},{version:2})):Buffer.alloc(0)});
    }
    const tileMatch=/^\/__orm-fixture\/([a-z_]+)\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(path);
    if(tileMatch){
      requests.tiles++;
      const [,endpoint,z,x,y]=tileMatch,tile=indexes[endpoint]?.getTile(Number(z),Number(x),Number(y));
      return route.fulfill({contentType:'application/x-protobuf',
        body:tile?Buffer.from(vtpbf.fromGeojsonVt({[endpoint]:tile},{version:2})):Buffer.alloc(0)});
    }
    requests.metadata++;
    const endpoint=path.split('/').filter(Boolean)[0];
    assert.match(endpoint||'',/^[a-z_]+$/,'Recognized fixture TileJSON endpoint: '+path);
    return route.fulfill({json:{tilejson:'3.0.0',minzoom:0,maxzoom:22,
      tiles:['https://openrailwaymap.app/__orm-fixture/'+endpoint+'/{z}/{x}/{y}.pbf']}});
  });
  await page.goto(base+'?mode=speed&language=en&relief=0&inactive=0&transport=0&destinations=0&constraints=0#6/30.55/114.4',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('body[data-map-ready="true"]',{timeout:90000});
  await page.evaluate(async()=>{window.fixtureMap=(await import(document.querySelector('script[type="module"]').src)).map;});
  const visible=id=>page.waitForFunction(id=>window.fixtureMap.queryRenderedFeatures({layers:[id]})
    .some(f=>f.properties.id==='fixture-wuhan-mainline'),id,{timeout:60000});
  await visible('speed-overview');
  await page.evaluate(()=>window.fixtureMap.jumpTo({center:[114.4,30.55],zoom:7}));
  await visible('speed-tracks');
  assert.ok(requests.metadata>0&&requests.tiles>0,'Railway metadata and synthetic tiles must both be requested');
  assert.deepEqual(requests.missingReferer,[], 'Chromium must send a genuine site-origin Referer for provider requests');
  assert.deepEqual(requests.missingUserAgent,[], 'Chromium must supply its own User-Agent');
  const attribution=await page.locator('.maplibregl-ctrl-attrib').innerText();
  // Collapsed attribution may not expose text until clicked.
  if(!attribution.includes('OpenRailwayMap'))await page.locator('.maplibregl-ctrl-attrib-button').click();
  assert.match(await page.locator('.maplibregl-ctrl-attrib').innerText(),/OpenRailwayMap/);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'browser-review/orm-fixture-wuhan-z7.png'});

  // Measure a real 1280x800 Infrastructure-view interaction at z14. The
  // request list records only atlastracks:// dependency URLs after get() has
  // applied its exact-URL in-flight sharing/cache, i.e. actual fixture-network
  // requests rather than the counter's logical candidates.
  requests.trackDependencies.length=0;
  await page.goto(base+'?mode=infrastructure&language=en&relief=0&inactive=0&transport=0&destinations=0&constraints=0#14/30.55/114.4',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('body[data-map-ready="true"]',{timeout:90000});
  await page.evaluate(async()=>{window.fixtureMap=(await import(document.querySelector('script[type="module"]').src)).map;});
  await page.waitForFunction(()=>window.fixtureMap.loaded(),null,{timeout:60000});
  const dependencySnapshot=()=>{
    const urls=[...requests.trackDependencies],byDataset={};
    for(const path of urls){const dataset=path.split('/')[1];byDataset[dataset]=(byDataset[dataset]||0)+1;}
    return {requests:urls.length,unique:new Set(urls).size,byDataset};
  };
  await page.waitForFunction(()=>window.fixtureMap.queryRenderedFeatures({layers:['infrastructure-track-count']}).length>0,null,{timeout:60000});
  const initial=dependencySnapshot();
  assert.equal(initial.requests,initial.unique,'shared/cache-completed track dependencies should not hit the fixture network twice');
  assert.ok(initial.requests<=65,`z14 fixture request amplification regressed: ${JSON.stringify(initial)}`);
  await page.evaluate(()=>new Promise(resolve=>{
    window.fixtureMap.once('idle',resolve);
    window.fixtureMap.panBy([512,0],{duration:0});
  }));
  const afterPan=dependencySnapshot(),panAdded=afterPan.requests-initial.requests;
  assert.equal(afterPan.requests,afterPan.unique,'one-tile pan must retain exact-URL request deduplication');
  assert.ok(panAdded<=13,`z14 one-tile pan amplification regressed: ${JSON.stringify({initial,afterPan,panAdded})}`);
  await page.screenshot({path:'browser-review/orm-fixture-wuhan-z14-track-count.png'});
  assert.deepEqual(requests.missingReferer,[], 'z14 dependency requests must keep genuine site-origin Referer');
  assert.deepEqual(requests.missingUserAgent,[], 'z14 dependency requests must keep genuine User-Agent');
  assert.deepEqual(errors,[]);
  console.log('PASS: Wuhan rail overlays at z6/z7; z14 track-count interaction used local fixtures only',
    JSON.stringify({initial,afterPan,panAdded,metadata:requests.metadata,tiles:requests.tiles}));
}finally{
  await context.close();
  await browser.close();
}
