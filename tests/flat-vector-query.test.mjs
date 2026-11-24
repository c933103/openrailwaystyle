import assert from 'node:assert/strict';
import {test} from 'node:test';
import {flatCamera} from '../styles/flat-camera.mjs';
import {flatVectorTile} from '../styles/flat-vector.mjs';
import {compileFlatVectorQuery} from '../styles/flat-vector-query.mjs';
import {flatVectorFixture} from './fixtures/flat-vector.mjs';
const tile={z:1,x:0,y:0};
const camera=flatCamera({center:[-90,66.51326044311186],zoom:0,width:256,height:256});
const vector=flatVectorTile(flatVectorFixture());
const frame=new Map([['v',[{tile,vector},{tile,vector}]]]);
const line={id:'tracks',type:'line',source:'v','source-layer':'rail',paint:{'line-color':'red','line-width':5}};
const station={id:'stations',type:'circle',source:'v','source-layer':'station',paint:{'circle-color':'green','circle-radius':5}};

test('Canvas vector query returns original line and station identities without duplicate copies',()=>{
  const query=compileFlatVectorQuery([line,station]);
  const [rail]=query(camera,[128,56],frame);
  assert.deepEqual([rail?.id,rail?.layer.id,rail?.properties.name,rail?.geometry.type],[83,'tracks','Fixture Line','LineString']);
  const hits=query(camera,[128,156],frame);
  assert.equal(hits.length,1);
  assert.deepEqual([hits[0].id,hits[0].sourceLayer,hits[0].geometry.type],[7,'station','Point']);
  assert.ok(hits[0].geometry.coordinates[0]<0);
  assert.deepEqual(query(camera,[0,255],frame),[]);
});
test('Canvas ignores filtered, invisible, noninteractive and out-of-zoom geometry',()=>{
  for(const layer of [
    {...line,filter:['==',['get','railway'],'tram']},
    {...line,layout:{visibility:'none'}},
    {...line,minzoom:1},
    {...line,id:'not-interactive'},
  ]) assert.deepEqual(compileFlatVectorQuery([layer],{include:id=>id!=='not-interactive'})(camera,[128,56],frame),[]);
});
test('Canvas picks the shifted stroke, not the unshifted centre line',()=>{
  const layer={...line,paint:{...line.paint,'line-offset':25}};
  const query=compileFlatVectorQuery([layer]);
  assert.deepEqual(query(camera,[128,56],frame),[]);
  assert.equal(query(camera,[128,81],frame)[0]?.id,83);
});
