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

const viewport={width:960,height:640},center=[-0.12,51.5],zoom=17;
const camera=flatCamera({...viewport,center,zoom});
const points=(coords)=>coords.map(p=>camera.unproject(p));
const line=(id,arrows,coords)=>({type:'Feature',id,properties:{arrows,kind:'escalator'},
  geometry:{type:'LineString',coordinates:points(coords)}});
const badge=(id,tracks,coords,properties={})=>({type:'Feature',id,properties:{tracks,...properties},
  geometry:{type:'Point',coordinates:camera.unproject(coords)}});
const index=features=>geojsonvt({type:'FeatureCollection',features},{maxZoom:14,indexMaxZoom:14,extent:4096});
const indexes={conveying:index([
  line(11,'one_way',[[120,208],[160,208],[160,248],[360,248]]),
  line(12,'one_way',[[820,248],[580,248]]),
  line(13,'two_way',[[420,360],[540,360]]),
  line(14,'unknown',[[590,360],[810,360]]),
]),atlas_track_counts:index([
  badge(21,2,[260,470]),badge(22,12,[260,470]),
  badge(23,3,[470,470],{tunnel:true}),badge(24,8,[690,470],{station:true}),
])};
const preview=createPreviewServer({root:'styles'});
const html=(await readFile('styles/index.html','utf8')).replace(/<html\b/,'<html data-flat-entry="staged"');
const base=JSON.parse(await readFile('styles/world.style.json','utf8'));
const requests=[];
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(html);return;}
  if(path==='/world.style.json'){
    const sources={...base.sources};
    for(const [source,layer] of [['conveying','conveying'],['trackCounts','atlas_track_counts']])
      sources[source]={...sources[source],url:undefined,tiles:[origin+'/rail-symbols-'+layer+'/{z}/{x}/{y}.pbf']};
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({...base,sources}));return;
  }
  if(path.startsWith('/rail-symbols-')){
    requests.push(path);
    const tile=ormVectorFixture(path.replace('/rail-symbols-','/'),indexes);
    assert.ok(tile);res.writeHead(200,{'content-type':tile.contentType}).end(tile.body);return;
  }
  preview.emit('request',req,res);
});
await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(tmpdir(),'atlas-flat-rail-symbols-'));
let context;
try{
  context=await firefox.launchPersistentContext(profile,{headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,
    viewport,deviceScaleFactor:1,serviceWorkers:'block',firefoxUserPrefs:{'webgl.disabled':true}});
  await installEmptyMapProviders(context,origin+'/',{firstParty:'network'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.setItem('atlas_disable_webgl','1');
    window.glAttempts=[];window.arrows=[];window.badges=[];window.rects=[];
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(type.startsWith('webgl'))window.glAttempts.push(type);
      return get.call(this,type,...args);
    };
    const proto=CanvasRenderingContext2D.prototype;
    const begin=proto.beginPath,move=proto.moveTo,line=proto.lineTo,stroke=proto.stroke,text=proto.fillText,rect=proto.roundRect;
    const paths=new WeakMap(), flat=c=>c.canvas.classList.contains('atlas-flat-preview');
    proto.beginPath=function(){if(flat(this))paths.set(this,[]);return begin.call(this);};
    const keep=function(x,y){
      if(flat(this)){
        const p=this.getTransform().transformPoint({x,y});
        paths.get(this)?.push([p.x,p.y]);
      }
    };
    proto.moveTo=function(x,y){keep.call(this,x,y);return move.call(this,x,y);};
    proto.lineTo=function(x,y){keep.call(this,x,y);return line.call(this,x,y);};
    proto.stroke=function(...args){
      const p=paths.get(this);
      if(flat(this)&&this.strokeStyle==='#4a4f55'&&p?.length===3&&Math.abs(p[0][1]-p[2][1])>4)
        window.arrows.push(p);
      return stroke.apply(this,args);
    };
    proto.roundRect=function(x,y,w,h,...args){
      if(flat(this))window.rects.push([x,y,w,h]);
      return rect.call(this,x,y,w,h,...args);
    };
    proto.fillText=function(t,x,y,...args){
      if(flat(this)&&/^(?:2|3|8|12)$/.test(t))window.badges.push([t,x,y,this.fillStyle]);
      return text.call(this,t,x,y,...args);
    };
  });
  const opts='?mode=infrastructure&relief=0&stations=0&names=0&transport=0&destinations=0&constraints=0&trackCounts=';
  await page.goto(origin+'/'+opts+'1#17/51.5/-0.12');
  await page.locator('canvas.atlas-flat-preview').waitFor();
  const pixels=await page.waitForFunction(()=>{
    if(window.arrows.length<4||new Set(window.badges.map(b=>b[0])).size<3)return false;
    const ctx=document.querySelector('canvas.atlas-flat-preview').getContext('2d');
    const nearby=(x,y,target,tol)=>{
      const pixels=ctx.getImageData(Math.round(x)-1,Math.round(y)-1,3,3).data;
      for(let i=0;i<pixels.length;i+=4)if(target.every((v,j)=>Math.abs(pixels[i+j]-v)<=tol))return true;
      return false;
    };
    const rim=(x,y,fill,edge)=>{
      const rect=window.rects.find(([l,t,w,h])=>Math.abs(l+w/2-x)<3&&Math.abs(t+h/2-y)<3);
      if(!rect)return false;
      const [l,t,w]=rect;
      const pixels=ctx.getImageData(Math.round(l+w/2)-1,Math.round(t)-1,3,3).data;
      const delta=fill.map((v,j)=>v-edge[j]);
      for(let i=0;i<pixels.length;i+=4){
        const blend=delta.reduce((sum,v,j)=>sum+v*(fill[j]-pixels[i+j]),0)/delta.reduce((sum,v)=>sum+v*v,0);
        if(blend>=0.35)return true; // a 1 CSS-pixel outline may be antialiased
      }
      return false;
    };
    return {
      arrows:window.arrows.map(p=>({point:p[1],direction:Math.sign(p[1][0]-p[0][0]),
        tip:nearby(...p[1],[74,79,85],35)})),
      badges:window.badges,
      fills:[[260,470,[255,254,248]],[470,470,[227,234,236]],[690,470,[255,243,218]]]
        .map(([x,y,rgb])=>nearby(x+5,y+3,rgb,16)),
      outlines:[[260,470,[255,254,248],[23,62,71]],[470,470,[227,234,236],[125,148,156]],
        [690,470,[255,243,218],[196,125,18]]].map(args=>rim(...args)),
    };
  },null,{timeout:15000}).then(handle=>handle.jsonValue());
  const find=(x,y,d)=>pixels.arrows.some(({point:[px,py],direction,tip})=>
    Math.abs(x-px)<3&&Math.abs(y-py)<2&&direction===d&&tip);
  // First arrow lies at the asymmetric path's length midpoint and heads east,
  // not the middle of its longest segment. The second's OSM order is west.
  assert.ok(find(222,248,1),JSON.stringify(pixels.arrows));
  assert.ok(find(697.75,248,-1),JSON.stringify(pixels.arrows));
  assert.ok(find(487.6,360,1)&&find(472.4,360,-1),JSON.stringify(pixels.arrows));
  assert.ok(pixels.arrows.every(({point:[x,y]})=>!(x>590&&Math.abs(y-360)<2)),'Unknown direction must not draw a chevron');
  assert.deepEqual(pixels.fills,[true,true,true]);
  assert.deepEqual(pixels.outlines,[true,true,true]);
  const seen=new Map(pixels.badges.map(b=>[b[0],b[3]]));
  assert.deepEqual([...seen].sort(),[['12','#173e47'],['3','#4b626a'],['8','#7a4a08']]);
  assert.ok(requests.some(p=>p.includes('/rail-symbols-conveying/')));
  assert.ok(requests.some(p=>p.includes('/rail-symbols-atlas_track_counts/')));
  assert.deepEqual(await page.evaluate(()=>window.glAttempts),[]);
  const priorBadges=requests.filter(p=>p.includes('/rail-symbols-atlas_track_counts/')).length;
  await page.goto(origin+'/'+opts+'0#17/51.5/-0.12');
  await page.waitForFunction(()=>window.arrows.length>=4);
  assert.equal(requests.filter(p=>p.includes('/rail-symbols-atlas_track_counts/')).length,priorBadges);
  assert.deepEqual(await page.evaluate(()=>window.badges),[],'Track counts setting must remove badges');
  assert.deepEqual(errors,[]);
  console.log('Firefox without WebGL: east/west/offset reversible arrows and distinct surface, tunnel and station counts painted; disabled counts did not request tiles.');
}finally{await context?.close();server.close();await rm(profile,{recursive:true,force:true});}
