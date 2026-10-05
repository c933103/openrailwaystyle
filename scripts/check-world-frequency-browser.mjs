// Exercise the actual viewer/protocol and assembled timetable tiles in several
// regions. The deterministic clock tests a dated fixture after it expires.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
const root=process.env.ATLAS_TEST_URL||'http://127.0.0.1:4173';
const examples=[{id:'hsl',lat:60.17,lon:24.94},{id:'nyct',lat:40.75,lon:-73.99},{id:'mbta',lat:42.355,lon:-71.062},{id:'auckland',lat:-36.851,lon:174.768}];
const browser=await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try {
  const context=await browser.newContext({viewport:{width:720,height:600}}),page=await context.newPage();
  await page.clock.install({time:new Date('2026-10-05T12:00:00Z')});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(process.env.ATLAS_MAPLIBRE_ASSETS){
    for(const name of ['maplibre-gl.js','maplibre-gl.css','pmtiles.js'])await page.route(name==='pmtiles.js'?'**/pmtiles@4.2.1/dist/pmtiles.js':`**/maplibre-gl@5.24.0/dist/${name}`,async r=>r.fulfill({body:await readFile(`${process.env.ATLAS_MAPLIBRE_ASSETS}/${name}`),contentType:name.endsWith('.js')?'text/javascript':'text/css'}));
  }
  await mkdir('browser-review',{recursive:true});
  for(const example of examples){
    await page.goto(`${root}/?mode=service&relief=0&serviceWidth=frequency&frequencyPeriod=peak&peakPhase=am#12/${example.lat}/${example.lon}`,{waitUntil:'domcontentloaded'});
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
    const detail=await page.evaluate(async id=>{
      const module=await import('./service-frequency.mjs');
      const candidates=testMap.queryRenderedFeatures({layers:['service-routes']}).filter(f=>f.properties.id.startsWith(`gtfs:${id}:`)&&f.properties.frequency_date);
      let point;
      for(const f of candidates){
        const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
        const offset=module.frequencyOffset(f.properties,testMap.getZoom(),{serviceWidth:'frequency',frequencyPeriod:'offpeak'});
        for(const line of lines)for(let i=1;i<line.length&&!point;i++){
          const a=testMap.project(line[i-1]),b=testMap.project(line[i]),dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
          if(!len)continue;
          for(const fraction of [.25,.5,.75]){
            const p={x:a.x+dx*fraction-dy/len*offset,y:a.y+dy*fraction+dx/len*offset};
            if(p.x<330||p.x>700||p.y<20||p.y>550)continue;
            // Station inspection intentionally has priority in the product.
            // Choose a route interior outside every station's click tolerance.
            if(testMap.queryRenderedFeatures([[p.x-12,p.y-12],[p.x+12,p.y+12]]).some(f=>f.layer.id.startsWith('station-')))continue;
            point=p;break;
          }
        }
        if(point)break;
      }
      if(!point)throw new Error(`No unobscured route interior for ${id}`);
      testMap.fire('click',{point,lngLat:testMap.unproject(point),originalEvent:{}});
      return {text:document.getElementById('detail-content').textContent,href:document.querySelector('#detail-content a[href^="https:"]')?.href};
    },example.id);
    assert.match(detail.text,/scheduled|Frequency unavailable/);assert.match(detail.text,/Source credit/);assert.ok(detail.href);
    await page.screenshot({path:`browser-review/world-frequency-${example.id}.png`});
    console.log(`${example.id}: actual supplied-shape tiles render AM/PM/off-peak`,JSON.stringify(counts));
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
