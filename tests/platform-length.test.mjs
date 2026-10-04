import test from 'node:test';
import assert from 'node:assert/strict';
import {osmObject} from '../styles/map-model.mjs';
import {createPlatformLengths,platformIdentity,platformAnchor,formatPlatformLength,platformLengthLabel,platformReference,platformObjectIdentity,createPlatformTileGeometry,platformTilesFor,PLATFORM_TILE_LIMIT,platformLabelAnchor,platformExtent} from '../styles/platform-length.mjs';
import {createExpression} from '@maplibre/maplibre-gl-style-spec';
const edge=(id=1)=>({properties:{id,ref:'2'},geometry:{type:'LineString',coordinates:[[0,0],[.001,0]]}});
import geojsonvt from 'geojson-vt';
// Provider-like platform tiles: zoom-15 tiles, extent 4096, 64-unit buffer,
// geometry clipped at the buffer (ST_AsMVTGeom in upstream tile_views.sql).
function providerTiles(features){
 const index=geojsonvt({type:'FeatureCollection',features},{maxZoom:15,indexMaxZoom:15,extent:4096,buffer:64}),requests=[];
 const fetcher=async url=>{requests.push(url);return {ok:true,status:200,arrayBuffer:async()=>url};};
 const decode=url=>{const [z,x,y]=url.split('/').slice(-3).map(Number),tile=index.getTile(z,x,y);
  return (tile?.features||[]).map(f=>({id:f.tags.id,type:f.type,extent:4096,geometry:f.type===1?[f.geometry]:f.geometry}));};
 return {geometry:createPlatformTileGeometry({tileURL:()=>'https://tiles.test/standard_railway_platforms/{z}/{x}/{y}',fetcher,decode}),requests};
}
// Away from the equator, which is also a tile edge.
const area=(id,west,east)=>({type:'Feature',properties:{id},geometry:{type:'Polygon',coordinates:[[[west,.002],[east,.002],[east,.0021],[west,.0021],[west,.002]]]}});

test('platform areas and lines are measured from provider tiles across tile edges',async()=>{
 // A zoom-15 tile edge runs at 0.010986° east; both platforms cross it.
 const line={type:'Feature',properties:{id:'way-24'},geometry:{type:'LineString',coordinates:[[.0095,.001],[.0115,.001],[.0135,.001]]}};
 const {geometry,requests}=providerTiles([area('way-23',.0095,.0135),line]);
 const seeds=f=>platformTilesFor(f.geometry.coordinates.flat().filter(p=>p[0]<.0105));
 const measured=await geometry.measure('way-23',seeds(area('way-23',.0095,.0135)));
 assert.ok(Math.abs(measured.length-444.78)<.6,String(measured.length));assert.equal(measured.length_estimated,true);assert.equal(measured.length_basis,'mapped_extent');
 assert.equal(new Set(requests).size,2,'the neighbouring tile is read because the piece leaves its tile');
 const path=await geometry.measure('way-24',platformTilesFor([[.0095,.001]]));
 assert.ok(Math.abs(path.length-444.78)<.6,String(path.length));assert.equal(path.length_basis,'mapped_line');
 assert.equal(new Set(requests).size,2,'tiles are cached');
 const text=createExpression(platformLengthLabel()).value.evaluate({zoom:19},{type:1,properties:{ref:'1 / 2',platform_length:444.78,length_estimated:true}});assert.equal(text,'1 / 2 · ≈445 m');
});
test('a platform needing more tiles than the limit gets no length rather than a short one',async()=>{
 const long={type:'Feature',properties:{id:'way-25'},geometry:{type:'LineString',coordinates:[[.0005,.001],[.0005+.011*(PLATFORM_TILE_LIMIT+2),.001]]}};
 const {geometry,requests}=providerTiles([long]);
 assert.equal(await geometry.measure('way-25',platformTilesFor([[.0005,.001]])),null);
 assert.ok(new Set(requests).size<=PLATFORM_TILE_LIMIT);
 assert.equal(await geometry.measure('way-99',platformTilesFor([[.0005,.001]])),null,'an object absent from the tiles has no length');
});
test('platform label anchors stay in the visible tip at maximum zoom',()=>{
 const bounds={getWest:()=>.0035,getEast:()=>.0041,getSouth:()=>-.00005,getNorth:()=>.00015};
 const polygon={geometry:{type:'Polygon',coordinates:[[[0,0],[.004,0],[.004,.0001],[0,.0001],[0,0]]]}};
 const at=platformLabelAnchor(polygon,bounds);assert.ok(at[0]>=.0035&&at[0]<=.004);assert.ok(at[1]>=0&&at[1]<=.0001);
 assert.deepEqual(platformLabelAnchor({geometry:{type:'LineString',coordinates:[[0,0],[.004,0]]}},bounds),[.00375,0]);
 assert.ok(Math.abs(platformExtent(polygon.geometry)-444.7797)<.01,'placement clipping never changes the complete area extent');
});

test('visible platform areas get lengths from tiles at zoom 19 and keep their API references',async()=>{
 let zoom=17,data,requests=[];
 const platform={properties:{id:'way-23'},geometry:{type:'Polygon',coordinates:[[[.0095,.002],[.0105,.002],[.0105,.0021],[.0095,.0021],[.0095,.002]]]}};
 const tiles=providerTiles([area('way-23',.0095,.0135)]);
 const source={setData:d=>data=d},map={getZoom:()=>zoom,getLayer:()=>({}),queryRenderedFeatures:({layers})=>layers.includes('platform-edges')?[]:[platform],getSource:id=>id==='platformNumbers'?source:null};
 const p=createPlatformLengths(map,{delay:0,geometry:tiles.geometry,fetcher:async url=>{requests.push(url);return {ok:true,json:async()=>({properties:{ref:['1','2']}})};}});
 try{
  p.update();await new Promise(r=>setTimeout(r,20));assert.equal(data.features[0].properties.ref,'1 / 2');assert.equal(data.features[0].properties.platform_length,undefined);assert.equal(tiles.requests.length,0,'no tiles read below zoom 19');
  zoom=19;p.update();await new Promise(r=>setTimeout(r,30));
  assert.ok(Math.abs(data.features[0].properties.platform_length-444.78)<.6);assert.equal(data.features[0].properties.ref,'1 / 2');assert.equal(data.features[0].properties.length_estimated,true);
  assert.deepEqual(requests,['https://openrailwaymap.app/api/feature/openrailwaymap_standard/standard_railway_platforms/way-23'],'only the provider reference lookup; nothing goes to OSM');
  assert.deepEqual(osmObject(data.features[0]),{type:'way',id:'23'});
  const read=tiles.requests.length;zoom=18;p.update();assert.equal(data.features[0].properties.platform_length,undefined);zoom=22;p.update();await new Promise(r=>setTimeout(r,20));
  assert.equal(tiles.requests.length,read,'measured once');assert.ok(data.features[0].properties.platform_length>444);
 }finally{p.destroy();}
});
test('platform lengths convert m/ft and anchor on line geometry without measuring its clipped span',()=>{
 assert.equal(formatPlatformLength(304.8,'imperial'),'1000 ft');assert.equal(formatPlatformLength(304.8),'305 m');assert.equal(formatPlatformLength(0),'');
 assert.equal(platformIdentity(edge()),'1');assert.equal(platformIdentity(edge('way-99')),'99');assert.equal(platformIdentity(edge('node-99')),null);
 assert.deepEqual(platformAnchor(edge()),[.0005,0]);assert.match(JSON.stringify(platformLengthLabel('imperial')),/ ft/);
});
test('platform API uses full length, deduplicates edge IDs, caches values and starts at 19',async()=>{
 let zoom=18,requests=0,data,features=[edge(),edge()];const map={getZoom:()=>zoom,queryRenderedFeatures:()=>features,getSource:()=>({setData:d=>data=d})};
 const p=createPlatformLengths(map,{delay:0,fetcher:async()=>{requests++;return {ok:true,json:async()=>({properties:{length:350}})};}});
 try{p.update();await new Promise(r=>setTimeout(r,10));assert.equal(requests,0);zoom=19;p.update();await new Promise(r=>setTimeout(r,20));assert.equal(requests,1);assert.equal(data.features[0].properties.platform_length,350);const raw={...edge(),source:'platformEdges'},enriched=p.enrich(raw);assert.equal(enriched.properties.platform_length,350);assert.deepEqual(osmObject(raw),{type:'way',id:'1'});assert.deepEqual(osmObject(enriched),{type:'way',id:'1'});assert.equal(p.enrich({...edge(99),source:'platformEdges'}).properties.platform_length,undefined);
  p.update();await new Promise(r=>setTimeout(r,10));assert.equal(requests,1);features=[];p.update();assert.equal(data.features.length,0);
 }finally{p.destroy();}
});
test('platform requests leave the queue when panned away and respect a rate-limit response',async()=>{
 let features=[edge(),edge(2)],requests=0;const map={getZoom:()=>19,queryRenderedFeatures:()=>features,getSource:()=>({setData(){}})};
 const p=createPlatformLengths(map,{delay:0,fetcher:async()=>{requests++;return {ok:false,status:429};}});
 try{p.update();await new Promise(r=>setTimeout(r,10));p.update();await new Promise(r=>setTimeout(r,10));assert.equal(requests,1);features=[];p.update();}
 finally{p.destroy();}
});
test('stationary edges recover after rate limits and transient errors without repeating unchanged source data',async()=>{
 for(const status of [429,503]){
  let requests=0,draws=0,data;let source={setData:d=>{data=d;draws++;}};const map={getZoom:()=>19,queryRenderedFeatures:()=>[edge()],getSource:()=>source};
  const p=createPlatformLengths(map,{delay:0,cooldown:10,retryDelay:10,fetcher:async()=>++requests===1?{ok:false,status}:{ok:true,json:async()=>({properties:{length:350}})}});
  try{p.update();await new Promise(r=>setTimeout(r,50));assert.equal(requests,2);assert.equal(data.features[0].properties.platform_length,350);const before=draws;p.update();p.update();assert.equal(draws,before);source={setData:d=>{data=d;draws++;}};p.update();assert.equal(draws,before+1);assert.equal(data.features[0].properties.platform_length,350);}finally{p.destroy();}
 }
});

test('a longer straight tile fragment anchors the label ahead of a shorter fragment with more vertices',async()=>{
 const long={...edge(),geometry:{type:'LineString',coordinates:[[0,0],[.002,0]]}},short={...edge(),geometry:{type:'LineString',coordinates:[[0,0],[.00003,.00001],[.00008,.00002],[.0001,0]]}};let data;const map={getZoom:()=>19,queryRenderedFeatures:()=>[short,long],getSource:()=>({setData:d=>data=d})},p=createPlatformLengths(map,{delay:0,fetcher:async()=>({ok:true,json:async()=>({properties:{length:350}})})});
 try{p.update();await new Promise(r=>setTimeout(r,20));assert.deepEqual(data.features[0].geometry.coordinates,[.001,0]);}finally{p.destroy();}
});

test('a completed platform lookup notifies an already open raw-edge inspection',async()=>{
 let complete,shown,controller;const inspected={...edge(),source:'platformEdges'},map={getZoom:()=>19,queryRenderedFeatures:()=>[edge()],getSource:()=>({setData(){}})};
 controller=createPlatformLengths(map,{delay:0,fetcher:()=>new Promise(r=>complete=r),onLength:(id,length)=>{assert.equal(id,'1');assert.equal(length,350);shown=controller.enrich(inspected);}});
 try{controller.update();await new Promise(r=>setTimeout(r,10));assert.equal(controller.enrich(inspected).properties.platform_length,undefined);complete({ok:true,json:async()=>({properties:{length:350}})});await new Promise(r=>setTimeout(r,10));assert.equal(shown.properties.platform_length,350);}finally{controller.destroy();}
});

test('edge references remain labelled before, below and without a valid complete length',async()=>{
 const compiled=createExpression(platformLengthLabel());assert.equal(compiled.result,'success');
 const text=properties=>compiled.value.evaluate({zoom:19},{type:1,properties});
 assert.equal(text({ref:'2'}),'2');assert.equal(text({ref:'2',platform_length:350}),'2 · 350 m');assert.equal(text({platform_length:350}),'350 m');assert.equal(text({ref:'2',platform_length:0}),'2');assert.equal(text({}),'');
 let zoom=17,data,requests=0;const source={setData:d=>data=d},map={getZoom:()=>zoom,getLayer:()=>undefined,queryRenderedFeatures:()=>[edge()],getSource:id=>id==='platformLengths'?source:null};
 const p=createPlatformLengths(map,{delay:0,fetcher:async()=>{requests++;return {ok:true,json:async()=>({properties:{length:null}})};}});
 try{p.update();assert.equal(data.features[0].properties.ref,'2');assert.equal(data.features[0].properties.platform_length,undefined);await new Promise(r=>setTimeout(r,10));assert.equal(requests,0);zoom=19;p.update();await new Promise(r=>setTimeout(r,20));assert.equal(requests,1);assert.equal(data.features[0].properties.ref,'2');assert.equal(data.features[0].properties.platform_length,undefined);}finally{p.destroy();}
});

test('platform references missing from tiles load by typed identity, deduplicate and preserve the correct OSM object',async()=>{
 assert.equal(platformReference(['1','2']),'1 / 2');assert.equal(platformReference(' A ; B '),'A / B');
 assert.equal(platformObjectIdentity({properties:{id:123}}),null);
 const platform={properties:{id:'relation-23',name:'Island platform'},geometry:{type:'Polygon',coordinates:[[[0,0],[.001,0],[.001,.001],[0,.001],[0,0]]]}};
 let data,requests=0,shown,visible=true;const source={setData:d=>data=d},map={getZoom:()=>17,getLayer:()=>({}),queryRenderedFeatures:({layers})=>layers.includes('platform-areas')&&visible?[platform,platform]:[],getSource:id=>id==='platformNumbers'?source:null};
 const p=createPlatformLengths(map,{delay:0,onPlatform:(id)=>shown=p.enrich({...platform,source:'platforms'}),fetcher:async url=>{requests++;assert.ok(url.endsWith('/standard_railway_platforms/relation-23'));return {ok:true,json:async()=>({properties:{ref:['1','2'],name:'Island platform'}})};}});
 try{p.update();await new Promise(r=>setTimeout(r,20));assert.equal(requests,1);assert.equal(data.features.length,1);assert.equal(data.features[0].properties.ref,'1 / 2');assert.equal(shown.properties.ref,'1 / 2');assert.deepEqual(osmObject(data.features[0]),{type:'relation',id:'23'});assert.deepEqual(osmObject(shown),{type:'relation',id:'23'});p.update();await new Promise(r=>setTimeout(r,10));assert.equal(requests,1);visible=false;p.update();assert.equal(data.features.length,0);}finally{p.destroy();}
});

test('platform reference and length requests share one queue and cancel when the infrastructure view is hidden',async()=>{
 let enabled=true,release,requests=0;const platform={properties:{id:'way-23'},geometry:{type:'Point',coordinates:[0,0]}};
 const map={getZoom:()=>19,getLayer:()=>({}),queryRenderedFeatures:({layers})=>layers.includes('platform-edges')?[edge()]:[platform],getSource:()=>({setData(){}})};
 const p=createPlatformLengths(map,{active:()=>enabled,delay:0,fetcher:(url,{signal})=>{requests++;return new Promise((resolve,reject)=>{release=()=>resolve({ok:true,json:async()=>({properties:{length:350}})});signal.addEventListener('abort',()=>reject(new Error('aborted')));});}});
 try{p.update();await new Promise(r=>setTimeout(r,10));assert.equal(requests,1);p.update();assert.equal(requests,1);enabled=false;p.update();await new Promise(r=>setTimeout(r,10));assert.equal(requests,1);}finally{p.destroy();}
});

for(const interruption of ['pan','zoom'])test(`an edge reappearing before its ${interruption} abort settles is immediately requeued`,async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 let zoom=19,visible=true,requests=0,rejectCancelled,firstSignal,data;const lengths=[];
 const map={getZoom:()=>zoom,getLayer:()=>undefined,queryRenderedFeatures:()=>visible?[edge()]:[],getSource:id=>id==='platformLengths'?{setData:d=>data=d}:null};
 const p=createPlatformLengths(map,{delay:0,retryDelay:30000,onLength:(id,length)=>lengths.push([id,length]),fetcher:(url,{signal})=>{
  requests++;if(requests===1){firstSignal=signal;return new Promise((resolve,reject)=>{rejectCancelled=()=>reject(signal.reason);});}
  return {ok:true,json:async()=>({properties:{length:350}})};
 }});
 try{
  p.update();t.mock.timers.tick(1);assert.equal(requests,1);
  if(interruption==='pan')visible=false;else zoom=18;
  p.update();assert.equal(firstSignal.aborted,true);
  visible=true;zoom=19;p.update();assert.equal(requests,1,'old request still occupies the single request slot');
  rejectCancelled();await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(1);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests,2,'intentional cancellation must not impose failure backoff or lose the reappeared key');
  assert.equal(data.features[0].properties.platform_length,350);assert.deepEqual(lengths,[['1',350]]);
 }finally{p.destroy();}
});

test('request timeouts retain failure backoff before retrying a still-visible edge',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 let requests=0,firstSignal,data;const map={getZoom:()=>19,getLayer:()=>undefined,queryRenderedFeatures:()=>[edge()],getSource:id=>id==='platformLengths'?{setData:d=>data=d}:null};
 const p=createPlatformLengths(map,{delay:0,retryDelay:10000,fetcher:(url,{signal})=>{
  requests++;if(requests===1){firstSignal=signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}
  return {ok:true,json:async()=>({properties:{length:350}})};
 }});
 try{
  p.update();t.mock.timers.tick(1);assert.equal(requests,1);
  t.mock.timers.tick(5000);await new Promise(resolve=>setImmediate(resolve));assert.equal(firstSignal.aborted,true);
  t.mock.timers.tick(9999);await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,1,'timeout must retain retryDelay');
  t.mock.timers.tick(2);await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,2);assert.equal(data.features[0].properties.platform_length,350);
 }finally{p.destroy();}
});

test('zooming below the length threshold cancels only the length request without delaying platform references',async()=>{
 let zoom=19,requests=0;
 const platform={properties:{id:'node-23'},geometry:{type:'Point',coordinates:[0,0]}};
 const map={getZoom:()=>zoom,getLayer:()=>({}),queryRenderedFeatures:({layers})=>layers.includes('platform-edges')?[edge()]:[platform],getSource:()=>({setData(){}})};
 const p=createPlatformLengths(map,{delay:0,retryDelay:10000,fetcher:(url,{signal})=>{
  requests++;
  if(url.includes('platform_edges'))return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled'))));
  return Promise.resolve({ok:true,json:async()=>({properties:{ref:['3']}})});
 }});
 try{p.update();await new Promise(r=>setTimeout(r,10));assert.equal(requests,1);zoom=18;p.update();await new Promise(r=>setTimeout(r,20));assert.equal(requests,2);assert.equal(p.enrich({...platform,source:'platforms'}).properties.ref,'3');}finally{p.destroy();}
});

test('quickly reopening the view resumes an aborted object without a transient-error cooldown',async()=>{
 let active=true,requests=0,data;const source={setData:d=>data=d};
 const map={getZoom:()=>19,getLayer:()=>undefined,queryRenderedFeatures:()=>[edge()],getSource:id=>id==='platformLengths'?source:null};
 const p=createPlatformLengths(map,{active:()=>active,delay:0,retryDelay:10000,fetcher:(url,{signal})=>{
  if(++requests===1)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled'))));
  return Promise.resolve({ok:true,json:async()=>({properties:{length:350}})});
 }});
 try{p.update();await new Promise(r=>setTimeout(r,10));active=false;p.update();active=true;p.update();await new Promise(r=>setTimeout(r,20));assert.equal(requests,2);assert.equal(data.features[0].properties.platform_length,350);}finally{p.destroy();}
});

test('area labels stay inside concave polygons and outside their holes',()=>{
 const concave=[[0,0],[4,0],[4,4],[3,4],[3,1],[1,1],[1,4],[0,4],[0,0]];
 const point=platformLabelAnchor({geometry:{type:'Polygon',coordinates:[concave]}});
 assert.ok(point&&(point[1]<1||point[0]<1||point[0]>3),JSON.stringify(point));
 const outer=[[0,0],[4,0],[4,4],[0,4],[0,0]],hole=[[1,1],[3,1],[3,3],[1,3],[1,1]];
 const feature={geometry:{type:'Polygon',coordinates:[outer,hole]}};
 const at=platformLabelAnchor(feature);assert.ok(at&&(at[0]<1||at[0]>3||at[1]<1||at[1]>3));
 const bounds={getWest:()=>1.2,getEast:()=>2.8,getSouth:()=>1.2,getNorth:()=>2.8};
 assert.equal(platformLabelAnchor(feature,bounds),null,'viewport entirely in a hole has no platform interior');
 const tip={getWest:()=>3.5,getEast:()=>4.5,getSouth:()=>2,getNorth:()=>3};
 const visible=platformLabelAnchor(feature,tip);assert.ok(visible[0]>3.5&&visible[0]<4&&visible[1]>2&&visible[1]<3);
});


test('a larger buffered tile fragment outside the viewport cannot displace the visible fragment',async()=>{
  const polygon=coordinates=>({properties:{id:'way-23'},geometry:{type:'Polygon',coordinates:[coordinates]}});
  const outside=polygon([[0,0],[.01,0],[.01,.001],[0,.001],[0,0]]),visible=polygon([[.019,.0001],[.021,.0001],[.021,.0009],[.019,.0009],[.019,.0001]]);
  const bounds={getWest:()=>.0195,getEast:()=>.0205,getSouth:()=>0,getNorth:()=>.001};let data;
  const map={getZoom:()=>19,getBounds:()=>bounds,queryRenderedFeatures:({layers})=>layers.includes('platform-areas')?[visible,outside]:[],getSource:id=>id==='platformNumbers'?{setData:d=>data=d}:null};
  const tracker=createPlatformLengths(map,{delay:0,geometry:{measure:async()=>({length:350,length_basis:'mapped_line'})},fetcher:async()=>({ok:true,json:async()=>({properties:{ref:['1']}})})});
  try{tracker.update();await new Promise(r=>setTimeout(r,20));assert.equal(data.features.length,1);assert.equal(data.features[0].properties.platform_length,350);assert.ok(data.features[0].geometry.coordinates[0]>=.0195);}finally{tracker.destroy();}
});


test('rotated viewport anchors use projected screen bounds instead of loose geographic bounds',async()=>{
  const {platformScreenAnchor}=await import('../styles/platform-length.mjs');
  const feature={geometry:{type:'Polygon',coordinates:[[[0,0],[4,0],[4,1],[0,1],[0,0]]]}};
  const bounds={getWest:()=>-1,getEast:()=>3,getSouth:()=>-1,getNorth:()=>3};
  const map={getBounds:()=>bounds,getContainer:()=>({clientWidth:100,clientHeight:100}),project:([x,y])=>({x:100*(x+y),y:100*(y-x)+150}),unproject:([x,y])=>({lng:(x-y+150)/200,lat:(x+y-150)/200})};
  assert.ok(map.project(platformLabelAnchor(feature,bounds)).x>100,'geographic rectangle permits an off-screen anchor');
  const point=map.project(platformScreenAnchor(feature,map));assert.ok(point.x>=0&&point.x<=100&&point.y>=0&&point.y<=100);
  const line={geometry:{type:'LineString',coordinates:[[0,0],[4,0]]}};
  const linePoint=map.project(platformScreenAnchor(line,map));assert.ok(linePoint.x>=0&&linePoint.x<=100&&linePoint.y>=0&&linePoint.y<=100);
});


test('large public platform geometry is withheld before quadratic hull and anchor scans',async()=>{
  const {PLATFORM_GEOMETRY_LIMITS,readPlatformResponse}=await import('../styles/platform-length.mjs');
  const count=32000,ring=Array.from({length:count},(_,i)=>[Math.cos(i/count*2*Math.PI)*.001,Math.sin(i/count*2*Math.PI)*.001]);ring.push(ring[0]);
  assert.equal(platformExtent({type:'Polygon',coordinates:[ring]}),0);assert.equal(platformLabelAnchor({geometry:{type:'Polygon',coordinates:[ring]}}),null);
  const body='x'.repeat(PLATFORM_GEOMETRY_LIMITS.responseBytes+1);await assert.rejects(readPlatformResponse(new Response(body)),/response budget/);
  assert.deepEqual(await readPlatformResponse(new Response('{"elements":[]}')),{elements:[]});
});

test('dense platform tiles share one anchor budget and reuse anchors for redraws',async()=>{
 const {PLATFORM_UPDATE_LIMITS}=await import('../styles/platform-length.mjs');
 const ring=Array.from({length:1024},(_,i)=>[.001*Math.cos(i*2*Math.PI/1023),.001*Math.sin(i*2*Math.PI/1023)]);
 const features=Array.from({length:500},(_,i)=>({properties:{id:`way-${i+1}`,ref:'1'},geometry:{type:'Polygon',coordinates:[ring]}}));
 let projects=0,data;
 const map={getZoom:()=>18,getLayer:()=>({}),getContainer:()=>({clientWidth:100,clientHeight:100}),project:([x,y])=>{projects++;return {x:50+x*1000,y:50+y*1000};},unproject:([x,y])=>({lng:(x-50)/1000,lat:(y-50)/1000}),queryRenderedFeatures:({layers})=>layers.includes('platform-edges')?[]:features,getSource:id=>id==='platformNumbers'?{setData:d=>data=d}:null};
 const p=createPlatformLengths(map,{delay:0,fetcher:async()=>({ok:true,json:async()=>({properties:{ref:'1'}})})});
 try{p.update();const first=projects;assert.ok(first>0&&first<PLATFORM_UPDATE_LIMITS.vertices);assert.ok(data.features.length>0&&data.features.length<500);await new Promise(r=>setTimeout(r,15));assert.ok(projects<=first*2+2,'the lookup redraw only projects its label point; its following update may recompute geometry anchors');}finally{p.destroy();}
});


test('separate parts of a multipolygon platform keep their own extents across tiles',async()=>{
 // Two 0.004°-long parts 0.01° apart; one crosses the zoom-15 tile edge at 0.010986°.
 const mp={type:'Feature',properties:{id:'relation-30'},geometry:{type:'MultiPolygon',coordinates:[
  [[[.0095,.002],[.0135,.002],[.0135,.0021],[.0095,.0021],[.0095,.002]]],
  [[[.0235,.002],[.0275,.002],[.0275,.0021],[.0235,.0021],[.0235,.002]]]]}};
 const {geometry}=providerTiles([mp]);
 const measured=await geometry.measure('relation-30',platformTilesFor(mp.geometry.coordinates));
 assert.ok(Math.abs(measured.length-444.78)<.6,String(measured.length));
});
test('an oversized platform tile gives no pieces instead of decoding every feature',async()=>{
 const {platformTilePieces}=await import('../styles/tile-labels.mjs');
 assert.deepEqual(platformTilePieces(new ArrayBuffer(16),'x',{bytes:8,features:1,vertices:1}),[]);
});

test('interlocking multipolygon parts with overlapping bounds stay separate',async()=>{
 const {ringsOverlap}=await import('../styles/platform-length.mjs');
 // An L-shape and a block tucked into its corner: bounds overlap, rings do not meet.
 const l=[[0,0],[10,0],[10,1],[1,1],[1,10],[0,10],[0,0]],block=[[3,3],[9,3],[9,9],[3,9],[3,3]];
 assert.equal(ringsOverlap(l,block),false);
 assert.equal(ringsOverlap(l,[[9,0.5],[12,0.5],[12,2],[9,2],[9,0.5]]),true,'overlapping pieces share area');
 assert.equal(ringsOverlap(block,[[4,4],[5,4],[5,5],[4,5],[4,4]]),true,'a hole lies inside its outer ring');
 assert.equal(ringsOverlap([[0,4],[10,4],[10,5],[0,5],[0,4]],[[4,0],[5,0],[5,10],[4,10],[4,0]]),true,'crossing bars share area without a corner inside the other');
});
test('multipolygon parts that only touch keep their own extents',async()=>{
 const {ringsOverlap}=await import('../styles/platform-length.mjs');
 const a=[[0,0],[4,0],[4,1],[0,1],[0,0]];
 assert.equal(ringsOverlap(a,[[4,1],[8,1],[8,2],[4,2],[4,1]]),false,'corner to corner');
 assert.equal(ringsOverlap(a,[[4,0],[8,0],[8,1],[4,1],[4,0]]),false,'end to end along an edge');
 assert.equal(ringsOverlap(a,[[4.001,1.001],[8,1],[8,2],[4,2],[4.001,1.001]],.01),false,'a corner rounded slightly differently still only touches');
 // Two 0.004°-long parts meeting end to end at one corner, across a zoom-15 tile edge.
 const mp={type:'Feature',properties:{id:'relation-32'},geometry:{type:'MultiPolygon',coordinates:[
  [[[.0065,.002],[.0105,.002],[.0105,.0021],[.0065,.0021],[.0065,.002]]],
  [[[.0105,.0021],[.0145,.0021],[.0145,.0022],[.0105,.0022],[.0105,.0021]]]]}};
 const {geometry}=providerTiles([mp]);
 const measured=await geometry.measure('relation-32',platformTilesFor(mp.geometry.coordinates));
 assert.ok(Math.abs(measured.length-444.78)<1,String(measured.length));
});
test('a multipolygon part in tiles the first measurement never read is measured when it comes into view',async()=>{
 // A 0.002° part and a 0.004° part about three zoom-15 tiles apart.
 const short=[[[.0015,.002],[.0035,.002],[.0035,.0021],[.0015,.0021],[.0015,.002]]],long=[[[.0365,.002],[.0405,.002],[.0405,.0021],[.0365,.0021],[.0365,.002]]];
 const tiles=providerTiles([{type:'Feature',properties:{id:'relation-31'},geometry:{type:'MultiPolygon',coordinates:[short,long]}}]);
 let visible=short,data;
 const map={getZoom:()=>19,getLayer:()=>({}),queryRenderedFeatures:({layers})=>layers.includes('platform-edges')?[]:[{properties:{id:'relation-31'},geometry:{type:'Polygon',coordinates:visible}}],getSource:id=>id==='platformNumbers'?{setData:d=>data=d}:null};
 const p=createPlatformLengths(map,{delay:0,geometry:tiles.geometry,fetcher:async()=>({ok:true,json:async()=>({properties:{ref:'1'}})})});
 try{
  p.update();await new Promise(r=>setTimeout(r,30));
  assert.ok(Math.abs(data.features[0].properties.platform_length-222.4)<.6,String(data.features[0].properties.platform_length));
  const read=tiles.requests.length;p.update();await new Promise(r=>setTimeout(r,20));assert.equal(tiles.requests.length,read,'the same part is not measured again');
  visible=long;p.update();await new Promise(r=>setTimeout(r,30));
  assert.ok(Math.abs(data.features[0].properties.platform_length-444.78)<.6,String(data.features[0].properties.platform_length));
  visible=short;p.update();await new Promise(r=>setTimeout(r,20));
  assert.ok(Math.abs(data.features[0].properties.platform_length-444.78)<.6,'the longest part measured so far is kept');
  assert.equal(p.enrich({source:'platforms',properties:{id:'relation-31'}}).properties.measuredTiles,undefined);
 }finally{p.destroy();}
});
test('grouping densely drawn interlocking parts stays within a work budget and gives no length',async()=>{
 // Two comb-shaped parts whose teeth interlock without touching: bounds overlap and every pair must be compared.
 const comb=(teeth,flip)=>{const ring=[],w=.00002,h=.0003,y0=flip?.0023:.002;for(let k=0;k<teeth;k++){const x=.0005+k*2*w+(flip?w:0);ring.push([x,y0],[x+w*.8,y0],[x+w*.8,flip?y0-h:y0+h],[x,flip?y0-h:y0+h]);}
  const last=ring.at(-1);ring.push([last[0],y0+(flip?.00005:-.00005)],[ring[0][0],y0+(flip?.00005:-.00005)],ring[0]);return ring;};
 const mp={type:'Feature',properties:{id:'relation-33'},geometry:{type:'MultiPolygon',coordinates:[[comb(300,false)],[comb(300,true)]]}};
 const {geometry}=providerTiles([mp]);
 const started=performance.now(),measured=await geometry.measure('relation-33',platformTilesFor(mp.geometry.coordinates));
 assert.equal(measured,null);assert.ok(performance.now()-started<1000,`took ${performance.now()-started} ms`);
});
test('every visible part of a multipolygon platform seeds its measurement, not only the labelled one',async()=>{
 // A compact 0.003° square (the larger diagonal, so it labels the platform) and
 // a long thin 0.004° part about three zoom-15 tiles apart, both on screen at once.
 const short=[[[.0015,.002],[.0045,.002],[.0045,.005],[.0015,.005],[.0015,.002]]],long=[[[.0365,.002],[.0405,.002],[.0405,.0021],[.0365,.0021],[.0365,.002]]];
 const tiles=providerTiles([{type:'Feature',properties:{id:'relation-34'},geometry:{type:'MultiPolygon',coordinates:[short,long]}}]);
 let data;
 // The short part comes first; a renderer may return either fragment as the label anchor.
 const fragments=[{properties:{id:'relation-34'},geometry:{type:'Polygon',coordinates:short}},{properties:{id:'relation-34'},geometry:{type:'Polygon',coordinates:long}}];
 const map={getZoom:()=>19,getLayer:()=>({}),queryRenderedFeatures:({layers})=>layers.includes('platform-edges')?[]:fragments,getSource:id=>id==='platformNumbers'?{setData:d=>data=d}:null};
 const p=createPlatformLengths(map,{delay:0,geometry:tiles.geometry,fetcher:async()=>({ok:true,json:async()=>({properties:{ref:'1'}})})});
 try{
  p.update();await new Promise(r=>setTimeout(r,40));
  assert.ok(Math.abs(data.features[0].properties.platform_length-444.78)<.6,String(data.features[0].properties.platform_length));
 }finally{p.destroy();}
});
