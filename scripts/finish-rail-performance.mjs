// One-shot integration companion, removed after all checks pass.
import {readFile, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
let names = await readFile('tests/names.test.mjs', 'utf8');
const begin = names.indexOf("test('each request waiting on a shared download has its own time limit; a stuck download is not joined'");
const end = names.indexOf("test('a station tile that times out or fails is tried once more;", begin);
assert.ok(begin >= 0 && end > begin, 'original shared timeout regression must exist');
names = names.slice(0, begin) + `test('a shared stalled transport has one deadline and every reader can start afresh after it expires',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const protocols={},fetches=[],flush=()=>new Promise(resolve=>setImmediate(resolve));
  const adapters=installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{},(url,{signal})=>new Promise((resolve,reject)=>{
    fetches.push({signal,finish:()=>resolve({ok:true,arrayBuffer:async()=>Uint8Array.from(tile({name:'Track',tracks:2})).buffer})});
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  }),{timeout:300,tileRetries:[]});
  t.after(()=>adapters.dispose());
  const request={url:'atlasrail://https://example.org/railway/14/10/10'};
  const first=assert.rejects(protocols.atlasrail(request,new AbortController()),{name:'TimeoutError'});
  await flush();t.mock.timers.tick(100);await flush();
  // Attach the rejection handler at creation: all readers share the transport
  // deadline, rather than keeping a stalled download alive for late arrivals.
  const second=assert.rejects(protocols.atlasrail(request,new AbortController()),{name:'TimeoutError'});
  await flush();assert.equal(fetches.length,1,'concurrent readers still share one transport');
  t.mock.timers.tick(200);await flush();await Promise.all([first,second]);
  assert.equal(fetches[0].signal.aborted,true,'the stalled transport releases its network slot');
  const third=protocols.atlasrail(request,new AbortController());
  await flush();assert.equal(fetches.length,2,'a new reader cannot join the expired transport');
  fetches[0].finish();fetches[1].finish();
  assert.equal(readTile((await third).data).layers.stations.feature(0).properties.tracks,2);
  assert.equal(readTile((await protocols.atlasrail(request,new AbortController())).data).layers.stations.feature(0).properties.tracks,2);
  assert.equal(fetches.length,2,'the recovered bytes are cached, not the expired response');
});
` + names.slice(end);
await writeFile('tests/names.test.mjs', names);
let tracks = await readFile('tests/track-work.test.mjs', 'utf8');
const at = tracks.indexOf("test('last cancelled tile aborts its 27 downloads while another shared consumer keeps them alive'");
assert.ok(at >= 0, 'original track download cancellation regression must exist');
tracks = tracks.slice(0, at) + `test('last cancelled count aborts its four active downloads and discards 23 queued tiles, but one reader keeps all work alive',async()=>{
 const protocols={},previous=globalThis.Worker;let calls=0,aborted=0,adapters;
 const a=new AbortController(),b=new AbortController();
 globalThis.Worker=class {constructor(){throw new Error('cancelled downloads must not create a worker');}};
 try{
  adapters=installLabelProtocols({addProtocol:(n,f)=>protocols[n]=f},{},async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(new DOMException('Aborted','AbortError'));},{once:true}));});
  const url='atlastracks://14/8192/8192';
  const first=protocols.atlastracks({url},{signal:a.signal}),second=protocols.atlastracks({url},{signal:b.signal});
  const outcomes=Promise.allSettled([first,second]);
  await tick();assert.equal(calls,4,'the provider receives four requests, not a burst of 27');
  assert.equal(adapters.requestStats().queued,23,'the other 23 inputs are retained, not dropped');
  a.abort();await tick();assert.equal(aborted,0,'one remaining consumer keeps the work alive');
  assert.equal(adapters.requestStats().queued,23);
  b.abort();const settled=await outcomes;await tick();
  assert.ok(settled.every(outcome=>outcome.status==='rejected'&&outcome.reason.name==='AbortError'));
  assert.equal(aborted,4);assert.equal(calls,4,'cancelled queued inputs never reach the provider');
  assert.equal(adapters.requestStats().queued,0);assert.equal(adapters.requestStats().active,0);
 }finally{a.abort();b.abort();adapters?.dispose();globalThis.Worker=previous;}
});
`;
await writeFile('tests/track-work.test.mjs', tracks);
let rendering = await readFile('docs/rendering.md', 'utf8');
const old = rendering.indexOf('When an OpenRailwayMap metadata or railway-tile request fails,');
const next = rendering.indexOf('\n## Speed and units', old);
assert.ok(old >= 0 && next > old, 'previous recovery documentation must exist');
rendering = rendering.slice(0, old) + `Known OpenRailwayMap XYZ source metadata is resolved locally, so hidden views
no longer need their own external TileJSON request. Actual tile errors are not
converted to empty success. The shared request pool limits transfers to six
concurrent requests overall and four per origin, shares same-URL work, cancels
obsolete queued tiles and gives visible geometry priority over derived counts.
Timeouts apply to the transport, starting only when it gets a network slot;
late readers cannot keep a stalled transport running indefinitely. Underzoom
station children load concurrently through the same bounds. See
[loading investigation](investigations/rail-loading-20261007.md).

Failed visible tiles are retried at their own coordinates with capped backoff
(5, 15, 45, 120, then 300 seconds), without discarding healthy tiles or polling
a separate metadata endpoint. A settled source is not proof of success:
recovery requires the particular tile to load. Hidden/offline tabs pause,
and obsolete source/view failures are discarded. Genuine metadata failures
still reload their source metadata. Access errors such as HTTP 403/404 are
not treated as transient outages.

Major railway strokes remain a full CSS pixel at the world scale, including
negative camera zoom. The renderer already clamps negative camera zoom to
zoom-0 tiles; the regression checks actual geometry at -0.1, 0 and 0.1 in
both projections and every rail view. These changes neither remove More
detail nor supply an independent worldwide fallback during a provider outage.
` + rendering.slice(next);
await writeFile('docs/rendering.md', rendering);
let worker = await readFile('styles/sw.js','utf8');
worker = worker.replace('Shell 15 includes railway recovery', 'Shell 16 includes bounded railway loading');
await writeFile('styles/sw.js',worker);
console.log('Updated transport deadline, 4-active/23-queued cancellation regressions and recovery documentation.');
