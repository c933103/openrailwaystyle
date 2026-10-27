import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  TERRAIN_3D_SOURCE, TERRAIN_3D_MAXZOOM, TERRAIN_TILE_SIZE,
  TERRAIN_3D_INSPECTION_ZOOM, TERRAIN_3D_VIEW_PITCH, terrain3DViewTarget,
  terrain3DEnabled, syncTerrain3D, needsSeabedRecovery,
  sampleSeabed, composeTerrainHeights, encodeTerrainPng,
} from '../styles/terrain-3d.mjs';
import {depthTile} from '../styles/bathymetry.mjs';
import {terrarium} from '../styles/dem-repair.mjs';

const SIZE = TERRAIN_TILE_SIZE;
const elevation = height => ({width:SIZE, height:SIZE, data:new Float32Array(SIZE*SIZE).fill(height)});
const maskAt = (points) => {
  const mask = new Uint8ClampedArray(SIZE*SIZE*4);
  for (const [x,y,alpha=255] of points) mask[(y*SIZE+x)*4+3]=alpha;
  return mask;
};

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

test('3D activates only on pitched views with relief enabled', () => {
  const view={sourceRegistered:false,pitch:30,terrain:null,calls:[]};
  const map={
    getSource:()=>view.sourceRegistered?{}:null,getPitch:()=>view.pitch,getTerrain:()=>view.terrain,
    setTerrain: next=>{view.terrain=next;view.calls.push(next);},
  };
  assert.equal(terrain3DEnabled(true,0),false);
  assert.equal(terrain3DEnabled(false,60),false);
  assert.equal(terrain3DEnabled(true,60),true);
  syncTerrain3D(map,true);assert.equal(view.calls.length,0,'before style load');
  view.sourceRegistered=true;syncTerrain3D(map,true);
  assert.deepEqual(view.terrain,{source:TERRAIN_3D_SOURCE,exaggeration:1});
  syncTerrain3D(map,true);assert.equal(view.calls.length,1,'must not reset terrain on each pitch frame');
  syncTerrain3D(map,false);assert.deepEqual(view.calls,[{source:TERRAIN_3D_SOURCE,exaggeration:1},null]);
  view.pitch=0;syncTerrain3D(map,true);assert.equal(view.calls.length,2);
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
