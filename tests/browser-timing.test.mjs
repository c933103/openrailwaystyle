import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installBrowserTiming,readBrowserTiming} from '../scripts/browser-timing.mjs';

function fixture({unsupported = false} = {}) {
  let time = 1000, callback, tick, queued = [], disconnected = 0, cleared = 0;
  const scope = {performance: {now: () => time},
    PerformanceObserver: class {
      constructor(fn) {callback = fn;}
      observe(options) {assert.deepEqual(options,{type:'longtask',buffered:false});if(unsupported)throw Error('unsupported');}
      takeRecords() {const result=queued;queued=[];return result;}
      disconnect() {disconnected++;}
    },
    setInterval(fn,ms) {assert.equal(ms,250);tick=fn;return 7;},
    clearInterval(id) {assert.equal(id,7);cleared++;},
  };
  const api=installBrowserTiming(scope);
  return {api,scope,advance(ms){time+=ms;},tick(){tick();},tasks(entries){callback({getEntries:()=>entries});},
    queue(entries){queued=entries;},counts:()=>({disconnected,cleared})};
}

test('observes task duration and heartbeat delay independently without recording page data',()=>{
  const f=fixture();f.advance(600);f.tick();
  f.tasks([{startTime:1100,duration:300,name:'secret URL',attribution:[{name:'private'}]}]);
  const state=f.api.snapshot();
  assert.equal(state.elapsed,600);assert.equal(state.longTasks.maxMs,300);assert.equal(state.heartbeat.maxMs,350);
  assert.equal(state.longTaskSupported,true);assert.equal(state.heartbeatSupported,true);
  assert.doesNotMatch(JSON.stringify(state),/secret|private|URL/);
});

test('phase resets exclude old observations and include queued current tasks',()=>{
  const f=fixture();f.queue([{startTime:1050,duration:60}]);f.advance(500);f.api.begin();
  f.tasks([{startTime:1100,duration:300},{startTime:1501,duration:75}]);
  f.queue([{startTime:1600,duration:80}]);f.advance(750);f.tick();
  const state=f.api.snapshot();assert.equal(state.longTasks.count,2);assert.equal(state.longTasks.totalMs,155);
  assert.equal(state.heartbeat.maxMs,500);assert.equal(f.api.snapshot().longTasks.count,2,'queued records read once');
});

test('repeated polls retain the whole settlement while a new settlement resets it',()=>{
  const f=fixture();f.api.begin(1);f.advance(700);f.tick();f.tasks([{startTime:1100,duration:400}]);
  f.api.begin(1);f.advance(900);f.tick();f.tasks([{startTime:1800,duration:500}]);
  const state=f.api.snapshot();assert.equal(state.elapsed,1600);assert.equal(state.longTasks.count,2);
  assert.equal(state.longTasks.totalMs,900);assert.equal(state.heartbeat.totalMs,1100);
  f.api.begin(2);assert.equal(f.api.snapshot().elapsed,0);assert.equal(f.api.snapshot().longTasks.count,0);
});

test('bounded copied records retain exact totals and reject invalid timing values',()=>{
  const f=fixture();for(let i=0;i<100;i++){f.advance(300);f.tick();f.tasks([{startTime:1000+i*300,duration:100}]);}
  f.tasks([{startTime:NaN,duration:20},{startTime:1000,duration:-1},{startTime:1000,duration:Infinity}]);
  const state=f.api.snapshot();assert.equal(state.longTasks.count,100);assert.equal(state.longTasks.totalMs,10000);
  assert.equal(state.longTasks.recent.length,64);assert.equal(state.longTasks.truncated,true);
  assert.equal(state.heartbeat.count,100);assert.equal(state.heartbeat.recent.length,64);
  state.longTasks.recent[0].duration=999;assert.equal(f.api.snapshot().longTasks.recent[0].duration,100);
});

test('unsupported observations remain explicit and disposal stops both sources',()=>{
  const f=fixture({unsupported:true});assert.equal(f.api.snapshot().longTaskSupported,false);
  assert.equal(f.api.snapshot().heartbeatSupported,true);f.api.dispose();f.api.dispose();f.advance(500);f.tick();
  assert.equal(f.api.snapshot().heartbeat.count,0);assert.deepEqual(f.counts(),{disconnected:1,cleared:1});
  const g=fixture();g.api.dispose();g.tasks([{startTime:1000,duration:100}]);assert.equal(g.api.snapshot().longTasks.count,0);
  assert.deepEqual(g.counts(),{disconnected:1,cleared:1});
});

test('diagnostic reads succeed, fail closed and time out without becoming an acceptance gate',async()=>{
  assert.deepEqual(await readBrowserTiming({evaluate:async()=>({elapsed:42})}),{elapsed:42});
  assert.deepEqual(await readBrowserTiming({evaluate:()=>{throw Error('secret');}}),{unavailable:true});
  assert.deepEqual(await readBrowserTiming({evaluate:()=>new Promise(()=>{})},10),{unavailable:true,timeout:10});
});

test('controls record diagnostics per settlement without changing the idle gate',async()=>{
  const source=await readFile(new URL('../scripts/check-map-controls-browser.mjs',import.meta.url),'utf8');
  assert.match(source,/page\.addInitScript\(installBrowserTiming\)/);
  assert.match(source,/timing:await readBrowserTiming\(page\)/);
  assert.match(source,/phase=\+\+settlementPhase/);
  assert.match(source,/__atlasControlsTiming\?\.begin\(phase\)/);
  assert.doesNotMatch(source,/await page\.evaluate\([^;]*begin/);
  assert.match(source,/map\.once\('idle',\(\)=>resolve\(\)\);map\.triggerRepaint\(\)/);
  assert.match(source,/\},phase,\{timeout:60000\}\)/);
  const helper=await readFile(new URL('../scripts/browser-timing.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(helper,/requestAnimationFrame|triggerRepaint|setData|setTiles|fetch\(/);
});
