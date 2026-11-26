import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {firefox} from 'playwright';
import vtPbf from 'vt-pbf';
import {createPreviewServer} from './serve.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {encodeBundle} from '../styles/tile-bundles.mjs';

const html=(await readFile('styles/index.html','utf8'));
const preview=createPreviewServer({root:'styles'});
const manifest={complete:true,schema:1,license:'ODbL-1.0',minzoom:3,maxzoom:7,
  stations:1,tiles:2,bundles:1,polar:0,pendingRegions:0,completedRegions:32};
const index={zoom:3,bundles:['4/3']};
let mode='complete';
const seen=[];
const bytes=(layer,id,name,coordinates)=>vtPbf.fromGeojsonVt({[layer]:{features:[{
  type:1,id,geometry:[coordinates],
  tags:{id:'node-'+id,osm_id:String(id),osm_type:'node',name,feature:'station',state:'present',station:'train'},
}]}},{version:2});
const centre=2048;
const world='Snapshot-only railway station';
const established='Established fallback station';
const layer='atlas_station_points';
const bundle=gzipSync(encodeBundle(new Map([
  ['4/8/7',bytes(layer,46101,world,[centre,centre])],
  ['3/4/3',bytes(layer,46101,world,[centre/2,2048+centre/2])],
])));
const fallback=bytes('standard_railway_text_stations_low',46102,established,[centre+768,centre]);
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://local').pathname;
  const write=(type,body)=>res.writeHead(200,{'content-type':type,'cache-control':'no-store'}).end(body);
  if(path==='/')return write('text/html',html);
  if(path==='/major-stations.geojson')return write('application/json','{"type":"FeatureCollection","features":[]}');
  if(path.startsWith('/data/station-points/')){
    seen.push(path);
    if(path.endsWith('/manifest.json'))return write('application/json',JSON.stringify(mode==='incomplete'?{...manifest,complete:false}:manifest));
    if(path.endsWith('/index.json'))return write('application/json',JSON.stringify(index));
    if(path.endsWith('/3/4/3.bundle.gz')&&mode==='complete')return write('application/gzip',bundle);
    return res.writeHead(404).end();
  }
  if(path==='/station-low-fixture.json')return write('application/json',JSON.stringify({minzoom:4,maxzoom:4,tiles:[origin+'/station-low-fixture/{z}/{x}/{y}.pbf']}));
  if(path.startsWith('/station-low-fixture/'))return write('application/x-protobuf',path.endsWith('/4/8/7.pbf')?Buffer.from(fallback):Buffer.alloc(0));
  return preview.emit('request',req,res);
});
await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const lat=Math.atan(Math.sinh(Math.PI*(1-2*7.5/16)))*180/Math.PI;
const profile=await mkdtemp(join(tmpdir(),'atlas-world-stations-'));
let browser;
try{
  browser=await firefox.launchPersistentContext(profile,{headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,
    viewport:{width:960,height:640},deviceScaleFactor:2,serviceWorkers:'block',firefoxUserPrefs:{'webgl.disabled':true}});
  await installEmptyMapProviders(browser,origin+'/',{firstParty:'network'});
  await browser.route(url=>url.pathname.includes('standard_railway_text_stations_low'),route=>{
    const p=new URL(route.request().url()).pathname;
    if(/\/\d+\/\d+\/\d+$/.test(p))return route.fulfill({contentType:'application/x-protobuf',headers:{'access-control-allow-origin':'*'},
      body:p.endsWith('/4/8/7')?Buffer.from(fallback):Buffer.alloc(0)});
    return route.fulfill({json:{minzoom:4,maxzoom:4,tiles:[origin+'/station-low-fixture/{z}/{x}/{y}.pbf']}});
  });
  for(const [state,z] of [['complete',4],['complete',3],['incomplete',4],['broken-bundle',4]]){
    mode=state;seen.length=0;
    const p=await browser.newPage(),failures=[];
    try{
      p.on('pageerror',e=>failures.push(e.message));
      await p.addInitScript(()=>{
        localStorage.setItem('atlas_disable_webgl','1');
        window.glAttempts=0;
        const get=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(type,...args){
          if(type.startsWith('webgl'))window.glAttempts++;
          return get.call(this,type,...args);
        };
      });
      await p.goto(origin+'/?names=0&stations=1&relief=0&transport=0&destinations=0&constraints=0&detail=0#'+z+'/'+lat+'/11.25');
      const canvas=p.locator('canvas.atlas-flat-preview');
      await canvas.waitFor();
      const [px,py]=[state==='complete'?480:576,320];
      const name=state==='complete'?world:established;
      await p.waitForFunction(({px,py})=>{
        const c=document.querySelector('canvas.atlas-flat-preview'),ctx=c.getContext('2d');
        const k=c.width/c.clientWidth;
        return ctx.getImageData(Math.round(px*k)-3,Math.round(py*k)-3,7,7).data
          .some((v,i,a)=>i%4===0&&v>155&&v<236&&a[i+1]<240&&a[i+2]<236&&a[i+3]===255);
      },{px,py},{timeout:12000}).catch(async error=>{
        console.error(state,z,seen,await p.locator('#map-status').textContent());throw error;
      });
      await p.mouse.click(px,py);
      await p.getByRole('heading',{name,exact:true}).waitFor({timeout:5000});
      const expectedID=state==='complete'?46101:46102;
      await p.locator('#detail-content a[href="https://www.openstreetmap.org/node/'+expectedID+'"]').waitFor();
      assert.equal(await p.locator('#names').isChecked(),false);
      if(state==='complete'){
        await p.getByText(/Independent worldwide OpenStreetMap station-point snapshot/).waitFor();
        const dock=p.locator('.atlas-flat-credit-box');
        if(await dock.getAttribute('open')===null)await dock.locator('summary').click();
        await dock.getByText(/OpenStreetMap contributors, ODbL/).waitFor({timeout:5000});
        await dock.locator('summary').click();
        if(z===4){
          await p.locator('#details-close').click();
          if(!await p.locator('#settings-open').isVisible())await p.locator('#controls-open').click();
          await p.locator('#settings-open').click();
          await p.locator('#stations').uncheck();
          await p.mouse.click(px,py);
          assert.equal(await p.getByRole('heading',{name,exact:true}).count(),0);
          await p.locator('#stations').check();
          await p.locator('#settings-close').click();
          await p.mouse.click(px,py);
          await p.getByRole('heading',{name,exact:true}).waitFor({timeout:5000});
        }
        assert.equal(seen.filter(path=>path.endsWith('/index.json')).length,1);
        assert.equal(seen.filter(path=>path.endsWith('.bundle.gz')).length,1);
      }else if(state==='incomplete'){
        assert.deepEqual(seen,['/data/station-points/manifest.json']);
      }else{
        assert.ok(seen.some(path=>path.endsWith('.bundle.gz')));
        assert.equal(await p.getByText(/Independent worldwide OpenStreetMap station-point snapshot/).count(),0);
      }
      assert.deepEqual(failures,[]);
      assert.equal(await p.evaluate(()=>window.glAttempts),0);
      console.log('Canvas world stations:',state,'z'+z,'painted and opened exact node',expectedID,'with names disabled');
    }finally{await p.close();}
  }
} finally{await browser?.close();server.close();await rm(profile,{recursive:true,force:true});}
