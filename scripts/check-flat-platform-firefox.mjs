import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {firefox} from 'playwright';
import geojsonvt from 'geojson-vt';
import {createPreviewServer} from './serve.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {ormVectorFixture} from './orm-vector-fixture.mjs';
import {flatCamera} from '../styles/flat-camera.mjs';

const preview=createPreviewServer({root:'styles'});
const html=(await readFile('styles/index.html','utf8')).replace(/<html\b/,'<html data-flat-entry="staged"');
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/platform-edge.json',import.meta.url)));
const edges=geojsonvt({type:'FeatureCollection',features:[fixture.feature]},{maxZoom:22,indexMaxZoom:17,extent:4096});
const baseStyle=JSON.parse(await readFile('styles/world.style.json','utf8'));
const server=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(html);return;}
  if(path==='/world.style.json'){
    const style={...baseStyle,sources:{...baseStyle.sources,platformEdges:{
      ...baseStyle.sources.platformEdges,url:undefined,tiles:[origin+'/standard_railway_platform_edges/{z}/{x}/{y}.pbf'],
    }}};
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(style));return;
  }
  if(path.startsWith('/standard_railway_platform_edges/')){
    const tile=ormVectorFixture(path,{'standard_railway_platform_edges':edges});
    assert.ok(tile);res.writeHead(200,{'content-type':tile.contentType}).end(tile.body);return;
  }
  preview.emit('request',req,res);
});
await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(tmpdir(),'atlas-flat-platform-'));
let context;
try {
  context=await firefox.launchPersistentContext(profile,{headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,
    viewport:{width:960,height:640},serviceWorkers:'block',firefoxUserPrefs:{'webgl.disabled':true}});
  await installEmptyMapProviders(context,origin+'/',{firstParty:'network'});
  let requests=0, fulfill;
  const reply=new Promise(resolve=>fulfill=resolve);
  await context.route(fixture.apiURL,async route=>{requests++;await reply;await route.fulfill({json:fixture.response});});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.setItem('atlas_disable_webgl','1');
    window.webglAttempts=[];
    const getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...options){
      if(String(type).startsWith('webgl'))window.webglAttempts.push(type);
      return getContext.call(this,type,...options);
    };
    window.platformLabels=[];
    const fill=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){
      if(this.canvas.classList.contains('atlas-flat-preview'))window.platformLabels.push(String(text));
      return fill.call(this,text,...args);
    };
  });
  await page.goto(origin+'/?mode=infrastructure&relief=0&stations=0&names=0&trackCounts=0&transport=0&destinations=0&constraints=0#18/35.6815/139.7664');
  const canvas=page.locator('canvas.atlas-flat-preview');
  await canvas.waitFor({timeout:15000}).catch(async error=>{console.error('Canvas startup:',errors,await page.locator('#map-status').textContent(),await page.locator('html').getAttribute('data-flat-entry'));throw error;});
  if(await page.locator('#controls').isVisible())await page.locator('#collapse').click();
  const panel=page.locator('#detail-content');
  const link=panel.locator('a[href="https://www.openstreetmap.org/way/349685435"]');
  // A real line selection at the archived edge, independent of the new label.
  const {width,height}=await canvas.boundingBox();
  const camera=flatCamera({center:[139.7664,35.6815],zoom:18,width,height});
  const [x,y]=camera.project([139.7663502,35.6815449]);
  for(let attempt=0;attempt<8&&!(await link.count());attempt++){
    await canvas.click({position:{x,y}});
    await link.waitFor({timeout:600}).catch(()=>{});
  }
  await link.waitFor({timeout:1500});
  assert.doesNotMatch(await panel.innerText(),/Boarding edge length/);
  assert.equal(requests,0);
  await page.waitForFunction(()=>window.platformLabels.includes('1'),null,{timeout:7000});
  await canvas.press('+');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('atlas_view')).z===19);
  const start=Date.now();while(!requests&&Date.now()-start<8000)await new Promise(r=>setTimeout(r,100));
  assert.equal(requests,1,'At zoom 19 request the full mapped edge, not the clipped piece');
  fulfill();
  await page.waitForFunction(()=>document.querySelector('#detail-content').textContent.includes('247 m'),null,{timeout:5000});
  await page.waitForFunction(()=>window.platformLabels.includes('1 · 247 m'),null,{timeout:5000});
  assert.equal(await link.count(),1,'Length enriches the already-open exact edge');
  await page.locator('#details-close').click();
  if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();
  await page.selectOption('#units','imperial');
  await page.waitForFunction(()=>window.platformLabels.includes('1 · 810 ft'),null,{timeout:5000});
  assert.equal(requests,1,'Unit conversion reuses the full length');
  await page.evaluate(()=>{window.platformLabels=[];});
  await canvas.press('-');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('atlas_view')).z===18);
  await page.waitForFunction(()=>window.platformLabels.includes('1'),null,{timeout:5000});
  assert.equal(await page.evaluate(()=>window.platformLabels.includes('1 · 810 ft')),false);
  assert.equal(requests,1,'No new API request below zoom 19');
  assert.deepEqual(await page.evaluate(()=>window.webglAttempts),[]);
  assert.deepEqual(errors,[]);
  console.log('Firefox Canvas platform: reference at z18, full edge fetched once at z19, open inspector and label update, metric/imperial cache reuse.');
} finally {
  await context?.close();
  await rm(profile,{recursive:true,force:true});
  await new Promise(resolve=>server.close(resolve));
}
