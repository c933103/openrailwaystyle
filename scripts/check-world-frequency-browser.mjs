// The Service view draws OSM routes only. In the regions of the dated
// timetable fixtures (rebuilt with --fixtures), no timetable route may appear
// as a line of its own, in equal or frequency width.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
const root=process.env.ATLAS_TEST_URL||'http://127.0.0.1:4173';
// Hong Kong has OSM routes in the snapshot, so the query is shown to find lines.
const examples=[{id:'hong-kong',lat:22.302,lon:114.172,osm:true},{id:'hsl',lat:60.17,lon:24.94},{id:'nyct',lat:40.75,lon:-73.99},{id:'mbta',lat:42.355,lon:-71.062},{id:'auckland',lat:-36.851,lon:174.768}];
const browser=await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try {
  const context=await browser.newContext({viewport:{width:720,height:600}}),page=await context.newPage();
  await page.clock.install({time:new Date('2026-10-05T12:00:00Z')});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const index=JSON.parse(await readFile('styles/data/service-routes/index.json','utf8'));
  await mkdir('browser-review',{recursive:true});
  for(const example of examples)for(const width of ['equal','frequency']){
    await page.goto(`${root}/?mode=service&relief=0&serviceWidth=${width}&frequencyPeriod=peak&peakPhase=am#12/${example.lat}/${example.lon}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.body.dataset.mapReady==='true',{},{timeout:60000});
    await page.evaluate(async()=>window.testMap=(await import(document.querySelector('script[type="module"]').src)).map);
    await page.waitForFunction(()=>testMap.areTilesLoaded()&&testMap.isSourceLoaded('serviceRoutes'),{},{timeout:60000});
    const drawn=await page.evaluate(()=>testMap.queryRenderedFeatures({layers:['service-routes']}).map(f=>String(f.properties.id)));
    assert.deepEqual(drawn.filter(id=>!id.startsWith('relation-')),[],`${example.id} (${width}): only OSM route relations are drawn`);
    if(example.osm)assert.ok(drawn.length>0,`${example.id} (${width}): OSM routes are drawn`);
    await page.screenshot({path:`browser-review/world-frequency-${example.id}-${width}.png`});
    console.log(`${example.id} (${width}): ${drawn.length} OSM route lines, no timetable lines`);
  }
  console.log(`Service tiles: ${index.tiles.length}`);
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
