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
const html=(await readFile('styles/index.html','utf8'));
const mixedMode=process.argv.includes('--platform-area-and-edge');
const areaMode=mixedMode||process.argv.includes('--platform-area');
const tileFallback=process.argv.includes('--tile-fallback');
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/platform-edge.json',import.meta.url)));
const edges=geojsonvt({type:'FeatureCollection',features:[fixture.feature]},{maxZoom:22,indexMaxZoom:17,extent:4096});
const areaShape={type:'Feature',properties:{id:'way-731',feature:'platform',name:'Platform area fixture'},
  geometry:{type:'Polygon',coordinates:[[[139.76590,35.68138],[139.76692,35.68138],[139.76692,35.68149],
    [139.76590,35.68149],[139.76590,35.68138]],[[139.76604,35.68141],[139.76604,35.68146],
    [139.76628,35.68146],[139.76628,35.68141],[139.76604,35.68141]]]}};
const area=geojsonvt({type:'FeatureCollection',features:[areaShape]},{maxZoom:22,indexMaxZoom:17,extent:4096});
const areaURL='https://openrailwaymap.app/api/feature/openrailwaymap_platforms/standard_railway_platforms/way-731';
const baseStyle=JSON.parse(await readFile('styles/world.style.json','utf8'));
let measurementTiles=0,edgeMeasurementTiles=0;
const server=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(html);return;}
  if(path==='/world.style.json'){
    const style={...baseStyle,sources:{...baseStyle.sources,platformEdges:{
      ...baseStyle.sources.platformEdges,url:undefined,tiles:['atlasrail://'+origin+'/standard_railway_platform_edges/{z}/{x}/{y}.pbf'],
    },...areaMode&&{platforms:{...baseStyle.sources.platforms,url:undefined,
      tiles:['atlasrail://'+origin+'/standard_railway_platforms/{z}/{x}/{y}.pbf']}}}};
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(style));return;
  }
  if(areaMode&&path.startsWith('/standard_railway_platforms/')){
    if(path.startsWith('/standard_railway_platforms/15/'))measurementTiles++;
    const tile=ormVectorFixture(path,{'standard_railway_platforms':area});
    res.writeHead(200,{'content-type':tile.contentType}).end(tile.body);return;
  }
  if(path.startsWith('/standard_railway_platform_edges/')){
    if(path.startsWith('/standard_railway_platform_edges/17/')){measurementTiles++;edgeMeasurementTiles++;}
    const tile=ormVectorFixture(path,{'standard_railway_platform_edges':areaMode&&!mixedMode?null:edges});
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
  let requests=0, areaRequests=0, fulfill;
  const reply=new Promise(resolve=>fulfill=resolve);
  await context.route(fixture.apiURL,async route=>{requests++;await reply;if(tileFallback)await route.abort('failed');else await route.fulfill({json:fixture.response});});
  if(areaMode)await context.route(areaURL,async route=>{areaRequests++;if(mixedMode)await route.abort('failed');else await route.fulfill({status:404});});
  const page=await context.newPage(),errors=[],approx=tileFallback?'≈':'';
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
  if(areaMode){
    const {width,height}=await canvas.boundingBox();
    const camera=flatCamera({center:[139.7664,35.6815],zoom:18,width,height});
    const inside=panel.locator('a[href="https://www.openstreetmap.org/way/731"]');
    await page.waitForFunction(()=>!document.querySelector('#map-status').textContent.includes('loading railway tiles'),null,{timeout:12000});
    const click=async coords=>{const [x,y]=camera.project(coords);await canvas.click({position:{x,y}});};
    // No area hit in the hole, then select painted fill well away from outlines.
    await click([139.76616,35.681435]);
    assert.equal(await inside.count(),0,'Polygon hole is not painted or selectable');
    for(let attempt=0;attempt<8&&!(await inside.count());attempt++){
      await click([139.76655,35.681435]);
      await inside.waitFor({timeout:600}).catch(()=>{});
    }
    await inside.waitFor({timeout:1500});
    assert.doesNotMatch(await panel.innerText(),/Estimated platform extent/);
    assert.equal(measurementTiles,0,'Do not measure full extent below zoom 19');
    if(mixedMode){
      const until=Date.now()+7000;
      while(!areaRequests&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));
      assert.equal(areaRequests,1,'Area API fails before boarding edges qualify for API lookup');
    }
    await canvas.press('+');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('atlas_view')).z===19);
    await page.waitForFunction(()=>/Estimated platform extent\s*\d+ m/.test(document.querySelector('#detail-content').innerText),null,{timeout:10000});
    const content=await panel.innerText();
    const metres=Number(content.match(/Estimated platform extent\s*(\d+) m/)[1]);
    assert.ok(metres>=88&&metres<=97,content);
    assert.equal(await inside.count(),1);
    assert.ok(measurementTiles>0&&measurementTiles<=9);
    await page.waitForFunction(length=>window.platformLabels.includes('≈'+length+' m'),metres,{timeout:5000});
    if(mixedMode){
      await page.locator('#details-close').click();
      const zoomed=flatCamera({center:[139.7664,35.6815],zoom:19,width,height});
      const [x,y]=zoomed.project([139.7663502,35.6815449]);
      await canvas.click({position:{x,y}});
      await page.waitForFunction(()=>/Boarding edge length\s*≈247 m/.test(document.querySelector('#detail-content').innerText),null,{timeout:8000});
      assert.equal(requests,0,'Area transport failure did not unpause the shared feature API queue');
      assert.equal(areaRequests,1);
      assert.equal(edgeMeasurementTiles,2,'Only a complete selected edge may be measured during the pause');
      console.log('Firefox Canvas: missing area API can pause feature lookups without blocking the selected boarding-edge tile fallback.');
    }
    assert.deepEqual(await page.evaluate(()=>window.webglAttempts),[]);
    assert.deepEqual(errors,[]);
    console.log('Firefox Canvas: polygon fill selectable, hole ignored, full '+metres+' m estimated extent appears in current inspector and label, with missing feature API.');
  }else{
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
  assert.equal(measurementTiles,0);
  await page.waitForFunction(()=>window.platformLabels.includes('1'),null,{timeout:7000});
  await canvas.press('+');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('atlas_view')).z===19);
  const start=Date.now();while(!requests&&Date.now()-start<8000)await new Promise(r=>setTimeout(r,100));
  assert.equal(requests,1,'At zoom 19 request the full mapped edge, not the clipped piece');
  fulfill();
  await page.waitForFunction(value=>document.querySelector('#detail-content').textContent.includes(value),approx+'247 m',{timeout:8000});
  await page.waitForFunction(value=>window.platformLabels.includes(value),'1 · '+approx+'247 m',{timeout:5000});
  assert.equal(measurementTiles,tileFallback?2:0);
  assert.equal(await link.count(),1,'Length enriches the already-open exact edge');
  await page.locator('#details-close').click();
  if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();
  await page.selectOption('#units','imperial');
  await page.waitForFunction(value=>window.platformLabels.includes(value),'1 · '+approx+'810 ft',{timeout:5000});
  assert.equal(requests,1,'Unit conversion reuses the full length');
  await page.evaluate(()=>{window.platformLabels=[];});
  await canvas.press('-');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('atlas_view')).z===18);
  await page.waitForFunction(()=>window.platformLabels.includes('1'),null,{timeout:5000});
  assert.equal(await page.evaluate(value=>window.platformLabels.includes(value),'1 · '+approx+'810 ft'),false);
  assert.equal(requests,1,'No new API request below zoom 19');
  assert.deepEqual(await page.evaluate(()=>window.webglAttempts),[]);
  assert.deepEqual(errors,[]);
  console.log(tileFallback?'Firefox platform source failure: recovered the complete mapped edge across the tile seam, labeled approximate.':'Firefox Canvas platform: reference at z18, full edge fetched once at z19, open inspector and label update, metric/imperial cache reuse.');
  }
} finally {
  await context?.close();
  await rm(profile,{recursive:true,force:true});
  await new Promise(resolve=>server.close(resolve));
}
