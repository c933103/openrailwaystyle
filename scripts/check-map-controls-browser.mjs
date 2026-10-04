// Fast, repeatable UI integration checks: actual app, MapLibre, CSS and DOM;
// empty provider responses isolate layout/state from live tile availability.
// The existing live WebGL suite still checks real map data without overrides.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {waitUntil} from './wait-until.mjs';
import {clickVisibleControl} from './click-visible-control.mjs';
import {rendererFixture} from './browser-renderer-fixture.mjs';
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const style=JSON.parse(await readFile('styles/world.style.json','utf8'));
style.sources.stationMajor.data={type:'FeatureCollection',features:[]};
const renderer=await rendererFixture();
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1365,height:900},serviceWorkers:'block'});
const page=await context.newPage();
page.setDefaultTimeout(10000);
const errors=[],results=[],pending=new Set(),requestFailures=[];
page.on('request',r=>pending.add(r));
page.on('requestfinished',r=>pending.delete(r));
page.on('requestfailed',r=>{pending.delete(r);requestFailures.push({url:r.url(),error:r.failure()?.errorText});});
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Map resource error:'))errors.push(m.text());});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==','base64');
await page.addInitScript(()=>{
  // PMTiles is a provider boundary here, not a renderer/UI mock.
  window.pmtiles={Protocol:class{
    tiles=new Map();
    tile=async params=>({data:params.type==='json'?{tilejson:'3.0.0',minzoom:0,maxzoom:14,tiles:['pmtiles://fixture/{z}/{x}/{y}']}:new ArrayBuffer(0)});
  },FetchSource:class{getKey(){return 'fixture';}},PMTiles:class{}};
});
await context.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  const asset=renderer.get(url.href);
  if(asset)return route.fulfill(asset);
  if(url.href.startsWith(base)){
    if(path.endsWith('/major-stations.geojson'))return route.fulfill({json:{type:'FeatureCollection',features:[]}});
    if(path.endsWith('/world.style.json'))return route.fulfill({json:style});
    if(path.includes('/data/polar/'))return route.fulfill({status:404,body:''});
    if(path.includes('/data/'))return route.fulfill({json:{tiles:[],features:[],countries:{}}});
    return route.continue();
  }
  if(/\.(png|jpg|jpeg)$/.test(path))return route.fulfill({contentType:'image/png',body:png});
  if(/\/\d+\/\d+\/\d+(?:\.pbf)?$|\/fonts\//.test(path))return route.fulfill({contentType:'application/x-protobuf',body:Buffer.alloc(0)});
  return route.fulfill({json:{tilejson:'3.0.0',minzoom:0,maxzoom:16,tiles:['https://fixture.invalid/{z}/{x}/{y}']}});
});
const cookie=async()=>JSON.parse(decodeURIComponent((await context.cookies()).find(c=>c.name==='atlas_settings')?.value||'%7B%7D'));
const opened=()=>page.locator('.maplibregl-ctrl-attrib').evaluate(e=>e.classList.contains('maplibregl-compact-show')&&e.open);
async function waitForMapIdle(){
  await waitUntil(page,async()=>{
    const{map}=await import(document.querySelector('script[type="module"]').src);
    await new Promise(resolve=>{map.once('idle',()=>resolve());map.triggerRepaint();});
    const canvas=map.getCanvas(),container=map.getContainer(),ratio=map.getPixelRatio();
    return map.loaded()&&map.areTilesLoaded()&&!map.isMoving()
      && canvas.width===Math.floor(container.clientWidth*ratio)&&canvas.height===Math.floor(container.clientHeight*ratio);
  },null,{timeout:10000});
}
async function ready(){
  await page.waitForSelector('body[data-map-ready="true"]');
  await page.locator('.maplibregl-ctrl-scale').waitFor();
  await waitForMapIdle();
}
const geometry=()=>page.evaluate(()=>{
  const rect=el=>{if(!el||el.hidden)return null;const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden'||!r.width||!r.height)return null;return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const element=s=>document.querySelector(s),ruler=element('.maplibregl-ctrl-scale'),info=element('.maplibregl-ctrl-attrib-button');
  const hit=el=>{const r=rect(el);return r&&el.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2));};
  return{view:{width:innerWidth,height:innerHeight},ruler:rect(ruler),readout:rect(element('.map-readout')),panel:rect(element('.panel')),status:rect(element('.map-status')),info:rect(info),popover:rect(element('.maplibregl-ctrl-attrib-inner')),sheet:rect(element('#details')),hitRuler:hit(ruler),hitInfo:hit(info),text:ruler?.textContent};
});
const intersects=(a,b)=>!!(a&&b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top);
function valid(g){
  const inView=r=>r&&r.width>0&&r.height>0&&r.left>=-0.5&&r.top>=-0.5&&r.right<=g.view.width+0.5&&r.bottom<=g.view.height+0.5;
  return inView(g.ruler)&&inView(g.info)&&g.hitRuler&&g.hitInfo&&(!g.readout||inView(g.readout))&&(!g.popover||inView(g.popover))
    && ![g.panel,g.status,g.sheet,g.popover,g.readout].some(r=>intersects(g.ruler,r))
    && ![g.panel,g.status,g.sheet,g.popover].some(r=>intersects(g.readout,r));
}
async function check(name){
  const end=Date.now()+5000;let g;
  do {g=await geometry();if(valid(g))break;await page.waitForTimeout(50);}while(Date.now()<end);
  assert.ok(valid(g),`${name}: ${JSON.stringify(g)}`);
  results.push({name,...g});
}
try{
  await page.goto(base+'?mode=infrastructure&relief=0&inactive=0#7/34/129',{waitUntil:'domcontentloaded'});await ready();
  assert.equal(await opened(),false,'fresh visit defaults to collapsed, not absent');
  await check('fresh desktop');
  // Insets move the status pill without resizing it. The observed inset
  // probe must move the control stack too, even before any status text change.
  await page.evaluate(()=>document.documentElement.style.setProperty('--map-safe-bottom','24px'));
  await check('desktop position-only safe inset change');
  const info=page.locator('.maplibregl-ctrl-attrib-button');
  await info.click();assert.equal(await opened(),true);assert.equal((await cookie()).attributionOpen,true);
  await page.reload({waitUntil:'domcontentloaded',timeout:30000});await ready();assert.equal(await opened(),true,'open cookie restored after real reload');
  for(const bg of ['carto','satellite','hybrid','map']){
    await page.locator(`[data-background="${bg}"]`).click();
    await check(`open credits with ${bg}`);assert.equal(await opened(),true);
    assert.equal(await page.locator('.maplibregl-ctrl-attrib').evaluate(el=>el.getBoundingClientRect().width),32,'expanded info is still button-sized');
  }
  await info.focus();await page.keyboard.press('Space');assert.equal(await opened(),false);
  assert.equal((await cookie()).attributionOpen,false);await page.reload({waitUntil:'domcontentloaded',timeout:30000});await ready();assert.equal(await opened(),false);
  await info.focus();await page.keyboard.press('Enter');assert.equal(await opened(),true);await page.keyboard.press('Escape');assert.equal(await opened(),false);
  assert.equal((await cookie()).attributionOpen,false);
  // Menu state, long status, readout, detail scale, short landscape and insets
  // combine in the same application, rather than in isolated rectangle mocks.
  for(const size of [{width:1365,height:900},{width:800,height:400},{width:650,height:900},{width:412,height:915},{width:360,height:640},{width:320,height:568}]){
    await page.setViewportSize(size);
    // Device inset changes accompany a viewport resize. The first size is
    // unchanged, so send the same signal after injecting the test insets.
    await page.evaluate(()=>{document.documentElement.style.setProperty('--map-safe-left','18px');document.documentElement.style.setProperty('--map-safe-right','12px');document.documentElement.style.setProperty('--map-safe-bottom','24px');window.dispatchEvent(new Event('resize'));});
    for(const expanded of [true,false]){
      if((await page.locator('#controls').isHidden())===expanded)await page.locator('#controls-open').click();
      for(const readout of [true,false]){
        // Exercise the existing setting's change handler even while its menu
        // is collapsed; interactive menu access is tested above and below.
        await page.locator('#readout').evaluate((e,on)=>{e.checked=on;e.dispatchEvent(new Event('change',{bubbles:true}));},readout);
        for(let detail=0;detail<3;detail++){
          // Each scale change starts new tile/placement work. Finish its real
          // render before the next pointer action, then inject the long status
          // so the idle handler cannot erase that layout scenario.
          await waitForMapIdle();
          await page.evaluate(()=>{document.querySelector('#map-status').textContent='Some map data could not load. Check your connection or reload to retry. A longer status message must wrap without covering the ruler or coordinates.';});
          assert.equal(await page.locator('.map-readout').isVisible(),readout);
          await check(`${size.width}x${size.height}, menu=${expanded}, readout=${readout}, detail=${detail}`);
          const next=(detail+1)%3;
          // Hit-test the visible counter-scaled control before real pointer
          // input. Automatic scroll-into-view hung before clicking this
          // already-visible target in CI; forced or DOM clicks are not used.
          await clickVisibleControl(page,'button.atlas-ctrl[title^="More detail:"]');
          await waitUntil(page,expected=>{
            const map=document.querySelector('#map'),button=document.querySelector('button.atlas-ctrl[title^="More detail:"]');
            const level=map.classList.contains('detail-2')?2:map.classList.contains('detail')?1:0;
            return level===expected && button.title.startsWith(`More detail: map drawn at ${100/2**expected}%.`);
          },next,{timeout:5000});
          await page.waitForFunction(expected=>{try{return JSON.parse(decodeURIComponent(document.cookie.match(/(?:^|; )atlas_settings=([^;]*)/)?.[1]||'%7B%7D')).detail===expected;}catch{return false;}},next);
          assert.equal((await cookie()).detail,next,'detail click persists the actual next level');
        }
      }
    }
  }
  await page.setViewportSize({width:412,height:915});
  await page.locator('#readout').evaluate(e=>{e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.evaluate(()=>{document.querySelector('#details').hidden=false;document.querySelector('#detail-content').innerHTML='<h2>Station details</h2><p>Detail content</p>'.repeat(8);});
  await check('narrow bottom sheet');await page.locator('#details-close').click();
  await info.click();await check('narrow info popover');await info.click();
  // Preserve the original failing final sequence: south-pole globe, negative
  // zoom, then resize from desktop to phone. No jump to an easier location.
  await page.setViewportSize({width:1365,height:900});
  await page.evaluate(async()=>{const{map}=await import(document.querySelector('script[type="module"]').src);map.setProjection({type:'globe'});map.jumpTo({center:[0,-89.5],zoom:6+Math.log2(Math.cos(89.5*Math.PI/180)),bearing:0});});
  await page.setViewportSize({width:412,height:915});await check('original polar-to-phone regression');
  await mkdir('browser-review',{recursive:true});
  await page.screenshot({path:'browser-review/map-controls-mobile.png'});
  await page.setViewportSize({width:800,height:400});
  if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();
  await check('expanded short landscape');
  await page.evaluate(()=>{document.querySelector('#details').hidden=false;document.querySelector('#detail-content').innerHTML='<h2>Station details</h2><p>Details requiring scrolling</p>'.repeat(20);});
  await check('expanded short landscape with tall right details');
  await page.screenshot({path:'browser-review/map-controls-landscape.png'});
  assert.deepEqual(errors,[],'UI lifecycle has no JavaScript exceptions');
  console.log(`PASS: ${results.length} real-app UI layout/state cases; original polar resize; cookie reload; keyboard toggles`);
} catch(error){
  console.error(error.stack);console.error('UI_PAGE_ERRORS',JSON.stringify(errors));
  console.error('UI_PENDING_REQUESTS',JSON.stringify([...pending].map(r=>r.url())));
  console.error('UI_REQUEST_FAILURES',JSON.stringify(requestFailures));
  console.error('UI_GEOMETRY',JSON.stringify(await geometry().catch(()=>null)));
  await mkdir('browser-review',{recursive:true});await page.screenshot({path:'browser-review/map-controls-failure.png',timeout:5000}).catch(()=>{});throw error;
} finally{
  await mkdir('browser-review',{recursive:true});await writeFile('browser-review/map-controls.json',JSON.stringify(results,null,2));await browser.close();
}
