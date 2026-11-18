import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  TERRAIN_3D_SOURCE, TERRAIN_3D_MAXZOOM, TERRAIN_TILE_SIZE,
  TERRAIN_3D_INSPECTION_ZOOM, TERRAIN_3D_VIEW_PITCH, TERRAIN_3D_MAX_PITCH,
  HIGH_PITCH_THRESHOLD, HIGH_PITCH_LOD, HIGH_PITCH_TILE_CACHE_LIMIT, syncHighPitchTileBudget, terrain3DViewTarget,
  terrain3DEnabled, terrain3DSelectedForPitch, syncTerrain3D, terrainExaggeration, TERRAIN_EXAGGERATION_OPTIONS, DEFAULT_TERRAIN_EXAGGERATION, needsSeabedRecovery,
  sampleSeabed, composeTerrainHeights, encodeTerrainPng, installTerrain3D,
} from '../styles/terrain-3d.mjs';
import {depthTile} from '../styles/bathymetry.mjs';
import {zoomForLatitude,globeGroundZoom} from '../styles/globe-drag.mjs';
import {terrarium} from '../styles/dem-repair.mjs';

const SIZE = TERRAIN_TILE_SIZE;
const elevation = height => ({width:SIZE, height:SIZE, data:new Float32Array(SIZE*SIZE).fill(height)});
const maskAt = (points) => {
  const mask = new Uint8ClampedArray(SIZE*SIZE*4);
  for (const [x,y,alpha=255] of points) mask[(y*SIZE+x)*4+3]=alpha;
  return mask;
};

test('high-pitch views extend to 85° while distant tiles switch to lower native LOD',()=>{
  assert.equal(TERRAIN_3D_VIEW_PITCH,60,'3D first activation retains the earlier default, independent of manual max pitch');
  assert.equal(TERRAIN_3D_MAX_PITCH,85,'touch rotation is not stopped at the old 60° default');
  assert.equal(HIGH_PITCH_THRESHOLD,65,'only steep views need the extra tile budget');
  assert.deepEqual(HIGH_PITCH_LOD.general,[11,2]);
  assert.deepEqual(HIGH_PITCH_LOD.terrain,[12,1.5]);
  assert.deepEqual(HIGH_PITCH_LOD.normal,[9.314,3]);
  assert.equal(HIGH_PITCH_TILE_CACHE_LIMIT,96);
  const view={pitch:0,terrainSource:{},calls:[]};
  const map={
    getPitch:()=>view.pitch,
    getSource:name=>name==='terrain3d'?view.terrainSource:null,
    setSourceTileLodParams:(...args)=>{view.calls.push(args);return map;},
  };
  assert.equal(syncHighPitchTileBudget(map),false,'overhead retains original full-detail coverage');
  assert.deepEqual(view.calls,[],'overhead avoids unnecessary renderer changes');
  view.pitch=78;
  assert.equal(syncHighPitchTileBudget(map),true);
  assert.deepEqual(view.calls,[[11,2],[12,1.5,'terrain3d']],
    'all tile sources coarsen toward horizon, DEM has stricter distance LOD');
  view.pitch=85;
  assert.equal(syncHighPitchTileBudget(map),false,'touch tilt does not reconfigure on every pitch frame');
  assert.equal(view.calls.length,2);
  view.pitch=60;
  assert.equal(syncHighPitchTileBudget(map),true);
  assert.deepEqual(view.calls.at(-1),[9.314,3],'normal-angle view restores pinned MapLibre LOD');
  view.pitch=80;
  assert.equal(syncHighPitchTileBudget(map),true);
  assert.equal(view.calls.length,5);
  view.terrainSource={};
  assert.equal(syncHighPitchTileBudget(map),true,'replacing style also replaces source LOD and needs reconfiguration');
  assert.equal(view.calls.length,7);
  assert.throws(()=>syncHighPitchTileBudget({
    getSource:()=>({}),getPitch:()=>80,
  }),/lacks high-pitch tile LOD support/,'renderer compatibility fails visibly, never silently');
});

test('dynamically installed sources inherit the active horizon budget without extra pitch events',()=>{
  const terrain={}, stationA={}, stationB={}, rail={};
  const sources=new Map([['terrain3d',terrain],['railway',rail]]);
  const view={pitch:82,calls:[]};
  const map={
    getPitch:()=>view.pitch,
    getSource:id=>sources.get(id)||null,
    getStyle:()=>({sources:Object.fromEntries([...sources].map(([id])=>[id,{type:'vector'}]))}),
    setSourceTileLodParams:(...args)=>{view.calls.push(args);return map;},
  };
  assert.equal(syncHighPitchTileBudget(map),true,'first 82-degree frame sets global and terrain policies');
  assert.deepEqual(view.calls,[[11,2],[12,1.5,'terrain3d']]);
  sources.set('stationWorld',stationA);
  assert.equal(syncHighPitchTileBudget(map,'stationWorld'),true,'late station markers receive high-pitch budget');
  assert.deepEqual(view.calls.at(-1),[11,2,'stationWorld']);
  assert.equal(syncHighPitchTileBudget(map,'stationWorld'),false,'repeat metadata never repeats LOD');
  assert.equal(syncHighPitchTileBudget(map),false,'unchanged pitch and DEM source remain stable');
  sources.set('stationWorld',stationB);
  assert.equal(syncHighPitchTileBudget(map,'stationWorld'),true,'replaced source needs reconfiguration');
  assert.deepEqual(view.calls.at(-1),[11,2,'stationWorld']);
  sources.set('newTerrain',{});assert.equal(syncHighPitchTileBudget(map,'newTerrain'),true);
  assert.deepEqual(view.calls.at(-1),[11,2,'newTerrain']);
  assert.equal(syncHighPitchTileBudget(map,'missing'),false,'missing source never triggers reloads');
  view.pitch=40;assert.equal(syncHighPitchTileBudget(map),true);
  assert.deepEqual(view.calls.at(-1),[9.314,3],'normal-angle LOD resets all sources');
  sources.set('lateOverhead',{});assert.equal(syncHighPitchTileBudget(map,'lateOverhead'),false);
  view.pitch=82;assert.equal(syncHighPitchTileBudget(map),true);
  assert.deepEqual(view.calls.slice(-2),[[11,2],[12,1.5,'terrain3d']]);
  assert.equal(syncHighPitchTileBudget(map,'stationWorld'),false,'global reset covers existing sources');
  assert.throws(()=>syncHighPitchTileBudget(map,''),/Invalid updated map source ID/);
  assert.throws(()=>syncHighPitchTileBudget(map,42),/Invalid updated map source ID/);
});

test('3D style uses an independent Terrarium source, preserving the original hillshade and contour sources', async () => {
  const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url),'utf8'));
  assert.equal(style.sources[TERRAIN_3D_SOURCE].type,'raster-dem');
  assert.equal(style.sources[TERRAIN_3D_SOURCE].encoding,'terrarium');
  assert.equal(style.sources[TERRAIN_3D_SOURCE].tileSize,SIZE);
  assert.equal(style.sources[TERRAIN_3D_SOURCE].maxzoom,TERRAIN_3D_MAXZOOM);
  assert.deepEqual(style.sources[TERRAIN_3D_SOURCE].tiles,['atlas-terrain://{z}/{x}/{y}']);
  assert.notEqual(style.sources.relief.tiles[0],style.sources[TERRAIN_3D_SOURCE].tiles[0]);
  for(const name of ['terrain-contours','terrain-seabed-contours','terrain-seabed-contours-close'])
    assert.ok(style.layers.some(layer=>layer.id===name),name);
  assert.equal(style.terrain,undefined,'an overhead map must not request a terrain mesh');
});

test('3D icon focuses the current location to visible terrain detail, without exaggeration', () => {
  const target=TERRAIN_3D_INSPECTION_ZOOM;
  assert.equal(target,12.3,'the native DEM manager samples one zoom below camera');
  assert.deepEqual(terrain3DViewTarget({zoom:2,detail:0,active:false}),{zoom:target,pitch:TERRAIN_3D_VIEW_PITCH});
  assert.deepEqual(terrain3DViewTarget({zoom:9.9,detail:2,active:false}),{zoom:target+2,pitch:TERRAIN_3D_VIEW_PITCH});
  assert.deepEqual(terrain3DViewTarget({zoom:15,detail:0,active:false}),{pitch:TERRAIN_3D_VIEW_PITCH});
  assert.deepEqual(terrain3DViewTarget({zoom:1.5,detail:0,active:true}),{pitch:0},
    'returning overhead must retain the zoom reached while inspecting terrain');
  assert.throws(()=>terrain3DViewTarget({zoom:NaN,detail:0}),/Invalid 3D/);
  assert.throws(()=>terrain3DViewTarget({zoom:3,detail:9}),/Invalid 3D/);
});

test('3D focus at the poles uses ground scale, not the raw latitude-adjusted camera zoom',()=>{
  const physicalStart=12, physicalTarget=12.3;
  for (const latitude of [-90,-89.99999,-89.99,-89.9,-88.5,-85.2,-60,0,60,85.2,88.5,89.9,89.99,89.99999,90]) {
    const start=zoomForLatitude(physicalStart,0,latitude);
    const view=terrain3DViewTarget({zoom:start,globe:true,latitude});
    assert.equal(view.pitch,60,'enter 3D at original tilt, independent of latitude');
    assert.ok(Number.isFinite(view.zoom),'must never jump to Infinity at a pole');
    assert.ok(Math.abs(view.zoom-start-0.3)<1e-7,
      `3D at ${latitude}° should add only the requested 0.3 levels, not jump to camera zoom 12.3: ${JSON.stringify({start,view})}`);
    assert.ok(Math.abs(globeGroundZoom(view.zoom,latitude)-physicalTarget)<1e-6);
    assert.deepEqual(terrain3DViewTarget({zoom:zoomForLatitude(13,0,latitude),globe:true,latitude}),{pitch:60},
      'already sufficiently detailed polar maps keep their exact camera zoom');
    assert.deepEqual(terrain3DViewTarget({zoom:start,globe:true,latitude,active:true}),{pitch:0},
      'return overhead preserves the already focused polar camera scale');
    const detail=terrain3DViewTarget({zoom:start,globe:true,latitude,detail:2});
    assert.ok(Math.abs(globeGroundZoom(detail.zoom,latitude)-14.3)<1e-6,'More detail keeps correct ground-scale tier');
  }
  assert.deepEqual(terrain3DViewTarget({zoom:3,globe:false,latitude:89.99999}),{pitch:60,zoom:12.3},
    'flat Mercator still compares ordinary camera zoom');
  for (const latitude of [91,-91,NaN,Infinity])
    assert.throws(()=>terrain3DViewTarget({zoom:3,globe:true,latitude}),/Invalid 3D terrain view/);
});

test('3D rendering selection is independent of camera pitch and respects relief', () => {
  const view={sourceRegistered:false,pitch:30,terrain:null,calls:[]};
  const map={
    getSource:()=>view.sourceRegistered?{}:null,getPitch:()=>view.pitch,getTerrain:()=>view.terrain,
    setTerrain: next=>{view.terrain=next;view.calls.push(next);},
  };
  assert.equal(terrain3DEnabled(true,false),false);
  assert.equal(terrain3DEnabled(false,true),false);
  assert.equal(terrain3DEnabled(true,true),true);
  assert.equal(terrain3DSelectedForPitch(0),false);
  assert.equal(terrain3DSelectedForPitch(0.25),false);
  assert.equal(terrain3DSelectedForPitch(60),true);
  syncTerrain3D(map,true,1,true);assert.equal(view.calls.length,0,'before style load');
  view.sourceRegistered=true;syncTerrain3D(map,true,1,true);
  assert.deepEqual(view.terrain,{source:TERRAIN_3D_SOURCE,exaggeration:1});
  view.pitch=0;syncTerrain3D(map,true,1,true);
  assert.equal(view.calls.length,1,'overhead 3D must not remove or rebuild the mesh');
  syncTerrain3D(map,false,1,true);
  assert.deepEqual(view.calls,[{source:TERRAIN_3D_SOURCE,exaggeration:1},null]);
  syncTerrain3D(map,true,1,true);
  assert.equal(view.terrain.source,TERRAIN_3D_SOURCE,'mode restoration works at zero pitch');
  syncTerrain3D(map,true,1,false);
  assert.equal(view.terrain,null,'explicit 2D removes terrain independently of camera pitch');
  view.pitch=45;syncTerrain3D(map,true);
  assert.equal(view.terrain.source,TERRAIN_3D_SOURCE,'direct callers retain tilt activation by default');
  view.pitch=0;syncTerrain3D(map,true);
  assert.equal(view.terrain,null,'direct callers retain overhead cleanup if no explicit mode is supplied');
});

test('terrain exaggeration changes a live 3D mesh without replacing DEM samples, camera or source', () => {
  assert.deepEqual(TERRAIN_EXAGGERATION_OPTIONS,[1,2,3,5]);
  assert.equal(DEFAULT_TERRAIN_EXAGGERATION,3);
  for(const scale of TERRAIN_EXAGGERATION_OPTIONS)assert.equal(terrainExaggeration(scale),scale);
  for(const scale of [0,-1,4,6,1.5,NaN,Infinity,'3',null]) {
    assert.throws(()=>terrainExaggeration(scale),/Invalid 3D/);
  }
  const view={pitch:60,source:{},terrain:null,updates:0};
  const map={
    getSource:()=>view.source,
    getPitch:()=>view.pitch,
    getTerrain:()=>view.terrain,
    setTerrain:terrain=>{view.updates++;view.terrain=terrain;},
  };
  syncTerrain3D(map,true,3);
  assert.deepEqual(view.terrain,{source:'terrain3d',exaggeration:3});
  syncTerrain3D(map,true,3);
  assert.equal(view.updates,1,'unchanged options must not churn a terrain mesh');
  syncTerrain3D(map,true,5);
  assert.deepEqual(view.terrain,{source:'terrain3d',exaggeration:5});
  assert.equal(view.updates,2,'scale adjustment updates the mesh without removing its source');
  syncTerrain3D(map,true,1);
  assert.equal(view.terrain.exaggeration,1,'true physical 1× rendering remains available');
  view.pitch=0;syncTerrain3D(map,true,5,true);
  assert.deepEqual(view.terrain,{source:'terrain3d',exaggeration:5},
    'a directly overhead camera retains 3D rendering and its relief strength');
  assert.equal(view.updates,4);
  syncTerrain3D(map,true,5,true);
  assert.equal(view.updates,4,'unchanged overhead 3D does not rebuild its mesh');
  syncTerrain3D(map,true,5,false);
  assert.equal(view.terrain,null,'explicit 2D selection releases the mesh');
  view.pitch=55;syncTerrain3D(map,false,5,true);
  assert.equal(view.terrain,null,'surroundings setting still disables 3D');
});

test('only finer DEM tiles with flat ocean candidates need coarse bathymetry', () => {
  assert.equal(needsSeabedRecovery(elevation(0),10),false);
  assert.equal(needsSeabedRecovery(elevation(100),14),false);
  assert.equal(needsSeabedRecovery(elevation(-500),14),false);
  const mixed=elevation(320);mixed.data[20]=0;
  assert.equal(needsSeabedRecovery(mixed,14),true);
});

test('ocean floor is negative; land and below-sea inland elevations are not replaced', () => {
  const fine=elevation(140);
  fine.data[0]=0;fine.data[1]=0;fine.data[2]=-420;fine.data[3]=40;fine.data[4]=0;
  const coarse=elevation(-2900), tile=depthTile(14,3912,4421);
  const mask=maskAt([[0,0],[1,0,127],[3,0,255],[4,0,255]]);
  const values=composeTerrainHeights(fine,coarse,tile,mask);
  assert.equal(values[0],-2900,'ocean must descend rather than becoming a zero-height shelf');
  assert.equal(values[1],0,'outside the ocean mask, high-resolution zero elevation remains zero');
  assert.equal(values[2],-420,'the Dead Sea and inland depressions remain below sea level');
  assert.equal(values[3],-2900,'the ocean mask replaces even incorrect positive DEM heights');
  assert.equal(values[4],-2900);
  assert.equal(values[5],140,'land retains fine DEM resolution');
  assert.equal(coarse.data[0],-2900,'the shared DEM cache must not be mutated');
  assert.equal(fine.data[0],0,'the fine DEM cache must not be mutated');
});

test('coarse seafloor samples the correct z10 subtile, with bilinear interpolation', () => {
  const dem=elevation(-1000);
  for(let py=0;py<SIZE;py++)for(let px=0;px<SIZE;px++)dem.data[py*SIZE+px]=-(px+2*py);
  const tile=depthTile(12,45,29);
  const sx=(tile.ox+(32+0.5)/SIZE)/tile.scale*SIZE-0.5;
  const sy=(tile.oy+(48+0.5)/SIZE)/tile.scale*SIZE-0.5;
  assert.equal(tile.scale,4);
  assert.ok(Math.abs(sampleSeabed(dem,tile,32,48)-(-sx-2*sy))<1e-5);
});

test('corrupt elevations and inconsistent masks must fail closed', () => {
  const fine=elevation(300),coarse=elevation(-900);
  const place=depthTile(14,1,1);
  assert.throws(()=>composeTerrainHeights(fine,coarse,place,new Uint8ClampedArray(10)),/Ocean mask/);
  assert.throws(()=>composeTerrainHeights(fine,null,null,maskAt([[0,0]])),/Ocean mask/);
  fine.data[30]=Number.NaN;
  assert.throws(()=>composeTerrainHeights(fine),/Invalid 3D elevation height/);
  const bad=elevation(-16000);
  assert.throws(()=>composeTerrainHeights(bad),/Invalid 3D elevation height/);
  assert.throws(()=>sampleSeabed(coarse,{scale:0,ox:0,oy:0},0,0),/Invalid seabed tile position/);
});

test('Terrarium output represents signed heights without changing their units',async()=>{
  const previous=globalThis.OffscreenCanvas;
  let decoded;
  class CaptureCanvas {
    getContext(){return {
      createImageData:()=>({data:new Uint8ClampedArray(SIZE*SIZE*4)}),
      putImageData:(image)=>{decoded=image.data;},
    };}
    async convertToBlob(){return {arrayBuffer:async()=>new ArrayBuffer(1)};}
  }
  try {
    globalThis.OffscreenCanvas=CaptureCanvas;
    const v=new Float32Array(SIZE*SIZE);v[0]=-6000;v[1]=-120;v[2]=0;v[3]=1560;
    await encodeTerrainPng(v);
    for(let i=0;i<4;i++)assert.ok(Math.abs(terrarium(...decoded.slice(i*4,i*4+3))-v[i])<1/256+0.005);
    assert.deepEqual(Array.from(decoded.slice(0,4)),[104,144,0,255],'negative depths stay signed');
  } finally {if(previous===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previous;}
});

const nativeGrid = (size, height) => ({width:size,height:size,
  data:Float32Array.from({length:size*size},(_,i)=>height((i%size+.5)/size,(Math.floor(i/size)+.5)/size))});

test('native 256 and 512 pixel-centred ramps compose onto the same physical mesh',()=>{
  const ramp=(u,v)=>-435+128*u+64*v;
  const expected=composeTerrainHeights(nativeGrid(256,ramp));
  const fine=nativeGrid(512,ramp),before=fine.data.slice();
  assert.deepEqual(composeTerrainHeights(fine),expected);
  assert.deepEqual(fine.data,before,'native cache remains untouched');
  for(const size of [256,512]){
    const coarse=nativeGrid(size,(u,v)=>-2000+512*u+256*v);
    for(const tile of [{scale:1,ox:0,oy:0},{scale:16,ox:15,oy:2}]){
      const x=80,y=96,u=(tile.ox+(x+.5)/256)/tile.scale,v=(tile.oy+(y+.5)/256)/tile.scale;
      assert.equal(sampleSeabed(coarse,tile,x,y),-2000+512*u+256*v);
    }
  }
  // Adjacent XYZ tiles use pixel centres, not duplicated endpoint samples.
  const west=composeTerrainHeights(nativeGrid(512,(u)=>100+256*u));
  const east=composeTerrainHeights(nativeGrid(512,(u)=>356+256*u));
  assert.equal(east[0]-west[255],1);
});

test('mixed native fusion preserves negative land, sea-level land and backed cliff steps',()=>{
  const fine=nativeGrid(512,(u)=>u<.25?-435:u<.5?0:800);
  const coarse=nativeGrid(256,()=>-2400),mask=maskAt([[0,0],[255,0]]);
  const values=composeTerrainHeights(fine,coarse,{scale:1,ox:0,oy:0},mask);
  assert.equal(values[0],-2400);assert.equal(values[1],-435);
  assert.equal(values[64],0);assert.equal(values[127],0);
  assert.equal(values[128],800);assert.equal(values[254],800);assert.equal(values[255],-2400);
  assert.equal(needsSeabedRecovery(fine,14),true);
  assert.equal(needsSeabedRecovery(nativeGrid(512,()=>-435),14),false);
});

test('native resampling rejects unknown contributors rather than hiding them in an average',()=>{
  for(const invalid of [NaN,Infinity,-16000,12000]){
    const fine=nativeGrid(512,()=>0);fine.data[0]=invalid;
    assert.throws(()=>composeTerrainHeights(fine),/Invalid 3D elevation height/);
    assert.throws(()=>composeTerrainHeights(nativeGrid(256,()=>100),fine,
      {scale:1,ox:0,oy:0},maskAt([[0,0]])),/Invalid 3D elevation height/);
  }
  for(const size of [128,257,1024])assert.throws(()=>composeTerrainHeights(nativeGrid(size,()=>0)),/dimensions/);
  assert.throws(()=>composeTerrainHeights({width:512,height:256,data:new Float32Array(512*256)}),/dimensions/);
});

test('3D recovery can retain a distinct seabed reader without routing land to it',async()=>{
  const oldWorker=globalThis.Worker,oldCanvas=globalThis.OffscreenCanvas;
  const calls=[],messages=[];let protocol;
  const ocean={layers:{water:{length:1,extent:4096,feature:()=>({type:3,properties:{class:'ocean'},
    loadGeometry:()=>[[{x:0,y:0},{x:4096,y:0},{x:4096,y:4096}]]})}}};
  const worker={postMessage(message){messages.push(message);queueMicrotask(()=>this.onmessage({data:{id:message.id,data:new ArrayBuffer(1)}}));}};
  try{
    globalThis.Worker=class {};globalThis.OffscreenCanvas=class {};
    const land={getDemTile:async(z,x,y)=>{calls.push(['land',z,x,y]);return nativeGrid(512,()=>0);}};
    const seabedDem={getDemTile:async(z,x,y)=>{calls.push(['sea',z,x,y]);return nativeGrid(256,()=>-1000);}};
    installTerrain3D({addProtocol:(_,handler)=>{protocol=handler;}},land,
      {seabedDem,waterTile:async()=>({data:new ArrayBuffer(1)}),readTile:()=>ocean,createWorker:()=>worker});
    await protocol({url:'atlas-terrain://12/45/29'},new AbortController());
    assert.deepEqual(calls,[['land',12,45,29],['sea',10,11,7]]);
    assert.equal(messages[0].fine.width,512);assert.equal(messages[0].coarse.width,256);
    assert.equal(composeTerrainHeights(messages[0].fine,messages[0].coarse,messages[0].tile,maskAt([[0,0]]))[0],-1000);
  }finally{
    if(oldWorker===undefined)delete globalThis.Worker;else globalThis.Worker=oldWorker;
    if(oldCanvas===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=oldCanvas;
  }
});

test('worker and page encode the same native land grid and both reject invalid samples',async()=>{
  const oldSelf=globalThis.self,oldCanvas=globalThis.OffscreenCanvas;
  const replies=[];
  class PixelCanvas{
    constructor(width,height){assert.equal(width,256);assert.equal(height,256);}
    getContext(){return {createImageData:()=>({data:new Uint8ClampedArray(256*256*4)}),
      putImageData:image=>{this.pixels=image.data;}};}
    async convertToBlob(){return {arrayBuffer:async()=>this.pixels.buffer.slice(0)};}
  }
  try{
    globalThis.OffscreenCanvas=PixelCanvas;
    globalThis.self={postMessage:reply=>replies.push(reply)};
    await import('../styles/terrain-3d-worker.mjs');
    const fine=nativeGrid(512,(u,v)=>-435+512*u+256*v);
    const expected=await encodeTerrainPng(composeTerrainHeights(fine));
    await self.onmessage({data:{id:1,fine}});
    assert.equal(replies[0].id,1);assert.deepEqual(new Uint8Array(replies[0].data),new Uint8Array(expected));
    fine.data[0]=NaN;
    await self.onmessage({data:{id:2,fine}});
    assert.match(replies[1].error,/Invalid 3D elevation height/);assert.equal(replies[1].data,undefined);
  }finally{
    if(oldSelf===undefined)delete globalThis.self;else globalThis.self=oldSelf;
    if(oldCanvas===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=oldCanvas;
  }
});
