// Deterministic native MapLibre terrain check. No external provider traffic:
// every DEM, water polygon and contour is synthetic, but the production
// atlas-terrain protocol, Terrarium encode and renderer are real.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import vtpbf from 'vt-pbf';

// Real MVT bytes: the worker must decode ocean polygons itself rather than
// falling back to the page's stub decoder.
const MASK_MVT = Buffer.from(vtpbf.fromGeojsonVt({water:{extent:4096,features:[{
  type:3,tags:{class:'ocean'},geometry:[[
    {x:0,y:0},{x:2048,y:0},{x:2048,y:4096},{x:0,y:4096}
  ]]
}]}})).toString('base64');

const base=(process.env.ATLAS_FIXTURE_BASE_URL||process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const browser=await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1180,height:800},serviceWorkers:'block'});
const page=await context.newPage(), failures=[];
await mkdir('browser-review',{recursive:true});
page.on('pageerror',error=>failures.push(error.message));
try {
  await page.route('**/*', route => {
    if(new URL(route.request().url()).origin!==new URL(base).origin)
      return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.route('**/atlas-terrain-test.html',route=>route.fulfill({
    contentType:'text/html',
    body:`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body,#map{margin:0;width:100%;height:100%}
    </style></head><body><div id="map"></div>
    <script src="vendor/maplibre-gl-5.24.0-atlas.1.js"></script>
    <script type="module">
      import {installTerrain3D,syncTerrain3D} from './terrain-3d.mjs';
      const SIZE=256,z=11,x=1024,y=1024,n=2**z;
      const lng=(fraction)=>(x+fraction)/n*360-180;
      const lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+0.5)/n)))*180/Math.PI;
      const makeTile=(coarse)=>{
        const data=new Float32Array(SIZE*SIZE);
        for(let iy=0;iy<SIZE;iy++)for(let ix=0;ix<SIZE;ix++)
          data[iy*SIZE+ix]=coarse?-875:(ix<128?0:340);
        return {width:SIZE,height:SIZE,data};
      };
      const coast=[{x:0,y:0},{x:2048,y:0},{x:2048,y:4096},{x:0,y:4096}];
      const readTile=()=>({layers:{water:{length:1,feature:()=>({
        type:3,extent:4096,properties:{class:'ocean'},loadGeometry:()=>[coast]
      })}}});
      const counts={fine:0,coarse:0,water:0};
      const waterBytes=Uint8Array.from(atob('${MASK_MVT}'),c=>c.charCodeAt(0)).buffer;
      window.workerReplies=[];
      installTerrain3D(maplibregl,{getDemTile:async (z)=>{
        counts[z<=10?'coarse':'fine']++;
        return makeTile(z<=10);
      }},{waterTile:async()=>{counts.water++;return {data:waterBytes.slice(0)};},
         readTile,
         createWorker:()=>{
           const worker=new Worker('./vendor/terrain-3d-worker.js');
           worker.addEventListener('message',event=>window.workerReplies.push({
             encoded:Boolean(event.data?.data),error:event.data?.error||null
           }));
           return worker;
         }});
      const map=window.fixtureMap=new maplibregl.Map({
        container:'map',center:[lng(0.5),lat],zoom:11.3,pitch:60,maxPitch:80,
        style:{version:8,sources:{
          terrain3d:{type:'raster-dem',tiles:['atlas-terrain://{z}/{x}/{y}'],
            tileSize:256,maxzoom:11,encoding:'terrarium'},
          ground:{type:'geojson',data:{type:'FeatureCollection',features:[{
            type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[
              [[-1,-1],[-1,1],[1,1],[1,-1],[-1,-1]]
            ]}
          }]}}
        },layers:[
          {id:'background',type:'background',paint:{'background-color':'#f2e9d4'}},
          {id:'ground',type:'fill',source:'ground',paint:{'fill-color':'#d6cfb9'}}
        ]}
      });
      const points={sea:[lng(0.25),lat],land:[lng(0.75),lat]};
      window.terrainState=()=>({points,pitch:map.getPitch(),
        source:map.getTerrain()?.source||null,counts,
        sea:map.queryTerrainElevation(points.sea),
        land:map.queryTerrainElevation(points.land)});
      map.on('load',()=>{syncTerrain3D(map,true);window.terrainLoaded=true;});
    </script></body></html>`
  }));
  await page.goto(base+'atlas-terrain-test.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.terrainLoaded,null,{timeout:30000});
  await page.waitForFunction(()=>{
    const s=window.terrainState();
    return s.source==='terrain3d'&&s.sea!==null&&s.land!==null
      &&s.sea < -750&&s.land > 250;
  },null,{timeout:45000});
  const terrain=await page.evaluate(()=>window.terrainState());
  const workerReplies=await page.evaluate(()=>window.workerReplies);
  assert.ok(workerReplies.some(reply=>reply.encoded),'the native terrain worker must encode real decoded ocean MVT');
  assert.ok(workerReplies.every(reply=>!reply.error),JSON.stringify(workerReplies));
  assert.equal(terrain.source,'terrain3d');
  assert.ok(terrain.sea < -750,JSON.stringify(terrain));
  assert.ok(terrain.land > 250,JSON.stringify(terrain));
  assert.ok(terrain.counts.fine>0&&terrain.counts.coarse>0&&terrain.counts.water>0,
    'the browser must recover real negative ocean mesh cells');
  await page.screenshot({path:'browser-review/terrain-3d-seabed-synthetic.png'});
  await page.evaluate(async()=>{
    // evaluate runs outside the fixture module's lexical scope. Import the
    // production helper here too; do not accidentally replace terrain checks
    // with a ReferenceError after the signed-height assertions pass.
    const {syncTerrain3D}=await import('./terrain-3d.mjs');
    const map=window.fixtureMap;map.setPitch(0);syncTerrain3D(map,true);
  });
  await page.waitForFunction(()=>window.fixtureMap.getTerrain()===null);
  assert.equal(await page.evaluate(()=>window.fixtureMap.queryTerrainElevation([0,0])),null);
  assert.deepEqual(failures,[]);
  console.log('3D native terrain: signed sea and land elevations, overhead release',terrain);
} finally {await context.close();await browser.close();}
