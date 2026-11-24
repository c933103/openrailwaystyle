import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {firefox} from 'playwright';
import {flatVectorFixture} from '../tests/fixtures/flat-vector.mjs';

const {outputFiles: [{text: script}]} = await build({
  stdin: {contents: `export {flatCamera} from './flat-camera.mjs';
    export {flatVectorTile, drawFlatVectorLayer} from './flat-vector.mjs';
    export {compileFlatGeometryStyle} from './flat-style.mjs';`,
    resolveDir: new URL('../styles/', import.meta.url).pathname, sourcefile: 'flat-vector-fixture.mjs'},
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
    const gl=Boolean(document.createElement('canvas').getContext('webgl2')||
      document.createElement('canvas').getContext('webgl'));
    const {flatCamera, flatVectorTile, drawFlatVectorLayer, compileFlatGeometryStyle}=await import('/map.mjs');
    const context=document.querySelector('canvas').getContext('2d');
    const camera=flatCamera({center:[-90,66.51326044311186],zoom:0,width:256,height:256});
    const tile={z:1,x:0,y:0};
    const response=await fetch('/fixture.pbf');
    if(!response.ok)throw new Error('Fixture tile unavailable');
    const features=flatVectorTile(await response.arrayBuffer());
    const layers=[
      {id:'area',type:'fill','source-layer':'area',paint:{'fill-color':'#0055aa'}},
      {id:'excluded',type:'line','source-layer':'rail',filter:['==',['get','railway'],'tram'],
        paint:{'line-color':'#ffffff','line-width':22}},
      {id:'rail',type:'line','source-layer':'rail',filter:['==',['get','railway'],'rail'],
        paint:{'line-color':['match',['get','name'],'Fixture Line','#c80000','#ffffff'],
          'line-width':['interpolate',['linear'],['zoom'],0,5,2,9]}},
      {id:'casing',type:'line','source-layer':'rail',paint:{'line-color':'#000080','line-width':2,'line-gap-width':10}},
      {id:'right',type:'line','source-layer':'rail',paint:{'line-color':'#cc8800','line-width':3,'line-offset':10}},
      {id:'left',type:'line','source-layer':'rail',paint:{'line-color':'#8800cc','line-width':3,'line-offset':-10}},
      {id:'station',type:'circle','source-layer':'station',paint:{'circle-color':'#008000','circle-radius':6,
        'circle-stroke-width':3,'circle-stroke-color':'#202020'}},
    ];
    context.fillStyle='#faecd0';context.fillRect(116,146,24,22);
    for(const layer of layers.map(compileFlatGeometryStyle)) {
      if(!layer.visibleAt(camera.zoom)) continue;
      for(const feature of features.layer(layer.sourceLayer)) {
        const paint=layer.resolve({zoom:camera.zoom},feature,{},tile);
        if(paint)drawFlatVectorLayer(context,camera,tile,[feature],paint);
      }
    }
    const pixel=(x,y)=>[...context.getImageData(x,y,1,1).data];
    return {gl,rail:pixel(128,56),outsideRail:pixel(128,72),right:pixel(128,66),left:pixel(128,46),
      casing1:pixel(128,50),casing2:pixel(128,62),fill:pixel(64,120),hole:pixel(150,150),station:pixel(128,156),outline:pixel(135,156),underlay:pixel(138,156)};
  });
  assert.deepEqual(found,{gl:false,rail:[200,0,0,255],outsideRail:[0,0,0,0],right:[204,136,0,255],left:[136,0,204,255],
    casing1:[0,0,128,255],casing2:[0,0,128,255],fill:[0,85,170,255],hole:[0,0,0,0],station:[0,128,0,255],outline:[32,32,32,255],underlay:[250,236,208,255]});
  console.log('Firefox WebGL disabled: MVT line, polygon hole and station actual pixels passed');
} finally {await browser?.close();server.close();}
