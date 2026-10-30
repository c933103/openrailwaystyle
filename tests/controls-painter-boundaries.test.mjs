import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {painterDecisionRun,emptyTileIsRenderable,close} from '../scripts/diagnose-controls-painter.mjs';
import {readSettings,MODES} from '../styles/map-model.mjs';
after(close);

function compare(options={}) {
 const original=painterDecisionRun(options),guarded=painterDecisionRun({...options,skipHiddenMasks:true});
 assert.deepEqual(original.violations,[],'original abstract stencil coverage');
 assert.deepEqual(guarded.violations,[],'guarded abstract stencil coverage');
 assert.deepEqual(guarded.paint,original.paint,'visible layer order and abstract clipped coverage preserved');
 assert.equal(guarded.hiddenDraws,0);
 return {original,guarded};
}

test('the actual pinned renderer considers a loaded empty tile renderable',()=>{
 assert.equal(emptyTileIsRenderable(),true);
});

test('exact Atlas style at failure-shaped zoom/source counts submits hidden stencil work',()=>{
 const {original,guarded}=compare();
 // Counts follow the composed style: the funicular cable, Infrastructure
 // rack and aerialway layers (hidden in the default view) add hidden work
 // only; the guarded, visible work stays 3168.
 assert.equal(original.draws,11264);
 assert.equal(original.hiddenDraws,8096,'sensitivity: unmodified renderer performs hidden-layer work');
 assert.equal(guarded.draws,3168);
 assert.ok(guarded.clears<original.clears);
});

const line=(id,source,extra={})=>({id,type:'line',source,'source-layer':'fixture',
 metadata:{'atlas:semantics-version':1,'atlas:runtime':true},...extra});

test('hidden sources between visible sources cannot corrupt retained stencil references',()=>{
 const {original,guarded}=compare({layerSpecs:[line('first','A'),line('hidden','B',{layout:{visibility:'none'}}),line('same','A'),line('other','C')],sourceCounts:{A:88,B:88,C:88}});
 assert.ok(original.hiddenDraws>0);
 assert.ok(guarded.clears>0,'covers stencil resets, not only a small no-clear example');
});

test('hidden-to-visible-to-hidden transitions repaint the newly visible source on the same painter',()=>{
 const {original,guarded}=compare({layerSpecs:[line('first','A'),line('toggle','B',{layout:{visibility:'none'}}),line('last','A')],sourceCounts:{A:88,B:88},visibilitySequence:[{}, {toggle:'visible'}, {toggle:'none'}, {toggle:'visible'}]});
 for(const frame of [0,2])assert.equal(guarded.paint.some(p=>p.frame===frame&&p.layer==='toggle'),false);
 for(const frame of [1,3])assert.ok(guarded.paint.some(p=>p.frame===frame&&p.layer==='toggle'));
 assert.ok(original.hiddenDraws>0);
 assert.equal(guarded.frames.length,4);
});

test('zoom-hidden layers follow the same guard as layout-hidden layers',()=>{
 for(const zoom of [7,8,9,10,11]) {
  const {original,guarded}=compare({zoom,layerSpecs:[line('first','A'),line('zoom-hidden','B',{minzoom:8,maxzoom:10}),line('last','A')],sourceCounts:{A:88,B:88}});
  if(zoom<8||zoom>=10){assert.ok(original.hiddenDraws>0);assert.ok(guarded.draws<original.draws);}
  else assert.equal(guarded.draws,original.draws);
 }
});

test('visible dispatch and abstract stencil acceptance remain equal across Atlas modes and zooms',()=>{
 for(const mode of MODES)for(const zoom of [7,9,14]) {
  const settings=readSettings(`?mode=${mode}&relief=0&inactive=0`);
  compare({zoom,settings});
 }
});

test('all-visible clipping work is unchanged',()=>{
 const {original,guarded}=compare({layerSpecs:[line('first','A'),line('second','B'),line('last','A')],sourceCounts:{A:88,B:88}});
 assert.equal(original.hiddenDraws,0);
 assert.equal(guarded.draws,original.draws);
 assert.deepEqual(guarded.frames,original.frames);
});
