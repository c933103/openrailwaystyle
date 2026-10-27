// First-party, fixture-only WebGL acceptance for polar bathymetry. Real
// production shader + polar depth PNG; zero public-provider requests.
// Both poles, four sea-depth palette anchors, missing/hidden style and Carto.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {DEPTH_COLOURS, depthColour} from '../styles/bathymetry.mjs';
import {CAP_RADIUS, POLAR_DEPTH_FORMAT} from '../styles/polar.mjs';
import {png, encodePolarDepth} from './polar-depth.mjs';

const browser=await launchBrowser();
try {
  for(const cap of ['north','south']) for(const depth of [20,3000]) {
    const page=await browser.newPage({viewport:{width:1000,height:700}});
    const errors=[],warnings=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='warning')warnings.push(m.text());});
    const size=9, x0=-CAP_RADIUS-20, step=(2*CAP_RADIUS+40)/(size-1);
    const relief={x0,step,size};
    const index={cap,radius:CAP_RADIUS,units:{metric:[]},relief,
      depth:{...relief,format:POLAR_DEPTH_FORMAT,maxDepth:DEPTH_COLOURS.at(-1)[0]}};
    const image=png(size,size,encodePolarDepth({cols:size,rows:size,values:new Float32Array(size*size).fill(-depth)}));
    await page.route('**/depth-fixture/**',route=>{
      const name=new URL(route.request().url()).pathname.split('/').at(-1);
      requests.push(name);
      if(name===cap+'-depth.png')return route.fulfill({status:200,contentType:'image/png',body:image});
      if(name===cap+'-index.json')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(index)});
      if(name===cap+'-features.json')return route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({water:[],iceShelves:[],runways:[],places:[]})});
      return route.fulfill({status:404,body:'not available'});
    });
    const sign=cap==='north'?1:-1, latitude=sign*88.5;
    await page.route('**/polar-depth-check.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><body style="margin:0"><div id="map" style="height:100vh;width:100vw"></div>
      <script src="vendor/maplibre-gl-5.24.0-atlas.1.js"></script><script type="module">
      import {PolarLayer} from './vendor/polar-layer.js';
      import {allowPolarCentres} from './globe-drag.mjs';
      window.background='map';window.draws=0;
      const map=window.map=new maplibregl.Map({container:'map',center:[0,0],zoom:2,
        projection:{type:'globe'},style:{version:8,projection:{type:'globe'},sources:{
          empty:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},
          layers:[{id:'background',type:'background',paint:{'background-color':'#f2f1e9'}},
            {id:'water',type:'fill',source:'empty',paint:{'fill-color':'#bfd8e0'}},
            // A visibility-only stand-in; the custom layer itself carries
            // the real bathymetry pixels and no raster tile is downloaded.
            {id:'terrain-bathymetry',type:'fill',source:'empty',paint:{'fill-color':'#ffffff'}}]},
          canvasContextAttributes:{preserveDrawingBuffer:true}});
      allowPolarCentres(map,maplibregl.LngLat,()=>1);
      map.on('load',()=>{
        const layer=window.layer=new PolarLayer({data:new URL('./depth-fixture/',location.href),units:()=> 'metric',
          relief:()=>false,palette:()=>window.background,imagery:()=>['satellite','hybrid'].includes(window.background)});
        const draw=layer.drawDepth.bind(layer);
        layer.drawDepth=(...args)=>{window.draws++;return draw(...args);};
        map.addLayer(layer);map.jumpTo({center:[0,${latitude}],zoom:15+Math.log2(Math.cos(${latitude}*Math.PI/180))});
      });
      window.frame=()=>new Promise(resolve=>{map.once('idle',()=>{map.getCanvas().getContext('webgl2').finish();resolve();});map.triggerRepaint();});
      window.pixel=()=>{const point=map.project([0,${latitude}]),gl=map.getCanvas().getContext('webgl2'),out=new Uint8Array(4);
        gl.readPixels(Math.round(point.x),gl.drawingBufferHeight-1-Math.round(point.y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,out);return [...out];};
      </script>`}));
    await page.goto('http://127.0.0.1:4173/polar-depth-check.html');
    await page.waitForFunction(()=>window.layer?.caps?.[window.map.getCenter().lat>0?'north':'south']?.depth && window.draws>0,null,{timeout:60000});
    await page.evaluate(()=>window.frame());
    const actual=await page.evaluate(()=>window.pixel());
    const expected=depthColour(-depth);
    for(let i=0;i<3;i++)assert.ok(Math.abs(actual[i]-expected[i])<=5,
      `${cap} -${depth} m: channel ${i} ${actual} differs from depthColour ${expected}`);
    assert.equal(actual[3],255);
    assert.equal(requests.filter(n=>n===cap+'-depth.png').length,1,'depth fetched only once per visible cap');
    await mkdir('browser-review',{recursive:true});
    await page.screenshot({path:`browser-review/polar-depth-${cap}-${depth}.png`});
    const withoutDepth=await page.evaluate(async()=>{
      window.map.setLayoutProperty('terrain-bathymetry','visibility','none');
      await window.frame();return window.pixel();
    });
    const under=cap==='north'?[191,216,224]:[242,241,233]; // water / land of this style
    for(let i=0;i<3;i++)assert.ok(Math.abs(withoutDepth[i]-under[i])<=5,
      `${cap}: hidden bathymetry should revert to the plain cap, got ${withoutDepth}`);
    await page.evaluate(async()=>{window.map.removeLayer('terrain-bathymetry');await window.frame();});
    const removed=await page.evaluate(()=>window.pixel());
    assert.deepEqual(removed,withoutDepth,'removing the style layer must hide depth instead of reverting to fallback depth paint');
    await page.evaluate(async()=>{window.background='carto';await window.frame();});
    const carto=await page.evaluate(()=>window.pixel());
    const cartoFill=cap==='north'?[170,211,223]:[242,239,233];
    for(let i=0;i<3;i++)assert.ok(Math.abs(carto[i]-cartoFill[i])<=5,
      `${cap}: Carto must retain its independent flat cap palette, got ${carto}`);
    await page.evaluate(async()=>{window.background='satellite';await window.frame();});
    const dark=await page.evaluate(()=>window.pixel());
    assert.ok(dark.slice(0,3).every(v=>v<=5),'Satellite retains black no-imagery polar cap');
    assert.deepEqual(errors,[]);
    assert.ok(!warnings.some(x=>/Polar depth|Polar caps not drawn/.test(x)),warnings.join('\n'));
    console.log(`PASS ${cap}: depth ${depth} m, exact shared palette, toggle/removed layers, Carto/Satellite isolation`);
    await page.close();
  }
} finally {await browser.close();}
