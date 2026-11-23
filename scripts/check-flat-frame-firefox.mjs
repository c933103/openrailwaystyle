import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {firefox} from 'playwright';
import {flatVectorFixture} from '../tests/fixtures/flat-vector.mjs';

const {outputFiles: [{text: script}]} = await build({
  stdin: {contents: `export {flatCamera} from './flat-camera.mjs';
    export {flatVectorTile} from './flat-vector.mjs';
    export {compileFlatFrame} from './flat-frame.mjs';`,
    resolveDir: new URL('../styles/', import.meta.url).pathname, sourcefile: 'flat-frame-fixture.mjs'},
  bundle:true, format:'esm', write:false,
});
const mvt = flatVectorFixture();
const server = createServer((req,res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type','text/html');res.end('<canvas width="256" height="256"></canvas>');
  } else if (req.url === '/map.mjs') {
    res.setHeader('Content-Type','text/javascript');res.end(script);
  } else if (req.url === '/fixture.pbf') {
    res.setHeader('Content-Type','application/x-protobuf');res.end(Buffer.from(mvt));
  } else {res.writeHead(404);res.end();}
});
await new Promise((resolve,reject) => server.once('error',reject).listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await firefox.launch({headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,firefoxUserPrefs:{'webgl.disabled':true}});
  const page=await browser.newPage({viewport:null});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const found = await page.evaluate(async () => {
    const probe=document.createElement('canvas');
    const gl=Boolean(probe.getContext('webgl2')||probe.getContext('webgl'));
    const {flatCamera,flatVectorTile,compileFlatFrame}=await import('/map.mjs');
    const context=document.querySelector('canvas').getContext('2d');
    const camera=flatCamera({center:[-90,66.51326044311186],zoom:0,width:256,height:256});
    const tile={z:1,x:0,y:0};
    const response=await fetch('/fixture.pbf');
    if(!response.ok) throw new Error('Fixture tile unavailable');
    const decoded=flatVectorTile(await response.arrayBuffer());
    const counts={};
    const vector={layer(name){counts[name]=(counts[name]??0)+1;return decoded.layer(name);}};
    const image=document.createElement('canvas');
    image.width=2;image.height=2;
    const imageContext=image.getContext('2d');
    imageContext.fillStyle='#ffff00';imageContext.fillRect(0,0,2,2);
    const sources=new Map([['raster',[{tile,image}]],['vector',[{tile,vector}]]]);
    const draw=compileFlatFrame([
      {id:'background',type:'background',paint:{'background-color':'#001000'}},
      {id:'area',type:'fill',source:'vector','source-layer':'area',paint:{'fill-color':'#0055aa'}},
      {id:'imagery',type:'raster',source:'raster',paint:{'raster-opacity':0.5}},
      {id:'rail',type:'line',source:'vector','source-layer':'rail',paint:{'line-color':'#c80000','line-width':5}},
      {id:'disabledRail',type:'line',source:'vector','source-layer':'rail',filter:['==',['get','railway'],'tram']},
      {id:'labels',type:'symbol',source:'vector','source-layer':'station'},
    ]);
    const frame=draw(context,camera,sources);
    const pixel=(x,y)=>[...context.getImageData(x,y,1,1).data];
    const first={rail:pixel(128,56),area:pixel(64,120),hole:pixel(150,150)};
    draw(context,camera,new Map());
    return {gl,first,empty:pixel(128,56),unsupported:frame.unsupported,counts,draws:[...frame.layerDraws]};
  });
  assert.equal(found.gl,false);
  assert.deepEqual(found.first.rail,[200,0,0,255]);
  assert.deepEqual(found.first.area,[128,170,85,255]);
  assert.deepEqual(found.first.hole,[128,136,0,255]);
  assert.deepEqual(found.empty,[0,16,0,255]);
  assert.deepEqual(found.unsupported,['labels']);
  assert.deepEqual(found.counts,{area:1,rail:1});
  assert.deepEqual(found.draws,[['background',1],['area',1],['imagery',1],['rail',1],['disabledRail',0]]);
  console.log('Firefox WebGL disabled: one frame paints map layers in style order and clears stale pixels');
} finally {await browser?.close();server.close();}
