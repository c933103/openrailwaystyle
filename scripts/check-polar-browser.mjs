// Deterministic WebGL coverage: both caps, live Atlas paint changes,
// Map/Carto detail, imagery gating, units and older snapshots. No public
// providers are needed; fixtures exercise the production bundled custom layer.
import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {expression as styleExpression} from '@maplibre/maplibre-gl-style-spec';
import {CAP_RADIUS, encodeLine, fromPolar} from '../styles/polar.mjs';
import {detailTiles} from './polar-features.mjs';

const world=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url),'utf8'));
const contourLayers=world.layers.filter(layer=>['terrain-contours','terrain-seabed-contours','terrain-seabed-contours-close'].includes(layer.id))
  .map(({id,type,paint})=>({id,type,source:'empty',paint}));

const browser = await launchBrowser({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try {
  for (const cap of ['south','north']) {
    const page = await browser.newPage({viewport:{width:1000,height:700}}), errors = [], warnings = [], requests = [];
    page.on('pageerror', e=>errors.push(e.message));
    page.on('console', m=>{if(m.type()==='warning')warnings.push(m.text());});
    const lat = cap === 'south' ? -88.5 : 88.5, y = cap === 'south' ? 167 : -167;
    const geometry = points=>points.map(p=>{const [lon,lat]=fromPolar(cap,p);return {lon,lat};});
    const detail = detailTiles(cap, [
      {type:'way',id:1,tags:{building:'yes'},geometry:geometry([[0.5,y],[0.65,y],[0.65,y+0.15],[0.5,y+0.15],[0.5,y]])},
      {type:'way',id:2,tags:{highway:'service'},geometry:geometry([[-4,y-0.25],[4,y-0.25]])},
      {type:'node',id:3,...geometry([[0.6,y+0.1]])[0],tags:{man_made:'research_station',name:'Fixture research station'}},
    ]);
    const data = new Map(), bands = [1,2,4].map((n,i)=>({from:[0,9,11][i],n,tiles:i===0?['0-0']:[`1-${cap==='south'?1:0}`, ...(i===2?[`2-${cap==='south'?2:1}`]:[])]}));
    const index={cap,radius:CAP_RADIUS,units:{metric:bands,imperial:bands},carto:{from:10,n:4,tiles:[...detail.keys()]}};
    data.set(`${cap}-index.json`,index);
    data.set(`${cap}-features.json`,{water:[],iceShelves:[],runways:[],places:[]});
    for(const units of ['metric','imperial'])for(const [i,band]of bands.entries())for(const key of band.tiles)
      data.set(`${cap}-${units}-${i}-${key}.json`,{lines:[[50,1],[-100,0],[-100,1],[-3000,0]].map(([ele,level],j)=>[ele*(units==='metric'?1:3.28084),level,...encodeLine([[-4,y+0.3+j*0.1],[0,y+0.6+j*0.1],[4,y+0.3+j*0.1]])])});
    for(const [key,tile]of detail)data.set(`${cap}-carto-${key}.json`,tile);
    await page.route('**/polar-fixture/**',async route=>{
      const name=new URL(route.request().url()).pathname.split('/').at(-1);requests.push(name);
      const value=data.get(name);
      await route.fulfill({status:value?200:404,contentType:'application/json',body:JSON.stringify(value||{})});
    });
    await page.route('**/polar-check.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body style="margin:0"><div id="map" style="width:100vw;height:100vh"></div>
      <script src="vendor/maplibre-gl-5.24.0-atlas.1.js"></script>
      <script type="module">
      import {PolarLayer} from './vendor/polar-layer.js';
      import {allowPolarCentres,globeGroundZoom} from './globe-drag.mjs';
      window.background='map';window.units='metric';window.labels=[];
      const map=window.map=new maplibregl.Map({container:'map',center:[0,0],zoom:2,projection:{type:'globe'},style:{version:8,projection:{type:'globe'},
        sources:{empty:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},
        layers:[{id:'background',type:'background',paint:{'background-color':'#f2efe9'}},
          {id:'water',type:'fill',source:'empty',paint:{'fill-color':'#bfd8e0'}},...${JSON.stringify(contourLayers)}]},canvasContextAttributes:{preserveDrawingBuffer:true}});
      allowPolarCentres(map,maplibregl.LngLat,()=>1);
      window.contourSamples={};
      map.on('load',()=>{window.layer=new PolarLayer({data:new URL('./polar-fixture/',location.href),units:()=>window.units,imagery:()=>['satellite','hybrid'].includes(window.background),palette:()=>window.background,places:p=>window.labels=p});
      const line=window.layer.line.bind(window.layer);window.layer.line=(mesh,...args)=>{if(mesh?.properties)window.contourSamples[JSON.stringify(mesh.properties)]={properties:mesh.properties,opacity:args[2][3],zoom:globeGroundZoom(map.getZoom(),map.getCenter().lat)};return line(mesh,...args);};
      map.addLayer(window.layer);map.jumpTo({center:[0,${lat}],zoom:14+Math.log2(Math.cos(${lat}*Math.PI/180))});window.loaded=true;});
      </script></body></html>`}));
    await page.goto('http://127.0.0.1:4173/polar-check.html');
    await page.waitForFunction(()=>window.loaded&&window.layer?.caps?.[window.map.getCenter().lat>0?'north':'south']?.index,null,{timeout:60000});
    await page.waitForFunction(()=>[...window.layer.tiles.values()].some(t=>!t.loading&&!t.failed));
    await page.waitForFunction(()=>[...window.layer.tiles.entries()].some(([key,t])=>key.includes('carto')&&!t.loading&&!t.failed));
    assert.ok(requests.some(n=>/-metric-2-/.test(n)), 'Map requests its fine contour band');
    assert.ok(requests.some(n=>n.includes('carto')), 'Map reuses the static OSM detail asset');
    await page.waitForFunction(()=>Object.keys(window.contourSamples).length===4);
    const verifyContours=async expression=>{
      const samples=await page.evaluate(()=>Object.values(window.contourSamples));
      for(const sample of samples.filter(s=>s.properties.ele<0)){
        const compiled=styleExpression.createExpression(expression);assert.equal(compiled.result,'success');
        const expected=compiled.value.evaluate({zoom:sample.zoom},{type:'LineString',properties:sample.properties});
        assert.ok(Math.abs(sample.opacity-expected)<1e-8,`${cap}: actual GPU opacity ${sample.opacity} != MapLibre ${expected}`);
      }
    };
    const originalOpacity=contourLayers.find(layer=>layer.id==='terrain-seabed-contours-close').paint['line-opacity'];
    await verifyContours(originalOpacity);
    const changedOpacity=['*',0.5,['case',['>', ['get','level'],0],1,0.2],['interpolate',['linear'],['abs',['get','ele']],0,1,3000,0.2]];
    await page.evaluate(expression=>{window.contourSamples={};window.map.setPaintProperty('terrain-seabed-contours-close','line-opacity',expression);window.map.triggerRepaint();},changedOpacity);
    await page.waitForFunction(()=>Object.keys(window.contourSamples).length===4);
    await verifyContours(changedOpacity);
    await page.evaluate(expression=>window.map.setPaintProperty('terrain-seabed-contours-close','line-opacity',expression),originalOpacity);
    // Observe the production fill shader's actual input after a live paint
    // update. Do not substitute a mock fill; it must still draw the pixels.
    await page.evaluate(cap=>{
      const layer=window.layer, state=layer.caps[cap], original=layer.fill.bind(layer);
      window.capColours=[];
      layer.fill=(mesh,...args)=>{if(mesh===state.disc)window.capColours.push(args.at(-1));return original(mesh,...args);};
      window.map.setPaintProperty(cap==='south'?'background':'water',
        cap==='south'?'background-color':'fill-color','#123456');
      window.map.triggerRepaint();
    },cap);
    await page.waitForFunction(()=>window.capColours.some(c=>Math.abs(c[0]*255-18)<0.1&&Math.abs(c[1]*255-52)<0.1&&Math.abs(c[2]*255-86)<0.1));
    await page.evaluate(()=>{window.background='carto';window.map.triggerRepaint();});
    await page.waitForFunction(()=>window.labels.some(p=>p.name==='Fixture research station')&&[...window.layer.tiles.entries()].some(([key,t])=>key.includes('carto')&&!t.loading&&!t.failed));
    assert.ok(requests.some(n=>/-metric-2-/.test(n)), 'Map/Carto share a fine contour band');
    await page.evaluate(async()=>{await new Promise(r=>{window.map.once('render',r);window.map.triggerRepaint();});window.map.getCanvas().getContext('webgl2').finish();});
    await mkdir('browser-review',{recursive:true});
    await page.screenshot({path:`browser-review/polar-carto-${cap}.png`});
    const coloured=await page.evaluate(()=>{const gl=window.map.getCanvas().getContext('webgl2'),pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let count=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-217)<4&&Math.abs(pixels[i+1]-208)<4&&Math.abs(pixels[i+2]-201)<4)count++;return count;});
    assert.ok(coloured>10, `Carto building fill must produce real WebGL pixels (${coloured})`);
    await page.evaluate(()=>{window.units='imperial';window.map.triggerRepaint();});
    await page.waitForFunction(()=>[...window.layer.tiles.entries()].some(([k,t])=>k.includes('-imperial-2-')&&!t.loading&&!t.failed));
    await page.evaluate(()=>{window.background='map';window.map.triggerRepaint();});
    await page.waitForFunction(()=>window.layer.detailPending&&window.labels.length===0);
    for(const background of ['satellite','hybrid']) {
      const before=requests.length;
      await page.evaluate(background=>{window.background=background;window.map.triggerRepaint();},background);
      await page.waitForFunction(()=>!window.layer.detailPending&&![...window.layer.tiles.values()].some(t=>t.detailed)&&window.labels.length===0);
      assert.ok(!requests.slice(before).some(n=>n.includes('carto')||/-(metric|imperial)-[12]-/.test(n)),`${background} must not fetch detail`);
    }
    // Existing deployed snapshots may predate Carto/Map detail.
    await page.evaluate(()=>{const cap=window.map.getCenter().lat>0?'north':'south',state=window.layer.caps[cap];delete state.index.carto;for(const units of ['metric','imperial'])state.index.units[units]=state.index.units[units].slice(0,1);window.background='map';window.map.triggerRepaint();});
    await page.waitForFunction(()=>!window.layer.broken&&[...window.layer.visibleKeys].every(k=>k.includes('-0-')));
    await page.evaluate(()=>{window.background='carto';window.map.triggerRepaint();});
    await page.waitForFunction(()=>!window.layer.broken&&[...window.layer.visibleKeys].every(k=>k.includes('-0-')));
    assert.deepEqual(errors,[]);assert.ok(!warnings.some(w=>/Polar caps not drawn/.test(w)),warnings.join('\n'));
    console.log(`PASS ${cap}: actual contour GPU weights/classes and live expressions, Atlas live paint, Map/Carto detail, Carto pixels/labels, feet, imagery cancellation and old snapshot`);
    await page.close();
  }
} finally {await browser.close();}
