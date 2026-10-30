// First-party, fixture-only WebGL acceptance for polar bathymetry. Real
// production shader + polar depth PNG; zero public-provider requests.
// Both poles, four sea-depth palette anchors, missing/hidden style and Carto.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {DEPTH_COLOURS, depthColour} from '../styles/bathymetry.mjs';
import {CAP_RADIUS, POLAR_DEPTH_FORMAT} from '../styles/polar.mjs';
import {png, encodePolarDepth} from './polar-depth.mjs';
import {depthFixturePng} from './bathymetry-browser-fixture.mjs';
const demPng=depthFixturePng(10,0).toString('base64');

const browser=await launchBrowser();
try {
  for(const cap of ['south','north']) for(const depth of [20,3000]) {
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
      import {allowPolarCentres,zoomForLatitude} from './globe-drag.mjs';
      import {syncTerrain3D,syncHighPitchTileBudget} from './terrain-3d.mjs';
      const dem=Uint8Array.from(atob('${demPng}'),c=>c.charCodeAt(0)).buffer;
      maplibregl.addProtocol('atlas-terrain',async()=>({data:dem.slice(0)}));
      window.zoomForLatitude=zoomForLatitude;
      window.background='map';window.draws=0;
      const map=window.map=new maplibregl.Map({container:'map',center:[0,0],zoom:2,maxPitch:85,maxTileCacheSize:96,
        projection:{type:'globe'},style:{version:8,projection:{type:'globe'},sources:{
          terrain3d:{type:'raster-dem',tiles:['atlas-terrain://{z}/{x}/{y}'],tileSize:256,encoding:'terrarium',maxzoom:14},
          empty:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},
          layers:[{id:'background',type:'background',paint:{'background-color':'#f2f1e9'}},
            {id:'water',type:'fill',source:'empty',paint:{'fill-color':'#bfd8e0'}},
            // A visibility-only stand-in; the custom layer itself carries
            // the real bathymetry pixels and no raster tile is downloaded.
            {id:'terrain-bathymetry',type:'fill',source:'empty',paint:{'fill-color':'#ffffff'}}]},
          canvasContextAttributes:{preserveDrawingBuffer:true}});
      allowPolarCentres(map,maplibregl.LngLat,()=>1);
      window.rendererErrors=[];
      map.on('error',e=>window.rendererErrors.push(e.error?.message||String(e.error)));
      map.on('pitch',()=>{syncHighPitchTileBudget(map);syncTerrain3D(map,true,3);});
      map.on('load',()=>{
        const layer=window.layer=new PolarLayer({data:new URL('./depth-fixture/',location.href),units:()=> 'metric',
          relief:()=>false,palette:()=>window.background,imagery:()=>['satellite','hybrid'].includes(window.background)});
        const draw=layer.drawDepth.bind(layer);
        layer.drawDepth=(...args)=>{
          window.draws++;const result=draw(...args),gl=map.getCanvas().getContext('webgl2');
          const point=map.transform.locationToScreenPoint(map.getCenter()),pixel=new Uint8Array(4);
          gl.readPixels(Math.round(point.x),gl.drawingBufferHeight-1-Math.round(point.y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
          window.depthDraw={pixel:[...pixel],depthTest:gl.isEnabled(gl.DEPTH_TEST),stencilTest:gl.isEnabled(gl.STENCIL_TEST),scissorTest:gl.isEnabled(gl.SCISSOR_TEST),scissor:[...gl.getParameter(gl.SCISSOR_BOX)],colourMask:gl.getParameter(gl.COLOR_WRITEMASK),viewport:[...gl.getParameter(gl.VIEWPORT)],
            projection:{...args[2],mainMatrix:[...args[2].mainMatrix],fallbackMatrix:[...args[2].fallbackMatrix]},
            opacity:args[3],glError:gl.getError()};
          // On-demand diagnostics only, after the original framebuffer was
          // recorded. Never feed diagnostic redraws into the acceptance gate.
          window.probeDepth=()=>{
            const read=()=>{gl.readPixels(Math.round(point.x),gl.drawingBufferHeight-1-Math.round(point.y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return [...pixel];};
            layer.fill(args[0].disc,args[1],args[2],[1,0,1,1]);
            const solid=read();
            draw(...args);const repaint=read();
            const fb=gl.createFramebuffer(),previous=gl.getParameter(gl.FRAMEBUFFER_BINDING);
            gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,args[0].depth,0);
            const texture=new Uint8Array(4);gl.readPixels(4,4,1,1,gl.RGBA,gl.UNSIGNED_BYTE,texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER,previous);gl.deleteFramebuffer(fb);
            const sourceProgram=layer.program('depth',args[1]).program;
            const program=gl.createProgram();
            for(const old of gl.getAttachedShaders(sourceProgram)){
              const shader=gl.createShader(gl.getShaderParameter(old,gl.SHADER_TYPE));
              gl.shaderSource(shader,gl.getShaderSource(old));gl.compileShader(shader);gl.attachShader(program,shader);gl.deleteShader(shader);
            }
            gl.transformFeedbackVaryings(program,['gl_Position'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);gl.useProgram(program);
            for(const name of ['u_projection_matrix','u_projection_fallback_matrix'])gl.uniformMatrix4fv(gl.getUniformLocation(program,name),false,args[2][name==='u_projection_matrix'?'mainMatrix':'fallbackMatrix']);
            gl.uniform4fv(gl.getUniformLocation(program,'u_projection_tile_mercator_coords'),args[2].tileMercatorCoords);
            gl.uniform4fv(gl.getUniformLocation(program,'u_projection_clipping_plane'),args[2].clippingPlane);
            gl.uniform1f(gl.getUniformLocation(program,'u_projection_transition'),args[2].projectionTransition);
            const feedback=gl.createBuffer();gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,feedback);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,3457*16,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,feedback);
            const location=gl.getAttribLocation(program,'a_pos');gl.bindBuffer(gl.ARRAY_BUFFER,args[0].reliefMesh.buffers[0]);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,16,0);
            gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,3457);gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);
            const positions=new Float32Array(3457*4);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,positions);
            gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.deleteBuffer(feedback);gl.deleteProgram(program);
            return {solid,repaint,texture:[...texture],vertices:[3204,3349,3205].map(index=>({index,clip:[...positions.slice(index*4,index*4+4)]})),glError:gl.getError()};
          };return result;
        };
        map.addLayer(layer);map.jumpTo({center:[0,${latitude}],zoom:15+Math.log2(Math.cos(${latitude}*Math.PI/180))});
      });
      window.frame=()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Polar terrain frame did not settle within 30 seconds')),30000);map.once('idle',()=>{clearTimeout(timeout);map.getCanvas().getContext('webgl2').finish();resolve();});map.triggerRepaint();});
      // The polar shader draws the zero-altitude globe surface. map.project
      // includes terrain elevation and can point at a different (synthetic
      // seabed) surface at high pitch. Sample the actual cap coordinate,
      // retaining both projections as diagnostics; terrain stays enabled.
      window.capPoint=()=>map.transform.locationToScreenPoint(map.getCenter());
      window.pixel=()=>{const point=window.capPoint(),gl=map.getCanvas().getContext('webgl2'),out=new Uint8Array(4);
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
    // A draw callback and a non-broken shader do not establish visible caps.
    // Check actual shared-palette framebuffer pixels with the real terrain
    // renderer enabled, at both sides of the former Mercator cutoff and pole.
    for (const lat of [85.10,88.5,89.9,89.99999,90]) for (const pitch of [60,82,85]) {
      const before=await page.evaluate(()=>window.draws);
      const result=await page.evaluate(async ({lat,pitch,sign})=>{
        const map=window.map;
        map.jumpTo({center:[0,sign*lat],zoom:window.zoomForLatitude(12,0,sign*lat),pitch});
        await window.frame();
        return {pixel:window.pixel(),draws:window.draws,terrain:map.getTerrain(),
          pitch:map.getPitch(),center:map.getCenter().toArray(),
          capPoint:window.capPoint(),terrainPoint:map.project(map.getCenter()),
          terrainElevation:map.queryTerrainElevation(map.getCenter()),depthDraw:window.depthDraw,errors:window.rendererErrors};
      },{lat,pitch,sign});
      await page.screenshot({path:`browser-review/polar-depth-${cap}-${depth}-lat${lat}-pitch${pitch}.png`});
      if(result.pixel.slice(0,3).some((value,i)=>Math.abs(value-expected[i])>5))result.probe=await page.evaluate(()=>window.probeDepth());
      await writeFile(`browser-review/polar-depth-${cap}-${depth}-lat${lat}-pitch${pitch}.json`,JSON.stringify(result,null,2)+'\n');
      assert.ok(result.draws>before,`${cap} ${lat}/${pitch}: current frame must draw cap depth`);
      assert.equal(result.terrain?.source,'terrain3d','terrain must remain enabled, not masked to pass');
      assert.ok(Math.abs(result.pitch-pitch)<0.01);
      assert.deepEqual(result.errors,[]);
      for(let i=0;i<3;i++)assert.ok(Math.abs(result.pixel[i]-expected[i])<=5,
        `${cap} -${depth} m ${lat}/${pitch}: visible cap pixel ${result.pixel} != ${expected}`);
      assert.equal(result.pixel[3],255);
      // Negative control at the same tilted camera: retained pixels or a
      // hidden/absent cap must not satisfy the positive palette assertion.
      const hidden=await page.evaluate(async()=>{
        window.map.setLayoutProperty('terrain-bathymetry','visibility','none');
        await window.frame();const pixel=window.pixel();
        window.map.setLayoutProperty('terrain-bathymetry','visibility','visible');
        await window.frame();return pixel;
      });
      assert.ok(hidden.slice(0,3).some((value,i)=>Math.abs(value-expected[i])>5),
        `${cap} ${lat}/${pitch}: hiding depth must change actual framebuffer pixels`);
    }
    await page.evaluate(async ({latitude})=>{
      window.map.jumpTo({center:[0,latitude],zoom:window.zoomForLatitude(15,0,latitude),pitch:0});
      await window.frame();
    },{latitude});
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
