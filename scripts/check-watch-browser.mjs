// Actual app layout/gestures; this does not claim physical-watch performance.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const root=process.env.ATLAS_TEST_URL || 'http://127.0.0.1:4173';
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try {
  const context=await browser.newContext({viewport:{width:240,height:240},hasTouch:true}),page=await context.newPage();
  if(process.env.ATLAS_MAPLIBRE_ASSETS){
    for(const name of ['maplibre-gl.js','maplibre-gl.css'])await page.route(`**/maplibre-gl@5.24.0/dist/${name}`,async r=>r.fulfill({body:await readFile(`${process.env.ATLAS_MAPLIBRE_ASSETS}/${name}`),contentType:name.endsWith('.js')?'text/javascript':'text/css'}));
    await page.route('**/pmtiles@4.2.1/dist/pmtiles.js',async r=>r.fulfill({body:await readFile(`${process.env.ATLAS_MAPLIBRE_ASSETS}/pmtiles.js`),contentType:'text/javascript'}));
  }
  await page.goto(root+'/?ui=watch&mode=service&serviceWidth=frequency#15/22.405/113.98',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.mapReady==='true',{},{timeout:60000});
  await page.evaluate(async()=>{window.testMap=(await import(document.querySelector('script[type="module"]').src)).map;});
  await mkdir('browser-review',{recursive:true});
  for(const size of [192,240,280]){
    await page.setViewportSize({width:size,height:size});
    await page.waitForFunction(size=>document.querySelector('#map canvas')?.getBoundingClientRect().width===size,size,{timeout:5000});
    const idle=await page.evaluate(()=>{
      const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
      const r=testMap.getCanvas().getBoundingClientRect();
      return {rect:[r.x,r.y,r.width,r.height],visible:[...document.querySelectorAll('.panel,.maplibregl-control-container,.maplibregl-ctrl,.detail-panel,.map-status,#draw-toolbar,#measure-toolbar,#watch-menu')].filter(visible).map(e=>e.id||e.className)};
    });
    assert.deepEqual(idle.rect,[0,0,size,size]);assert.deepEqual(idle.visible,[],'idle map has zero visible UI controls');
    await page.mouse.move(size/2,size/2);await page.mouse.down();await page.waitForTimeout(760);await page.mouse.up();
    await page.locator('#watch-menu').waitFor({state:'visible'});
    const box=await page.locator('#watch-content').boundingBox();
    for(const [x,y] of [[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]])assert.ok(Math.hypot(x-size/2,y-size/2)<=size/2,'controls fit inside a round watch face');
    await page.locator('#watch-content select[aria-label="Map options"]').selectOption('frequency');
    await page.locator('#watch-content select').selectOption('pm');
    await page.locator('#watch-menu').waitFor({state:'hidden'});
    await page.touchscreen.tap(size/2,size/2);
    assert.equal(await page.locator('#details').isVisible(),false,'a tap does not open a detail card');
    await page.screenshot({path:`browser-review/watch-map-${size}.png`});
    console.log(`${size}px: full-face idle map, round-safe controls and frequency selection verified`);
  }
  const centre=await page.evaluate(()=>testMap.getCenter().toArray());
  await page.mouse.move(140,140);await page.mouse.down();await page.mouse.move(185,160,{steps:8});await page.mouse.up();
  assert.notDeepEqual(await page.evaluate(()=>testMap.getCenter().toArray()),centre,'direct drag still pans');
  assert.equal(await page.locator('#watch-menu').isVisible(),false,'drag never opens controls');
  const zoom=await page.evaluate(()=>testMap.getZoom());
  await page.mouse.dblclick(140,140);await page.waitForTimeout(500);
  assert.ok((await page.evaluate(()=>testMap.getZoom()))>zoom,'double tap/click still zooms');
  const cdp=await context.newCDPSession(page),pinchStart=await page.evaluate(()=>testMap.getZoom());
  const touches=gap=>[{x:140-gap,y:140,id:1},{x:140+gap,y:140,id:2}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches(20)});
  for(const gap of [25,30,35,40,45]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touches(gap)});await page.waitForTimeout(20);}
  await page.waitForTimeout(760);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await page.locator('#watch-menu').isVisible(),false,'pinch never opens controls');
  assert.ok((await page.evaluate(()=>testMap.getZoom()))>pinchStart,'pinch still zooms');
  await page.goto(root+'/?ui=standard#15/22.405/113.98',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.mapReady==='true',{},{timeout:60000});
  assert.equal(await page.locator('.panel').isVisible(),true,'ordinary narrow phones retain controls');
  assert.equal(await page.locator('.maplibregl-ctrl-scale').isVisible(),true,'ordinary phones retain their visible scale');
} finally {await browser.close();}
