import test from 'node:test';
import assert from 'node:assert/strict';
import {connectFlatLocation,paintFlatHeading} from '../styles/flat-location.mjs';

test('a watched fix carries only a finite, in-range movement heading and clears on stop',()=>{
  const listeners={}, fix=[], follow=[];
  const button={dataset:{},setAttribute(){},addEventListener(type,fn){listeners[type]=fn;}};
  let emit, cleared;
  const geolocation={watchPosition(cb){emit=cb;return 17;},clearWatch(id){cleared=id;}};
  connectFlatLocation({button,status:{},window:{addEventListener(){}},geolocation,
    showFix:value=>fix.push(value),followFix:value=>follow.push(value)});
  listeners.click();
  for(const heading of [0,90,359,null,undefined,NaN,Infinity,-1,360,'45'])
    emit({coords:{longitude:10,latitude:40,accuracy:10,heading}});
  assert.deepEqual(fix.map(x=>x.heading),[0,90,359,null,null,null,null,null,null,null]);
  assert.deepEqual(follow,fix);
  listeners.click();
  emit({coords:{longitude:10,latitude:40,accuracy:10,heading:90}});
  assert.equal(cleared,17);
  assert.equal(fix.at(-1),null);
  assert.equal(fix.length,11);
});

test('the Canvas arrow turns with the map bearing and disappears with no heading',()=>{
  const calls=[], ctx=new Proxy({}, {get:(_,name)=>(...args)=>calls.push([name,...args])});
  paintFlatHeading(ctx,22,32,null,0);
  assert.deepEqual(calls,[]);
  for(const [heading,bearing,radians] of [[0,0,0],[90,0,Math.PI/2],[90,90,0],[0,90,-Math.PI/2]]){
    calls.length=0;
    paintFlatHeading(ctx,22,32,heading,bearing);
    assert.deepEqual(calls,[['save'],['translate',22,32],['rotate',radians],
      ['beginPath'],['moveTo',0,-21],['lineTo',6,-10],['lineTo',-6,-10],
      ['closePath'],['fill'],['stroke'],['restore']]);
  }
});
