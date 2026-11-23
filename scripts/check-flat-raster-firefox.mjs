import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {firefox} from 'playwright';
const paths = new Set(['/flat-camera.mjs','/flat-raster.mjs']);
const server = createServer(async (req,res) => {
  if (req.url === '/') { res.setHeader('Content-Type','text/html'); res.end('<canvas width="256" height="256"></canvas>'); return; }
  if (!paths.has(req.url)) {res.statusCode=404;res.end();return}
  res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../styles'+req.url,import.meta.url)));
}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
let b;
try {
 b=await firefox.launch({headless:true, executablePath:process.env.FIREFOX_EXECUTABLE, firefoxUserPrefs:{'webgl.disabled':true}});
 const page=await b.newPage({viewport:null});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const values=await page.evaluate(async()=>{
  const c=document.querySelector('canvas').getContext('2d');
  const gl=Boolean(document.createElement('canvas').getContext('webgl2')||document.createElement('canvas').getContext('webgl'));
  const {flatCamera}=await import('/flat-camera.mjs');
  const {drawFlatRasterLayer}=await import('/flat-raster.mjs');
  const camera=flatCamera({center:[180,0],zoom:0.34,bearing:37,width:256,height:256});
  const make=color=>{const c=document.createElement('canvas');c.width=c.height=8;const a=c.getContext('2d');a.fillStyle=color;a.fillRect(0,0,8,8);return c};
  const bg=make('rgb(200,0,0)'),fg=make('rgb(0,0,200)'),yellow=make('rgb(200,200,0)');
  const tiles=camera.visibleTiles(1);
  const count=drawFlatRasterLayer(c,camera,tiles.map(tile=>({tile,image:tile.worldX<0?fg:bg})));
  const target=tiles.find(tile=>tile.worldX===0&&tile.y===1);
  drawFlatRasterLayer(c,camera,[{tile:target,image:yellow}],{opacity:0.5});
  const sample=coordinates=>[...c.getImageData(...coordinates,1,1).data];
  const p1=camera.project([-170,-10]).map(Math.floor);
  const p2=camera.project([170,-10]).map(Math.floor);
  return [gl,count,sample(p1),sample(p2)];
 });
 assert.equal(values[0],false);assert.ok(values[1]>=4);
 assert.deepEqual(values[2],[200,100,0,255]);assert.deepEqual(values[3],[0,0,200,255]);
 console.log('Firefox WebGL disabled: Canvas raster actual pixels passed',JSON.stringify(values));
} finally {await b?.close();server.close()}
