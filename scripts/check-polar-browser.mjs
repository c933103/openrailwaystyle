// Deterministic WebGL coverage: both caps, live Atlas paint changes,
// Map/Carto detail, imagery gating, units and older snapshots. No public
// providers are needed; fixtures exercise the production bundled custom layer.
import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {expression as styleExpression} from '@maplibre/maplibre-gl-style-spec';
import {CAP_RADIUS, encodeLine, fromPolar} from '../styles/polar.mjs';
import {detailTiles} from './polar-features.mjs';
import {depthFixturePng} from './bathymetry-browser-fixture.mjs';

const world=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url),'utf8'));
const contourLayers=world.layers.filter(layer=>['terrain-contours','terrain-seabed-contours','terrain-seabed-contours-close'].includes(layer.id))
  .map(({id,type,paint,minzoom,maxzoom,layout,filter})=>({id,type,source:'empty',paint,minzoom,maxzoom,layout,filter}));

const demPng=depthFixturePng(10,0).toString('base64');
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
      import {allowPolarCentres} from './globe-drag.mjs';
      import {syncHighPitchTileBudget,syncTerrain3D} from './terrain-3d.mjs';
      const dem=Uint8Array.from(atob('${demPng}'),c=>c.charCodeAt(0)).buffer;
      maplibregl.addProtocol('atlas-terrain',async()=>({data:dem.slice(0)}));
      window.background='map';window.units='metric';window.labels=[];
      const map=window.map=new maplibregl.Map({container:'map',center:[0,0],zoom:2,maxPitch:85,maxTileCacheSize:96,projection:{type:'globe'},style:{version:8,projection:{type:'globe'},
        sources:{empty:{type:'geojson',data:{type:'FeatureCollection',features:[]}},terrain3d:{type:'raster-dem',tiles:['atlas-terrain://{z}/{x}/{y}'],tileSize:256,encoding:'terrarium',maxzoom:14}},
        layers:[{id:'background',type:'background',paint:{'background-color':'#f2efe9'}},
          {id:'water',type:'fill',source:'empty',paint:{'fill-color':'#bfd8e0'}},...${JSON.stringify(contourLayers)}]},canvasContextAttributes:{preserveDrawingBuffer:true}});
      allowPolarCentres(map,maplibregl.LngLat,()=>1);
      window.polarErrors=[];
      map.on('error',e=>window.polarErrors.push(e.error?.message||String(e.error)));
      map.on('pitch',()=>{syncHighPitchTileBudget(map);syncTerrain3D(map,true,3);});
      map.on('style.load',()=>syncHighPitchTileBudget(map));
      window.contourSamples={};window.contourDraws=[];
      map.on('load',()=>{window.layer=new PolarLayer({data:new URL('./polar-fixture/',location.href),units:()=>window.units,imagery:()=>['satellite','hybrid'].includes(window.background),palette:()=>window.background,places:p=>window.labels=p});
      const line=window.layer.line.bind(window.layer);window.layer.line=(mesh,...args)=>{if(mesh?.properties){const sample={properties:mesh.properties,opacity:args[2][3],zoom:map.getZoom()};window.contourSamples[JSON.stringify(mesh.properties)]=sample;window.contourDraws.push(sample);}return line(mesh,...args);};
      map.addLayer(window.layer);map.jumpTo({center:[0,${lat}],zoom:15+Math.log2(Math.cos(${lat}*Math.PI/180))});window.loaded=true;});
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
    const activeContour=await page.evaluate(()=>window.map.getZoom()>=11?'terrain-seabed-contours-close':'terrain-seabed-contours');
    const originalOpacity=contourLayers.find(layer=>layer.id===activeContour).paint['line-opacity'];
    await verifyContours(originalOpacity);
    const changedOpacity=['*',0.5,['case',['>', ['get','level'],0],1,0.2],['interpolate',['linear'],['abs',['get','ele']],0,1,3000,0.2]];
    await page.evaluate(({id,expression})=>{window.contourSamples={};window.map.setPaintProperty(id,'line-opacity',expression);window.map.triggerRepaint();},{id:activeContour,expression:changedOpacity});
    await page.waitForFunction(()=>Object.keys(window.contourSamples).length===4);
    await verifyContours(changedOpacity);
    await page.evaluate(({id,expression})=>window.map.setPaintProperty(id,'line-opacity',expression),{id:activeContour,expression:originalOpacity});
    const overlap=await page.evaluate(async()=>{
      const map=window.map;map.setLayerZoomRange('terrain-seabed-contours',5,20);map.setLayerZoomRange('terrain-seabed-contours-close',5);
      map.setPaintProperty('terrain-seabed-contours','line-opacity',0.2);map.setPaintProperty('terrain-seabed-contours-close','line-opacity',0.4);
      window.contourDraws=[];await new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint();});return window.contourDraws.filter(sample=>sample.properties.ele<0);
    });
    assert.equal(overlap.length,6,'three seabed classes/depths draw in each overlapping layer');
    assert.deepEqual(overlap.map(sample=>sample.opacity),[0.2,0.2,0.2,0.4,0.4,0.4]);
    const removed=await page.evaluate(async()=>{
      for(const id of ['terrain-contours','terrain-seabed-contours','terrain-seabed-contours-close'])window.map.removeLayer(id);
      window.contourDraws=[];await new Promise(resolve=>{window.map.once('render',resolve);window.map.triggerRepaint();});return window.contourDraws;
    });
    assert.deepEqual(removed,[],'removed contour layers must not draw fallback paint');
    await page.evaluate(layers=>{for(const layer of layers)window.map.addLayer(layer);},contourLayers);
    const lowZoom=await page.evaluate(async()=>{
      const map=window.map,restore=map.getZoom();map.jumpTo({zoom:8});window.contourDraws=[];
      await new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint();});return {restore,draws:window.contourDraws};
    });
    const negative=lowZoom.draws.filter(sample=>sample.properties.ele<0);
    assert.equal(negative.length,5,'z8 terrain-contours draws all three depths/classes plus two shallow seabed passes');
    const deep=negative.filter(sample=>sample.properties.ele===-3000);assert.equal(deep.length,1);
    const landOpacity=styleExpression.createExpression(contourLayers.find(layer=>layer.id==='terrain-contours').paint['line-opacity']);
    assert.equal(landOpacity.result,'success');
    assert.ok(Math.abs(deep[0].opacity-landOpacity.value.evaluate({zoom:8},{type:'LineString',properties:deep[0].properties}))<1e-8,'the deep range receives the actual terrain-contours opacity');
    await page.evaluate(zoom=>window.map.jumpTo({zoom}),lowZoom.restore);
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
    // Reproduce the reported pole failure at the *actual* ±90° caps,
    // not merely ±88.5°. Retain the legacy ±85.05° edge shader tests.
    const poleOut=[];
    await page.evaluate(()=>{
      const layer=window.layer,orig=layer.fill.bind(layer);
      window.capDiscDraws={north:0,south:0};
      layer.fill=(mesh,...args)=>{
        for(const side of ['north','south'])if(mesh===layer.caps[side].disc)window.capDiscDraws[side]++;
        return orig(mesh,...args);
      };
    });
    for(const latitude of [85.10,88.5,89.9,89.999,89.99999,90]){
      for(const pitch of [0,60,82,85]){
        const state=await page.evaluate(({latitude,pitch,sign})=>{
          const map=window.map,zoomForLat=(z,oldLat,newLat)=>
            z+Math.log2(Math.cos((Math.min(90-1e-8,Math.abs(newLat)))*Math.PI/180)/Math.cos(oldLat*Math.PI/180));
          const lat=sign*latitude;
          // Keep approximately one ground-scale zoom across the full cap.
          // The globe's special near-pole minZoom is installed already.
          const cameraZoom=zoomForLat(12,0,lat);
          map.jumpTo({center:[0,lat],zoom:cameraZoom,pitch,bearing:0});
          return {center:map.getCenter().toArray(),zoom:map.getZoom(),pitch:map.getPitch(),
            requested:lat,requestedZoom:cameraZoom};
        },{latitude,pitch,sign:cap==='north'?1:-1});
        await page.evaluate(()=>new Promise(resolve=>{window.map.once('render',resolve);window.map.triggerRepaint();}));
        const result=await page.evaluate(()=>{
          const map=window.map,cap=map.getCenter().lat>0?'north':'south',projected=map.project(map.getCenter());
          return {center:map.getCenter().toArray(),zoom:map.getZoom(),pitch:map.getPitch(),
            terrain:map.getTerrain(),broken:window.layer.broken||false,
            visible:window.layer.visible(),draws:window.capDiscDraws[cap],
            screen:[projected.x,projected.y],errors:window.polarErrors.slice(-8)};
        });
        poleOut.push({latitude,pitch,state,result});
        console.log('Polar 3D at pole:',cap,latitude,pitch,JSON.stringify({state,result}));
        assert.ok(Math.abs(Math.abs(result.center[1])-Math.min(latitude,90-1e-8))<0.02,
          `${cap}: pole centre was rejected or moved unexpectedly at ${latitude}°`);
        assert.ok(Number.isFinite(result.zoom)&&Number.isFinite(result.screen[0])&&Number.isFinite(result.screen[1]),
          `${cap}: invalid polar projection: ${JSON.stringify(result)}`);
        assert.ok(Math.abs(result.pitch-pitch)<0.01,`${cap}: tilt clamped at ${latitude}°`);
        assert.equal(result.broken,false,`${cap}: polar shader failed at ${latitude}°/${pitch}°`);
        assert.deepEqual(result.errors,[],`${cap}: renderer errors at ${latitude}°/${pitch}°`);
        assert.deepEqual(errors,[],`${cap}: page errors at ${latitude}°/${pitch}°`);
        if(pitch>=82){
          await page.screenshot({path:`browser-review/polar-3d-${cap}-lat${latitude}-pitch${pitch}.png`});
        }
      }
    }
    await writeFile(`browser-review/polar-3d-${cap}-pole-test.json`,JSON.stringify(poleOut,null,2)+'\n');
    // The actual regression: the 3D button used to compare a pole's
    // negative latitude-relative camera zoom with 12.3, then jump straight
    // to z12.3 (sometimes over twenty zoom levels). Exercise it on the
    // REAL MapLibre globe with a 12.0 physical ground-zoom opening.
    for(const latitude of [88.5,89.9,89.99999,90]){
      const focus=await page.evaluate(async ({sign,latitude})=>{
        const {zoomForLatitude,globeGroundZoom}=await import('./globe-drag.mjs');
        const {terrain3DViewTarget}=await import('./terrain-3d.mjs');
        const map=window.map,lat=sign*latitude;
        map.jumpTo({center:[0,lat],zoom:zoomForLatitude(12,0,lat),pitch:0});
        const before=map.getZoom(),trueGround=globeGroundZoom(before,map.getCenter().lat);
        const target=terrain3DViewTarget({zoom:before,detail:0,globe:true,latitude:map.getCenter().lat});
        map.easeTo({...target,duration:0});
        return {before,after:map.getZoom(),target,groundBefore:trueGround,
          groundAfter:globeGroundZoom(map.getZoom(),map.getCenter().lat),
          pitch:map.getPitch(),lat:map.getCenter().lat};
      },{latitude,sign:cap==='north'?1:-1});
      assert.ok(Math.abs(focus.after-focus.before-0.3)<0.03,
        `${cap} ${latitude}°: tapping 3D must add only 0.3 zoom levels, not a massive pole jump: ${JSON.stringify(focus)}`);
      assert.ok(Math.abs(focus.groundAfter-12.3)<0.03);
      assert.equal(focus.pitch,60);
      await page.evaluate(()=>new Promise(resolve=>{window.map.once('render',resolve);window.map.triggerRepaint();}));
      assert.equal(await page.evaluate(()=>window.layer.broken||false),false,
        `${cap}: real 3D focus must keep the polar shader running`);
    }
    await page.evaluate(()=>{window.map.setPitch(0);window.map.setTerrain(null);});
    assert.deepEqual(errors,[]);assert.ok(!warnings.some(w=>/Polar caps not drawn/.test(w)),warnings.join('\n'));
    console.log(`PASS ${cap}: actual contour GPU weights/classes and live expressions, Atlas live paint, Map/Carto detail, Carto pixels/labels, feet, imagery cancellation and old snapshot`);
    await page.close();
  }
} finally {await browser.close();}
