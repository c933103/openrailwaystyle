import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
const errors=[],requests=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('request',req=>requests.push(req.url()));
page.on('console',msg=>{if(msg.type()==='error') console.log('Browser resource:',msg.text());});
await mkdir('browser-review',{recursive:true});
try{
  await page.goto('http://127.0.0.1:4173/?mapLanguage=en&stationLanguage=ko#7/34.229/129.245');
  await page.waitForSelector('body[data-map-ready="true"]',{timeout:120000});
  await page.waitForFunction(()=>+document.querySelector('#map-status').dataset.renderedTracks>0,{timeout:120000});
  // Pan northwest at the SAME zoom before any visit to zoom 8.
  await page.evaluate(()=>location.hash='#7/35.65/128.1');
  await page.waitForFunction(()=>document.querySelector('#map-status').dataset.lifecycleNames?.includes('남부내륙'),{timeout:120000});
  console.log('PASS: 남부내륙선 rendered after pan at zoom 7, before visiting zoom 8');
  console.log('Zoom7 diagnostics',await page.locator('#map-status').evaluate(el=>({...el.dataset})));
  assert.equal(requests.some(url=>url.includes('overpass')),false,'Panning must not query Overpass');
  // Hide panel to assess railway/station/boundary prominence on the full map.
  await page.locator('#collapse').click();
  const shot=await page.screenshot({path:'browser-review/korea-z7.jpg',type:'jpeg',quality:45});
  console.log('REVIEW_IMAGE_START'+shot.toString('base64')+'REVIEW_IMAGE_END');
  await page.locator('#collapse').click();
  await page.selectOption('#stationLanguage','en');
  await page.selectOption('#lineLanguage','en');
  await page.evaluate(()=>location.hash='#10/35.17/128.12');
  await page.waitForFunction(()=>+document.querySelector('#map-status').dataset.renderedRailNames>0,{timeout:120000});
  console.log('PASS: railway names rendered at zoom 10');
  await page.screenshot({path:'browser-review/korea-z10.jpg',type:'jpeg',quality:65});
  await page.locator('#inactive').uncheck();
  await page.waitForFunction(()=>+document.querySelector('#map-status').dataset.renderedConstruction===0,{timeout:30000});
  await page.locator('#inactive').check();
  await page.locator('#relief').uncheck();
  await page.locator('#relief').check();
  assert.equal(await page.locator('#region').count(),0);
  assert.ok(requests.some(url=>url.includes('terrarium')),'Relief source requested');
  assert.ok(requests.some(url=>url.includes('standard_railway_text_stations')&&url.includes('lang=en')),'Translated station tiles requested');
  assert.deepEqual(errors,[]);
  console.log('PASS: languages, names, relief and lifecycle controls; no JavaScript exceptions');
} finally {await browser.close();}
