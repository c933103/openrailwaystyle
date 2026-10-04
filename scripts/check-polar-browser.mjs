// Deterministic WebGL coverage: both caps, view gating, unit switching and
// coarse-only snapshot compatibility. No railway/DEM provider availability
// is needed; fixtures exercise the production bundled custom layer.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {CAP_RADIUS, encodeLine, fromPolar} from '../styles/polar.mjs';
import {detailTiles} from './polar-features.mjs';

const browser = await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
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
      data.set(`${cap}-${units}-${i}-${key}.json`,{lines:[[units==='metric'?50:100,1,...encodeLine([[-4,y+0.3],[0,y+0.6],[4,y+0.3]])]]});
    for(const [key,tile]of detail)data.set(`${cap}-carto-${key}.json`,tile);
    await page.route('**/polar-fixture/**',async route=>{
      const name=new URL(route.request().url()).pathname.split('/').at(-1);requests.push(name);
      const value=data.get(name);
      await route.fulfill({status:value?200:404,contentType:'application/json',body:JSON.stringify(value||{})});
    });
    // Optional local CDN copy makes repeated local checks independent of CDN.
    if(process.env.MAPLIBRE_TEST_JS)await page.route('**/maplibre-gl.js',async route=>route.fulfill({contentType:'text/javascript',body:await readFile(process.env.MAPLIBRE_TEST_JS,'utf8')}));
    await page.route('**/polar-check.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body style="margin:0"><div id="map" style="width:100vw;height:100vh"></div>
      <script src="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
      <script type="module">
      import {PolarLayer} from './vendor/polar-layer.js';
      import {allowPolarCentres} from './globe-drag.mjs';
      window.background='map';window.units='metric';window.labels=[];
      const map=window.map=new maplibregl.Map({container:'map',center:[0,0],zoom:2,projection:{type:'globe'},style:{version:8,projection:{type:'globe'},sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#f2efe9'}}]},canvasContextAttributes:{preserveDrawingBuffer:true}});
      allowPolarCentres(map,maplibregl.LngLat,()=>1);
      map.on('load',()=>{window.layer=new PolarLayer({data:new URL('./polar-fixture/',location.href),units:()=>window.units,imagery:()=>['satellite','hybrid'].includes(window.background),palette:()=>window.background,places:p=>window.labels=p});map.addLayer(window.layer);map.jumpTo({center:[0,${lat}],zoom:14+Math.log2(Math.cos(${lat}*Math.PI/180))});window.loaded=true;});
      </script></body></html>`}));
    await page.goto('http://127.0.0.1:4173/polar-check.html');
    await page.waitForFunction(()=>window.loaded&&window.layer?.caps?.[window.map.getCenter().lat>0?'north':'south']?.index,null,{timeout:60000});
    await page.waitForFunction(()=>[...window.layer.tiles.values()].some(t=>!t.loading&&!t.failed));
    assert.ok(!requests.some(n=>n.includes('carto')||/-metric-[12]-/.test(n)), 'Map must request only coarse polar data');
    await page.evaluate(()=>{window.background='carto';window.map.triggerRepaint();});
    await page.waitForFunction(()=>window.labels.some(p=>p.name==='Fixture research station')&&[...window.layer.tiles.entries()].some(([key,t])=>key.includes('carto')&&!t.loading&&!t.failed));
    assert.ok(requests.some(n=>/-metric-2-/.test(n)), 'Carto requests its fine contour band');
    await page.evaluate(async()=>{await new Promise(r=>{window.map.once('render',r);window.map.triggerRepaint();});window.map.getCanvas().getContext('webgl2').finish();});
    await mkdir('browser-review',{recursive:true});
    await page.screenshot({path:`browser-review/polar-carto-${cap}.png`});
    const coloured=await page.evaluate(()=>{const gl=window.map.getCanvas().getContext('webgl2'),pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let count=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-217)<4&&Math.abs(pixels[i+1]-208)<4&&Math.abs(pixels[i+2]-201)<4)count++;return count;});
    assert.ok(coloured>10, `Carto building fill must produce real WebGL pixels (${coloured})`);
    await page.evaluate(()=>{window.units='imperial';window.map.triggerRepaint();});
    await page.waitForFunction(()=>[...window.layer.tiles.entries()].some(([k,t])=>k.includes('-imperial-2-')&&!t.loading&&!t.failed));
    for(const background of ['map','satellite','hybrid']) {
      const before=requests.length;
      await page.evaluate(background=>{window.background=background;window.map.triggerRepaint();},background);
      await page.waitForFunction(()=>!window.layer.detailPending&&![...window.layer.tiles.values()].some(t=>t.detailed)&&window.labels.length===0);
      assert.ok(!requests.slice(before).some(n=>n.includes('carto')||/-(metric|imperial)-[12]-/.test(n)),`${background} must not fetch detail`);
    }
    // Existing deployed snapshots may predate Carto detail.
    await page.evaluate(()=>{const cap=window.map.getCenter().lat>0?'north':'south',state=window.layer.caps[cap];delete state.index.carto;for(const units of ['metric','imperial'])state.index.units[units]=state.index.units[units].slice(0,1);window.background='carto';window.map.triggerRepaint();});
    await page.waitForFunction(()=>!window.layer.broken&&[...window.layer.visibleKeys].every(k=>k.includes('-0-')));
    assert.deepEqual(errors,[]);assert.ok(!warnings.some(w=>/Polar caps not drawn/.test(w)),warnings.join('\n'));
    console.log(`PASS ${cap}: coarse-only railway views, Carto detail pixels/labels, feet, cancellation and old snapshot`);
    await page.close();
  }
} finally {await browser.close();}
