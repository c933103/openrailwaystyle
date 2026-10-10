// Real built Atlas + PBF tiles from an offline GTFS compilation. No providers.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {table,now} from '../tests/fixtures/service-frequency/matching-fixture.mjs';
import {createTimetableMatcher,bindTimetableSections} from './timetable-frequency.mjs';
import {buildTiles} from './service-routes.mjs';
import {launchBrowser} from './browser.mjs';
import {serveAtlasAppFixture} from './atlas-app-browser-fixture.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
const temp=await mkdtemp(join(tmpdir(),'atlas-frequency-browser-')),server=await serveAtlasAppFixture();
try{
 const output=join(temp,'feed.json'),run=spawnSync('python3',['tests/fixtures/service-frequency/compile-matching-fixture.py',output],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const feed=JSON.parse(await readFile(output,'utf8')),osm=table(),matcher=createTimetableMatcher(osm,{now});matcher.addFeed(feed);
 const artifact=matcher.finish(),tiles=buildTiles(osm,{timetables:bindTimetableSections(osm,artifact).sections});
 await mkdir('browser-review',{recursive:true});
 for(const engine of ['chromium','webkit']){
  const browser=await launchBrowser({engine});
  try{
   const context=await browser.newContext({viewport:{width:1100,height:780}}),page=await context.newPage(),base=server.origin+'/atlas-project/',errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await context.addInitScript(()=>{window.__atlasFixtureBlobs=new Map();const create=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{const u=create(b);window.__atlasFixtureBlobs.set(u,b);return u;};});
   await installEmptyMapProviders(context,base,{firstParty:'network'});
   await context.route(`blob:${server.origin}/**`,async route=>{const body=await page.evaluate(async url=>window.__atlasFixtureBlobs.get(url)?.text()??null,route.request().url());assert.notEqual(body,null);await route.fulfill({body,contentType:'text/javascript'});});
   await context.route('**/data/service-routes/**',async route=>{
    const path=new URL(route.request().url()).pathname.split('/data/service-routes/')[1];
    if(path==='index.json')return route.fulfill({json:{tiles:[...tiles.keys()]}});
    if(path==='frequency-manifest.json')return route.fulfill({json:{profiles:['am','h08','overnight'],feeds:artifact.feeds}});
    const data=tiles.get(path.replace(/\.pbf\.gz$/,''));
    return data?route.fulfill({body:gzipSync(data),contentType:'application/octet-stream'}):route.fulfill({status:404});
   });
   await page.clock.install({time:new Date(now)});
   for(const [profile,query,rates] of [['am','frequencyPeriod=peak&peakPhase=am',[4,6]],['h08','frequencyPeriod=hour&frequencyHour=8',[2,4]],['overnight','frequencyPeriod=overnight',[0]],['equal','frequencyPeriod=peak',[]]]){
    await page.goto(base+`?mode=service&serviceWidth=${profile==='equal'?'equal':'frequency'}&${query}&relief=0&transport=0#12/35.68/139.715`,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('body[data-map-ready="true"]',{timeout:60000});
    await page.evaluate(async()=>window.testMap=(await import(document.querySelector('script[type="module"]').src)).map);
    await page.waitForFunction(()=>testMap.areTilesLoaded()&&testMap.queryRenderedFeatures({layers:['service-routes']}).length>0,{},{timeout:60000});
    const actual=await page.evaluate(profile=>testMap.queryRenderedFeatures({layers:['service-routes']}).map(f=>({id:f.properties.id,rate:f.properties['frequency_'+profile],expected:profile==='equal'?3.5:f.properties['frequency_width_'+profile],width:f.layer.paint['line-width']})),profile);
    assert.ok(actual.every(f=>f.id==='relation-10'),'timetable adds no route identity');
    if(profile!=='equal')assert.deepEqual([...new Set(actual.map(f=>f.rate))].sort((a,b)=>a-b),rates);
    for(const f of actual)assert.ok(Math.abs(f.width-f.expected)<1e-5,`${engine} ${profile}: actual renderer width ${f.width} follows ${f.expected}`);
    await page.screenshot({path:`browser-review/timetable-frequency-${engine}-${profile}.png`});
   }
   assert.deepEqual(errors,[]);console.log(`${engine}: compiled GTFS counts drive AM/hour/overnight map widths; equal width preserved`);
  }finally{await browser.close();}
 }
}finally{await server.close();await rm(temp,{recursive:true,force:true});}
