import assert from 'node:assert/strict';
import test from 'node:test';
import {flatVectorTile,offsetFlatPath} from '../styles/flat-vector.mjs';
import {flatVectorFixture} from './fixtures/flat-vector.mjs';

test('CPU vector tile reads exact source layers, ID, geometry and feature properties', () => {
  const input=flatVectorFixture();
  for(const bytes of [input,input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength)]) {
    const tile=flatVectorTile(bytes);
    const [rail]=tile.layer('rail');
    assert.equal(rail.id,83);
    assert.equal(rail.extent,4096);
    assert.equal(rail.type,2);
    assert.equal(rail.properties.railway,'rail');
    assert.equal(rail.properties.name,'Fixture Line');
    assert.deepEqual(rail.paths.map(path=>path.map(({x,y})=>[x,y])),[[[300,900],[3800,900]]]);
    assert.equal(tile.layer('area')[0].paths.length,2);
    assert.equal(tile.layer('station')[0].type,1);
    assert.deepEqual(tile.layer('missing'),[]);
    assert.deepEqual(tile.layer('constructor'),[]);
  }
  assert.deepEqual(flatVectorTile(new ArrayBuffer(0)).layer('rail'),[]);
});

test('line offsets translate right on screen and maintain bounded joins',()=>{
  assert.deepEqual(offsetFlatPath([[0,0],[12,0]],4),[[0,4],[12,4]]);
  assert.deepEqual(offsetFlatPath([[0,0],[0,12]],4),[[-4,0],[-4,12]]);
  const turn=offsetFlatPath([[0,0],[12,0],[12,0],[12,12]],2);
  assert.deepEqual(turn.map(p=>p.map(x=>Math.round(x))),[[0,2],[10,2],[10,12]]);
  const turnback=offsetFlatPath([[0,0],[12,0],[0,0.01]],3);
  assert.ok(Math.hypot(turnback[1][0]-12,turnback[1][1])<=6.001);
  const square=offsetFlatPath([[0,0],[12,0],[12,12],[0,12],[0,0]],2,true);
  assert.deepEqual(square.map(p=>p.map(x=>Math.round(x))),[[2,2],[10,2],[10,10],[2,10]]);
});
