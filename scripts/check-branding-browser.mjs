// Exercise the production manifest/icons/service-worker in real Chromium.
// Heavy map resources and CDN dependency URLs are isolated fixtures, not map tests.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
const root = new URL('../', import.meta.url);
const text = path => readFile(new URL(path, root), 'utf8');
const html = await text('styles/index.html');
const manifest = JSON.parse(await text('styles/manifest.webmanifest'));
const worker = await text('styles/sw.js');
const icons = new Map();
for (const name of ['atlas-icon.svg','atlas-icon-192.png','atlas-icon-512.png','atlas-icon-maskable-512.png','atlas-icon-touch-180.png']) icons.set(name, await readFile(new URL(`styles/${name}`, root)));
const output = new URL('../browser-review/branding/', import.meta.url);
await mkdir(output, {recursive:true});
const generation = Number(worker.match(/CACHE = `\$\{PREFIX\}(\d+)`/)[1]);
assert.ok(generation >= 7);
const oldWorker = worker.replace(/CACHE = `\$\{PREFIX\}\d+`/, () => `CACHE = \`\${PREFIX}${generation - 1}\``);
const oldManifest = {...manifest, short_name:'Rail Atlas', icons:manifest.icons.map(icon => ({...icon,src:icon.src.split('?')[0]}))};
let phase = 'before', base;
const requests = [], diagnostics = [];
function fixturePage() {
  let head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<link\b[^>]*href="https:[^"]*"[^>]*>/g, '');
  head = head.replace(/app\.css\?v=[\w.-]+/g, `app.css?v=branding-${phase}`);
  if (phase === 'before') head = head.replace(/\?rev=[a-f0-9]+/g, '').replace('name="apple-mobile-web-app-title" content="Railway Atlas"','name="apple-mobile-web-app-title" content="Rail Atlas"');
  return `<!doctype html><html lang="en"><head>${head}</head><body><h1>Railway Atlas</h1><script type="module" src="app.mjs?v=branding-${phase}"></script><script>navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(r=>{document.body.dataset.registration='ok';}).catch(e=>{document.body.dataset.swError=String(e);console.error(e);});</script></body></html>`;
}
const server = createServer((req,res) => {
  const url = new URL(req.url,base), path = url.pathname.replace(/^\/openrailwaystyle\//,'');
  requests.push({phase,path,search:url.search});
  res.setHeader('Cache-Control','no-store');
  let body, type;
  if (path === '' || path === 'index.html') {body=fixturePage();type='text/html';}
  else if (path === 'manifest.webmanifest') {body=JSON.stringify(phase==='before'?oldManifest:manifest);type='application/manifest+json';}
  else if (path === 'sw.js') {body=(phase==='before'?oldWorker:worker).replace(/const LIBRARIES = \[[^\n]+\];/,()=>`const LIBRARIES = ['${base}fixture-library.js'];`);type='text/javascript';}
  else if (icons.has(path)) {body=icons.get(path);type=path.endsWith('.svg')?'image/svg+xml':'image/png';}
  else if (path === 'app.mjs') {body=`document.body.dataset.fixtureVersion='branding-${phase}';`;type='text/javascript';}
  else if (/\.(mjs|js)$/.test(path)) {body=`/* shell fixture ${phase} */`;type='text/javascript';}
  else if (path.endsWith('.css')) {body='';type='text/css';}
  else if (/\.(json|geojson)$/.test(path)) {body='{}';type='application/json';}
  else {res.writeHead(404).end();return;}
  res.setHeader('Content-Type',type);res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
base=`http://127.0.0.1:${server.address().port}/openrailwaystyle/`;
const profile = await mkdtemp(join(tmpdir(),'atlas-branding-'));
const results = {scope:base,checks:[],boundaries:'Real browser; production branding assets and service-worker logic; map/CDN resources are fixtures. Not Android/iOS launcher validation.'};
const passed = message => {results.checks.push(message);console.log('PASS:',message);};
let context, page;
try {
  context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox'],viewport:{width:1280,height:720}});
  context.setDefaultTimeout(20000);
  results.browser=context.browser()?.version();
  page=context.pages()[0]||await context.newPage();
  page.on('console',m=>{diagnostics.push({type:m.type(),text:m.text()});console.log('BROWSER:',m.text());});
  page.on('pageerror',e=>{diagnostics.push({type:'pageerror',text:String(e)});console.error('PAGE ERROR:',e);});
  const cdp=await context.newCDPSession(page);
  cdp.on('ServiceWorker.workerErrorReported',e=>{diagnostics.push(e);console.error('WORKER ERROR:',JSON.stringify(e));});
  await cdp.send('ServiceWorker.enable');
  // Produce the upload-ready social card even when an installation check fails.
  const card=await context.newPage();await card.setViewportSize({width:1280,height:640});
  await card.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:1280px;height:640px;background:#e7eee9;color:#173e47;font-family:Arial,sans-serif;padding:80px;display:flex;align-items:center;gap:64px}.icon{width:280px;height:280px;flex:none}.icon svg{width:100%;height:100%}h1{font-size:68px;letter-spacing:-2px;margin:0 0 18px;white-space:nowrap}p{font-size:32px;margin:0}footer{font-size:23px;line-height:1.6;margin-top:48px;color:#24565f}</style></head><body><div class="icon">${icons.get('atlas-icon.svg').toString()}</div><main><h1>Railway Atlas</h1><p>The world, by rail.</p><footer>Worldwide stations and railway infrastructure<br>Built on OpenStreetMap</footer></main></body></html>`);
  await card.screenshot({path:new URL('github-social-preview.png',output).pathname});await card.close();
  passed('1280x640 GitHub social preview rendered from approved artwork');
  await page.goto(base);
  await page.waitForFunction(async()=>{
    if(document.body.dataset.swError) throw new Error(document.body.dataset.swError);
    return (await navigator.serviceWorker.getRegistration())?.active?.state==='activated';
  });
  await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
  passed('Previous service worker installed and activated');
  const settings=JSON.stringify({language:'en',attributionOpen:false});
  const drawing=JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{name:'branding test'},geometry:{type:'Point',coordinates:[0,0]}}]});
  await page.evaluate(({settings,drawing})=>{document.cookie=`atlas_settings=${encodeURIComponent(settings)};path=/openrailwaystyle/;SameSite=Lax`;localStorage.setItem('openrailwayatlas-drawing',drawing);},{settings,drawing});
  const cookie=await page.evaluate(()=>document.cookie);
  assert.ok((await page.evaluate(()=>caches.keys())).includes(`atlas-shell-${generation-1}`));
  await page.evaluate(async()=>{await(await caches.open('unrelated-app')).put('/other-app',new Response('keep'));});
  const before=await cdp.send('Page.getAppManifest');
  assert.equal(JSON.parse(before.data).short_name,'Rail Atlas');assert.deepEqual(before.errors,[]);
  await cdp.send('PWA.install',{manifestId:base,installUrlOrBundleUrl:base});
  await cdp.send('PWA.getOsAppState',{manifestId:base});
  passed('Real PWA installed using the unchanged manifest id');
  phase='after';
  await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});
  await page.waitForFunction(async n=>{const c=await caches.keys();return c.includes(`atlas-shell-${n}`)&&!c.includes(`atlas-shell-${n-1}`);},generation);
  await page.reload();await page.waitForFunction(()=>document.body.dataset.fixtureVersion==='branding-after');
  const after=await cdp.send('Page.getAppManifest');
  assert.deepEqual(after.errors,[]);assert.deepEqual(JSON.parse(after.data),manifest);assert.equal(after.url,before.url);
  assert.equal(await page.evaluate(()=>document.cookie),cookie);
  assert.equal(await page.evaluate(()=>localStorage.getItem('openrailwayatlas-drawing')),drawing);
  assert.ok((await page.evaluate(()=>caches.keys())).includes('unrelated-app'));
  passed('Cache migration preserves settings, drawings, unrelated cache and manifest URL');
  for(const icon of manifest.icons){
    const size=await page.evaluate(async src=>{const r=await fetch(src);if(!r.ok)throw new Error(`Icon HTTP ${r.status}`);const image=new Image();image.src=src;await image.decode();return `${image.naturalWidth}x${image.naturalHeight}`;},icon.src);
    if(icon.sizes!=='any')assert.equal(size,icon.sizes);
  }
  passed('All revised manifest icons fetched and decoded');
  await context.setOffline(true);await page.reload();
  await page.waitForFunction(()=>document.body.dataset.fixtureVersion==='branding-after');
  const offline=await page.evaluate(async({manifest,generation})=>{
    const m=await(await fetch('manifest.webmanifest')).json();
    const lengths=[];for(const icon of manifest.icons)lengths.push((await(await fetch(icon.src)).arrayBuffer()).byteLength);
    const old=await(await fetch('app.mjs?v=branding-before')).text();
    const c=await caches.open(`atlas-shell-${generation}`);
    return {m,lengths,old,versions:await(await c.match(new URL('__versions',location.href))).json()};
  },{manifest,generation});
  assert.deepEqual(offline.m,manifest);assert.ok(offline.lengths.every(n=>n>100));assert.match(offline.old,/branding-before/);assert.deepEqual(offline.versions,['branding-after','branding-before']);
  assert.equal(await page.evaluate(()=>document.cookie),cookie);assert.equal(await page.evaluate(()=>localStorage.getItem('openrailwayatlas-drawing')),drawing);
  await cdp.send('PWA.getOsAppState',{manifestId:base});
  passed('Offline page reload and revised icons work; previous-version module and installed identity remain');
  await context.setOffline(false);await cdp.send('PWA.uninstall',{manifestId:base});
  results.success=true;
} catch(error) {
  results.success=false;results.error=String(error.stack||error);
  console.error(error);
  if(page&&!page.isClosed())results.page=await page.evaluate(()=>({url:location.href,body:document.body.innerHTML,dataset:{...document.body.dataset}})).catch(e=>({error:String(e)}));
  process.exitCode=1;
} finally {
  results.requests=requests;results.diagnostics=diagnostics;
  console.log(JSON.stringify(results,null,2));
  await writeFile(new URL('results.json',output),JSON.stringify(results,null,2)+'\n');
  await context?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true});
}
