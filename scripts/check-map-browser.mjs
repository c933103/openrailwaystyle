import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {waitUntil,setDefaultTimeout} from './wait-until.mjs';
const deadline=setTimeout(()=>{console.error('Browser validation exceeded ten minutes');process.exit(1);},600000);deadline.unref();
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
setDefaultTimeout(page,120000);
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
async function expectMap(condition,message,argument){
  try { await page.waitForFunction(condition,argument,{timeout:30000}); }
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
page.on('request',req=>{
  requests.push(req.url());requestStart.set(req,Date.now());
  // Cancelling a count terminates its worker. Chromium can omit the finish
  // event for that worker's startup script; these entries never settle.
  // Rendered count assertions below verify that required workers execute.
  if(!/\/vendor\/track-worker\.js(?:\?|$)/.test(req.url()))pendingRequests.add(req);
});
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
page.on('console',msg=>{if(msg.type()==='error') { console.log('Browser resource:',msg.text()); if(/DataCloneError|already detached/.test(msg.text())) errors.push(msg.text()); }});
await mkdir('browser-review',{recursive:true});
try{
  await page.goto((process.env.MAP_BASE_URL || 'http://127.0.0.1:4173/').replace(/\/?$/,'/')+'?v=20261003-82&mode=speed&language=ko#7/34.229/129.245',{waitUntil:'domcontentloaded'});
  // Controls must respond while the map is still loading.
  await page.locator('#about-open').click();
  const earlyReady=await page.evaluate(()=>document.body.dataset.mapReady==='true');
  assert.equal(await page.locator('dialog#about[open]').count(),1,'About must open before the map has loaded');
  assert.match(await page.locator('dialog#about').innerText(),/Licences[\s\S]*Terms of use[\s\S]*Restricted territories/,'help page holds the licences and the terms of use');
  const hashBefore=await page.evaluate(()=>location.hash);
  await page.locator('dialog#about .help-contents a[href="#help-terms"]').click();
  assert.equal(await page.evaluate(()=>location.hash),hashBefore,'help contents links keep the map position in the address');
  await page.locator('#about-close').click();
  console.log(`PASS: About opened while loading (map ready at click: ${earlyReady})`);
  await page.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:120000});
  await page.waitForFunction(()=>+document.querySelector('#map-status').dataset.renderedTracks>0,undefined,{timeout:120000});
  // The bottom-right info/attribution control starts closed on a first visit,
  // records manual open/close state in the settings cookie, and restores that
  // state when the compact control is recreated.
  const attributionState=()=>page.locator('.maplibregl-ctrl-attrib').evaluate(el=>({compact:el.classList.contains('maplibregl-compact'),open:el.classList.contains('maplibregl-compact-show')}));
  assert.deepEqual(await attributionState(),{compact:true,open:false},'Attribution info starts compact and closed');
  await page.locator('.maplibregl-ctrl-attrib-button').click();
  assert.equal((await attributionState()).open,true,'The info button opens attribution');
  let settingsCookie=(await page.context().cookies()).find(c=>c.name==='atlas_settings');
  assert.equal(JSON.parse(decodeURIComponent(settingsCookie.value)).attributionOpen,true,'Open attribution is remembered in the settings cookie');
  await page.locator('[data-background="carto"]').click();
  assert.equal((await attributionState()).compact,false,'Carto keeps its full attribution');
  await page.locator('[data-background="map"]').click();
  assert.deepEqual(await attributionState(),{compact:true,open:true},'Remembered attribution state survives control recreation');
  await page.locator('.maplibregl-ctrl-attrib-button').click();
  assert.equal((await attributionState()).open,false,'The info button closes attribution');
  settingsCookie=(await page.context().cookies()).find(c=>c.name==='atlas_settings');
  assert.equal(JSON.parse(decodeURIComponent(settingsCookie.value)).attributionOpen,false,'Closed attribution is remembered in the settings cookie');
  console.log('PASS: attribution info starts closed and remembers open/closed state');
  // Pan northwest at the SAME zoom before any visit to zoom 8.
  await moveTo(7,128.1,35.65);
  await waitUntil(page,async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    // The borders below come from the basemap, which can load after the railway.
    return Math.abs(map.getCenter().lng-128.1)<0.01 && (map.getSource('inactiveRegional') && map.isSourceLoaded('inactiveRegional')) && map.isSourceLoaded('openmaptiles') && document.querySelector('#map-status').dataset.lifecycleNames?.includes('남부내륙');
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
  await waitUntil(page,async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return Math.abs(map.getZoom()-10)<0.01 && (map.getSource('railway') && map.isSourceLoaded('railway')) && map.queryRenderedFeatures().some(f=>f.layer.id.endsWith('-names') && !f.layer.id.startsWith('station-'));
  },undefined,{timeout:45000});
  console.log('PASS: railway names rendered at zoom 10');
  await finishFrame();
  const detail=await page.screenshot({path:'browser-review/korea-z10.jpg',type:'jpeg',quality:55});
  console.log('DETAIL_IMAGE_START'+detail.toString('base64')+'DETAIL_IMAGE_END');
  await page.selectOption('#language','fr');
  await waitUntil(page,async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return (map.getSource('stations') && map.isSourceLoaded('stations')) && map.queryRenderedFeatures().some(f=>f.source==='stations' && f.properties.atlas_language==='fr' && !f.properties['name:fr'] && f.properties['name:en'] && f.properties.atlas_name===f.properties['name:en']);
  },undefined,{timeout:120000});
  console.log('PASS: French station labels use fetched English names when French is absent');
  await page.locator('[data-mode="infrastructure"]').click();
  await waitUntil(page,async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const features=map.queryRenderedFeatures();
    return ['structure-bridge-edge','structure-tunnel'].every(id=>features.some(f=>f.layer.id===id));
  },undefined,{timeout:45000});
  console.log('PASS: bridge outlines and tunnel dashes render on real railway data');
  await finishFrame();
  const infrastructure=await page.screenshot({path:'browser-review/infrastructure.jpg',type:'jpeg',quality:55});
  console.log('STRUCTURE_IMAGE_START'+infrastructure.toString('base64')+'STRUCTURE_IMAGE_END');
  // Tracks side by side, counted from the mapped geometry: Tokyo station.
  await moveTo(14,139.7690,35.6870);
  await expectMap(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const labels=map.queryRenderedFeatures({layers:['infrastructure-track-count']});
    const stations=map.queryRenderedFeatures({layers:['infrastructure-station-tracks']});
    return labels.some(f=>f.properties.tracks>=4) && labels.some(f=>f.properties.tracks===2) && stations.some(f=>f.properties.tracks>=15);
  },'Track-count labels, and Tokyo station\'s own count, must render near Tokyo station');
  console.log('PASS: tracks side by side and at stations are labelled');
  await moveTo(10,128.12,35.17);
  // Bridges and tunnels are marked in every view, not only Infrastructure.
  await page.locator('[data-mode="gauge"]').click();
  await expectMap(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const features=map.queryRenderedFeatures();
    return map.getLayoutProperty('infrastructure-tracks','visibility')==='none' && features.some(f=>f.layer.id==='structure-bridge-edge') && features.some(f=>f.layer.id==='gauge-tracks' && f.properties.gaugeint0>0);
  },'Gauge view must draw gauges with bridge outlines');
  console.log('PASS: gauge view with bridges');
  // Train control: central Germany mixes PZB, LZB and ETCS; the legend lists
  // the systems in view.
  await page.locator('[data-mode="control"]').click();
  await moveTo(6,10,50.5);
  await expectMap(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const codes=new Set(map.queryRenderedFeatures({layers:['control-overview']}).map(f=>f.properties.train_protection0));
    const legend=document.getElementById('legend').textContent;
    return codes.has('pzb') && legend.includes('PZB') && legend.includes('LZB');
  },'Train control view must colour PZB/LZB lines and list them in the legend');
  console.log('PASS: train control view and in-view legend');
  await page.locator('[data-mode="electrification"]').click();
  await moveTo(6,4,47);
  await expectMap(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const hz=new Set(map.queryRenderedFeatures({layers:['electrification-overview']}).map(f=>f.properties.frequency));
    return hz.has(0) && hz.has(50) && document.getElementById('legend').textContent.includes('AC 50 Hz');
  },'Power view must show DC and 50 Hz AC lines in France');
  console.log('PASS: power view separates AC and DC');
  // Loading gauge: British W gauges and UIC GC near London; legend names them.
  await page.locator('[data-mode="loading"]').click();
  await moveTo(9,-0.5,51.6);
  await expectMap(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const values=new Set(map.queryRenderedFeatures({layers:['loading-tracks']}).map(f=>f.properties.loading_gauge).filter(Boolean));
    const legend=document.getElementById('legend').textContent;
    return values.size>1 && /W\d/.test(legend);
  },'Loading gauge view must colour recorded gauges and name them in the legend');
  console.log('PASS: loading gauge view');
  await page.locator('[data-mode="infrastructure"]').click();
  await moveTo(8,129.4,36.3);
  await waitUntil(page,async()=>{
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
  // The elevation tiles hold seabed depths only up to zoom 10; seabed
  // contours at zoom 12 over the Taiwan Strait (34–92 m deep) prove the
  // zoom-10 data is used there.
  await moveTo(12,119.5,24.5);
  await expectMap(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return !map.isMoving() && map.queryRenderedFeatures().some(f=>f.layer.id==='terrain-seabed-contours-close' && f.properties.ele<0);
  },'Seabed contours must render at zoom 12 in the Taiwan Strait');
  await moveTo(6,119.8,24.3);
  await expectMap(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return !map.isMoving() && map.queryRenderedFeatures().some(f=>f.layer.id==='terrain-seabed-contours' && f.properties.ele===-50);
  },'Shelf contours must render at zoom 6 over the Taiwan Strait');
  console.log('PASS: seabed contours at zooms 6 and 12');
  await moveTo(8,129.4,36.3);
  await expectMap(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const features=map.queryRenderedFeatures();
    return features.some(f=>f.layer.id==='water') && features.filter(f=>f.layer.id.startsWith('station-')).length>5;
  },'Completed contour view must retain basemap water and station symbols');
  const contours=await page.screenshot({path:'browser-review/contours.jpg',type:'jpeg',quality:55});
  console.log('CONTOUR_IMAGE_START'+contours.toString('base64')+'CONTOUR_IMAGE_END');
  console.log('Checking display controls');
  await page.locator('#settings-open').click();
  assert.equal(await page.locator('#main-view').isHidden(),true,'settings replace the map controls');
  await page.locator('#inactive').uncheck();
  await waitUntil(page,async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return map.getLayoutProperty('inactive-regional-construction','visibility')==='none' && !map.queryRenderedFeatures().some(f=>f.source==='inactiveRegional');
  },undefined,{timeout:30000});
  await page.locator('#inactive').check();
  await page.locator('#relief').uncheck();
  await waitUntil(page,async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return map.getLayoutProperty('terrain-contours','visibility')==='none' && !map.queryRenderedFeatures().some(f=>f.source==='contours');
  },undefined,{timeout:30000});
  await page.locator('#relief').check();
  await page.locator('#settings-close').click();
  assert.equal(await page.locator('.language-picker select').count(),1);
  assert.equal(await page.locator('#region').count(),0);
  assert.ok(requests.some(url=>url.includes('terrarium')),'Relief source requested');
  assert.ok(requests.some(url=>url.includes('standard_railway_text_stations')&&url.includes('lang=en')),'Translated station tiles requested');
  await page.selectOption('#language','zh-Hant');
  await waitUntil(page,async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return (map.getSource('stations') && map.isSourceLoaded('stations')) && map.queryRenderedFeatures().some(f=>f.source==='stations' && f.properties.atlas_language==='zh-Hant' && /\p{Script=Hangul}/u.test(f.properties.name||'') && /\p{Script=Han}/u.test(f.properties.atlas_name||''));
  },undefined,{timeout:120000});
  console.log('PASS: Chinese language selects recorded ideographic names for Korean stations');
  console.log('Checking China regional map');
  await page.selectOption('#language','zh-Hans');
  await moveTo(7,116.4,30.5);
  await waitUntil(page,async()=>{
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
  // The panel stays collapsed from the China view until the units check.
  console.log('Checking mouse panning over a dense city, compass and units');
  await moveTo(12,139.765,35.68);
  await waitUntil(page,async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return !map.isMoving() && ['stations','railway','openmaptiles'].every(id=>map.getSource(id) && map.isSourceLoaded(id)) && map.queryRenderedFeatures().filter(f=>f.layer.id.startsWith('station-')).length>10;
  },undefined,{timeout:120000});
  const centre=()=>page.evaluate(async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);const c=map.getCenter();return [c.lng,c.lat];});
  const before=await centre(), started=Date.now();
  await page.mouse.move(900,450); await page.mouse.down();
  for(let i=1;i<=30;i++) await page.mouse.move(900-i*8,450-i*4);
  await page.mouse.up();
  await page.waitForTimeout(800);
  const after=await centre();
  console.log('Mouse drag over Tokyo',Date.now()-started,'ms',JSON.stringify(before),'→',JSON.stringify(after));
  assert.ok(Math.abs(after[0]-before[0])>0.005,'A mouse drag must pan the map in a dense area');
  const compass=await page.locator('.maplibregl-ctrl-compass').boundingBox(), zoomIn=await page.locator('.maplibregl-ctrl-zoom-in').boundingBox();
  assert.ok(compass && zoomIn && compass.y<zoomIn.y,'The compass sits above the zoom buttons');
  await page.evaluate(async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);map.setBearing(40);});
  await page.locator('.maplibregl-ctrl-compass').click();
  await waitUntil(page,async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);return Math.abs(map.getBearing())<0.5 && !map.isMoving();},undefined,{timeout:10000});
  console.log('PASS: compass resets north');
  await page.locator('#collapse').click();
  await page.locator('[data-mode="speed"]').click();
  await page.selectOption('#units','imperial');
  assert.match(await page.locator('#legend').textContent(),/mph/);
  assert.match(await page.locator('.maplibregl-ctrl-scale').textContent(),/ft|mi/);
  await waitUntil(page,async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);return JSON.stringify(map.getLayoutProperty('speed-labels','text-field')).includes('mph');},undefined,{timeout:10000});
  await page.selectOption('#units','metric');
  assert.match(await page.locator('.maplibregl-ctrl-scale').textContent(),/km|\bm\b/);
  console.log('PASS: units switch legend, scale bar and speed labels');
  await page.locator('#copy-coordinates').click();
  await page.waitForFunction(()=>/Map centre copied: -?\d+\.\d{6}, -?\d+\.\d{6}|coordinates/.test(document.querySelector('#share-status').textContent+(document.querySelector('#share-status input')?.value||'')));
  const coordinateText=await page.evaluate(()=>document.querySelector('#share-status input')?.value || document.querySelector('#share-status').textContent);
  assert.match(coordinateText,/-?\d+\.\d{6}, -?\d+\.\d{6}/,'the map centre as latitude, longitude');
  // The panel title and its collapse button stay in place when the panel scrolls.
  const headerTop=async()=>(await page.locator('.panel header').boundingBox()).y;
  const panelTop=(await page.locator('.panel').boundingBox()).y;
  await page.locator('.panel').evaluate(panel=>{panel.scrollTop=panel.scrollHeight;});
  assert.ok(Math.abs(await headerTop()-panelTop)<2,'the header stays at the top of the scrolled panel');
  await page.locator('.panel').evaluate(panel=>{panel.scrollTop=0;});
  console.log('PASS: coordinates copied; panel header stays visible when scrolling');
  const zoomNow=()=>page.evaluate(async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);return map.getZoom();});
  const zoomBefore=await zoomNow();
  await page.locator('button.atlas-ctrl[title^="More detail"]').click();
  assert.equal(await page.locator('#map.detail').count(),1);
  assert.ok(Math.abs(await zoomNow()-zoomBefore-1)<0.01,'More detail shows the next zoom level');
  // The map must stay interactive in detail mode: drag, and the zoom button.
  const beforeDrag=await centre();
  await page.mouse.move(900,450); await page.mouse.down();
  for(let i=1;i<=10;i++) await page.mouse.move(900-i*10,450);
  await page.mouse.up(); await page.waitForTimeout(600);
  assert.ok(Math.abs((await centre())[0]-beforeDrag[0])>0.0005,'A mouse drag must pan the map in detail mode');
  const zoomed=await zoomNow();
  // Zoom animations are time-based and slow in software rendering: wait for them.
  await page.locator('.maplibregl-ctrl-zoom-in').click();
  await expectMap(async z=>{const {map}=await import(document.querySelector('script[type="module"]').src);return !map.isMoving() && map.getZoom()>z+0.9;},'The zoom button must work in detail mode',zoomed);
  await page.locator('.maplibregl-ctrl-zoom-out').click();
  await expectMap(async z=>{const {map}=await import(document.querySelector('script[type="module"]').src);return !map.isMoving() && Math.abs(map.getZoom()-z)<0.1;},'The zoom-out button must work in detail mode',zoomed);
  const detailShot=await page.screenshot({path:'browser-review/more-detail.jpg',type:'jpeg',quality:55});
  console.log('DETAILVIEW_IMAGE_START'+detailShot.toString('base64')+'DETAILVIEW_IMAGE_END');
  // Next level: two zoom levels further in, drawn at a quarter.
  const atFirst=await zoomNow();
  await page.locator('button.atlas-ctrl[title^="More detail"]').click();
  assert.equal(await page.locator('#map.detail.detail-2').count(),1);
  assert.ok(Math.abs(await zoomNow()-atFirst-1)<0.01,'The second level shows two zoom levels further in');
  assert.match(await page.locator('button.atlas-ctrl[title^="More detail"]').getAttribute('title'),/drawn at 25%/);
  // The scale bar keeps its normal size, so it must measure on-screen pixels.
  const scaleError=await page.evaluate(async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);
    const bar=document.querySelector('.maplibregl-ctrl-scale'),m=bar.textContent.match(/([\d.]+)\s*(km|m)\b/);if(!m)return null;
    const c=map.getContainer(),k=c.getBoundingClientRect().width/c.clientWidth,x=c.clientWidth/2,y=c.clientHeight/2;
    const perPx=map.unproject([x,y]).distanceTo(map.unproject([x+100/k,y]))/100;
    return Math.abs(+m[1]*(m[2]==='km'?1000:1)/bar.getBoundingClientRect().width/perPx-1);});
  assert.ok(scaleError!==null && scaleError<0.05,'The scale bar must match the map at the second level: error '+scaleError);
  const beforeQuarterDrag=await centre();
  await page.mouse.move(900,450); await page.mouse.down();
  for(let i=1;i<=10;i++) await page.mouse.move(900-i*10,450);
  await page.mouse.up(); await page.waitForTimeout(600);
  assert.ok(Math.abs((await centre())[0]-beforeQuarterDrag[0])>0.0005,'A mouse drag must pan the map at the second level');
  await page.locator('button.atlas-ctrl[title^="More detail"]').click();
  assert.equal(await page.locator('#map.detail').count(),0);
  assert.ok(Math.abs(await zoomNow()-(atFirst-1))<0.01,'The cycle returns to normal detail');
  console.log('PASS: more detail cycles through two levels');
  await page.locator('#collapse').click();
  await page.locator('button.atlas-ctrl[title="Drawing tools"]').click();
  await page.locator('[data-draw="line"]').click();
  for (const [x,y] of [[700,500],[850,450]]) await page.mouse.click(x,y);
  // Move map pauses drawing: a click adds nothing and a drag pans, while the
  // unfinished line and the toolbar stay.
  await page.locator('#draw-pan').click();
  await page.mouse.click(600,600);
  await page.mouse.move(900,650); await page.mouse.down(); await page.mouse.move(880,640,{steps:5}); await page.mouse.up();
  assert.equal(await page.locator('#draw-toolbar').isHidden(),false);
  await page.locator('#draw-pan').click();
  await page.mouse.click(950,520);
  await page.locator('#draw-finish').click();
  assert.match(await page.locator('#draw-status').textContent(),/./);
  // GeoJSON updates are tiled asynchronously; wait for the line and its length label.
  await expectMap(async()=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    const rendered=map.queryRenderedFeatures({layers:['drawing-line','drawing-line-labels']});
    return rendered.some(f=>f.layer.id==='drawing-line') && rendered.some(f=>f.layer.id==='drawing-line-labels' && /km|m$/.test(f.properties.measure));
  },'A drawn line and its length label must be on the map');
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#draw-save').click()]);
  const saved=JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(),'utf8'));
  assert.equal(saved.features[0].geometry.type,'LineString');
  assert.equal(saved.features[0].geometry.coordinates.length,3);
  await page.locator('#draw-close').click();
  console.log('PASS: drawing tool draws a line and saves it as GeoJSON');
  await page.locator('button.atlas-ctrl[title="Measure"]').click();
  await page.locator('[data-measure="distance"]').click();
  for (const [x,y] of [[700,500],[850,500],[850,600]]) await page.mouse.click(x,y);
  await page.mouse.dblclick(850,600);
  assert.match(await page.locator('#measure-status').textContent(),/Distance: .* over 2 segments/);
  await page.locator('[data-measure="radius"]').click();
  for (const [x,y] of [[700,600],[760,500],[860,470],[960,500]]) await page.mouse.click(x,y);
  assert.match(await page.locator('#measure-status').textContent(),/Curve radius ≈ [\d,.]+ (m|km)/);
  await page.locator('#measure-close').click();
  console.log('PASS: measure tool gives distance and curve radius');
  // The polar caps, when the snapshot provides them: on the globe, centred
  // on the South Pole, the cap's own data is drawn.
  if (await page.evaluate(async()=>(await fetch('data/polar/south-index.json')).ok)) {
    await page.evaluate(async()=>{
      const {map}=await import(document.querySelector('script[type="module"]').src);
      map.setProjection({type:'globe'});
      map.jumpTo({center:[0,-89.5],zoom:6+Math.log2(Math.cos(89.5*Math.PI/180)),bearing:0});
    });
    await expectMap(async()=>{
      const {map}=await import(document.querySelector('script[type="module"]').src);
      const cap=map.getLayer('polar-caps')?.implementation?.caps?.south;
      return Boolean(cap?.index && cap?.relief && [...(map.getLayer('polar-caps').implementation.tiles.values())].some(t=>t.loading===false));
    },'The South Pole cap must load its index, relief and contour tiles on the globe');
    console.log('PASS: polar cap drawn beyond 85° on the globe');
  } else console.log('SKIP: no polar cap data in this snapshot');
  // Compact screens must keep the scale ruler on-screen. It sits above the
  // coordinate readout, and the bottom-left control stack respects display
  // safe-area insets instead of being hidden on phones.
  await page.setViewportSize({width:412,height:915});
  await page.waitForTimeout(150);
  const compactControls=await page.evaluate(()=>{
    const box=el=>{const r=el.getBoundingClientRect();return {top:r.top,right:r.right,bottom:r.bottom,left:r.left,width:r.width,height:r.height};};
    const scale=document.querySelector('.maplibregl-ctrl-scale'),readout=document.querySelector('.map-readout');
    return {display:getComputedStyle(scale).display,scale:box(scale),readout:readout.hidden?null:box(readout),viewport:{width:innerWidth,height:innerHeight}};
  });
  assert.notEqual(compactControls.display,'none','The scale ruler stays visible on compact screens');
  assert.ok(compactControls.scale.left>=0 && compactControls.scale.top>=0 && compactControls.scale.right<=compactControls.viewport.width && compactControls.scale.bottom<=compactControls.viewport.height,'The compact scale ruler stays inside the visible viewport');
  if(compactControls.readout) assert.ok(compactControls.scale.bottom<=compactControls.readout.top+1,'The scale ruler sits above the coordinate readout instead of being covered by it');
  console.log('PASS: compact-screen scale ruler stays visible and above the bottom readout');
  await page.setViewportSize({width:1365,height:900});
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
