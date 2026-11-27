import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const browser=await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
await mkdir('browser-review',{recursive:true});
async function controlSignature(page) {
 await page.waitForFunction(()=>document.querySelectorAll('.maplibregl-ctrl-top-right .maplibregl-ctrl-group button:not(#terrain-toggle):not(#globe-toggle)').length===7 &&
   document.querySelector('.maplibregl-ctrl-attrib-button'));
 return page.evaluate(()=>{
  const buttons=g=>Array.from(g.querySelectorAll('button:not(#terrain-toggle):not(#globe-toggle)'));
  const geometry=el=>{
   const r=el.getBoundingClientRect(),s=getComputedStyle(el);
   return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
     background:s.backgroundColor,border:s.borderTopWidth,radius:s.borderRadius,font:s.fontSize,
     icon:el.querySelector('.maplibregl-ctrl-icon')?getComputedStyle(el.querySelector('.maplibregl-ctrl-icon')).backgroundImage:null,
     glyph:el.querySelector('.maplibregl-ctrl-icon')?null:el.textContent};
  };
  const groups=Array.from(document.querySelectorAll('.maplibregl-ctrl-top-right .maplibregl-ctrl-group'),g=>{
   const s=getComputedStyle(g);return {background:s.backgroundColor,radius:s.borderRadius,shadow:s.boxShadow,buttons:buttons(g).map(geometry)};
  });
  const info=document.querySelector('.maplibregl-ctrl-attrib-button'),attribution=geometry(info);
  attribution.glyph=null;attribution.icon=getComputedStyle(info).backgroundImage;
  return {groups,attribution};
 });
}
try {
 for(const [kind,width,height] of [['desktop',1365,900],['mobile',412,915]]) {
  const page=await browser.newPage({viewport:{width,height},hasTouch:kind==='mobile',deviceScaleFactor:kind==='mobile'?2.625:1,serviceWorkers:'block'});
  await installEmptyMapProviders(page.context(),base,{firstParty:'network'});
  await page.context().grantPermissions(['geolocation'],{origin:new URL(base).origin});
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
  await information.locator('.maplibregl-ctrl-attrib-button').click();
  const standard=await controlSignature(page);
  assert.deepEqual(standard.groups.map(g=>g.buttons.length),[1,2,1,3]);
  for(const group of standard.groups.slice(0,3))for(const button of group.buttons)assert.notEqual(button.icon,'none');
  assert.notEqual(standard.attribution.icon,'none');
  await page.evaluate(()=>localStorage.setItem('atlas_disable_webgl','1'));
  const webglRequests=[];
  page.on('request',request=>{
   if(/\/vendor\/maplibre-gl-5\.24\.0(?:-atlas\.4\.js|\.css)$/.test(new URL(request.url()).pathname))
    webglRequests.push(request.url());
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('canvas.atlas-flat-preview').waitFor({timeout:30000});
  const flat=await controlSignature(page);
  assert.deepEqual(flat,standard,kind+': Canvas must match actual WebGL control groups, geometry, artwork and attribution');
  assert.deepEqual(webglRequests,[],kind+': Canvas must not download either WebGL asset');
  assert.equal(await page.locator('#globe-toggle,#terrain-toggle').count(),0);
  await information.locator('.maplibregl-ctrl-attrib-button').click();
  assert.ok(await information.locator('.atlas-build').isVisible(),'Canvas attribution is interactive');
  await page.screenshot({path:`browser-review/build-${kind}-canvas-info.png`,timeout:120000});
  assert.deepEqual(errors,[]);
  console.log('PASS build info and real renderer control parity',kind,JSON.stringify(expected));
  await page.close();
 }
} finally {await browser.close();}
