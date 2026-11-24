import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {firefox} from 'playwright';
import {createPreviewServer} from './serve.mjs';
import {flatVectorFixture} from '../tests/fixtures/flat-vector.mjs';

const preview=createPreviewServer().listeners('request')[0];
const root=new URL('../styles/',import.meta.url);
const standardPage=await readFile(new URL('index.html',root),'utf8');
const pageSource=standardPage.replace(/<html\b/,'<html data-flat-entry="staged"');
const style=JSON.parse(await readFile(new URL('world.style.json',root),'utf8'));
style.layers=[...style.layers.map(layer=>({...layer,metadata:{...layer.metadata,'atlas:semantics-version':1,'atlas:views':['fixture-off']}})),
  {id:'fixture-bg',type:'background',paint:{'background-color':'#02131b'}},
  {id:'infrastructure-tracks',type:'line',source:'entryRail','source-layer':'rail',paint:{'line-color':'#ff0000','line-width':7}},
  {id:'station-fixture-dots',type:'circle',source:'stationFixture','source-layer':'station',paint:{'circle-color':'#00dc20','circle-radius':6}},
  {id:'fixture-hidden',type:'line',source:'hiddenRail','source-layer':'rail',metadata:{'atlas:semantics-version':1,'atlas:views':['fixture-off']}},
];
style.sources.entryRail={type:'vector',url:'/entry-tilejson.json',maxzoom:0};
style.sources.stationFixture={type:'vector',tiles:['/fixture/{z}/{x}/{y}.pbf'],maxzoom:0};
style.sources.hiddenRail={type:'vector',tiles:['/never-request/{z}/{x}/{y}.pbf']};
const bytes=Buffer.from(flatVectorFixture());
const paths=[];
let failStyle=false, activateStaging=true;
const server=createServer((req,res)=>{
  const {pathname}=new URL(req.url,'http://127.0.0.1');
  paths.push(pathname);
  if(pathname==='/') {res.writeHead(200,{'content-type':'text/html'});res.end(activateStaging?pageSource:standardPage);}
  else if(pathname==='/world.style.json') {
    res.writeHead(failStyle?503:200,{'content-type':'application/json'});res.end(failStyle?'{}':JSON.stringify(style));
  } else if(pathname==='/entry-tilejson.json') {
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({tiles:['/fixture/{z}/{x}/{y}.pbf']}));
  } else if(pathname==='/fixture/0/0/0.pbf') {
    res.writeHead(200,{'content-type':'application/x-protobuf'});res.end(bytes);
  } else preview(req,res);
});
await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try {
  browser=await firefox.launch({headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,firefoxUserPrefs:{'webgl.disabled':true}});
  const fresh=async (off=false)=>{
    const context=await browser.newContext({viewport:{width:700,height:440},deviceScaleFactor:3,serviceWorkers:'block'});
    await context.addInitScript(off=>{
      if(!localStorage.getItem('atlas_view')) localStorage.setItem('atlas_view',JSON.stringify({c:[0,0],z:0,b:0,p:0,g:false,t:false}));
      if(off) localStorage.setItem('atlas_disable_webgl','1');
      const get=HTMLCanvasElement.prototype.getContext;
      window.webglAttempts=[];
      HTMLCanvasElement.prototype.getContext=function(type,...args){
        if(type.startsWith('webgl')) window.webglAttempts.push(type);
        return get.call(this,type,...args);
      };
    },off);
    const page=await context.newPage();
    page.on('pageerror',error=>console.error(error.message));
    page.on('console',msg=>{if(msg.type()==='error') console.error(msg.text());});
    await page.route('**/*',r=>{
      const url=new URL(r.request().url());
      if(url.origin===origin) return r.continue();
      const json=(rows)=>r.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:rows});
      if(url.hostname==='api.openrailwaymap.org') return json([
        {osm_id:9001,name:'Demo station',latitude:51.5,longitude:-0.1,railway:'station',operator:'Line One'},
        {osm_id:9003,name:'Demo station',latitude:51.501,longitude:-0.103,railway:'station',operator:'Line Two'},
      ]);
      if(url.hostname==='nominatim.openstreetmap.org') return json([
        {osm_type:'relation',osm_id:9002,name:'Demo town',lat:'51.6',lon:'-0.2',type:'town',
          display_name:'Demo town, Fixture region',boundingbox:['51.55','51.65','-0.25','-0.15']},
      ]);
      if(url.hostname==='api.transitous.org') return json([]);
      return r.abort();
    });
    return {page,context};
  };
  const ready=page=>page.waitForFunction(()=>{
    const c=document.querySelector('canvas.atlas-flat-preview');
    if(!c) return false;
    const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    for(let i=0;i<a.length;i+=4) if(a[i]===255&&a[i+1]===0&&a[i+2]===0&&a[i+3]===255) return true;
    return false;
  },null,{timeout:15000});
  let current=await fresh(true);
  await current.page.goto(origin);
  await ready(current.page).catch(async e=>{console.error(await current.page.locator("#map-status").textContent(),paths.slice(-35));throw e;});
  assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),[]);
  assert.equal(await current.page.locator('#disable-webgl').isChecked(),true);
  assert.ok(paths.includes('/entry-tilejson.json')&&paths.includes('/fixture/0/0/0.pbf'));
  assert.ok(!paths.some(path=>path.includes('/vendor/maplibre-gl-')||path.startsWith('/never-request/')));
  const screenFeature=async (color)=>{
    const point=await current.page.waitForFunction(color=>{
      const c=document.querySelector('canvas.atlas-flat-preview'),r=c.getBoundingClientRect();
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) {
        const i=4*(y*c.width+x),sx=r.left+(x+0.5)*r.width/c.width,sy=r.top+(y+0.5)*r.height/c.height;
        // Real startup applies the standard translucent station stroke, not the fixture's nominal fill.
        const marked=color ? color.every((value,j)=>d[i+j]===value) :
          d[i]>2 && d[i]<100 && d[i+1]>19 && d[i+1]<130 && d[i+2]>27 && d[i+2]<130;
        if(marked&&document.elementFromPoint(sx,sy)===c)return [sx,sy];
      }
      return null;
    },color,{timeout:10000});
    await current.page.mouse.click(...await point.jsonValue());
  };
  await screenFeature([255,0,0,255]);
  await current.page.getByRole('heading',{name:'Fixture Line'}).waitFor();
  await current.page.locator('#details-close').click();
  await screenFeature(null);
  await current.page.getByRole('heading',{name:'Fixture Station'}).waitFor();
  const stored=await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')));
  assert.deepEqual(stored.c,[0,0]);
  await current.page.locator('canvas.atlas-flat-preview').press('ArrowRight');
  assert.ok(await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')).c[0]>10));
  await current.page.reload();
  await ready(current.page).catch(async e=>{console.error(await current.page.locator("#map-status").textContent(),paths.slice(-35));throw e;});
  assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),[]);
  await current.context.close();

  current=await fresh();
  await current.page.goto(origin+'/#0/89/5');
  await current.page.locator('canvas.atlas-flat-preview').waitFor();
  assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),['webgl2','webgl']);
  assert.equal(new URL(current.page.url()).hash,'#0/89/5');
  assert.deepEqual(await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')).c),[0,0]);
  assert.ok(Math.abs(Number((await current.page.locator('#map').getAttribute('data-flat-center')).split(',')[1])-85.05112878)<1e-6);
  await current.page.locator('canvas.atlas-flat-preview').press('ArrowDown');
  assert.equal(new URL(current.page.url()).hash,'');
  assert.ok(await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')).c[1]>0));
  await current.context.close();

  current=await fresh();
  await current.page.goto(origin);
  await ready(current.page).catch(async e=>{console.error(await current.page.locator("#map-status").textContent(),paths.slice(-35));throw e;});
  assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),['webgl2','webgl']);
  assert.ok(!paths.some(path=>path.includes('/vendor/maplibre-gl-')));
  if (!(await current.page.locator('#settings-open').isVisible())) await current.page.locator('#controls-open').click();
  await current.page.locator('#settings-open').click();
  await current.page.locator('#disable-webgl').check();
  await current.page.waitForFunction(()=>localStorage.getItem('atlas_disable_webgl')==='1' && window.webglAttempts?.length===0);
  await current.context.close();

  current=await fresh(true);
  await current.page.goto(origin);
  await ready(current.page);
  const openControls=async()=>{
    if(!(await current.page.locator('#search-input').isVisible())) await current.page.locator('#controls-open').click();
  };
  const submit=async()=>{
    await openControls();
    await current.page.locator('#search-input').fill('Demo');
    await current.page.locator('#search-input').press('Enter');
    await current.page.getByRole('button',{name:/Demo station.*Line Two/}).waitFor();
  };
  const view=()=>current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')));
  await submit();
  await current.page.getByRole('button',{name:/Demo station.*Line Two/}).click();
  let camera=await view();
  assert.ok(Math.abs(camera.c[0]+0.103)<1e-8&&Math.abs(camera.c[1]-51.501)<1e-8&&camera.z===14);
  await current.page.getByRole('heading',{name:'Demo station'}).waitFor();
  await current.page.locator('#details-close').click();
  await submit();
  await current.page.getByRole('button',{name:/Demo town/}).click();
  camera=await view();
  assert.ok(Math.abs(camera.c[0]+0.2)<1e-8&&Math.abs(camera.c[1]-51.6)<0.001&&camera.z>=8&&camera.z<14);
  assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),[]);
  await current.context.close();

  current=await fresh(true);
  await current.page.goto(origin);
  await ready(current.page);
  const touches=await current.page.evaluate(()=>{
    const canvas=document.querySelector('canvas.atlas-flat-preview'),r=canvas.getBoundingClientRect();
    const x=r.left+r.width/2,y=r.top+r.height/2,captures=[];
    // Firefox's fixture driver cannot inject simultaneous native touches.
    // DOM events exercise the actual entry, listeners and storage; only native capture is substituted.
    canvas.setPointerCapture=id=>captures.push(id);
    const emit=(type,id,dx,dy)=>canvas.dispatchEvent(new PointerEvent(type,{
      pointerId:id,pointerType:'touch',button:type==='pointermove'?-1:0,clientX:x+dx,clientY:y+dy,
    }));
    const persisted=()=>JSON.parse(localStorage.getItem('atlas_view'));
    const center=()=>document.querySelector('#map').dataset.flatCenter;
    const initial=persisted();
    emit('pointerdown',1,-50,0);emit('pointerdown',2,50,0);
    emit('pointermove',1,-100,0);emit('pointermove',2,100,0);
    emit('pointerup',1,-100,0);
    const firstUp=persisted();
    emit('lostpointercapture',1,-100,0);
    emit('pointerup',2,100,0);
    const zoomed=persisted(),beforeCancel=center();
    emit('pointerdown',3,-50,0);emit('pointerdown',4,50,0);
    emit('pointermove',3,-80,40);emit('pointermove',4,140,40);
    const duringCancel=center();
    emit('pointercancel',4,140,40);emit('pointerup',3,-80,40);
    return {captures,initial,firstUp,zoomed,beforeCancel,duringCancel,afterCancel:center(),persisted:persisted()};
  });
  assert.deepEqual(touches.captures,[1,2,3,4]);
  assert.deepEqual(touches.firstUp,touches.initial);
  assert.equal(touches.zoomed.z,1);
  assert.ok(touches.zoomed.c.every(value=>Math.abs(value)<0.001));
  assert.notEqual(touches.duringCancel,touches.beforeCancel);
  assert.equal(touches.afterCancel,touches.beforeCancel);
  assert.deepEqual(touches.persisted,touches.zoomed);
  assert.equal(await current.page.getByRole('heading',{name:'Fixture Station'}).isVisible(),false);
  await current.page.reload();
  await current.page.locator("canvas.atlas-flat-preview").waitFor();
  assert.deepEqual(await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view'))),touches.zoomed);
  await current.context.close();

  failStyle=true;
  current=await fresh();
  await current.page.goto(origin);
  await current.page.getByText('The map style could not load. Reload to try again.').waitFor();
  assert.equal(await current.page.locator('canvas.atlas-flat-preview').count(),0);
  await current.context.close();
  failStyle=false;
  activateStaging=false;
  current=await fresh(true);
  await current.page.goto(origin);
  await current.page.getByText('This browser could not start WebGL. Enable graphics acceleration in your browser settings, then reload the map.').waitFor({timeout:15000});
  assert.ok(paths.some(path=>path.includes('/vendor/maplibre-gl-')&&path.endsWith('.js')));
  assert.ok(paths.some(path=>path.includes('/vendor/maplibre-gl-')&&path.endsWith('.css')));
  assert.equal(await current.page.locator('#flat-preview-preference').isVisible(),false);
  assert.equal(await current.page.locator('canvas.atlas-flat-preview').count(),0);
  await current.context.close();
  console.log('Firefox real Atlas entry: rails painted with automatic and explicit Canvas, no GL library/CSS, preference persisted, rails and stations inspected, search destinations selected, pan committed, simulated multi-touch zoom and cancellation verified, passive polar view preserved, and style errors surfaced.');
} finally {await browser?.close();server.close();}
