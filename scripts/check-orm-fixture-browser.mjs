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
const errors=[],requests={metadata:0,tiles:0,missingReferer:[],missingUserAgent:[]};
await mkdir('browser-review',{recursive:true});
try {
  // This also fixtures fonts, imagery and the basemap, avoiding unrelated
  // external services during the browser integration check.
  await installEmptyMapProviders(context,base);
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
  console.log('PASS: Wuhan rail overlays at z6 and z7 from synthetic tiles, no public OpenRailwayMap downloads',JSON.stringify(requests));
}finally{
  await context.close();
  await browser.close();
}
