import assert from 'node:assert/strict';
import test from 'node:test';
import {flatCamera} from '../styles/flat-camera.mjs';

const close = (actual, expected, delta = 1e-8) => {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < delta,
    `Expected ${actual[i]} to be within ${delta} of ${expected[i]}`);
};
const base = {center: [114.17, 22.3], zoom: 9.75, width: 801, height: 503};
test('flat camera centers and inverts rotated fractional views in CSS pixels', () => {
  const camera = flatCamera({...base, bearing: 41});
  close(camera.project(base.center), [400.5, 251.5]);
  const point = [281.1, 357.6];
  close(camera.project(camera.unproject(point)), point);
  const northUp = flatCamera({center: [0, 0], zoom: 0, width: 512, height: 512});
  close(northUp.project([90, 0]), [384, 256]);
  close(northUp.project([0, 85.0511287798066]), [256, 0]);
});
test('pan uses screen directions and zoom retains the selected geographic anchor', () => {
  const camera = flatCamera({...base, bearing: -63});
  const anchor = [180, 400], lngLat = camera.unproject(anchor);
  for (const z of [7.4, 10, 18]) close(camera.zoomAt(z, anchor).project(lngLat), anchor, 1e-6);
  close(camera.panBy([83, -24]).center, camera.unproject([483.5, 227.5]));
});
test('dateline geometry and visible tiles wrap x without wrapping y or duplicating source IDs for a world copy', () => {
  const camera = flatCamera({center: [179.5, 0], zoom: 2, width: 640, height: 480});
  assert.ok(Math.abs(camera.project([-179.5, 0])[0] - 320) < 6);
  const tiles = camera.visibleTiles(2);
  assert.ok(tiles.some(t => t.worldX === 3 && t.x === 3));
  assert.ok(tiles.some(t => t.worldX === 4 && t.x === 0));
  assert.equal(new Set(tiles.map(t => `${t.worldX}/${t.y}`)).size, tiles.length);
  assert.ok(tiles.every(t => t.y >= 0 && t.y < 4));
  const wrapped = flatCamera({...base, center: [1e30, 0]});
  assert.ok(wrapped.visibleTiles(9).length > 0);
  assert.ok(wrapped.center[0] >= -180 && wrapped.center[0] < 180);
  const pole = flatCamera({center: [0, 90], zoom: 2, width: 512, height: 512});
  assert.deepEqual([...new Set(pole.visibleTiles(2).map(t => t.y))], [0]);
});
test('fractional rotation, overzoom and invalid inputs cannot start an unbounded tile traversal', () => {
  const camera = flatCamera({...base, bearing: 45});
  assert.ok(camera.visibleTiles(8).length > 0);
  assert.throws(() => camera.visibleTiles(17), /budget/);
  assert.throws(() => camera.visibleTiles(-1), RangeError);
  assert.throws(() => flatCamera({...base, center: [NaN, 1]}), RangeError);
  assert.throws(() => flatCamera({...base, width: 0}), RangeError);
});

test('Canvas fits antimeridian bounds at the current bearing without zooming to the whole world',async()=>{
  const {fitFlatBounds}=await import('../styles/flat-camera.mjs');
  const camera=flatCamera({center:[0,0],zoom:1,width:630,height:460,bearing:30});
  const fitted=fitFlatBounds(camera,[[175,14],[-174,22]]);
  assert.ok(Math.abs(fitted.center[0])>175);
  assert.ok(fitted.zoom>3 && fitted.bearing===30);
  const corners=[[175,14],[-174,22],[-174,14],[175,22]].map(c=>fitted.project(c));
  for(const [x,y] of corners) assert.ok(x>=39.99999 && x<=590.00001 && y>=39.99999 && y<=420.00001);
  assert.equal(fitFlatBounds(camera,[[10,20],[11,19]]),null);
});
