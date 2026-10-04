// Exercise the production drag/constrain code with the same MapLibre version
// as the app, independently of remote tiles and fonts.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const browser = await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try {
  const page = await browser.newPage({viewport:{width:1000,height:900},hasTouch:true}), errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.log('Page error',e.message);});
  page.on('requestfailed',r=>console.log('Failed request',r.url(),r.failure()));
  page.on('console',m=>{if(m.type()==='error')console.log(m.text());});
  if(process.env.MAPLIBRE_TEST_JS)await page.route('**/maplibre-gl.js',async route=>route.fulfill({contentType:'text/javascript',body:await readFile(process.env.MAPLIBRE_TEST_JS,'utf8')}));
  await page.route('**/globe-check.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body style="margin:0"><div id="map" style="width:100vw;height:100vh;touch-action:none"></div>
    <script src="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
    <script type="module">
    import {allowPolarCentres,installGlobeDrag,zoomForLatitude} from './globe-drag.mjs';
    window.zoomForLatitude=zoomForLatitude;
    const map=window.map=new maplibregl.Map({container:'map',center:[0,0],zoom:2,maxZoom:22,attributionControl:false,style:{version:8,projection:{type:'globe'},sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#f2efe9'}}]}});
    allowPolarCentres(map,maplibregl.LngLat,()=>1);
    const drag=window.drag=installGlobeDrag(map,{active:()=>map.getProjection()?.type==='globe'});
    map.on('load',()=>{drag.sync();window.loaded=true;});
    </script></body></html>`}));
  await page.goto((process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/')+'globe-check.html');
  await page.waitForFunction(()=>window.loaded,null,{timeout:60000});
  for(const sign of [1,-1]) {
    // Reproduce the reported 89.9° / zoom 2 view and progressively closer
    // views with the pole still within the screen. Every small step must
    // move the ground instead of sticking against a latitude clamp.
    for(const [latitude,zoom] of [[89.9,2],[89.999,2],[89.99999,2]]) {
      const result=await page.evaluate(({sign,latitude,zoom})=>{
        const map=window.map, canvas=map.getCanvasContainer();
        map.jumpTo({center:[20,sign*latitude],zoom,bearing:0});
        const origin=[20,sign*latitude], initial=map.project(origin);
        const pole=map.project([20,sign*90]), crossing=Math.abs(pole.y-initial.y);
        const event=(type,y)=>new PointerEvent(type,{pointerId:1,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,clientX:500,clientY:y,bubbles:true});
        canvas.dispatchEvent(event('pointerdown',450));
        let previous=initial.y, min=Infinity,max=0, scaleError=0;
        const steps=Math.ceil((crossing+80)/4);
        for(let i=1;i<=steps;i++) {
          window.dispatchEvent(event('pointermove',450+sign*i*4));
          const position=map.project(origin), movement=sign*(position.y-previous);
          min=Math.min(min,movement);max=Math.max(max,movement);previous=position.y;
          const expected=window.zoomForLatitude(zoom,sign*latitude,map.getCenter().lat);
          scaleError=Math.max(scaleError,Math.abs(map.getZoom()-expected));
        }
        const far={center:map.getCenter().toArray(),bearing:map.getBearing(),zoom:map.getZoom()};
        window.dispatchEvent(event('pointerup',450+sign*steps*4));
        canvas.dispatchEvent(event('pointerdown',450));
        for(let i=1;i<=steps;i++)window.dispatchEvent(event('pointermove',450-sign*i*4));
        window.dispatchEvent(event('pointerup',450-sign*steps*4));
        return {crossing,steps,min,max,scaleError,far,back:map.getCenter().toArray(),backBearing:map.getBearing(),backZoom:map.getZoom(),suppressedClick:window.drag.justDragged()};
      },{sign,latitude,zoom});
      console.log(sign,latitude,JSON.stringify(result));
      assert.ok(result.min>3.8&&result.max<4.2,'Each 4px drag step moves the ground continuously: '+JSON.stringify(result));
      assert.ok(result.scaleError<0.001,'Planet scale stays constant');
      assert.ok(Math.abs(Math.abs(result.far.center[0]-20)-180)<0.01,'Crosses to the far meridian');
      assert.ok(Math.abs(Math.abs(result.far.bearing)-180)<0.01,'Heading follows the ground across the pole');
      assert.ok(Math.abs(result.back[1]-sign*latitude)<(90-latitude)*0.01,'Reverse drag returns to its starting latitude');
      assert.ok(Math.abs(result.back[0]-20)<0.01&&Math.abs(result.backBearing)<0.01,'Reverse drag restores meridian and heading');
      assert.ok(Math.abs(result.backZoom-zoom)<0.001,'Reverse drag restores scale');
      assert.ok(result.suppressedClick,'Release after drag does not inspect a feature');
    }
  }
  const cdp=await page.context().newCDPSession(page);
  for(const input of ['mouse','touch'])for(const sign of [1,-1]) {
    await page.evaluate(sign=>window.map.jumpTo({center:[20,sign*89.9],zoom:2,bearing:0}),sign);
    const start=sign>0?200:700,end=start+sign*420;
    if(input==='mouse') {
      await page.mouse.move(500,start);await page.mouse.down();
      await page.mouse.move(500,end,{steps:105});await page.mouse.up();
    } else {
      const points=y=>[{x:500,y,id:1}];
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(start)});
      for(let i=1;i<=105;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(start+sign*4*i)});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }
    const view=await page.evaluate(sign=>({center:window.map.getCenter().toArray(),bearing:window.map.getBearing(),distance:sign*(window.map.project([20,sign*89.9]).y-450)}),sign);
    assert.ok(Math.abs(Math.abs(view.center[0]-20)-180)<0.01,`${input} crosses the ${sign>0?'north':'south'} pole: ${JSON.stringify(view)}`);
    assert.ok(Math.abs(view.distance-420)<2,`${input} preserves drag speed: ${JSON.stringify(view)}`);
    console.log(`PASS ${input}: ${sign>0?'north':'south'} pole crossing`);
  }
  // Switching back to Mercator must restore its normal latitude constraint
  // and native panning; the polar override belongs only to the globe.
  await page.evaluate(()=>window.map.setProjection({type:'mercator'}));
  await page.waitForFunction(()=>!window.map.transform._verticalPerspectiveTransform);
  const flat=await page.evaluate(()=>{
    window.drag.sync();window.map.jumpTo({center:[20,89.99],zoom:12});
    return {lat:window.map.getCenter().lat,pan:window.map.dragPan.isEnabled()};
  });
  assert.ok(flat.lat<=85.051129&&flat.pan,'Flat map keeps its native constraints and panning');
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
