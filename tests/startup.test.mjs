// Keep startup fixtures in separate Node test processes: evaluated VM modules
// retain their contexts on Node 24 even after JSDOM closes and GC runs.
import {globeModule,test,encodeTile,assert,readFile,createHash,vm,gzipSync,net,https,frequencyModule,unmockedRequests,html,code,style,legacyDistributions,start,ALL_PROBES} from './startup-harness.mjs';


for (const styleLoaded of [false, true]) test(`startup observes ${styleLoaded ? 'already loaded' : 'cold'} style readiness`, async () => {
  const {dom,maps,errors}=await start({styleLoaded});
  try {
    const map=maps[0];
    assert.equal(map.isStyleLoaded(),styleLoaded);
    assert.equal(dom.window.document.body.dataset.mapReady,styleLoaded?'true':undefined);
    if (!styleLoaded) {
      assert.equal(map.sourceData?.stationMajor,undefined,'cold startup cannot populate the worldwide placeholder viewport');
      map.handlers['style.load']();
      assert.equal(map.isStyleLoaded(),true);
      assert.equal(dom.window.document.body.dataset.mapReady,'true');
    }
    map.setPitch(55);
    assert.deepEqual(map.getTerrain(),{source:'terrain3d',exaggeration:3});
    assert.deepEqual(errors,[]);
  } finally {maps[0]?.handlers.remove?.();dom.window.close();}
});

test('pitch activates 3D terrain and overhead preserves mode until explicitly disabled', async () => {
  const {dom,window,maps,errors}=await start();
  try {
    const map=maps[0];
    map.handlers['style.load']();
    assert.equal(map.getTerrain(),null,'2D startup remains mesh-free');
    const button=map.controls.flatMap(control=>control.buttons||[]).find(button=>button.id==='terrain-toggle');
    assert.ok(button,'a live 3D control is registered');
    assert.equal(map.getMaxPitch(),85,'gesture tilt is allowed down to 85°');
    assert.equal(map.options.maxTileCacheSize,96,'each rendered source retains bounded tile cache');
    map.setPitch(55);
    assert.deepEqual(map.getTerrain(),{source:'terrain3d',exaggeration:3});
    assert.equal(button.getAttribute('aria-pressed'),'true');
    assert.match(button.getAttribute('aria-label'),/3× vertical/);
    const scale=window.document.getElementById('terrain-exaggeration');
    assert.equal(scale.value,'3');
    scale.value='5';
    scale.dispatchEvent(new window.Event('change',{bubbles:true}));
    assert.deepEqual(map.getTerrain(),{source:'terrain3d',exaggeration:5},'scale switches without pitching again');
    assert.match(button.getAttribute('aria-label'),/5× vertical/);
    assert.equal(button.querySelector('.terrain-scale-indicator').textContent,'5×');
    scale.value='1';
    scale.dispatchEvent(new window.Event('change',{bubbles:true}));
    assert.equal(map.getTerrain().exaggeration,1,'true-scale 3D can be restored');
    scale.value='99';
    scale.dispatchEvent(new window.Event('change',{bubbles:true}));
    assert.equal(scale.value,'1','invalid UI input is rejected');
    assert.equal(map.getTerrain().exaggeration,1,'invalid input cannot poison the mesh');
    assert.ok(maps.protocols['atlas-terrain'],'the 3D protocol must be installed');
    const relief=window.document.getElementById('relief');
    relief.click();
    assert.equal(map.getTerrain(),null,'turning relief off removes terrain');
    assert.equal(button.getAttribute('aria-pressed'),'false');
    relief.click();
    assert.equal(map.getTerrain().source,'terrain3d','restored settings reactivate 3D');
    assert.equal(button.getAttribute('aria-pressed'),'true','restoring relief without changing pitch refreshes the icon');
    assert.match(button.getAttribute('aria-label'),/Switch to 2D map/);
    map.setPitch(0);
    assert.equal(map.getTerrain()?.source,'terrain3d','overhead camera must not switch out of selected 3D');
    assert.equal(button.getAttribute('aria-pressed'),'true','3D icon stays selected at zero pitch');
    assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
});

test('3D mountain icon starts an actually detailed terrain view, not just a pitch flag',async()=>{
 const {dom,window,maps,errors}=await start();
 try {
   const map=maps[0];map.handlers['style.load']();
   // The startup Map mock collects addControl() calls without mounting the
   // control. Mount this one through its real MapLibre onAdd() interface.
   const control=map.controls.find(control=>control.buttons?.some(button=>button.id==='terrain-toggle'));
   assert.ok(control,'the native terrain control must be registered');
   window.document.body.append(control.onAdd());
   const button=window.document.getElementById('terrain-toggle');
   assert.ok(button,'native control must have a stable accessible identifier');
   assert.equal(button.textContent.trim(),'3×','visible badge discloses the default exaggeration');
   assert.doesNotMatch(button.textContent,/3D/,'mountain icon remains vector art rather than the old 3D text');
   assert.equal(button.querySelector('.terrain-scale-indicator')?.getAttribute('aria-hidden'),'true');
   assert.equal(button.querySelector('svg')?.getAttribute('viewBox'),'0 0 24 24');
   assert.ok(button.querySelectorAll('svg path').length>=3);
   assert.equal(button.getAttribute('aria-pressed'),'false');
   map.zoom=2;
   button.click();
   assert.equal(map.lastEase.pitch,60,'3D activation keeps the requested 60° initial angle');
   assert.ok(!(map.tileLodCalls||[]).some(args=>args.length===2&&args[0]===11&&args[1]===2),
     'initial 60° pitch must not enable the over-65° horizon budget');
   assert.ok(map.lastEase.zoom>=12.3,'whole-globe click must zoom to resolvable terrain');
   assert.equal(map.getTerrain()?.source,'terrain3d');
   assert.equal(button.getAttribute('aria-pressed'),'true');
   map.setPitch(0);
   assert.equal(map.getTerrain()?.source,'terrain3d','manual overhead rotation keeps the 3D mesh');
   assert.equal(button.getAttribute('aria-pressed'),'true');
   // The loading policy responds to actual subsequent manual tilt, not to
   // the first 3D button press. Cross 65° explicitly before its assertions.
   map.setPitch(82);
   assert.ok(map.tileLodCalls?.some(args=>args.length===2&&args[0]===11&&args[1]===2),
     'tilt beyond 65° enables coarser horizon tiles for all sources');
   assert.ok(map.tileLodCalls?.some(args=>args[0]===12&&args[1]===1.5&&args[2]==='terrain3d'),
     '3D DEM uses a stronger distant-tile LOD budget');
   // Mock the intermediate frames of MapLibre's 750 ms exit animation.
   // They must not reselect 3D merely because their pitch remains nonzero.
   const nativeEase=map.easeTo.bind(map);
   map.easeTo=options=>{
     if(options.pitch!==0)return nativeEase(options);
     map.lastEase=options;
     for(const pitch of [70,35,0]){
       map.setPitch(pitch);
       assert.equal(map.getTerrain(),null,`2D remains selected during exit at ${pitch}°`);
       assert.equal(button.getAttribute('aria-pressed'),'false');
     }
   };
   button.click();
   map.easeTo=nativeEase;
   assert.equal(map.lastEase.pitch,0);
   assert.equal('zoom' in map.lastEase,false,'overhead mode retains the focused terrain view');
   assert.ok(map.tileLodCalls.some(args=>args.length===2&&args[0]===9.314&&args[1]===3),
     'overhead view restores MapLibre default LOD after a real high-pitch transition');
   assert.equal(button.getAttribute('aria-pressed'),'false');
   assert.equal(map.getTerrain(),null,'explicit 2D icon press releases terrain');
   map.zoom=15;
   button.click();
   assert.equal('zoom' in map.lastEase,false,'already detailed views must not jump');
   assert.equal(map.lastEase.pitch,60);
   map.handlers.error({sourceId:'terrain3d',error:new Error('synthetic DEM outage')});
   assert.match(window.document.getElementById('map-status').textContent,/3D elevation tiles could not load/);
   assert.equal(errors.length,1,'the synthetic tile error must also be logged');
   assert.match(String(errors[0]),/Map resource error/);
 }finally{dom.window.close();}
});

test('an interrupted explicit switch to 2D does not lock out later intentional 3D tilt',async()=>{
 const {dom,window,maps,errors}=await start();
 try {
   const map=maps[0];map.handlers['style.load']();
   const control=map.controls.find(control=>control.buttons?.some(button=>button.id==='terrain-toggle'));
   window.document.body.append(control.onAdd());
   const button=window.document.getElementById('terrain-toggle');
   button.click();
   map.setPitch(80);
   map.easeTo=options=>{
     assert.equal(options.pitch,0);
     map.setPitch(45);
     assert.equal(map.getTerrain(),null,'interrupted exit remains 2D');
     map.handlers.moveend();
   };
   button.click();
   assert.equal(map.getTerrain(),null,'the explicit 2D transition remains selected');
   map.setPitch(55);
   assert.equal(map.getTerrain()?.source,'terrain3d',
     'a later user tilt can select 3D after an interrupted exit');
   map.setPitch(0);
   assert.equal(map.getTerrain()?.source,'terrain3d','returning overhead retains new 3D mode');
   assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('3D stays selected at 90-degree overhead through relief and scale changes',async()=>{
 const {dom,window,maps,errors}=await start();
 try {
   const map=maps[0];map.handlers['style.load']();
   const control=map.controls.find(control=>control.buttons?.some(button=>button.id==='terrain-toggle'));
   window.document.body.append(control.onAdd());
   const button=window.document.getElementById('terrain-toggle');
   button.click();
   map.setPitch(0);
   assert.equal(map.getPitch(),0);
   assert.deepEqual(map.getTerrain(),{source:'terrain3d',exaggeration:3});
   assert.equal(button.getAttribute('aria-pressed'),'true');
   const relief=window.document.getElementById('relief');
   relief.click();
   assert.equal(map.getTerrain(),null);
   relief.click();
   assert.deepEqual(map.getTerrain(),{source:'terrain3d',exaggeration:3},
     're-enabling relief restores selected 3D while still overhead');
   const scale=window.document.getElementById('terrain-exaggeration');
   scale.value='5';scale.dispatchEvent(new window.Event('change',{bubbles:true}));
   assert.deepEqual(map.getTerrain(),{source:'terrain3d',exaggeration:5});
   map.handlers.moveend();
   const stored=JSON.parse(window.localStorage.getItem('atlas_view'));
   assert.equal(stored.p,0);
   assert.equal(stored.t,true,'3D state is persisted independently of pitch');
   let copied='';
   Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{
     writeText:async value=>{copied=value;}
   }});
   window.document.getElementById('share').click();
   await new Promise(resolve=>setTimeout(resolve,0));
   const shared=new URL(copied);
   assert.equal(shared.searchParams.get('terrain3d'),'1',
     'a zero-pitch shared link explicitly requests the 3D renderer');
   assert.ok(shared.hash.startsWith('#'));
   button.click();
   assert.equal(map.getTerrain(),null,'2D requires a deliberate button press');
   assert.equal(map.getPitch(),0);
   assert.equal(button.getAttribute('aria-pressed'),'false');
   assert.equal(JSON.parse(window.localStorage.getItem('atlas_view')).t,false);
   map.setPitch(55);
   assert.equal(map.getTerrain()?.source,'terrain3d','a new deliberate tilt can enable 3D again');
   map.setPitch(0);
   assert.equal(map.getTerrain()?.source,'terrain3d','removing tilt does not undo 3D');
   assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('shared top-down 3D initializes with the terrain mesh at zero pitch',async()=>{
 const {dom,window,maps,errors}=await start({search:'?terrain3d=1#12.3/35/139'});
 try {
   const map=maps[0];map.handlers['style.load']();
   assert.equal(map.getPitch(),0);
   assert.equal(map.getTerrain()?.source,'terrain3d');
   assert.equal(window.location.search,'','shared mode is consumed without dirty browser history');
   const button=map.controls.flatMap(control=>control.buttons||[]).find(button=>button.id==='terrain-toggle');
   assert.equal(button.getAttribute('aria-pressed'),'true');
   assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('terrain control preserves clean history while sharing the current polar 3D view',async()=>{
 const cookie='atlas_settings='+encodeURIComponent(JSON.stringify({relief:false}));
 const {dom,window,maps,errors}=await start({search:'?ref=terrain-history',cookie});
 try {
   const map=maps[0];map.handlers['style.load']();
   map.getCenter=()=>({lat:89.7,lng:162});map.getBearing=()=>25;map.zoom=2;
   map.projection={type:'globe'}; // the real globe carries latitude-adjusted zoom
   const control=map.controls.find(control=>control.buttons?.some(button=>button.id==='terrain-toggle'));
   window.document.body.append(control.onAdd());
   const button=window.document.getElementById('terrain-toggle');
   const initialURL=window.location.href,initialLength=window.history.length,state={retained:'terrain-history'};
   window.history.replaceState(state,'',initialURL);
   const writes=[],replace=window.history.replaceState.bind(window.history);
   window.history.replaceState=(...args)=>{writes.push(args);return replace(...args);};
   let copied='';
   Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copied=value;}}});
   let focusedZoom;
   for(const pitch of [60,0]) {
     button.click();map.handlers.moveend();
     assert.equal(map.getPitch(),pitch);
     if(pitch===60){
       focusedZoom=map.getZoom();
       const target=globeModule.zoomForLatitude(12.3,0,89.7);
       assert.ok(Math.abs(focusedZoom-target)<1e-7,
         '3D focus must target polar ground scale, not raw z12.3 camera: '+focusedZoom);
       assert.ok(focusedZoom<12.3,'no extreme zoom jump at the pole');
     }
     else assert.equal(map.getZoom(),focusedZoom,'overhead mode keeps the focused view');
     const saved=JSON.parse(window.localStorage.getItem('atlas_view'));
     assert.deepEqual(saved.c,[162,89.7]);assert.equal(saved.z,Number(focusedZoom.toFixed(2)),'stored camera zoom retains the existing two-decimal persistence contract');assert.equal(saved.p,pitch);
     window.document.getElementById('share').click();
     await new Promise(resolve=>setTimeout(resolve,0));
     const shared=new URL(copied);
     assert.equal(shared.hash,globeModule.viewHash({zoom:focusedZoom,lat:89.7,lng:162,bearing:25,pitch}));
     assert.equal(shared.searchParams.get('ref'),'terrain-history');
     assert.equal(shared.searchParams.get('relief'),'1','the shared settings include relief enabled by the control');
     assert.equal(shared.searchParams.get('terrain3d'),pitch===60?'1':'0',
       'share link preserves selected rendering mode separately from the camera');
     assert.equal(window.location.href,initialURL);
     assert.equal(window.history.length,initialLength);
     assert.deepEqual(window.history.state,state);
     assert.deepEqual(writes,[],'terrain focusing, overhead return and sharing never rewrite history');
   }
   assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('startup network guard rejects native fetch, HTTP and socket fallbacks',async()=>{
 const before=unmockedRequests.length;
 await assert.rejects(globalThis.fetch('https://example.org/offline-sentinel'),/blocked unmocked network/);
 assert.throws(()=>https.request('https://example.org/offline-sentinel'),/blocked unmocked network/);
 const socket=new net.Socket();
 try {assert.throws(()=>socket.connect(443,'example.org'),/blocked unmocked network/);}
 finally {socket.destroy();}
 assert.deepEqual(unmockedRequests.splice(before),['https://example.org/offline-sentinel','HTTP','socket']);
});

test('drawing toolbar clears a first unfinished shape only after confirmation and accepts fresh input', async () => {
  const {dom, window, maps, errors} = await start();
  try {
    const map = maps[0], doc = window.document, prompts = [];
    let accepted = false;
    window.confirm = message => { prompts.push(message); return accepted; };
    map.handlers['style.load']();
    map.controls.flatMap(control => control.buttons || []).find(button => button.title === 'Drawing tools').click();
    assert.equal(doc.getElementById('draw-toolbar').hidden, false);
    doc.querySelector('[data-draw="line"]').click();
    const click = (lng, lat) => map.handlers.click({point: {x: lng * 100, y: lat * 100}, lngLat: {lng, lat}});
    click(0, 0); click(1, 1);
    assert.equal(map.sourceData['atlas-drawing'].features.length, 0);
    const before = structuredClone(map.sourceData['atlas-drawing-draft']);
    assert.equal(before.features.length, 1);
    doc.getElementById('draw-clear').click();
    assert.deepEqual(prompts, ['Delete all drawings?']);
    assert.deepEqual(map.sourceData['atlas-drawing-draft'], before, 'declining retains the unfinished shape');
    accepted = true; doc.getElementById('draw-clear').click();
    assert.equal(prompts.length, 2);
    for (const id of ['atlas-drawing', 'atlas-drawing-draft', 'atlas-drawing-handles']) assert.equal(map.sourceData[id].features.length, 0, id);
    assert.equal(doc.querySelector('[data-draw="line"]').getAttribute('aria-pressed'), 'true');
    doc.getElementById('draw-finish').click();
    assert.equal(map.sourceData['atlas-drawing'].features.length, 0, 'Finish cannot restore the cleared draft');
    doc.getElementById('draw-clear').click(); assert.equal(prompts.length, 2, 'empty Clear does not ask again');
    click(2, 2); click(3, 3); doc.getElementById('draw-finish').click();
    assert.deepEqual(map.sourceData['atlas-drawing'].features[0].geometry.coordinates, [[2, 2], [3, 3]]);
    doc.getElementById('draw-close').click(); assert.equal(doc.getElementById('draw-toolbar').hidden, true);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('measurement toolbar settles unavailable endpoint heights and recovers on an explicit repeat', async () => {
  let failing = true, requests = 0;
  const {dom, window, maps, errors} = await start({elevationOptions: {zoom: 2, load: async () => {
    requests++; if (failing) throw new Error('synthetic endpoint failure');
    return {size: 1, data: Uint8ClampedArray.from([128, 10, 0, 255])};
  }}});
  try {
    const map = maps[0], doc = window.document;
    map.handlers['style.load']();
    map.controls.flatMap(control => control.buttons || []).find(button => button.title === 'Measure').click();
    assert.equal(doc.getElementById('measure-toolbar').hidden, false);
    assert.equal(doc.querySelector('[data-measure="distance"]').getAttribute('aria-pressed'), 'true', 'Distance is selected when measuring opens');
    const finish = () => {
      for (const lat of [0, 1]) map.handlers.click({point: {x: 0, y: lat}, lngLat: {lng: 0, lat}});
      map.handlers.dblclick({preventDefault() {}});
    };
    const settle = async () => { for (let i = 0; i < 250 && status().includes('Finding heights'); i++) await Promise.resolve(); };
    const status = () => doc.getElementById('measure-status').textContent;
    finish(); assert.match(status(), /Finding heights/); await settle();
    assert.match(status(), /Distance: 111 km.*End-to-end heights unavailable/);
    assert.doesNotMatch(status(), /Finding heights/); assert.equal(requests, 2);
    failing = false; finish(); assert.equal(doc.getElementById('measure-retry').hidden, true); await settle();
    assert.match(status(), /End to end: ±0 m/); assert.equal(requests, 4);
    const label = map.sourceData['atlas-measure'].features.find(feature => feature.properties.kind === 'total').properties.label;
    assert.equal(label, '111 km\n±0 m · ±0% (0.0‰)');
    doc.getElementById('measure-close').click(); assert.equal(doc.getElementById('measure-toolbar').hidden, true);
    assert.equal(status(), ''); assert.equal(errors.length, 0);
  } finally { dom.window.close(); }
});

test('measurement toolbar retries heights with existing point handles without losing editing', async () => {
  let failing = true, requests = 0;
  const {dom, window, maps, errors} = await start({elevationOptions: {zoom: 2, load: async () => {
    requests++; if (failing) throw new Error('synthetic endpoint failure');
    return {size: 1, data: Uint8ClampedArray.from([128, 10, 0, 255])};
  }}});
  try {
    const map = maps[0], doc = window.document;
    map.handlers['style.load']();
    map.controls.flatMap(control => control.buttons || []).find(button => button.title === 'Measure').click();
    assert.equal(doc.querySelector('[data-measure="distance"]').getAttribute('aria-pressed'), 'true', 'Distance is selected when measuring opens');
    const retry = doc.getElementById('measure-retry');
    assert.ok(retry, 'the toolbar exposes an explicit endpoint-height retry');
    assert.equal(retry.parentElement.id, 'measure-toolbar', 'retry can wrap independently of the existing editing button group');
    assert.equal(retry.hidden, true);
    const status = () => doc.getElementById('measure-status').textContent;
    const settle = async () => { for (let i = 0; i < 250 && status().includes('Finding heights'); i++) await Promise.resolve(); };
    for (const lat of [0, 1]) map.handlers.click({point: {x: 0, y: lat}, lngLat: {lng: 0, lat}});
    map.handlers.dblclick({preventDefault() {}}); assert.equal(retry.hidden, true);
    await settle(); assert.equal(retry.hidden, false); assert.equal(requests, 2);
    map.getLayer = id => id === 'measure-point-targets' ? {} : undefined;
    map.rendered = [{layer: {id: 'measure-point-targets'},
      ...map.sourceData['atlas-measure'].features.find(feature => feature.properties.index === 0)}];
    map.handlers.click({point: {x: 0, y: 0}, lngLat: {lng: 0, lat: 0}});
    assert.equal(doc.getElementById('measure-delete').hidden, false, 'rendered endpoint remains selectable');
    const geometry = map.sourceData['atlas-measure'].features.map(feature => feature.geometry);
    failing = false; retry.click(); retry.click();
    assert.equal(retry.hidden, true); assert.match(status(), /Finding heights/); await settle();
    assert.equal(requests, 4, 'only one explicit two-endpoint retry');
    assert.match(status(), /End to end: ±0 m/); assert.equal(retry.hidden, true);
    assert.deepEqual(map.sourceData['atlas-measure'].features.map(feature => feature.geometry), geometry);
    assert.equal(doc.getElementById('measure-delete').hidden, false);
    doc.getElementById('measure-close').click(); assert.equal(retry.hidden, true);
    assert.equal(status(), ''); assert.equal(errors.length, 0);
  } finally { dom.window.close(); }
});

test('startup native-realm loaders use each window fixture without external fetch',async()=>{
 const states=[],requests=[[],[]];
 try {
  for(let index=0;index<2;index++){
   const state=await start({search:'?mode=electrification',fetcher:async (input,options)=>{
    const url=String(input);requests[index].push({url,options});
    return url.includes('/data/traction/power/')?new Response(gzipSync(JSON.stringify({type:'FeatureCollection',features:[]}))):{ok:true,json:async()=>structuredClone(style)};
   }});
   states.push(state);state.maps[0].handlers['style.load']();
   // The power-method file is gunzipped by DecompressionStream, whose work
   // runs on a background thread: wait for it (at most 2 s) instead of a
   // fixed number of timer ticks, which a busy CI runner can outrun.
   for(let wait=0;wait<200 && !state.maps[0].sourceData?.electricMethods;wait++)await new Promise(resolve=>setTimeout(resolve,10));
   assert.ok(state.maps[0].sourceData?.electricMethods,'the fixture must actually reach the native loader');
   assert.deepEqual(state.maps[0].sourceData.electricMethods.features,[]);
  }
  for(const calls of requests){
   const methods=calls.filter(call=>call.url.endsWith('/power-methods.geojson.gz'));
   assert.equal(methods.length,1,'each native-realm loader uses its own window mock');
   assert.equal(methods[0].url,'https://example.org/openrailwaystyle/data/traction/power/power-methods.geojson.gz');
   assert.equal(methods[0].options.cache,'no-cache');
   assert.equal(methods[0].options.body,undefined);
   assert.equal(methods[0].options.headers,undefined);
   assert.equal(methods[0].options.signal.aborted,false);
  }
 } finally {for(const {dom} of states)dom.window.close();}
});

test('application guards each replacement painter after WebGL context restoration',async()=>{
 const {dom,maps,errors}=await start();
 try {
  assert.deepEqual(errors,[]);const map=maps[0];
  const originalPainter=map.painter;
  for(let restoration=0;restoration<2;restoration++){
   // Pinned MapLibre _contextRestored calls _setupPainter, then fires this
   // public event synchronously before its requested next frame can run.
   map.painter={transform:{zoom:9+restoration},maskCalls:0,_renderTileClippingMasks(){this.maskCalls++;}};
   map.handlers.webglcontextrestored?.({type:'webglcontextrestored'});
   map.painter._renderTileClippingMasks({isHidden:()=>true},[],false);
   assert.equal(map.painter.maskCalls,0,'replacement painter retains the guard');
   map.painter._renderTileClippingMasks({isHidden:()=>false},[],true);
   assert.equal(map.painter.maskCalls,1,'visible restoration draws retain normal behavior');
   const installed=map.painter._renderTileClippingMasks;
   map.handlers.webglcontextrestored?.({type:'webglcontextrestored'});
   assert.equal(map.painter._renderTileClippingMasks,installed,'duplicate event does not stack guards');
  }
  assert.equal(originalPainter.maskCalls,0,'restoration leaves the discarded painter alone');
 } finally {dom.window.close();}
});

test('application installs the hidden-mask guard before the first renderer frame',async()=>{
 const {dom,maps,errors}=await start();
 try {
  assert.deepEqual(errors,[]);assert.equal(maps.length,1);
  const painter=maps[0].painter;
  painter._renderTileClippingMasks({isHidden:()=>true},[],false);
  assert.equal(painter.maskCalls,0,'hidden layers must not reach the original painter');
  painter._renderTileClippingMasks({isHidden:()=>false},[],false);
  assert.equal(painter.maskCalls,1,'visible layers still reach the original painter');
 } finally {dom.window.close();}
});

for (const previous of ['sw-before-first-party-libraries.js','sw-before-maplibre-backport.js']) test(`actual ${previous} keeps app/control versions coherent and safely recovers cached libraries`,async()=>{
  const [oldSource,newSource]=await Promise.all([
    readFile(new URL(`fixtures/${previous}`,import.meta.url),'utf8'),
    readFile(new URL('../styles/sw.js',import.meta.url),'utf8'),
  ]);
  const scope='https://example.org/openrailwaystyle/',stores=new Map(),fetched=[];
  const controlCode=await readFile(new URL('../styles/map-controls.mjs',import.meta.url),'utf8');
  const oldControlCode=controlCode.split('// MapLibre attribution hardening')[0];
  let deployed='old',offline=false,failReplacement=false,failControl=false;
  const caches={
    keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),
    open:async key=>{
      if(!stores.has(key))stores.set(key,new Map());const rows=stores.get(key);
      const keyOf=key=>typeof key==='string'?key:key.url;
      return {match:async key=>rows.get(keyOf(key))?.clone(),put:async(key,response)=>rows.set(keyOf(key),response.clone()),
        keys:async()=>[...rows.keys()].map(url=>new Request(url)),delete:async key=>rows.delete(keyOf(key))};
    },
  };
  const fetcher=async input=>{
    const url=new URL(typeof input==='string'?input:input.url||input.href);fetched.push(url.href);
    if(offline)throw Error('offline');
    if(failControl&&url.pathname.endsWith('/map-controls.mjs'))throw Error('control download interrupted');
    if(failReplacement&&url.pathname.endsWith('vendor/maplibre-gl-5.24.0-atlas.2.js'))throw Error('replacement library unavailable');
    const oldFirstParty=legacyDistributions.find(library=>url.pathname.endsWith('/'+library.target.replace('-atlas.2.js','.js')));
    if(url.hostname==='cdn.jsdelivr.net'||oldFirstParty) {
      const css=url.pathname.endsWith('.css');
      const library=oldFirstParty||legacyDistributions.find(library=>library.url===url.href);
      assert.ok(library,'only exact released dependencies enter the old cache');
      const body=library.body;
      assert.equal(createHash('sha256').update(body).digest('hex'),library.sourceSha256 || library.sha256);
      return new Response(body,{headers:{'content-type':css?'text/css':'application/javascript'}});
    }
    const body=url.href===scope?(deployed==='old'?'<script type="module" src="app.mjs?v=old"></script>':html)
      :url.pathname.endsWith('/app.mjs')&&deployed==='new'?code
      :url.pathname.endsWith('/map-controls.mjs')?(deployed==='new'?controlCode:oldControlCode):`${deployed}:${url.pathname}`;
    return new Response(body);
  };
  const worker=source=>{
    const handlers={};
    vm.runInNewContext(source,{URL,Response,Request,fetch:fetcher,caches,location:{origin:new URL(scope).origin},
      self:{registration:{scope},addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
    return handlers;
  };
  const install=handlers=>{let result;handlers.install({waitUntil:promise=>result=promise});return result;};
  const request=(handlers,path)=>{let result;handlers.fetch({request:{method:'GET',url:new URL(path,scope).href,mode:path==='./'?'navigate':'cors'},respondWith:promise=>result=promise});return result;};
  const old=worker(oldSource);await install(old);deployed='new';
  failControl=true;
  assert.match(await (await request(old,'./')).text(),/app.mjs\?v=old/, 'failed updated control module keeps the complete old page');
  failControl=false;
  assert.equal(await (await request(old,'./')).text(),html,'old worker really admitted the new HTML');
  failReplacement=true;await assert.rejects(install(worker(newSource)),/replacement library unavailable/);
  offline=true;
  assert.equal(await (await request(old,'./')).text(),html);
  const version=html.match(/src="app\.mjs\?v=([\w.-]+)"/)[1];
  assert.equal(await (await request(old,`app.mjs?v=${version}`)).text(),code,'the tested app is exactly the copy kept by the old worker');
  if(previous==='sw-before-first-party-libraries.js')assert.equal(request(old,'vendor/maplibre-gl-5.24.0-atlas.2.js'),undefined,'the actual CDN-era worker cannot serve the new dotted vendor path');
  const savedControls=await (await request(old,`map-controls.mjs?v=${version}`)).text();
  assert.equal(savedControls,controlCode,'new app receives exact updated controls from its own version');
  assert.equal(await (await request(old,'map-controls.mjs?v=old')).text(),oldControlCode,'old tab still receives its own controls');
  const before=fetched.length;
  const result=await start({cacheOnlyLibraries:caches,controlSource:savedControls});
  try {
    assert.equal(result.maps.length,1,'cached legacy JavaScript can still initialize the app');
    assert.deepEqual(result.errors,[]);
    assert.equal(result.scriptLoads.filter(url=>url.startsWith('blob:')).length,2);
    assert.equal(result.revoked.length,2,'temporary script URLs are released');
    assert.ok(result.scriptLoads.filter(url=>!url.startsWith('blob:')).every(url=>url.startsWith(scope+'vendor/')));
    const link=result.window.document.getElementById('maplibre-css'),fallback=link.nextElementSibling;
    assert.equal(fallback.tagName,'STYLE');
    assert.match(fallback.textContent,/maplibregl-map/);
    assert.ok(fallback.nextElementSibling.href.includes('app.css'),'app styling keeps priority over recovered MapLibre CSS');
    assert.equal(fetched.length,before,'cache recovery makes no network request, including to the old CDN');
  } finally {result.dom.window.close();}
});

test('new app recovers verified already-patched first-party cache bytes without a second patch',async()=>{
  const scope='https://example.org/openrailwaystyle/';
  const caches={keys:async()=>['atlas-shell-24'],open:async()=>({match:async url=>{
    if(url===scope)return new Response(html,{headers:{'content-type':'text/html'}});
    const library=legacyDistributions.find(library=>new URL(library.target,scope).href===url);
    if(!library)return undefined;
    return new Response(library.patchedBody||library.body,{headers:{'content-type':library.target.endsWith('.css')?'text/css':'text/javascript'}});
  }})};
  const result=await start({cacheOnlyLibraries:caches});
  try {
    assert.equal(result.maps.length,1);
    assert.deepEqual(result.errors,[]);
    assert.equal(result.scriptLoads.filter(url=>url.startsWith('blob:')).length,2);
    assert.equal(result.revoked.length,2);
  } finally {result.dom.window.close();}
});

test('new app upgrades exact atlas.1 cached bytes when atlas.2 installation is interrupted',async()=>{
  const scope='https://example.org/openrailwaystyle/';
  const original=legacyDistributions.find(library=>library.sourceSha256).body.toString('utf8');
  const previous=original.replace('of e.attributes)d.isPossiblyDangerous','of Array.from(e.attributes))d.isPossiblyDangerous')
    .replace('//# sourceMappingURL=maplibre-gl.js.map\n','');
  const caches={keys:async()=>['atlas-shell-69'],open:async()=>({match:async url=>{
    if(url===scope)return new Response(html,{headers:{'content-type':'text/html'}});
    if(url===scope+'vendor/maplibre-gl-5.24.0-atlas.1.js')return new Response(previous,{headers:{'content-type':'text/javascript'}});
    const library=legacyDistributions.find(library=>!library.sourceSha256&&new URL(library.target,scope).href===url);
    return library?new Response(library.body,{headers:{'content-type':library.target.endsWith('.css')?'text/css':'text/javascript'}}):undefined;
  }})};
  const result=await start({cacheOnlyLibraries:caches});
  try {
    assert.equal(result.maps.length,1);assert.deepEqual(result.errors,[]);
    assert.equal(result.scriptLoads.filter(url=>url.startsWith('blob:')).length,2);
    assert.equal(result.revoked.length,2);
  } finally {result.dom.window.close();}
});

test('legacy startup recovery ignores unrelated caches and non-JavaScript saved responses',async()=>{
  const requested=[];
  const caches={keys:async()=>['unrelated-cache','atlas-shell-22'],open:async name=>{
    assert.equal(name,'atlas-shell-22');
    return {match:async url=>{requested.push(url);return new Response('not executable',{headers:{'content-type':'text/plain'}});}};
  }};
  const result=await start({cacheOnlyLibraries:caches});
  try {
    assert.equal(result.maps.length,0);
    assert.equal(result.scriptLoads.filter(url=>url.startsWith('blob:')).length,0);
    assert.equal(result.window.document.getElementById('maplibre-css').nextElementSibling.tagName,'LINK');
    assert.ok(result.scriptLoads.every(url=>url.startsWith('https://example.org/openrailwaystyle/vendor/')));
    assert.ok(requested.length>0);
  } finally {result.dom.window.close();}
});
for(const mode of ['tampered-bytes','crypto-unavailable'])test(`legacy startup recovery rejects ${mode} even with HTTP 200 and correct MIME`,async()=>{
  const served=[];
  const caches={keys:async()=>['atlas-shell-22'],open:async()=>({match:async url=>{
    if(url==='https://example.org/openrailwaystyle/')return new Response(html,{headers:{'content-type':'text/html'}});
    const library=legacyDistributions.find(library=>library.url===url);
    if (!library) return undefined;
    const body=mode==='tampered-bytes'?Buffer.concat([library.body,Buffer.from('\n/* modified cached distribution */')]):library.body;
    const type=library.target.endsWith('.css')?'text/css':'application/javascript';
    served.push({url,status:200,type});
    return new Response(body,{status:200,headers:{'content-type':type}});
  }})};
  const result=await start({cacheOnlyLibraries:caches,noLegacyCrypto:mode==='crypto-unavailable'});
  try {
    assert.equal(result.maps.length,0);
    assert.equal(result.scriptLoads.filter(url=>url.startsWith('blob:')).length,0,'unverified bytes must never become an executable blob');
    assert.equal(result.window.document.getElementById('maplibre-css').nextElementSibling.tagName,'LINK','unverified CSS must never be inserted');
    assert.ok(result.scriptLoads.every(url=>url.startsWith('https://example.org/openrailwaystyle/vendor/')),'there is no network fallback to the CDN');
    assert.equal(served.length,mode==='tampered-bytes'?3:0,'all three valid-MIME responses reach integrity verification, or fail closed before reading without crypto');
  } finally {result.dom.window.close();}
});
test('installation help works before renderer libraries load and after WebGL initialization fails', async t => {
  for (const options of [{delayLibraries: true}, {failWebGL: true}]) await t.test(JSON.stringify(options), async () => {
    const {dom, window, maps} = await start(options);
    try {
      const get = id => window.document.getElementById(id);
      assert.equal(maps.length, 0, 'the renderer is unavailable in both cases');
      assert.equal(get('pwa-install-open').hidden, false);
      get('pwa-install-open').focus();
      get('pwa-install-open').click();
      assert.equal(get('pwa-install').open, true);
      assert.equal(get('pwa-install-generic').hidden, false);
      get('pwa-install-close').click();
      assert.equal(get('pwa-install').open, false);
      assert.equal(window.document.activeElement, get('pwa-install-open'));
    } finally { dom.window.close(); }
  });
});
test('a complete installed Chinese font is used without any download',async()=>{
 const {dom,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Noto Sans CJK TC':ALL_PROBES}});
 try{
  assert.equal(fonts.length,1,'only the 676-byte probe font');assert.equal(fonts[0].family,'Atlas Probe');
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));
  const map=maps[0];map.handlers['style.load']();await new Promise(r=>setTimeout(r,0));
  assert.equal(map.styleOptions?.localIdeographFontFamily??map.options.localIdeographFontFamily,'"Noto Sans CJK TC","Atlas Rare Han",sans-serif');
  const glyphs=new dom.window.CanvasRenderingContext2D();glyphs.font='400 24px "Noto Sans CJK TC",sans-serif';
  assert.equal(glyphs.lang,'zh-TW');assert.equal(fonts.length,1,'drawing Han labels with a complete font downloads nothing');assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('a partial installed Chinese font fetches the packaged font only once Han labels are drawn, for the current script',async()=>{
 // Microsoft JhengHei: Big5 without Simplified forms or Extension B.
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Microsoft JhengHei':'頓嘢冧俆㜏駅峠畑\uF900\uFA11㐀㙟','Microsoft YaHei':'顿頓嘢冧俆㜏駅峠畑\uF900\uFA11㐀㙟'}});
 try{
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));
  const map=maps[0];map.handlers['style.load']();await new Promise(r=>setTimeout(r,0));
  assert.equal(map.styleOptions.localIdeographFontFamily,'"Microsoft JhengHei","Atlas Rare Han",sans-serif','the best installed font meanwhile');
  assert.equal(fonts.length,1,'nothing is fetched before Han labels are drawn');
  const glyphs=new window.CanvasRenderingContext2D();glyphs.font='400 24px "Microsoft JhengHei",sans-serif';
  assert.equal(fonts.length,2);assert.match(fonts[1].url,/atlas-cjk-tc-v1\.woff2/);
  const language=window.document.getElementById('language');language.value='zh-Hans';language.dispatchEvent(new window.Event('change'));
  await new Promise(r=>setTimeout(r,0));
  fonts[1].finish();await new Promise(r=>setTimeout(r,0));assert.ok(!map.styleOptions.localIdeographFontFamily.includes('Atlas CJK TC'),'a stale download cannot overwrite the selected script');
  glyphs.font='400 24px "Microsoft YaHei",sans-serif';
  assert.equal(fonts.length,3);assert.match(fonts[2].url,/atlas-cjk-sc-v1\.woff2/);
  fonts[2].finish();await new Promise(r=>setTimeout(r,0));assert.equal(map.styleOptions.localIdeographFontFamily,'"Atlas CJK SC","Atlas Rare Han"');
  assert.ok(map.options.style.layers.filter(l=>l.type==='symbol'&&l.layout?.['text-font']).every(l=>l.layout['text-font'].includes('Atlas CJK SC')),'explicit Noto stacks must also include the loaded Han font');
  assert.match(map.options.style.glyphs,/^atlasglyph:\/\//,'Latin glyph requests strip the added local family');
  language.value='zh-Hant';language.dispatchEvent(new window.Event('change'));assert.equal(fonts.length,3);assert.equal(map.styleOptions.localIdeographFontFamily,'"Atlas CJK TC","Atlas Rare Han"','previously loaded font is reused');
  assert.ok(map.options.style.layers.filter(l=>l.type==='symbol'&&l.layout?.['text-font']).every(l=>l.layout['text-font'].includes('Atlas CJK TC')&&!l.layout['text-font'].includes('Atlas CJK SC')),'switching script replaces every explicit local font');
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('a failed packaged Chinese font download waits before trying again, and retries when back online',async()=>{
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Microsoft JhengHei':'頓嘢冧俆㜏駅峠畑\uF900\uFA11㐀㙟'}});
 const warn=console.warn;console.warn=()=>{};
 try{
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));maps[0].handlers['style.load']();await new Promise(r=>setTimeout(r,0));
  const glyphs=new window.CanvasRenderingContext2D();glyphs.font='400 24px "Microsoft JhengHei",sans-serif';
  assert.equal(fonts.length,2);fonts[1].fail();await new Promise(r=>setTimeout(r,0));
  for(let i=0;i<5;i++)glyphs.font='400 24px "Microsoft JhengHei",sans-serif';
  assert.equal(fonts.length,2,'later label drawing does not fetch the font again at once');
  assert.equal(maps[0].styleOptions.localIdeographFontFamily,'"Microsoft JhengHei","Atlas Rare Han",sans-serif','the installed font stays in use');
  window.dispatchEvent(new window.Event('online'));glyphs.font='400 24px "Microsoft JhengHei",sans-serif';
  assert.equal(fonts.length,3,'going back online retries');
  assert.deepEqual(errors,[]);
 }finally{console.warn=warn;dom.window.close();}
});

test('Japanese labels keep the installed Japanese font even when it is partial',async()=>{
 const {dom,window,maps,fonts}=await start({search:'?language=ja',fontFaces:true,installedFonts:{'Yu Gothic':'頓駅峠畑\uF900\uFA11㐀'}});
 try{
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));maps[0].handlers['style.load']();await new Promise(r=>setTimeout(r,0));
  const glyphs=new window.CanvasRenderingContext2D();glyphs.font='400 24px "Yu Gothic",sans-serif';
  assert.equal(glyphs.lang,'ja');assert.equal(fonts.length,1,'the packaged fonts are Chinese designs');
 }finally{dom.window.close();}
});

test('unavailable Chinese font preserves a working map and system fallback',async()=>{
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true});
 try{assert.deepEqual(errors,[]);maps[0].handlers['style.load']();fonts[0].fail();await new Promise(r=>setTimeout(r,0));assert.equal(window.document.body.dataset.mapReady,'true');assert.match(maps[0].options.localIdeographFontFamily,/Noto Sans TC/);}finally{dom.window.close();}
});

test('clicked station, service, entrance, power and context details share the selected regional font',async()=>{
 const fetcher=async url=>String(url).includes('/data/traction/power/')?new Response(JSON.stringify({type:'FeatureCollection',features:[]})):({ok:true,json:async()=>structuredClone(style)});
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Noto Sans CJK TC':ALL_PROBES,'Yu Gothic':ALL_PROBES,'Malgun Gothic':ALL_PROBES},fetcher});
 try{
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));
  const doc=window.document,map=maps[0],panel=doc.getElementById('detail-content');map.handlers['style.load']();
  map.project=([lng,lat])=>({x:500+lng*100,y:400+lat*100});
  const point={type:'Point',coordinates:[0,0]};
  const cases=[
   ['speed',{source:'stations',layer:{id:'station-detail-large-names'},properties:{name:'中央站',state:'disused'},geometry:point},'中央站'],
   ['service',{source:'serviceRoutes',layer:{id:'service-routes'},properties:{name:'山海線',kind:'rail',i:0,n:1},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}},'山海線'],
   ['infrastructure',{source:'stationEntrances',layer:{id:'infrastructure-entrance-points'},properties:{id:456,label:'北出口'},geometry:point},'北出口'],
   ['electrification',{source:'electricFacilities',layer:{id:'electrification-supply-points'},properties:{name:'南部水塔',power_kind:'water_tank'},geometry:point},'南部水塔'],
   ['infrastructure',{source:'openmaptiles',sourceLayer:'poi',layer:{id:'context-transport-bus-label'},properties:{name:'東部轉車站',class:'bus',subclass:'bus_station'},geometry:point},'東部轉車站'],
  ];
  for(const [mode,feature,name] of cases){
   doc.querySelector(`[data-mode="${mode}"]`).click();map.rendered=[feature];
   map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
   await new Promise(r=>setTimeout(r,0));
   assert.equal(doc.getElementById('details').hidden,false);
   assert.equal(panel.querySelector('h2').textContent,name);
   assert.equal(panel.querySelector('h2 [lang]').lang,'zh-TW');assert.match(panel.querySelector('h2 [lang]').style.fontFamily,/^"?Noto Sans CJK TC"?,/);
   assert.equal(panel.style.fontFamily,'','the shared panel does not override the interface font');
   for(const node of panel.querySelectorAll('.eyebrow,dt,p.small,a'))assert.equal(node.closest('[lang]')?.lang,'en','fixed English infobox text keeps its language');
   assert.match(panel.querySelector('h2 [lang]').style.fontFamily,/Atlas Rare Han/);
  }
  const language=doc.getElementById('language');
  for(const [code,family] of [['ja','Yu Gothic'],['ko','Malgun Gothic']]){
   language.value=code;language.dispatchEvent(new window.Event('change'));
   await new Promise(r=>setTimeout(r,0));
   assert.equal(panel.querySelector('h2 [lang]').lang,code,'Han runs follow the selected glyph language after the infobox redraw');
   assert.equal(panel.querySelector('h2 [lang]').style.fontFamily.split(',')[0].replaceAll('"',''),family);
  }
  language.value='zh-Hant';language.dispatchEvent(new window.Event('change'));
  doc.querySelector('[data-mode="speed"]').click();
  map.rendered=[{source:'stations',layer:{id:'station-detail-large-names'},properties:{name:'Central',state:'disused',operator:'Regional Rail 東京'},geometry:point}];
  map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});await new Promise(r=>setTimeout(r,0));
  assert.equal(panel.querySelector('h2').textContent,'Central');assert.equal(panel.querySelector('h2').style.fontFamily,'');
  const han=panel.querySelector('dd [lang]');assert.equal(han.textContent,'東京');assert.match(han.style.fontFamily,/^"?Noto Sans CJK TC"?,/);
  assert.deepEqual([...panel.querySelectorAll('[style]')].filter(node=>node.style.fontFamily),[han],'even a complete installed CJK font is applied only to the Han text, never Latin names or English UI');
  assert.equal(doc.documentElement.lang,'en','the surrounding English interface keeps its language');
  assert.equal(panel.closest('[lang]')?.lang,'en','the infobox container retains the interface language');
  assert.equal(fonts.length,1,'complete regional fonts need only the small probe');assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('English and local infoboxes scope script languages to CJK runs and preserve English text',async()=>{
 for(const language of ['en','local','zh-Hant']){
  const {dom,window,maps,errors}=await start({search:`?language=${language}`});
  try{
   const doc=window.document,map=maps[0],panel=doc.getElementById('detail-content');map.handlers['style.load']();
   const station={source:'stations',layer:{id:'station-detail-large-names'},properties:{name:'Central 東京 | 東京メトロ | 東京・テレポート | 東京･ﾒﾄﾛ | 首都圈·전철 | 경의-中央線 | 東京　メトロ | 大韓민국 | 北ㄅ | カナ | ｶﾞ | ﾊﾟ | カ゛ | ハ゜ | 한글 | ㄅㄆ | 東京・Metro',state:'disused',station_size:'large',operator:'Regional Rail'},geometry:{type:'Point',coordinates:[0,0]}};
   map.rendered=[station];map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
   await new Promise(r=>setTimeout(r,0));
   const heading=panel.querySelector('h2');assert.equal(heading.textContent,station.properties.name,'wrapping never changes the recorded text');
   assert.equal(heading.firstChild.data,'Central ');assert.equal(heading.firstChild.parentElement.closest('[lang]')?.lang,'en','the Latin part of a mixed name keeps English');
   const hanLanguage=language==='zh-Hant'?'zh-TW':'zh-CN';
   assert.deepEqual([...heading.querySelectorAll('[lang]')].map(span=>[span.textContent,span.lang]),[['東京',hanLanguage],['東京メトロ','ja'],['東京・テレポート','ja'],['東京･ﾒﾄﾛ','ja'],['首都圈·전철','ko'],['경의-中央線','ko'],['東京　メトロ','ja'],['大韓민국','ko'],['北ㄅ','zh-TW'],['カナ','ja'],['ｶﾞ','ja'],['ﾊﾟ','ja'],['カ゛','ja'],['ハ゜','ja'],['한글','ko'],['ㄅㄆ','zh-TW'],['東京',hanLanguage]],'internal punctuation and ideographic spaces keep mixed CJK names in one language');
   const latinSuffix=[...heading.childNodes].find(node=>node.nodeType===3&&node.data.includes('・Metro'));
   assert.ok(latinSuffix,'a separator followed by Latin text stays outside the CJK span');assert.equal(latinSuffix.parentElement.closest('[lang]')?.lang,'en');
   for(const node of [panel,heading,...panel.querySelectorAll('.eyebrow,dt,p.small,a')])assert.equal(node.closest('[lang]')?.lang,'en',`${language}: the CJK fallback must not relabel the English interface`);
   assert.equal(panel.style.fontFamily,'');assert.equal(heading.style.fontFamily,'');
   for(const [name,scriptLanguage] of [['東京',hanLanguage],['東京 テレポート','ja'],['東京\u00a0テレポート','ja'],['경의 중앙線','ko'],['首都圈 전철','ko'],['首都圈\u00a0전철','ko'],['東京メトロ1号線','ja'],['東京メトロ 1号線','ja'],['ㄊㄞˊ ㄅㄟˇ','zh-TW'],['ㄅˉ ㄅˊ ㄅˇ ㄅˋ ㄅ˙ ㄅ˪ ㄅ˫','zh-TW'],['˙ㄉㄜ','zh-TW'],['ㄊㄞˊ ˙ㄉㄜ','zh-TW']]){
    station.properties.name=name;map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
    await new Promise(r=>setTimeout(r,0));
    const spacedHeading=panel.querySelector('h2');
    assert.equal(spacedHeading.textContent,name,'wrapping preserves name whitespace and numbers');
    assert.deepEqual([...spacedHeading.querySelectorAll('[data-cjk-glyphs]')].map(span=>[span.textContent,span.lang]),[[name,scriptLanguage]],`${name}: internal spaces and numbers keep a name in one identified language`);
    assert.equal(spacedHeading.closest('[lang]')?.lang,'en','only the name span carries the script language');
   }
   for(const [name,names] of [
    ['東京・テレポート/서울교통공사',[['東京・テレポート','ja'],['서울교통공사','ko']]],
    ['東京メトロ;大韓민국',[['東京メトロ','ja'],['大韓민국','ko']]],
    ['東京メトロ・서울교통공사',[['東京メトロ','ja'],['서울교통공사','ko']]],
    ['東京メトロ서울교통공사',[['東京メトロ','ja'],['서울교통공사','ko']]],
    ['서울교통공사/東京・テレポート',[['서울교통공사','ko'],['東京・テレポート','ja']]],
    ['東京 メトロ / 서울교통공사',[['東京 メトロ','ja'],['서울교통공사','ko']]],
    ['東京メトロ / 경의 중앙線',[['東京メトロ','ja'],['경의 중앙線','ko']]],
    ['서울교통공사；東京\u00a0テレポート',[['서울교통공사','ko'],['東京\u00a0テレポート','ja']]],
    ['東京 メトロ・경의 중앙線',[['東京 メトロ','ja'],['경의 중앙線','ko']]],
    ['東京 メトロ 서울교통공사',[['東京 メトロ','ja'],['서울교통공사','ko']]],
    ['カナ˙ㄉㄜ',[['カナ','ja'],['˙ㄉㄜ','zh-TW']]],
   ]){
    station.properties.name=name;map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
    await new Promise(r=>setTimeout(r,0));
    const mixedHeading=panel.querySelector('h2');
    assert.equal(mixedHeading.textContent,name,'splitting languages preserves exact punctuation and text');
    assert.deepEqual([...mixedHeading.querySelectorAll('[data-cjk-glyphs]')].map(span=>[span.textContent,span.lang]),names,`${name}: conflicting script hints keep separate name languages`);
    assert.equal(mixedHeading.closest('[lang]')?.lang,'en','separators keep the surrounding interface language');
   }
   station.properties.name='Central';map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
   await new Promise(r=>setTimeout(r,0));
   assert.equal(panel.querySelector('h2').closest('[lang]')?.lang,'en','a Latin-only feature name keeps its inherited language');
   assert.equal(panel.querySelectorAll('[lang]').length,0,'English-only content needs no script wrappers');assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
 }
});

test('infobox Han text requests the packaged font after probing without requiring map glyph drawing',async()=>{
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Microsoft JhengHei':'頓嘢冧俆㜏駅峠畑\uF900\uFA11㐀㙟'}});
 try{
  const doc=window.document,map=maps[0],panel=doc.getElementById('detail-content');map.handlers['style.load']();
  const station={source:'stations',layer:{id:'station-detail-large-names'},properties:{name:'Central',state:'disused'},geometry:{type:'Point',coordinates:[0,0]}};
  map.rendered=[station];map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
  await new Promise(r=>setTimeout(r,0));assert.equal(fonts.length,1,'an English-only infobox does not request a CJK bundle');
  station.properties.operator='東海旅客鉄道';map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
  await new Promise(r=>setTimeout(r,0));assert.equal(fonts.length,1,'the probe is still pending');
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));
  assert.equal(panel.querySelector('h2').textContent,'Central');assert.match(panel.textContent,/東海旅客鉄道/);
  assert.equal(panel.querySelector('h2').closest('[lang]')?.lang,'en');
  assert.equal(panel.querySelector('dd [lang]').lang,'zh-TW','the Han operator value carries its own regional language');
  const packaged=fonts.find(f=>f.family==='Atlas CJK TC');assert.ok(packaged,'Han in a body value needs the font even though the heading is Latin');
  assert.match(panel.querySelector('dd [lang]').style.fontFamily,/^"?Microsoft JhengHei"?,/);
  packaged.finish();await new Promise(r=>setTimeout(r,0));
  assert.match(panel.querySelector('dd [lang]').style.fontFamily,/^"?Atlas CJK TC"?,/);assert.match(panel.querySelector('dd [lang]').style.fontFamily,/Atlas Rare Han/);
  assert.equal(panel.style.fontFamily,'','English text keeps its interface font while the CJK-only package is loaded');
  assert.equal(fonts.length,2,'the infobox and redraw share one package load');assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('an open infobox follows language and font changes while map style loading is delayed',async()=>{
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Microsoft JhengHei':'頓嘢冧俆㜏駅峠畑\uF900\uFA11㐀㙟','Microsoft YaHei':'顿頓嘢冧俆㜏駅峠畑\uF900\uFA11㐀㙟'}});
 try{
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));
  const doc=window.document,map=maps[0],panel=doc.getElementById('detail-content'),language=doc.getElementById('language');map.handlers['style.load']();
  map.rendered=[{source:'stations',layer:{id:'station-detail-large-names'},properties:{name:'漢岛',state:'disused'},geometry:{type:'Point',coordinates:[0,0]}}];
  map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});await new Promise(r=>setTimeout(r,0));
  const traditional=fonts.find(f=>f.family==='Atlas CJK TC');assert.ok(traditional);
  // Keep the style callback pending as it is when map resources load slowly.
  map.setStyle=(style,options)=>{map.options.style=style;map.styleOptions=options;};
  language.value='zh-Hans';language.dispatchEvent(new window.Event('change'));
  assert.equal(panel.querySelector('h2 [lang]').lang,'zh-CN');assert.doesNotMatch(panel.querySelector('h2 [lang]').style.fontFamily,/JhengHei|CJK TC/);
  await new Promise(r=>setTimeout(r,0));
  assert.match(panel.querySelector('h2 [lang]').style.fontFamily,/^"?Microsoft YaHei"?,/);
  const simplified=fonts.find(f=>f.family==='Atlas CJK SC');assert.ok(simplified);
  traditional.finish();await new Promise(r=>setTimeout(r,0));
  assert.doesNotMatch(panel.querySelector('h2 [lang]').style.fontFamily,/CJK TC/,'a stale Traditional download cannot replace the selected Simplified font');
  simplified.finish();await new Promise(r=>setTimeout(r,0));
  assert.match(panel.querySelector('h2 [lang]').style.fontFamily,/^"?Atlas CJK SC"?,/,'the loaded font reaches the open infobox before the map style finishes');
  language.value='zh-Hant';language.dispatchEvent(new window.Event('change'));
  assert.equal(panel.querySelector('h2 [lang]').lang,'zh-TW');assert.match(panel.querySelector('h2 [lang]').style.fontFamily,/^"?Atlas CJK TC"?,/,'switching back immediately reuses the finished font');
  assert.equal(panel.style.fontFamily,'');
  assert.equal(panel.closest('[lang]')?.lang,'en');
  assert.equal(fonts.length,3);assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('rare Han in infobox body values and later departure text loads only the displayed slices',async()=>{
 let completeBoard;
 const board=new Promise(resolve=>{completeBoard=resolve;}),requests=[];
 const fetcher=async url=>{requests.push(String(url));return {ok:true,status:200,json:async()=>String(url).includes('rare-han-v1/index.json')?{blocks:[0x2a7,0x2a8,0x2a9,0x2aa]}:structuredClone(style)};};
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Noto Sans CJK TC':ALL_PROBES},fetcher,departureLoader:()=>board});
 const slice=block=>fonts.find(f=>f.url.includes(`rare-han-v1/${block}.woff2`));
 const waitForSlice=async block=>{for(let i=0;i<100&&!slice(block);i++)await new Promise(r=>setTimeout(r,0));assert.ok(slice(block),`${block}: displayed text requests its glyph slice`);slice(block).finish();await new Promise(r=>setTimeout(r,0));};
 try{
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));
  const doc=window.document,map=maps[0],panel=doc.getElementById('detail-content');map.handlers['style.load']();
  assert.ok(!requests.some(url=>url.includes('rare-han-v1')),'no slices are needed before inspecting the feature');
  map.rendered=[{source:'stations',layer:{id:'station-detail-large-names'},properties:{name:'Central',operator:'Operator \u{2A700}',description:'Unshown \u{2AA00}'},geometry:{type:'Point',coordinates:[0,0]}}];
  map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
  assert.equal(doc.getElementById('details').hidden,false,'the infobox opens without waiting for a font');
  assert.equal(panel.querySelector('h2').textContent,'Central');await waitForSlice('2a7');
  completeBoard({stops:[{id:'fixture:central'}],stopResults:[{stopId:'fixture:central',status:'fulfilled'}],rows:[{line:'R',headsign:'Destination \u{2A800}',departure:0,tz:'UTC',mode:'RAIL'}]});
  await waitForSlice('2a8');
  const headsign=panel.querySelector('.departure-headsign');assert.equal(headsign.textContent,'Destination \u{2A800}');
  assert.equal(headsign.firstChild.data,'Destination ');assert.equal(headsign.closest('[lang]')?.lang,'en');
  const han=headsign.querySelector('[lang]');assert.equal(han.lang,'zh-TW');
  han.firstChild.data='\u{2A900}';await waitForSlice('2a9');assert.equal(headsign.textContent,'Destination \u{2A900}');
  han.firstChild.data='Extra \u{2A900}';await new Promise(r=>setTimeout(r,0));
  assert.equal(headsign.textContent,'Destination Extra \u{2A900}');assert.equal(headsign.querySelector('[lang]').textContent,'\u{2A900}','changing a CJK run to mixed text leaves its new English part outside the language span');
  headsign.querySelector('[lang]').firstChild.data='Central';await new Promise(r=>setTimeout(r,0));
  assert.equal(headsign.textContent,'Destination Extra Central');assert.equal(headsign.querySelector('[lang]'),null,'a run changed entirely to Latin no longer carries a CJK language');
  assert.equal(slice('2aa'),undefined,'unrendered feature properties do not download extra font slices');
  assert.equal(fonts.filter(f=>f.family==='Atlas Rare Han').length,3,'the original body is not downloaded again as asynchronous content arrives');
  assert.equal(requests.filter(url=>url.includes('rare-han-v1/index.json')).length,1);assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

for(const selector of ['#service-data-status','#legend > details.legend-help:not(#service-data-status)']) test(`legend redraw keeps live ${selector} state before native toggle delivery`,async()=>{
 const {dom,window,maps,errors}=await start({search:'?mode=service&serviceWidth=frequency&frequencyPeriod=peak'});
 try {
   const doc=window.document;
   const period=doc.getElementById('frequency-period');
   const redraw=value=>{period.value=value;period.dispatchEvent(new window.Event('change'));};
   let details=doc.querySelector(selector),toggles=0;
   assert.equal(details.open,false);
   details.addEventListener('toggle',()=>toggles++);
   details.open=true;
   assert.equal(toggles,0,'the native details toggle has not been delivered yet');
   redraw('offpeak');
   assert.notEqual(doc.querySelector(selector),details,'period change rebuilds the actual legend');
   assert.equal(doc.querySelector(selector).open,true,'opening survives a redraw before its queued toggle');
   await new Promise(resolve=>setTimeout(resolve,0));
   details=doc.querySelector(selector);details.open=false;
   redraw('peak');
   assert.equal(doc.querySelector(selector).open,false,'closing also survives a redraw before its queued toggle');
   await new Promise(resolve=>setTimeout(resolve,0));
   assert.equal(doc.querySelector(selector).open,false,'detached-node events cannot undo the live closed state');
   assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('detached service status toggle cannot overwrite the closed state while another mode is shown',async()=>{
 const {dom,window,errors}=await start({search:'?mode=service&serviceWidth=frequency'});
 try {
   const doc=window.document,retired=doc.getElementById('service-data-status');
   retired.open=true;retired.dispatchEvent(new window.Event('toggle'));
   const period=doc.getElementById('frequency-period');period.value='offpeak';period.dispatchEvent(new window.Event('change'));
   const current=doc.getElementById('service-data-status');
   assert.notEqual(current,retired);assert.equal(current.open,true);
   current.open=false;current.dispatchEvent(new window.Event('toggle'));
   doc.querySelector('[data-mode="infrastructure"]').click();
   assert.equal(doc.getElementById('service-data-status'),null);
   assert.equal(retired.isConnected,false);
   // Deliver the old view's queued notification after the live view closed.
   retired.dispatchEvent(new window.Event('toggle'));
   doc.querySelector('[data-mode="service"]').click();
   assert.equal(doc.getElementById('service-data-status').open,false,'returning to Service retains the last live state');
   assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('service frequency profile is applied on the first frame and controls persist independently',async()=>{
  const {dom,window,maps,errors}=await start({search:'?mode=service&serviceWidth=frequency&frequencyPeriod=peak&peakPhase=pm'});
  try {
    assert.equal(errors.length,0);
    const doc=window.document, map=maps[0];
    assert.equal(doc.getElementById('service-frequency-options').hidden,false);
    assert.equal(doc.getElementById('peak-phase-options').hidden,false);
    assert.equal(doc.getElementById('peak-phase').value,'pm');
    const first=map.options.style.layers.find(l=>l.id==='service-routes').paint;
    assert.match(JSON.stringify(first['line-width']),/frequency_width_pm/);
    map.handlers['style.load']();
    const period=doc.getElementById('frequency-period');period.value='offpeak';period.dispatchEvent(new window.Event('change'));
    assert.match(JSON.stringify(map.paintProperties['service-routes']['line-offset']),/frequency_offset_offpeak/);
    assert.equal(doc.getElementById('peak-phase-options').hidden,true);
    assert.match(decodeURIComponent(doc.cookie),/"frequencyPeriod":"offpeak"/);
    period.value='overnight';period.dispatchEvent(new window.Event('change'));
    assert.match(JSON.stringify(map.paintProperties['service-routes']['line-width']),/frequency_width_overnight/);
    period.value='hour';period.dispatchEvent(new window.Event('change'));
    const hour=doc.getElementById('frequency-hour');hour.value='1';hour.dispatchEvent(new window.Event('change'));
    assert.equal(doc.getElementById('frequency-hour-options').hidden,false);
    assert.match(JSON.stringify(map.paintProperties['service-routes']['line-width']),/frequency_width_h01/);
    assert.match(decodeURIComponent(doc.cookie),/"frequencyHour":1/);
    const width=doc.getElementById('service-width');width.value='equal';width.dispatchEvent(new window.Event('change'));
    assert.equal(doc.getElementById('frequency-profile-options').hidden,true);
    assert.doesNotMatch(JSON.stringify(map.paintProperties['service-routes']['line-width']),/frequency_width/);
    doc.querySelector('[data-mode="speed"]').click();
    assert.equal(doc.getElementById('service-frequency-options').hidden,true);
  } finally {dom.window.close();}
});
test('frequency periods no applied source covers are not offered, and a link to one falls back',async()=>{
  const fetcher=async url=>String(url).includes('frequency-manifest.json')?{ok:true,json:async()=>({schema:3,profiles:['am','pm','offpeak']})}:{ok:true,json:async()=>structuredClone(style)};
  const {dom,window,errors}=await start({search:'?mode=service&serviceWidth=frequency&frequencyPeriod=overnight',fetcher});
  try {
    assert.equal(errors.length,0);
    for(let i=0;i<20&&!window.document.querySelector('#frequency-period option[value="overnight"]').hidden;i++)await new Promise(r=>setTimeout(r,0));
    const options=Object.fromEntries([...window.document.getElementById('frequency-period').options].map(o=>[o.value,o.hidden]));
    assert.deepEqual(options,{offpeak:false,peak:false,overnight:true,hour:true});
    assert.equal(window.document.getElementById('frequency-period').value,'offpeak','a period without a source falls back');
    assert.doesNotMatch(window.document.getElementById('legend').textContent,/Overnight and individual hours/,'the legend does not describe uncovered periods');
  } finally {dom.window.close();}
});
test('equal-width service details expire even after the inspected route leaves loaded tiles',async()=>{
  let stamp=1000,scheduled;
  const frequencyClock={now:()=>stamp,setTimer:(fn,delay)=>(scheduled={fn,delay}),clearTimer:()=>{scheduled=undefined;}};
  const {dom,window,maps,errors}=await start({search:'?mode=service',frequencyClock});
  try{
    const map=maps[0],doc=window.document;map.handlers['style.load']();
    map.project=([lng,lat])=>({x:500+lng*100,y:400+lat*100});
    const feature={source:'serviceRoutes',sourceLayer:'service_routes',layer:{id:'service-routes'},properties:{id:'gtfs:fixture:R',ref:'R',kind:'rail',i:0,n:1,frequency_until:2,frequency_offpeak:2,frequency_high_offpeak:2,frequency_quality_offpeak:'scheduled'},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}};
    map.rendered=[feature];map.sourceFeatures=[feature];map.handlers.sourcedata({sourceId:'serviceRoutes',tile:{}});
    map.handlers.click({point:{x:550,y:400},lngLat:{lng:.5,lat:0}});
    assert.match(doc.getElementById('detail-content').textContent,/2\/h\/direction/);
    map.sourceFeatures=[];map.handlers.sourcedata({sourceId:'serviceRoutes',tile:{}});
    assert.equal(scheduled?.delay,1001,'the open panel keeps its expiry when the route leaves the viewport');
    stamp=2001;scheduled.fn();
    assert.doesNotMatch(doc.getElementById('detail-content').textContent,/2\/h\/direction/);
    assert.match(doc.getElementById('detail-content').textContent,/Matched frequency profile has expired; current frequency is unknown/);
    assert.equal(errors.length,0);
    window.dispatchEvent(new window.Event('pagehide'));
  }finally{dom.window.close();}
});
test('mixed timetable and headway details name each source, period definition and terms link',async()=>{
 const catalog=JSON.parse(await readFile(new URL('../styles/service-headways.json',import.meta.url),'utf8'));
 const timetable={properties:{frequency_source:'Full timetable',frequency_url:'https://example.test/timetable-terms',frequency_checked:'2026-10-05',frequency_definition:'Agency-local 07:00–09:00',frequency_date:'2026-10-05',frequency_credit:'Timetable operator',frequency_license:'CC0',frequency_until:20},profiles:{am:{rate:4,quality:'scheduled'}}};
 const properties=frequencyModule.frequencyBundle([{ref:'ISL',network:'港鐵 MTR',kind:'subway'}],[[[114.12,22.28],[114.13,22.29]]],catalog,[timetable],1000)[0];
 const {dom,window,maps,errors}=await start({search:'?mode=service',frequencyClock:{now:()=>1000,setTimer:()=>0,clearTimer:()=>{}}});
 try{
  const map=maps[0],doc=window.document;map.handlers['style.load']();map.project=([lng,lat])=>({x:500+lng*100,y:400+lat*100});
  map.rendered=[{source:'serviceRoutes',sourceLayer:'service_routes',layer:{id:'service-routes'},properties:{...properties,id:'relation-10',ref:'ISL',kind:'subway',i:0,n:1},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}}];
  map.handlers.click({point:{x:550,y:400},lngLat:{lng:.5,lat:0}});
  const panel=doc.getElementById('detail-content');assert.match(panel.textContent,/Full timetable · Morning peak/);assert.match(panel.textContent,/MTR published average headways · Evening peak, Off-peak/);assert.match(panel.textContent,/clock windows are not supplied/);
  const links=[...panel.querySelectorAll('a')].filter(a=>a.textContent==='Frequency source and terms').map(a=>a.href);assert.deepEqual(links,[timetable.properties.frequency_url,catalog.source.url]);assert.equal(errors.length,0);
 }finally{dom.window.close();}
});
test('app starts with the MapLibre 5 API and enables map controls', async () => {
  const {dom,window,maps,errors} = await start();
  try {
    assert.equal(maps.length,1,'startup must reach the map constructor');
    assert.equal(errors.length,0);
    // Bathymetry must not win a startup race by making the basemap PMTiles
    // archive with PMTiles' untimed default FetchSource.
    assert.equal(maps.pmtiles.tiles.size,1);
    const [[basemapKey,basemap]]=[...maps.pmtiles.tiles];
    assert.match(basemapKey,/planet\.pmtiles$/);
    assert.equal(basemap.source.ms,20000);
    assert.equal(basemap.source.inner.url,basemapKey);
    assert.equal(maps[0].options.style.sources.inactiveRegional.tiles[0],'railtiles://{z}/{x}/{y}?lang=local');
    maps[0].handlers.styleimagemissing({id:'station-dot'});
    assert.equal(maps[0].image.id,'station-dot');
    assert.equal(maps[0].image.data.data.length,32*32*4);
    maps[0].handlers['style.load']();
    assert.equal(window.document.body.dataset.mapReady,'true');
    // The Infrastructure view on a first visit, from the first frame.
    assert.equal(maps[0].options.style.layers.find(l => l.id === 'speed-tracks').layout.visibility,'none');
    assert.equal(maps[0].visibility['infrastructure-tracks'],'visible');
    assert.equal(maps[0].visibility['speed-tracks'],'none');
    maps[0].handlers.error({error:{name:'AbortError',message:'AbortError'}});
    assert.equal(window.document.getElementById('map-status').classList.contains('error'),false);
    assert.equal(errors.length,0);
    window.document.querySelector('[data-mode="speed"]').click();
    assert.equal(maps[0].visibility['speed-tracks'],'visible');
    window.document.querySelector('[data-mode="infrastructure"]').click();
    assert.equal(maps[0].visibility['speed-tracks'],'none');
    assert.equal(maps[0].visibility['infrastructure-tracks'],'visible');
    assert.equal(maps[0].visibility['station-stations-dots'],'visible');
    const importanceColours = window.document.getElementById('stationImportanceColors');
    assert.equal(importanceColours.checked,false,'low-zoom importance colours are off by default');
    const uniformLowZoom=['step',['zoom'],'#123e52',7,['match',['get','station_size'],'large','#123e52','#0865c0']];
    assert.equal(JSON.stringify(maps[0].paint['station-major-3-names']),JSON.stringify(uniformLowZoom));
    assert.equal(JSON.stringify(maps[0].paint['station-stationLow-large-names']),JSON.stringify(uniformLowZoom));
    assert.equal(JSON.stringify(maps[0].paint['station-stationMed-normal-names']),JSON.stringify(uniformLowZoom));
    importanceColours.checked = true; importanceColours.dispatchEvent(new window.Event('change'));
    const importance=['match',['get','station_size'],'large','#123e52','#0865c0'];
    assert.equal(JSON.stringify(maps[0].paint['station-major-3-names']),JSON.stringify(importance));
    assert.equal(JSON.stringify(maps[0].paint['station-stationLow-large-names']),JSON.stringify(importance));
    assert.equal(JSON.stringify(maps[0].paint['station-stationMed-normal-names']),JSON.stringify(importance));
    assert.match(decodeURIComponent(window.document.cookie),/"stationImportanceColors":true/);
    assert.equal(JSON.stringify(maps[0].options.style.layers.find(l=>l.id==='station-detail-large-names').paint['text-color']),JSON.stringify(importance),'detailed station colours are unchanged');
    // Track-count boxes can be switched off.
    assert.equal(maps[0].visibility['infrastructure-track-count'],'visible');
    const counts = window.document.getElementById('trackCounts');
    counts.checked = false; counts.dispatchEvent(new window.Event('change'));
    assert.equal(maps[0].visibility['infrastructure-track-count'],'none');
    assert.equal(maps[0].visibility['infrastructure-station-tracks'],'none');
    counts.checked = true; counts.dispatchEvent(new window.Event('change'));
    // Satellite: the imagery alone; hybrid: imagery under the railways; the
    // map brings everything back.
    window.document.querySelector('[data-background="satellite"]').click();
    assert.deepEqual(['satellite','water','terrain-bathymetry','infrastructure-tracks','station-stations-dots'].map(id => maps[0].visibility[id]), ['visible','none','none','none','none']);
    window.document.querySelector('[data-background="hybrid"]').click();
    assert.deepEqual(['satellite','water','terrain-relief','terrain-bathymetry','infrastructure-tracks','station-stations-dots'].map(id => maps[0].visibility[id]), ['visible','none','none','none','visible','visible']);
    window.document.querySelector('[data-background="map"]').click();
    assert.deepEqual(['satellite','water','terrain-relief','terrain-bathymetry','infrastructure-tracks','structure-bridge-edge'].map(id => maps[0].visibility[id]), ['none','visible','visible','visible','visible','visible']);
    const language = window.document.getElementById('language');
    language.value='ko'; language.dispatchEvent(new window.Event('change'));
    assert.match(maps[0].options.style.sources.stations.url, /atlasstation:\/\/ko\//);
    assert.equal(window.location.search, '', 'settings stay out of the address');
    assert.match(decodeURIComponent(window.document.cookie), /atlas_settings=\{[^;]*"language":"ko"/);
    assert.equal(window.document.getElementById('region'),null);
    const former = window.document.getElementById('inactive');
    former.checked = false; former.dispatchEvent(new window.Event('change'));
    for (const state of ['construction','proposed','disused','former']) {
      assert.equal(maps[0].visibility[`inactive-railways-${state}`],'none');
      assert.equal(maps[0].visibility[`inactive-regional-${state}`],'none');
    }
    assert.equal(maps[0].visibility['inactive-bridge-edge'],'none');
  } finally {dom.window.close();}
});
test('controls work while the map is still loading, and settings take effect once it loads', async () => {
  const {dom,window,maps,errors,loadLibraries} = await start({delayLibraries:true});
  try {
    assert.equal(maps.length,0,'the map waits for its libraries');
    assert.equal(window.document.head.querySelectorAll('script').length,3,'libraries load from the app, not blocking the page');
    window.document.querySelector('[data-mode="electrification"]').click();
    assert.equal(window.document.querySelector('[data-mode="electrification"]').getAttribute('aria-pressed'),'true');
    const units = window.document.getElementById('units');
    units.value = 'imperial'; units.dispatchEvent(new window.Event('change'));
    window.document.querySelector('[data-mode="speed"]').click();
    assert.match(window.document.getElementById('legend').textContent,/mph.*< 25/);
    window.document.querySelector('[data-mode="electrification"]').click();
    assert.match(decodeURIComponent(window.document.cookie),/"units":"imperial"/);
    const language = window.document.getElementById('language');
    language.value='zh-Hans'; language.dispatchEvent(new window.Event('change'));
    loadLibraries();
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve,0));
    assert.equal(maps.length,1);
    assert.equal(errors.length,0);
    const map = maps[0];
    assert.match(map.options.style.sources.stations.url,/atlasstation:\/\/zh-Hans\//);
    assert.equal(map.options.style.sources.railway.url,'atlasrail://https://openrailwaymap.app/railway_line_high','railway tiles gain track counts');
    assert.match(map.options.localIdeographFontFamily,/SC/,'Simplified Chinese labels use one Simplified Chinese font');
    assert.match(map.options.style.sources.contours.tiles[0],/\/ft\//);
    // Relief and every contour source share one elevation loader.
    assert.deepEqual(maps.dems.map(d => d.id), ['atlas']);
    assert.match(map.options.style.sources.seabedContours.tiles[0],/^atlas-contour:\/\/ft\//);
    assert.match(map.options.style.sources.seabedContoursClose.tiles[0],/^atlas-contour:\/\/ft\//);
    assert.equal(maps.scale.unit,'imperial');
    assert.deepEqual(maps.controls.slice(0,2).map(c=>[c.showZoom,c.showCompass]),[[false,true],[undefined,false]],'compass above the zoom buttons');
    map.handlers['style.load']();
    assert.equal(map.visibility['electrification-tracks'],'visible');
    units.value = 'metric'; units.dispatchEvent(new window.Event('change'));
    assert.equal(maps.scale.unit,'metric');
    assert.match(JSON.stringify(map.layout['terrain-contour-labels']),/ m"/);
    language.value='zh-Hant'; language.dispatchEvent(new window.Event('change'));
    assert.match(map.styleOptions.localIdeographFontFamily,/TC/);
  } finally {dom.window.close();}
});
test('more detail cycles: the next zoom level at half size, two levels at a quarter, then normal', async () => {
  const {dom,window,maps} = await start({search:'?detail=1'});
  try {
    const frame = window.document.getElementById('map');
    assert.equal(frame.classList.contains('detail'),true);
    assert.equal(maps[0].options.pixelRatio,(window.devicePixelRatio||1)/2,'the canvas keeps its pixel count');
    maps[0].handlers['style.load']();
    assert.ok(maps[0].added.includes('drawing-line'),'drawing layers are installed with the map');
    // Changing level at the zoom limit keeps the viewport: the range shifts.
    const map = maps[0];
    assert.deepEqual([map.options.minZoom,map.options.maxZoom],[2,21]);
    const detail = map.controls.find(c => c.onAdd && c.buttons).onAdd().querySelector('button[title^="More detail"]');
    assert.match(detail.title,/drawn at 50%\. Click for 25%/,'the title gives the scale now and next');
    map.zoom = 21;
    detail.click();
    assert.deepEqual([frame.classList.contains('detail'),frame.classList.contains('detail-2')],[true,true]);
    assert.deepEqual([map.zoom,map.minZoom,map.maxZoom],[22,3,22]);
    assert.equal(map.pixelRatio,(window.devicePixelRatio||1)/4);
    assert.match(detail.title,/drawn at 25%\. Click for 100%/);
    detail.click();
    assert.equal(frame.classList.contains('detail'),false);
    assert.deepEqual([map.zoom,map.minZoom,map.maxZoom],[20,1,20]);
    assert.match(detail.title,/drawn at 100%\. Click for 50%/);
    detail.click();
    assert.deepEqual([map.zoom,map.minZoom,map.maxZoom],[21,2,21]);
    detail.click(); detail.click();
    map.zoom = 1; detail.click();
    assert.deepEqual([map.zoom,map.minZoom],[2,2]);
    detail.click();
    assert.equal(map.zoom,3);
    detail.click();
    assert.equal(map.zoom,1,'back to normal from the lowest zoom');
  } finally {dom.window.close();}
});
test('settings are remembered in a cookie; a shared link applies once and leaves the address', async () => {
  // The older language-only cookie still applies.
  for (const [search, expected] of [['', 'ja'], ['?language=ru', 'ru']]) {
    const {dom,maps} = await start({search, cookie:'atlas_language=ja'});
    try { assert.match(maps[0].options.style.sources.stations.url, new RegExp(`atlasstation://${expected}/`)); }
    finally {dom.window.close();}
  }
  const saved = encodeURIComponent(JSON.stringify({mode:'electrification', relief:false, stationImportanceColors:true, units:'imperial', detail:true, language:'ko'}));
  {
    const {dom,window,maps} = await start({cookie:`atlas_settings=${saved}`});
    try {
      assert.match(maps[0].options.style.sources.stations.url, /atlasstation:\/\/ko\//);
      assert.equal(window.document.querySelector('[data-mode="electrification"]').getAttribute('aria-pressed'),'true');
      assert.equal(window.document.getElementById('relief').checked,false);
      assert.equal(window.document.getElementById('stationImportanceColors').checked,true);
      assert.equal(JSON.stringify(maps[0].options.style.layers.find(l=>l.id==='station-major-3-names').paint['text-color']),JSON.stringify(['match',['get','station_size'],'large','#123e52','#0865c0']),'saved importance colours apply before first render');
      assert.equal(window.document.getElementById('units').value,'imperial');
      assert.equal(window.document.getElementById('map').classList.contains('detail'),true);
    } finally {dom.window.close();}
  }
  {
    const {dom,window,maps} = await start({search:'?mode=infrastructure&language=fr&v=1', cookie:`atlas_settings=${saved}`});
    try {
      assert.match(maps[0].options.style.sources.stations.url, /atlasstation:\/\/fr\//, 'a link wins over the cookie');
      assert.equal(window.location.search, '?v=1', 'setting parameters are removed from the address; others stay');
      const cookie = JSON.parse(decodeURIComponent(window.document.cookie).match(/atlas_settings=([^;]*)/)[1]);
      assert.deepEqual([cookie.mode, cookie.language, cookie.units], ['infrastructure','fr','imperial']);
    } finally {dom.window.close();}
  }
});
test('map movements persist locally without changing URL or browser history', async () => {
  const {dom,window,maps,errors}=await start({search:'?ref=history-check'});
  try {
    const map=maps[0], originalURL=window.location.href, initialLength=window.history.length;
    const writes=[];
    const replace=window.history.replaceState.bind(window.history);
    window.history.replaceState=(...args)=>{writes.push(args);return replace(...args);};
    map.getCenter=()=>({lat:35.6813,lng:139.7671});
    map.getBearing=()=>45;
    map.getPitch=()=>30;
    for(const zoom of [8,11,13.25,16]){
      map.zoom=zoom;
      map.handlers.moveend();
    }
    assert.equal(window.location.href,originalURL,'panning and zooming leave the location unchanged');
    assert.equal(window.history.length,initialLength,'no session history entries');
    assert.deepEqual(writes,[],'no replaceState calls or hidden visited-URL mutations during movements');
    const saved=JSON.parse(window.localStorage.getItem('atlas_view'));
    assert.deepEqual(saved.c,[139.7671,35.6813],'the current centre is still saved locally');
    assert.equal(saved.z,16);
    let copied='';
    Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=text;}}});
    window.document.getElementById('share').click();
    await new Promise(resolve=>setTimeout(resolve,0));
    const url=new URL(copied);
    assert.equal(url.hash,globeModule.viewHash({zoom:16,lat:35.6813,lng:139.7671,bearing:45,pitch:30}));
    assert.equal(url.searchParams.get('ref'),'history-check','unrelated query parameters survive sharing');
    assert.equal(url.searchParams.get('mode'),'infrastructure','display choices are included in links');
    assert.equal(window.location.href,originalURL,'sharing does not navigate');
    assert.deepEqual(writes,[],'sharing does not rewrite the current address');
    assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
});

test('incoming map links are consumed once; sharing still works before map initialization',async()=>{
  const hash='#10/35.68/139.76/25/40';
  const {dom,window,maps,errors,loadLibraries}=await start({
    delayLibraries:true,search:`?mode=speed&language=ja&ref=shared${hash}`,
  });
  try {
    assert.equal(maps.length,0,'map libraries are still loading');
    assert.equal(window.location.href,'https://example.org/openrailwaystyle/?ref=shared');
    assert.equal(window.history.length,1,'normalizing an incoming link does not push a new history entry');
    let copied='';
    Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copied=value;}}});
    window.document.getElementById('share').click();
    await new Promise(resolve=>setTimeout(resolve,0));
    const share=new URL(copied);
    assert.equal(share.hash,hash,'the original position remains shareable during startup');
    assert.equal(share.searchParams.get('mode'),'speed');
    assert.equal(share.searchParams.get('language'),'ja');
    assert.equal(share.searchParams.get('ref'),'shared');
    loadLibraries();
    for(let i=0;i<10&&!maps.length;i++)await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(maps.length,1,'the link still opens a map');
    assert.equal(maps[0].zoom,10,'the deep link wins over default map zoom');
    maps[0].handlers.moveend();
    assert.equal(window.location.href,'https://example.org/openrailwaystyle/?ref=shared',
      'navigating the linked map does not bring the fragment back');
    assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
});

for(const scenario of [
 {delay:'libraries',initial:'#10/35/139/20/30',share:false},
 {delay:'labels',initial:'',share:false},
 {delay:'libraries',initial:'',share:true},
 {delay:'labels',initial:'#10/35/139/20/30',share:true},
 {delay:'libraries',initial:'',share:false,invalidCold:'#not-a-map'},
 {delay:'labels',initial:'#10/35/139/20/30',share:false,invalidCold:''},
]) test(`cold navigation keeps the newest view during ${scenario.delay} loading, share=${scenario.share}, invalid=${scenario.invalidCold ?? 'none'}`,async()=>{
 const {dom,window,maps,errors,loadLibraries,loadLabels}=await start({
   delayLibraries:scenario.delay==='libraries',delayLabels:scenario.delay==='labels',
   search:'?ref=cold-navigation'+scenario.initial,
 });
 try {
   assert.equal(maps.length,0);
   const newest='#12/89.7/162/25/40',expected=globeModule.parseViewHash(newest);
   const writes=[],replace=window.history.replaceState.bind(window.history);
   window.history.replaceState=(...args)=>{writes.push(args);return replace(...args);};
   window.location.hash=newest;
   if(scenario.share){
     // Copy immediately, before the queued hashchange can run. Saving settings
     // normalizes the URL, but must not discard this new requested position.
     let copied='';Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copied=value;}}});
     window.document.getElementById('share').click();
     await new Promise(resolve=>setTimeout(resolve,0));
     assert.equal(new URL(copied).hash,newest,'cold share uses the latest requested view');
     assert.equal(new URL(copied).searchParams.get('ref'),'cold-navigation');
     assert.equal(window.location.hash,'');
     assert.equal(writes.length,1,'only explicit link normalization rewrites the URL');
   }else{
     await new Promise(resolve=>setTimeout(resolve,0));
     assert.equal(window.location.hash,newest);assert.deepEqual(writes,[]);
   }
   if(scenario.invalidCold!==undefined){
     window.location.hash=scenario.invalidCold;
     await new Promise(resolve=>setTimeout(resolve,0));
     assert.equal(window.location.hash,scenario.invalidCold,'invalid or empty cold fragments stay untouched');
   }
   const normalizedURL=window.location.href,before=writes.length;
   loadLibraries();loadLabels();
   for(let i=0;i<20&&!maps.length;i++)await new Promise(resolve=>setTimeout(resolve,0));
   assert.equal(maps.length,1);const map=maps[0];
   assert.deepEqual(map.lastJump,expected,'initialization applies the newest complete camera, not the startup snapshot');
   assert.equal(map.options.style.projection.type,'globe','a newly navigated polar view starts on the globe');
   map.handlers.moveend();
   assert.equal(window.location.href,normalizedURL);assert.equal(writes.length,before);
   for(const hash of ['#not-a-map','']){
     const calls=map.jumpCalls;window.location.hash=hash;
     await new Promise(resolve=>setTimeout(resolve,0));
     assert.equal(map.jumpCalls,calls,'invalid and empty fragments do not move the map');
   }
   const later='#9/48/2/35/20';window.location.hash=later;
   await new Promise(resolve=>setTimeout(resolve,0));
   assert.deepEqual(map.lastJump,globeModule.parseViewHash(later),'later explicit navigation remains live');
   map.onceHandlers['style.load'][0]();
   assert.deepEqual(map.lastJump,globeModule.parseViewHash(later),'late style readiness cannot restore an older destination');
   assert.equal(writes.length,before,'fragment navigation and late readiness add no automatic rewrites');
   assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('curated hubs take their names from the provider station tiles by OSM identity, without OSM API requests',async()=>{
 const penn=style.sources.stationMajor.data.features.find(f=>f.properties.wikidata==='Q54451');
 const [first,alias]=penn.properties.osm_ids.split(';').concat([penn.properties.id]);
 const requests=[],tileRequests=[];
 const fetcher=async url=>{requests.push(String(url));return {ok:true,status:200,json:async()=>structuredClone(style)};};
 // The provider names its grouped station after one member; here an alias.
 const member=(alias||first).replace(/^(node|way|relation)-/, '$1-');
 const stationTile=async(url,lang)=>{tileRequests.push([url,lang]);
  const feature=(id,name,x)=>({type:1,id:x,tags:{id,name,atlas_name:`${name} (${lang})`,atlas_language:lang},geometry:[[2048+x,2048]]});
  const result=encodeTile.fromGeojsonVt({standard_railway_text_stations:{features:[feature(`${member}-train-train-station`,'Provider Penn',1),feature('node-1-train-train-station','Elsewhere',2)]}},{version:2});
  return result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength);};
 const {dom,maps}=await start({search:'?language=en#3/40.75/-74',fetcher,stationTile});
 try{
  const map=maps[0],source=map.getSource.bind(map);
  map.getSource=id=>id==='stations'?{tiles:['atlasstation://en/https://tiles.test/stations/{z}/{x}/{y}']}:source(id);
  // New York two world copies east: the hub must still count as in view.
  map.getBounds=()=>({getWest:()=>640,getEast:()=>650,getSouth:()=>35,getNorth:()=>45});
  map.handlers['style.load']();
  for(let i=0;i<50&&!map.sourceData?.stationMajor?.features.some(f=>f.properties.atlas_name);i++)await new Promise(r=>setTimeout(r,0));
  const named=map.sourceData?.stationMajor?.features.find(f=>f.properties.wikidata==='Q54451');
  assert.ok(named,'the curated hub in view is named');
  assert.equal(named.properties.atlas_name,'Provider Penn (en)');
  assert.ok(tileRequests.every(([url,lang])=>/^https:\/\/tiles\.test\/stations\/(8|10)\/\d+\/\d+$/.test(url)&&lang==='en'),'zoom-8 station tiles through the station pipeline');
  assert.ok(!requests.some(url=>url.includes('openstreetmap.org')),'no OSM API requests');
  assert.ok(map.sourceData.stationMajor.features.every(f=>f.properties.atlas_name || (f.properties.atlas_name==='' && f.properties.name==='')),'deferred hubs retain unlabeled marker points without leaking source notes');
 }finally{dom.window.close();}
});
