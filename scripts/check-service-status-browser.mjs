// Actual app/DOM/MapLibre with synthetic service data and no provider egress.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {summarizeServiceAcquisition} from '../styles/service-status.mjs';
import {frequencyBundle} from '../styles/service-frequency.mjs';
import {waitUntil} from './wait-until.mjs';

export async function checkServiceStatusBrowser(browser,root) {
 const base=root.replace(/\/?$/,'/'),context=await browser.newContext({viewport:{width:1000,height:800}});
 try{
  await installEmptyMapProviders(context,base);
  const style=JSON.parse(await readFile('styles/world.style.json','utf8'));
  style.sources.stationMajor.data={type:'FeatureCollection',features:[]};
  style.sources.serviceRoutes={type:'geojson',data:{type:'FeatureCollection',features:[]}};
  for(const layer of style.layers)if(layer.source==='serviceRoutes')delete layer['source-layer'];
  await context.route('**/world.style.json*',route=>route.fulfill({json:style}));
  const acquisition=JSON.parse(await readFile('tests/fixtures/service-status.json','utf8'));
  const sha=createHash('sha256').update('synthetic OSM snapshot').digest('hex');
  const manifest={schema:3,profiles:['am','pm','offpeak','overnight'],osmSnapshotSha256:sha,acquisition:summarizeServiceAcquisition(acquisition,sha)};
  let metadata='available',requests=0;
  await context.route('**/data/service-routes/frequency-manifest.json',route=>{
   requests++;
   return metadata==='failed'?route.fulfill({status:503,body:'synthetic metadata failure'}):
    route.fulfill({json:metadata==='legacy'?{schema:3,profiles:manifest.profiles}:metadata==='mismatched'?{...manifest,osmSnapshotSha256:'b'.repeat(64)}:manifest});
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:new Date('2026-10-15T12:00:00Z')});
  const open=async()=>{
   await page.goto(base+'?mode=service&relief=0&serviceWidth=frequency&frequencyPeriod=peak&peakPhase=am#12/0/0',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('body[data-map-ready="true"]');
   await page.evaluate(async()=>window.statusMap=(await import(document.querySelector('script[type="module"]').src)).map);
   await page.locator('#service-data-status summary').click();
  };
  await open();
  const status=page.locator('#service-data-status');
  await page.waitForFunction(()=>document.querySelector('#service-data-status').textContent.includes('Partial fixture: Acquisition partial'));
  const text=await status.textContent();
  for(const expected of ['Latest acquisition deferred','Acquisition completed; source eligibility/geometry unresolved','contains no route records','Legacy fixture: Acquisition completed; source eligibility/geometry unknown','Latest acquisition failed','visible area or a particular route'])assert.ok(text.includes(expected),expected);
  await page.selectOption('#frequency-period','offpeak');
  assert.equal(await status.evaluate(element=>element.open),true,'status stays open after period changes');
  await page.selectOption('#frequency-period','peak');
  assert.equal(await status.evaluate(element=>element.open),true);
  const manifestHref=await status.locator('a').getAttribute('href');assert.equal(manifestHref,base+'data/service-routes/frequency-manifest.json');
  const show=async properties=>{
   if(await page.locator('#details').isVisible())await page.locator('#details-close').click();
   await page.evaluate(properties=>{
    statusMap.getSource('serviceRoutes').setData({type:'FeatureCollection',features:[{type:'Feature',properties:{
     id:'relation-999999',ref:'Fixture',name:'Status fixture',kind:'subway',colour:'#2288aa',n:1,i:0,slot:0,...properties
    },geometry:{type:'LineString',coordinates:[[-.02,0],[.02,0]]}}]});
   },properties);
   await waitUntil(page,()=>statusMap.loaded()&&statusMap.areTilesLoaded()&&statusMap.queryRenderedFeatures({layers:['service-routes']}).length>0);
   const point=await page.evaluate(()=>{const p=statusMap.project([0,0]);return {x:p.x,y:p.y};});
   await page.mouse.click(point.x,point.y);await page.locator('#details').waitFor({state:'visible'});
   return page.locator('#detail-content').textContent();
  };
  const detailRow=label=>page.locator('#detail-content dt').evaluateAll((terms,label)=>terms.find(term=>term.textContent===label)?.nextElementSibling?.textContent,label);
  const future=Date.parse('2026-10-16T12:00:00Z')/1000,past=Date.parse('2026-10-14T12:00:00Z')/1000;
  assert.match(await show({frequency_am:0,frequency_high_am:0,frequency_until:future,frequency_quality_am:'scheduled'}),/0\/h\/direction/);
  assert.match(await show({frequency_am:4,frequency_high_am:4,frequency_until:past}),/Matched frequency profile has expired/);
  assert.match(await detailRow('Evening peak'),/reason is unknown/);
  const expiredAtBuild=frequencyBundle([{ref:'synthetic',kind:'subway'}],[[[0,0],[1,1]]],null,[{properties:{frequency_until:past},profiles:{am:{rate:0}}}],Date.parse('2026-10-15T12:00:00Z'))[0];
  await show(expiredAtBuild);
  assert.match(await detailRow('Morning peak'),/evidence had expired at this snapshot build/);
  assert.match(await detailRow('Evening peak'),/reason is unknown/);
  await show({frequency_status:'expired'});
  for(const label of ['Morning peak','Evening peak','Off-peak','Overnight · 00:00–05:00'])assert.match(await detailRow(label),/reason is unknown/);
  assert.match(await show({frequency_status:'unmatched'}),/No timetable or headway profile matched this map service/);
  assert.match(await show({}),/reason is unknown/);
  assert.match(await show({frequency_am:4,frequency_high_am:4,frequency_until:future}),/4\/h\/direction/);
  // A detail opened with current data must update when that same data expire.
  const until=await page.evaluate(()=>Date.now()/1000+3);
  assert.match(await show({frequency_am:4,frequency_high_am:4,frequency_until:until}),/4\/h\/direction/);
  await page.clock.runFor(4000);
  await page.waitForFunction(()=>document.querySelector('#detail-content').textContent.includes('Matched frequency profile has expired'));
  assert.match(await detailRow('Evening peak'),/reason is unknown/);
  await mkdir('browser-review',{recursive:true});await page.screenshot({path:'browser-review/service-status-expired.png'});
  for(const value of ['failed','legacy','mismatched']){
   metadata=value;await open();
   const expected=value==='failed'?'could not be loaded; coverage is unknown':'Service acquisition status is unknown';
   await page.waitForFunction(expected=>document.querySelector('#service-data-status').textContent.includes(expected),expected);
  }
  assert.equal(requests,4,'one manifest read per page load; no status polling or provider acquisition');
  assert.deepEqual(errors,[]);
  console.log('PASS: service stage partial/deferred/unresolved/empty/failed/unknown; metadata failure and snapshot binding; zero/expired/unmatched/unknown details and live expiry');
 }finally{await context.close();}
}
