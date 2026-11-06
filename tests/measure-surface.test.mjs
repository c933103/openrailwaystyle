import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurfaceElevation, oceanAt} from '../styles/elevation.mjs';
import {Measure, formatElevation, formatLocation, lengthKm} from '../styles/draw.mjs';

const ring = points => points.map(([x, y]) => ({x, y}));
const polygon = (...rings) => ({extent:256, rings:rings.map(ring)});
const square = (left, top, right, bottom) => ring([[left,top],[right,top],[right,bottom],[left,bottom],[left,top]]);
const polygonFixture = (...shapes) => ({
  layers: {water: {length:shapes.length, feature:i => ({
    type:3, extent:256, properties:{class:'ocean'}, loadGeometry:()=>shapes[i].rings,
  })}},
});
const tiles = height => {
  const size = 256, data = new Uint8ClampedArray(size * size * 4);
  const value = height + 32768, whole = Math.floor(value);
  const rgb = [whole >> 8, whole & 255, Math.round((value - whole) * 256), 255];
  for (let i = 0; i < data.length; i += 4) data.set(rgb, i);
  return {data, size};
};
const pointAt = (zoom, x, y, px, py) => {
  const count = 2 ** zoom, tx = (x + px / 256) / count, ty = (y + py / 256) / count;
  return [tx * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * ty))) * 180 / Math.PI];
};
const settle = async () => {for(let i=0;i<25;i++)await Promise.resolve();};

test('ocean polygons are unioned with island holes, and shared boundaries are unknown', () => {
  const a = polygon([[10,10],[130,10],[130,130],[10,130],[10,10]], [[40,40],[60,40],[60,60],[40,60],[40,40]]);
  const b = polygon([[90,10],[175,10],[175,130],[90,130],[90,10]]);
  assert.equal(oceanAt([a], 25, 25), true);
  assert.equal(oceanAt([a], 50, 50), false, 'island remains land');
  assert.equal(oceanAt([a,b], 105, 70), true, 'two overlapping ocean features do not cancel');
  assert.equal(oceanAt([a,b], 150, 70), true);
  assert.equal(oceanAt([a,b], 130, 70), null, 'uncertain shared shoreline is not assigned an elevation');
  assert.equal(oceanAt([a], 10.5, 70), null, 'coastline-resolution ambiguity');
  assert.equal(oceanAt([a], 200, 70), false);
  assert.equal(oceanAt([polygon([[0,0],[256,0],[256,256],[0,256],[0,0]])], 0.5, 100), true,
    'tile clip boundaries are not shorelines');
});

test('surface elevations use real land depression and coarse seabed, not fine DEM zero sea', async () => {
  const calls = [], water = [];
  const sea = polygon([[0,0],[128,0],[128,256],[0,256],[0,0]]);
  const surface = createSurfaceElevation('https://fixture/{z}/{x}/{y}.png', {
    zoom:11,
    load:async url => {const z=Number(new URL(url).pathname.split('/')[1]);calls.push(z);return tiles(z === 10 ? -900 : -40);},
    waterTile:async (z,x,y,controller) => { assert.ok(controller instanceof AbortController); water.push([z,x,y]); return {data: new Uint8Array([1]).buffer}; },
    readTile:()=>polygonFixture(sea),
  });
  const seaPoint = pointAt(11,1024,1024,50,100);
  const landPoint = pointAt(11,1024,1024,200,100);
  assert.deepEqual(await surface.heights([seaPoint,landPoint]), [-900,-40],
    'land below zero stays on fine land dataset, true ocean uses z10 bathymetry');
  const loaded = calls.length;
  assert.deepEqual(await surface.heights([seaPoint,landPoint]), [-900,-40]);
  assert.equal(calls.length,loaded,'completed tiles reused');
  assert.equal(water.length,1,'one basemap request for multiple samples in a tile');
  assert.deepEqual(await surface.heights([[0,90],[Infinity,0]]), [null,null],
    'unrepresentable polar and malformed coordinates cannot be invented');
});

test('failed/coastline tiles keep gaps and a successful coarse sea height does not need fine DEM', async () => {
  const sea = polygon([[0,0],[128,0],[128,256],[0,256],[0,0]]);
  const kwargs = {
    zoom:11,
    waterTile:async ()=>({data:new Uint8Array([1]).buffer}),
    readTile:()=>polygonFixture(sea),
  };
  const coast = pointAt(11,1024,1024,128,100);
  const ocean = pointAt(11,1024,1024,50,100);
  const land = pointAt(11,1024,1024,200,100);
  const unreadable = createSurfaceElevation('https://fixture/{z}/{x}/{y}.png', {
    ...kwargs, load:async url=>{const z=Number(new URL(url).pathname.split('/')[1]);return z===11?null:tiles(-700);},
  });
  assert.deepEqual(await unreadable.heights([ocean,land,coast]),[-700,null,null]);
  const outage = createSurfaceElevation('https://fixture/{z}/{x}/{y}.png',{
    zoom:11,load:async ()=>tiles(-20),
    waterTile:async ()=>({data:new ArrayBuffer(0)}),
    readTile:()=>{throw Error('decode should not happen');},
  });
  assert.deepEqual(await outage.heights([ocean,land]),[null,null], 'unknown ocean/land must not be guessed');
});

function measureFixture(heights) {
  const sources={}, statuses=[], changed=[];
  const map={
    getSource:id=>sources[id],
    addSource:id=>{sources[id]={setData(data){this.data=data;}};},
    getLayer:()=>undefined,addLayer(){},
    getCanvas:()=>({style:{}}),on(){},
    doubleClickZoom:{enable(){},disable(){}},
  };
  const measure=new Measure(map,{heights,status:message=>statuses.push(message),geometryChanged:()=>changed.push(1)});
  measure.install();
  return {measure,sources,statuses,changed};
}

test('tap tool displays location and signed elevation and ignores outdated responses', async () => {
  const pending = [];
  const f=measureFixture(points=>new Promise(resolve=>pending.push({points,resolve})));
  assert.equal(formatElevation(-5), '5 m below sea level');
  assert.equal(formatElevation(150,'imperial'), '492 ft above sea level');
  assert.equal(formatElevation(0), '0 m (sea level)');
  assert.equal(formatElevation(null),'unavailable');
  assert.equal(formatLocation([180,20]),'Lat 20.000000, Lon -180.000000');
  f.measure.setMode('elevation');
  f.measure.click({lng:139.7,lat:35.7}); await settle();
  f.measure.click({lng:139.8,lat:35.8}); await settle();
  assert.equal(pending.length,2);
  pending[0].resolve([900]);await settle();
  assert.match(f.statuses.at(-1), /finding height/);
  pending[1].resolve([-45]);await settle();
  assert.match(f.statuses.at(-1),/Lat 35.800000, Lon 139.800000/);
  assert.match(f.statuses.at(-1),/45 m below sea level/);
  const feature=f.sources['atlas-measure'].data.features.find(v=>v.properties.kind==='spot');
  assert.match(feature.properties.label,/45 m below sea level/);
  assert.equal(f.measure.canRetryHeights,false);
  f.measure.setMode('distance');
  assert.equal(f.measure.spot,null);
  assert.equal(f.sources['atlas-measure'].data.features.length,0);
  assert.ok(f.changed.length>=2);
});

test('tap failures can be explicitly retried, and clear aborts the old result', async () => {
  const pending = [], f=measureFixture((_,options)=>new Promise(resolve=>pending.push({resolve,signal:options.signal})));
  f.measure.setMode('elevation');
  f.measure.click({lng:0,lat:0});await settle();
  pending[0].resolve([null]);await settle();
  assert.equal(f.measure.canRetryHeights,true);
  assert.match(f.statuses.at(-1),/unavailable/);
  f.measure.retryHeights();await settle();
  assert.equal(pending.length,2);
  f.measure.clear();assert.equal(pending[1].signal.aborted,true);
  pending[1].resolve([-10]);await settle();
  assert.equal(f.measure.spot,null,'late results cannot resurrect a cleared marker');
});

test('distance profile uses measured path, curve profile uses visible fitted arc', () => {
  const f=measureFixture(null);
  f.measure.setMode('distance');
  assert.equal(f.measure.profileCoordinates(),null);
  for(const [lng,lat] of [[0,0],[0.05,0.05],[0.1,0]])f.measure.click({lng,lat});
  assert.deepEqual(f.measure.profileCoordinates(),[[0,0],[0.05,0.05],[0.1,0]]);
  f.measure.setMode('radius');
  const center=[139.7,35.7],r=0.008;
  for(const degrees of [0,45,90]){
    const rad=degrees*Math.PI/180;
    f.measure.click({lng:center[0]+r*Math.cos(rad),lat:center[1]+r*Math.sin(rad)});
  }
  const path=f.measure.profileCoordinates();
  const display=f.sources['atlas-measure'].data.features.find(v=>v.properties.kind==='arc');
  assert.ok(path.length>3,'curve profile follows arc, not chord');
  assert.deepEqual(path,display.geometry.coordinates,'chart geometry exactly follows visible arc');
  assert.ok(lengthKm(path)>lengthKm([path[0],path.at(-1)]));
});
