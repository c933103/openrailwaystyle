import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {firefox} from 'playwright';
import {zxyToTileId} from 'pmtiles';
import vtPbf from 'vt-pbf';
import {createPreviewServer} from './serve.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {pmtilesBytesResponse} from './pmtiles-browser-fixture.mjs';
import {terrariumFixturePng} from './bathymetry-browser-fixture.mjs';
import {flatCamera} from '../styles/flat-camera.mjs';

const entry=(await readFile('styles/index.html','utf8')).replace(/<html\b/,'<html data-flat-entry="staged"');
const preview=createPreviewServer({root:'styles'});
const server=createServer((req,res)=>{
  if(new URL(req.url,'http://local').pathname==='/'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(entry);
  } else preview.emit('request',req,res);
});
await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
// A covered historical sheet, unlike the coastal and ocean coverage gaps.
const z=11,n=2**z,lon=13.403,lat=52.52;
const x=Math.floor((lon+180)*n/360),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)*n/2);
function mvt(layers){return vtPbf.fromGeojsonVt(layers,{extent:4096,version:2});}
const water=mvt({water:{features:[{type:3,id:10,tags:{class:'lake'},geometry:[
  [[800,600],[3400,600],[3400,1800],[800,1800],[800,600]],
]}]}});
const rails=mvt({railway_line_high:{features:[{type:2,id:42,tags:{id:'way-42',feature:'rail',usage:'main',name:'Fixture Main Line',osm_type:'way',osm_id:42},geometry:[
  [[700,3050],[3400,3050]],
]}]}});
const varint=values=>Buffer.from(values.flatMap(n=>{
  const out=[];while(n>127){out.push(n%128+128);n=Math.floor(n/128);}out.push(n);return out;
}));
function archive(bytes){
  const tile=gzipSync(bytes),dir=varint([1,zxyToTileId(z,x,y),1,tile.length,1]);
  const metadata=Buffer.from('{"vector_layers":[{"id":"water","fields":{}}]}');
  const header=Buffer.alloc(127);header.write('PMTiles');header[7]=3;
  const metaAt=127+dir.length,tileAt=metaAt+metadata.length;
  for(const [offset,value] of [[8,127],[16,dir.length],[24,metaAt],[32,metadata.length],[40,tileAt],[56,tileAt],
    [64,tile.length],[72,1],[80,1],[88,1]])header.writeBigUInt64LE(BigInt(value),offset);
  header[96]=1;header[97]=1;header[98]=2;header[99]=1;header[100]=z;header[101]=z;
  for(const [offset,value] of [[102,-180],[106,-85],[110,180],[114,85]])header.writeInt32LE(value*1e7,offset);
  return Buffer.concat([header,dir,metadata,tile]);
}
const basemap=archive(water);
const lngLat=(dx,dy)=>{
  const n=2**z,lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+dy/4096)/n)))*180/Math.PI;
  return [(x+dx/4096)/n*360-180,lat];
};
const home=lngLat(2048,2048);
const profile=await mkdtemp(join(tmpdir(),'atlas-canvas-bases-'));
let context;
try{
  context=await firefox.launchPersistentContext(profile,{headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,
    viewport:{width:960,height:640},deviceScaleFactor:1,serviceWorkers:'block',firefoxUserPrefs:{'webgl.disabled':true}});
  await installEmptyMapProviders(context,origin+'/',{firstParty:'network'});
  const requests={archive:0,rail:0,raster:0};
  await context.route('**/planet.pmtiles',route=>{
    requests.archive++;return route.fulfill(pmtilesBytesResponse(basemap,route.request().headers().range,'flat-basemap-water-v1'));
  });
  // The application requests its normal composite ORM path.
  await context.route(url=>/^\/railway_line_high(?:,[a-z_]+)*\/\d+\/\d+\/\d+$/.test(url.pathname),route=>{
    requests.rail++;
    return route.fulfill({contentType:'application/x-protobuf',headers:{'access-control-allow-origin':'*'},
      body:new URL(route.request().url()).pathname.endsWith('/'+z+'/'+x+'/'+y)?Buffer.from(rails):Buffer.alloc(0)});
  });
  for(const [host,height] of [['tiles.maps.eox.at',123],['tile.openstreetmap.org',-20],['indianopenmaps.com',63]]){
    const body=terrariumFixturePng(()=>height);
    await context.route('https://'+host+'/**',route=>{
      requests.raster++;return route.fulfill({contentType:'image/png',body,headers:{'access-control-allow-origin':'*'}});
    });
  }
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.setItem('atlas_disable_webgl','1');
    window.glAttempts=0;
    const native=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(type.startsWith('webgl'))window.glAttempts++;
      return native.call(this,type,...args);
    };
  });
  const params='background=map&mode=infrastructure&relief=0&stations=0&names=0&trackCounts=0&transport=0&destinations=0&constraints=0';
  await page.goto(origin+'/?'+params+'#'+z+'/'+home[1]+'/'+home[0]);
  const canvas=page.locator('canvas.atlas-flat-preview');
  await canvas.waitFor();
  const {width,height}=await canvas.boundingBox();
  const camera=flatCamera({center:home,zoom:z,width,height});
  const sample=lngLat(2048,1200),track=lngLat(2048,3050);
  const coords=[sample,track].map(p=>camera.project(p).map(Math.round));
  async function verify(name,tile,hasRail,{masked=false}={}){
    try {
      await page.waitForFunction(({coords,tile,hasRail,masked})=>{
        const c=document.querySelector('canvas.atlas-flat-preview'),p=c.getContext('2d');
        const [water,rail]=coords;
        const equal=(a,rgb)=>rgb.every((v,i)=>a[i]===v);
        const painted=masked ? p.getImageData(0,0,c.width,c.height).data.some((v,i,a)=>i%4===0&&v===tile[0]&&a[i+1]===tile[1]&&a[i+2]===tile[2])
          :equal(p.getImageData(...water,1,1).data,tile);
        const hits=p.getImageData(rail[0]-2,rail[1]-2,5,5).data;
        const hitsRail=hits.some((v,i,a)=>i%4===0&&v===35&&a[i+1]===86&&a[i+2]===182);
        return painted&&hitsRail===hasRail;
      },{coords,tile,hasRail,masked},{timeout:15000});
    }catch(error){
      console.error(name,requests,await page.locator('#map-status').textContent(),await canvas.evaluate((c,ps)=>ps.map(p=>[...c.getContext('2d').getImageData(...p,1,1).data]),coords));
      throw error;
    }
    console.log(name+': real styled background pixels and '+(hasRail?'rail present':'rail absent'));
  }
  async function select(background){
    const control=page.locator('[data-background="'+background+'"]');
    if(!await control.isVisible())await page.locator('#controls-open').click();
    await control.click();
    assert.equal(await control.getAttribute('aria-pressed'),'true');
  }
  await verify('Map',[191,216,224],true);
  assert.ok(requests.archive>0&&requests.rail>0);
  await select('satellite');await verify('Satellite',[128,123,0],false);
  await select('hybrid');await verify('Hybrid',[128,123,0],true);
  const [railX,railY]=coords[1];
  const casing=await canvas.evaluate((c,[x,y])=>{
    const p=c.getContext('2d');
    return [-2,2].map(offset=>[...p.getImageData(x,y+offset,1,1).data]);
  },[railX,railY]);
  assert.ok(casing.every(([r,g,b,a])=>r>190&&g>185&&b>135&&a===255),
    'Hybrid must paint a pale contrast edge around its rail stroke: '+JSON.stringify(casing));
  console.log('Hybrid: pale contrast casing is visible around the same rail stroke');
  await select('carto');await verify('Carto',[127,236,0],true);
  await select('soviet');await verify('Public historical map',[128,63,0],true,{masked:true});
  await select('map');await verify('Map restored',[191,216,224],true);
  assert.deepEqual(await page.evaluate(()=>window.glAttempts),0);
  assert.deepEqual(errors,[]);
} finally{
  await context?.close();server.close();await rm(profile,{recursive:true,force:true});
}
