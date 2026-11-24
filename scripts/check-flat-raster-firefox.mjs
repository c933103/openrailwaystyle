import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {firefox} from 'playwright';
const paths = new Set(['/flat-camera.mjs','/flat-raster.mjs','/shared-tile-protocols.mjs','/flat-source-plan.mjs']);
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
  const {createSharedTileProtocols}=await import('/shared-tile-protocols.mjs');
  const {planFlatSourceTiles}=await import('/flat-source-plan.mjs');
  const camera=flatCamera({center:[180,0],zoom:0.34,bearing:37,width:256,height:256});
  const make=color=>{const c=document.createElement('canvas');c.width=c.height=8;const a=c.getContext('2d');a.fillStyle=color;a.fillRect(0,0,8,8);return c};
  const fixtures = await Promise.all(['rgb(200,0,0)', 'rgb(0,0,200)'].map(color => new Promise((resolve, reject) =>
    make(color).toBlob(blob => blob ? resolve(blob.arrayBuffer()) : reject(new Error('Fixture PNG encoding failed'))))));
  const routes = createSharedTileProtocols();
  const requests = [];
  routes.addProtocol('fixtureimagery', ({url}) => {
    requests.push(url);
    const canonicalX = Number(new URL(url).pathname.split('/')[1]);
    return {data: fixtures[canonicalX]};
  });
  const plan=planFlatSourceTiles(camera,{type:'raster',tileSize:256});
  const tiles=plan.flatMap(group=>group.copies);
  const signal = new AbortController();
  const decoded = await Promise.all(plan.map(async group => {
    const {x,y}=group.canonical;
    const url = `fixtureimagery://layer/${x}/${y}?variant=synthetic`;
    const {data} = await routes.read({url, type: 'image'}, signal);
    return {group, image: await createImageBitmap(new Blob([data], {type: 'image/png'}))};
  }));
  const count=drawFlatRasterLayer(c,camera,decoded.flatMap(({group,image})=>group.copies.map(tile=>({tile,image}))));
  for (const {image} of decoded) image.close();
  const yellow=make('rgb(200,200,0)');
  const target=tiles.find(tile=>tile.worldX===0&&tile.y===1);
  drawFlatRasterLayer(c,camera,[{tile:target,image:yellow}],{opacity:0.5});
  const sample=coordinates=>[...c.getImageData(...coordinates,1,1).data];
  const p1=camera.project([-170,-10]).map(Math.floor);
  const p2=camera.project([170,-10]).map(Math.floor);
  const sourceLevels=[{type:'raster',tileSize:256},{type:'raster'}, {type:'vector'}].map(source=>
    [9.49,9.5].map(zoom=>[...new Set(planFlatSourceTiles(
      flatCamera({center:[7.44,46.94],zoom,width:256,height:256}),source).map(group=>group.canonical.z))]));
  const repeat=planFlatSourceTiles(flatCamera({center:[179,0],zoom:-1,width:900,height:256}),{type:'raster',maxzoom:0});
  const before=requests.length;
  await Promise.all(repeat.map(group=>routes.read({url:`fixtureimagery://layer/${group.canonical.x}/${group.canonical.y}?variant=synthetic`,type:'image'},signal)));
  return [gl,count,sample(p1),sample(p2),requests.every(url => /^fixtureimagery:\/\/layer\/[01]\/[01]\?variant=synthetic$/.test(url)),sourceLevels,requests.length-before,repeat[0].copies.length];
 });
 assert.equal(values[0],false);assert.ok(values[1]>=4);
 assert.equal(values[4],true);assert.deepEqual(values[5],[[[10],[11]],[[9],[10]],[[9],[9]]]);
 assert.equal(values[6],1);assert.ok(values[7]>2);assert.deepEqual(values[2],[200,100,0,255]);assert.deepEqual(values[3],[0,0,200,255]);
 console.log('Firefox WebGL disabled: Canvas raster actual pixels passed',JSON.stringify(values));
} finally {await b?.close();server.close()}
