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

const check=fileURLToPath(new URL('./check-orm-fixture-browser.mjs',import.meta.url));
const root=fileURLToPath(new URL('../styles/',import.meta.url)),repo=resolve(root,'..');
let missingAsset;
const server=createServer(async(req,res)=>{
  try {
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/atlas-project\//,'/');
    if(path===missingAsset){res.writeHead(404,{'content-type':'text/plain'}).end('missing required stylesheet');return;}
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
  const cases=[['missing-css','/atlas-project/','/vendor/maplibre-gl-5.24.0.css']];
  if(!process.argv.includes('--required-assets-only'))cases.push(['root','/'],['project','/atlas-project/']);
  for(const [name,path,missing] of cases){
    missingAsset=missing;
    const cwd=join(temporary,name);await mkdir(cwd);
    await symlink(join(repo,'node_modules'),join(cwd,'node_modules'),'dir');
    const result=await new Promise(resolve=>{
      let output='';
      const child=spawn(process.execPath,[check],{cwd,stdio:missing?['ignore','pipe','pipe']:'inherit',env:{...process.env,
        ATLAS_FIXTURE_BASE_URL:'',MAP_BASE_URL:`http://127.0.0.1:${server.address().port}${path}`,
        FIXTURE_SETUP_DELAY:'3500',FIXTURE_CAPTURE_DELAY:'1500'}});
      child.stdout?.on('data',chunk=>{output+=chunk;});child.stderr?.on('data',chunk=>{output+=chunk;});
      // The missing stylesheet must fail during startup, not after long map
      // checks happen to hit an unrelated error.
      const timer=missing?setTimeout(()=>child.kill(),45000):null;
      child.on('error',error=>{clearTimeout(timer);resolve({code:1,output:output+error.message});});
      child.on('exit',code=>{clearTimeout(timer);resolve({code,output});});
    });
    await mkdir('browser-review',{recursive:true});
    await cp(join(cwd,'browser-review'),`browser-review/deployed-${name}`,{recursive:true});
    if(missing){
      assert.notEqual(result.code,0,'the actual deployed checker must reject a missing required stylesheet');
      assert.match(result.output,/Required first-party browser libraries failed:[\s\S]*maplibre-gl-5\.24\.0\.css: HTTP 404/);
      const ledger=JSON.parse(await readFile(join(cwd,'browser-review/orm-network-ledger.json'),'utf8'));
      assert.ok(ledger.some(row=>row.event==='initial-map-ready'),'the negative control must reach map-ready despite CSS 404');
      assert.ok(!ledger.some(row=>/\/railway_line_high\/14\//.test(row.url||'')),'required assets must fail before z14 checks');
      console.log('PASS: actual deployed checker rejects MapLibre CSS 404 after map-ready and before z14 checks');
    }else assert.equal(result.code,0,`real-client network fixture at ${path}`);
  }
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(temporary,{recursive:true,force:true});}
