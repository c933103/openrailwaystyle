import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {profileHarness} from './helpers/profile-ui-harness.mjs';

const app = await readFile(new URL('../styles/app.mjs', import.meta.url),'utf8');
const control = (begin, stop) => {
  const start=app.indexOf(begin);
  assert.ok(start>=0,`Missing production control: ${begin}`);
  const finish=app.indexOf(stop,start);
  assert.ok(finish>start,`Missing production control end: ${stop}`);
  return app.slice(start,finish+stop.length);
};
test('actual openTools selects distance by default on every opening, without activating drawing', () => {
  const dom=new JSDOM('<div id="draw-toolbar" hidden></div><div id="measure-toolbar" hidden></div>');
  try{
    const $=id=>dom.window.document.getElementById(id), visited=[];
    const make=()=>({mode:null,get active(){return this.mode!==null;},setMode(mode){
      this.mode=this.mode===mode?null:mode;visited.push(this.mode);
    }});
    const measuring=make(),drawing=make();
    const context=vm.createContext({$,drawing,measuring,updateDrawing(){}});
    vm.runInContext(control('function openTools(id) {','\n}'),context);
    context.openTools('measure-toolbar');
    assert.equal(measuring.mode,'distance');assert.equal($('measure-toolbar').hidden,false);
    assert.equal(drawing.mode,null);
    context.openTools('measure-toolbar');
    assert.equal(measuring.mode,null);assert.equal($('measure-toolbar').hidden,true);
    context.openTools('measure-toolbar');
    assert.equal(measuring.mode,'distance');
    context.openTools('draw-toolbar');
    assert.equal(measuring.mode,null);
    assert.equal($('draw-toolbar').hidden,false);
    assert.ok(visited.includes('distance'));
  }finally{dom.window.close();}
});

test('actual graph button submits fitted/straight profile coordinates to common renderer', () => {
  const dom=new JSDOM('<button id="measure-profile"></button>');
  try{
    const $=id=>dom.window.document.getElementById(id), seen=[];
    const measuring={mode:'radius',profileCoordinates:()=>[[0,0],[1,2],[2,0]]};
    const context=vm.createContext({$,measuring,showProfile:(feature,options)=>{seen.push({feature,options});return Promise.resolve();}});
    vm.runInContext(control("$('measure-profile').addEventListener('click', () => {",'\n});'),context);
    $('measure-profile').click();
    assert.equal(seen.length,1);
    assert.equal(seen[0].feature.geometry.type,'LineString');
    assert.deepEqual(JSON.parse(JSON.stringify(seen[0].feature.geometry.coordinates)),[[0,0],[1,2],[2,0]]);
    assert.equal(seen[0].options.measured,true);
    assert.match(seen[0].feature.properties.name,/Curve radius/);
    measuring.mode='distance';
    $('measure-profile').click();
    assert.match(seen[1].feature.properties.name,/Distance/);
    measuring.profileCoordinates=()=>null;
    $('measure-profile').click();assert.equal(seen.length,2,'no chart without a measured path');
  }finally{dom.window.close();}
});

test('actual reusable SVG elevation chart labels measured profiles and replaces its samples', async () => {
  const h=profileHarness({heights:points=>points.map((_,i)=>i*10-100)});
  try{
    await h.context.showProfile({properties:{name:'Measured track corridor'},geometry:{type:'LineString',coordinates:[[139.6,35.7],[139.62,35.7]]}},{measured:true});
    assert.match(h.content().textContent,/MEASUREMENT/);
    assert.match(h.content().textContent,/Measured track corridor/);
    assert.equal(h.content().querySelectorAll('svg.profile-chart').length,1);
    assert.match(h.content().textContent,/seabed elevations/);
    assert.match(h.content().textContent,/not rail-track heights/);
    assert.equal(vm.runInContext('profileFromMeasure',h.context),true);
    h.context.cancelProfile();
    assert.equal(vm.runInContext('profileFromMeasure',h.context),false);
  }finally{h.close();}
});
