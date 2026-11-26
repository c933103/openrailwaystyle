import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';

// Serve the real packaged page, modules and style. In the control remove only
// the three HTML hints. All fixture responses are local, and no timing target
// depends on the host's rendering speed or the public provider's response.
const directory = new URL('../styles/', import.meta.url);
const pageHtml = await readFile(new URL('index.html', directory), 'utf8');
const style = JSON.parse(await readFile(new URL('world.style.json', directory), 'utf8'));
const types = {'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.woff2':'font/woff2'};
const pin = /\/vendor\/maplibre-gl-[\w.-]+\.js$/;
const paths = {app:'/app.mjs', style:'/world.style.json', labels:'/vendor/tile-labels.js'};
const hintLine = /  <link rel="(?:preload|modulepreload)"[^>]+href="(?:world\.style\.json\?v=[^"]+|vendor\/maplibre-gl-[\w.-]+\.js|vendor\/tile-labels\.js\?v=[^"]+)">\n/g;
const rendererHint = /  <script id="startup-renderer-preload">[\s\S]*?<\/script>\n/g;
const control = pageHtml.replace(hintLine,'').replace(rendererHint,'');
assert.equal([...pageHtml.matchAll(hintLine)].length,2,'keep both static first-party data hints');
assert.equal([...pageHtml.matchAll(rendererHint)].length,1,'keep the conditional renderer hint');
const samples = {};
const server = createServer(async (req,res) => {
  try {
    const {pathname,search} = new URL(req.url,'http://localhost');
    const [,mode,path] = pathname.match(/^\/(control|preloaded)(\/.*)$/) || [];
    assert.ok(path && !path.includes('..'));
    const sample = samples[mode];
    sample.push({path,search,stage:'request',at:performance.now()});
    let bytes, type = types[extname(path)];
    const base = `http://127.0.0.1:${server.address().port}/${mode}/`;
    if(path === '/') {
      bytes = mode==='control' ? control : pageHtml;
      type = 'text/html';
    } else if(path === paths.style) {
      const data = structuredClone(style);
      const low = Object.values(data.sources).find(source => source.url?.includes('standard_railway_line_low'));
      assert.ok(low,'expected initial world railway source');
      low.url = base+'fixture-tilejson.json';
      bytes = JSON.stringify(data);
    } else if(path === '/fixture-tilejson.json') {
      bytes = JSON.stringify({tilejson:'3.0.0',minzoom:0,maxzoom:8,tiles:[base+'tiles/{z}/{x}/{y}.pbf']});
    } else if(path.startsWith('/tiles/')) {
      bytes = Buffer.alloc(0);
      type = 'application/x-protobuf';
    } else if(path.startsWith('/data/')) {
      bytes = JSON.stringify({tiles:[],features:[],countries:{}});
      type = 'application/json';
    } else {
      bytes = await readFile(new URL('.'+path,directory));
    }
    // A deterministic discovery gate: the three download hints should be
    // visible to the browser while the main app entry still has no response.
    if(path===paths.app) await delay(900);
    sample.push({path,stage:'response',at:performance.now()});
    res.writeHead(200,{'content-type':type||'application/octet-stream','cache-control':'public,max-age=120'}).end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await launchBrowser(process.env.STARTUP_TEST_BROWSER ? {executablePath:process.env.STARTUP_TEST_BROWSER} : {});
  for(const mode of ['control','preloaded']) {
    const base = `http://127.0.0.1:${server.address().port}/${mode}/`;
    const context = await browser.newContext({viewport:{width:1000,height:750}});
    try {
      // Match the actual fixture origin even under a project-page subpath.
      await installEmptyMapProviders(context, base, {firstParty:'network'});
      const page = await context.newPage(), exceptions=[];
      page.on('pageerror',error=>exceptions.push(error.message));
      samples[mode] = [];
      const tile = page.waitForResponse(r=>r.url().startsWith(base+'tiles/')&&r.ok(), {timeout:30000});
      await Promise.all([tile,page.goto(base,{waitUntil:'commit'})]);
      const requests = samples[mode].filter(row=>row.stage==='request');
      const appEnd = samples[mode].find(row=>row.path===paths.app&&row.stage==='response').at;
      const inputs = [row=>row.path===paths.style,row=>row.path===paths.labels,row=>pin.test(row.path)];
      const version = requests.find(row=>row.path===paths.app).search;
      for(const [i,predicate] of inputs.entries()){
        const matching = requests.filter(predicate);
        assert.equal(matching.length,1,mode+' should request each input once: '+JSON.stringify(matching));
        if(i<2) assert.equal(matching[0].search,version,'HTML preloads use the actual app version');
        assert.equal(matching[0].at < appEnd,mode==='preloaded',mode+' discovery: '+matching[0].path);
      }
      assert.equal(await page.locator('#map canvas.maplibregl-canvas').count(),1,'the real map created its renderer');
      await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});
      assert.deepEqual(exceptions,[]);
      const start=requests[0].at, firstTile=requests.find(row=>row.path.startsWith('/tiles/')).at;
      console.log(mode, Math.round(firstTile-start)+' ms to first fixture railway tile, with every startup input used once');
    } finally {
      await context.close();
    }
  }
} finally {
  try { await browser?.close(); }
  finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
}
