// Policy-safe integration check: real Railway Atlas and MapLibre, but locally
// generated OpenRailwayMap-shaped tiles. NEVER download provider tiles in CI.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {RAIL_TILE_RANGES} from '../styles/rail-source-catalog.mjs';
import {checkRailRecoveryWithoutIdle} from './rail-recovery-browser-fixture.mjs';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';

const base=(process.env.ATLAS_FIXTURE_BASE_URL||process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const line={type:'Feature',properties:{id:'fixture-wuhan-mainline',feature:'rail',railway:'rail',state:'present',usage:'main',service:'',maxspeed:250,gaugeint0:1435},
  geometry:{type:'LineString',coordinates:[[113.8,30.42],[114.35,30.58],[114.92,30.65]]}};
const indexes=Object.fromEntries(['speed_railway_line_low','standard_railway_line_low','railway_line_high'].map(layer=>[layer,
  geojsonvt({type:'FeatureCollection',features:[line]},{maxZoom:16,indexMaxZoom:7,extent:4096,buffer:64})]));
const browser=await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
const outage={enabled:false,allowSuccess:false,path:null,otherPath:null,recoveredPaths:new Set()},ledger=[];
const errors=[],requests={metadata:0,tiles:0,trackDependencies:[],localizedStationTiles:[],missingReferer:[],missingUserAgent:[]};
await mkdir('browser-review',{recursive:true});
try {
  // This also fixtures fonts, imagery and the basemap, avoiding unrelated
  // external services during the browser integration check.
  await installEmptyMapProviders(context,base,{firstParty:process.env.MAP_BASE_URL?'network':'fixture'});
  const page=await context.newPage();
  const outstanding=new Set(),firstPartyFailures=[];
  page.on('request',request=>outstanding.add(request));
  page.on('requestfinished',request=>{outstanding.delete(request);ledger.push({event:'finished',url:request.url(),at:Date.now()});});
  page.on('requestfailed',request=>{
    outstanding.delete(request);ledger.push({event:'failed',url:request.url(),failure:request.failure(),at:Date.now()});
    if(request.url().startsWith(base))firstPartyFailures.push({url:request.url(),failure:request.failure()});
  });
  page.on('response',response=>{
    if(new URL(response.url()).pathname.endsWith('.pmtiles'))ledger.push({event:'archive-response',url:response.url(),status:response.status(),range:response.request().headers().range,headers:response.headers(),at:Date.now()});
    if(response.url().startsWith(base)&&response.status()>=400)firstPartyFailures.push({url:response.url(),status:response.status()});
  });
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')ledger.push({event:'console-error',text:message.text(),at:Date.now()});});
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
    const tileMatch=/^\/(?:__orm-fixture\/)?([a-z_]+)\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?$/.exec(path);
    if(tileMatch){
      requests.tiles++;
      const [,endpoint,z,x,y]=tileMatch,tile=indexes[endpoint]?.getTile(Number(z),Number(x),Number(y));
      // The local catalogue now gives visible rail geometry the SAME direct
      // URLs as track-count inputs. Count their union after pool sharing.
      // Localized station display requests (?lang=...) were excluded by the
      // old /__orm-fixture split and remain separately recorded, not mistaken
      // for duplicate raw station inputs. Preserve the 65/+13 ceilings.
      if(z==='14'&&endpoint==='standard_railway_text_stations'&&url.search)requests.localizedStationTiles.push(path+url.search);
      if(z==='14'&&!url.search&&['railway_line_high','standard_railway_grouped_station_areas','standard_railway_text_stations'].includes(endpoint))requests.trackDependencies.push(path);
      if(outage.enabled&&endpoint==='railway_line_high'&&z==='7'){
        if(tile?.features.length)outage.path ||= path;
        else outage.otherPath ||= path;
        if([outage.path,outage.otherPath].includes(path))await outage.waitForRetry?.(path);
        if([outage.path,outage.otherPath].includes(path)&&!outage.allowSuccess&&!outage.recoveredPaths.has(path)){
          ledger.push({url:request.url(),path,status:520,at:Date.now()});
          return route.fulfill({status:520,body:'synthetic temporary rail outage'});
        }
      }
      ledger.push({url:request.url(),path,status:200,at:Date.now()});
      return route.fulfill({contentType:'application/x-protobuf',
        body:tile?.features.length?Buffer.from(vtpbf.fromGeojsonVt({[endpoint]:tile},{version:2})):Buffer.alloc(0)});
    }
    requests.metadata++;
    const endpoint=path.split('/').filter(Boolean)[0];
    assert.ok(!Object.hasOwn(RAIL_TILE_RANGES,endpoint),'Known catalogue source must not fetch metadata: '+endpoint);
    ledger.push({url:request.url(),path,status:200,metadata:true,at:Date.now()});
    assert.match(endpoint||'',/^[a-z_]+$/,'Recognized fixture TileJSON endpoint: '+path);
    return route.fulfill({json:{tilejson:'3.0.0',minzoom:0,maxzoom:22,
      tiles:['https://openrailwaymap.app/__orm-fixture/'+endpoint+'/{z}/{x}/{y}.pbf']}});
  });
  await page.goto(base+'?mode=speed&language=en&relief=0&inactive=0&transport=0&destinations=0&constraints=0#6/30.55/114.4',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('body[data-map-ready="true"]',{timeout:90000});
  await page.evaluate(async()=>{window.fixtureMap=(await import(document.querySelector('script[type="module"]').src)).map;});
  // Negative control: the former generic TileJSON fallback must fail in the
  // real client. This archive is not attached to the map or its error state.
  if(process.env.MAP_BASE_URL)await page.route('https://fixture.invalid/invalid.pmtiles',route=>route.fulfill({json:{tilejson:'3.0.0',minzoom:0,maxzoom:16,tiles:['https://fixture.invalid/{z}/{x}/{y}']}}));
  const archiveContract=process.env.MAP_BASE_URL?await page.evaluate(async()=>{
    const archive=new pmtiles.PMTiles('https://tuiles.enliberte.fr/planet.pmtiles');
    const header=await archive.getHeader(),metadata=await archive.getMetadata(),tile=await archive.getZxy(0,0,0),missing=await archive.getZxy(7,104,52);
    let rejected;try{await new pmtiles.PMTiles('https://fixture.invalid/invalid.pmtiles').getHeader();}catch(error){rejected=error.message;}
    return {rejected,version:header.specVersion,entries:header.numTileEntries,metadata,bytes:tile.data.byteLength,missing:missing===undefined};
  }):null;
  if(archiveContract)assert.deepEqual(archiveContract,{rejected:'Wrong magic number for PMTiles archive',version:3,entries:1,metadata:{vector_layers:[]},bytes:0,missing:true});
  const visible=id=>page.waitForFunction(id=>window.fixtureMap.queryRenderedFeatures({layers:[id]})
    .some(f=>f.properties.id==='fixture-wuhan-mainline'),id,{timeout:60000});
  await visible('speed-overview');
  await page.evaluate(()=>window.fixtureMap.jumpTo({center:[114.4,30.55],zoom:7}));
  await visible('speed-tracks');
  assert.equal(requests.metadata,0,'Known catalogue sources require zero metadata requests');
  assert.ok(requests.tiles>0,'Synthetic railway tiles must be requested');
  assert.deepEqual(requests.missingReferer,[], 'Chromium must send a genuine site-origin Referer for provider requests');
  assert.deepEqual(requests.missingUserAgent,[], 'Chromium must supply its own User-Agent');
  const attribution=await page.locator('.maplibregl-ctrl-attrib').innerText();
  // Collapsed attribution may not expose text until clicked.
  if(!attribution.includes('OpenRailwayMap'))await page.locator('.maplibregl-ctrl-attrib-button').click();
  assert.match(await page.locator('.maplibregl-ctrl-attrib').innerText(),/OpenRailwayMap/);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'browser-review/orm-fixture-wuhan-z7.png'});

  // Measure a real 1280x800 Infrastructure-view interaction at z14. The
  // request list records the union of direct z14 geometry/dependency URLs after get() has
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
  // The request set is the regression subject. MapLibre may legitimately
  // collision-hide every track-count symbol, so do not gate the measurement on
  // queryRenderedFeatures(); loaded() above waits for the requested source work.
  const initial=dependencySnapshot();

  assert.ok(initial.requests>0,'z14 Infrastructure interaction must exercise track-count dependencies');
  assert.equal(initial.requests,initial.unique,'shared/cache-completed track dependencies should not hit the fixture network twice');
  assert.ok(initial.requests<=65,`z14 fixture request amplification regressed: ${JSON.stringify(initial)}`);
  try {
    await page.evaluate(()=>new Promise((resolve,reject)=>{
      const map=window.fixtureMap,mapErrors=[];
      const onError=event=>mapErrors.push({sourceId:event.sourceId,message:event.error?.message});
      const cleanup=()=>{clearTimeout(timer);map.off('idle',onIdle);map.off('error',onError);};
      const onIdle=()=>{cleanup();resolve();};
      // loaded() can be true with errored tiles; keep the genuine idle gate,
      // but make missing/broken deployed data fail with evidence, not hang.
      const timer=setTimeout(()=>{
        const state={loaded:map.loaded(),tilesLoaded:map.areTilesLoaded(),moving:map.isMoving(),
          sources:Object.fromEntries(Object.keys(map.getStyle().sources).map(id=>[id,map.isSourceLoaded(id)])),mapErrors};
        cleanup();reject(new Error('Map did not become idle within 60000ms after pan: '+JSON.stringify(state)));
      },60000);
      map.on('error',onError);
      map.once('idle',onIdle);
      map.panBy([512,0],{duration:0});
    }));
  } catch(error) {
    throw new Error(error.message+'; browser diagnostics: '+JSON.stringify({
      outstanding:[...outstanding].map(request=>request.url()),firstPartyFailures,pageErrors:errors,
    }),{cause:error});
  }
  const afterPan=dependencySnapshot(),panAdded=afterPan.requests-initial.requests;
  assert.equal(afterPan.requests,afterPan.unique,'one-tile pan must retain exact-URL request deduplication');
  assert.ok(panAdded<=13,`z14 one-tile pan amplification regressed: ${JSON.stringify({initial,afterPan,panAdded})}`);
  await page.screenshot({path:'browser-review/orm-fixture-wuhan-z14-track-count.png'});
  assert.deepEqual(requests.missingReferer,[], 'z14 dependency requests must keep genuine site-origin Referer');
  assert.deepEqual(requests.missingUserAgent,[], 'z14 dependency requests must keep genuine User-Agent');
  assert.deepEqual(errors,[]);
  assert.equal(requests.metadata,0,'All catalogue sources still bypass metadata through z14 and pan');
  const recovery=await checkRailRecoveryWithoutIdle({page,base,outage,setupDelay:Number(process.env.FIXTURE_SETUP_DELAY)||0,captureDelay:Number(process.env.FIXTURE_CAPTURE_DELAY)||0});
  assert.equal(requests.metadata,1,'Only the explicit unknown endpoint fetched metadata');
  assert.deepEqual(errors,[]);
  assert.deepEqual(requests.missingReferer,[]);assert.deepEqual(requests.missingUserAgent,[]);
  await writeFile('browser-review/orm-fixture-evidence.json',JSON.stringify({base,archiveContract,initial,afterPan,panAdded,recovery,requests,ledger},null,2)+'\n');
  console.log('PASS: Wuhan rail overlays at z6/z7; z14 track-count interaction used local fixtures only',
    JSON.stringify({initial,afterPan,panAdded,metadata:requests.metadata,tiles:requests.tiles}));
}finally{
  await writeFile('browser-review/orm-network-ledger.json',JSON.stringify(ledger,null,2)+'\n');
  await context.close();
  await browser.close();
}
