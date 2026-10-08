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
const server=createServer(async(req,res)=>{
  try {
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/atlas-project\//,'/');
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
  for(const [name,path] of [['root','/'],['project','/atlas-project/']]){
    const cwd=join(temporary,name);await mkdir(cwd);
    await symlink(join(repo,'node_modules'),join(cwd,'node_modules'),'dir');
    const code=await new Promise(resolve=>{
      const child=spawn(process.execPath,[check],{cwd,stdio:'inherit',env:{...process.env,
        ATLAS_FIXTURE_BASE_URL:'',MAP_BASE_URL:`http://127.0.0.1:${server.address().port}${path}`,
        FIXTURE_SETUP_DELAY:'3500',FIXTURE_CAPTURE_DELAY:'1500'}});
      child.on('error',()=>resolve(1));child.on('exit',resolve);
    });
    await mkdir('browser-review',{recursive:true});
    await cp(join(cwd,'browser-review'),`browser-review/deployed-${name}`,{recursive:true});
    assert.equal(code,0,`real-client network fixture at ${path}`);
  }
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(temporary,{recursive:true,force:true});}
