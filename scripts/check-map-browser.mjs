import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const deadline=setTimeout(()=>{console.error('Browser validation exceeded ten minutes');process.exit(1);},600000);deadline.unref();
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
page.setDefaultTimeout(120000);
// Retain completed WebGL frames for reliable headless screenshots.
await page.addInitScript(()=>{
  const getContext=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(kind,options){
    return getContext.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);
  };
});
async function finishFrame(){
  // Flush camera/style changes before testing the new tile set. Require a
  // quiet network interval because custom protocols may start follow-up work.
  await page.evaluate(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    await new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint();});
  });
  const until=Date.now()+120000;
  let quietSince;
  while(Date.now()<until) {
    // Hidden sources can retain cancelled loading tiles. Readiness assertions
    // below inspect the visible features; do not wait on unrelated source flags.
    if(pendingRequests.size===0) {
      quietSince ||= Date.now();
      if(Date.now()-quietSince>1000) break;
    } else quietSince=undefined;
    await page.waitForTimeout(200);
  }
  assert.ok(quietSince && Date.now()-quietSince>1000,'Map requests should finish before screenshot: '+[...pendingRequests].map(r=>r.url()).join(', '));
  // A quiet network is not a finished map: workers still parse tiles and
  // symbols are placed over later frames. MapLibre fires 'idle' only once
  // tiles, placement and transitions are all complete.
  await page.evaluate(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    await Promise.race([new Promise(resolve=>{map.once('idle',resolve);map.triggerRepaint();}),new Promise(resolve=>setTimeout(resolve,30000))]);
  });
  // Finish fades first, then submit and finish the final GPU frame immediately
  // before capture, rather than letting another asynchronous frame replace it.
  await page.waitForTimeout(1000);
  await page.evaluate(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    await new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint();});
    const canvas=map.getCanvas();
    (canvas.getContext('webgl2')||canvas.getContext('webgl'))?.finish();
  });
}
// Rendered-feature queries only include placed symbols, so a single sample can
// land between frames. Require the condition within 30 s instead.
async function expectMap(condition,message){
  try { await page.waitForFunction(condition,undefined,{timeout:30000}); }
  catch(error) { if(error.name==='TimeoutError') throw new assert.AssertionError({message}); throw error; }
}
async function moveTo(zoom,lng,lat){
  await page.evaluate(async({zoom,lng,lat})=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    map.jumpTo({zoom,center:[lng,lat]});
  },{zoom,lng,lat});
}
const errors=[],requests=[],pendingRequests=new Set();
page.on('pageerror', e=>errors.push(e.message));
const requestStart=new Map();
page.on('request',req=>{requests.push(req.url());pendingRequests.add(req);requestStart.set(req,Date.now());});
// Glyph (font) ranges are needed before any label can be drawn.
page.on('requestfailed',req=>{if(req.url().includes('/fonts/')) console.log('Font request failed',req.failure()?.errorText,req.url().slice(-60));});
page.on('response',res=>{if(res.url().includes('/fonts/') && res.status()>=400) console.log('Font HTTP',res.status(),res.url().slice(-60));});
page.on('requestfinished',req=>pendingRequests.delete(req));
page.on('requestfailed',req=>{
  pendingRequests.delete(req);
  // Cancelled tiles are expected while panning; report real network failures.
  if(req.failure()?.errorText!=='net::ERR_ABORTED') console.log('Request failed:',req.failure()?.errorText,req.url().slice(0,200));
});
page.on('response',res=>{if(res.status()>=400) console.log('HTTP',res.status(),res.url().slice(0,200));});
// Basemap archive requests are byte ranges; log what was asked and returned.
let basemapLog=0;
const basemap=url=>url.includes('.pmtiles') && !url.startsWith('http://127.0.0.1');
page.on('request',req=>{if(basemap(req.url()) && basemapLog++<40) console.log('Basemap request',req.headers().range||'(no range)',req.url().slice(0,120));});
page.on('response',res=>{if(basemap(res.url()) && basemapLog++<40) {const h=res.headers();console.log('Basemap response',res.status(),'range',res.request().headers().range||'-','length',h['content-length'],'content-range',h['content-range'],'encoding',h['content-encoding']||'-');}});
page.on('requestfailed',req=>{if(basemap(req.url())) console.log('Basemap request failed',req.failure()?.errorText,req.headers().range||'-');});
page.on('console',msg=>{if(msg.type()==='error') console.log('Browser resource:',msg.text());});
await mkdir('browser-review',{recursive:true});
try{
  await page.goto((process.env.MAP_BASE_URL || 'http://127.0.0.1:4173/').replace(/\/?$/,'/')+'?v=20260926-3&language=ko#7/34.229/129.245');
  await page.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:120000});
  await page.waitForFunction(()=>+document.querySelector('#map-status').dataset.renderedTracks>0,undefined,{timeout:120000});
  // Pan northwest at the SAME zoom before any visit to zoom 8.
  await moveTo(7,128.1,35.65);
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return Math.abs(map.getCenter().lng-128.1)<0.01 && (map.getSource('inactiveRegional') && map.isSourceLoaded('inactiveRegional')) && document.querySelector('#map-status').dataset.lifecycleNames?.includes('남부내륙');
  },undefined,{timeout:120000});
  console.log('PASS: 남부내륙선 rendered after pan at zoom 7, before visiting zoom 8');
  console.log('Inspecting rendered line extent, stations and borders');
  const rendered = await page.evaluate(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const features=map.queryRenderedFeatures();
    const nambu=features.filter(f=>f.source==='inactiveRegional' && /남부내륙/.test(f.properties.name));
    const coordinates=nambu.flatMap(f=>f.geometry.type==='LineString'?f.geometry.coordinates:f.geometry.coordinates.flat());
    return {nambuWays:new Set(nambu.map(f=>f.properties.osm_id)).size,bbox:[Math.min(...coordinates.map(p=>p[0])),Math.min(...coordinates.map(p=>p[1])),Math.max(...coordinates.map(p=>p[0])),Math.max(...coordinates.map(p=>p[1]))],stations:features.filter(f=>f.layer.id.startsWith('station-')).length,borders:features.filter(f=>f.layer.id==='regional-borders').length};
  });
  console.log('Zoom7 rendered coverage',JSON.stringify(rendered));
  assert.ok(rendered.bbox[3]-rendered.bbox[1]>1,'The line must span its full regional extent at zoom 7');
  assert.ok(rendered.stations>0,'Selected regional stations must render');
  assert.ok(rendered.borders>0,'Subnational borders must render');
  assert.equal(requests.some(url=>url.includes('overpass')),false,'Panning must not query Overpass');
  // Hide panel to assess railway/station/boundary prominence on the full map.
  await page.locator('#collapse').click();
  await finishFrame();
  const shot=await page.screenshot({path:'browser-review/korea-z7.jpg',type:'jpeg',quality:45});
  console.log('REVIEW_IMAGE_START'+shot.toString('base64')+'REVIEW_IMAGE_END');
  await page.locator('#collapse').click();
  await page.selectOption('#language','en');
  await moveTo(10,128.12,35.17);
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return Math.abs(map.getZoom()-10)<0.01 && (map.getSource('railway') && map.isSourceLoaded('railway')) && map.queryRenderedFeatures().some(f=>f.layer.id.endsWith('-names') && !f.layer.id.startsWith('station-'));
  },undefined,{timeout:45000});
  console.log('PASS: railway names rendered at zoom 10');
  await finishFrame();
  const detail=await page.screenshot({path:'browser-review/korea-z10.jpg',type:'jpeg',quality:55});
  console.log('DETAIL_IMAGE_START'+detail.toString('base64')+'DETAIL_IMAGE_END');
  await page.selectOption('#language','fr');
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return (map.getSource('stations') && map.isSourceLoaded('stations')) && map.queryRenderedFeatures().some(f=>f.source==='stations' && f.properties.atlas_language==='fr' && !f.properties['name:fr'] && f.properties['name:en'] && f.properties.atlas_name===f.properties['name:en']);
  },undefined,{timeout:120000});
  console.log('PASS: French station labels use fetched English names when French is absent');
  await page.locator('[data-mode="infrastructure"]').click();
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const features=map.queryRenderedFeatures();
    return ['infrastructure-bridge-edge','infrastructure-tunnel'].every(id=>features.some(f=>f.layer.id===id));
  },undefined,{timeout:45000});
  console.log('PASS: bridge outlines and tunnel dashes render on real railway data');
  await finishFrame();
  const infrastructure=await page.screenshot({path:'browser-review/infrastructure.jpg',type:'jpeg',quality:55});
  console.log('STRUCTURE_IMAGE_START'+infrastructure.toString('base64')+'STRUCTURE_IMAGE_END');
  await moveTo(8,129.4,36.3);
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const contours=map.queryRenderedFeatures().filter(f=>f.layer.id==='terrain-contours');
    return Math.abs(map.getCenter().lng-129.4)<0.01 && (map.getSource('contours') && map.isSourceLoaded('contours')) && contours.some(f=>f.properties.ele<0) && contours.some(f=>f.properties.ele>0);
  },undefined,{timeout:120000});
  console.log('PASS: both land elevation and negative seabed contours rendered');
  await finishFrame();
  await expectMap(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const features=map.queryRenderedFeatures().filter(f=>f.source==='contours');
    return features.some(f=>f.layer.id==='terrain-contour-labels');
  },'Major contours should have visible elevation labels');
  console.log('PASS: labelled major contours');
  await expectMap(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const features=map.queryRenderedFeatures();
    return features.some(f=>f.layer.id==='water') && features.filter(f=>f.layer.id.startsWith('station-')).length>5;
  },'Completed contour view must retain basemap water and station symbols');
  const contours=await page.screenshot({path:'browser-review/contours.jpg',type:'jpeg',quality:55});
  console.log('CONTOUR_IMAGE_START'+contours.toString('base64')+'CONTOUR_IMAGE_END');
  console.log('Checking display controls');
  await page.locator('.display-options summary').click();
  await page.locator('#inactive').uncheck();
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return map.getLayoutProperty('inactive-regional','visibility')==='none' && !map.queryRenderedFeatures().some(f=>f.source==='inactiveRegional');
  },undefined,{timeout:30000});
  await page.locator('#inactive').check();
  await page.locator('#relief').uncheck();
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return map.getLayoutProperty('terrain-contours','visibility')==='none' && !map.queryRenderedFeatures().some(f=>f.source==='contours');
  },undefined,{timeout:30000});
  await page.locator('#relief').check();
  assert.equal(await page.locator('.language-picker select').count(),1);
  assert.equal(await page.locator('#region').count(),0);
  assert.ok(requests.some(url=>url.includes('terrarium')),'Relief source requested');
  assert.ok(requests.some(url=>url.includes('standard_railway_text_stations')&&url.includes('lang=en')),'Translated station tiles requested');
  await page.selectOption('#language','zh-Hant');
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return (map.getSource('stations') && map.isSourceLoaded('stations')) && map.queryRenderedFeatures().some(f=>f.source==='stations' && f.properties.atlas_language==='zh-Hant' && /\p{Script=Hangul}/u.test(f.properties.name||'') && /\p{Script=Han}/u.test(f.properties.atlas_name||''));
  },undefined,{timeout:120000});
  console.log('PASS: Chinese language selects recorded ideographic names for Korean stations');
  console.log('Checking China regional map');
  await page.selectOption('#language','zh-Hans');
  await moveTo(7,116.4,30.5);
  await page.waitForFunction(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return Math.abs(map.getCenter().lng-116.4)<0.01 && Math.abs(map.getZoom()-7)<0.01 && !map.isMoving() && ['stationMed','openmaptiles','railway','relief'].every(id=>map.getSource(id) && map.isSourceLoaded(id)) && map.queryRenderedFeatures().filter(f=>f.layer.id.startsWith('station-') && f.geometry.type==='Point' && f.geometry.coordinates[0]>110 && f.geometry.coordinates[0]<125).length>5;
  },undefined,{timeout:120000});
  await page.locator('#collapse').click();
  await finishFrame();
  await expectMap(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return map.queryRenderedFeatures().filter(f=>f.layer.id.startsWith('station-') && f.properties.atlas_language==='zh-Hans').length>5;
  },'Completed Chinese view must retain station labels');
  assert.equal(await page.locator('#map-status.error').count(),0,'Cancelled old requests must not leave a load-failure warning');
  const china=await page.screenshot({path:'browser-review/china-z7.jpg',type:'jpeg',quality:45});
  console.log('CHINA_IMAGE_START'+china.toString('base64')+'CHINA_IMAGE_END');
  assert.deepEqual(errors,[]);
  console.log('PASS: one shared language, name fallbacks, contours, structures and lifecycle controls; no JavaScript exceptions');
} catch(error) {
  console.log('Failure diagnostics',await page.evaluate(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return {zoom:map.getZoom(),stationSources:['stationLow','stationMed','stations'].map(id=>({id,loaded:map.isSourceLoaded(id),url:map.getStyle().sources[id].url,features:map.querySourceFeatures(id).slice(0,3).map(f=>f.properties)})),renderedStations:map.queryRenderedFeatures().filter(f=>f.layer.id.startsWith('station-')).slice(0,10).map(f=>({source:f.source,properties:f.properties})),status:document.querySelector('#map-status').dataset, layers:map.getStyle().layers.filter(l=>l.id.endsWith('-names') && !l.id.startsWith('station-')), named:map.queryRenderedFeatures().filter(f=>['inactiveRegional','railway'].includes(f.source)&&f.properties.name).slice(0,12).map(f=>({layer:f.layer.id,name:f.properties.name}))};
  }));
  // MapLibre internals: which tiles each source holds and whether they can
  // still be queried. Compare queries before and after a forced redraw.
  const internals=async()=>page.evaluate(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const caches=map.style.sourceCaches||map.style.tileManagers||{};
    const sources={};
    for(const id of ['railway','stationMed','stations','openmaptiles','inactiveRegional']) {
      const cache=caches[id];
      const tiles=Object.values(cache?._tiles||{});
      sources[id]={loaded:cache?.loaded(),tiles:tiles.map(t=>`${t.tileID.canonical.z}/${t.tileID.canonical.x}/${t.tileID.canonical.y} ${t.state}${t.latestFeatureIndex?'':' no-index'}${t.latestFeatureIndex&&!t.latestFeatureIndex.rawTileData?' no-raw':''}`).slice(0,12),
        queried:map.queryRenderedFeatures().filter(f=>f.source===id).length};
    }
    return {mapLoaded:map.loaded(),styleLoaded:map.isStyleLoaded(),moving:map.isMoving(),language:new URL(location.href).searchParams.get('language'),sources};
  });
  console.log('Page errors so far',JSON.stringify(errors));
  console.log('Requests still pending',JSON.stringify([...pendingRequests].map(r=>`${Math.round((Date.now()-requestStart.get(r))/1000)}s ${r.url().slice(0,160)}`)));
  console.log('Font requests made',requests.filter(u=>u.includes('/fonts/')).length);
  console.log('Map internals',JSON.stringify(await internals()));
  await page.evaluate(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    await new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint();});
  });
  await page.waitForTimeout(5000);
  console.log('Map internals after redraw',JSON.stringify(await internals()));
  const failure=await page.screenshot({path:'browser-review/failure.jpg',type:'jpeg',quality:45});
  console.log('FAIL_IMAGE_START'+failure.toString('base64')+'FAIL_IMAGE_END');
  throw error;
} finally {await browser.close();}
