import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {waitUntil,setDefaultTimeout} from './wait-until.mjs';
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
setDefaultTimeout(page,90000);
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',msg=>{if(msg.type()==='error') { console.log('Browser resource:',msg.text()); if(/DataCloneError|already detached/.test(msg.text())) errors.push(msg.text()); }});
await page.addInitScript(()=>{
  const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(kind,options){return original.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);};
});
const evaluate=async(fn,arg)=>page.evaluate(async({source,arg})=>{
  const {map}=await import(document.querySelector('script[type="module"]').src);
  return await (0,eval)('('+source+')')(map,arg);
},{source:fn.toString(),arg});
async function waitContext(group) {
  await waitUntil(page,async group=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    return map.queryRenderedFeatures().some(f=>f.layer.id.startsWith('context-'+group+'-')&&f.layer.type==='symbol');
  },group,{timeout:90000});
}
async function settleContext() {
  // Source/layer replacement can give one populated frame followed by an
  // empty one while workers finish. Require several consecutive ready frames.
  let stable=0;
  for (let attempt=0;attempt<180;attempt++) {
    const ready=await evaluate(map=>map.getSource('openmaptiles') && map.isSourceLoaded('openmaptiles') &&
      map.queryRenderedFeatures().filter(f=>f.layer.id.startsWith('context-')).length>5);
    stable=ready?stable+1:0;
    if(stable>=4)return;
    await page.waitForTimeout(500);
  }
  throw new Error('Context tiles did not finish rendering');
}
async function screenshot(name) {
  await page.waitForTimeout(1800);
  await evaluate(async map=>{await new Promise(r=>{map.once('render',r);map.triggerRepaint();});const c=map.getCanvas();(c.getContext('webgl2')||c.getContext('webgl'))?.finish();});
  const bytes=await page.screenshot({path:`browser-review/context-${name}.jpg`,type:'jpeg',quality:65});
  console.log(`CONTEXT_${name.toUpperCase()}_START`+bytes.toString('base64')+`CONTEXT_${name.toUpperCase()}_END`);
}
await mkdir('browser-review',{recursive:true});
try {
  const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
  await page.goto(base+'?v=20261004-pr53-repair4&mode=speed&language=en&relief=0&inactive=0#14/22.299/114.172',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('body[data-map-ready="true"]',{state:'attached'});
  await waitContext('transport');await waitContext('destinations');await settleContext();
  console.log('CONTEXT_DATA',JSON.stringify(await evaluate(map=>({
    rendered:map.queryRenderedFeatures().filter(f=>f.layer.id.startsWith('context-')).map(f=>({layer:f.layer.id,name:f.properties.atlas_name,class:f.properties.class,subclass:f.properties.subclass})).slice(0,70),
    poiClasses:[...new Set(map.querySourceFeatures('openmaptiles',{sourceLayer:'poi'}).map(f=>f.properties.class+':'+f.properties.subclass))],
  }))));
  assert.ok(await evaluate(map=>map.queryRenderedFeatures().some(f=>f.layer.id.startsWith('context-destinations-')&&f.layer.type==='fill')),'destination areas render');
  await waitUntil(page,async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);return map.queryRenderedFeatures().some(f=>f.layer.id.startsWith('station-'));});
  await screenshot('hongkong');
  // A feature panel uses destination semantics, never railway speed/status.
  const point=await evaluate(async map=>{
    const {contextLayerInteractive}=await import(new URL('./context.mjs',document.querySelector('script[type="module"]').src));
    const f=map.queryRenderedFeatures().find(f=>f.layer.id.startsWith('context-destinations-')&&contextLayerInteractive(f.layer.id)&&f.geometry.type==='Point'&&map.project(f.geometry.coordinates).x>430);
    if(!f)return null; const p=map.project(f.geometry.coordinates);return [p.x,p.y];
  });
  assert.ok(point,'an interactive destination can be inspected');await page.mouse.click(...point);
  await page.waitForSelector('#details:not([hidden])');
  assert.match(await page.locator('#detail-content').innerText(),/PASSENGER DESTINATION/);
  await page.locator('#details-close').click();
  const stationPoint=await evaluate(async map=>{
    const {nearbyTransport}=await import(new URL('./context.mjs',document.querySelector('script[type="module"]').src));
    const facilities=map.querySourceFeatures('openmaptiles',{sourceLayer:'poi'}).map(f=>({id:f.id,properties:f.properties,geometry:f.geometry,sourceLayer:'poi'}));
    const station=map.queryRenderedFeatures().find(f=>f.layer.id.startsWith('station-')&&f.geometry.type==='Point'&&map.project(f.geometry.coordinates).x>430&&nearbyTransport(f.geometry.coordinates,facilities,500,map.getZoom()).length);
    if(!station)return null;const p=map.project(station.geometry.coordinates);return [p.x,p.y];
  });
  assert.ok(stationPoint,'a rail station has a nearby mapped interchange');
  await page.mouse.click(...stationPoint);
  await page.waitForSelector('#nearby-transport li');
  assert.match(await page.locator('#nearby-transport').innerText(),/not verified/);
  console.log('PASS: real station interchange context',await page.locator('#nearby-transport').innerText());
  await screenshot('interchange');
  await page.locator('#details-close').click();
  await page.locator('#settings-open').click();
  await page.locator('#transport').uncheck();await page.locator('#destinations').uncheck();await page.locator('#constraints').uncheck();
  assert.ok(await evaluate(map=>map.getStyle().layers.filter(l=>l.id.startsWith('context-')).every(l=>l.layout?.visibility==='none')),'both context groups are disabled');
  await waitUntil(page,async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);return !map.queryRenderedFeatures().some(f=>f.layer.id.startsWith('context-'));});
  assert.ok(await evaluate(map=>map.queryRenderedFeatures({layers:['building-footprints']}).length>0),'ordinary buildings remain visible with destinations disabled');
  await page.locator('#transport').check();await page.locator('#destinations').check();await page.locator('#constraints').check();
  await page.locator('#settings-close').click();
  await page.locator('#language').selectOption('zh-Hant');
  await waitUntil(page,async()=>{const {map}=await import(document.querySelector('script[type="module"]').src);return map.queryRenderedFeatures().some(f=>f.layer.id.startsWith('context-')&&f.properties.atlas_language==='zh-Hant');});
  await waitContext('transport');await settleContext();
  console.log('PASS: Hong Kong transport, destination labels/areas, shared language, toggles and inspection');
  // Discover and render every context layer from real worldwide basemap
  // features. This is category-specific rather than merely asking whether
  // "some context" rendered in each region. The deterministic style tests
  // separately exercise every zoom threshold; this browser matrix proves that
  // every generated layer can consume real provider data and render it.
  const discoverySamples=[
    {name:'London',center:[-0.1276,51.5072],zoom:17},
    {name:'Paris',center:[2.3522,48.8566],zoom:17},
    {name:'Amsterdam',center:[4.9041,52.3676],zoom:17},
    {name:'Rome',center:[12.4964,41.9028],zoom:17},
    {name:'Zermatt',center:[7.7491,46.0207],zoom:16},
    {name:'Rotterdam port',center:[4.287,51.90],zoom:16},
    {name:'Tokyo',center:[139.7671,35.6812],zoom:17},
    {name:'Hong Kong',center:[114.1694,22.3193],zoom:17},
    {name:'Hong Kong harbour',center:[114.1588,22.2876],zoom:17},
    {name:'Singapore',center:[103.8519,1.2903],zoom:17},
    {name:'Singapore port',center:[103.75,1.27],zoom:16},
    {name:'New York',center:[-73.9857,40.7484],zoom:17},
    {name:'San Francisco',center:[-122.4194,37.7749],zoom:17},
    {name:'Cambridge MA',center:[-71.1167,42.3770],zoom:17},
    {name:'Orlando theme parks',center:[-81.5639,28.3852],zoom:16},
    {name:'São Paulo',center:[-46.6333,-23.5505],zoom:17},
    {name:'Cape Town',center:[18.4241,-33.9249],zoom:17},
    {name:'Sydney',center:[151.2093,-33.8688],zoom:17},
    {name:'Heathrow',center:[-0.4543,51.47],zoom:14},
    {name:'Haneda',center:[139.7798,35.5494],zoom:14},
    {name:'Dubai airport',center:[55.3644,25.2532],zoom:14},
    {name:'Yakama region',center:[-120.58,46.3],zoom:10},
    {name:'Yellowstone region',center:[-110.58,44.60],zoom:10},
    {name:'Military land',center:[-0.78,51.28],zoom:14},
    {name:'North America jurisdictions',center:[-105,45],zoom:6},
    {name:'Australian jurisdictions',center:[134,-25],zoom:6},
    {name:'Mediterranean heritage',center:[12,42],zoom:10},
  ];
  const targets=await evaluate(map=>map.getStyle().layers
    .filter(layer=>layer.id.startsWith('context-'))
    .map(layer=>({id:layer.id,sourceLayer:layer['source-layer'],minzoom:layer.minzoom||0})));
  const candidates=new Map();
  for(const sample of discoverySamples){
    await evaluate(async(map,s)=>{
      // A jump can still report the previous viewport's loaded tiles until its
      // first render. Wait for that frame before checking the new source.
      await new Promise(resolve=>{map.once('render',resolve);map.jumpTo({center:s.center,zoom:s.zoom});map.triggerRepaint();});
    },sample);
    await waitUntil(page,async()=>{
      const {map}=await import(document.querySelector('script[type="module"]').src);
      return map.getSource('openmaptiles')&&map.isSourceLoaded('openmaptiles')&&['poi','landuse','aerodrome_label','aeroway','transportation','park','boundary'].some(sourceLayer=>map.querySourceFeatures('openmaptiles',{sourceLayer}).length>0);
    },undefined,{timeout:120000});
    await page.waitForTimeout(100);
    const found=await evaluate((map,sample)=>{
      const out=[];
      const atZoom=value=>Array.isArray(value)?value.length===1&&value[0]==='zoom'?['literal',sample.zoom]:value.map(atZoom):value;
      for(const layer of map.getStyle().layers.filter(layer=>layer.id.startsWith('context-'))){
        for(const feature of map.querySourceFeatures(layer.source,{sourceLayer:layer['source-layer'],filter:atZoom(layer.filter)})){
          // Geometry is a getter on MapLibre's feature prototype. Read it
          // directly rather than dropping it with an object spread.
          const points=[];
          const walk=value=>{
            if(Array.isArray(value)&&value.length>=2&&typeof value[0]==='number'&&typeof value[1]==='number')points.push(value);
            else if(Array.isArray(value))for(const child of value)walk(child);
          };
          walk(feature.geometry?.coordinates);
          if(!points.length)continue;
          let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
          for(const [x,y] of points){west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y);}
          out.push({id:layer.id,center:[(west+east)/2,(south+north)/2],zoom:Math.max(sample.zoom,layer.minzoom||0),sample:sample.name,sourceLayer:layer['source-layer']});
        }
      }
      return out;
    },sample);
    console.log('CONTEXT_SAMPLE',sample.name,found.length);
    for(const item of found){
      const list=candidates.get(item.id)||[];
      if(list.length<8&&list.filter(candidate=>candidate.sample===item.sample).length<2&&!list.some(candidate=>candidate.center[0]===item.center[0]&&candidate.center[1]===item.center[1]))list.push(item);
      candidates.set(item.id,list);
    }
    if(candidates.size===targets.length)break;
  }
  const missingTargets=targets.map(t=>t.id).filter(id=>!candidates.has(id));
  console.log('CONTEXT_DISCOVERY',JSON.stringify({found:[...candidates.values()],missing:missingTargets}));
  assert.deepEqual(missingTargets,[],'real worldwide samples supply every generated context layer');

  // Keep the production collision policy. Try several real source features
  // rather than choosing the first offscreen/colliding candidate permanently.
  const renderedMatrix=[];
  for(const target of targets){
    let result;
    for(const candidate of candidates.get(target.id)){
      await evaluate(async(map,item)=>{await new Promise(resolve=>{map.once('render',resolve);map.jumpTo({center:item.center,zoom:item.zoom});map.triggerRepaint();});},{...candidate,id:target.id});
      try{
        await waitUntil(page,async item=>{
          const {map}=await import(document.querySelector('script[type="module"]').src);
          return map.getSource('openmaptiles')&&map.isSourceLoaded('openmaptiles')&&map.queryRenderedFeatures({layers:[item.id]}).length>0;
        },{id:target.id},{timeout:15000});
        result=await evaluate((map,item)=>({id:item.id,zoom:map.getZoom(),count:map.queryRenderedFeatures({layers:[item.id]}).length}),{id:target.id});
        if(result.count>0){result.sample=candidate.sample;break;}
      }catch{}
    }
    assert.ok(result?.count>0,`${target.id} renders real provider data with production placement`);
    renderedMatrix.push(result);
  }
  console.log('PASS: every context layer renders real worldwide provider data',JSON.stringify(renderedMatrix));
  await screenshot('category-matrix');
  assert.deepEqual(errors,[]);
} catch(error) {
  console.log('CONTEXT_FAILURE',await evaluate(map=>({zoom:map.getZoom(),layers:Object.keys(map.getStyle().sources),poi:map.querySourceFeatures('openmaptiles',{sourceLayer:'poi'}).slice(0,25).map(f=>f.properties),rendered:map.queryRenderedFeatures().filter(f=>f.layer.id.startsWith('context-')).slice(0,20).map(f=>({layer:f.layer.id,p:f.properties}))})).catch(e=>String(e)));
  await screenshot('failure');throw error;
} finally {await browser.close();}
