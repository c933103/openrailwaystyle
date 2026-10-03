// Exercise the actual viewer/protocol and assembled timetable tiles in several
// regions. The deterministic clock tests a dated fixture after it expires.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const root=process.env.ATLAS_TEST_URL||'http://127.0.0.1:4173';
const examples=[{id:'hsl',lat:60.17,lon:24.94},{id:'nyct',lat:40.75,lon:-73.99},{id:'mbta',lat:42.355,lon:-71.062},{id:'auckland',lat:-36.851,lon:174.768}];
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try {
  const context=await browser.newContext({viewport:{width:720,height:600}}),page=await context.newPage();
  await page.clock.install({time:new Date('2026-10-05T12:00:00Z')});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(process.env.ATLAS_MAPLIBRE_ASSETS){
    for(const name of ['maplibre-gl.js','maplibre-gl.css','pmtiles.js'])await page.route(name==='pmtiles.js'?'**/pmtiles@4.2.1/dist/pmtiles.js':`**/maplibre-gl@5.24.0/dist/${name}`,async r=>r.fulfill({body:await readFile(`${process.env.ATLAS_MAPLIBRE_ASSETS}/${name}`),contentType:name.endsWith('.js')?'text/javascript':'text/css'}));
  }
  await mkdir('browser-review',{recursive:true});
  for(const example of examples){
    await page.goto(`${root}/?mode=service&serviceWidth=frequency&frequencyPeriod=peak&peakPhase=am#12/${example.lat}/${example.lon}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.body.dataset.mapReady==='true',{},{timeout:60000});
    await page.evaluate(async()=>window.testMap=(await import(document.querySelector('script[type="module"]').src)).map);
    await page.waitForFunction(id=>testMap.queryRenderedFeatures({layers:['service-routes']}).some(f=>f.properties.id.startsWith(`gtfs:${id}:`)&&f.properties.frequency_am!==undefined),example.id,{timeout:30000});
    const counts=[];
    for(const profile of ['am','pm','offpeak']){
      const result=await page.evaluate(async({profile,id})=>{
        const field=document.getElementById('frequency-period');field.value=profile==='offpeak'?'offpeak':'peak';field.dispatchEvent(new Event('change'));
        const peak=document.getElementById('peak-phase');peak.value=profile==='pm'?'pm':'am';peak.dispatchEvent(new Event('change'));
        await new Promise(resolve=>testMap.once('render',resolve));
        const features=testMap.queryRenderedFeatures({layers:['service-routes']}).filter(f=>f.properties.id.startsWith(`gtfs:${id}:`)&&f.properties[`frequency_${profile}`]!==undefined);
        return features.map(f=>({ref:f.properties.ref,rate:f.properties[`frequency_${profile}`],stored:f.properties[`frequency_width_${profile}`],paint:f.layer.paint['line-width'],source:f.properties.frequency_source}));
      },{profile,id:example.id});
      assert.ok(result.length>0,`${example.id}: actual ${profile} paths rendered`);
      for(const r of result){assert.ok(Number.isFinite(r.rate));assert.ok(Math.abs(r.paint-r.stored)<1e-5,`${example.id}: ${profile} painted width for ${r.ref}`);assert.ok(r.source);}
      counts.push([profile,new Set(result.map(r=>r.ref)).size]);
    }
    // Click a rendered supplied-shape path and confirm generic source details.
    const detail=await page.evaluate(()=>{
      const f=testMap.queryRenderedFeatures({layers:['service-routes']}).find(f=>f.properties.frequency_source&&f.properties.frequency_date);
      const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
      const line=lines.find(l=>l.length>=2),points=line.map(p=>testMap.project(p));
      const pair=points.slice(1).map((b,i)=>[points[i],b]).find(([a,b])=>a.x>330&&a.x<700&&b.x>330&&b.x<700&&a.y>20&&a.y<550&&b.y>20&&b.y<550);
      if(!pair)return {skipped:true};
      const p={x:(pair[0].x+pair[1].x)/2,y:(pair[0].y+pair[1].y)/2};testMap.fire('click',{point:p,lngLat:testMap.unproject(p),originalEvent:{}});
      return {text:document.getElementById('detail-content').textContent,href:document.querySelector('#detail-content a[href^="https:"]')?.href};
    });
    if(!detail.skipped){assert.match(detail.text,/scheduled|Frequency unavailable/);assert.match(detail.text,/Source credit/);assert.ok(detail.href);}
    await page.screenshot({path:`browser-review/world-frequency-${example.id}.png`});
    console.log(`${example.id}: actual supplied-shape tiles render AM/PM/off-peak`,JSON.stringify(counts));
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
