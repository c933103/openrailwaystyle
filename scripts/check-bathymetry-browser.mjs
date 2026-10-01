import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';

// A small, real map using the site's sources/layers, without loading unrelated
// railway snapshots. Pixel checks exercise the protocol and coastline mask.
const base = (process.env.MAP_BASE_URL || 'http://127.0.0.1:4173/').replace(/\/?$/, '/');
const app = await readFile(new URL('../styles/app.mjs',import.meta.url),'utf8');
const library = app.match(/loadScript\('([^']+maplibre-gl[^']+\.js)'/)[1];
const deadline=setTimeout(()=>{console.error('Bathymetry validation exceeded five minutes');process.exit(1);},300000);deadline.unref();
const proxyURL=process.env.HTTPS_PROXY || process.env.https_proxy;
const proxy=proxyURL ? {server:proxyURL,bypass:'localhost,127.0.0.1'} : undefined;
const browser = await chromium.launch({headless:true,proxy,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
const errors = [];
page.on('pageerror',error=>errors.push(error.message));
page.on('requestfailed',request=>console.warn('Resource failed:',request.url(),request.failure()?.errorText));
try {
  await page.route('**/__bathymetry-check',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}#map{position:absolute;inset:0}</style><div id="map"></div>'}));
  await page.goto(base+'__bathymetry-check');
  await page.addScriptTag({url:library});
  await page.addScriptTag({url:'https://cdn.jsdelivr.net/npm/pmtiles@4.2.1/dist/pmtiles.js'});
  await page.addScriptTag({url:base+'vendor/maplibre-contour.js'});
  const checks = await page.evaluate(async base => {
    const {installBathymetry, maskOcean, shareArchiveRequests} = await import(base+'bathymetry.mjs');
    const {readTile} = await import(base+'vendor/tile-labels.js');
    // An island hole and overlapping ocean polygons: neither may become a
    // false sea patch or a false land patch through winding cancellation.
    const image = new OffscreenCanvas(64,64), context = image.getContext('2d');
    context.fillStyle='#80b7cf'; context.fillRect(0,0,64,64);
    const ring = (x0,y0,x1,y1) => [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
    maskOcean(context,[{extent:64,rings:[ring(0,0,48,64),ring(12,12,24,24)]},{extent:64,rings:[ring(32,0,64,64)]}],64);
    const pixel=(x,y)=>[...context.getImageData(x,y,1,1).data];
    const mask={island:pixel(18,18),overlap:pixel(40,40),sea:pixel(4,4)};
    let inlandProtocol, inlandDEM=0;
    installBathymetry({addProtocol:(_,handler)=>inlandProtocol=handler},{getDemTile:()=>inlandDEM++},{
      waterTile:async()=>({data:new ArrayBuffer(0)}),readTile:()=>({layers:{}}),
    });
    const empty=await inlandProtocol({url:'atlas-depth://10/500/400'},new AbortController());
    const blank=await createImageBitmap(new Blob([empty.data],{type:'image/png'}));
    const inland={width:blank.width,height:blank.height,demRequests:inlandDEM};blank.close();

    const style = await (await fetch(base+'world.style.json')).json();
    const protocol = new pmtiles.Protocol(); protocol.tile=shareArchiveRequests(protocol.tile.bind(protocol)); maplibregl.addProtocol('pmtiles',protocol.tile);
    mlcontour.workerUrl=base+'vendor/dem-worker.js';
    const dem=new mlcontour.DemSource({url:style.sources.relief.tiles[0],encoding:'terrarium',maxzoom:15,worker:true,cacheSize:32,timeoutMs:20000,id:'review'});
    dem.setupMaplibre(maplibregl);
    let depthProtocol;
    installBathymetry({addProtocol:(id,callback)=>{depthProtocol=callback;maplibregl.addProtocol(id,callback);}},dem,{
      waterTile:(z,x,y,c)=>protocol.tile({url:`${style.sources.openmaptiles.url}/${z}/${x}/${y}`,type:'arrayBuffer'},c),
      readTile:data=>readTile(data,['water']),
    });
    async function reviewTile(key) {
      const {data}=await depthProtocol({url:'atlas-depth://'+key},new AbortController());
      const bitmap=await createImageBitmap(new Blob([data],{type:'image/png'}));
      const tile=new OffscreenCanvas(bitmap.width,bitmap.height), ink=tile.getContext('2d');ink.drawImage(bitmap,0,0);bitmap.close();
      const pixels=ink.getImageData(0,0,tile.width,tile.height).data;
      let shallow=0,deep=0,clear=0;
      for(let i=0;i<pixels.length;i+=4){if(!pixels[i+3])clear++;else if(pixels[i]>150)shallow++;else if(pixels[i]<120)deep++;}
      return {key,shallow,deep,clear};
    }
    const tiles=await Promise.all(['10/982/478','10/837/479'].map(reviewTile));
    // Retain the normal water/land context and contours; omit unrelated views.
    const layers=style.layers.filter(l=>l.type==='background'||l.source==='openmaptiles'&&l.type!=='symbol'||l.id.startsWith('terrain-')&&l.type!=='symbol');
    const sources=Object.fromEntries(['openmaptiles','relief','bathymetry','contours','seabedContours','seabedContoursClose'].map(id=>[id,style.sources[id]]));
    sources.relief.tiles=[dem.sharedDemProtocolUrl];
    const {contourOptions}=await import(base+'map-model.mjs');
    sources.contours.tiles=[dem.contourProtocolUrl(contourOptions('metric'))];
    sources.seabedContours.tiles=[dem.contourProtocolUrl(contourOptions('metric','shelf'))];
    sources.seabedContoursClose.tiles=[dem.contourProtocolUrl(contourOptions('metric','close'))];
    window.depthMap=new maplibregl.Map({container:'map',style:{version:8,sources,layers},center:[165.38,11.60],zoom:9.2,canvasContextAttributes:{preserveDrawingBuffer:true},attributionControl:false});
    await new Promise(resolve=>depthMap.once('load',resolve));
    return {mask,tiles,inland};
  },base);
  assert.equal(checks.mask.island[3],0,'island must remain transparent');
  assert.equal(checks.mask.overlap[3],255,'overlapping ocean polygons must stay ocean');
  assert.equal(checks.mask.sea[3],255);
  assert.deepEqual(checks.inland,{width:1,height:1,demRequests:0});
  for(const tile of checks.tiles) {
    assert.ok(tile.shallow>50,`${tile.key} must reveal shallow reefs`);
    assert.ok(tile.deep>1000,`${tile.key} must distinguish the deep basin`);
  }
  console.log('PASS: real Bikini and Spratly depth tiles contain distinct shallow/deep colours',JSON.stringify(checks));
  await mkdir('browser-review',{recursive:true});
  async function frame() {
    await page.waitForFunction(()=>depthMap.isSourceLoaded('bathymetry'),undefined,{timeout:90000});
    await page.evaluate(()=>new Promise(resolve=>{depthMap.once('render',resolve);depthMap.triggerRepaint();}));
  }
  await frame(); await page.screenshot({path:'browser-review/bathymetry-marshall.png'});
  await page.evaluate(()=>depthMap.jumpTo({center:[114.37,11.43],zoom:9.2}));
  await frame(); await page.screenshot({path:'browser-review/bathymetry-spratly.png'});
  await page.setViewportSize({width:412,height:915});
  await page.evaluate(()=>{depthMap.resize();depthMap.jumpTo({center:[165.38,11.60],zoom:9.2});});
  await frame(); await page.screenshot({path:'browser-review/bathymetry-mobile.png'});
  await page.evaluate(()=>depthMap.setLayoutProperty('terrain-bathymetry','visibility','none'));
  assert.equal(await page.evaluate(()=>depthMap.getLayoutProperty('terrain-bathymetry','visibility')),'none');
  assert.deepEqual(errors,[]);
  console.log('PASS: coastline holes, WebGL rendering, mobile resize and depth-layer visibility');
} finally {clearTimeout(deadline);await browser.close();}
