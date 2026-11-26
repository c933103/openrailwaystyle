import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {firefox} from 'playwright';
import geojsonvt from 'geojson-vt';
import {createPreviewServer} from './serve.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {ormVectorFixture} from './orm-vector-fixture.mjs';
import {flatCamera} from '../styles/flat-camera.mjs';

const preview=createPreviewServer({root:'styles'});
const html=(await readFile('styles/index.html','utf8')).replace(/<html\b/,'<html data-flat-entry="staged"');
const base=JSON.parse(await readFile('styles/world.style.json','utf8'));
const crossing=(id,kind,coordinates)=>({type:'Feature',id,properties:{kind,osm_id:id},
  geometry:{type:'Point',coordinates}});
const center=[-0.12,51.50], z=13;
const points=[crossing(101,'road',[-0.124,51.50]),crossing(102,'foot',[-0.116,51.50])];
const tileIndex=geojsonvt({type:'FeatureCollection',features:points},{maxZoom:14,indexMaxZoom:13,extent:4096});
let requests=0;
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(html);return;}
  if(path==='/world.style.json'){
    const style={...base,sources:{...base.sources,crossingsDetail:{...base.sources.crossingsDetail,
      url:undefined,tiles:[origin+'/crossing-fixture/{z}/{x}/{y}.pbf']}}};
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(style));return;
  }
  if(path.startsWith('/crossing-fixture/')){
    requests++;
    const tile=ormVectorFixture(path.replace('/crossing-fixture/','/level_crossings/'),{level_crossings:tileIndex});
    assert.ok(tile);res.writeHead(200,{'content-type':tile.contentType}).end(tile.body);return;
  }
  preview.emit('request',req,res);
});
await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(tmpdir(),'atlas-flat-crossings-'));
let context;
try {
  context=await firefox.launchPersistentContext(profile,{headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,
    viewport:{width:960,height:640},deviceScaleFactor:1,serviceWorkers:'block',firefoxUserPrefs:{'webgl.disabled':true}});
  await installEmptyMapProviders(context,origin+'/',{firstParty:'network'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.setItem('atlas_disable_webgl','1');
    window.glAttempts=[];
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(type.startsWith('webgl'))window.glAttempts.push(type);
      return get.call(this,type,...args);
    };
  });
  await page.goto(origin+'/?mode=infrastructure&relief=0&stations=0&names=0&trackCounts=0&transport=0&destinations=0&constraints=0#13/51.50/-0.12');
  const canvas=page.locator('canvas.atlas-flat-preview');
  await canvas.waitFor();
  const {width,height}=await canvas.boundingBox();
  const camera=flatCamera({center,zoom:z,width,height});
  const positions=points.map(p=>camera.project(p.geometry.coordinates).map(Math.round));
  // Read the actual Canvas pixels in the four arms. The ordinary dot fallback,
  // a blank layer and same-colour generic marks must all fail these checks.
  await page.waitForFunction(ps=>{
    const ctx=document.querySelector('canvas.atlas-flat-preview').getContext('2d');
    const rgb=[[99,51,44],[160,112,74]];
    return ps.every(([x,y],n)=>{
      const pixels=(cx,cy)=>[...ctx.getImageData(cx-1,cy-1,3,3).data]
        .some((v,i,a)=>i%4===0&&Math.abs(v-rgb[n][0])<24&&Math.abs(a[i+1]-rgb[n][1])<24&&Math.abs(a[i+2]-rgb[n][2])<24);
      return [[-3,-3],[-3,3],[3,-3],[3,3]].every(([a,b])=>pixels(x+a,y+b));
    });
  },positions,{timeout:12000});
  assert.ok(requests>0,'Real staged entry loads the level-crossing fixture');
  for(const [n,[x,y]] of positions.entries()){
    await canvas.click({position:{x,y}});
    await page.getByRole('heading',{name:n===0?'Road level crossing':'Pedestrian level crossing',exact:true}).waitFor({timeout:3000});
    await page.locator(`#detail-content a[href="https://www.openstreetmap.org/node/${points[n].id}"]`).waitFor({timeout:3000});
    await page.locator('#details .close').click();
  }
  assert.deepEqual(await page.evaluate(()=>window.glAttempts),[]);
  assert.deepEqual(errors,[]);
  console.log('Firefox with WebGL disabled: staged Infrastructure paints both road and foot crossing X symbols, styled by the actual layer, and opens each exact crossing inspector.');
} finally {await context?.close();server.close();await rm(profile,{recursive:true,force:true});}
