import test from 'node:test';
import assert from 'node:assert/strict';
import {flatMeasureAdapter} from '../styles/flat-measure.mjs';
import {flatCamera} from '../styles/flat-camera.mjs';
import {Measure} from '../styles/draw.mjs';

const canvas={style:{}}, event={button:0};
const camera=flatCamera({center:[179.8,0],zoom:7,width:500,height:300});
const context=output=>new Proxy({}, {get(_,name){return (...args)=>output.push([name,...args]);}});

test('shared Measure paints a dateline crossing and the selected handles stay local and draggable',()=>{
  let redraws=0;
  const adapter=flatMeasureAdapter(canvas,()=>redraws++);
  adapter.setCamera(camera);
  const tool=new Measure(adapter.map);
  tool.setMode('distance');
  tool.click({lng:179.7,lat:0});
  tool.click({lng:-179.9,lat:0});
  tool.end();
  const out=[];
  adapter.draw(context(out),camera);
  const start=out.find(([name])=>name==='moveTo');
  const end=out.find(([name])=>name==='lineTo');
  assert.ok(Math.abs(end[1]-start[1])<100);
  assert.ok(out.some(([name,text])=>name==='fillText'&&text.includes('44.5 km')));
  const point=camera.project([179.7,0]);
  assert.equal(adapter.emit('mousedown',point,event),true);
  adapter.emit('mousemove',[point[0]+14,point[1]],event);
  adapter.emit('mouseup',[point[0]+14,point[1]],event);
  assert.notEqual(tool.points[0][0],179.7);
  assert.ok(redraws>=5);
  assert.equal(tool.dragging(),true);
  tool.setMode('radius');
  assert.equal(tool.dragging(),false,'changing modes retires the old handle click suppression');
  assert.equal(adapter.emit('mousedown',point,event),false);
});

test('profile marker is painted and clears without a WebGL renderer',()=>{
  const adapter=flatMeasureAdapter(canvas,()=>{});
  const out=[];
  adapter.marker([179.8,0]);adapter.draw(context(out),camera);
  const arc=out.find(([name])=>name==='arc');
  assert.ok(Math.abs(arc[1]-250)<1e-9);
  assert.deepEqual(arc.slice(2,4),[150,6]);
  out.length=0;
  adapter.marker(null);adapter.draw(context(out),camera);
  assert.ok(!out.some(([name])=>name==='arc'));
});
