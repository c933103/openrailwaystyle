import test from 'node:test';
import assert from 'node:assert/strict';
import {flatCamera,flatBoxRect,fitFlatScreenBox} from '../styles/flat-camera.mjs';
const view=flatCamera({center:[179.98,25],zoom:9,bearing:40,width:700,height:440});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} versus ${b}`);
test('a rotated box crossing the antimeridian fits at the original bearing',()=>{
  const start=[160,110],end=[360,230];
  const view2=fitFlatScreenBox(view,flatBoxRect(view,start,end));
  near(view2.zoom,9+Math.log2(3.5));
  assert.equal(view2.bearing,40);
  const fit=[view2.project(view.unproject(start)),view2.project(view.unproject(end))];
  [[0,10],[700,430]].forEach((p,i)=>p.forEach((v,j)=>near(fit[i][j],v)));
  view2.project(view.unproject([260,170])).forEach((v,i)=>near(v,[350,220][i]));
});
test('a backward drag is clamped and thin, full or max-zoom boxes do not zoom',()=>{
  assert.deepEqual(flatBoxRect(view,[510,230],[-10,-6]),{left:0,top:0,width:510,height:230});
  assert.equal(flatBoxRect(view,[160,110],[163,130]),null);
  assert.equal(fitFlatScreenBox(view,flatBoxRect(view,[0,0],[700,440])),null);
  assert.equal(fitFlatScreenBox({...view,zoom:22},flatBoxRect(view,[1,1],[6,7])),null);
});
