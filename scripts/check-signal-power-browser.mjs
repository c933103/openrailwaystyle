import {installEmptyMapProviders,emptyReferenceFixture} from './browser-renderer-fixture.mjs';
import {launchBrowser} from './browser.mjs';
import {ormVectorFixture} from './orm-vector-fixture.mjs';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {assertLegendFits,assertLegacyLegendOverflows} from './legend-layout.mjs';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {waitUntil, setDefaultTimeout} from './wait-until.mjs';
import {controlColor, trainProtection} from '../styles/map-model.mjs';
import {powerMethodsGeoJSON} from './power-method-data.mjs';
import {powerFacilitiesGeoJSON} from './power-facility-data.mjs';
import {tractionLinesGeoJSON} from './traction-line-data.mjs';
import {energySitesGeoJSON} from './energy-site-data.mjs';

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
  electrification_catenary:[feature({id:'9410-mast',feature:'mast',ref:'M1'},'Point',[.00095,-.0005]),feature({id:'9411-portal',feature:'portal',ref:'P1'},'LineString',[[.0009,-.00065],[.001,-.00065]])],
  electrification_substation:[feature({id:'way-9400',name:'Traction substation footprint'},'Polygon',[[[.00015,.00085],[.00035,.00085],[.00035,.00105],[.00015,.00105],[.00015,.00085]]])],
};
const supplies=powerFacilitiesGeoJSON({elements:[
  {type:'node',id:9401,lon:.00025,lat:.00095,tags:{name:'Test traction substation',power:'substation',substation:'traction',voltage:'25000',frequency:'50'}},
  {type:'node',id:9402,lon:.0007,lat:.00095,tags:{name:'Test railway power station',power:'plant',usage:'railway','plant:source':'hydro','generator:source':'solar'}},
  {type:'node',id:9403,lon:.00105,lat:.00095,tags:{name:'Test locomotive diesel supply',railway:'fuel',fuel:'diesel','fuel:adblue':'yes','fuel:hydrogen':'yes'}},
  {type:'node',id:9404,lon:.00025,lat:.00073,tags:{name:'Test coaling facility',railway:'coaling_facility'}},
  {type:'node',id:9405,lon:.0007,lat:.00073,tags:{name:'Test steam water tank',railway:'water_tank',capacity:'100 m³'}},
  {type:'node',id:9406,lon:.00105,lat:.00073,tags:{name:'Test disused water tower','disused:man_made':'water_tower',usage:'railway'}},
  {type:'node',id:9499,lon:.0007,lat:-.0007,tags:{name:'Ordinary roadside fuel station',amenity:'fuel'}},
]});
assert.equal(supplies.features.length,6,'a roadside fuel station is not a railway supply');
const methods=powerMethodsGeoJSON({elements:[
  {type:'node',id:9420,lon:.0011,lat:-.00012,tags:{name:'Test battery train charger',amenity:'charging_station',train:'yes','socket:pantograph:output':'1000 kW'}},
  {type:'way',id:9421,tags:{railway:'subway',electrified:'rail',voltage:'750',frequency:'0','electrified:rail':'bottom'},geometry:[{lon:-.0002,lat:.0002},{lon:.0016,lat:.0002}]},
  {type:'way',id:9422,tags:{railway:'subway',electrified:'4th_rail',voltage:'630',frequency:'0'},geometry:[{lon:-.0002,lat:0},{lon:.0016,lat:0}]},
]});
// Railway supply lines: a 50 Hz line reaching a traction substation's area, a
// line continuing it (same circuit), a cable and a former line reaching a second
// substation, and a line passing the first substation without reaching it.
const at=points=>points.map(([lon,lat])=>({lon,lat}));
const tractionLines=tractionLinesGeoJSON({elements:[
  {type:'way',id:9440,nodes:[1,2,3,4,1],tags:{power:'substation',substation:'traction'},geometry:at([[.00015,.00085],[.00035,.00085],[.00035,.00105],[.00015,.00105],[.00015,.00085]])},
  {type:'way',id:9441,nodes:[5,6,7,8,5],tags:{power:'substation',substation:'traction'},geometry:at([[.0014,-.00115],[.0016,-.00115],[.0016,-.00095],[.0014,-.00095],[.0014,-.00115]])},
  {type:'way',id:9430,nodes:[11,21],tags:{power:'line',frequency:'16.7',voltage:'110000',operator:'Test railway energy'},geometry:at([[.0016,.00115],[.0006,.0011]])},
  {type:'way',id:9431,nodes:[21,22],tags:{power:'line',frequency:'50',voltage:'20000'},geometry:at([[.0006,.0011],[.00025,.00095]])},
  {type:'way',id:9432,nodes:[31,32],tags:{power:'cable',frequency:'16.7',voltage:'15000'},geometry:at([[-.0002,-.001],[.0015,-.001]])},
  {type:'way',id:9433,nodes:[41,42],tags:{'disused:power':'line',frequency:'16.7'},geometry:at([[-.0002,-.0011],[.0015,-.0011]])},
  {type:'way',id:9434,nodes:[51,52],tags:{power:'line',frequency:'50'},geometry:at([[.0004,.0008],[.0004,.0011]])},
]});
assert.deepEqual(tractionLines.features.map(f=>f.id),['way-9430','way-9431','way-9432','way-9433'],'a line passing the substation is not a supply line');
// A tank farm a siding enters (evidence: its diesel tank) and one a siding only
// passes, which must not be selected.
const energySites=energySitesGeoJSON({elements:[
  {type:'way',id:9450,tags:{landuse:'industrial',name:'Test fuel terminal',operator:'Test fuels'},geometry:at([[.0002,-.0006],[.0006,-.0006],[.0006,-.00045],[.0002,-.00045],[.0002,-.0006]])},
  {type:'way',id:9451,center:{lon:.0005,lat:-.00055},tags:{man_made:'storage_tank',content:'diesel'}},
  {type:'way',id:9452,tags:{railway:'rail',service:'siding'},geometry:at([[.0001,-.0005],[.0004,-.0005]])},
  {type:'way',id:9453,tags:{landuse:'industrial',industrial:'fuel_depot'},geometry:at([[-.0009,-.0006],[-.0006,-.0006],[-.0006,-.00045],[-.0009,-.00045],[-.0009,-.0006]])},
  {type:'way',id:9454,tags:{railway:'rail',service:'siding'},geometry:at([[-.001,-.0004],[-.0005,-.0004]])},
]});
assert.deepEqual(energySites.features.map(f=>f.id),['way-9450'],'a siding passing a depot does not make it rail-served');
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
  const errors=[];let supplyRequests=0,lineRequests=0,siteRequests=0;page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'){console.error(kind,message.text());if(message.text().startsWith('Map resource error:'))errors.push(message.text());}});
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return original.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);};});
  await page.route('https://tuiles.enliberte.fr/planet.pmtiles',route=>{
    const range=/bytes=(\d+)-(\d+)/.exec(route.request().headers().range||''),start=range?+range[1]:0,end=Math.min(range?+range[2]:archive.length-1,archive.length-1);
    return route.fulfill({status:range?206:200,body:archive.subarray(start,end+1),contentType:'application/octet-stream',headers:range?{'Content-Range':`bytes ${start}-${end}/${archive.length}`,'Accept-Ranges':'bytes'}:{}});
  });
  if(glyphFile)await page.route('https://tuiles.enliberte.fr/fonts/**',async route=>route.fulfill({body:await readFile(glyphFile),contentType:'application/x-protobuf'}));
  await page.route('**/data/**',async route=>{
    const reference=emptyReferenceFixture(new URL(route.request().url()).pathname);if(reference)return route.fulfill(reference);
    if(new URL(route.request().url()).pathname.endsWith('/data/traction/power/power-methods.geojson')){await route.fulfill({json:methods});return;}
    if(new URL(route.request().url()).pathname.endsWith('/data/traction/power/power-facilities.geojson')){supplyRequests++;await route.fulfill({json:supplies});return;}
    if(new URL(route.request().url()).pathname.endsWith('/data/traction/power/traction-lines.geojson')){lineRequests++;await route.fulfill({json:tractionLines});return;}
    if(new URL(route.request().url()).pathname.endsWith('/data/traction/power/energy-sites.geojson')){siteRequests++;await route.fulfill({json:energySites});return;}
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

  const legendLayout=()=>page.evaluate(()=>{
    const panel=document.querySelector('.panel'),grid=document.querySelector('#legend .legend-grid');
    const bounds=node=>{const {left,right,width}=node.getBoundingClientRect();return {left,right,width,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth};};
    return {viewport:{width:innerWidth,height:innerHeight},panel:{...bounds(panel),scrollLeft:panel.scrollLeft},grid:bounds(grid),
      rows:[...grid.children].map(row=>{
        const label=row.lastElementChild,range=document.createRange();range.selectNodeContents(label);
        return {label:label.textContent,row:bounds(row),text:bounds(label),
          lines:[...range.getClientRects()].map(({left,right,width,height})=>({left,right,width,height}))};
      })};
  });


  const powerLegend = async former => {
    await openControls();
    if (await page.locator('#settings-view').isVisible()) await page.locator('#settings-close').click();
    const samples = await page.evaluate(() => [...document.querySelectorAll('#legend .point-swatch')].map(sample => ({
      label:sample.nextElementSibling.textContent, hidden:sample.getAttribute('aria-hidden'),
      line:sample.classList.contains('swatch'), width:sample.getBoundingClientRect().width,
      symbols:[...sample.querySelectorAll('svg')].map(svg => {
        const circle=svg.querySelector('circle'),text=svg.querySelector('text'),box=svg.getBoundingClientRect(),glyph=text.getBBox();
        return {mark:text.textContent,fill:circle.getAttribute('fill'),stroke:circle.getAttribute('stroke'),
          strokeWidth:+circle.getAttribute('stroke-width'),textColor:text.getAttribute('fill'),
          radius:+circle.getAttribute('r'),fontSize:+text.getAttribute('font-size'),width:box.width,height:box.height,
          glyphVisible:glyph.width>0&&glyph.height>0&&glyph.x>=0&&glyph.x+glyph.width<=16&&glyph.y>=0&&glyph.y+glyph.height<=16};
      }),
    })));
    assert.equal(samples.length,5,'E/B/F/C/W use circular point samples, not line swatches');
    const expected=[['E','Electricity supply','#b77d00'],['B','Battery train charging','#008a83'],['F','Train refuelling point (fuel type where mapped)','#906532'],['C','Steam engine coaling','#4b4c50'],['W','Steam engine water','#287bad']];
    const paints=await page.evaluate(()=>[false,true].map(former=>{
      const map=window.reviewMap,prefix=former?'electrification-former-supply':'electrification-supply';
      return {radius:map.getPaintProperty(prefix+'-points','circle-radius').at(-1),
        stroke:map.getPaintProperty(prefix+'-points','circle-stroke-width'),textSize:map.getLayoutProperty(prefix+'-marks','text-size')};
    }));
    for (const [i,sample] of samples.entries()) {
      const [mark,label,color]=expected[i];assert.equal(sample.label,label);assert.equal(sample.hidden,'true');assert.equal(sample.line,false);
      assert.equal(sample.symbols.length,former?2:1);
      for (const [j,symbol] of sample.symbols.entries()) {
        assert.equal(symbol.mark,mark);assert.equal(symbol.fill,j?'#fffef8':color);assert.equal(symbol.stroke,j?color:'#fffef8');assert.equal(symbol.textColor,j?color:'#fffef8');
        assert.equal(symbol.radius,paints[j].radius);assert.equal(symbol.strokeWidth,paints[j].stroke);assert.equal(symbol.fontSize,paints[j].textSize);
        assert.equal(symbol.width,16);assert.equal(symbol.height,16);assert.equal(symbol.glyphVisible,true,'letter stays visible inside its circular sample');
      }
    }
    const track=await page.evaluate(()=>{
      const row=[...document.querySelectorAll('#legend .legend-item')].find(row=>row.lastElementChild.textContent==='Not electrified');
      const sample=row.firstElementChild,box=sample.getBoundingClientRect();return {line:sample.classList.contains('swatch'),width:box.width,height:box.height,text:sample.textContent};
    });
    assert.deepEqual(track,{line:true,width:25,height:4,text:''},'ordinary track sample retains its line geometry');
    const accessible=await page.locator('#legend').ariaSnapshot();
    assert.ok(accessible.includes('Train refuelling point (fuel type where mapped)'));
    assert.ok(!/^\s*- text: [EFCW]$/m.test(accessible),'decorative letters do not duplicate accessible labels');
    const layouts=[];
    for(const constrained of [false,true]){
      // The observed desktop panel had a 257px content box after its classic
      // scrollbar and padding. Check that width as well as each browser's
      // natural layout; overlay scrollbars must not hide the regression.
      const narrow=constrained?await page.addStyleTag({content:'#legend{max-width:257px}'}):null;
      try {
        await page.locator('.panel').evaluate(panel=>{panel.scrollLeft=0;});
        const measured=await legendLayout();
        layouts.push({constrained,...measured});assertLegendFits(measured);
        if(former&&constrained){
          const previous=await page.addStyleTag({content:'#legend .legend-item:has(.pattern-swatch){grid-column:auto}'});
          try {
            const broken=await legendLayout();
            assertLegacyLegendOverflows(broken);
            layouts.push({constrained,negativeControl:true,...broken});
          } finally {await previous.evaluate(node=>node.remove());}
          assertLegendFits(await legendLayout());
        }
      } finally {if(narrow)await narrow.evaluate(node=>node.remove());}
    }
    await writeFile(`browser-review/power-legend-layout-${former?'former':'active'}-${kind}.json`,JSON.stringify(layouts,null,2)+'\n');
    const last=page.locator('#legend .legend-item').last();
    await last.scrollIntoViewIfNeeded();
    assertLegendFits(await legendLayout());
    assert.equal(await last.evaluate(row=>{
      const panel=row.closest('.panel'),box=panel.getBoundingClientRect(),item=row.getBoundingClientRect();
      return item.top>=box.top+panel.clientTop&&item.bottom<=box.top+panel.clientTop+panel.clientHeight;
    }),true,'the final legend row remains reachable by vertical scrolling');
    await page.screenshot({path:`browser-review/power-legend-viewport-${former?'former':'active'}-${kind}.png`});
    await page.locator('#legend').screenshot({path:`browser-review/power-legend-${former?'former':'active'}-${kind}.png`});
    await closeControls();
  };

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
    assert.equal(lineRequests,0,'traction power lines are deferred until Power view');
    assert.equal(siteRequests,0,'rail-served sites are deferred until Power view');
    await mode('electrification');await closeControls();
    await visible('electrification-supply-points');await visible('electrification-substation-areas');
    await powerLegend(false);
    await visible('electrification-conductor-rails');await visible('electrification-charging-points');
    await visible('electrification-catenary-masts');await visible('electrification-catenary-portals');
    await visible('electrification-traction-lines');await visible('electrification-traction-cables');
    assert.deepEqual(await page.evaluate(()=>[...new Set(window.reviewMap.queryRenderedFeatures({layers:['electrification-traction-lines','electrification-traction-cables']}).map(f=>f.properties.osm_id))].sort()),['9430','9431','9432']);
    assert.equal(await page.evaluate(()=>window.reviewMap.queryRenderedFeatures({layers:['electrification-former-traction-lines']}).length),0,'a former line follows the inactive setting');
    assert.ok(await page.evaluate(()=>{const ids=window.reviewMap.getStyle().layers.map(l=>l.id);return ['electrification-traction-lines','electrification-traction-cables'].every(id=>ids.indexOf(id)<ids.indexOf('electrification-tracks'));}),'supply lines draw beneath the tracks');
    for(const [coordinates,id,basis,type] of [[[.0011,.001125],'9430','Same circuit as a line reaching a railway electricity facility','Railway traction power line'],[[.000425,.00103],'9431','Reaches a mapped railway electricity facility','Railway traction power line'],[[.0011,-.001],'9432','Reaches a mapped railway electricity facility','Railway traction power cable']]) {
      await clickCoordinates(coordinates);await page.waitForSelector('#details:not([hidden])');
      const rows=await page.locator('#detail-content dt').evaluateAll(terms=>Object.fromEntries(terms.map(term=>[term.textContent,term.nextElementSibling.textContent])));
      assert.equal(rows.Type,type);assert.equal(rows['Railway supply basis'],basis);
      assert.equal(await page.locator(`#detail-content a[href="https://www.openstreetmap.org/way/${id}"]`).count(),1);
      if(id==='9431')await page.locator('#details').screenshot({path:`browser-review/power-traction-line-details-${kind}.png`});
      await page.locator('#details-close').click();
    }
    await visible('electrification-energy-site-areas');await visible('electrification-energy-site-edges');await visible('electrification-energy-site-names');
    assert.ok(await page.evaluate(()=>{const ids=window.reviewMap.getStyle().layers.map(l=>l.id);return ['electrification-energy-site-areas','electrification-energy-site-edges'].every(id=>ids.indexOf(id)<ids.indexOf('electrification-tracks'));}),'site areas draw beneath the tracks');
    await clickCoordinates([.00035,-.00057]);await page.waitForSelector('#details:not([hidden])');
    {
      const rows=await page.locator('#detail-content dt').evaluateAll(terms=>Object.fromEntries(terms.map(term=>[term.textContent,term.nextElementSibling.textContent])));
      assert.match(await page.locator('#detail-content h2').innerText(),/Test fuel terminal/);
      assert.equal(rows.Type,'Rail-served fuel site');assert.equal(rows['Stored contents'],'diesel');
      assert.equal(rows['Energy evidence'],'Storage inside the site records energy contents');assert.equal(rows['Rail connection'],'A siding enters the mapped site');
      assert.equal(await page.locator('#detail-content a[href="https://www.openstreetmap.org/way/9450"]').count(),1);
      await page.locator('#details').screenshot({path:`browser-review/power-energy-site-details-${kind}.png`});
      await page.locator('#details-close').click();
    }
    const siteSamples=await page.evaluate(()=>[...document.querySelectorAll('#legend .legend-item')].filter(row=>/^Rail-served (fuel|coal) site$/.test(row.lastElementChild.textContent)).map(row=>[row.lastElementChild.textContent,row.firstElementChild.classList.contains('energy-site'),row.firstElementChild.style.getPropertyValue('--swatch')]));
    assert.deepEqual(siteSamples,[['Rail-served fuel site',true,'#906532'],['Rail-served coal site',true,'#4b4c50']],'the legend shows sites as area samples');
    const lineSample=await page.evaluate(()=>{const row=[...document.querySelectorAll('#legend .legend-item')].find(row=>row.lastElementChild.textContent==='Railway traction power line');return row&&{line:row.firstElementChild.classList.contains('traction-line'),colour:row.firstElementChild.style.getPropertyValue('--swatch')};});
    assert.deepEqual(lineSample,{line:true,colour:'#b77d00'},'the legend shows traction lines as a line sample');
    await clickCoordinates([.0011,-.00012]);assert.match(await page.locator('#detail-content').innerText(),/Battery train charging facility/);assert.match(await page.locator('#detail-content').innerText(),/1000 kW/);await page.locator('#details-close').click();
    await clickCoordinates([.0007,.0002]);assert.match(await page.locator('#detail-content').innerText(),/Third rail/);await page.locator('#details-close').click();
    await clickCoordinates([.00095,-.0005]);assert.match(await page.locator('#detail-content').innerText(),/Catenary mast/);assert.equal(await page.locator('#detail-content a[href="https://www.openstreetmap.org/node/9410"]').count(),1);await page.locator('#details-close').click();
    await waitUntil(page,()=>new Set(window.reviewMap.queryRenderedFeatures({layers:['electrification-supply-points']}).map(f=>f.properties.power_kind)).size===5);
    assert.deepEqual(await page.evaluate(()=>[...new Set(window.reviewMap.queryRenderedFeatures({layers:['electrification-supply-points']}).map(f=>f.properties.power_group))].sort()),['coal','electricity','fuel','water']);
    assert.equal(await page.evaluate(()=>window.reviewMap.queryRenderedFeatures({layers:['electrification-former-supply-points']}).length),0,'disused supply follows the inactive setting');
    for(const supply of supplies.features.filter(f=>f.properties.power_state==='present')) {
      await clickCoordinates(supply.geometry.coordinates);await page.waitForSelector('#details:not([hidden])');
      assert.match(await page.locator('#detail-content').innerText(),/RAILWAY ENERGY SUPPLY/);
      assert.equal(await page.locator(`#detail-content a[href="https://www.openstreetmap.org/node/${supply.properties.osm_id}"]`).count(),1);
      const detailRows=await page.locator('#detail-content dt').evaluateAll(terms=>Object.fromEntries(terms.map(term=>[term.textContent,term.nextElementSibling.textContent])));
      if(supply.properties.fuel){assert.equal(detailRows.Type,'Train refuelling point');assert.equal(detailRows['Recorded supplies'],'diesel, adblue, hydrogen');}
      if(supply.properties.power_kind==='coaling_facility')assert.equal(detailRows.Type,'Steam engine coaling');
      if(supply.properties['plant:source']){assert.equal(detailRows['Plant energy source'],'hydro');assert.equal(detailRows['Generator energy source'],'solar');assert.equal(detailRows['Recorded supplies'],undefined);}
      if(supply.properties.power_kind==='plant')await page.locator('#details').screenshot({path:`browser-review/power-generation-details-${kind}.png`});
      if(supply.properties.power_kind==='fuel')await page.locator('#details').screenshot({path:`browser-review/power-refuelling-details-${kind}.png`});
      if(supply.properties.capacity)assert.match(await page.locator('#detail-content').innerText(),/100 m³/);
      await page.locator('#details-close').click();
    }
    await page.screenshot({path:`browser-review/signal-power-supplies-${kind}.png`});
    await openControls();await page.locator('#about-open').click();
    const powerHelp=await page.locator('#help-power').innerText();
    for(const label of ['Battery train charging','Train refuelling point (fuel type where mapped)','Steam engine coaling','Steam engine water','railway supply power lines','rail-served fuel (brown) and coal (grey) sites'])assert.ok(powerHelp.includes(label),label);
    assert.match(powerHelp,/whole electricity grid.*not yet/);
    await page.locator('#help-power').scrollIntoViewIfNeeded();
    await page.locator('#about').screenshot({path:`browser-review/power-help-${kind}.png`});
    await page.locator('#about-close').click();await closeControls();
    await openSettings();await page.locator('#inactive').check();
    await visible('electrification-former-supply-points');await visible('electrification-former-traction-lines');
    await closeControls();await clickCoordinates([.00105,.00073]);
    assert.match(await page.locator('#detail-content').innerText(),/Railway water tower/);
    assert.doesNotMatch(await page.locator('#detail-content').innerText(),/Steam locomotive water tower/);
    await page.locator('#details-close').click();
    await powerLegend(true);await openSettings();
    await page.locator('#labels').uncheck();
    assert.ok(await page.evaluate(()=>window.reviewMap.getLayoutProperty('electrification-supply-names','visibility')==='none'&&window.reviewMap.getLayoutProperty('electrification-supply-points','visibility')==='visible'));
    await page.locator('#labels').check();await page.locator('#inactive').uncheck();
    await mode('control');assert.equal(await page.locator('#legend .point-swatch').count(),0,'Power legend points do not leak into Control view');assert.ok(await page.evaluate(()=>['electrification-supply-points','electrification-substation-areas'].every(id=>window.reviewMap.getLayoutProperty(id,'visibility')==='none')));
    await openSettings();await page.locator('#labels').uncheck();
    assert.ok(await page.evaluate(()=>['infrastructure-signal-references','infrastructure-signal-supplement-references'].every(id=>window.reviewMap.getLayoutProperty(id,'visibility')==='none')&&window.reviewMap.getLayoutProperty('infrastructure-signal-points','visibility')==='visible'));
    await page.locator('#labels').check();
    await mode('electrification');await visible('electrification-supply-points');assert.equal(supplyRequests,1,'Power view reuses its previously downloaded snapshot');assert.equal(lineRequests,1,'traction lines are downloaded once');assert.equal(siteRequests,1,'rail-served sites are downloaded once');await powerLegend(false);
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
