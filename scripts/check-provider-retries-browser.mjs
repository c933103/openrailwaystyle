// Actual MapLibre metadata errors through the app's retry handler. All provider
// replies are synthetic; launchBrowser fails on any unmocked provider egress.
import assert from 'node:assert/strict';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const browser=await launchBrowser({...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const counts={permanent:0,transient:0},errors=[];
try {
  const context=await browser.newContext(),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await installEmptyMapProviders(context,base);
  await context.route('https://metadata.test/**',route=>{
    const name=new URL(route.request().url()).pathname.slice(1).split('.')[0];
    if(name==='tile')return route.fulfill({status:200,body:Buffer.alloc(0)});
    assert.ok(name in counts);counts[name]++;
    return route.fulfill(name==='permanent'?{status:403,body:'fixture denied'}:counts[name]===1?{status:503,body:'fixture temporarily unavailable'}:
      {status:200,contentType:'application/json',body:JSON.stringify({tilejson:'3.0.0',tiles:['https://metadata.test/tile.pbf'],minzoom:0,maxzoom:0})});
  });
  await page.goto(base+'?relief=0&inactive=0&transport=0#3/0/0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.mapReady==='true',null,{timeout:60000});
  await page.evaluate(async()=>{
    window.retryMap=(await import(document.querySelector('script[type="module"]').src)).map;
    window.metadataEvents=[];
    retryMap.on('error',event=>{if(event.sourceId?.startsWith('fixture-'))metadataEvents.push({source:event.sourceId,status:event.error?.status,message:event.error?.message});});
    for(const name of ['permanent','transient'])retryMap.addSource(`fixture-${name}`,{type:'vector',url:`https://metadata.test/${name}.json`});
  });
  await page.waitForFunction(()=>metadataEvents.some(e=>e.status===403)&&metadataEvents.some(e=>e.status===503));
  await page.waitForFunction(()=>retryMap.getSource('fixture-transient').tiles?.length>0,null,{timeout:15000});
  // Recovery cannot clear the unrelated permanent source's visible failure.
  assert.deepEqual(counts,{permanent:1,transient:2});
  assert.match(await page.locator('#map-status').textContent(),/Some map data could not load/);
  assert.equal(await page.locator('#map-status').evaluate(node=>node.classList.contains('error')),true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({fixture:'provider-metadata-retries',counts,events:await page.evaluate(()=>metadataEvents)}));
} finally {await browser.close();}
