import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {launchBrowser} from './browser.mjs';
import {ormVectorFixture} from './orm-vector-fixture.mjs';
import {readFile, mkdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {waitUntil, setDefaultTimeout} from './wait-until.mjs';
import {controlColor, trainProtection} from '../styles/map-model.mjs';
import {powerFacilitiesGeoJSON} from './power-facility-data.mjs';

// Exercise real MapLibre/WebGL paint, placement, pointer handling and accessible
// disclosure controls. Every map request uses a deterministic OSM-shaped tile;
// failures cannot be explained away by a remote provider or an untagged place.
const feature = (properties, type, coordinates, id) => ({type:'Feature', ...(id === undefined ? {} : {id}), properties, geometry:{type, coordinates}});
const control = {train_protection0:'atc', train_protection1:'pzb', train_protection2:'etcs_2'};
const rail = {id:'9200-0', name:'Shared protection test track', feature:'rail', railway:'rail', state:'present', usage:'main', service:'', ...control};
const detailed = feature(rail, 'LineString', [[-.0002,.0005],[.0016,.0005]]);
const mainOverview = feature({...rail,id:'9201-0'}, 'LineString', [[-4,1],[4,1]]);
const branchOverview = feature({...rail,id:'9202-0',usage:'branch'}, 'LineString', [[-4,-1],[4,-1]]);
const metroOverview = feature({...rail,id:'9203-0',feature:'subway',railway:'subway',usage:''}, 'LineString', [[-.5,.2],[.5,.2]]);
const directed = feature({id:9004, railway:'signal', ref:'S12', category0:'main', deactivated0:false, azimuth:90}, 'Point', [.0002,-.0003]);
const undirected = feature({id:9006, railway:'signal', ref:'S13', category0:'main'}, 'Point', [.0012,-.0003]);
const culture = [
  feature({name:'Test museum',class:'museum',subclass:'museum',rank:1},'Point',[.00025,-.00085],93001),
  feature({name:'Test theatre',class:'theatre',subclass:'theatre',rank:1},'Point',[.00115,-.00085],93011),
];
const datasets = {
  railway_line_high:[detailed],
  signals_railway_line_low:[mainOverview],
  standard_railway_line_low:[mainOverview],
  electrification_railway_line_low:[mainOverview],
  railway_signals:[directed, feature({id:9999,railway:'buffer_stop',ref:'Buffer'},'Point',[.0007,-.0003])],
  electrification_substation:[feature({id:'way-9400',name:'Traction substation footprint'},'Polygon',[[[.00015,.00085],[.00035,.00085],[.00035,.00105],[.00015,.00105],[.00015,.00085]]])],
};
const supplies=powerFacilitiesGeoJSON({elements:[
  {type:'node',id:9401,lon:.00025,lat:.00095,tags:{name:'Test traction substation',power:'substation',substation:'traction',voltage:'25000',frequency:'50'}},
  {type:'node',id:9402,lon:.0007,lat:.00095,tags:{name:'Test railway power station',power:'plant',usage:'railway','plant:source':'hydro'}},
  {type:'node',id:9403,lon:.00105,lat:.00095,tags:{name:'Test locomotive diesel supply',railway:'fuel',fuel:'diesel'}},
  {type:'node',id:9404,lon:.00025,lat:.00073,tags:{name:'Test coaling facility',railway:'coaling_facility'}},
  {type:'node',id:9405,lon:.0007,lat:.00073,tags:{name:'Test steam water tank',railway:'water_tank',capacity:'100 m³'}},
  {type:'node',id:9406,lon:.00105,lat:.00073,tags:{name:'Test disused water tower','disused:railway':'water_tower'}},
  {type:'node',id:9499,lon:.0007,lat:-.0007,tags:{name:'Ordinary roadside fuel station',amenity:'fuel'}},
]});
assert.equal(supplies.features.length,6,'a roadside fuel station is not a railway supply');
const index = features => geojsonvt({type:'FeatureCollection',features},{maxZoom:22,indexMaxZoom:17,extent:4096});
const indexes = Object.fromEntries(Object.entries(datasets).map(([key,features])=>[key,index(features)]));
const branchIndex = index([branchOverview,metroOverview]);
const signalIndex = index([undirected]);
const basemapIndex = index(culture);
const center = [.0007,0];
const coordinatesAt = (z,[lon,lat]) => [Math.floor((lon+180)/360*2**z),Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*2**z)];
function localKeys(zooms,radius=3) {
  return zooms.flatMap(z=>{const [x,y]=coordinatesAt(z,center),n=2**z;return Array.from({length:2*radius+1},(_,dx)=>Array.from({length:2*radius+1},(_,dy)=>`${z}/${(x+dx-radius+n)%n}/${Math.max(0,Math.min(n-1,y+dy-radius))}`)).flat();});
}
const snapshotIndexes = {
  'branch-lines':{tiles:localKeys([4,5,6,7,8,9],4),index:branchIndex,layer:'branch_lines'},
  'traction/signals':{tiles:localKeys([12,16]),index:signalIndex,layer:'railway_signals'},
};

// A tiny valid PMTiles v3 archive keeps the actual basemap/localization path in
// the test, including cultural POIs. Encode its Hilbert-ordered root directory.
function tileId(z,x,y) {
  let d=0;
  for(let s=2**z/2;s>=1;s/=2) {
    const rx=(x&s)?1:0,ry=(y&s)?1:0;d+=s*s*((3*rx)^ry);
    if(!ry){if(rx){x=s-1-x;y=s-1-y;}[x,y]=[y,x];}
  }
  return (4**z-1)/3+d;
}
function varint(value) {
  const bytes=[];do{const low=value%128;value=Math.floor(value/128);bytes.push(low+(value?128:0));}while(value);return bytes;
}
function archiveFor(index,z=18) {
  const entries=localKeys([z]).map(key=>{const [zoom,x,y]=key.split('/').map(Number),tile=index.getTile(zoom,x,y);return tile?{id:tileId(zoom,x,y),bytes:Buffer.from(vtpbf.fromGeojsonVt({poi:tile},{version:2}))}:null;}).filter(Boolean).sort((a,b)=>a.id-b.id);
  let previous=0;
  const directory=Buffer.from([...varint(entries.length),...entries.flatMap(e=>{const delta=e.id-previous;previous=e.id;return varint(delta);}),...entries.flatMap(()=>varint(1)),...entries.flatMap(e=>varint(e.bytes.length)),...entries.flatMap((_,i)=>varint(i?0:1))]);
  const metadata=Buffer.from(JSON.stringify({vector_layers:[{id:'poi',fields:{name:'String',class:'String',subclass:'String',rank:'Number'}}]})),data=Buffer.concat(entries.map(e=>e.bytes));
  const header=Buffer.alloc(127);header.write('PMTiles');header[7]=3;
  for(const [offset,value] of [[8,127],[16,directory.length],[24,127+directory.length],[32,metadata.length],[40,127+directory.length+metadata.length],[48,0],[56,127+directory.length+metadata.length],[64,data.length],[72,entries.length],[80,entries.length],[88,entries.length]])header.writeBigUInt64LE(BigInt(value),offset);
  header[96]=1;header[97]=header[98]=header[99]=1;header[100]=header[101]=z;
  for(const [offset,value] of [[102,-1800000000],[106,-850000000],[110,1800000000],[114,850000000]])header.writeInt32LE(value,offset);
  header[118]=z;return Buffer.concat([header,directory,metadata,data]);
}
const archive=archiveFor(basemapIndex);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const glyphFile=process.env.ATLAS_BROWSER_GLYPHS;
const deadline=setTimeout(()=>{console.error('Signal and power checks exceeded ten minutes');process.exit(1);},600000);deadline.unref();
const browser=await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
await mkdir('browser-review',{recursive:true});
try {for(const [kind,width,height] of [['desktop',1365,900],['mobile',412,915]]) {
  const page=await browser.newPage({viewport:{width,height},hasTouch:kind==='mobile',deviceScaleFactor:2,serviceWorkers:'block'});setDefaultTimeout(page,60000);
  await installEmptyMapProviders(page.context(),base,{firstParty:'network'});
  const errors=[];let supplyRequests=0;page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'){console.error(kind,message.text());if(message.text().startsWith('Map resource error:'))errors.push(message.text());}});
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return original.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);};});
  await page.route('https://tuiles.enliberte.fr/planet.pmtiles',route=>{
    const range=/bytes=(\d+)-(\d+)/.exec(route.request().headers().range||''),start=range?+range[1]:0,end=Math.min(range?+range[2]:archive.length-1,archive.length-1);
    return route.fulfill({status:range?206:200,body:archive.subarray(start,end+1),contentType:'application/octet-stream',headers:range?{'Content-Range':`bytes ${start}-${end}/${archive.length}`,'Accept-Ranges':'bytes'}:{}});
  });
  if(glyphFile)await page.route('https://tuiles.enliberte.fr/fonts/**',async route=>route.fulfill({body:await readFile(glyphFile),contentType:'application/x-protobuf'}));
  await page.route('**/data/**',async route=>{
    if(new URL(route.request().url()).pathname.endsWith('/data/traction/power/power-facilities.geojson')){supplyRequests++;await route.fulfill({json:supplies});return;}
    const path=new URL(route.request().url()).pathname,match=/\/data\/(.+)\/(index\.json|\d+\/\d+\/\d+\.pbf\.gz)$/.exec(path);
    if(!match){await route.fulfill({json:{tiles:[]}});return;}
    const [,folder,file]=match,snapshot=snapshotIndexes[folder];
    if(file==='index.json'){await route.fulfill({json:{tiles:snapshot?.tiles||[]}});return;}
    const [z,x,y]=file.replace('.pbf.gz','').split('/').map(Number),tile=snapshot?.index.getTile(z,x,y);
    await route.fulfill({body:gzipSync(tile?Buffer.from(vtpbf.fromGeojsonVt({[snapshot.layer]:tile},{version:2})):Buffer.alloc(0)),contentType:'application/octet-stream'});
  });
  await page.route('https://openrailwaymap.app/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const direct=ormVectorFixture(path,indexes);
    if(direct)return route.fulfill(direct);
    if(path.startsWith('/api/feature/'))await route.fulfill({status:404,body:''});
    else await route.fulfill({json:{tilejson:'3.0.0',tiles:[`${base}review-signal-power${path}/{z}/{x}/{y}.pbf`],minzoom:0,maxzoom:22}});
  });
  await page.route('**/review-signal-power/**',route=>{
    const response=ormVectorFixture(new URL(route.request().url()).pathname.split('/review-signal-power')[1],indexes);
    assert.ok(response,'Recognized local fixture tile URL');
    return route.fulfill(response);
  });
  await page.route('https://tiles.maps.eox.at/**',route=>route.fulfill({body:png,contentType:'image/png'}));
  await page.goto(base+'?mode=control&language=en&autoGlobe=0&relief=0&stations=0&names=0&inactive=0&trackCounts=0&transport=0&destinations=1&constraints=0#18/0/0.0007',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('body[data-map-ready="true"]',{state:'attached'});
  await page.evaluate(async()=>{window.reviewMap=(await import(document.querySelector('script[type="module"]').src)).map;window.reviewErrors=[];window.reviewMap.on('error',event=>window.reviewErrors.push(event.error?.message||String(event.error)));});
  const visible=async id=>{try{await waitUntil(page,id=>window.reviewMap.queryRenderedFeatures({layers:[id]}).length>0,id,{timeout:20000});}catch(error){throw new Error(`No rendered ${id}`,{cause:error});}};
  const openControls=async()=>{if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();};
  const mode=async value=>{await openControls();if(await page.locator('#settings-view').isVisible())await page.locator('#settings-close').click();await page.locator(`[data-mode="${value}"]`).click();};
  const openSettings=async()=>{await openControls();if(await page.locator('#settings-view').isHidden())await page.locator('#settings-open').click();};
  const closeControls=async()=>{if(await page.locator('#controls').isVisible())await page.locator('#collapse').click();};
  const jump=async (center,zoom)=>{await page.evaluate(({center,zoom})=>{window.reviewMap.jumpTo({center,zoom});},{center,zoom});};
  const clickCoordinates=async coordinates=>{const point=await page.evaluate(coordinates=>{const point=window.reviewMap.project(coordinates);return{x:point.x,y:point.y};},coordinates);await page.locator('#map canvas').click({position:point});};
  const sharedBands=async prefix=>{for(const id of [prefix,`${prefix}-system-2`,`${prefix}-system-3`])await visible(id);assert.deepEqual(await page.evaluate(prefix=>[prefix,`${prefix}-system-2`,`${prefix}-system-3`].map(id=>window.reviewMap.getLayoutProperty(id,'visibility')),prefix),['visible','visible','visible']);};

  try {
    console.log(`CHECK: ${kind} loaded real map; checking control and signal fixtures`);
    await sharedBands('control-tracks');
    await visible('infrastructure-signal-points');await visible('infrastructure-signal-supplement-points');
    assert.ok(await page.evaluate(()=>window.reviewMap.queryRenderedFeatures({layers:['infrastructure-signal-points']}).every(f=>f.properties.railway==='signal')),'buffers must not be reported as signals');
    await waitUntil(page,()=>document.querySelectorAll('#legend .system-label').length===3);
    const summaries=page.locator('#legend .system-label summary');
    assert.deepEqual((await summaries.allTextContents()).sort(),['ATC','ETCS L2','PZB'].sort());
    assert.ok((await summaries.evaluateAll(nodes=>nodes.map(n=>n.title))).every(Boolean),'full descriptions must be available on mouse hover');
    await openControls();await summaries.filter({hasText:/^PZB$/}).click();assert.equal(await page.locator('#legend .system-label[open]').count(),1,'a system description can be expanded by tapping the legend');
    await closeControls();
    const colors=['atc','pzb','etcs_2'].map(code=>{const [,,family,level]=trainProtection(code);return controlColor(family,level);});
    // The three adjacent bands must actually paint different pixels, rather
    // than merely existing as three overlapping style layers.
    const pixels=await page.evaluate(({coordinates,colors})=>{
      const map=window.reviewMap,canvas=map.getCanvas(),scale=canvas.width/map.getContainer().clientWidth,p=map.project(coordinates),context=document.createElement('canvas').getContext('2d');
      context.canvas.width=canvas.width;context.canvas.height=canvas.height;context.drawImage(canvas,0,0);
      const data=context.getImageData(Math.round((p.x-15)*scale),Math.round((p.y-7)*scale),Math.round(30*scale),Math.round(14*scale)).data;
      return colors.map(hex=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));let distance=Infinity;for(let i=0;i<data.length;i+=4)distance=Math.min(distance,Math.hypot(...rgb.map((v,j)=>v-data[i+j])));return distance;});
    },{coordinates:[.001,.0005],colors});
    assert.ok(pixels.every(distance=>distance<55),`${kind}: all three system colors must reach the rendered canvas (${pixels})`);
    await clickCoordinates([.001,.0005]);await page.waitForSelector('#details:not([hidden])');
    assert.deepEqual((await page.locator('#detail-content .system-label summary').allTextContents()).sort(),['ATC','ETCS L2','PZB'].sort());
    const atc=page.locator('#detail-content .system-label').filter({has:page.locator('summary',{hasText:/^ATC$/})});
    assert.match(await atc.locator('summary').getAttribute('title'),/Japanese ATC/);
    await page.screenshot({path:`browser-review/signal-power-labels-${kind}.png`});
    await atc.locator('summary').click();assert.equal(await atc.getAttribute('open'),'');assert.match(await atc.locator('.system-description').innerText(),/Japanese ATC/);
    await page.screenshot({path:`browser-review/signal-power-expanded-labels-${kind}.png`});
    await page.locator('#details-close').click();
    for(const [point,id] of [[directed,9004],[undirected,9006]]) {
      await clickCoordinates(point.geometry.coordinates);await page.waitForSelector('#details:not([hidden])');
      assert.equal(await page.locator(`#detail-content a[href="https://www.openstreetmap.org/node/${id}"]`).count(),1);
      assert.match(await page.locator('#detail-content').innerText(),/signal/i);await page.locator('#details-close').click();
    }
    await mode('infrastructure');await closeControls();
    await visible('infrastructure-signal-points');await visible('infrastructure-signal-supplement-points');
    for(const [point,id] of [[directed,9004],[undirected,9006]]) {
      await clickCoordinates(point.geometry.coordinates);await page.waitForSelector('#details:not([hidden])');
      assert.equal(await page.locator(`#detail-content a[href="https://www.openstreetmap.org/node/${id}"]`).count(),1);await page.locator('#details-close').click();
    }
    await visible('context-destinations-culture-label');
    assert.deepEqual(await page.evaluate(()=>[...new Set(window.reviewMap.queryRenderedFeatures({layers:['context-destinations-culture-label']}).map(f=>f.properties.subclass))].sort()),['museum','theatre'],'both cultural fixtures remain drawn');
    for(const point of culture) {
      await clickCoordinates(point.geometry.coordinates);assert.equal(await page.locator('#details').isHidden(),true,`${point.properties.subclass} remains visual context`);
      if(kind==='desktop') {const projected=await page.evaluate(coordinates=>{const p=window.reviewMap.project(coordinates);return{x:p.x,y:p.y};},point.geometry.coordinates);await page.mouse.move(projected.x,projected.y);await waitUntil(page,()=>window.reviewMap.getCanvas().style.cursor!=='pointer');}
    }
    await page.screenshot({path:`browser-review/signal-power-infrastructure-${kind}.png`});
    console.log(`CHECK: ${kind} shared signals, compact descriptions and cultural context passed; checking energy supplies`);
    await mode('speed');assert.ok(await page.evaluate(()=>['infrastructure-signal-points','infrastructure-signal-supplement-points','infrastructure-signal-references','infrastructure-signal-supplement-references'].every(id=>window.reviewMap.getLayoutProperty(id,'visibility')==='none')));
    assert.equal(supplyRequests,0,'railway energy supplies are deferred until Power view');
    await mode('electrification');await closeControls();
    await visible('electrification-supply-points');await visible('electrification-substation-areas');
    await waitUntil(page,()=>new Set(window.reviewMap.queryRenderedFeatures({layers:['electrification-supply-points']}).map(f=>f.properties.power_kind)).size===5);
    assert.deepEqual(await page.evaluate(()=>[...new Set(window.reviewMap.queryRenderedFeatures({layers:['electrification-supply-points']}).map(f=>f.properties.power_group))].sort()),['coal','electricity','fuel','water']);
    assert.equal(await page.evaluate(()=>window.reviewMap.queryRenderedFeatures({layers:['electrification-former-supply-points']}).length),0,'disused supply follows the inactive setting');
    for(const supply of supplies.features.filter(f=>f.properties.power_state==='present')) {
      await clickCoordinates(supply.geometry.coordinates);await page.waitForSelector('#details:not([hidden])');
      assert.match(await page.locator('#detail-content').innerText(),/RAILWAY ENERGY SUPPLY/);
      assert.equal(await page.locator(`#detail-content a[href="https://www.openstreetmap.org/node/${supply.properties.osm_id}"]`).count(),1);
      if(supply.properties.fuel)assert.match(await page.locator('#detail-content').innerText(),/diesel/);
      if(supply.properties.capacity)assert.match(await page.locator('#detail-content').innerText(),/100 m³/);
      await page.locator('#details-close').click();
    }
    await page.screenshot({path:`browser-review/signal-power-supplies-${kind}.png`});
    await openSettings();await page.locator('#inactive').check();
    await visible('electrification-former-supply-points');
    await page.locator('#labels').uncheck();
    assert.ok(await page.evaluate(()=>window.reviewMap.getLayoutProperty('electrification-supply-names','visibility')==='none'&&window.reviewMap.getLayoutProperty('electrification-supply-points','visibility')==='visible'));
    await page.locator('#labels').check();await page.locator('#inactive').uncheck();
    await mode('control');assert.ok(await page.evaluate(()=>['electrification-supply-points','electrification-substation-areas'].every(id=>window.reviewMap.getLayoutProperty(id,'visibility')==='none')));
    await openSettings();await page.locator('#labels').uncheck();
    assert.ok(await page.evaluate(()=>['infrastructure-signal-references','infrastructure-signal-supplement-references'].every(id=>window.reviewMap.getLayoutProperty(id,'visibility')==='none')&&window.reviewMap.getLayoutProperty('infrastructure-signal-points','visibility')==='visible'));
    await page.locator('#labels').check();
    await mode('electrification');await visible('electrification-supply-points');assert.equal(supplyRequests,1,'Power view reuses its previously downloaded snapshot');
    await mode('control');await closeControls();
    console.log(`CHECK: ${kind} energy supplies passed; checking overview control bands`);
    await jump([0,0],5);console.log(`CHECK: ${kind} moved to overview`);await sharedBands('control-overview');await sharedBands('control-branch-overview');
    await jump([0,0],8);console.log(`CHECK: ${kind} moved to metro overview`);await sharedBands('control-metro-overview');
    await jump(center,14);await visible('infrastructure-signal-points');await visible('infrastructure-signal-supplement-overview');
    await jump(center,18);await sharedBands('control-tracks');
    for(const id of ['infrastructure-signal-points','infrastructure-signal-supplement-points','infrastructure-signal-references','infrastructure-signal-supplement-references','context-destinations-culture-label'])await visible(id);
    await waitUntil(page,()=>new Set(window.reviewMap.queryRenderedFeatures({layers:['context-destinations-culture-label']}).map(f=>f.properties.subclass)).size===2);
    await page.evaluate(()=>new Promise(resolve=>{window.reviewMap.once('idle',()=>resolve());window.reviewMap.triggerRepaint();}));
    await waitUntil(page,()=>!document.querySelector('#map-status').classList.contains('error'));
    await page.screenshot({path:`browser-review/signal-power-control-${kind}.png`});
    assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.reviewErrors),[]);
    console.log(`PASS: ${kind} simultaneous protection color bands, compact hover/tap descriptions, shared directed/undirected signals, electricity/diesel/coal/steam-water supplies, view gating and noninteractive cultural POIs`);
  } catch(error) {
    await page.screenshot({path:`browser-review/signal-power-failure-${kind}.png`});
    console.error(JSON.stringify({kind,errors,state:await page.evaluate(()=>({zoom:window.reviewMap.getZoom(),center:window.reviewMap.getCenter(),errors:window.reviewErrors,rendered:[...new Set(window.reviewMap.queryRenderedFeatures().map(f=>f.layer.id))],substations:{visibility:window.reviewMap.getLayoutProperty('electrification-substation-areas','visibility'),loaded:window.reviewMap.isSourceLoaded('electricSubstations'),features:window.reviewMap.querySourceFeatures('electricSubstations',{sourceLayer:'electrification_substation'}).map(f=>({properties:f.properties,geometry:f.geometry}))}}))}));throw error;
  } finally {await page.close();}
}} finally {await browser.close();}
