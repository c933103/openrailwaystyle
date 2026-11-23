import assert from 'node:assert/strict';
import test from 'node:test';
import {flatCamera} from '../styles/flat-camera.mjs';
import {drawFlatRasterLayer} from '../styles/flat-raster.mjs';

const camera = flatCamera({center: [179, 0], zoom: 2.5, bearing: 37, width: 750, height: 435});
const apply = ([a, b, c, d, x, y], u, v) => [a * u + c * v + x, b * u + d * v + y];
function close(actual, expected) {
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-8);
}

test('rotated fractional raster transforms abut and preserve a separate world copy', () => {
  const tiles = camera.visibleTiles(2);
  const left = tiles.find(t => t.worldX === 3 && t.y === 2);
  const right = tiles.find(t => t.worldX === 4 && t.y === 2);
  assert.equal(right.x, 0);
  const l = camera.tileTransform(left), r = camera.tileTransform(right);
  for (const y of [0, 0.5, 1]) close(apply(l, 1, y), apply(r, 0, y));
  close(apply(r, 0, 0), camera.project([180, 0], {nearestWorld: false}));
  assert.notDeepEqual(r, camera.tileTransform({z: 2, x: 0, y: 2}));
  assert.throws(() => camera.tileTransform({z: 2, x: 0, y: 4}), RangeError);
});

test('raster layer skips absent images, multiplies opacity and restores caller state', () => {
  const stack = [], images = [], transforms = [];
  const context = {globalAlpha: 0.75,
    save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
    transform(...args) { transforms.push(args); },
    drawImage(...args) { images.push([this.globalAlpha, ...args]); },
  };
  const [a, b, c] = camera.visibleTiles(2);
  const bg = {}, fg = {};
  assert.equal(drawFlatRasterLayer(context, camera, [{tile: a, image: bg}, {tile: b}, {tile: c, image: fg}],
    {opacity: 0.5}), 2);
  assert.deepEqual(images, [[0.375, bg, 0, 0, 1, 1], [0.375, fg, 0, 0, 1, 1]]);
  assert.deepEqual(transforms, [camera.tileTransform(a), camera.tileTransform(c)]);
  assert.equal(context.globalAlpha, 0.75);
  assert.equal(drawFlatRasterLayer(context, camera, [{tile: a, image: bg}], {opacity: 0}), 0);
  assert.throws(() => drawFlatRasterLayer(context, camera, [], {opacity: 2}), RangeError);
  context.drawImage = () => { throw new Error('Image could not be drawn'); };
  assert.throws(() => drawFlatRasterLayer(context, camera, [{tile: a, image: bg}]), /could not/);
  assert.equal(stack.length, 0);
  assert.equal(context.globalAlpha, 0.75);
});
