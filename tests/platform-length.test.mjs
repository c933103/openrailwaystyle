import test from 'node:test';
import assert from 'node:assert/strict';
import {osmObject} from '../styles/map-model.mjs';
import {createPlatformLengths,platformIdentity,platformAnchor,formatPlatformLength,platformLengthLabel,platformReference,platformObjectIdentity} from '../styles/platform-length.mjs';
import {createExpression} from '@maplibre/maplibre-gl-style-spec';
const edge=(id=1)=>({properties:{id,ref:'2'},geometry:{type:'LineString',coordinates:[[0,0],[.001,0]]}});
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
