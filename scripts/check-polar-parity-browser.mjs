// Boundary/overlap regression with the real renderer and production polar bundle.
// Ordinary-side GeoJSON and cap-side static tiles describe the same synthetic
// features. No provider requests, acquisition or geographic coverage claim.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {detailTiles} from './polar-features.mjs';
import {CAP_RADIUS, MERCATOR_LIMIT, encodeLine, toPolar} from '../styles/polar.mjs';

const world=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url),'utf8'));
const ids=['background','water','context-transport-airport-area','building-footprints','building-outlines','context-transport-airport-runways','waterway'];
const browser=await launchBrowser();
const receipts=[];
try {
  for(const cap of ['north','south']) {
    const sign=cap==='north'?1:-1, edge=MERCATOR_LIMIT;
    const ring=(west,east,lo,hi)=>[[west,sign*lo],[east,sign*lo],[east,sign*hi],[west,sign*hi],[west,sign*lo]];
    const apron=ring(-0.08,0.08,edge-0.016,edge+0.016), building=ring(-0.04,0.04,edge-0.012,edge+0.012);
    const strip=lon=>[[lon,sign*(edge-0.016)],[lon,sign*(edge+0.016)]];
    const geo=points=>points.map(([lon,lat])=>({lon,lat}));
    const details=detailTiles(cap,[
      {type:'way',id:1,tags:{aeroway:'apron'},geometry:geo(apron)},
      {type:'way',id:2,tags:{building:'yes'},geometry:geo(building)},
      {type:'way',id:3,tags:{waterway:'stream'},geometry:geo(strip(0))},
      {type:'way',id:4,tags:{highway:'service'},geometry:geo(strip(0.055))},
    ]);
    const clip=points=>points.map(([lon,lat])=>[lon,sign*Math.min(edge,Math.abs(lat))]);
    const features=[['apron',apron,'Polygon'],['building',building,'Polygon'],['runway',strip(0),'LineString'],['waterway',strip(0),'LineString']]
      .map(([kind,points,type])=>({type:'Feature',properties:{kind,class:kind==='waterway'?'stream':kind},geometry:{type,coordinates:type==='Polygon'?[clip(points)]:clip(points)}}));
    const data=new Map([
      [`${cap}-index.json`,{cap,radius:CAP_RADIUS,units:{metric:[]},carto:{from:10,n:4,tiles:[...details.keys()]}}],
      [`${cap}-features.json`,{water:[],iceShelves:[],places:[],runways:[encodeLine(strip(0).map(point=>toPolar(cap,point)).map(([x,y])=>[x,sign===1?Math.max(y,-CAP_RADIUS):Math.min(y,CAP_RADIUS)]))]}],
      ...[...details].map(([key,value])=>[`${cap}-carto-${key}.json`,value]),
    ]);
    const layers=world.layers.filter(layer=>ids.includes(layer.id)).map(layer=>{
      const copy={id:layer.id,type:layer.type,paint:structuredClone(layer.paint)};
      if(copy.type!=='background'){
        copy.source='fixture';
        const kinds={'water':[],'context-transport-airport-area':['apron'],'building-footprints':['building'],'building-outlines':['building'],'context-transport-airport-runways':['runway','taxiway'],'waterway':['waterway']};
        copy.filter=['in',['get','kind'],['literal',kinds[copy.id]]];
      }
      return copy;
    });
    const page=await browser.newPage({viewport:{width:1000,height:800}}), errors=[], warnings=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='warning')warnings.push(message.text());});
    await page.route('**/parity-fixture/**',route=>{
      const value=data.get(new URL(route.request().url()).pathname.split('/').at(-1));
      return route.fulfill({status:value?200:404,contentType:'application/json',body:JSON.stringify(value||{})});
    });
    const style={version:8,transition:{duration:0,delay:0},projection:{type:'globe'},sources:{fixture:{type:'geojson',data:{type:'FeatureCollection',features},tolerance:0,maxzoom:22}},layers};
    await page.route('**/polar-parity.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><body style="margin:0"><div id="map" style="width:100vw;height:100vh"></div>
      <script src="vendor/maplibre-gl-5.24.0-atlas.1.js"></script><script type="module">
      import {PolarLayer} from './vendor/polar-layer.js';
      import {allowPolarCentres} from './globe-drag.mjs';
      window.background='map';window.terrain=false;
      const map=window.map=new maplibregl.Map({container:'map',center:[0,0],zoom:2,style:${JSON.stringify(style)},canvasContextAttributes:{preserveDrawingBuffer:true}});
      allowPolarCentres(map,maplibregl.LngLat,()=>1);
      map.on('load',()=>{const layer=window.layer=new PolarLayer({data:new URL('./parity-fixture/',location.href),units:()=> 'metric',relief:()=>window.terrain,palette:()=>window.background,imagery:()=>['satellite','hybrid'].includes(window.background)});map.addLayer(layer);map.jumpTo({center:[0,${sign*edge}],zoom:15+Math.log2(Math.cos(${edge}*Math.PI/180))});});
      window.frame=()=>new Promise(resolve=>{map.once('render',()=>{map.getCanvas().getContext('webgl2').finish();resolve();});map.triggerRepaint();});
      window.pixel=point=>{const gl=map.getCanvas().getContext('webgl2'),at=map.project(point),out=new Uint8Array(4);gl.readPixels(Math.round(at.x),gl.drawingBufferHeight-1-Math.round(at.y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,out);return [...out];};
      </script>`}));
    await page.goto('http://127.0.0.1:4173/polar-parity.html');
    await page.waitForFunction(()=>window.layer&&[...window.layer.tiles.values()].some(tile=>!tile.loading&&!tile.failed)&&window.map.isSourceLoaded('fixture'));
    await page.evaluate(()=>new Promise(resolve=>{window.map.once('idle',resolve);window.map.triggerRepaint();}));
    await page.evaluate(()=>window.frame());
    await mkdir('browser-review',{recursive:true});
    await page.screenshot({path:`browser-review/polar-boundary-${cap}-authored.png`});
    // Opaque diagnostic colours isolate ordering from the authored palette's
    // subtle blends. Interior fill/line pixels must equal exact RGBA bytes.
    await page.evaluate(()=>{
      const paint=(id,values)=>{for(const [key,value]of Object.entries(values))window.map.setPaintProperty(id,key,value);};
      paint('background',{'background-color':'#f2f1e9'});paint('water',{'fill-color':'#f2f1e9'});
      paint('context-transport-airport-area',{'fill-color':'#00ff00','fill-opacity':1});
      paint('building-footprints',{'fill-color':'#ff0000','fill-opacity':1});
      paint('building-outlines',{'line-opacity':0});
      paint('context-transport-airport-runways',{'line-color':['case',['==',['get','class'],'runway'],'#0000ff','#00ffff'],'line-opacity':1,'line-width':12});
      paint('waterway',{'line-color':'#ffff00','line-opacity':0,'line-width':12});
    });
    await page.evaluate(()=>window.frame());
    await page.screenshot({path:`browser-review/polar-boundary-${cap}-overlaps.png`});
    const check=async(lon,expected,label)=>{
      const pixels=await page.evaluate(({lon,sign,edge})=>[-0.004,0.004].map(delta=>window.pixel([lon,sign*(edge+delta)])),{lon,sign,edge});
      for(const [i,pixel] of pixels.entries())assert.deepEqual(pixel,expected,`${cap} ${label}: ${i?'cap':'ordinary'} side of ${sign*edge}, pixels ${JSON.stringify(pixels)}`);
      receipts.push({cap,label,pixels});
    };
    await check(0.055,[0,255,0,255],'apron without Carto road');
    await check(-0.02,[255,0,0,255],'building over apron');
    await check(0,[0,0,255,255],'runway over building and apron');
    await page.evaluate(()=>window.map.setPaintProperty('context-transport-airport-runways','line-color','#cc33ff'));
    await page.evaluate(()=>window.frame());
    await check(0,[204,51,255,255],'live runway paint change');
    await page.evaluate(()=>window.map.setPaintProperty('waterway','line-opacity',1));
    await page.evaluate(()=>window.frame());
    await check(0,[255,255,0,255],'waterway over building and runway');
    await page.evaluate(()=>{window.map.setLayoutProperty('context-transport-airport-runways','visibility','none');window.map.moveLayer('waterway','building-footprints');});
    await page.evaluate(()=>window.frame());
    await check(0,[255,0,0,255],'live layer order change');
    await page.evaluate(()=>{window.map.setLayoutProperty('context-transport-airport-runways','visibility','none');window.map.setLayoutProperty('context-transport-airport-area','visibility','none');});
    await page.evaluate(()=>window.frame());
    await check(0,[255,0,0,255],'transport off');
    await page.screenshot({path:`browser-review/polar-boundary-${cap}-diagnostic.png`});
    for(const mode of ['satellite','hybrid']){
      await page.evaluate(mode=>{window.background=mode;},mode);await page.evaluate(()=>window.frame());
      const pixel=await page.evaluate(({sign,edge})=>window.pixel([0,sign*(edge+0.004)]),{sign,edge});
      assert.deepEqual(pixel,[0,0,0,255],`${cap} ${mode} no-imagery cap`);
      assert.equal(await page.evaluate(()=>[...window.layer.tiles.values()].some(tile=>tile.detailed)),false);
    }
    await page.evaluate(({sign,edge})=>{window.background='map';window.map.jumpTo({center:[0,sign*edge],zoom:4+Math.log2(Math.cos(edge*Math.PI/180))});},{sign,edge});
    await page.evaluate(()=>window.frame());
    assert.equal(await page.evaluate(()=>window.layer.broken||false),false);
    await page.screenshot({path:`browser-review/polar-boundary-${cap}-low.png`});
    assert.deepEqual(errors,[]);assert.ok(!warnings.some(w=>w.includes('Polar caps not drawn')),warnings.join('\n'));
    console.log(`PASS ${cap}: exact overlap pixels either side of 85.05°, live paint/order, transport, imagery, low/detail zoom`);
    await page.close();
  }
  await writeFile('browser-review/polar-boundary.json',JSON.stringify(receipts,null,2)+'\n');
} finally {await browser.close();}
