// Keep startup fixtures in separate Node test processes: evaluated VM modules
// retain their contexts on Node 24 even after JSDOM closes and GC runs.
import {test,assert,readFile,model,frequencyModule,style,start,recoveryClock,failedRailTile,recoveryApp} from './startup-harness.mjs';


test('compact controls open from the icon and return focus to it on collapse and Escape', async () => {
  const {dom,window} = await start({compact:true});
  try {
    const d=window.document, icon=d.getElementById('controls-open'), collapse=d.getElementById('collapse'), panel=d.querySelector('.panel');
    assert.equal(d.getElementById('controls').hidden,true);
    assert.equal(panel.classList.contains('collapsed'),true);
    icon.click();
    assert.equal(d.getElementById('controls').hidden,false);
    assert.equal(icon.getAttribute('aria-expanded'),'true');
    assert.equal(d.activeElement,collapse);
    assert.equal(icon.getAttribute('aria-label'),'Collapse map controls');
    icon.click();
    assert.equal(d.getElementById('controls').hidden,true);
    icon.click();
    collapse.click();
    assert.equal(d.activeElement,icon);
    assert.equal(icon.getAttribute('aria-expanded'),'false');
    icon.click();collapse.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(d.getElementById('controls').hidden,true);
    assert.equal(d.activeElement,icon);
  } finally { dom.window.close(); }
});

test('saved hidden overlays are absent in the constructor before any tile request',async()=>{
 const {dom,maps}=await start({search:'?relief=0&inactive=0&stations=0&trackCounts=0&labels=0&transport=0&destinations=0&constraints=0&mode=speed'});
 try {
  const layers=maps[0].options.style.layers;
  for(const l of layers.filter(l=>/^terrain-|^inactive-|^station-|^context-/.test(l.id)||l.source==='trackCounts'||l.id==='speed-labels'))assert.equal(l.layout.visibility,'none',l.id);
  assert.equal(layers.find(l=>l.id==='speed-tracks').layout.visibility,'visible');
 }finally{dom.window.close();}
});
test('Causeway Bay search reaches both APIs before a delayed label bundle loads',async()=>{
 const calls=[];
 const places=[{osm_type:'way',osm_id:248971549,lat:'22.2802878',lon:'114.1841633',class:'railway',type:'station',name:'銅鑼灣 Causeway Bay',display_name:'銅鑼灣 Causeway Bay, Hong Kong',namedetails:{name:'銅鑼灣 Causeway Bay','name:en':'Causeway Bay'}}];
 const {dom,window,maps,loadLabels}=await start({delayLabels:true,fetcher:async url=>{
  calls.push(String(url));return {ok:true,json:async()=>String(url).includes('nominatim')?places:String(url).includes('/facility')?[]:structuredClone(style)};
 }});
 try {
  assert.equal(maps.length,0,'map waits for labels');
  window.document.getElementById('search-input').value='Causeway Bay';
  window.document.getElementById('search-form').dispatchEvent(new window.Event('submit',{cancelable:true}));
  for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,0));
  assert.ok(calls.some(u=>u.startsWith(model.SEARCH_API)));
  assert.ok(calls.some(u=>u.startsWith(model.PLACE_SEARCH_API)));
  assert.match(window.document.getElementById('search-results').textContent,/Causeway Bay/);
  assert.equal(window.document.getElementById('search-results').hidden,false);
 }finally{loadLabels();for(let i=0;i<5;i++)await new Promise(r=>setTimeout(r,0));dom.window.close();}
});


test('full app search distinguishes partial-empty, healthy rows, complete-empty and outage',async()=>{
 const station={osm_id:9001,name:'Synthetic healthy station',latitude:51.5,longitude:-.1,railway:'station'};
 for(const scenario of ['partial-empty','partial-rows','complete-empty','unavailable']){
  const {dom,window,loadLabels}=await start({delayLabels:true,fetcher:async url=>{
   const href=String(url),facility=href.startsWith(model.SEARCH_API),place=href.startsWith(model.PLACE_SEARCH_API);
   if(!facility&&!place)return {ok:true,json:async()=>structuredClone(style)};
   const failed=scenario==='unavailable'||scenario==='partial-empty'&&facility||scenario==='partial-rows'&&place;
   return {ok:!failed,status:failed?503:200,json:async()=>scenario==='partial-rows'&&facility?[station]:[]};
  }});
  try{
   const $=id=>window.document.getElementById(id);
   $('search-input').value='Synthetic';$('search-form').dispatchEvent(new window.Event('submit',{cancelable:true}));
   for(let i=0;i<10;i++)await new Promise(resolve=>setTimeout(resolve,0));
   const status=$('search-status');assert.equal(status.hidden,false);assert.equal(status.getAttribute('role'),'status');
   if(scenario.startsWith('partial')){assert.match(status.textContent,/Search incomplete/);assert.doesNotMatch(status.textContent,/No matching facility or place found/);}
   if(scenario==='partial-empty')assert.match(status.textContent,/No matches from the available sources.*station search unavailable/);
   if(scenario==='partial-rows'){assert.match(status.textContent,/1 railway result, 0 places.*place search unavailable/);assert.match($('search-results').textContent,/Synthetic healthy station/);}
   if(scenario==='complete-empty')assert.equal(status.textContent,'No matching facility or place found. Try a local name or railway code.');
   if(scenario==='unavailable')assert.equal(status.textContent,'Search is unavailable. Try again, or browse by panning and zooming.');
   assert.equal($('search-results').hidden,scenario!=='partial-rows');
  }finally{loadLabels();for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,0));dom.window.close();}
 }
});

test('map info identifies the executing cached asset and links to its build repository across backgrounds',async()=>{
 const commit='a'.repeat(40),sourceUrl=`https://git.example.test/fork/railway/commit/${commit}`,{dom,window,maps}=await start({assetQuery:'?v=cached-42',labelBuild:{version:'cached-42',commit,sourceUrl}});
 try {
  const attribution=()=>maps[0].controls.find(c=>c.options?.customAttribution)?.options;
  let info=attribution();assert.equal(info.compact,true);assert.match(info.customAttribution,/Build cached-42/);assert.ok(info.customAttribution.includes(`href="${sourceUrl}"`));assert.match(info.customAttribution,/Code aaaaaaaaaa/);
  window.document.querySelector('[data-background="carto"]').click();info=attribution();assert.equal(info.compact,true);assert.match(info.customAttribution,/Build cached-42/);assert.match(info.customAttribution,new RegExp(commit));
 } finally {dom.window.close();}
});
test('map info exposes mismatched cached bundle versions and handles a missing commit',async()=>{
 const {dom,maps}=await start({assetQuery:'?v=cached-42',labelBuild:{version:'cached-41',commit:''}});
 try {const info=maps[0].controls.find(c=>c.options?.customAttribution).options.customAttribution;assert.match(info,/Build cached-42/);assert.match(info,/Label build cached-41/);assert.match(info,/Development build/);}finally{dom.window.close();}
});

test('every versioned file the page loads asks for the page version', async () => {
  // The installed app saves the shell under the page's version and answers
  // a versioned request only from that version: a module asking for another
  // version cannot load offline.
  const {readdir} = await import('node:fs/promises');
  const dir = new URL('../styles/', import.meta.url);
  const page = (await readFile(new URL('index.html', dir), 'utf8')).match(/src="app\.mjs\?v=([\w.-]+)"/)[1];
  const found = [];
  // data-check.html is a page of its own, with its own version.
  for (const name of (await readdir(dir)).filter(n => /\.(mjs|html)$/.test(n) && !n.startsWith('data-check'))) {
    for (const [, version] of (await readFile(new URL(name, dir), 'utf8')).matchAll(/\?v=([\w.-]+)/g)) if (version !== page) found.push(`${name}: ${version}`);
  }
  const fallback = (await readFile(new URL('app.mjs', dir), 'utf8')).match(/get\('v'\) \|\| '([\w.-]+)'/)[1];
  assert.deepEqual(found, [], `page version ${page}`);
  assert.equal(fallback, page);
});

test('watch starts map-only and deliberate controls return to the map after each action',async()=>{
  const {dom,window,maps,errors}=await start({search:'?ui=watch',cookie:'atlas_settings='+encodeURIComponent(JSON.stringify({attributionOpen:true}))});
  try {
    assert.equal(errors.length,0);const doc=window.document,map=maps[0];map.handlers['style.load']();
    assert.equal(doc.body.dataset.ui,'watch');assert.equal(doc.querySelector('.panel').inert,true);
    assert.equal(doc.getElementById('watch-menu').hidden,true);
    map.handlers.click({point:{x:10,y:10}});assert.equal(doc.getElementById('details').hidden,true);
    const open=()=>doc.getElementById('map').dispatchEvent(new window.Event('contextmenu',{cancelable:true}));
    open();assert.equal(doc.getElementById('watch-menu').hidden,false);assert.equal(doc.getElementById('map-frame').inert,true);
    let select=doc.querySelector('#watch-content select');select.value='service';select.dispatchEvent(new window.Event('change'));
    assert.equal(doc.getElementById('watch-menu').hidden,true);assert.equal(map.visibility['service-routes'],'visible');
    assert.equal(doc.getElementById('service-width').value,'equal','basic Service remains the default in watch mode');
    open();doc.getElementById('watch-menu').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(doc.getElementById('watch-menu').hidden,true);
    open();select=doc.querySelector('#watch-content select[aria-label="Map options"]');select.value='standard';select.dispatchEvent(new window.Event('change'));
    assert.equal(doc.body.dataset.ui,'standard');assert.equal(doc.querySelector('.panel').inert,false);assert.equal(doc.getElementById('map-frame').inert,false);
    assert.match(decodeURIComponent(doc.cookie),/"attributionOpen":true/);
    assert.match(decodeURIComponent(doc.cookie),/"ui":"standard"/);
  } finally {dom.window.close();}
});
test('entering watch mode deactivates hidden drawing and measurement input',async()=>{
  const {dom,window,maps}=await start();
  try {
    const doc=window.document,map=maps[0];map.handlers['style.load']();
    for(const selector of ['[data-draw="line"]','[data-measure="distance"]']){
      const tool=doc.querySelector(selector);tool.click();assert.equal(map.doubleClickEnabled,false);
      const watch=doc.getElementById('watch-layout');watch.checked=true;watch.dispatchEvent(new window.Event('change'));
      assert.equal(map.doubleClickEnabled,true,'watch mode restores direct double-tap zoom');
      assert.equal(tool.getAttribute('aria-pressed'),'false','the hidden tool is inactive');
      assert.equal(doc.getElementById('draw-toolbar').hidden,true);assert.equal(doc.getElementById('measure-toolbar').hidden,true);
      watch.checked=false;watch.dispatchEvent(new window.Event('change'));assert.equal(tool.getAttribute('aria-pressed'),'false','returning to normal does not restore hidden editing');
    }
  } finally {dom.window.close();}
});

for (const mode of model.MODES) test(`${mode}: zoom-suppressed urban references are not reported as missing data`, async () => {
 const f=await start({search:`?mode=${mode}`});
 try {
  const map=f.maps[0],status=f.window.document.getElementById('map-status');
  map.handlers['style.load']();
  const reference=subclass=>({source:'openmaptiles',properties:{subclass},layer:{id:'rail-basemap-reference'}});
  for (const subclass of ['light_rail','monorail','tram','funicular']) {
   map.rendered=[reference(subclass)];
   for (const zoom of [8,9,9.99]) {
    map.zoom=zoom;map.handlers.idle();
    assert.doesNotMatch(status.textContent,/unavailable|Only basemap/);
    assert.equal(status.classList.contains('error'),false);
   }
   map.zoom=10;map.handlers.idle();assert.match(status.textContent,/Only basemap/);
   map.rendered.push({source:'railway',properties:{},layer:{id:`${mode}-tracks`}});
   map.handlers.idle();assert.doesNotMatch(status.textContent,/Only basemap/);
  }
  // Mixed references must still report an eligible missing mainline at z8.
  map.zoom=8;map.rendered=[reference('tram'),reference('rail')];
  map.handlers.idle();assert.match(status.textContent,/Only basemap/);
  map.rendered=[reference('tram')];
  const source=mode==='owner'?'ownerRail':mode==='axle'?'axleRail':'railway';
  map.handlers.error({sourceId:source,error:new Error('HTTP 403')});
  map.handlers.idle();assert.equal(status.classList.contains('error'),true);
  assert.doesNotMatch(status.textContent,/Only basemap/,'zoom suppression cannot conceal provider errors');
 } finally {f.dom.window.close();}
});

test('reference-only rail coverage is reported without mistaking a different view for detail',async()=>{
 const f=await start({search:'?mode=infrastructure'});
 try{
  const map=f.maps[0],status=f.window.document.getElementById('map-status');
  map.handlers['style.load']();map.zoom=10.9;
  const reference={source:'openmaptiles',properties:{},layer:{id:'rail-basemap-reference'}};
  map.rendered=[reference,{source:'railway',properties:{},layer:{id:'speed-tracks'}}];
  map.handlers.idle();assert.match(status.textContent,/Only basemap railway reference.*detailed railway data/);
  for(const id of ['infrastructure-tracks','infrastructure-metro-overview']){
   map.rendered=[reference,{source:'railway',properties:{},layer:{id}}];
   map.handlers.idle();assert.doesNotMatch(status.textContent,/Only basemap/);
  }
  map.rendered=[];map.handlers.idle();assert.doesNotMatch(status.textContent,/Only basemap/,'empty geography cannot prove missing rails');
 }finally{f.dom.window.close()}
});
test('reference coverage waits for the selected detail source and preserves actual resource errors',async()=>{
 for(const [mode,source] of [['infrastructure','railway'],['owner','ownerRail'],['axle','axleRail']]){
  const f=await start({search:`?mode=${mode}`});
  try{
   const map=f.maps[0],status=f.window.document.getElementById('map-status');
   map.handlers['style.load']();map.zoom=10.9;map.rendered=[{source:'openmaptiles',properties:{},layer:{id:'rail-basemap-reference'}}];
   let loaded=false;map.isSourceLoaded=id=>{assert.equal(id,source);return loaded};
   map.handlers.idle();assert.doesNotMatch(status.textContent,/Only basemap/,'pending geometry is not declared absent');
   loaded=true;map.handlers.idle();assert.match(status.textContent,/Only basemap/);
   map.handlers.error({sourceId:source,error:new Error('HTTP 403')});
   map.handlers.idle();assert.ok(status.classList.contains('error'));assert.doesNotMatch(status.textContent,/Only basemap/,'reference never clears a genuine failure');
  }finally{f.dom.window.close()}
 }
});

test('rail tile recovery updates visible app status without idle, after bookkeeping, including early style events', async () => {
  for (const early of [false, true]) {
    const f = await recoveryApp({early});
    try {
      if (early) {
        assert.equal(f.map.isStyleLoaded(),false,'exercise a genuinely cold style');
        assert.equal(f.window.document.body.dataset.mapReady,undefined);
        f.map.queryRenderedFeatures = () => {throw new Error('style is not ready');};
      }
      const tile = failedRailTile();f.fail(tile);
      assert.equal(f.status.classList.contains('error'), true);
      tile.state = 'loaded';f.data({tile, isSourceLoaded:true});
      assert.equal(f.status.classList.contains('error'), false, 'recovered tile clears status without an idle event');
      assert.match(f.status.textContent, /Explore the rail network/);
      f.data({tile, isSourceLoaded:true});
      assert.equal(f.status.classList.contains('error'), false, 'duplicate success is harmless');
      assert.equal(f.clock.timers.size, 0);assert.deepEqual(f.clock.retries, []);
    } finally {f.close();}
  }
});

test('partial rail recovery and loaded-but-errored sources retain the outage state without extra retries', async () => {
  const f = await recoveryApp();
  try {
    const a = failedRailTile(), b = failedRailTile(2);f.fail(a);f.fail(b);
    f.data({isSourceLoaded:true});f.data({tile:a, isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), true);
    a.state = 'loaded';f.data({tile:a, isSourceLoaded:true});
    assert.match(f.status.textContent, /OpenRailwayMap railway data unavailable\. Retrying failed tiles\./);
    assert.equal(f.clock.timers.size, 1);
    b.state = 'loaded';f.data({tile:b, isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), false);
    assert.equal(f.clock.timers.size, 0);assert.deepEqual(f.clock.retries, []);
  } finally {f.close();}
});

test('rail recovery preserves unrelated app errors until actual unrelated success', async () => {
  const f = await recoveryApp();
  try {
    const tile = failedRailTile();f.fail(tile);
    const otherTile={state:'errored'};
    f.map.handlers.error({sourceId:'openmaptiles', tile:otherTile, error:new Error('unrelated error')});
    tile.state = 'loaded';f.data({tile, isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), true);
    assert.match(f.status.textContent, /Some map data could not load/);
    f.map.handlers.sourcedata({sourceId:'openmaptiles', isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), true, 'loaded flag alone is not recovery');
    otherTile.state='loaded';f.map.handlers.sourcedata({sourceId:'openmaptiles', tile:otherTile, isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), false);
    assert.deepEqual(f.clock.retries, []);
  } finally {f.close();}
});

test('metadata recovery clears app bookkeeping without idle and cancellation is not an outage', async () => {
  const f = await recoveryApp();
  try {
    f.fail(undefined);f.data({isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), true);
    f.data({sourceDataType:'metadata', isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), false);
    f.map.handlers.error({sourceId:'railway', error:{name:'AbortError', message:'AbortError'}});
    assert.equal(f.status.classList.contains('error'), false);
    assert.equal(f.clock.timers.size, 0);assert.deepEqual(f.clock.retries, []);
  } finally {f.close();}
});

test('source replacement retires old recovery and disposal cancels every scheduled retry', async () => {
  const f = await recoveryApp();
  try {
    f.fail(failedRailTile());
    f.map.sources.railway = {url:'atlasrail://https://openrailwaymap.app/railway_line_high'};
    f.data({sourceDataType:'metadata', isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), false);
    assert.equal(f.clock.timers.size, 0);
    f.fail(failedRailTile(3));assert.equal(f.clock.timers.size, 1);
    f.map.handlers.remove();assert.equal(f.clock.timers.size, 0);
    f.map.handlers.moveend();assert.equal(f.clock.timers.size, 0);
    assert.deepEqual(f.clock.retries, []);
  } finally {f.close();}
});


test('platform measurement fetches HTTP templates rather than MapLibre protocol URLs', async () => {
  let options;
  const {dom,maps}=await start({platformGeometryOptions:value=>{options=value;}});
  try {
    const map=maps[0];map.sources ||= {};
    assert.ok(options);
    for(const raw of ['https://openrailwaymap.app/standard_railway_platforms/{z}/{x}/{y}',
      'http://127.0.0.1:4173/review-station-tiles/standard_railway_platforms/{z}/{x}/{y}.pbf']) {
      map.sources.platforms={tiles:[`atlasrail://${raw}`]};
      assert.equal(options.tileURL(),raw,'measurement uses native fetch, not the renderer protocol dispatcher');
      map.sources.platforms={tiles:[raw]};assert.equal(options.tileURL(),raw,'unwrapped fallback stays valid');
    }
    map.sources.platforms={};assert.equal(options.tileURL(),undefined,'metadata not ready stays pending');
  } finally {maps[0].handlers.remove();dom.window.close();}
});

test('settings hide and show failed layers without pan or idle resumes exactly one recovery timer',async()=>{
 const f=await recoveryApp();
 try{
  f.fail(failedRailTile());assert.equal(f.clock.timers.size,1);
  const doc=f.window.document;
  for(let i=0;i<2;i++){
   doc.querySelector('[data-background="satellite"]').click();assert.equal(f.clock.timers.size,0);
   assert.equal(f.status.classList.contains('error'),true,'hidden failures remain retained');
   doc.querySelector('[data-background="map"]').click();assert.equal(f.clock.timers.size,1);
   const id=[...f.clock.timers.keys()][0];doc.querySelector('[data-mode="infrastructure"]').click();assert.deepEqual([...f.clock.timers.keys()],[id],'settings do not postpone an existing timer');
  }
  f.map.sources.railwaySignals={url:'atlastext://https://openrailwaymap.app/railway_signals'};f.map.zoom=18;
  f.map.handlers.error({sourceId:'railwaySignals',tile:failedRailTile(),error:{status:520}});
  const railway=f.map.sources.railway;f.map.sources.railway={url:railway.url};
  doc.querySelector('[data-mode="speed"]').click();assert.equal(f.clock.timers.size,0);
  doc.querySelector('[data-mode="infrastructure"]').click();assert.equal(f.clock.timers.size,1);
  f.map.handlers.remove();doc.querySelector('[data-mode="speed"]').click();doc.querySelector('[data-mode="infrastructure"]').click();assert.equal(f.clock.timers.size,0);
 }finally{f.close();}
});

test('off-screen retirement reconciles owned errors without source success and retains other failures',async()=>{
 const f=await recoveryApp();
 try{
  const a=failedRailTile(1),b=failedRailTile(2);f.fail(a);f.fail(b);
  f.map.getBounds=()=>({getWest:()=>-174,getEast:()=>-172,getSouth:()=>80,getNorth:()=>85});
  f.map.handlers.moveend();assert.match(f.status.textContent,/OpenRailwayMap railway data unavailable\. Retrying failed tiles\./,'one remaining tile retains the warning');
  f.map.getBounds=()=>({getWest:()=>0,getEast:()=>10,getSouth:()=>-10,getNorth:()=>10});
  f.map.handlers.moveend();assert.equal(f.status.classList.contains('error'),false);assert.equal(f.clock.timers.size,0);
  f.map.getBounds=()=>undefined;f.fail(failedRailTile());
  f.map.handlers.error({sourceId:'openmaptiles',error:new Error('unrelated')});
  f.map.getBounds=()=>({getWest:()=>0,getEast:()=>10,getSouth:()=>-10,getNorth:()=>10});f.map.handlers.moveend();
  assert.match(f.status.textContent,/Some map data could not load/);assert.equal(f.status.classList.contains('error'),true);assert.equal(f.clock.timers.size,0);
 }finally{f.close();}
});

test('retirement cannot clear nonretryable or newer same-ID errors',async()=>{
 for(const replace of [false,true]){
  const f=await recoveryApp();try{
   f.fail(failedRailTile());if(replace)f.map.sources.railway={url:f.map.sources.railway.url};
   f.map.handlers.error({sourceId:'railway',tile:failedRailTile(3),error:{status:403,message:'HTTP 403'}});
   f.fail(failedRailTile(4));
   f.map.getBounds=()=>({getWest:()=>0,getEast:()=>10,getSouth:()=>-10,getNorth:()=>10});f.map.handlers.moveend();
   assert.equal(f.status.classList.contains('error'),true);assert.match(f.status.textContent,/OpenRailwayMap railway data unavailable/);assert.doesNotMatch(f.status.textContent,/Retrying/);assert.equal(f.clock.timers.size,0);
  }finally{f.close();}
 }
});

test('timer retirement reconciles status after its transaction and queued notifications are inert after disposal',async()=>{
 const f=await recoveryApp();
 try{
  f.fail(failedRailTile());
  f.map.getBounds=()=>({getWest:()=>0,getEast:()=>10,getSouth:()=>-10,getNorth:()=>10});
  const [id,timer]=f.clock.timers.entries().next().value;f.clock.timers.delete(id);timer.fn();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.status.classList.contains('error'),false);assert.equal(f.clock.timers.size,0);assert.deepEqual(f.clock.retries,[]);
  f.map.getBounds=()=>undefined;f.fail(failedRailTile());
  const before=f.status.textContent;f.map.handlers.remove();
  f.map.queryRenderedFeatures=()=>{throw new Error('disposed map must not be queried');};
  f.window.dispatchEvent(new f.window.Event('online'));f.window.document.dispatchEvent(new f.window.Event('visibilitychange'));f.map.handlers.moveend();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.status.textContent,before);assert.equal(f.clock.timers.size,0);
 }finally{f.close();}
});

// Issue #115: execute the actual application/legend against the controlled DOM.
// No provider data or substitute renderer is needed to expose the line-swatch bug.
test('Power legend is a fixed key of the facility drawing and current systems, preserved across setting and view changes', async () => {
  const {dom,window,errors} = await start({search:'?mode=electrification&inactive=0'});
  try {
    const doc = window.document, legend = doc.getElementById('legend');
    const checkPoints = former => {
      assert.equal(legend.querySelector('h2').textContent,'Railway power','not an in-view list');
      const items=[...legend.querySelectorAll('.legend-item')];
      assert.equal(items.filter(row=>row.firstElementChild.style.background.includes('gradient')).length,0,'exact values, no gradient rows');
      const key=items.map(row=>[row.firstElementChild.style.getPropertyValue('--swatch'),row.lastElementChild.textContent]).filter(([,label])=>/ (DC|AC [\d.]+ Hz)$/.test(label));
      assert.deepEqual(key,model.currentKey(),'one fixed row per voltage and current, coloured like the track paint');
      for (const label of ['1.5 kV DC','15 kV AC 16.7 Hz','25 kV AC 50 Hz','12.5 kV AC 60 Hz']) assert.ok(key.some(([,l])=>l===label),label);
      const samples = [...legend.querySelectorAll('.point-swatch')];
      assert.equal(samples.length,2,'one area and one point sample, not one per kind');
      for (const [index,shape] of ['rect','circle'].entries()) {
        const sample=samples[index];
        assert.equal(sample.getAttribute('aria-hidden'),'true');
        assert.equal(sample.classList.contains('swatch'),false,'line CSS cannot flatten a facility sample');
        const symbols=[...sample.querySelectorAll('svg')];
        assert.equal(symbols.length,former?2:1);
        for (const [i,symbol] of symbols.entries()) {
          assert.ok(symbol.querySelector(shape),shape);
          assert.equal(symbol.querySelector('path'),null,'no pictogram');
          if(shape==='rect')assert.equal(symbol.querySelector('rect').getAttribute('stroke-dasharray'),i?'2 2':null);
        }
      }
      assert.match(samples[0].nextElementSibling.textContent,/mapped outline/);
      assert.match(samples[1].nextElementSibling.textContent,/mapped point/);
      const line = label => [...legend.querySelectorAll('.legend-item')].find(row=>row.lastElementChild.textContent===label)?.firstElementChild;
      for (const label of ['Not electrified','Unknown','Bridge','Tunnel']) assert.ok(line(label)?.classList.contains('swatch'),label);
      assert.equal(line('Bridge').classList.contains('bridge'),true);
      assert.equal(line('Tunnel').classList.contains('tunnel'),true);
      assert.match(legend.querySelector('.legend-note').textContent,/Dashed, faint shapes are planned or former facilities/);
    };
    checkPoints(false);
    const inactive = doc.getElementById('inactive');inactive.checked=true;inactive.dispatchEvent(new window.Event('change'));
    checkPoints(true);
    assert.equal(legend.querySelectorAll('.pattern-swatch svg line').length,model.INACTIVE_STATES.length,'planned/former track patterns stay line samples');
    const help=legend.querySelector('.legend-help');help.open=true;help.dispatchEvent(new window.Event('toggle'));
    for (const mode of ['infrastructure','speed','control','gauge','loading','owner','service','axle']) {
      doc.querySelector(`[data-mode="${mode}"]`).click();
      assert.equal(legend.querySelectorAll('.point-swatch').length,0,`${mode} must not inherit power samples`);
      assert.ok(legend.querySelector('.swatch.bridge'));
    }
    doc.querySelector('[data-mode="electrification"]').click();checkPoints(true);
    assert.equal(legend.querySelector('.legend-help').open,true,'help disclosure survives a view change');
    inactive.checked=false;inactive.dispatchEvent(new window.Event('change'));checkPoints(false);
    doc.querySelector('[data-background="satellite"]').click();assert.equal(legend.hidden,true);
    doc.querySelector('[data-background="carto"]').click();assert.equal(legend.hidden,false);checkPoints(false);
    assert.deepEqual(errors,[]);
  } finally {dom.window.close();}
});

test('expired unoffered overnight and hourly evidence remains visible only in service details',async()=>{
 const fetcher=async url=>String(url).includes('frequency-manifest.json')?{ok:true,json:async()=>({schema:3,profiles:['am','pm','offpeak']})}:{ok:true,json:async()=>structuredClone(style)};
 const {dom,window,maps,errors}=await start({search:'?mode=service',fetcher,frequencyClock:{now:()=>1000,setTimer:()=>0,clearTimer:()=>{}}});
 try{
  const map=maps[0],doc=window.document;map.handlers['style.load']();
  for(let i=0;i<20&&!doc.querySelector('#frequency-period option[value="overnight"]').hidden;i++)await new Promise(r=>setTimeout(r,0));
  map.project=([lng,lat])=>({x:500+lng*100,y:400+lat*100});
  const evidence=frequencyModule.frequencyBundle([{ref:'R',kind:'rail'}],[[[0,0],[1,0]]],null,[{properties:{frequency_until:.5},profiles:{overnight:{rate:2},h08:{rate:0}}}],1000)[0];
  map.rendered=[{source:'serviceRoutes',sourceLayer:'service_routes',layer:{id:'service-routes'},properties:{...evidence,id:'relation-10',ref:'R',kind:'rail',i:0,n:1,frequency_status_h09:'invented'},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}}];
  map.handlers.click({point:{x:550,y:400},lngLat:{lng:.5,lat:0}});
  const rows=Object.fromEntries([...doc.querySelectorAll('#detail-content dt')].map(term=>[term.textContent,term.nextElementSibling.textContent]));
  assert.match(rows['Overnight · 00:00–05:00'],/evidence had expired at this snapshot build/);
  assert.match(rows['08:00–09:00'],/evidence had expired at this snapshot build/);
  assert.equal(rows['09:00–10:00'],undefined,'unrecorded or unrecognized hourly statuses are not invented');
  for(const period of ['overnight','hour'])assert.equal(doc.querySelector('#frequency-period option[value="'+period+'"]').hidden,true,'expired evidence does not offer an unavailable width selector');
  assert.equal(errors.length,0);
 }finally{dom.window.close();}
});

test('service details expose exact grouped and segment OSM sources, retain them on redraw, and disclose legacy limits', async () => {
 const {buildTiles,LAYER}=await import('../scripts/service-routes.mjs');
 const {serviceProvenanceFixture}=await import('../scripts/service-provenance-fixture.mjs');
 const {default:Pbf}=await import('pbf'),{VectorTile}=await import('@mapbox/vector-tile');
 const features=[...buildTiles(serviceProvenanceFixture())].filter(([key])=>key.startsWith('12/')).flatMap(([key,bytes])=>{
  const [z,x,y]=key.split('/').map(Number),layer=new VectorTile(new Pbf(bytes)).layers[LAYER];
  return Array.from({length:layer.length},(_,i)=>layer.feature(i).toGeoJSON(x,y,z));
 });
 const {dom,window,maps,errors}=await start({search:'?mode=service',frequencyClock:{now:()=>1000,setTimer:()=>0,clearTimer:()=>{}}});
 try{
  const map=maps[0],doc=window.document;map.handlers['style.load']();map.project=([lng,lat])=>({x:500+lng*100,y:400+lat*100});
  const show=properties=>{
   map.rendered=[{source:'serviceRoutes',sourceLayer:'service_routes',layer:{id:'service-routes'},properties,geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}}];
   map.handlers.click({point:{x:550,y:400},lngLat:{lng:.5,lat:0}});
  };
  const links=scope=>[...doc.querySelectorAll(`[data-relation-scope="${scope}"] a`)].map(a=>a.href);
  const urls=ids=>ids.map(id=>`https://www.openstreetmap.org/relation/${id}`);
  const south=features.find(f=>f.properties.id==='relation-10'&&f.properties.segment_relation_ids==='[20]').properties;
  show(south);
  assert.deepEqual(links('group'),urls([10,20,30]));assert.deepEqual(links('segment'),urls([20]));
  assert.match(doc.getElementById('detail-content').textContent,/Relation 10 \(display identity\)/);
  assert.match(doc.getElementById('detail-content').textContent,/does not establish identical stops, timetable matches or frequency/);
  const language=doc.getElementById('language');language.value='en';language.dispatchEvent(new window.Event('change'));
  assert.deepEqual(links('segment'),urls([20]),'translated redraw retains provenance');
  doc.getElementById('details-close').click();assert.equal(doc.getElementById('details').hidden,true);
  show({...south,segment_relation_ids:'[30]'});assert.deepEqual(links('segment'),urls([30]),'reopening a branch replaces previous contributors');
  for(const group of ['[10,20]','[20,10,20]']){
   show({...south,id:'relation-20',group_relation_ids:group,segment_relation_ids:'[20]'});
   assert.deepEqual(links('group'),[],'a noncanonical representative invalidates group provenance');
   assert.deepEqual(links('segment'),[],'a noncanonical representative invalidates segment provenance');
   assert.match(doc.getElementById('detail-content').textContent,/Constituent source relations are unavailable/);
   assert.equal(doc.querySelector('#detail-content a').href,'https://www.openstreetmap.org/relation/20');
   assert.doesNotMatch(doc.getElementById('detail-content').textContent,/display identity/);
  }
  show({...south,group_relation_ids:'[20,10,20]',segment_relation_ids:'[20]'});
  assert.deepEqual(links('group'),urls([10,20]),'the lowest normalized group ID remains canonical');
  assert.deepEqual(links('segment'),urls([20]),'the canonical relation need not contribute to this segment');
  assert.match(doc.getElementById('detail-content').textContent,/Relation 10 \(display identity\)/);
  for(const invalid of [undefined,'[999]','["<script>alert(1)</script>"]','[0]','[9007199254740992]','[10,']){
   show({...south,segment_relation_ids:invalid});
   assert.deepEqual(links('group'),[]);assert.deepEqual(links('segment'),[]);
   assert.match(doc.getElementById('detail-content').textContent,/Constituent source relations are unavailable/);
   assert.equal(doc.querySelector('#detail-content a').href,'https://www.openstreetmap.org/relation/10');
  }
  assert.equal(errors.length,0);
 }finally{dom.window.close();}
});

for(const error of [{status:400},{status:401},{status:403},{status:404},{message:'Bad response code: 403'},
  {message:'AJAXError: 404 (Not Found)'},{message:'AJAXError: Forbidden (403): https://metadata.test/permanent.json'},{name:'SyntaxError',message:'bad JSON'}]) test(`non-rail metadata app handler does not retry ${JSON.stringify(error)}`,async()=>{
  const clock=recoveryClock(),app=await start({metadataClock:clock}),map=app.maps[0];
  try {
    map.handlers['style.load']();map.sources.other={url:'https://metadata.test/tiles.json',loaded:()=>true,setUrl:url=>clock.retries.push(url)};
    map.handlers.error({sourceId:'other',error});assert.equal(clock.timers.size,0);
    assert.ok(app.window.document.getElementById('map-status').classList.contains('error'),'permanent failure stays visible');
  } finally {map.handlers.remove();app.dom.window.close();}
});
test('non-rail metadata app handler owns one transient timer and cancels it on permanent failure, success or removal',async()=>{
  const clock=recoveryClock(),app=await start({metadataClock:clock}),map=app.maps[0];
  try {
    map.handlers['style.load']();map.sources.other={url:'https://metadata.test/tiles.json',loaded:()=>true,setUrl:url=>clock.retries.push(url)};
    const fail=error=>map.handlers.error({sourceId:'other',error});
    fail({status:503});fail({status:503});assert.equal(clock.timers.size,1);assert.equal([...clock.timers.values()][0].delay,5000);
    fail({status:403});assert.equal(clock.timers.size,0);
    fail({status:503});fail({name:'AbortError',message:'Aborted'});assert.equal(clock.timers.size,0);
    fail({status:503});map.handlers.sourcedata({sourceId:'other',sourceDataType:'metadata',isSourceLoaded:false});assert.equal(clock.timers.size,0);
    map.sources.other.url='atlasbase://en/https://basemap.test/fixture.pmtiles';fail({message:'Bad response code: 503'});assert.equal(clock.timers.size,0,'no second basemap retry budget');
    map.sources.other.url='https://metadata.test/tiles.json';fail({status:503});map.handlers.remove();assert.equal(clock.timers.size,0);
  } finally {map.handlers.remove();app.dom.window.close();}
});

for (const sourceId of ['openmaptiles','satellite','osm']) test(`partial ${sourceId} recovery cannot clear another failed tile`,async()=>{
 const f=await recoveryApp();try{
  const a=failedRailTile(1),b=failedRailTile(2),healthy={state:'loaded',tileID:{canonical:{z:7,x:3,y:2}}};
  const fail=tile=>f.map.handlers.error({sourceId,tile,error:{status:403,message:'HTTP 403'}});
  const data=tile=>f.map.handlers.sourcedata({sourceId,tile,isSourceLoaded:true});
  fail(a);fail(b);data(healthy);
  assert.equal(f.status.classList.contains('error'),true,'a successful sibling is not recovery evidence for either failed tile');
  a.state='loaded';data(a);
  assert.equal(f.status.classList.contains('error'),true,'partial recovery retains the remaining tile failure');
  b.state='loaded';data(b);
  assert.equal(f.status.classList.contains('error'),false,'all recorded tile failures recovered');
 }finally{f.close();}
});

test('non-rail metadata, tiles and source-less resources recover independently',async()=>{
 const f=await recoveryApp();try{
  const sourceId='openmaptiles',tile=failedRailTile();
  f.map.handlers.error({sourceId,error:{status:403}});f.map.handlers.error({sourceId,tile,error:{status:403}});
  f.map.handlers.sourcedata({sourceId,sourceDataType:'metadata',isSourceLoaded:true});
  assert.equal(f.status.classList.contains('error'),true,'metadata success cannot erase failed tile');
  f.map.handlers.error({error:new Error('glyph failure without source identity')});
  tile.state='loaded';f.map.handlers.sourcedata({sourceId,tile,isSourceLoaded:true});
  assert.equal(f.status.classList.contains('error'),true,'source success cannot prove a source-less glyph recovered');
 }finally{f.close();}
});
test('non-rail source replacement retires old errors but hiding does not claim recovery',async()=>{
 const f=await recoveryApp();try{
  const sourceId='openmaptiles',tile=failedRailTile();f.map.handlers.error({sourceId,tile,error:{status:403}});
  f.window.document.querySelector('[data-background="satellite"]').click();
  assert.equal(f.status.classList.contains('error'),true);
  f.map.sources[sourceId]={url:'replacement'};
  f.map.handlers.sourcedata({sourceId,sourceDataType:'metadata',isSourceLoaded:true});
  assert.equal(f.status.classList.contains('error'),false);
 }finally{f.close();}
});
test('non-rail cached failures become visible again without a new error event',async()=>{
 const f=await recoveryApp();try{
  const sourceId='openmaptiles',source=f.map.getSource(sourceId),tile=failedRailTile();let active=[tile];
  f.map.style={tileManagers:{[sourceId]:{getSource:()=>source,getIds:()=>active.map((_,i)=>i),getTileByID:i=>active[i]}}};
  f.map.handlers.error({sourceId,tile,error:{status:403}});assert.equal(f.status.classList.contains('error'),true);
  active=[];f.map.handlers.moveend();assert.equal(f.status.classList.contains('error'),false);
  active=[tile];f.map.handlers.moveend();assert.equal(f.status.classList.contains('error'),true,'cached failure remains known');
  tile.state='loaded';f.map.handlers.sourcedata({sourceId,tile,isSourceLoaded:true});assert.equal(f.status.classList.contains('error'),false);
 }finally{f.close();}
});

for (const styleLoaded of [false, true]) test(`explicit pitched 2D share survives ${styleLoaded ? 'warm' : 'cold'} camera restoration`, async () => {
 const {dom,window,maps,errors}=await start({styleLoaded, search:'?terrain3d=0#12/35/139/0/45'});
 try {
   const map=maps[0];
   assert.equal(map.getPitch(),45);
   assert.equal(map.getTerrain(),null,'initial jump preserves shared 2D mode');
   // Exercise the registered once callback as well as the normal style handler.
   for(const callback of map.onceHandlers?.['style.load']||[]) callback();
   map.handlers['style.load']?.();
   assert.equal(map.getPitch(),45);
   assert.equal(map.getTerrain(),null,'style-ready restoration stays in 2D');
   const button=map.controls.flatMap(control=>control.buttons||[]).find(button=>button.id==='terrain-toggle');
   assert.equal(button.getAttribute('aria-pressed'),'false');
   assert.equal(window.location.search,'');
   map.setPitch(50);
   assert.equal(map.getTerrain()?.source,'terrain3d','a later user tilt can enable 3D');
   assert.deepEqual(errors,[]);
 } finally {dom.window.close();}
});

test('a remembered explicit 2D pitched globe view remains 2D', async () => {
 const {dom,maps,errors}=await start({savedView:{c:[139,35],z:3,b:0,p:45,g:true,t:false}});
 try {
   const map=maps[0];
   for(const callback of map.onceHandlers?.['style.load']||[]) callback();
   map.handlers['style.load']?.();
   assert.equal(map.getPitch(),45);
   assert.equal(map.getTerrain(),null);
   map.setPitch(50);
   assert.equal(map.getTerrain()?.source,'terrain3d');
   assert.deepEqual(errors,[]);
 } finally {dom.window.close();}
});

test('switching to 2D stops an older ease before arming exit suppression',async()=>{
 const {dom,maps,errors}=await start();
 try {
   const map=maps[0];map.handlers['style.load']();map.setPitch(75);
   const button=map.controls.flatMap(control=>control.buttons||[]).find(button=>button.id==='terrain-toggle');
   let easing=true;const frames=[];
   // Pinned MapLibre easeTo begins with _stop(), whose previous ease emits
   // moveend synchronously. That must not clear the new exit's suppression.
   map.stop=()=>{if(easing){easing=false;map.handlers.moveend();}};
   map.easeTo=options=>{
     map.stop();
     assert.equal(options.pitch,0);
     for(const pitch of [60,35,0]) {
       map.setPitch(pitch);
       frames.push([pitch,map.getTerrain()]);
     }
   };
   button.click();
   assert.deepEqual(frames,[[60,null],[35,null],[0,null]]);
   assert.equal(button.getAttribute('aria-pressed'),'false');
   assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
