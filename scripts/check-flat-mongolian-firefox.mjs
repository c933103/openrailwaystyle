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
import {flatCamera} from '../styles/flat-camera.mjs';

const word='ᠤᠯᠠᠭᠠᠨᠪᠠᠭᠠᠲᠤᠷ', next='ᠬᠣᠲᠠᠶᠢᠨ', station='Улаанбаатар';
const route='Төмөр зам';
const center=[106.908,47.908], width=960,height=640,zoom=10;
const camera=flatCamera({center,width,height,zoom});
const point=(id,name,x,y,role)=>({type:'Feature',id,properties:{id:'node-'+id,name,role,feature:'station'},
  geometry:{type:'Point',coordinates:camera.unproject([x,y])}});
const line=(id,name,vertices,role)=>({type:'Feature',id,properties:{name,role},geometry:{type:'LineString',
  coordinates:vertices.map(p=>camera.unproject(p))}});
const index=geojsonvt({type:'FeatureCollection',features:[
  point(566997277,station+' '+word,250,220,'main'),
  point(2,'Дамжин '+word+' '+next,620,220,'wrap'),
  point(3,'Ordinary Latin',240,440,'control'),
  point(4,'Occluded',380,292,'collision'),
  point(5,'Open space',220,320,'collision'),
  line(6,route+' '+word,[[550,562],[924,472]],'line-mixed'),
  line(7,'Ordinary route',[[50,603],[430,520]],'line-control'),
]},{extent:4096,indexMaxZoom:10});
const fonts=process.env.ATLAS_MONGOLIAN_TEST_FONT ?? 'tests/fixtures/mongolian-font/mongolian-400-018.woff2';
const woff=await readFile(fonts);
const baseStyle=JSON.parse(await readFile('styles/world.style.json','utf8'));
const html=(await readFile('styles/index.html','utf8')).replace(/<html\b/,'<html data-flat-entry="staged"');
const preview=createPreviewServer({root:'styles'});
const layer=(id,role,x=10)=>({type:'symbol',id,source:'stationScriptFixture','source-layer':'fixture_labels',
  layout:{'text-field':['get','name'],'text-size':20,'text-anchor':'top-left','text-max-width':x,'text-padding':0},
  filter:['==',['get','role'],role],paint:{'text-color':'#27ff7a'}});
const lineLayer=(id,role)=>{
  const l=layer(id,role);
  l.layout['symbol-placement']='line';l.layout['text-anchor']='center';l.layout['text-max-width']=10;
  return l;
};
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/')return res.writeHead(200,{'content-type':'text/html'}).end(html);
  if(path==='/world.style.json'){
    const style={...baseStyle,sources:{...baseStyle.sources,stationScriptFixture:{type:'vector',tiles:[origin+'/fixture_labels/{z}/{x}/{y}'],minzoom:10,maxzoom:10}},
      layers:[...baseStyle.layers,layer('station-mixed-fixture','main'),layer('station-wrap-fixture','wrap',6),
        layer('station-ordinary-fixture','control'),layer('basemap-collision-fixture','collision'),
        lineLayer('route-mixed-fixture','line-mixed'),lineLayer('route-ordinary-fixture','line-control')]};
    return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(style));
  }
  if(path.startsWith('/fixture_labels/')){
    const tile=ormVectorFixture(path,{fixture_labels:index});
    return res.writeHead(200,{'content-type':tile.contentType}).end(tile.body);
  }
  if(path==='/fonts/world-v1/index.json')
    return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({families:{mongolian:{400:[24]}}}));
  if(path==='/fonts/world-v1/mongolian-400-018.woff2')return res.writeHead(200,{'content-type':'font/woff2'}).end(woff);
  preview.emit('request',req,res);
});
await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(tmpdir(),'atlas-flat-mongolian-'));
let browser;
try{
  browser=await firefox.launchPersistentContext(profile,{headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,
    viewport:{width,height},serviceWorkers:'block',firefoxUserPrefs:{'webgl.disabled':true}});
  await installEmptyMapProviders(browser,origin+'/',{firstParty:'network'});
  const page=await browser.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.labels=[];window.webgl=[];
    localStorage.setItem('atlas_disable_webgl','1');
    const context=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...options){
      if(type.startsWith('webgl'))window.webgl.push(type);
      return context.call(this,type,...options);
    };
    const draw=CanvasRenderingContext2D.prototype.fillText;
    const clear=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){
      if(this.canvas.classList.contains('atlas-flat-preview'))window.labels=[];
      return clear.apply(this,args);
    };
    CanvasRenderingContext2D.prototype.fillText=function(text,x,y){
      if(this.canvas.classList.contains('atlas-flat-preview')&&this.fillStyle==='#27ff7a'){
        const transform=this.getTransform(),p=transform.transformPoint({x,y}),length=this.measureText(text).width;
        window.labels.push({text,x:p.x,y:p.y,vertical:transform.b>0.9&&Math.abs(transform.a)<.1,angle:Math.atan2(transform.b,transform.a),font:this.font,length});
      }
      return draw.call(this,text,x,y);
    };
  });
  await page.goto(origin+'/?mode=infrastructure&relief=0&names=1&stations=1&transport=0&destinations=0&constraints=0#'+zoom+'/'+center[1]+'/'+center[0]);
  const canvas=page.locator('canvas.atlas-flat-preview');
  await canvas.waitFor({timeout:15000});
  if(await page.locator('#controls').isVisible())await page.locator('#collapse').click();
  await page.waitForFunction(station=>window.labels.some(x=>x.text.trim()===station&&x.vertical===false),station,{timeout:9000}).catch(async e=>{console.log("state",errors,await page.locator("#map-status").textContent(),await page.evaluate(()=>window.labels));throw e;});
  await page.waitForFunction(route=>window.labels.some(x=>x.text.startsWith(route))&&
    window.labels.some(x=>x.text==='Ordinary route'),route,{timeout:9000});
  const data=await page.evaluate(({station,word,route})=>{
    const original=window.labels.find(x=>x.text.trim()===station),col=window.labels.find(x=>x.text===word&&x.x<500);
    const c=document.querySelector('canvas.atlas-flat-preview');
    if(!col)return {labels:window.labels,webgl:window.webgl};
    const image=c.getContext('2d').getImageData(0,0,c.width,c.height);
    const inkRows=sample=>{const totals=[];
    for(let y=Math.floor(sample.y);y<Math.ceil(sample.y+sample.length);y++){
      let n=0;
      for(let x=Math.floor(sample.x-9);x<=Math.ceil(sample.x+9);x++){
        const i=(y*image.width+x)*4;
        if(image.data[i]<100&&image.data[i+1]>200&&image.data[i+2]>60&&image.data[i+2]<165)n++;
      }
      totals.push(n);
    }
    return totals;};
    const lineText=window.labels.find(x=>x.text.trim()===route),lineColumn=window.labels.find(x=>x.text===word&&x.x>550&&x.y>350);
    return {labels:window.labels,webgl:window.webgl,original,col,cols:inkRows(col),lineText,lineColumn,lineInk:lineColumn?inkRows(lineColumn):null,loaded:Array.from(document.fonts).some(f=>f.family==='Atlas Mongolian'&&f.status==='loaded')};
  },{station,word,route});
  assert.deepEqual(data.webgl,[]);assert.deepEqual(errors,[]);
  assert.ok(data.loaded&&data.col?.vertical&&data.col.font.includes('Atlas Mongolian'),JSON.stringify(data));
  assert.ok(data.original.x<data.col.x&&Math.abs(data.original.y-data.col.y)<18,'Cyrillic is horizontal to the left, aligned near the top');
  assert.ok(data.cols.filter(n=>n>0).length>data.cols.length*.8,'Connected ink runs down the first column');
  let longest=0,gap=0;
  for(const width of data.cols.slice(4,-4)){gap=width?0:gap+1;longest=Math.max(longest,gap);}
  assert.ok(longest<=2,'The joining spine must not break into detached letter rows: '+JSON.stringify(data.cols));
  assert.ok(data.lineColumn?.vertical&&data.lineText&&Math.abs(data.lineText.angle)<.01&&data.lineText.x<data.lineColumn.x,
    'A diagonal railway keeps Cyrillic horizontal and Mongolian vertical: '+JSON.stringify(data.labels));
  let lineGap=0,lineWorst=0;
  for(const count of data.lineInk.slice(4,-4)){lineGap=count?0:lineGap+1;lineWorst=Math.max(lineWorst,lineGap);}
  assert.ok(data.lineInk.filter(n=>n>0).length>data.lineInk.length*.8&&lineWorst<=2,'Line caption joining spine must remain connected');
  assert.ok(data.labels.some(x=>x.text==='Ordinary route'&&x.angle<-.1&&!x.vertical),'ordinary captions still follow the diagonal');
  const wraps=data.labels.filter(x=>x.vertical&&x.x>550&&x.y<350);
  assert.ok(wraps.length>=2&&wraps.some(x=>x.text.includes(next)),JSON.stringify(data.labels));
  const byX=wraps.slice().sort((a,b)=>a.x-b.x);
  assert.ok(byX.every((p,i)=>i===0||(p.x>byX[i-1].x&&Math.abs(p.y-byX[i-1].y)<6)));
  assert.ok(data.labels.some(x=>x.text==='Ordinary Latin'&&!x.vertical));
  assert.ok(!data.labels.some(x=>x.text==='Occluded'),'The vertical label reserves collision space below the horizontal text');
  assert.ok(data.labels.some(x=>x.text==='Open space'),'Empty space below the horizontal run does not collide');
  if(process.env.ATLAS_MONGOLIAN_SCREENSHOT)await page.screenshot({path:process.env.ATLAS_MONGOLIAN_SCREENSHOT});
  await canvas.click({position:{x:data.col.x+1,y:data.col.y+data.col.length*.65}});
  await page.locator('#detail-content .atlas-mongolian').first().waitFor({timeout:3000});
  assert.match(await page.locator('#detail-content').innerText(),/Улаанбаатар/);
  assert.equal(await page.locator('#detail-content .atlas-mongolian').first().evaluate(x=>getComputedStyle(x).writingMode),'vertical-lr');
  console.log(JSON.stringify({station:word,joinedRows:data.cols.filter(n=>n>0).length,columnRows:data.cols.length,longestGap:longest,
    line:{joinedRows:data.lineInk.filter(n=>n>0).length,columnRows:data.lineInk.length,longestGap:lineWorst},columns:byX.map(({x,y,text})=>({x,y,text})),ordinary:true,collision:true,inspector:true}));
}finally{
  await browser?.close();
  await rm(profile,{recursive:true,force:true});
  await new Promise(resolve=>server.close(resolve));
}
