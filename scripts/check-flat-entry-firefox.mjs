import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {firefox} from 'playwright';
import {gzipSync} from 'node:zlib';
import {zxyToTileId} from 'pmtiles';
import vtPbf from 'vt-pbf';
import {pmtilesBytesResponse} from './pmtiles-browser-fixture.mjs';
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
  {id:'station-fixture-dots',type:'circle',source:'stationFixture','source-layer':'station',metadata:{'atlas:semantics-version':1,'atlas:settings':['stations']},paint:{'circle-color':'#00dc20','circle-radius':6}},
  {id:'fixture-track-names',type:'symbol',source:'entryRail','source-layer':'rail',layout:{
    'text-field':['get','name'],'symbol-placement':'line','text-size':20,'text-offset':[0,-1.2],
  },paint:{'text-color':'#ffff00'}},
  {id:'station-fixture-names',type:'symbol',source:'labelFixture','source-layer':'station',metadata:{'atlas:semantics-version':1,'atlas:settings':['stations']},layout:{
    'text-field':['get','name'],'text-size':18,'text-anchor':'top','text-offset':[0,0.9],
  },paint:{'text-color':'#ff00ff'}},
  {...style.layers.find(layer=>layer.id==='context-transport-bus-label'),
    metadata:{'atlas:semantics-version':1,'atlas:settings':['transport']}},
  {id:'fixture-hidden',type:'line',source:'hiddenRail','source-layer':'rail',metadata:{'atlas:semantics-version':1,'atlas:views':['fixture-off']}},
];
style.sources.openmaptiles.url='pmtiles://data/nearby-fixture.pmtiles';
style.sources.entryRail={type:'vector',url:'/entry-tilejson.json',maxzoom:0};
style.sources.stationFixture={type:'vector',tiles:['/fixture/{z}/{x}/{y}.pbf'],maxzoom:0};
style.sources.labelFixture={type:'vector',tiles:['/label/{z}/{x}/{y}.pbf'],maxzoom:0};
style.sources.hiddenRail={type:'vector',tiles:['/never-request/{z}/{x}/{y}.pbf']};
const bytes=Buffer.from(flatVectorFixture());
// A single archived bus interchange roughly 90 m from the fixture station.
const nearbyLngLat=[-0.1017,51.501], n=2**14;
const mx=(nearbyLngLat[0]+180)/360*n,my=(1-Math.asinh(Math.tan(nearbyLngLat[1]*Math.PI/180))/Math.PI)/2*n;
const xx=Math.floor(mx),yy=Math.floor(my);
const local=[Math.round((mx-xx)*4096),Math.round((my-yy)*4096)];
const nearbyMvt=vtPbf.fromGeojsonVt({poi:{features:[
  {id:611,type:1,tags:{class:'bus_station',name:'Fixture Bus Interchange'},geometry:[local]},
]}},{version:2,extent:4096});
const varints=values=>Buffer.from(values.flatMap(value=>{
  const out=[];while(value>127){out.push(value%128+128);value=Math.floor(value/128);}
  out.push(value);return out;
}));
const packed=gzipSync(nearbyMvt), dir=varints([1,zxyToTileId(14,xx,yy),1,packed.length,1]);
const meta=Buffer.from('{}'), header=Buffer.alloc(127);
header.write('PMTiles');header[7]=3;
const begin=127+dir.length,end=begin+meta.length;
for(const [offset,value] of [[8,127],[16,dir.length],[24,begin],[32,meta.length],[40,end],[48,0],
  [56,end],[64,packed.length],[72,1],[80,1],[88,1]])header.writeBigUInt64LE(BigInt(value),offset);
header[96]=1;header[97]=1;header[98]=2;header[99]=1;header[100]=14;header[101]=14;
for(const [offset,value] of [[102,-180],[106,-85],[110,180],[114,85]])header.writeInt32LE(value*1e7,offset);
const nearbyArchive=Buffer.concat([header,dir,meta,packed]);
const paths=[];
let failStyle=false, activateStaging=true;
const server=createServer((req,res)=>{
  const {pathname}=new URL(req.url,'http://127.0.0.1');
  paths.push(pathname);
  if(pathname==='/') {res.writeHead(200,{'content-type':'text/html'});res.end(activateStaging?pageSource:standardPage);}
  else if(pathname==='/world.style.json') {
    res.writeHead(failStyle?503:200,{'content-type':'application/json'});res.end(failStyle?'{}':JSON.stringify(style));
  } else if(pathname==='/data/nearby-fixture.pmtiles') {
    const r=pmtilesBytesResponse(nearbyArchive,req.headers.range,'nearby-fixture-v1');
    res.writeHead(r.status,r.headers);res.end(r.body);
  } else if(pathname==='/entry-tilejson.json') {
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({tiles:['/fixture/{z}/{x}/{y}.pbf']}));
  } else if(pathname==='/fixture/0/0/0.pbf'||pathname==='/label/0/0/0.pbf') {
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
      if(['api.openrailwaymap.org','nominatim.openstreetmap.org'].includes(url.hostname) &&
        url.searchParams.get('q')==='Fixture Station')
        return r.fulfill({status:503,headers:{'access-control-allow-origin':'*'},body:''});
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
  await current.page.waitForFunction(()=>{
    const c=document.querySelector('canvas.atlas-flat-preview');
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    return d.some((value,i)=>i%4===0&&value===255&&d[i+1]===0&&d[i+2]===255&&d[i+3]===255);
  },null,{timeout:10000});
  assert.ok(paths.includes('/label/0/0/0.pbf'),'symbol-only source supplied the visibly painted name');
  await current.page.waitForFunction(()=>{
    const c=document.querySelector('canvas.atlas-flat-preview');
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    return d.some((value,i)=>i%4===0&&value===255&&d[i+1]===255&&d[i+2]===0&&d[i+3]===255);
  },null,{timeout:10000});


  assert.ok(!paths.some(path=>path.includes('/vendor/maplibre-gl-')||path.startsWith('/never-request/')));
  // A settings change must affect the current canvas, not just storage or
  // the next load. The other rail source stays installed without refetching.
  const railReads=paths.filter(path=>path==='/entry-tilejson.json').length;
  await current.page.locator('canvas.atlas-flat-preview').evaluate(canvas=>canvas.dataset.optionProbe='current');
  if(!(await current.page.locator('#settings-open').isVisible()))await current.page.locator('#controls-open').click();
  await current.page.locator('#settings-open').click();
  const labelVisible=expected=>current.page.waitForFunction(expected=>{
    const c=document.querySelector('canvas.atlas-flat-preview');
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    return d.some((value,i)=>i%4===0&&value===255&&d[i+1]===0&&d[i+2]===255&&d[i+3]===255)===expected;
  },expected,{timeout:10000});
  await current.page.locator('#stations').uncheck();await labelVisible(false);await ready(current.page);
  await current.page.locator('#stations').check();await labelVisible(true);await ready(current.page);
  await current.page.locator('#settings-close').click();
  assert.equal(await current.page.locator('canvas.atlas-flat-preview').getAttribute('data-option-probe'),'current');
  assert.equal(paths.filter(path=>path==='/entry-tilejson.json').length,railReads);
  assert.deepEqual(await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')).c),[0,0]);

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
  await current.page.locator('#details-close').click();
  const page=current.page, canvas=page.locator('canvas.atlas-flat-preview');
  await page.getByRole('button',{name:'Measure',exact:true}).click();
  assert.equal(await page.locator('[data-measure="distance"]').getAttribute('aria-pressed'),'true');
  const positions=await canvas.evaluate(c=>{
    const r=c.getBoundingClientRect();
    // Stay out of the settings panel and change the measured line's direction.
    return [[.57,.22],[.70,.30],[.63,.35],[.75,.23]].map(([x,y])=>[r.left+x*r.width,r.top+y*r.height]);
  });
  assert.ok(await page.evaluate(points=>points.every(([x,y])=>document.elementFromPoint(x,y)?.matches("canvas.atlas-flat-preview")),positions));
  for(const xy of positions.slice(0,2))await page.mouse.click(...xy);
  await page.locator('#measure-finish').click();
  await page.waitForFunction(()=>/Distance: .+ over 1 segment\./.test(document.querySelector('#measure-status').textContent));
  await page.waitForFunction(positions=>{
    const c=document.querySelector('canvas.atlas-flat-preview'),r=c.getBoundingClientRect(),cx=c.getContext('2d');
    return positions.slice(0,2).every(([x,y])=>{
      const rgb=cx.getImageData(Math.round((x-r.left)*c.width/r.width),Math.round((y-r.top)*c.height/r.height),1,1).data;
      return rgb[0]===255&&rgb[1]===254&&rgb[2]===248;
    });
  },positions);
  const prior=await page.locator('#measure-status').textContent();
  assert.equal(await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.matches('canvas.atlas-flat-preview'),positions[1]),true);
  await page.mouse.move(...positions[1]);await page.mouse.down();await page.mouse.move(...positions[3],{steps:5});await page.mouse.up();
  assert.notEqual(await page.locator('#measure-status').textContent(),prior,'moving a handle updates the measure');
  await page.locator('#measure-profile').click();
  await page.getByRole('heading',{name:'Distance elevation profile'}).waitFor();
  await page.getByText('The terrain tiles could not load here.',{exact:true}).waitFor();
  await page.locator('#details-close').click();
  await page.locator('[data-measure="radius"]').click();
  for(const xy of positions.slice(0,3))await page.mouse.click(...xy);
  await page.waitForFunction(()=>document.querySelector('#measure-status').textContent.includes('Curve radius ≈'));
  await page.locator('#measure-undo').click();
  assert.match(await page.locator('#measure-status').textContent(),/1 more point/);
  await page.locator('[data-measure="elevation"]').click();
  await page.mouse.click(...positions[0]);
  await page.waitForFunction(()=>document.querySelector('#measure-status').textContent.includes('Elevation: unavailable'));
  await page.locator('#measure-close').click();
  assert.equal(await page.locator('#measure-toolbar').isVisible(),false);
  assert.deepEqual(await page.evaluate(()=>window.webglAttempts),[]);
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
  const nearby=current.page.locator('#nearby-transport');
  await nearby.getByRole('button',{name:'Fixture Bus Interchange'}).waitFor({timeout:10000}).catch(async error=>{
    console.error('Nearby state:',await nearby.textContent(), 'Map:',await current.page.locator('#map-status').textContent(),
      'Archives:',paths.filter(path=>path.endsWith('.pmtiles')));throw error;
  });
  assert.match(await nearby.innerText(),/Bus \/ coach interchange · 90 m/);
  assert.match(await nearby.innerText(),/Within 500 m in a straight line/);
  assert.ok(paths.includes('/data/nearby-fixture.pmtiles'));
  await nearby.getByRole('button',{name:'Fixture Bus Interchange'}).click();
  await current.page.getByRole('heading',{name:'Fixture Bus Interchange'}).waitFor();
  camera=await view();
  assert.ok(Math.abs(camera.c[0]-nearbyLngLat[0])<0.00002&&Math.abs(camera.c[1]-nearbyLngLat[1])<0.00002&&camera.z===14);

  await current.page.locator('#details-close').click();
  // After nearby recentering, open the same facility from its actual icon.
  const paintedBus=expected=>current.page.waitForFunction(expected=>{
    const c=document.querySelector('canvas.atlas-flat-preview'),r=c.getBoundingClientRect();
    const x=Math.round(c.width/2),y=Math.round(c.height/2);
    const d=c.getContext('2d').getImageData(x-15,y-15,31,31).data;
    const visible=d.some((v,i)=>i%4===0&&v===255&&d[i+1]===254&&d[i+2]===248&&d[i+3]===255);
    return visible===expected?[r.left+x*r.width/c.width,r.top+y*r.height/c.height]:null;
  },expected,{timeout:10000});
  const clickPoint=await (await paintedBus(true)).jsonValue();
  await current.page.mouse.click(...clickPoint);
  await current.page.getByRole('heading',{name:'Fixture Bus Interchange'}).waitFor();
  await current.page.locator('#details-close').click();
  if(!(await current.page.locator('#settings-open').isVisible()))await current.page.locator('#controls-open').click();
  await current.page.locator('#settings-open').click();
  await current.page.locator('#transport').uncheck();
  await paintedBus(false);
  await current.page.locator('#settings-close').click();
  await current.page.mouse.click(...clickPoint);
  assert.equal(await current.page.getByRole('heading',{name:'Fixture Bus Interchange'}).isVisible(),false);
  await current.page.locator('#settings-open').click();
  await current.page.locator('#transport').check();
  await current.page.locator('#settings-close').click();
  await paintedBus(true);
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

  current=await fresh(true);
  await current.page.goto(origin);
  await ready(current.page);
  const localInput=current.page.getByRole('searchbox',{name:'Find a station, railway facility or place'});
  if(!await localInput.isVisible())await current.page.locator('#controls-open').click();
  // The map's own vector tile should work even with both search endpoints down.
  await localInput.fill('Fixture Station');await localInput.press('Enter');
  const localResult=current.page.locator('#search-results').getByRole('button',{name:/Fixture Station/});
  await localResult.waitFor({timeout:15000});
  assert.equal(await localResult.count(),1);
  await localResult.click();
  await current.page.getByRole('heading',{name:'Fixture Station'}).waitFor();
  const localView=await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')));
  assert.equal(localView.z,14);
  assert.ok(Math.abs(localView.c[0])<1e-8&&localView.c[1]<-35&&localView.c[1]>-38);
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
  console.log('Firefox real Atlas entry: rails and point/line labels painted with automatic and explicit Canvas, no GL library/CSS, preference persisted, station toggling repainted without remount or rail refetch, rails and stations inspected, search destinations selected, loaded station found despite remote outage and nearby transport and its painted icon opened, pan committed, simulated multi-touch zoom and cancellation verified, passive polar view preserved, and style errors surfaced.');
} finally {await browser?.close();server.close();}
