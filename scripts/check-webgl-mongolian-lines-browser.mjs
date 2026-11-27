import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import geojsonvt from 'geojson-vt';
import {createPreviewServer} from './serve.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {ormVectorFixture} from './orm-vector-fixture.mjs';
import {flatCamera} from '../styles/flat-camera.mjs';

const center=[106.908,47.908],width=960,height=640,zoom=10;
const camera=flatCamera({center,width,height,zoom});
const word='ᠤᠯᠠᠭᠠᠨᠪᠠᠭᠠᠲᠤᠷ';
const records=[
  {role:'script',name:word,points:[[205,184],[428,253]],color:'#e926b8'},
  {role:'mixed',name:'Төмөр зам '+word,points:[[535,406],[759,316]],color:'#0cfabe'},
  {role:'control',name:'Ordinary route',points:[[257,462],[477,436]],color:'#fa8110'},
];
// Same anchor as the pure-script route; it is lower in style order and
// must not overprint the higher-priority route name.
const collision={role:'collision',name:'ᠬᠣᠲᠠᠶᠢᠨ',points:records[0].points,color:'#e22e25'};
const allRecords=[collision,...records];
const features=allRecords.map(({role,name,points},i)=>({type:'Feature',id:i+1,properties:{role,name},
  geometry:{type:'LineString',coordinates:points.map(point=>camera.unproject(point))}}));
const index=geojsonvt({type:'FeatureCollection',features},{extent:4096,indexMaxZoom:10});
const base=JSON.parse(await readFile('styles/world.style.json','utf8'));
const html=await readFile('styles/index.html','utf8');
const woff=await readFile('tests/fixtures/mongolian-font/mongolian-400-018.woff2');
const preview=createPreviewServer({root:'styles'});
const layer=({role,color})=>({type:'symbol',id:'route-fixture-'+role,source:'routeFixture','source-layer':'route_fixture',
  metadata:{'atlas:semantics-version':1,'atlas:localize':true},
  layout:{'symbol-placement':'line','text-field':['get','name'],'text-size':20,'text-anchor':'center',
    'text-max-width':10,'text-padding':2,'symbol-spacing':280},
  filter:['==',['get','role'],role],paint:{'text-color':color}});
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/')return res.writeHead(200,{'content-type':'text/html'}).end(html);
  if(path==='/world.style.json')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({
    ...base,sources:{...base.sources,routeFixture:{type:'vector',tiles:[origin+'/route_fixture/{z}/{x}/{y}'],minzoom:10,maxzoom:10}},
    layers:[...base.layers,...allRecords.map(layer)],
  }));
  if(path.startsWith('/route_fixture/')){
    const t=ormVectorFixture(path,{route_fixture:index});
    return res.writeHead(200,{'content-type':t.contentType}).end(t.body);
  }
  if(path==='/fonts/world-v1/index.json')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({families:{mongolian:{400:[24]}}}));
  if(path==='/fonts/world-v1/mongolian-400-018.woff2')return res.writeHead(200,{'content-type':'font/woff2'}).end(woff);
  preview.emit('request',req,res);
});
await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const readInk=async(page,png)=>page.evaluate(async({png,width,height})=>{
  const img=new Image(); img.src=png;await img.decode();
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const p=canvas.getContext('2d');p.drawImage(img,0,0);const {data}=p.getImageData(0,0,width,height);
  const colors=[[233,38,184],[12,250,190],[250,129,16],[226,46,37]];
  return colors.map(color=>{
    const points=[],rows=Array(height).fill(0),xs=Array.from({length:width},()=>[]);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4;
      if((data[i]-color[0])**2+(data[i+1]-color[1])**2+(data[i+2]-color[2])**2>=62**2)continue;
      points.push([x,y]);rows[y]++;xs[x].push(y);
    }
    const n=points.length;
    if(!n)return {n,maxColumnSpan:0,angle:null,bounds:null,continuous:0};
    const maxColumnSpan=Math.max(...xs.map(v=>v.length?v.at(-1)-v[0]:0));
    const mx=points.reduce((s,v)=>s+v[0],0)/n,my=points.reduce((s,v)=>s+v[1],0)/n;
    let xx=0,yy=0,xy=0,run=0,continuous=0;
    for(const [x,y] of points){xx+=(x-mx)**2;yy+=(y-my)**2;xy+=(x-mx)*(y-my);}
    for(const k of rows){run=k?run+1:0;continuous=Math.max(run,continuous);}
    const angle=Math.atan2(2*xy,xx-yy)*90/Math.PI;
    return {n,maxColumnSpan,angle,continuous,bounds:[Math.min(...points.map(v=>v[0])),Math.min(...points.map(v=>v[1])),
      Math.max(...points.map(v=>v[0])),Math.max(...points.map(v=>v[1]))]};
  });
},{png:'data:image/png;base64,'+png.toString('base64'),width,height});

let browser;
try{
  browser=await launchBrowser({executablePath:process.env.CHROMIUM_EXECUTABLE});
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
  await installEmptyMapProviders(context,origin+'/',{firstParty:'network'});
  const page=await context.newPage(),errors=[],observed=[];
  page.on('pageerror',error=>errors.push(error.message));
  await mkdir('browser-review',{recursive:true});
  for(const bearing of [0,32]){
    const font=page.waitForResponse(response=>response.url().endsWith('/mongolian-400-018.woff2'));
    await page.goto(origin+'/?mode=infrastructure&relief=0&names=1&stations=1&transport=0&destinations=0&constraints=0#'+zoom+'/'+center[1]+'/'+center[0]+'/'+bearing+'/0');
    await page.locator('canvas.maplibregl-canvas').waitFor({timeout:15000});
    assert.ok((await font).ok(),'packaged shaped font should load');
    if(await page.locator('#controls').isVisible())await page.locator('#collapse').click();
    let ink;
    for(let attempt=0;attempt<18;attempt++){
      ink=await readInk(page,await page.screenshot());
      if(ink.slice(0,3).every(x=>x.n>180))break;
      await page.waitForTimeout(120);
    }
    await page.screenshot({path:`browser-review/webgl-mongolian-lines-${bearing}.png`});
    console.log('WEBGL_MONGOLIAN_LINES',JSON.stringify({bearing,ink}));
    const [script,mixed,ordinary,competing]=ink;
    assert.equal(competing.n,0,'the competing route cannot overprint the same anchor');
    assert.ok(script.maxColumnSpan>=90&&script.continuous>=42,JSON.stringify(script));
    assert.ok(Math.abs(script.angle)>85,JSON.stringify(script));
    assert.ok(mixed.maxColumnSpan>=90,JSON.stringify(mixed));
    assert.ok(ordinary.n>=180&&Math.abs(ordinary.angle)<65,JSON.stringify(ordinary));
    observed.push(ordinary.angle);
  }
  assert.ok(Math.abs(observed[1]-observed[0])>18,'ordinary labels still follow the rotated path');
  assert.deepEqual(errors,[]);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
