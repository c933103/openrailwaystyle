import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceFailures} from '../styles/rail-provider-recovery.mjs';
const tile=(x=1,wrap=0)=>({state:'errored',tileID:{canonical:{z:2,x,y:1},wrap}});
function fixture({inventory=false}={}){
 let source={url:'https://fixture.test/map'},active=[];
 const map={getSource:()=>source};
 if(inventory)map.style={tileManagers:{test:{getSource:()=>source,getIds:()=>active.map((_,i)=>i),getTileByID:i=>active[i]}}};
 return {map,state:createSourceFailures(map,'test'),setSource:s=>source=s,setTiles:t=>active=t,source};
}
for(const inventory of [false,true])test(`matching recovery preserves siblings and world copies (inventory=${inventory})`,()=>{
 const {state,setTiles}=fixture({inventory}),a=tile(),b=tile(),c=tile(2),healthy=tile(3);healthy.state='loaded';
 setTiles([a,b,c,healthy]);for(const t of [a,b,c])state.noteError({tile:t});
 state.noteSourceData({tile:healthy,isSourceLoaded:true});assert.equal(state.hasFailures(),true);
 a.state='loaded';state.noteSourceData({tile:a});assert.equal(state.hasFailures(),true);
 c.state='loaded';state.noteSourceData({tile:c});assert.equal(state.hasFailures(),true,'same-coordinate copy stays failed');
 b.state='loaded';state.noteSourceData({tile:b});assert.equal(state.hasFailures(),false);
});
test('metadata and failed tiles have independent recovery evidence',()=>{
 const {state}=fixture(),a=tile();state.noteError({});state.noteError({tile:a});
 state.noteSourceData({isSourceLoaded:true});assert.equal(state.hasFailures(),true);
 state.noteSourceData({sourceDataType:'metadata'});assert.equal(state.hasFailures(),true);
 a.state='loaded';state.noteSourceData({tile:a});assert.equal(state.hasFailures(),false);
 state.noteError({});state.noteSourceData({tile:a,isSourceLoaded:true});assert.equal(state.hasFailures(),true);
 state.noteSourceData({sourceDataType:'metadata'});assert.equal(state.hasFailures(),false);
});
test('coordinate-only errors require matching success when no inventory is available',()=>{
 const {state}=fixture(),a=tile(),b=tile(2);state.noteError({coord:a.tileID});
 b.state='loaded';state.noteSourceData({tile:b});assert.equal(state.hasFailures(),true);
 a.state='loaded';state.noteSourceData({tile:a});assert.equal(state.hasFailures(),false);
});
test('coordinate-only errors bind to every active unresolved copy',()=>{
 const {state,setTiles}=fixture({inventory:true}),a=tile(),b=tile(1,1);
 setTiles([a,b]);state.noteError({coord:a.tileID});a.state='loaded';state.noteSourceData({tile:a});
 assert.equal(state.hasFailures(),true);b.state='loaded';state.noteSourceData({tile:b});assert.equal(state.hasFailures(),false);
});
test('unknown tile errors never turn into metadata or sibling success',()=>{
 const {state}=fixture();state.noteError({coord:{canonical:{z:2,x:99,y:0}}});
 state.noteSourceData({sourceDataType:'metadata'});const healthy=tile();healthy.state='loaded';state.noteSourceData({tile:healthy});
 assert.equal(state.hasFailures(),true);
});
for(const change of ['instance','url','tiles'])test(`source ${change} replacement retires old presentation`,()=>{
 const f=fixture(),a=tile();f.state.noteError({tile:a});
 if(change==='instance')f.setSource({url:f.source.url});else if(change==='url')f.source.url+='?new';else f.source.tiles=['https://fixture.test/new/{z}/{x}/{y}'];
 assert.equal(f.state.current(),false);assert.equal(f.state.hasFailures(),false);
});
test('cached failed tiles resume their warning without a fresh error event',()=>{
 const {state,setTiles}=fixture({inventory:true}),a=tile(),unrelated=tile(2);
 setTiles([a]);state.noteError({tile:a});assert.equal(state.hasFailures(),true);
 setTiles([]);assert.equal(state.hasFailures(),false);
 setTiles([unrelated]);assert.equal(state.hasFailures(),false,'unknown renderer failures are not inferred');
 setTiles([a]);assert.equal(state.hasFailures(),true);
 a.state='loaded';assert.equal(state.hasFailures(),false);
 a.state='errored';assert.equal(state.hasFailures(),false,'a recovered old failure cannot manufacture a new one');
});
for(const stateName of ['aborted','unloaded'])test(`${stateName} tiles retire without pretending a sibling recovered`,()=>{
 const {state}=fixture(),a=tile(),b=tile(2);state.noteError({tile:a});state.noteError({tile:b});
 if(stateName==='aborted')a.aborted=true;else a.state=stateName;
 assert.equal(state.hasFailures(),true);b.state='loaded';state.noteSourceData({tile:b});assert.equal(state.hasFailures(),false);
});
test('missing or throwing renderer inventory preserves unresolved evidence',()=>{
 const f=fixture({inventory:true}),a=tile();f.setTiles([a]);f.state.noteError({tile:a});
 f.map.style.tileManagers.test.getIds=()=>{throw new Error('style changed');};
 assert.equal(f.state.hasFailures(),true);a.state='loaded';f.state.noteSourceData({tile:a});assert.equal(f.state.hasFailures(),false);
});

test('hiding a failed source retains warning through abort, empty inventory and replacement demand',()=>{
 const f=fixture({inventory:true}),a=tile(),b=tile(2);let visibility='visible';
 f.map.getStyle=()=>({layers:[{source:'test',layout:{visibility}}]});f.map.getZoom=()=>2;
 f.setTiles([a,b]);f.state.noteError({tile:a});f.state.noteError({tile:b});assert.equal(f.state.hasFailures(),true);
 visibility='none';f.setTiles([]);a.aborted=b.aborted=true;a.state=b.state='unloaded';
 assert.equal(f.state.hasFailures(),true,'hidden cancellation is not recovery');
 visibility='visible';assert.equal(f.state.hasFailures(),true,'showing precedes renderer demand');
 const nextA=tile(),nextB=tile(2);nextA.state='loaded';nextB.state='loading';f.setTiles([nextA,nextB]);
 f.state.noteSourceData({tile:nextA});assert.equal(f.state.hasFailures(),true,'remaining replacement request has not recovered');
 nextB.state='loaded';f.state.noteSourceData({tile:nextB});assert.equal(f.state.hasFailures(),false);
});
test('one visible source layer permits offscreen retirement and hidden metadata remains independent',()=>{
 const f=fixture({inventory:true}),a=tile();
 f.map.getStyle=()=>({layers:[{source:'test',layout:{visibility:'none'}},{source:'test',layout:{visibility:'visible'}}]});
 f.setTiles([a]);f.state.noteError({tile:a});f.setTiles([]);assert.equal(f.state.hasFailures(),false);
 f.state.noteError({});assert.equal(f.state.hasFailures(),true);
 f.state.noteSourceData({sourceDataType:'metadata'});assert.equal(f.state.hasFailures(),false);
});
