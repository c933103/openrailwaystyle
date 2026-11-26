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
const html=(await readFile(new URL('index.html',root),'utf8')).replace(/<html\b/,'<html data-flat-entry="staged"');
const source=JSON.parse(await readFile(new URL('world.style.json',root),'utf8'));
const ids=new Set(['terrain-contours','terrain-contour-labels','terrain-seabed-contours','terrain-seabed-contour-labels','terrain-seabed-contours-close','terrain-seabed-contour-labels-close']);
assert.equal(source.layers.filter(layer=>ids.has(layer.id)).length,ids.size);
const style={...source,layers:[
  {id:'controlled-background',type:'background',paint:{'background-color':'#ffffff'}},
  ...source.layers.map(layer=>ids.has(layer.id) ? layer : {...layer,metadata:{...layer.metadata,
    'atlas:semantics-version':1,'atlas:views':['fixture-off']}}),
]};
const slope=terrariumFixturePng(x=>-1200+Math.min(x,256-x)*23);
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
    window.atlasContourLabels=[];
    const text=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(label,...args){
      if(this.canvas.matches('canvas.atlas-flat-preview')&& /^-?\d+ (m|ft)$/.test(String(label)))window.atlasContourLabels.push(String(label));
      return text.call(this,label,...args);
    };
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(type.startsWith('webgl')||type==='experimental-webgl')window.atlasTestWebgl.push(type);
      return get.call(this,type,...args);
    };
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const url=origin+'/?relief=1&inactive=0&names=0&labels=1&stations=0#11/0.12/0.12';
  const consoleErrors=[];
  page.on('console',entry=>{if(entry.type()==='error')consoleErrors.push(entry.text());});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.locator('#map canvas.atlas-flat-preview').waitFor({timeout:12000}).catch(async error=>{
    console.error(JSON.stringify({errors,consoleErrors, status:await page.locator('#map-status').textContent(), html:await page.locator('html').getAttribute('data-flat-entry')}));
    throw error;
  });
  const pixels=()=>{const canvas=document.querySelector('#map canvas.atlas-flat-preview'),ctx=canvas?.getContext('2d');
    if(!ctx)return null;
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let land=0;
    for(let i=0;i<data.length;i+=4){const [r,g,b]=[data[i],data[i+1],data[i+2]];
      if(r>g+6&&g>b+9)land++;}
    return {land};
  };
  const evidence=async(u)=> {
    await page.waitForFunction(({pixels,u})=>(0,eval)('('+pixels+')')()?.land>150&&window.atlasContourLabels.some(x=>x.endsWith(' '+u)),{pixels:pixels.toString(),u},{timeout:25000})
      .catch(async e=>{console.error(JSON.stringify({pixels:await page.evaluate(pixels),labels:await page.evaluate(()=>window.atlasContourLabels.slice(-20)),dem:dem.length,status:await page.locator('#map-status').textContent(),errors,consoleErrors}));throw e;});
    const labels=await page.evaluate(u=>[...new Set(window.atlasContourLabels.filter(x=>x.endsWith(' '+u)))],u);
    return {pixels:await page.evaluate(pixels),labels,demRequests:dem.length};
  };
  const first=await evidence('m');
  assert.ok(dem.length>0,'contours use the existing elevation worker');
  await page.evaluate(()=>{window.atlasContourLabels=[];});
  await page.locator('#units').selectOption('imperial');
  const second=await evidence('ft');
  assert.ok(dem.every(url=>/^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/\d+\/\d+\/\d+\.png$/.test(url)),'both unit systems use the same provider');
  assert.ok(first.labels.some(label=>Number(label.split(' ')[0])>0&&Number(label.split(' ')[0])%250===0));
  assert.ok(second.labels.some(label=>Number(label.split(' ')[0])>0&&Number(label.split(' ')[0])%500===0));
  await page.locator('#settings-open').click();
  await page.locator('#relief').uncheck();
  const off=await page.evaluate(pixels);
  assert.equal(off.land,0,'disabling Terrain clears land contours');
  assert.deepEqual(await page.evaluate(()=>window.atlasTestWebgl),[]);
  assert.deepEqual(errors,[]);
  console.log('Firefox Canvas contours and labels',JSON.stringify({first,second}));
}finally{
  await context?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true});
}
