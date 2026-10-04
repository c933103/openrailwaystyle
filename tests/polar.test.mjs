import test from 'node:test';
import assert from 'node:assert/strict';
import {CAP_RADIUS, KM_PER_DEGREE, MERCATOR_LIMIT, bandFor, decodeLine, encodeLine, fromPolar, toPolar} from '../styles/polar.mjs';
import {clipToDisc, clipToRect, isolineSegments, joinSegments, levels, simplify} from '../scripts/polar-contours.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('polar coordinates round-trip and keep distance from the pole true', () => {
  for (const cap of ['north', 'south']) for (const lng of [-179, -90, -12.5, 0, 45, 135, 179]) {
    const lat = cap === 'north' ? 87.25 : -86.5, [x, y] = toPolar(cap, [lng, lat]);
    near(Math.hypot(x, y), (90 - Math.abs(lat)) * KM_PER_DEGREE);
    const [lng2, lat2] = fromPolar(cap, [x, y]);
    near(lng2, lng); near(lat2, lat);
  }
  // North: longitude 0° points down; south: up.
  assert.ok(toPolar('north', [0, 89])[1] < 0);
  assert.ok(toPolar('south', [0, -89])[1] > 0);
  near(CAP_RADIUS, (90 - MERCATOR_LIMIT) * KM_PER_DEGREE);
  assert.ok(CAP_RADIUS > 549 && CAP_RADIUS < 552);
});

test('lines survive encoding within the storage step', () => {
  const line = [[-12.345, 400.001], [-12.3, 399.5], [0, 0], [549.99, -3.21]];
  const back = decodeLine(encodeLine(line));
  assert.equal(back.length, line.length);
  line.forEach(([x, y], k) => { near(back[k][0], x, 0.0051); near(back[k][1], y, 0.0051); });
});

test('zoom bands follow the contour steps elsewhere on the map', () => {
  assert.equal(bandFor(3), 0); assert.equal(bandFor(8.99), 0);
  assert.equal(bandFor(9), 1); assert.equal(bandFor(10.9), 1); assert.equal(bandFor(11), 2);
  assert.deepEqual(levels(-120, 430, 100), [-100, 100, 200, 300, 400]);
});

test('marching squares traces a closed contour around a hill', () => {
  const cols = 21, values = new Float32Array(cols * cols);
  for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) values[j * cols + i] = 100 - Math.hypot(i - 10, j - 10) * 10;
  const lines = joinSegments(isolineSegments({values, cols, rows: cols, x0: -10, y0: -10, step: 1}, 50));
  assert.equal(lines.length, 1);
  const ring = lines[0];
  assert.deepEqual(ring[0], ring.at(-1));
  for (const [x, y] of ring) near(Math.hypot(x, y), 5, 0.1);
});

test('grid gaps (NaN) are skipped rather than contoured', () => {
  const cols = 4, values = new Float32Array(cols * cols).fill(NaN);
  assert.deepEqual(isolineSegments({values, cols, rows: cols, x0: 0, y0: 0, step: 1}, 0), []);
});

test('clipping to the cap and to tiles keeps only the inside parts', () => {
  const line = [[-20, 0], [0, 0], [20, 0]];
  const [inside] = clipToDisc([line], 10);
  near(inside[0][0], -10, 1e-9); near(inside.at(-1)[0], 10, 1e-9);
  const pieces = clipToRect([line], [-5, -5, 5, 5]);
  assert.equal(pieces.length, 1);
  for (const [x, y] of pieces[0]) assert.ok(x >= -5 - 1e-9 && x <= 5 + 1e-9 && Math.abs(y) <= 5);
  assert.deepEqual(clipToRect([line], [30, 30, 40, 40]), []);
});

test('simplification keeps ends and drops points within tolerance', () => {
  const points = [[0, 0], [1, 0.01], [2, -0.01], [3, 0], [3, 3]];
  const out = simplify(points, 0.1);
  assert.deepEqual(out[0], [0, 0]); assert.deepEqual(out.at(-1), [3, 3]);
  assert.ok(out.length === 3 && out.some(p => p[0] === 3 && p[1] === 0));
});

test('globe drag: a press becomes a drag after 3 on-screen pixels at every More detail scale', async () => {
  const {installGlobeDrag} = await import('../styles/globe-drag.mjs');
  const windowListeners = {}, saved = globalThis.addEventListener;
  globalThis.addEventListener = (type, fn) => { windowListeners[type] = fn; };
  try {
    for (const k of [1, 4]) {
      // The map is drawn at 1/k: its layout is k times its on-screen size.
      const canvas = new EventTarget();
      Object.assign(canvas, {clientWidth: 400 * k, getBoundingClientRect: () => ({left: 0, top: 0, width: 400})});
      let jumps = 0;
      const map = {getCanvasContainer: () => canvas, getContainer: () => ({clientWidth: 400 * k, clientHeight: 300 * k}),
        unproject: ([x, y]) => ({lng: x / 100, lat: -y / 100}), getCenter: () => ({lng: 0, lat: 0}), getBearing: () => 0, getZoom: () => 3,
        jumpTo: () => { jumps++; }, dragPan: {enable() {}, disable() {}}};
      const drag = installGlobeDrag(map, {active: () => true});
      const event = (type, x) => Object.assign(new Event(type), {pointerId: 1, button: 0, clientX: x, clientY: 100});
      canvas.dispatchEvent(event('pointerdown', 100));
      windowListeners.pointermove(event('pointermove', 102));
      windowListeners.pointerup(event('pointerup', 102));
      assert.equal(drag.justDragged(), false, `2 screen pixels of jitter is still a click (scale 1/${k})`);
      assert.equal(jumps, 0);
      canvas.dispatchEvent(event('pointerdown', 100));
      windowListeners.pointermove(event('pointermove', 104));
      windowListeners.pointerup(event('pointerup', 104));
      assert.equal(drag.justDragged(), true, `4 screen pixels is a drag (scale 1/${k})`);
      assert.equal(jumps, 1);
    }
  } finally { globalThis.addEventListener = saved; }
});

test('close polar coordinates and drag scale retain sub-metre precision', async () => {
  const {toVector,fromVector,globeRadiansPerPixel,zoomForLatitude,POLE_LIMIT,stepView} = await import('../styles/globe-drag.mjs');
  for(const sign of [1,-1]) {
    for(const latitude of [89.9,89.999,89.99999,POLE_LIMIT]) {
      const lat=sign*latitude;
      near(fromVector(toVector([20,lat]))[1],lat,1e-12);
      const scale=globeRadiansPerPixel(512*2**2,lat);
      assert.ok(Number.isFinite(scale)&&scale>0);
      // One step ends exactly on the pole. The next must carry on down the
      // other meridian even if coordinate conversion rounded z to ±1.
      const toPole=(90-latitude)*Math.PI/180/scale;
      const pole=stepView({center:[20,lat],bearing:0},0,sign*toPole,scale);
      near(pole.center[1],sign*90,1e-10);
      const crossed=stepView(pole,0,sign*4,scale);
      assert.ok(Math.abs(crossed.center[1])<90);
      near(Math.abs(crossed.bearing),180,0.001);
      const zoom=zoomForLatitude(2,lat,crossed.center[1]);
      near(globeRadiansPerPixel(512*2**zoom,crossed.center[1])/scale,1,1e-9);
    }
  }
  near(globeRadiansPerPixel(2048,0),2*Math.PI/2048,1e-12);
  near(globeRadiansPerPixel(2048,60,60),2*Math.PI/2048,1e-12);
});


test('ground zoom stays continuous at either pole and reflects close-up scale',async()=>{
  const {globeGroundZoom,zoomForLatitude,POLE_LIMIT}=await import('../styles/globe-drag.mjs');
  near(globeGroundZoom(12,0),12);near(globeGroundZoom(2,60),3);
  // The reported screenshot combines zoom 1.3 with a 50 m scale near the south pole.
  near(globeGroundZoom(1.3,-89.99964),18.580072439802105,1e-5);
  for(const latitude of [89.9,89.999,89.99999,POLE_LIMIT])for(const sign of [1,-1]){
    const start=sign*latitude,expected=globeGroundZoom(2,start);
    for(const target of [sign*POLE_LIMIT,-start,sign*(latitude-0.001)]){
      near(globeGroundZoom(zoomForLatitude(2,start,target),target),expected,1e-10);
    }
  }
});


test('zooming towards a nearby polar anchor retains sub-metre angular precision',async()=>{
  const {zoomTowards,startFrame,frameView}=await import('../styles/globe-drag.mjs');
  for(const sign of [1,-1]){
    const latitude=sign*89.99964,target=latitude+sign*0.0000005;
    const result=frameView(zoomTowards(startFrame([20,latitude],0),[20,target],1));
    near(result.center[1],(latitude+target)/2,1e-12);
  }
});


test('readout zoom matches the flat map below 85.05° and stays continuous beyond',async()=>{
  const {readoutZoom,zoomForLatitude,POLE_LIMIT}=await import('../styles/globe-drag.mjs');
  for(const latitude of [0,22.3,60,-85])near(readoutZoom(3.9,latitude),3.9);
  near(readoutZoom(5,85.051129),5,1e-9);near(readoutZoom(5,85.0512),5,1e-4);
  // The reported 50 m scale at zoom 1.3 near the south pole reads as a close-up.
  assert.ok(readoutZoom(1.3,-89.99964)>15);
  for(const sign of [1,-1]){
    const start=sign*89.99,expected=readoutZoom(2,start);
    for(const target of [sign*POLE_LIMIT,-start,sign*86])near(readoutZoom(zoomForLatitude(2,start,target),target),expected,1e-10);
  }
});
