// Exercise the published-page fixture contract before deployment, including
// project URLs. First-party files travel over loopback HTTP; all provider data
// is synthetic. Never fetch published/provider data from this check.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,symlink,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {emptyReferenceFixture,installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {launchBrowser} from './browser.mjs';

const check=fileURLToPath(new URL('./check-orm-fixture-browser.mjs',import.meta.url));
const root=fileURLToPath(new URL('../styles/',import.meta.url)),repo=resolve(root,'..');
let missingAsset;
const server=createServer(async(req,res)=>{
  try {
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/atlas-project\//,'/');
    if(path===missingAsset){res.writeHead(404,{'content-type':'text/plain'}).end('missing required stylesheet');return;}
    const reference=emptyReferenceFixture(path);
    if(reference){res.writeHead(200,{'content-type':reference.contentType||'application/json'}).end(reference.json?JSON.stringify(reference.json):reference.body);return;}
    if(path.includes('/data/')){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({tiles:[],features:[],countries:{}}));return;}
    const file=resolve(root,'.'+path.replace(/\/$/,'/index.html'));
    if(!file.startsWith(root)){res.writeHead(403).end();return;}
    const body=path.endsWith('/major-stations.geojson')?Buffer.from('{"type":"FeatureCollection","features":[]}'):await readFile(file);
    res.writeHead(200,{'content-type':{'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream'}).end(body);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const temporary=await mkdtemp(join(tmpdir(),'atlas-deployed-fixture-'));
try {
  const project=`http://127.0.0.1:${server.address().port}/atlas-project/`;
  const browser=await launchBrowser({executablePath:process.env.CHROMIUM_EXECUTABLE});
  try{
    for(const [asset,shouldRecover] of [
      ['/vendor/maplibre-gl-5.24.0.css',true], ['/vendor/pmtiles-4.2.1.js',false],
    ]){
      missingAsset=asset;
      const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1000,height:650}});
      try{
        await installEmptyMapProviders(context,project,{firstParty:'network'});
        const page=await context.newPage();
        const missing=page.waitForResponse(r=>r.url()===project+asset.slice(1)&&r.status()===404,{timeout:18000});
        await Promise.all([missing,page.goto(project,{waitUntil:'domcontentloaded'})]);
        const canvas=page.locator('canvas.atlas-flat-preview');
        if(shouldRecover){
          await canvas.waitFor({timeout:18000});
          await page.getByText(/the WebGL renderer files could not load/).waitFor({timeout:10000});
          assert.equal(await page.locator('canvas.maplibregl-canvas').count(),0);
          const map=page.locator('#map'), before=await map.getAttribute('data-flat-center');
          await canvas.press('ArrowRight');
          assert.notEqual(await map.getAttribute('data-flat-center'),before);
        }else{
          await page.getByText(/Map libraries could not load/).waitFor({timeout:18000});
          assert.equal(await canvas.count(),0,'common data reader must not be confused with an optional WebGL file');
        }
      }finally{await context.close();}
    }
    console.log('PASS: packaged project URL recovers missing MapLibre CSS into usable Canvas and fails closed for missing PMTiles');
  }finally{await browser.close();}
  missingAsset=null;
  if(!process.argv.includes('--required-assets-only'))for(const [name,path] of [['root','/'],['project','/atlas-project/']]){
    const cwd=join(temporary,name);await mkdir(cwd);
    await symlink(join(repo,'node_modules'),join(cwd,'node_modules'),'dir');
    const result=await new Promise(resolve=>{
      const child=spawn(process.execPath,[check],{cwd,stdio:'inherit',env:{...process.env,
        ATLAS_FIXTURE_BASE_URL:'',MAP_BASE_URL:`http://127.0.0.1:${server.address().port}${path}`,
        FIXTURE_SETUP_DELAY:'3500',FIXTURE_CAPTURE_DELAY:'1500'}});
      child.on('error',()=>resolve(1));
      child.on('exit',resolve);
    });
    await mkdir('browser-review',{recursive:true});
    await cp(join(cwd,'browser-review'),`browser-review/deployed-${name}`,{recursive:true});
    assert.equal(result,0,`real-client network fixture at ${path}`);
  }
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(temporary,{recursive:true,force:true});}
