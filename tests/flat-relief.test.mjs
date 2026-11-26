import test from 'node:test';
import assert from 'node:assert/strict';
import {flatReliefPaint,flatReliefPixels} from '../styles/flat-relief.mjs';

const paint=flatReliefPaint({type:'hillshade',paint:{
  'hillshade-illumination-anchor':'map','hillshade-illumination-direction':270,
  'hillshade-exaggeration':0.30,'hillshade-highlight-color':'#ffffff',
  'hillshade-shadow-color':'#000000','hillshade-accent-color':'#000000',
}});
const land=(f,width=256,height=256)=>({width,height,data:Float32Array.from({length:width*height},(_,i)=>f(i%width,Math.floor(i/width)))});
const relief=(data,p=paint)=>flatReliefPixels(data,{z:12,y:2048},p);
const pixel=(values,x,y)=>Array.from(values.pixels.slice((y*values.width+x)*4,(y*values.width+x+1)*4));

test('Canvas shaded relief is bounded, transparent for level ground, and darkens/brightens opposite slopes',()=>{
  const plane=relief(land(()=>1800));
  assert.deepEqual([plane.width,plane.height],[128,128]);
  assert.ok(plane.pixels.every(n=>n===0));
  const ridge=relief(land(x=>100+Math.min(x,256-x)*12));
  const west=pixel(ridge,35,64),east=pixel(ridge,90,64);
  assert.ok(west[0]>200&&east[0]<30);
  assert.equal(west[3],east[3]);
  assert.ok(west[3]>10);
  assert.deepEqual(pixel(ridge,0,64),west,'one-sided tile boundary matches the same continuous slope');
  const reverse=relief(land(x=>100+Math.min(x,256-x)*12),{...paint,direction:90});
  assert.deepEqual(pixel(reverse,35,64),east);
  assert.deepEqual(pixel(reverse,90,64),west);
});

test('Invalid heights fail closed and unsupported light anchors are not approximated',()=>{
  assert.equal(flatReliefPaint({type:'hillshade'}),null);
  assert.equal(flatReliefPaint({type:'raster'}),null);
  assert.throws(()=>relief({width:3,height:2,data:new Float32Array(4)}),/Invalid terrain/);
  assert.throws(()=>relief({width:2048,height:2,data:new Float32Array(4096)}),/Invalid terrain/);
  const gap=relief(land(()=>NaN,3,2));
  assert.ok(gap.pixels.every(n=>n===0));
  const off=relief(land(x=>x*100),{...paint,intensity:0});
  assert.ok(off.pixels.every(n=>n===0));
});
