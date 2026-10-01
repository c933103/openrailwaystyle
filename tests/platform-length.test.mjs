import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformLengths,platformIdentity,platformAnchor,formatPlatformLength,platformLengthLabel} from '../styles/platform-length.mjs';
const edge=(id=1)=>({properties:{id,ref:'2'},geometry:{type:'LineString',coordinates:[[0,0],[.001,0]]}});
test('platform lengths convert m/ft and anchor on line geometry without measuring its clipped span',()=>{
 assert.equal(formatPlatformLength(304.8,'imperial'),'1000 ft');assert.equal(formatPlatformLength(304.8),'305 m');assert.equal(formatPlatformLength(0),'');
 assert.equal(platformIdentity(edge()),'1');assert.equal(platformIdentity(edge('way-99')),'99');assert.equal(platformIdentity(edge('node-99')),null);
 assert.deepEqual(platformAnchor(edge()),[.0005,0]);assert.match(JSON.stringify(platformLengthLabel('imperial')),/ ft/);
});
test('platform API uses full length, deduplicates edge IDs, caches values and starts at 19',async()=>{
 let zoom=18,requests=0,data,features=[edge(),edge()];const map={getZoom:()=>zoom,queryRenderedFeatures:()=>features,getSource:()=>({setData:d=>data=d})};
 const p=createPlatformLengths(map,{delay:0,fetcher:async()=>{requests++;return {ok:true,json:async()=>({properties:{length:350}})};}});
 try{p.update();await new Promise(r=>setTimeout(r,10));assert.equal(requests,0);zoom=19;p.update();await new Promise(r=>setTimeout(r,20));assert.equal(requests,1);assert.equal(data.features[0].properties.platform_length,350);
  p.update();await new Promise(r=>setTimeout(r,10));assert.equal(requests,1);features=[];p.update();assert.equal(data.features.length,0);
 }finally{p.destroy();}
});
test('platform requests leave the queue when panned away and respect a rate-limit response',async()=>{
 let features=[edge(),edge(2)],requests=0;const map={getZoom:()=>19,queryRenderedFeatures:()=>features,getSource:()=>({setData(){}})};
 const p=createPlatformLengths(map,{delay:0,fetcher:async()=>{requests++;return {ok:false,status:429};}});
 try{p.update();await new Promise(r=>setTimeout(r,10));p.update();await new Promise(r=>setTimeout(r,10));assert.equal(requests,1);features=[];p.update();}
 finally{p.destroy();}
});
