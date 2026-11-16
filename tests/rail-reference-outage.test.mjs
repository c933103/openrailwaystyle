import test from 'node:test';
import assert from 'node:assert/strict';
import {isNeutralRailReference} from '../styles/railway-visibility.mjs';
import {createRailReferenceState} from '../styles/station-fallback.mjs';
const tile=(x=1,state='errored')=>({state,tileID:{canonical:{z:2,x,y:1},wrap:0}});
function fixture(){
 const settings={mode:'speed'},sources={speed:{maxzoom:6},electric:{maxzoom:6},railway:{maxzoom:16},stations:{maxzoom:16}};
 const tiles={speed:[],electric:[],railway:[]};let zoom=2,west=-90,east=0;
 const map={getZoom:()=>zoom,getSource:id=>sources[id],getBounds:()=>({getWest:()=>west,getEast:()=>east,getSouth:()=>0,getNorth:()=>65}),
  getStyle:()=>({layers:[{id:'speed-overview',source:'speed'},{id:'electrification-overview',source:'electric'},{id:'speed-tracks',source:'railway'},{id:'electrification-tracks',source:'railway'}]}),
  style:{tileManagers:Object.fromEntries(Object.entries(tiles).map(([id,list])=>[id,{getSource:()=>sources[id],getIds:()=>list.map((_,i)=>i),getTileByID:i=>list[i]}]))}};
 const state=createRailReferenceState(map,settings),shown=()=>Boolean(state.area(zoom));
 return {settings,sources,tiles,map,state,shown,move:(w,e)=>{west=w;east=e},zoom:z=>{zoom=z}};
}
test('neutral reference identity excludes colored Infrastructure and ordinary railway layers',()=>{
 for(const id of ['rail-reference-main','rail-reference-branch','rail-reference-unknown','rail-backbone-railroads','rail-basemap-reference'])assert.equal(isNeutralRailReference({id}),true);
 for(const id of ['infrastructure-reference-main','infrastructure-basemap-reference','speed-tracks','railway-names'])assert.equal(isNeutralRailReference({id}),false);
});
for(const status of [403,503])test(`neutral fallback requires a selected track failure; HTTP${status} remains independently recoverable`,()=>{
 const f=fixture();assert.equal(f.shown(),false);
 f.state.noteError({sourceId:'stations',error:{status}});assert.equal(f.shown(),false);
 f.state.noteError({sourceId:'electric',error:{status}});assert.equal(f.shown(),false);
 const failed=tile(),healthy=tile(2,'loaded');f.tiles.speed.push(failed,healthy);
 f.state.noteError({sourceId:'speed',tile:failed,error:{status}});assert.equal(f.shown(),true);
 f.state.noteSourceData({sourceId:'speed',tile:healthy});assert.equal(f.shown(),true,'healthy neighbor cannot clear failure');
 f.settings.mode='electrification';assert.equal(f.shown(),true,'that source has independent metadata failure');
 f.state.noteSourceData({sourceId:'electric',sourceDataType:'metadata'});assert.equal(f.shown(),false);
 f.settings.mode='speed';assert.equal(f.shown(),true);
 failed.state='loaded';f.state.noteSourceData({sourceId:'speed',tile:failed});assert.equal(f.shown(),false);
});
test('off-view failures, canceled requests and replaced sources do not activate references',()=>{
 const f=fixture(),failed=tile();f.tiles.speed.push(failed);
 f.state.noteError({sourceId:'speed',tile:failed,error:{name:'AbortError'}});assert.equal(f.shown(),false);
 f.state.noteError({sourceId:'speed',tile:failed,error:{status:503}});assert.equal(f.shown(),true);
 f.move(90,180);assert.equal(f.shown(),false);f.move(-90,0);assert.equal(f.shown(),true,'active cached failed tile restores evidence');
 f.sources.speed={maxzoom:6};assert.equal(f.shown(),false);
});
test('zoom handoff requires detail failure rather than reusing overview metadata failure',()=>{
 const f=fixture();f.state.noteError({sourceId:'speed',error:{status:503}});assert.equal(f.shown(),true);
 f.zoom(8);assert.equal(f.shown(),false);
 f.state.noteError({sourceId:'railway',error:{status:503}});assert.equal(f.shown(),true);
 f.state.noteSourceData({sourceId:'railway',sourceDataType:'metadata'});assert.equal(f.shown(),false);
});
