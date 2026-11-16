import test from 'node:test';
import assert from 'node:assert/strict';
import {pruneModeTiles} from '../styles/mode-tile-cache.mjs';
import {readFileSync} from 'node:fs';
const layer=(source,views,visibility='none')=>({source,metadata:{'atlas:views':views},layout:{visibility}});
function fixture(layers) {
  const calls=[],sources={},tileManagers={};
  for(const {source:id} of layers){sources[id]={};tileManagers[id]={getSource:()=>sources[id],clearTiles:()=>calls.push(id)};}
  return {calls, map:{getStyle:()=>({layers}),getSource:id=>sources[id],style:{tileManagers}}};
}
test('mode switch prunes only hidden exclusively thematic sources, leaving shared sources intact',()=>{
 const f=fixture([layer('old',['speed']),layer('next',['gauge'],'visible'),layer('shared',['speed']),layer('shared',[]),layer('unscoped',undefined),layer('visible',['speed'],'visible'),layer('other',['owner'])]);
 assert.deepEqual(pruneModeTiles(f.map,'speed','gauge'),['old']);assert.deepEqual(f.calls,['old']);
 assert.deepEqual(pruneModeTiles(f.map,'gauge','gauge'),[]);
 assert.deepEqual(pruneModeTiles(f.map,undefined,'gauge'),[]);
});
test('source replacement or an unknown renderer cannot clear a mismatched cache',()=>{
 const f=fixture([layer('old',['speed'])]);
 f.map.style.tileManagers.old.getSource=()=>({});assert.deepEqual(pruneModeTiles(f.map,'speed','gauge'),[]);
 delete f.map.style.tileManagers;assert.deepEqual(pruneModeTiles(f.map,'speed','gauge'),[]);
});
test('pinned renderer clearTiles removes every active tile and resets decoded inactive cache',()=>{
 const source=readFileSync(new URL('../node_modules/maplibre-gl/src/tile/tile_manager.ts',import.meta.url),'utf8');
 const body=/\n    clearTiles\(\) \{([\s\S]*?)\n    \}/.exec(source)?.[1];assert.ok(body,'review cache cleanup if pinned renderer changes');
 const removed=[];let resets=0;
 const manager={_shouldReloadOnResume:true,_paused:true,_inViewTiles:{getAllIds:()=>[1,2,3]},_removeTile:id=>removed.push(id),_outOfViewCache:{reset:()=>resets++}};
 new Function(body).call(manager);
 assert.deepEqual(removed,[1,2,3]);assert.equal(resets,1);assert.equal(manager._paused,false);assert.equal(manager._shouldReloadOnResume,false);
});
