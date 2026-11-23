import assert from 'node:assert/strict';
import test from 'node:test';
import {createSharedTileProtocols} from '../styles/shared-tile-protocols.mjs';

test('use the exact registered handler with original URL, request metadata and cancellation', async () => {
  const forwarded = new Map();
  const shared = createSharedTileProtocols({forward: (id, callback) => forwarded.set(id, callback)});
  const req = {url:'atlasrail://12/23/45?lang=ja', type:'arrayBuffer', headers:{Accept:'application/x-protobuf'}};
  const signal = new AbortController();
  const result = {data:new Uint8Array([3, 4]).buffer, cacheControl:'max-age=30'};
  const cb = (params, controller) => {
    assert.equal(params, req);assert.equal(controller, signal);return Promise.resolve(result);
  };
  shared.addProtocol('atlasrail', cb);
  assert.equal(forwarded.get('atlasrail'), cb);
  assert.equal(await shared.read(req, signal), result);
  signal.abort();
  await assert.rejects(shared.read(req, signal), {name:'AbortError'});
});

test('do not bypass failed, unknown or unintended protocol registrations', async () => {
  const shared = createSharedTileProtocols({forward(scheme) {
    if (scheme === 'unavailable') throw new Error('Forwarding failed');
  }});
  const controller = new AbortController();
  const req = scheme => ({url:scheme+'://example.test/abc'});
  assert.throws(() => shared.addProtocol('https', () => {}), TypeError);
  assert.throws(() => shared.addProtocol('MixedCase', () => {}), TypeError);
  assert.throws(() => shared.addProtocol('unavailable', () => {}), /Forwarding failed/);
  for (const scheme of ['unavailable', 'https', 'file']) {
    await assert.rejects(shared.read(req(scheme), controller), /not registered/);
  }
  shared.addProtocol('atlas-depth', () => 1);
  shared.addProtocol('atlas-depth', () => 2);
  assert.equal(await shared.read(req('atlas-depth'), controller), 2);
});
