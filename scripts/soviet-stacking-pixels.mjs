// Isolated real-renderer stacking check. Geometry/colours are synthetic;
// layer order comes from the production adapter, not a hand-written order.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installSovietStyle} from '../styles/soviet-topo.mjs';
import {BROWSER_LIBRARIES} from './browser-libraries.mjs';
export async function checkSovietStackingPixels(context,base){
 const original=installSovietStyle(JSON.parse(await readFile('styles/world.style.json','utf8')),base+'?sovietPreview=1');
 const geometry=(type,coordinates)=>({type:'geojson',data:{type:'Feature',properties:{},geometry:{type,coordinates}}});
 const replacements={
  'soviet-topo':{...original.layers.find(l=>l.id==='soviet-topo'),layout:{visibility:'visible'},paint:{'raster-fade-duration':0,'raster-opacity':1}},
  'terrain-bathymetry':{id:'terrain-bathymetry',type:'fill',source:'ocean',paint:{'fill-color':'#0000ff'}},
  'infrastructure-overview':{id:'infrastructure-overview',type:'line',source:'rail',paint:{'line-color':'#00ff00','line-width':12}},
  'station-major-dots':{id:'station-major-dots',type:'circle',source:'station',paint:{'circle-color':'#ffff00','circle-radius':12}},
 };
 const layers=original.layers.filter(l=>replacements[l.id]).map(l=>replacements[l.id]);
 assert.equal(layers.length,4);
 const style={version:8,sources:{sovietTopo:original.sources.sovietTopo,
  ocean:geometry('Polygon',[[[-2,-2],[-.5,-2],[-.5,2],[-2,2],[-2,-2]]]),
  rail:geometry('LineString',[[-2,0],[2,0]]),station:geometry('Point',[0,0])},
  layers:[{id:'pixel-background',type:'background',paint:{'background-color':'#ffffff'}},...layers]};
 const page=await context.newPage({viewport:{width:400,height:400}});
 try{
  await page.setContent('<html><body style="margin:0"><div id="pixel-map" style="width:400px;height:400px"></div></body></html>');
  const library=BROWSER_LIBRARIES.find(l=>l.package==='maplibre-gl'&&l.target.endsWith('.js'));
  assert.ok(library,'pinned MapLibre renderer required');
  await page.addScriptTag({url:new URL(library.target,base).href});
  await page.evaluate(style=>{
   window.pixelMap=new maplibregl.Map({container:'pixel-map',center:[0,0],zoom:5,style,
    attributionControl:false,fadeDuration:0,canvasContextAttributes:{preserveDrawingBuffer:true}});
  },style);
  await page.waitForFunction(()=>pixelMap.loaded(),null,{timeout:30000});
  const sample=()=>page.evaluate(async()=>{
   await new Promise(resolve=>{pixelMap.once('render',resolve);pixelMap.triggerRepaint();});
   const canvas=pixelMap.getCanvas(),gl=canvas.getContext('webgl2');gl.finish();
   return [[1,1],[-1,1],[1,0],[0,0]].map(coordinate=>{
    const p=pixelMap.project(coordinate),pixel=new Uint8Array(4),scale=canvas.width/400;
    gl.readPixels(Math.floor(p.x*scale),canvas.height-1-Math.floor(p.y*scale),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    return [...pixel];
   });
  });
  const expected=[[255,0,0,255],[0,0,255,255],[0,255,0,255],[255,255,0,255]];
  const positive=await sample();assert.deepEqual(positive,expected,'raster, ocean, rail and station pixels must be painted in order');
  await page.evaluate(()=>pixelMap.moveLayer('soviet-topo'));
  const above=await sample();assert.notDeepEqual(above,expected,'negative control: raster above overlays must fail');
  assert.deepEqual(above,Array(4).fill([255,0,0,255]));
  await page.evaluate(()=>{pixelMap.moveLayer('soviet-topo','terrain-bathymetry');pixelMap.setLayoutProperty('soviet-topo','visibility','none');});
  const absent=await sample();assert.notDeepEqual(absent,expected,'negative control: missing raster must fail');
  assert.deepEqual(absent[0],[255,255,255,255]);
  return {scope:'actual adapter order and real renderer; synthetic geometry/colours',positive,above,absent};
 }finally{await page.close();}
}
