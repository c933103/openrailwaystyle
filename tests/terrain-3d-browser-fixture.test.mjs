import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import vtpbf from 'vt-pbf';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {readTile} from '../styles/tile-labels.mjs';
import {oceanPolygons} from '../styles/bathymetry.mjs';
import {TERRAIN_3D_BROWSER_FIXTURE as fixture,captureTerrain3DFailure,terrain3DWaterFixture} from '../scripts/terrain-3d-browser-fixture.mjs';

test('terrain water MVT round-trips the complete closed ocean rectangle in page and worker decoders',()=>{
  const bytes=terrain3DWaterFixture();
  const expected=[{extent:4096,rings:[[
    {x:0,y:0},{x:2048,y:0},{x:2048,y:4096},{x:0,y:4096},{x:0,y:0}
  ]]}];
  for(const decode of [readTile,data=>new VectorTile(new Pbf(new Uint8Array(data)))]) {
    assert.deepEqual(JSON.parse(JSON.stringify(oceanPolygons(decode(bytes)))),expected);
  }
  // The former object-coordinate fixture silently encoded a zero-area ring;
  // its page-only stub hid that corruption from the real worker path.
  const broken=vtpbf.fromGeojsonVt({water:{extent:4096,features:[{
    type:3,tags:{class:'ocean'},geometry:[[...expected[0].rings[0].slice(0,-1)]]
  }]}});
  assert.deepEqual(oceanPolygons(readTile(broken))[0].rings[0].map(p=>[p.x,p.y]),
    [[0,0],[0,0],[0,0],[0,0]]);
});

test('pinned MapLibre terrain queries the fixture fine DEM, with the original camera as a negative control',async()=>{
  // Execute the installed renderer's actual cover/DEM-selection/interpolation
  // code. Only texture handles and cached synthetic DEM values are stubs:
  // no browser, GPU, network or replacement tile-selection formula is used.
  const compiled=await build({stdin:{contents:`
    export {Terrain} from './node_modules/maplibre-gl/src/render/terrain.ts';
    export {MercatorTransform} from './node_modules/maplibre-gl/src/geo/projection/mercator_transform.ts';
    export {LngLat} from './node_modules/maplibre-gl/src/geo/lng_lat.ts';
    export {OverscaledTileID} from './node_modules/maplibre-gl/src/tile/tile_id.ts';
  `,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},
    bundle:true,write:false,format:'iife',globalName:'fixtureRenderer',platform:'browser',
    tsconfigRaw:{compilerOptions:{useDefineForClassFields:false}},loader:{'.glsl':'text'}});
  const dom=new JSDOM('',{runScripts:'outside-only'});
  try {
    dom.window.eval(compiled.outputFiles[0].text);
    const {Terrain,MercatorTransform,LngLat,OverscaledTileID}=dom.window.fixtureRenderer;
    const {tileSize,demZoom,tileX,tileY,cameraZoom,pitch,width,height}=fixture,n=2**demZoom;
    const lng=f=>(tileX+f)/n*360-180;
    const lat=Math.atan(Math.sinh(Math.PI*(1-2*(tileY+0.5)/n)))*180/Math.PI;
    const sample=zoom=>{
      const tiles=new Map(),selected=[];
      for(let z=0;z<=demZoom;z++) {
        const scale=2**(demZoom-z),tileID=new OverscaledTileID(z,0,z,Math.floor(tileX/scale),Math.floor(tileY/scale));
        tiles.set(tileID.key,{tileID,toString:()=>tileID.key,demTexture:{texture:{}},
          dem:{dim:tileSize,stride:tileSize+2,get:(x)=>z<=10||x<tileSize/2?-875:340,
            getUnpackVector:()=>[256,1,1/256,-32768]}});
      }
      const terrain=new Terrain(null,{_source:{tileSize,minzoom:0,maxzoom:demZoom},
        getTileByID:key=>{const tile=tiles.get(key);if(tile)selected.push(tile.tileID.canonical.z);return tile;},
        _outOfViewCache:{getByKey:()=>null}},{exaggeration:1});
      terrain._emptyDemTexture={texture:{}};terrain._emptyDepthTexture={texture:{}};
      terrain._emptyDemMatrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
      terrain.getMinMaxElevation=()=>({minElevation:-875,maxElevation:340});
      const transform=new MercatorTransform({minZoom:0,maxZoom:22,minPitch:0,maxPitch:80,renderWorldCopies:true});
      transform.resize(width,height);transform.setCenter(new LngLat(lng(0.5),lat));
      transform.setZoom(zoom);transform.setPitch(pitch);
      return {sea:terrain.getElevationForLngLat(new LngLat(lng(0.25),lat),transform),
        land:terrain.getElevationForLngLat(new LngLat(lng(0.75),lat),transform),selected};
    };
    assert.deepEqual(sample(11.3),{sea:-875,land:-875,selected:[10,10]},
      'the original camera cannot meet the positive-land predicate even with perfectly loaded DEMs');
    assert.deepEqual(sample(cameraZoom),{sea:-875,land:340,selected:[demZoom,demZoom]},
      'the current camera must query the fine signed land/ocean fixture');
  } finally {dom.window.close();}
});

test('failure diagnostics retain actual terrain, request and worker state in an isolated page realm',()=>{
  const state={pitch:60,source:'terrain3d',sea:-875,land:-875};
  const window={terrainState:()=>state,terrainCounts:{fine:0,coarse:4,water:0},
    requestedDems:[{z:10,x:512,y:512}],workerReplies:[{encoded:true,error:null}],
    workerErrors:['synthetic worker failure'],terrainErrors:[{sourceId:'terrain3d',message:'synthetic failure'}],
    fixtureMap:{getTerrain:()=>({source:'terrain3d'}),getPitch:()=>60,
      isStyleLoaded:()=>false,getSource:()=>({}),isSourceLoaded:()=>false}};
  const result=JSON.parse(JSON.stringify(vm.runInNewContext(`(${captureTerrain3DFailure.toString()})()`,{window})));
  assert.deepEqual(result,{state,source:'terrain3d',pitch:60,counts:window.terrainCounts,requestedDems:window.requestedDems,
    workerReplies:window.workerReplies,workerErrors:window.workerErrors,mapErrors:window.terrainErrors,styleLoaded:false,sourceLoaded:false});
});

test('failure diagnostics survive missing initialization and individual renderer query failures',()=>{
  const capture=window=>JSON.parse(JSON.stringify(vm.runInNewContext(`(${captureTerrain3DFailure.toString()})()`,{window})));
  assert.deepEqual(capture({}),{state:null,source:null,pitch:null,counts:null,requestedDems:[],workerReplies:[],workerErrors:[],mapErrors:[],styleLoaded:false,sourceLoaded:false});
  const result=capture({terrainState:()=>{throw new Error('synthetic query failure');},
    terrainCounts:{fine:1},fixtureMap:{isStyleLoaded:()=>{throw new Error('synthetic style failure');},getSource:()=>null}});
  assert.deepEqual(result.state,{error:'synthetic query failure'});
  assert.deepEqual(result.styleLoaded,{error:'synthetic style failure'});
  assert.deepEqual(result.counts,{fine:1});assert.equal(result.sourceLoaded,false);
});
