import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {firefox} from 'playwright';
import geojsonvt from 'geojson-vt';
import {createPreviewServer} from './serve.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {ormVectorFixture} from './orm-vector-fixture.mjs';

const root=new URL('../styles/',import.meta.url);
const html=(await readFile(new URL('index.html',root),'utf8')).replace(/<html\b/,'<html data-flat-entry="staged"');
const style=JSON.parse(await readFile(new URL('world.style.json',root),'utf8'));
const zoom=10,x=512,y=511,center=[.12,.12];
const pathFor=id=>'/fixture/'+id+'/'+zoom+'/'+x+'/'+y;
const feature=(id,name,lat)=>({type:'Feature',id,properties:{id:'way-'+id,name,feature:'rail',railway:'rail',osm_type:'way',osm_id:id},
  geometry:{type:'LineString',coordinates:[[.025,lat],[.21,lat]]}});
const track=index=>geojsonvt({type:'FeatureCollection',features:[index]},{extent:4096,indexMaxZoom:zoom});
const main={rail:track(feature(2345,'Recovered fixture rail',.12))};
const healthy={rail:track(feature(2346,'Healthy fixture rail',.19))};
const layer=(id,source,color)=>({id,source,type:'line','source-layer':'rail',paint:{'line-color':color,'line-width':8}});
const source=(base,key)=>({type:'vector',tiles:[base+'/fixture/'+key+'/{z}/{x}/{y}'],minzoom:zoom,maxzoom:zoom});
const retryCase=process.argv[2]??'all';
let testCase;
const preview=createPreviewServer({root:'styles'});
const origin=await new Promise(resolve=>{
 const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname, base='http://127.0.0.1:'+server.address().port;
  const response=(type,body)=>res.writeHead(200,{'content-type':type,'cache-control':'no-store'}).end(body);
  const json=data=>response('application/json',JSON.stringify(data));
  if(path==='/')return response('text/html',html);
  if(path==='/world.style.json'){
   const sources={...style.sources,kept:source(base,'healthy'),entryRail:testCase==='metadata'
      ?{type:'vector',url:base+'/fixture/tilejson'}:source(base,'rail')};
   const layers=style.layers.filter(l=>l.id!=='infrastructure-tracks'&&!['bathymetry'].includes(l.source)).map(l=>({...l,
    metadata:{...l.metadata,'atlas:semantics-version':1,'atlas:views':['fixture-off']}}));
   layers.push({id:'control-background',type:'background',paint:{'background-color':'#f4f4f4'}},
    layer('infrastructure-tracks','entryRail','#fb0000'),layer('healthy-fixture','kept','#009600'));
   if(testCase==='auxiliary'||testCase==='mixed'){
    sources.bathymetry={type:'raster',tiles:[base+'/fixture/depth/{z}/{x}/{y}.png'],minzoom:zoom,maxzoom:zoom};
    layers.push({id:'auxiliary-depth',type:'raster',source:'bathymetry'});
    if(testCase==='mixed'){
     sources.extra={type:'raster',tiles:[base+'/fixture/extra/{z}/{x}/{y}.png'],minzoom:zoom,maxzoom:zoom};
     layers.push({id:'mixed-extra',type:'raster',source:'extra'});
    }
   }
   return json({...style,sources,layers});
  }
  if(path==='/fixture/tilejson')return json({tiles:[base+'/fixture/rail/{z}/{x}/{y}'],minzoom:zoom,maxzoom:zoom});
  if(path.startsWith('/fixture/rail/')||path.startsWith('/fixture/healthy/')){
   const tile=ormVectorFixture(path.replace(/^\/fixture\/(?:healthy|rail)/,'/rail'),path.includes('/healthy/')?healthy:main);
   return response(tile.contentType,tile.body);
  }
  if(path.startsWith('/fixture/depth/')||path.startsWith('/fixture/extra/'))return res.writeHead(404).end();
  preview.emit('request',req,res);
 });
 server.listen(0,'127.0.0.1',()=>resolve({url:'http://127.0.0.1:'+server.address().port,server}));
});
const profile=await mkdtemp(join(tmpdir(),'atlas-flat-recovery-'));
let context;
const getPixel=kind=>{
 const c=document.querySelector('canvas.atlas-flat-preview');
 if(!c)return false;
 const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
 for(let i=0;i<data.length;i+=4){
  if(kind==='red'&&data[i]>230&&data[i+1]<45&&data[i+2]<45)return true;
  if(kind==='green'&&data[i]<35&&data[i+1]>110&&data[i+1]<190&&data[i+2]<40)return true;
 }
 return false;
};
try{
 context=await firefox.launchPersistentContext(profile,{headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,
   firefoxUserPrefs:{'webgl.disabled':true},viewport:{width:850,height:630},serviceWorkers:'block'});
 await installEmptyMapProviders(context,origin.url+'/',{firstParty:'network'});
 await context.addInitScript(()=>{localStorage.setItem('atlas_disable_webgl','1');});
 for(const candidate of retryCase==='all'?['tile','metadata','server','auxiliary','mixed']:[retryCase]){
  testCase=candidate;
  const page=await context.newPage(),errors=[],counts=new Map();
  let restored=false,complete,firstFailureAt;
  const releaseRetry=new Promise(resolve=>{complete=resolve;});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(url=>url.origin===origin.url&&url.pathname.startsWith('/fixture/'),async route=>{
   const {pathname:p}=new URL(route.request().url());
   counts.set(p,(counts.get(p)??0)+1);
   const targeted=['tile','server'].includes(testCase)&&p===pathFor('rail')||testCase==='metadata'&&p==='/fixture/tilejson';
   if(targeted&&!restored){
    firstFailureAt=Date.now();
    if(testCase==='server')return route.fulfill({status:503,headers:{'Retry-After':'6'},body:''});
    return route.abort('internetdisconnected');
   }
   if(targeted)await releaseRetry;
   return route.continue();
  });
  try{
   const url=origin.url+'/?mode=infrastructure&relief=0&names=0&labels=0&stations=0&inactive=0&transport=0#10/'+center[1]+'/'+center[0];
   await page.goto(url,{waitUntil:'domcontentloaded'});
   const status=page.locator('#map-status');
   await page.waitForFunction(getPixel,'green',{timeout:12000});
   await page.waitForFunction(()=>document.querySelector('#map-status').classList.contains('error'),null,{timeout:12000});
   if(candidate==='auxiliary'||candidate==='mixed'){
    await page.waitForFunction(getPixel,'red',{timeout:12000});
    // A pair of failures may arrive on separate frames. Require the scoped
    // or mixed message after the corresponding failures reach the status.
    await page.waitForFunction(mode=>{
     const status=document.querySelector('#map-status').textContent;
     return mode==='auxiliary'?/Bathymetry tiles.+Seabed shading/i.test(status):/visible tile data/.test(status);
    },candidate,{timeout:3500});
   }else{
    assert.equal(await page.evaluate(getPixel,'red'),false);
    const target=candidate==='metadata'?'/fixture/tilejson':pathFor('rail'), control=pathFor('healthy');
    assert.equal(counts.get(target),1);
    const canvas=page.locator('canvas.atlas-flat-preview'), map=page.locator('#map');
    const before=await map.getAttribute('data-flat-center');
    restored=true;
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    if(candidate==='server'){
     await page.waitForTimeout(150);
     assert.equal(counts.get(target),1,'reconnect cannot bypass Retry-After');
    }
    const deadline=Date.now()+(candidate==='server'?8500:3000);
    while(counts.get(target)!==2&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(counts.get(target),2,'recover failed '+candidate+' at the fixed camera');
    if(candidate==='server')assert.ok(Date.now()-firstFailureAt>=5900,'idle retry respects provider delay');
    assert.match(await status.getAttribute('class'),/error/,'pending retry is not proof of recovery');
    assert.equal(await page.evaluate(getPixel,'red'),false);
    assert.equal(await page.evaluate(getPixel,'green'),true);
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    assert.equal(counts.get(target),2);
    complete();
    await page.waitForFunction(getPixel,'red',{timeout:12000});
    await page.waitForFunction(()=>!document.querySelector('#map-status').classList.contains('error'),null,{timeout:10000});
    assert.equal(await map.getAttribute('data-flat-center'),before);
    assert.equal(counts.get(control),1);
    assert.equal(counts.get(target),2);
    // The rendered fixture lies on the centre latitude. Click a red pixel
    // rather than an assumed DOM coordinate so the actual hit tester runs.
    if(await page.locator('#controls').isVisible())await page.locator('#collapse').click();
    const position=await canvas.evaluate(c=>{
     const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
     for(let i=0;i<d.length;i+=4){if(d[i]>230&&d[i+1]<45&&d[i+2]<45)
      return {x:Math.floor(i/4)%c.width,y:Math.floor(i/4/c.width)+2};}
    });
    assert.ok(position);
    await canvas.click({position});
    await page.getByText('Recovered fixture rail',{exact:true}).first().waitFor({timeout:5000});
   }
   assert.deepEqual(errors,[]);
   console.log(candidate,'passed',{status:await status.textContent(),attempts:[...counts].filter(([p])=>p===pathFor('rail')||p==='/fixture/tilejson')});
  }finally{complete();await page.close();}
 }
}finally{
 await context?.close();origin.server.closeAllConnections();await new Promise(resolve=>origin.server.close(resolve));
 await rm(profile,{recursive:true,force:true});
}
