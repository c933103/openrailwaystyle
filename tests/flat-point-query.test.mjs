import assert from 'node:assert/strict';
import test from 'node:test';
import {flatCamera} from '../styles/flat-camera.mjs';
import {compileFlatPointQuery} from '../styles/flat-point-query.mjs';
import {Measure, pointTarget} from '../styles/draw.mjs';

const point = (coordinates,properties) => ({type:'Feature', geometry:{type:'Point',coordinates},properties});
const collection = (...features) => ({type:'FeatureCollection',features});

test('measure targets keep the 18-pixel radius, filter and live generation', () => {
  const camera=flatCamera({center:[0,0],width:256,height:256,zoom:5,bearing:25});
  const measure=new Measure({on(){}});
  measure.mode='distance';
  measure.points=[[0,0],[1,0]];
  measure.handleGeneration=8;
  const src='atlas-measure', id='measure-point-targets';
  const query=compileFlatPointQuery([pointTarget(id,src,['has','index'])]);
  const sources=new Map([[src,measure.collection()]]);
  const found=query(camera,[145,128],sources,{layers:[id]});
  assert.equal(found.length,1);
  assert.deepEqual(found[0].properties,{index:0,generation:8,selected:false});
  assert.equal(measure.currentHandle(found[0].properties),true);
  measure.handleGeneration++;
  assert.equal(measure.currentHandle(found[0].properties),false);
  assert.deepEqual(query(camera,[147,128],sources,{layers:[id]}),[]);
  assert.deepEqual(query(camera,[128,128],sources,{layers:['other'] }),[]);
  assert.deepEqual(query(camera,[128,128],new Map([[src,collection(point([0,0],{kind:'label'}))]])),[]);
});

test('query projects a wrapped copy near the pointer and hits topmost eligible targets first', () => {
  const camera=flatCamera({center:[179,0],width:1600,height:1400,zoom:0,bearing:25});
  const styles=[pointTarget('bottom','z'),{...pointTarget('hidden','z'),layout:{visibility:'none'}},pointTarget('top','z')];
  const features=collection(point([-178,0],{index:1}), point([-178,0],{index:2}));
  const [x,y]=camera.project([-178,0],{nearestWorld:false});
  const [a,b]=camera.tileTransform({z:0,x:0,y:0});
  const query=compileFlatPointQuery(styles);
  for (const world of [0,1,2]) {
    const hits=query(camera,[x+world*a,y+world*b],new Map([['z',features]]));
    assert.deepEqual(hits.map(h=>[h.layer.id,h.properties.index]),[['top',2],['top',1],['bottom',2],['bottom',1]]);
  }
});
