// Real Firefox/HTTPS Service Worker check. No live railway providers or tiles.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {connect} from 'node:net';
import {join} from 'node:path';
import {firefox} from 'playwright';
import {createPreviewServer} from './serve.mjs';

const root=new URL('../styles/',import.meta.url);
const html=(await readFile(new URL('index.html',root),'utf8'));
const version=html.match(/src="app\.mjs\?v=([\w.-]+)"/)[1];
const style=JSON.parse(await readFile(new URL('world.style.json',root),'utf8'));
style.layers=[...style.layers.map(layer=>({...layer,metadata:{...layer.metadata,'atlas:semantics-version':1,'atlas:views':['fixture-off']}})),
  {id:'offline-fixture-background',type:'background',paint:{'background-color':'#102a35'}}];
const certDir=await mkdtemp(join(tmpdir(),'atlas-local-tls-'));
const key=join(certDir,'key.pem'),cert=join(certDir,'cert.pem');
const assetPattern=/\/vendor\/maplibre-gl-5\.24\.0(?:-atlas\.4\.js|\.css)$/;
const preview=createPreviewServer().listeners('request')[0];
const requests=[];
let browser,server;
try {
  execFileSync('openssl',['req','-x509','-nodes','-days','1','-newkey','rsa:2048','-keyout',key,'-out',cert,
    '-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
  server=createServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>{
    const path=new URL(req.url,'https://127.0.0.1').pathname;
    requests.push(path);
    res.setHeader('cache-control','no-store');
    if(path==='/'||path==='/index.html') {res.writeHead(200,{'content-type':'text/html'}).end(html);return;}
    if(path==='/world.style.json') {res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(style));return;}
    preview(req,res);
  });
  await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
  const origin='https://127.0.0.1:'+server.address().port;
  browser=await firefox.launch({headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,firefoxUserPrefs:{'webgl.disabled':true}});
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:850,height:560}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
  await context.addInitScript(()=>{
    const native=HTMLCanvasElement.prototype.getContext;
    window.glAttempts=0;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){
      if(kind.startsWith('webgl'))window.glAttempts++;
      return native.call(this,kind,...args);
    };
  });
  let page=await context.newPage();
  page.on('pageerror',error=>console.error(error.message));
  await page.goto(origin);
  let canvas=page.locator('canvas.atlas-flat-preview');
  await canvas.waitFor({timeout:10000}).catch(async error=>{console.error(await page.locator('#map-status').textContent(),requests.slice(-20));throw error;});
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),null,{timeout:15000}).catch(async error=>{
    console.error('Worker state:',await page.evaluate(async()=>({secure:isSecureContext,
      registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>[r.installing?.state,r.waiting?.state,r.active?.state]),
      caches:await caches.keys()})),requests.slice(-20));
    throw error;
  });
  assert.equal(await page.evaluate(()=>localStorage.getItem('atlas_disable_webgl')),null);
  if(!(await page.locator('#settings-open').isVisible()))await page.locator('#controls-open').click();
  await page.locator('#settings-open').click();
  assert.equal(await page.locator('#disable-webgl').isChecked(),false);
  await Promise.all([page.waitForEvent('load'),page.locator('#disable-webgl').click()]);
  await page.locator('canvas.atlas-flat-preview').waitFor({timeout:10000});
  assert.equal(await page.evaluate(()=>localStorage.getItem('atlas_disable_webgl')),'1');
  const cached=await page.evaluate(async()=>{
    const keys=new Set();
    for(const name of await caches.keys()){
      if(name.startsWith('atlas-shell-'))for(const r of await (await caches.open(name)).keys())
        keys.add(new URL(r.url).pathname+new URL(r.url).search);
    }
    return [...keys];
  });
  for(const path of ['app.mjs','vendor/flat-browser.js','vendor/flat-controls.css','world.style.json','vendor/pmtiles-4.2.1.js'])
    assert.ok(cached.includes('/'+path+'?v='+version),path+' has its exact version in Cache Storage');
  assert.ok(!cached.some(path=>assetPattern.test(path.split('?')[0])));
  assert.ok(!requests.some(path=>assetPattern.test(path)),'a Canvas page and its real worker must not request either available WebGL asset');
  const before=requests.length;
  // Turn off the origin itself. Firefox's DevTools offline emulation can
  // also deny top-level navigation before the Service Worker sees it.
  const listening=server, port=listening.address().port;
  await new Promise((done,fail)=>{
    listening.close(error=>error?fail(error):done());listening.closeAllConnections();
  });
  server=null;
  await assert.rejects(new Promise((resolve,reject)=>{
    const socket=connect(port,'127.0.0.1');
    socket.once('connect',()=>{socket.destroy();resolve();});
    socket.once('error',reject);
  }),{code:'ECONNREFUSED'},'verify the origin cannot be reached');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('canvas.atlas-flat-preview').waitFor();
  assert.equal(await page.evaluate(()=>window.glAttempts),0);
  await page.close();
  page=await context.newPage();
  await page.goto(origin);
  canvas=page.locator('canvas.atlas-flat-preview');
  await canvas.waitFor();
  assert.equal(await page.evaluate(()=>window.glAttempts),0);
  assert.equal(await page.evaluate(()=>Boolean(navigator.serviceWorker.controller)),true);
  const info=page.locator('.maplibregl-ctrl-attrib');
  const infoButton=info.locator('summary[aria-label="Toggle attribution"]');
  const build=info.locator('.atlas-build');
  assert.equal(await infoButton.getAttribute('aria-expanded'),'false');
  await infoButton.click();
  await build.waitFor({timeout:10000});
  assert.ok((await build.textContent()).startsWith('Build '+version+' · '));
  await page.reload({waitUntil:'domcontentloaded'});
  await canvas.waitFor();
  assert.equal(await infoButton.getAttribute('aria-expanded'),'true');
  await build.waitFor({timeout:10000});
  await infoButton.press('Escape');
  assert.equal(await infoButton.getAttribute('aria-expanded'),'false');
  assert.equal(await build.isHidden(),true);
  const painted=await canvas.evaluate(node=>[...node.getContext('2d').getImageData(10,10,1,1).data]);
  assert.deepEqual(painted,[16,42,53,255]);
  await page.getByRole('button',{name:'Drawing tools',exact:true}).click();
  await page.locator('[data-draw="point"]').click();
  const mapPoint=await canvas.evaluate(node=>{const r=node.getBoundingClientRect();return [r.left+r.width*.70,r.top+r.height*.25];});
  await page.mouse.click(...mapPoint);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('openrailwayatlas-drawing')||'null')?.features.length===1);
  if(!(await page.locator('#settings-open').isVisible()))await page.locator('#controls-open').click();
  await page.locator('#settings-open').click();
  assert.equal(await page.locator('#disable-webgl').isChecked(),true);
  await page.locator('#settings-close').click();
  const zoomIn=page.getByRole('button',{name:'Zoom in',exact:true});
  const zoomOut=page.getByRole('button',{name:'Zoom out',exact:true});
  const savedZoom=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')).z);
  // Start at the standard renderer's limits to catch accidental reuse of its
  // bounds. Exercise the real toolbar after an origin-free reload.
  for(const [initial,button,other,steps] of [
    [1,zoomOut,zoomIn,[0,-0.5]],
    [20,zoomIn,zoomOut,[21,22]],
  ]){
    await page.evaluate(z=>localStorage.setItem('atlas_view',JSON.stringify({c:[0,0],z})),initial);
    await page.reload({waitUntil:'domcontentloaded'});
    await canvas.waitFor();
    for(const zoom of steps){
      await button.click();
      assert.equal(await savedZoom(),zoom);
    }
    assert.equal(await button.isDisabled(),true);
    assert.equal(await other.isEnabled(),true);
  }
  assert.equal(requests.length,before,'offline reopen, preference, drawing and zoom did not reach HTTPS server');
  console.log('Firefox HTTPS: automatic no-WebGL fallback, real Disable WebGL setting, exact cached shell, offline preference, drawing and Canvas zoom bounds passed.');
} finally {
  await browser?.close();
  if(server)await new Promise(done=>server.close(done));
  await rm(certDir,{recursive:true,force:true});
}
