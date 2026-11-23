import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {firefox} from 'playwright';
import {createPreviewServer} from './serve.mjs';
import {flatVectorFixture} from '../tests/fixtures/flat-vector.mjs';

const root=new URL('../styles/',import.meta.url);
const html=await readFile(new URL('index.html',root),'utf8');
const version=html.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
assert.ok(version,'built page supplies the coordinated asset version');
const bundlePath='/vendor/flat-browser.js?v='+encodeURIComponent(version);
const bundle=await readFile(new URL('vendor/flat-browser.js',root));
const mvt = flatVectorFixture();
const preview = createPreviewServer().listeners('request')[0];
let disconnected=false, bundleRequests=0;
const server = createServer((req,res) => {
  if (req.url === bundlePath) bundleRequests++;
  if (disconnected) {res.destroy();return;}
  if (req.url === '/' || req.url === '/?offline=1') {
    // Match the real worker's page-version contract without executing the
    // currently WebGL-only app entry. All cached assets are actual build outputs.
    res.setHeader('Content-Type','text/html');
    res.end('<canvas width="256" height="256"></canvas><template><script src="app.mjs?v='+version+'"></script></template>');
  } else if (req.url === '/fixture.pbf') {
    res.setHeader('Content-Type','application/x-protobuf');res.end(Buffer.from(mvt));
  } else preview(req,res);
});
await new Promise((resolve,reject) => server.once('error',reject).listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await firefox.launch({headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,firefoxUserPrefs:{'webgl.disabled':true}});
  const origin='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:null});
  const page=await context.newPage();
  await page.goto(origin);
  const found = await page.evaluate(async bundlePath => {
    const probe=document.createElement('canvas');
    const gl=Boolean(probe.getContext('webgl2')||probe.getContext('webgl'));
    const {flatCamera,flatVectorTile,compileFlatFrame,createFlatTileRequests}=await import(bundlePath);
    const context=document.querySelector('canvas').getContext('2d');
    const camera=flatCamera({center:[-90,66.51326044311186],zoom:0,width:256,height:256});
    const tile={z:1,x:0,y:0};
    const response=await fetch('/fixture.pbf');
    if(!response.ok) throw new Error('Fixture tile unavailable');
    const decoded=flatVectorTile(await response.arrayBuffer());
    const counts={};
    const vector={layer(name){counts[name]=(counts[name]??0)+1;return decoded.layer(name);}};
    const image=document.createElement('canvas');
    image.width=2;image.height=2;
    const imageContext=image.getContext('2d');
    imageContext.fillStyle='#ffff00';imageContext.fillRect(0,0,2,2);
    const plan={key:'1/0/0',canonical:tile,copies:[tile]};
    let releaseStale, staleSignal, disposed=0;
    const requests=createFlatTileRequests({
      load: ({source,revision,controller}) => {
        if (revision==='stale') {
          staleSignal=controller.signal;
          return new Promise(resolve => {releaseStale=resolve;});
        }
        return source==='raster' ? {image} : {vector};
      },
      dispose: () => {disposed++;},
    });
    requests.update(new Map([['vector',{revision:'stale',tiles:[plan]}]]));
    await Promise.resolve();
    requests.update(new Map([['raster',{revision:'live',tiles:[plan]}],['vector',{revision:'live',tiles:[plan]}]]));
    const retired=staleSignal.aborted;
    releaseStale({vector:{layer(){throw new Error('Retired tile reached the renderer');}}});
    await new Promise(resolve => setTimeout(resolve,0));
    const staleDisposals=disposed;
    const sources=requests.snapshot().frame;

    const draw=compileFlatFrame([
      {id:'background',type:'background',paint:{'background-color':'#001000'}},
      {id:'area',type:'fill',source:'vector','source-layer':'area',paint:{'fill-color':'#0055aa'}},
      {id:'imagery',type:'raster',source:'raster',paint:{'raster-opacity':0.5}},
      {id:'rail',type:'line',source:'vector','source-layer':'rail',paint:{'line-color':'#c80000','line-width':5}},
      {id:'disabledRail',type:'line',source:'vector','source-layer':'rail',filter:['==',['get','railway'],'tram']},
      {id:'labels',type:'symbol',source:'vector','source-layer':'station'},
    ]);
    const frame=draw(context,camera,sources);
    const pixel=(x,y)=>[...context.getImageData(x,y,1,1).data];
    const first={rail:pixel(128,56),area:pixel(64,120),hole:pixel(150,150)};
    requests.update(new Map());
    draw(context,camera,requests.snapshot().frame);
    requests.close();
    return {gl,first,retired,staleDisposals,empty:pixel(128,56),unsupported:frame.unsupported,counts,draws:[...frame.layerDraws]};
  },bundlePath);
  assert.equal(found.gl,false);
  assert.equal(found.retired,true);
  assert.equal(found.staleDisposals,1);
  assert.deepEqual(found.first.rail,[200,0,0,255]);
  assert.deepEqual(found.first.area,[128,170,85,255]);
  assert.deepEqual(found.first.hole,[128,136,0,255]);
  assert.deepEqual(found.empty,[0,16,0,255]);
  assert.deepEqual(found.unsupported,['labels']);
  assert.deepEqual(found.counts,{area:1,rail:1});
  assert.deepEqual(found.draws,[['background',1],['area',1],['imagery',1],['rail',1],['disabledRail',0]]);
  assert.equal(bundleRequests,1,'cold import requests the versioned browser bundle');
  await page.evaluate(() => navigator.serviceWorker.register('/sw.js').then(() => true));
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller),null,{timeout:30000});
  const cached = await page.evaluate(async path => {
    const response=await caches.match(path);
    if (!response?.ok) return null;
    const digest=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());
    return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
  },bundlePath);
  assert.equal(cached,createHash('sha256').update(bundle).digest('hex'));
  const beforeOffline=bundleRequests;
  disconnected=true;
  await page.close();
  const offline=await context.newPage();
  await offline.goto(origin+'/?offline=1');
  const pixels=await offline.evaluate(async path => {
    const {flatCamera,compileFlatFrame}=await import(path);
    const canvas=document.querySelector('canvas'), context=canvas.getContext('2d');
    const camera=flatCamera({center:[0,0],zoom:0,width:canvas.width,height:canvas.height});
    compileFlatFrame([{id:'background',type:'background',paint:{'background-color':'#0b1621'}}])(context,camera,new Map());
    return [...context.getImageData(0,0,1,1).data];
  },bundlePath);
  assert.deepEqual(pixels,[11,22,33,255]);
  assert.equal(bundleRequests,beforeOffline,'offline module import uses the exact precached version');
  console.log('Firefox WebGL disabled: staged bundle drops late stale tiles and paints current fixture layers; the real service worker serves its exact bytes and paints again offline');
} finally {await browser?.close();server.close();}
