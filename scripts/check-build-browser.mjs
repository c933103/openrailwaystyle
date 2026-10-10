import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const browser=await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
await mkdir('browser-review',{recursive:true});
try {
 for(const [kind,width,height] of [['desktop',1365,900],['mobile',412,915]]) {
  const page=await browser.newPage({viewport:{width,height},hasTouch:kind==='mobile',deviceScaleFactor:kind==='mobile'?2.625:1,serviceWorkers:'block'});
  await installEmptyMapProviders(page.context(),base,{firstParty:'network'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'?relief=0&inactive=0#3/35/135',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:90000});
  const expected=await page.evaluate(async()=>{
   const src=document.querySelector('script[type="module"]').src,version=new URL(src).searchParams.get('v');
   const {buildInfo}=await import(new URL(`vendor/tile-labels.js?v=${version}`,src));
   return {version,...buildInfo};
  });
  if(process.env.GITHUB_SHA){
   assert.equal(expected.commit,process.env.GITHUB_SHA.toLowerCase());
   assert.equal(expected.sourceUrl,`${(process.env.GITHUB_SERVER_URL||'https://github.com').replace(/\/$/,'')}/${process.env.GITHUB_REPOSITORY}/commit/${expected.commit}`);
  }
  const information=page.locator('.maplibregl-ctrl-attrib');
  // MapLibre may initially show compact attribution while sources arrive.
  // Exercise the opening action from a known closed state.
  if(await information.getAttribute('open')!==null)await information.locator('.maplibregl-ctrl-attrib-button').click();
  await information.locator('.maplibregl-ctrl-attrib-button').click();
  assert.ok(await information.locator('.atlas-build').isVisible());
  assert.match(await information.innerText(),new RegExp(`Build ${expected.version.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`));
  if(expected.sourceUrl)assert.equal(await information.locator('.atlas-build a').getAttribute('href'),expected.sourceUrl);
  else if(expected.commit)assert.match(await information.innerText(),new RegExp(expected.commit.slice(0,10)));
  else assert.match(await information.innerText(),/Development build/);
  await page.screenshot({path:`browser-review/build-${kind}-info.png`,timeout:120000});
  if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();
  await page.locator('[data-background="carto"]').click();
  assert.ok(await page.locator('.maplibregl-ctrl-attrib .atlas-build').isVisible());
  assert.ok(await page.locator('.maplibregl-ctrl-attrib a[href="https://www.openstreetmap.org/copyright"]').first().isVisible());
  assert.deepEqual(errors,[]);
  console.log('PASS build info',kind,JSON.stringify(expected));
  await page.close();
 }
} finally {await browser.close();}
