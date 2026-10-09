// Real MapLibre rendering of a shared-track bundle from the published snapshot.
// No timetable or OSM extraction requests; the site must already be assembled.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {launchBrowser} from './browser.mjs';
const root=process.env.ATLAS_TEST_URL || 'http://127.0.0.1:4173';
const key='12/3344/1785', [z,x,y]=key.split('/').map(Number);
const layer=new VectorTile(new Pbf(gunzipSync(await readFile(`styles/data/service-routes/${key}.pbf.gz`)))).layers.service_routes;
const features=Array.from({length:layer.length},(_,i)=>layer.feature(i).toGeoJSON(x,y,z));
const chosen=features.find(f=>f.properties.ref==='610'&&f.properties.n>=4);
assert.ok(chosen,'the published Hong Kong snapshot has a matched shared-track bundle');
const geometry=JSON.stringify(chosen.geometry);
const bundle=features.filter(f=>JSON.stringify(f.geometry)===geometry);
assert.equal(bundle.length,chosen.properties.n,'every service in the bundle is retained');
// The fresh-data fixture remains testable after its live profile expires.
// Unit tests separately verify the stale/unavailable fallback.
const fixtureNow=(chosen.properties.frequency_until-86400)*1000;
const browser=await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try {
  const page=await browser.newPage({viewport:{width:480,height:480}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/frequency-check.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="vendor/maplibre-gl-5.24.0.css"><style>body{margin:0}#map{position:absolute;inset:0}</style><div id="map"></div><script src="vendor/maplibre-gl-5.24.0-atlas.1.js"></script>'}));
  await page.goto(root+'/frequency-check.html');
  await page.evaluate(async({features,now})=>{
    const frequency=await import('./service-frequency.mjs');window.frequency=frequency;
    window.fixtureNow=now;
    const lines=features[0].geometry.type==='LineString'?[features[0].geometry.coordinates]:features[0].geometry.coordinates;
    let longest=0,ends;
    for(const line of lines)for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(d>longest){longest=d;ends=[a,b];}}
    window.ends=ends;
    const p=frequency.serviceFrequencyPaint({serviceWidth:'frequency',frequencyPeriod:'peak',peakPhase:'am'},fixtureNow);
    window.map=new maplibregl.Map({container:'map',center:ends[0].map((v,i)=>(v+ends[1][i])/2),zoom:16,attributionControl:false,fadeDuration:0,canvasContextAttributes:{preserveDrawingBuffer:true},style:{version:8,sources:{services:{type:'geojson',data:{type:'FeatureCollection',features},generateId:true}},layers:[{id:'background',type:'background',paint:{'background-color':'#fff'}},{id:'routes',type:'line',source:'services',paint:{'line-color':['get','colour'],'line-width':p.width,'line-offset':p.offset,'line-opacity':p.opacity}}]}});
    await Promise.race([new Promise(resolve=>map.once('idle',resolve)),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Map rendering timed out')),30000))]);
  },{features:bundle,now:fixtureNow});
  await mkdir('browser-review',{recursive:true});
  for(const profile of ['am','pm','offpeak']){
    const result=await page.evaluate(async profile=>{
      const settings={serviceWidth:'frequency',frequencyPeriod:profile==='offpeak'?'offpeak':'peak',peakPhase:profile},p=frequency.serviceFrequencyPaint(settings,fixtureNow);
      for(const [key,value] of [['line-width',p.width],['line-offset',p.offset],['line-opacity',p.opacity]])map.setPaintProperty('routes',key,value);
      await Promise.race([new Promise(resolve=>{map.once('idle',resolve);map.triggerRepaint();}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Profile rendering timed out')),30000))]);
      const [a,b]=ends.map(p=>map.project(p)),dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
      const source=map.querySourceFeatures('services');
      return source.filter(f=>f.properties.frequency_id).map(f=>{
        const offset=frequency.frequencyOffset(f.properties,16,settings,fixtureNow),point={x:(a.x+b.x)/2-dy/len*offset,y:(a.y+b.y)/2+dx/len*offset};
        const drawn=map.queryRenderedFeatures([point.x,point.y],{layers:['routes']});
        const picked=frequency.nearestServiceFeature(drawn,point,p=>map.project(p),16,settings,fixtureNow);
        return {ref:f.properties.ref,picked:picked?.properties.ref,expected:f.properties[`frequency_width_${profile}`]*5/3.5,actual:drawn.find(d=>d.properties.ref===f.properties.ref)?.layer.paint['line-width']};
      });
    },profile);
    assert.ok(result.length>=3,'matched routes are actually rendered');
    for(const r of result){assert.equal(r.picked,r.ref,`${profile}: click the visible ${r.ref} line`);assert.ok(Math.abs(r.actual-r.expected)<1e-5,`${profile}: rendered width of ${r.ref}`);}
    await page.screenshot({path:`browser-review/service-frequency-${profile}.png`});
    console.log(`${profile}: ${result.length} rendered widths and shared-track clicks verified`);
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
