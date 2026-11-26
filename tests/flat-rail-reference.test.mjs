import test from 'node:test';
import assert from 'node:assert/strict';
import {flatCamera} from '../styles/flat-camera.mjs';
import {planFlatSourceTiles} from '../styles/flat-source-plan.mjs';
import {flatRailReferenceClip} from '../styles/flat-rail-reference.mjs';

test('rail fallback hides while data is pending or empty; metadata failure uses the whole viewport',()=>{
  const c=flatCamera({center:[0,0],zoom:8,width:700,height:440});
  assert.equal(flatRailReferenceClip(c),false);
  assert.equal(flatRailReferenceClip(c,{failed:[{tile:{z:8,x:120,y:128}}],planned:[]}),false);
  assert.equal(flatRailReferenceClip(c,{metadataFailed:true}),null);
});

test('rail fallback follows the rotated failed cell in each visible world copy, not a healthy neighbour',()=>{
  const c=flatCamera({center:[179,0],zoom:0,bearing:29,width:1400,height:640});
  const planned=planFlatSourceTiles(c,{type:'vector',minzoom:1,maxzoom:1,tileSize:256});
  const failed=planned.find(({key})=>key==='1/0/1');
  const healthy=planned.find(({key})=>key==='1/1/1');
  assert.ok(failed.copies.length>1&&healthy.copies.length>1);
  const paths=[];
  let began=0,clipped=0;
  const g={beginPath(){began++;},moveTo(...xy){paths.push([xy]);},lineTo(...xy){paths.at(-1).push(xy);},
    closePath(){paths.at(-1).push('closed');},clip(){clipped++;}};
  flatRailReferenceClip(c,{planned,failed:[{tile:failed.canonical}]})(g);
  assert.equal(began,1);assert.equal(clipped,1);
  assert.equal(paths.length,failed.copies.length);
  for(const [i,tile] of failed.copies.entries()){
    const [a,b,d,e,x,y]=c.tileTransform(tile);
    assert.deepEqual(paths[i],[[x,y],[x+a,y+b],[x+a+d,y+b+e],[x+d,y+e],'closed']);
  }
  for(const tile of healthy.copies){
    const xy=c.tileTransform(tile).slice(4);
    assert.ok(!paths.some(([start])=>String(start)===String(xy)));
  }
});
