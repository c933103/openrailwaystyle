import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installWatchGesture} from '../styles/watch-map.mjs';
import {readSettings,settingsQuery} from '../styles/map-model.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('watch is explicit, persistent and shareable without changing map defaults',()=>{
  const normal=readSettings(''),watch=readSettings('?ui=watch');
  assert.deepEqual({...watch,ui:'standard'},normal);
  assert.equal(readSettings('?'+settingsQuery(watch)).ui,'watch');
  assert.equal(readSettings('',{ui:'watch'}).ui,'watch');
  assert.equal(readSettings('?ui=standard',{ui:'watch'}).ui,'standard');
});
test('long press opens controls while drags, pinches, releases and ordinary layouts keep map gestures',async()=>{
  const dom=new JSDOM('<div id="map" tabindex="0"></div>'),surface=dom.window.document.getElementById('map');
  let active=true,opens=0;
  const gesture=installWatchGesture(surface,{active:()=>active,open:()=>opens++,delay:20});
  const send=(name,id=1,x=50)=>{const e=new dom.window.Event(name,{cancelable:true,bubbles:true});Object.assign(e,{pointerId:id,clientX:x,clientY:50,button:0});surface.dispatchEvent(e);assert.equal(e.defaultPrevented,false,'pointer gestures are never intercepted');};
  try {
    send('pointerdown');await wait(35);assert.equal(opens,1);send('pointerup');
    send('pointerdown');send('pointermove',1,65);await wait(35);assert.equal(opens,1,'a drag cancels the hold');
    send('pointerdown',2);send('pointermove',1,80);await wait(35);assert.equal(opens,1,'adding a stationary second finger after a pan never starts a new hold');
    send('pointerup',1);send('pointerup',2);
    send('pointerdown');send('pointerdown',2);await wait(35);assert.equal(opens,1,'pinch gestures cancel the hold');send('pointerup',1);send('pointerup',2);
    send('pointerdown');send('pointerup');await wait(35);assert.equal(opens,1,'taps leave the map unobstructed');
    send('pointerdown');dom.window.dispatchEvent(new dom.window.Event('blur'));await wait(35);assert.equal(opens,1);
    active=false;send('pointerdown');await wait(35);assert.equal(opens,1,'standard UI has no watch hold action');
    active=true;surface.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'F10',shiftKey:true}));assert.equal(opens,2);
  } finally {gesture.destroy();dom.window.close();}
});
