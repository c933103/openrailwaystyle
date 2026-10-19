import test from 'node:test';
import assert from 'node:assert/strict';
import {isRetryableProviderError, createMetadataRetries} from '../styles/provider-retry.mjs';

const permanent = [300, 301, 400, 401, 403, 404, 405, 410, 416, 422, 451];
const transient = [408, 429, 500, 502, 503, 504, 520, 599];
test('provider status classification survives PMTiles and MapLibre error serialization', () => {
  for (const status of [...permanent, ...transient]) {
    for (const error of [{status}, {status:String(status)}, new Error(`Bad response code: ${status}`),
      new Error(`Map names returned ${status}`), {message:`AJAXError: ${status} (failure)`}, new Error(`HTTP ${status}`)]) {
      assert.equal(isRetryableProviderError(error), transient.includes(status), JSON.stringify(error));
    }
  }
  for (const error of [new TypeError('Failed to fetch'), new Error('NetworkError when attempting to fetch resource'),
    new DOMException('request timed out', 'TimeoutError'), {message:'net::ERR_CONNECTION_RESET'}]) assert.equal(isRetryableProviderError(error), true);
  for (const error of [new DOMException('Aborted', 'AbortError'), new SyntaxError('bad JSON'), new Error('Wrong magic number for PMTiles archive'),
    new Error('Maximum directory depth exceeded'), new Error('Server returned non-matching ETag after one retry.'), new Error('unclassified error'),
    {status:403,message:'AJAXError: failed to fetch'}, {status:503,name:'AbortError'}]) assert.equal(isRetryableProviderError(error), false);
});

function fixture() {
  let next = 0;
  const timers = new Map(), reloads = [], sources = {other:{url:'https://metadata.test/tiles.json', setUrl(url) { reloads.push(url); }}};
  const retry = createMetadataRetries({getSource:id=>sources[id]}, {provider:'https://openrailwaymap.app',
    setTimer:(fn,delay)=>{timers.set(++next,{fn,delay});return next;}, clearTimer:id=>timers.delete(id)});
  const fail = (error, extra={}) => retry.noteError({sourceId:'other', error, ...extra});
  const tick = () => {const [id, timer] = timers.entries().next().value;timers.delete(id);timer.fn();return timer.delay;};
  return {timers,reloads,sources,retry,fail,tick};
}
test('other metadata gets three reloads without duplicate-event amplification', () => {
  const f=fixture();
  for (const delay of [5000,15000,45000]) {
    f.fail({status:503});f.fail({status:503});assert.equal(f.timers.size,1);assert.equal(f.tick(),delay);
  }
  f.fail({status:503});assert.equal(f.timers.size,0);assert.equal(f.reloads.length,3);
  f.retry.clear('other');f.fail({status:503});assert.equal(f.timers.size,1,'success resets the bounded budget');f.retry.dispose();
});
test('permanent errors cancel a pending metadata retry and preserve no timer', () => {
  for (const status of permanent) {
    const f=fixture();f.fail({status:503});const stale=[...f.timers.values()][0].fn;
    f.fail({status});assert.equal(f.timers.size,0);stale();assert.deepEqual(f.reloads,[]);
  }
  const f=fixture();f.fail({status:503});f.fail(new DOMException('Aborted','AbortError'));assert.equal(f.timers.size,0);
});
test('stale metadata callbacks cannot reload replacement URLs, source instances or a removed map', () => {
  for (const replace of [f=>{f.sources.other={...f.sources.other};},f=>{f.sources.other.url+='?new';},f=>{delete f.sources.other;},
    f=>{f.retry.clear('other');},f=>{f.retry.dispose();}]) {
    const f=fixture();f.fail({status:503});const stale=[...f.timers.values()][0].fn;replace(f);stale();assert.deepEqual(f.reloads,[]);
  }
});
test('tile errors and protocols with their own recovery do not create outer metadata retries', () => {
  for (const url of ['atlasbase://en/https://basemap.test/planet.pmtiles','atlasrail://https://openrailwaymap.app/railway_line_high']) {
    const f=fixture();f.sources.other.url=url;f.fail({status:503});assert.equal(f.timers.size,0);
  }
  for (const extra of [{tile:{}},{coord:{}}]) {const f=fixture();f.fail({status:503},extra);assert.equal(f.timers.size,0);}
});

test('MapLibre loaded-after-failure is not confused with metadata success',()=>{
  const f=fixture();f.sources.other.loaded=()=>true;f.fail({status:503});f.tick();assert.equal(f.reloads.length,1);
  f.fail({status:503});f.retry.clear('other');assert.equal(f.timers.size,0);
});

test('late errors retire excluded or removed metadata sources before an ABA restoration',()=>{
  for(const replace of [f=>{delete f.sources.other;},f=>{f.sources.other.url='atlasbase://en/https://basemap.test/planet.pmtiles';},
    f=>{f.sources.other.url='atlasrail://https://openrailwaymap.app/railway_line_high';},f=>{f.sources.other.setUrl=undefined;},
    f=>{f.sources.other={url:f.sources.other.url};}]) {
    const f=fixture(),source=f.sources.other,url=source.url,setUrl=source.setUrl;
    f.fail({status:503});const stale=[...f.timers.values()][0].fn;
    replace(f);f.fail({status:503});assert.equal(f.timers.size,0,'late event retires obsolete timer immediately');
    f.sources.other=source;source.url=url;source.setUrl=setUrl;stale();assert.deepEqual(f.reloads,[],'restoring earlier URL/source does not revive old failure');
  }
});
