import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {firefox} from 'playwright';
import {createPreviewServer} from './serve.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {terrariumFixturePng} from './bathymetry-browser-fixture.mjs';

const root=new URL('../styles/',import.meta.url);
const html=(await readFile(new URL('index.html',root),'utf8'));
const source=JSON.parse(await readFile(new URL('world.style.json',root),'utf8'));
const hillshade=source.layers.find(layer=>layer.id==='terrain-relief');
assert.equal(hillshade.type,'hillshade');
const bg=[176,188,194,255];
// Keep this output independent of map tiles. The actual map reads a synthetic
// Terrarium PNG through its normal repaired elevation worker and settings.
const style={...source,layers:[
  ...source.layers.filter(layer=>layer!==hillshade).map(layer=>({...layer,metadata:{...layer.metadata,
    'atlas:semantics-version':1,'atlas:views':['fixture-off']}})),
  {id:'controlled-background',type:'background',paint:{'background-color':'#b0bcc2'}},hillshade,
]};
const slope=terrariumFixturePng(x=>300+Math.min(x,256-x)*23);
const preview=createPreviewServer({root:'styles'});
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/')return res.writeHead(200,{'content-type':'text/html'}).end(html);
  if(path==='/world.style.json')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(style));
  preview.emit('request',req,res);
}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(tmpdir(),'atlas-flat-relief-'));
let context;
try{
  context=await firefox.launchPersistentContext(profile,{headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,
    firefoxUserPrefs:{'webgl.disabled':true},viewport:{width:800,height:620},serviceWorkers:'block'});
  await installEmptyMapProviders(context,origin+'/',{firstParty:'network'});
  const dem=[];
  await context.route('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/**',route=>{
    dem.push(route.request().url());
    return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'image/png',body:slope});
  });
  await context.addInitScript(()=>{
    localStorage.setItem('atlas_disable_webgl','1');
    window.atlasTestWebgl=[];
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(type.startsWith('webgl')||type==='experimental-webgl')window.atlasTestWebgl.push(type);
      return get.call(this,type,...args);
    };
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const url=origin+'/?relief=1&inactive=0&names=0&labels=0&stations=0#10/0.12/0.12';
  const consoleErrors=[];
  page.on('console',entry=>{if(entry.type()==='error')consoleErrors.push(entry.text());});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.locator('#map canvas.atlas-flat-preview').waitFor({timeout:12000}).catch(async error=>{
    console.error(JSON.stringify({errors,consoleErrors, status:await page.locator('#map-status').textContent(), html:await page.locator('html').getAttribute('data-flat-entry')}));
    throw error;
  });
  const pixels=background=>{
    const canvas=document.querySelector('#map canvas.atlas-flat-preview'),ctx=canvas?.getContext('2d');
    if(!ctx)return null;
    let different=0,light=0,shadow=0;
    const {width,height}=canvas, data=ctx.getImageData(0,0,width,height).data;
    for(let i=0;i<data.length;i+=4){
      const delta=data[i]+data[i+1]+data[i+2]-background[0]-background[1]-background[2];
      if(data[i]!==background[0]||data[i+1]!==background[1]||data[i+2]!==background[2]||data[i+3]!==background[3])different++;
      if(delta>14)light++;
      if(delta< -14)shadow++;
    }
    return {different,light,shadow};
  };
  await page.waitForFunction(background=>{
    const canvas=document.querySelector('#map canvas.atlas-flat-preview'), c=canvas?.getContext('2d');
    if(!c)return false;
    const data=c.getImageData(0,0,canvas.width,canvas.height).data;
    let dark=false,light=false;
    for(let i=0;i<data.length;i+=128){
      const delta=data[i]+data[i+1]+data[i+2]-background[0]-background[1]-background[2];
      if(delta>14)light=true;
      if(delta< -14)dark=true;
      if(light&&dark)return true;
    }
    return false;
  },bg,{timeout:12000}).catch(async error=>{
    console.error(JSON.stringify({reliefPixels:await page.evaluate(pixels,bg),demRequests:dem.length,status:await page.locator('#map-status').textContent(),errors}));
    throw error;
  });
  const on=await page.evaluate(pixels,bg);
  assert.ok(on.light>2000&&on.shadow>2000,'distinct illuminated and shadowed terrain must be visible');
  assert.ok(dem.length>0&&new Set(dem).size===dem.length,'shared worker receives one provider request per DEM tile');
  await page.locator('#settings-open').click();
  const control=page.locator('#relief');
  assert.equal(await control.isChecked(),true);
  await control.uncheck();
  assert.deepEqual(await page.evaluate(pixels,bg),{different:0,light:0,shadow:0},'turning Terrain off removes all hillshade pixels');
  const count=dem.length;
  await page.locator('#settings-close').click();
  await page.locator('.atlas-flat-zoom-button').last().click();
  await page.waitForTimeout(250);
  assert.equal(dem.length,count,'terrain off must not request new elevations while navigating');
  assert.deepEqual(await page.evaluate(()=>window.atlasTestWebgl),[]);
  assert.deepEqual(errors,[]);
  console.log('Firefox WebGL disabled: Terrain setting paints and removes real hillshade pixels',JSON.stringify({on,demRequests:count}));
}finally{
  await context?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true});
}
