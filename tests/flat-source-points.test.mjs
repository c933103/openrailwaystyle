import assert from 'node:assert/strict';
import test from 'node:test';
import {flatSourcePoints} from '../styles/flat-source-points.mjs';

test('uses only canonical loaded vector points, not wrapped copies or buffered neighbors',()=>{
  const tile={z:1,x:0,y:0,worldX:0};
  const vector={layer:name=>name==='poi'?[
    {id:7,type:1,extent:100,properties:{name:'West Bus'},paths:[[{x:50,y:50}]]},
    {id:8,type:1,extent:100,properties:{name:'Buffer'},paths:[[{x:104,y:50}]]},
    {id:9,type:2,extent:100,properties:{name:'Line'},paths:[[{x:20,y:50},{x:30,y:50}]]},
  ]:[]};
  const points=flatSourcePoints([{tile,vector},{tile:{...tile,worldX:2},vector},{tile:{...tile,x:1},image:{}}],['poi','aerodrome_label']);
  assert.equal(points.length,1);
  assert.equal(points[0].id,7);
  assert.equal(points[0].geometry.type,'Point');
  assert.equal(points[0].geometry.coordinates[0],-90);
  assert.ok(Math.abs(points[0].geometry.coordinates[1]-66.51326044)<1e-7);
});
