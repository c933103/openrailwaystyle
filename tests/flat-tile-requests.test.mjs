import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFlatTileRequests} from '../styles/flat-tile-requests.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const tile = (x, ...wraps) => ({key:`2/${x}/1`,canonical:{z:2,x,y:1},
  copies:(wraps.length ? wraps : [0]).map(wrap => ({z:2,x,y:1,wrap}))});
const plans = (tiles, revision = 'public-v1') => new Map([['rail', {revision, tiles}]]);

function harness(concurrency) {
  const pending = [], released = [], frames = [];
  const queue = createFlatTileRequests({concurrency,
    load: request => new Promise((resolve,reject) => pending.push({...request,resolve,reject})),
    dispose: value => released.push(value),
    changed: () => frames.push(queue.snapshot()),
  });
  return {queue,pending,released,frames};
}

test('canonical loads coalesce and completed data uses the latest visible wraps', async () => {
  const {queue,pending,released,frames} = harness(3);
  queue.update(plans([tile(0,-1,0)]));
  queue.update(plans([tile(0,0,1),tile(1)]));
  await tick();
  assert.deepEqual(pending.map(r => r.canonical.x),[0,1]);
  const vector = {};
  pending[0].resolve({vector});
  await tick();
  assert.deepEqual(frames[0].frame.get('rail').map(({tile,vector:actual}) => [tile.wrap,actual]),[[0,vector],[1,vector]]);
  queue.update(plans([tile(0,-1)]));
  assert.ok(pending[1].controller.signal.aborted);
  assert.equal(queue.snapshot().frame.get('rail')[0].tile.wrap,-1);
  pending[1].resolve({vector:{}});
  await tick();
  assert.equal(released.length,1);
  assert.equal(frames.length,1);
  queue.close();
  queue.close();
  assert.equal(released.length,2);
});

test('revision changes and revocation invalidate pending, queued and ready tiles', async () => {
  const {queue,pending,released,frames} = harness(1);
  queue.update(plans([tile(0),tile(1)],'old-authorization'));
  await tick();
  queue.update(plans([tile(0),tile(2)],'new-authorization'));
  assert.ok(pending[0].controller.signal.aborted);
  assert.equal(pending.length,1);
  const obsolete = {image:{}};
  pending[0].resolve(obsolete);
  await tick();
  assert.deepEqual(released,[obsolete]);
  assert.equal(frames.length,0);
  assert.deepEqual(pending.map(r => [r.revision,r.canonical.x]),[['old-authorization',0],['new-authorization',0]]);
  const valid = {image:{}};
  pending[1].resolve(valid);
  await tick();
  assert.equal(queue.snapshot().frame.get('rail')[0].image, valid.image);
  queue.update(new Map());
  assert.ok(pending[2].controller.signal.aborted);
  assert.deepEqual(queue.snapshot().frame,new Map());
  pending[2].reject(new Error('late failure'));
  await tick();
  assert.deepEqual(released,[obsolete,valid]);
  assert.equal(frames.length,1);
  assert.deepEqual(queue.snapshot().errors,new Map());
});

test('a visible failure is reported but not retried each frame; reentry can retry', async () => {
  const {queue,pending} = harness(2);
  queue.update(plans([tile(0)]));
  await tick();
  const error = new Error('provider unavailable');
  pending[0].reject(error);
  await tick();
  assert.deepEqual(queue.snapshot().errors.get('rail'),[{tile:tile(0).canonical,error}]);
  assert.deepEqual(queue.snapshot().frame.get('rail'),[]);
  queue.update(plans([tile(0,1)]));
  assert.equal(pending.length,1);
  queue.update(new Map());
  queue.update(plans([tile(0,1)]));
  await tick();
  assert.equal(pending.length,2);
  queue.close();
});

test('same-turn revocation prevents a load and synchronous failures stay bounded', async () => {
  const requests = [];
  const queue = createFlatTileRequests({concurrency:1, load: ({source,canonical}) => {
    requests.push([source,canonical.x]);
    throw new Error('not available');
  }});
  queue.update(plans([tile(0)]));
  queue.update(new Map());
  await tick();
  assert.deepEqual(requests,[]);
  queue.update(plans([tile(0),tile(1),tile(2)]));
  await tick();
  assert.deepEqual(requests,[['rail',0],['rail',1],['rail',2]]);
  assert.equal(queue.snapshot().errors.get('rail').length,3);
  queue.close();
});
