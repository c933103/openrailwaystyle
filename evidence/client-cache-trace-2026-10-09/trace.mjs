import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import os from 'node:os';
import {chromium} from 'playwright';
import {serveFixture,fixtureLine,sha256} from './fixture-server.mjs';
const DIR=resolve(process.env.OUT||'evidence');await mkdir(DIR,{recursive:true});
const fixture=await serveFixture(),{origins,requests,denied,unknown,relocations,served}=fixture;
const app={origin:fixture.app},proxy={origin:fixture.proxy};
const args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist',`--proxy-server=${proxy.origin}`,'--proxy-bypass-list=127.0.0.1;localhost','--disable-background-networking'];
const executablePath=process.env.CHROMIUM_EXECUTABLE||chromium.executablePath();
const launch=()=>chromium.launch({executablePath,headless:true,args});
const options={viewport:{width:1280,height:800},deviceScaleFactor:1,isMobile:false,hasTouch:false,serviceWorkers:'block',locale:'en-US',timezoneId:'UTC'};
const elapsed=()=>new Date().toISOString();
const reverse=url=>fixture.normalizeUrl(url);
let browser,browserVersion;
const results=[];
async function control(){
 fixture.state.sample='control';fixture.state.phase='cache-controls';browser=await launch();browserVersion=browser.version();const context=await browser.newContext(options),page=await context.newPage();await page.goto(app.origin+'/__controls/page');
 for(const name of ['cached','revalidate'])for(let n=0;n<2;n++)assert.equal(await page.evaluate(async url=>await(await fetch(url)).text(),app.origin+'/__controls/'+name),'cache-transport-proof-v1');
 const blocked=await page.evaluate(async()=>{try{await fetch('https://cache-control-proof.invalid/');return false;}catch{return true;}});assert.equal(blocked,true);
 assert.equal(requests.filter(r=>r.path==='/__controls/cached').length,1,'HTTP memory/disk cache must prevent second wire request');
 const rv=requests.filter(r=>r.path==='/__controls/revalidate');assert.equal(rv.length,2);assert.equal(rv[1].status,304,'stale cached response must revalidate using ETag');
 assert.equal(blocked,true,'external connect must be blocked by CSP and/or deny proxy');
 await context.close();await browser.close();browser=null;
 await writeFile(DIR+'/transport-controls.json',JSON.stringify({passed:true,requests:requests.filter(r=>r.sample==='control'),denied:denied.filter(r=>r.sample==='control'),routeInterception:false},null,2)+'\n');
}
function init(){
 window.__trace={raf:[],longTasks:[],ready:null,marks:[]};const t=window.__trace;let last;
 function tick(at){if(last!==undefined)t.raf.push({at,gap:at-last});last=at;requestAnimationFrame(tick);}requestAnimationFrame(tick);
 new PerformanceObserver(list=>{for(const e of list.getEntries())t.longTasks.push({start:e.startTime,duration:e.duration,name:e.name});}).observe({type:'longtask',buffered:true});
 new MutationObserver(()=>{if(t.ready===null&&document.body?.dataset.mapReady==='true')t.ready=performance.now();}).observe(document,{subtree:true,attributes:true,attributeFilter:['data-map-ready']});
}
async function run(context,bc,id,cacheState){
 fixture.state.sample=id;fixture.state.phase='startup';fixture.state.epoch=0;
 const page=await context.newPage(),cdp=await context.newCDPSession(page),network=[],pageErrors=[],consoleErrors=[],heap=[],traces=[];
 const out={id,cacheState,started:elapsed(),phases:[],network,pageErrors,consoleErrors,heap,sourceCommit:'2875a0744912633f35cd6faba25e3260dae09d89'};results.push(out);
 page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 await page.addInitScript(init);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:false});await cdp.send('Performance.enable',{timeDomain:'threadTicks'});await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
 for(const event of ['requestWillBeSent','responseReceived','dataReceived','loadingFinished','loadingFailed','requestServedFromCache','responseReceivedExtraInfo'])cdp.on('Network.'+event,e=>{
  const v={event,phase:fixture.state.phase,epoch:fixture.state.epoch,observedMs:performance.now(),...e};
  if(v.request){v.request={url:reverse(v.request.url),method:v.request.method,initialPriority:v.request.initialPriority,referrerPolicy:v.request.referrerPolicy};}
  if(v.response){v.response={url:reverse(v.response.url),status:v.response.status,mimeType:v.response.mimeType,encodedDataLength:v.response.encodedDataLength,fromDiskCache:v.response.fromDiskCache,fromServiceWorker:v.response.fromServiceWorker,fromPrefetchCache:v.response.fromPrefetchCache,protocol:v.response.protocol,timing:v.response.timing,headers:v.response.headers};}
  if(v.headers){v.headers=Object.fromEntries(Object.entries(v.headers).filter(([k])=>/cache|etag|length|type|range/i.test(k)));delete v.headersText;delete v.blockedCookies;delete v.cookiePartitionKey;delete v.exemptedCookies;}
  network.push(v);
 });
 const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(r=>[r.name,r.value]));
 const processes=async()=>(await bc.send('SystemInfo.getProcessInfo')).processInfo;
 let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{const m=await metrics();heap.push({phase:fixture.state.phase,atMs:performance.now(),JSHeapUsedSize:m.JSHeapUsedSize,JSHeapTotalSize:m.JSHeapTotalSize,Nodes:m.Nodes});}catch{}finally{busy=false;}},100);
 cdp.on('Tracing.dataCollected',e=>traces.push(...e.value));await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,v8',options:'record-as-much-as-possible',transferMode:'ReportEvents'});
 const snapshot=async()=>({hostMs:performance.now(),pageClock:await page.evaluate(()=>({now:performance.now(),timeOrigin:performance.timeOrigin})),metrics:await metrics(),processes:await processes(),loadavg:os.loadavg()});
 async function begin(name){fixture.state.phase=name;const b=await snapshot();await cdp.send('Profiler.start');return b;}
 async function end(name,b,value){const prof=(await cdp.send('Profiler.stop')).profile,e=await snapshot();const row={name,start:b,end:e,value};out.phases.push(row);await writeFile(DIR+`/${id}-${name}-cpu.json.gz`,gzipSync(Buffer.from(JSON.stringify(prof))));return row;}
 try{
  const b=await begin('startup');await page.goto(app.origin+'/atlas-project/?mode=infrastructure&language=en&relief=0&inactive=0&transport=0&destinations=0&constraints=0#14/30.58/114.35',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForSelector('body[data-map-ready="true"]',{timeout:90000});
  await page.evaluate(async()=>{window.fixtureMap=(await import(document.querySelector('script[type="module"]').src)).map;});
  await page.waitForFunction(()=>window.fixtureMap.loaded()&&window.fixtureMap.areTilesLoaded()&&window.fixtureMap.queryRenderedFeatures().some(f=>f.properties.id==='fixture-wuhan-mainline'),null,{timeout:60000});
  const ready=await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {usableAt:performance.now(),mapReadyAt:window.__trace.ready,featureCount:window.fixtureMap.queryRenderedFeatures().filter(f=>f.properties.id==='fixture-wuhan-mainline').length,loaded:window.fixtureMap.loaded(),tilesLoaded:window.fixtureMap.areTilesLoaded(),center:window.fixtureMap.getCenter(),zoom:window.fixtureMap.getZoom(),ua:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,renderer:(()=>{const gl=window.fixtureMap.getCanvas().getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null;})()};});
  await end('startup',b,ready);
  for(const [name,delta]of [['first-pan',512],['reset',-512],['cached-pan',512]]){
   const b=await begin(name);fixture.state.epoch++;
   const value=await page.evaluate(delta=>new Promise((resolve,reject)=>{const map=window.fixtureMap,start=performance.now();window.__trace.marks.push({name:'pan-start',delta,at:start});const timer=setTimeout(()=>reject(Error('Pan idle timeout')),30000);map.once('idle',()=>{clearTimeout(timer);const end=performance.now();window.__trace.marks.push({name:'pan-idle',delta,at:end});resolve({start,end,duration:end-start,center:map.getCenter(),zoom:map.getZoom(),loaded:map.loaded(),tilesLoaded:map.areTilesLoaded()});});map.panBy([delta,0],{duration:0});}),delta);
   await end(name,b,value);
  }
  fixture.state.phase='retention';await cdp.send('HeapProfiler.collectGarbage');out.retainedAfterGC=await metrics();out.performance=await page.evaluate(()=>({trace:window.__trace,navigation:performance.getEntriesByType('navigation').map(e=>e.toJSON()),resources:performance.getEntriesByType('resource').map(e=>e.toJSON()),storage:{localStorageKeys:Object.keys(localStorage),serviceWorkerController:!!navigator.serviceWorker?.controller}}));
  out.requestsAtEnd=network.filter(e=>e.event==='requestWillBeSent').length;
  await page.screenshot({path:DIR+`/${id}.png`});
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
  assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors,[]);
 }catch(e){out.failed=e.message;throw e;}
 finally{
  clearInterval(timer);const finished=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');await finished;
  await writeFile(DIR+`/${id}-timeline.json.gz`,gzipSync(Buffer.from(JSON.stringify({traceEvents:traces}))));out.finished=elapsed();await writeFile(DIR+`/${id}.json`,JSON.stringify(out,null,2)+'\n');await page.close();
 }
 console.log(JSON.stringify({id,ready:out.phases[0].value,phases:out.phases.map(p=>({name:p.name,duration:p.value?.duration,taskCpu:p.end.metrics.TaskDuration-p.start.metrics.TaskDuration})),networkStarts:out.requestsAtEnd,retained:out.retainedAfterGC.JSHeapUsedSize}));
}
try{
 await control();
 for(let pair=1;pair<=Number(process.env.PAIRS||3);pair++){
  browser=await launch();const bc=await browser.newBrowserCDPSession();const context=await browser.newContext(options);
  await run(context,bc,`p${pair}-cold`,'fresh browser process, new context, new page, empty HTTP/app cache; OS cache not flushed');
  await run(context,bc,`p${pair}-warm`,'same browser/context, new page after prior page closed; HTTP cache retained and enabled, app storage cleared; OS cache not flushed');
  await context.close();await browser.close();browser=null;
 }
 assert.deepEqual(unknown,[]);
}finally{
 await browser?.close();
 const env={created:elapsed(),browserVersion,node:process.version,chromiumExecutable:executablePath,chromiumExecutableSha256:sha256(await readFile(executablePath)),playwrightVersion:JSON.parse(await readFile('node_modules/playwright/package.json')).version,platform:os.platform(),arch:os.arch(),release:os.release(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemory:os.totalmem(),loadavg:os.loadavg(),options,args,origins,network:'Loopback HTTP/1.1, no network/CPU throttle, Cache-Control max-age=3600 for synthetic data/assets. No live provider connection. Each original provider origin mapped to a separate loopback port. No Playwright route or CDP Fetch interception.',fixture:fixtureLine};
 await writeFile(DIR+'/environment.json',JSON.stringify(env,null,2)+'\n');
 await writeFile(DIR+'/server-ledger.json',JSON.stringify(requests,null,2)+'\n');await writeFile(DIR+'/external-deny-ledger.json',JSON.stringify(denied,null,2)+'\n');await writeFile(DIR+'/relocations.json',JSON.stringify([...relocations.values()],null,2)+'\n');await writeFile(DIR+'/served-manifest.json',JSON.stringify([...served.values()],null,2)+'\n');
 await fixture.close();
}
