import test from 'node:test';
import assert from 'node:assert/strict';
import * as controls from '../styles/map-controls.mjs';

function fixture() {
 const calls=[];
 const painter={transform:{zoom:9},currentStencilSource:'visible',nextStencilID:250,
  _renderTileClippingMasks(...args){calls.push({self:this,args});this.currentStencilSource=args[0].source;this.nextStencilID++;return 42;}};
 return {map:{painter},painter,calls,original:painter._renderTileClippingMasks};
}

test('hidden layer returns before stencil mutation or GPU work; visible arguments and result survive',()=>{
 const {map,painter,calls}=fixture();controls.installHiddenTileMaskGuard(map);
 const layer={source:'hidden',isHidden:zoom=>zoom===9},tiles=[{key:'9/1/2'}];
 assert.equal(painter._renderTileClippingMasks(layer,tiles,true),undefined);
 assert.equal(calls.length,0);assert.equal(painter.currentStencilSource,'visible');assert.equal(painter.nextStencilID,250);
 painter.transform.zoom=10;
 assert.equal(painter._renderTileClippingMasks(layer,tiles,true),42);
 assert.equal(calls.length,1);assert.equal(calls[0].self,painter);assert.deepEqual(calls[0].args,[layer,tiles,true]);
});

test('visibility is evaluated afresh on each call, including after a style replacement',()=>{
 const {map,painter,calls}=fixture();controls.installHiddenTileMaskGuard(map);
 let hidden=true;const layer={source:'A',isHidden:()=>hidden};
 for(const value of [true,false,true,false]){hidden=value;painter._renderTileClippingMasks(layer,[],false);}
 assert.equal(calls.length,2);
 painter._renderTileClippingMasks({source:'new-style',isHidden:()=>false},[],true);
 assert.equal(calls.length,3);
});

test('installation is instance-local and idempotent without changing the pinned prototype',()=>{
 const {painter,original}=fixture(),map={painter:Object.create(painter)};
 controls.installHiddenTileMaskGuard(map);const installed=map.painter._renderTileClippingMasks;
 controls.installHiddenTileMaskGuard(map);
 assert.equal(map.painter._renderTileClippingMasks,installed);assert.equal(painter._renderTileClippingMasks,original);
 let checks=0;map.painter._renderTileClippingMasks({isHidden:()=>{checks++;return false;}},[],false);
 assert.equal(checks,1);
});

test('an unexpected private renderer boundary fails explicitly without mutation',()=>{
 for(const map of [{},{painter:{}},{painter:{_renderTileClippingMasks:42}},{painter:{_renderTileClippingMasks(){}}}])
  assert.throws(()=>controls.installHiddenTileMaskGuard(map),/Pinned MapLibre tile-mask boundary unavailable/);
});
