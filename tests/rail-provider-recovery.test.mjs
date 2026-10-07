import test from 'node:test';
import assert from 'node:assert/strict';
import {createRailProviderRecovery, isRetryableRailError} from '../styles/rail-provider-recovery.mjs';

function clock() {
  let id = 0;
  const timers = new Map();
  return {
    setTimer: (callback, delay) => {timers.set(++id,{callback,delay});return id;},
    clearTimer: key => timers.delete(key),
    size: () => timers.size,
    delay: () => [...timers.values()][0]?.delay,
    async next() {
      const [key, pending] = timers.entries().next().value;
      timers.delete(key);
      await pending.callback();
    },
  };
}
function source(url='atlasrail://https://openrailwaymap.app/railway_line_high') {
  return {url,reloads:0,setUrl(value){assert.equal(value,this.url);this.reloads++;}};
}
function fixture(fetcher, extra={}) {
  const timers=clock();
  const sources={railway:source(),ownerRail:source('atlasowner://https://openrailwaymap.app/railway_line_high'),
    basemap:source('https://tuiles.enliberte.fr/planet.pmtiles')};
  const map={getSource:id=>sources[id]};
  const recovery=createRailProviderRecovery(map,{fetcher,...timers,...extra});
  return {timers,sources,recovery};
}
const unavailable={ok:false,status:520};
const ready={ok:true,json:async()=>({tiles:['https://openrailwaymap.app/railway_line_high/{z}/{x}/{y}']})};

test('fetch and HTTP 520 source errors recover through one shared probe and reload only failed sources',async()=>{
  let probes=0;
  const {timers,sources,recovery}=fixture(async()=>++probes===1?unavailable:ready);
  assert.equal(recovery.noteError({sourceId:'railway',error:new Error('Failed to fetch')}),true);
  assert.equal(recovery.noteError({sourceId:'ownerRail',error:new Error('Map names returned 520')}),true);
  assert.equal(timers.size(),1,'one provider probe, not one per source');
  assert.equal(timers.delay(),5000);
  await timers.next();
  assert.equal(probes,1);assert.equal(timers.delay(),15000);
  assert.equal(sources.railway.reloads,0,'no successful empty tile substitutes for an outage');
  await timers.next();
  assert.equal(probes,2);assert.equal(sources.railway.reloads,1);assert.equal(sources.ownerRail.reloads,1);
  assert.equal(sources.basemap.reloads,0);
  assert.equal(recovery.hasFailures(),true,'a healthy probe is not yet proof of tile recovery');
  assert.equal(recovery.noteSourceData({sourceId:'railway',isSourceLoaded:true}),true);
  assert.equal(recovery.hasFailures(),true);
  assert.equal(recovery.noteSourceData({sourceId:'ownerRail',isSourceLoaded:true}),true);
  assert.equal(recovery.hasFailures(),false);assert.equal(timers.size(),0);
  recovery.dispose();
});

test('tile failures retry even when metadata loaded; a fresh failure restarts the recovery claim',async()=>{
  const {timers,sources,recovery}=fixture(async()=>ready);
  assert.equal(recovery.noteError({sourceId:'railway',tile:{},error:new Error('Railway tile returned 503')}),true);
  assert.equal(recovery.noteSourceData({sourceId:'railway',isSourceLoaded:true}),false,'old successful events do not dismiss a pending error');
  await timers.next();
  assert.equal(sources.railway.reloads,1);
  recovery.noteError({sourceId:'railway',tile:{},error:new Error('Railway tile returned 503')});
  assert.equal(recovery.noteSourceData({sourceId:'railway',isSourceLoaded:true}),false,'new failure invalidates an in-progress refresh');
  assert.equal(timers.delay(),15000);
  await timers.next();
  assert.equal(sources.railway.reloads,2);
  recovery.noteSourceData({sourceId:'railway',isSourceLoaded:true});
  assert.equal(recovery.hasFailures(),false);
  recovery.dispose();
});

test('non-provider and permanent errors do not trigger network probes',()=>{
  const {timers,recovery}=fixture(async()=>{throw new Error('must not probe');});
  assert.equal(recovery.noteError({sourceId:'basemap',error:new Error('Failed to fetch')}),false);
  for(const text of ['Map names returned 403','Map names returned 404','expression invalid','unknown source'])
    assert.equal(recovery.noteError({sourceId:'railway',error:new Error(text)}),false,text);
  assert.equal(timers.size(),0);
  assert.equal(isRetryableRailError(new Error('Map names returned 520')),true);
  assert.equal(isRetryableRailError(new Error('net::ERR_ABORTED')),false,'normal map panning does not start provider health checks');
  recovery.dispose();
});

test('invalid metadata never declares recovery; repeated failures use capped backoff',async()=>{
  const {timers,sources,recovery}=fixture(async()=>({ok:true,json:async()=>({tiles:[]})}));
  recovery.noteError({sourceId:'railway',error:new Error('Failed to fetch')});
  for(const delay of [5000,15000,45000,120000,300000,300000]){
    assert.equal(timers.delay(),delay);
    await timers.next();
    assert.equal(sources.railway.reloads,0);
  }
  recovery.dispose();assert.equal(timers.size(),0);
});

test('inactive tabs do not poll, resume once visible/online, and dispose cancels pending probes',async()=>{
  let active=false, fetches=0;
  const {timers,recovery}=fixture(async()=>{fetches++;return ready;},{active:()=>active});
  recovery.noteError({sourceId:'railway',error:new Error('Failed to fetch')});
  assert.equal(timers.size(),0);
  active=true;recovery.wake();assert.equal(timers.size(),1);
  active=false;await timers.next();
  assert.equal(fetches,0);assert.equal(timers.size(),0);
  active=true;recovery.wake();assert.equal(timers.delay(),5000);
  recovery.dispose();assert.equal(timers.size(),0);
  recovery.wake();assert.equal(timers.size(),0);
});
