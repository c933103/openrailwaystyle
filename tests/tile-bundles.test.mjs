import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {encodeBundle, decodeBundle, bundleKey, createBundleReader, BUNDLE_FORMAT} from '../styles/tile-bundles.mjs';

const bytes = (...values) => new Uint8Array(values);

test('a bundle holds its tiles, shares identical ones and rejects damaged data', () => {
  const tiles = [['10/544/380', bytes(1, 2, 3)], ['10/545/380', bytes(1, 2, 3)], ['11/1090/761', bytes(9)], ['12/2180/1522', bytes()]];
  const packed = encodeBundle(tiles);
  const unpacked = decodeBundle(packed);
  assert.deepEqual([...unpacked].map(([key, data]) => [key, [...data]]), tiles.map(([key, data]) => [key, [...data]]));
  const header = new DataView(packed.buffer).getUint32(4, true);
  assert.equal(packed.length - 8 - header, 4, 'the two identical tiles share three bytes');
  assert.throws(() => decodeBundle(bytes(1, 2, 3, 4, 0, 0, 0, 0)), /Not a tile bundle/);
  assert.throws(() => decodeBundle(packed.subarray(0, packed.length - 2)), /Truncated/);
});

test('bundle keys are the tile at the bundle zoom; coarser tiles have none', () => {
  assert.equal(bundleKey(10, 545, 381, 8), '136/95');
  assert.equal(bundleKey(12, 2183, 1527, 8), '136/95');
  assert.equal(bundleKey(8, 136, 95, 8), '136/95');
  assert.equal(bundleKey(7, 68, 47, 8), null);
});

function server(files) {
  const requests = [];
  const fetcher = async (url, init = {}) => {
    requests.push(url.replace('https://atlas.example/data/heritage/', ''));
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const body = files[url.replace('https://atlas.example/data/heritage/', '')];
    if (body === undefined) return {ok: false, status: 404};
    return {ok: true, status: 200, json: async () => body, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)};
  };
  return {fetcher, requests};
}
const root = 'https://atlas.example/data/heritage/';
const gunzip = async data => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()).buffer;

test('tiles of one bundle come from one request, shared by concurrent tiles', async () => {
  const bundle = gzipSync(encodeBundle([['10/544/380', bytes(1)], ['10/545/381', bytes(2)], ['12/2180/1522', bytes(3)]]));
  const {fetcher, requests} = server({'index.json': {format: BUNDLE_FORMAT, zoom: 8, bundles: ['136/95']}, '8/136/95.bundle.gz': bundle});
  const reader = createBundleReader({root, fetcher, decompress: gunzip});
  const [a, b] = await Promise.all([reader.tile(10, 544, 380), reader.tile(10, 545, 381)]);
  assert.deepEqual([...new Uint8Array(a)], [1]);
  assert.deepEqual([...new Uint8Array(b)], [2]);
  assert.deepEqual([...new Uint8Array(await reader.tile(12, 2180, 1522))], [3]);
  assert.equal(await reader.tile(10, 546, 380), null, 'a tile the bundle lacks');
  assert.equal(await reader.tile(10, 600, 380), null, 'a bundle the index lacks is not requested');
  assert.deepEqual(requests, ['index.json', '8/136/95.bundle.gz']);
  const first = await reader.tile(10, 544, 380);
  new Uint8Array(first)[0] = 99;
  assert.deepEqual([...new Uint8Array(await reader.tile(10, 544, 380))], [1], 'each tile gets its own copy');
});

test('one cancelled tile does not cancel the bundle other tiles wait for', async () => {
  const bundle = gzipSync(encodeBundle([['10/544/380', bytes(1)], ['10/545/381', bytes(2)]]));
  const {fetcher} = server({'index.json': {zoom: 8, bundles: ['136/95']}, '8/136/95.bundle.gz': bundle});
  const reader = createBundleReader({root, fetcher, decompress: gunzip});
  const cancelled = new AbortController();
  const gone = reader.tile(10, 544, 380, cancelled.signal);
  cancelled.abort();
  const kept = reader.tile(10, 545, 381, new AbortController().signal);
  await assert.rejects(gone, {name: 'AbortError'});
  assert.deepEqual([...new Uint8Array(await kept)], [2]);
});

test('a failed index or bundle is requested again; old bundles are dropped beyond the limit', async () => {
  const files = {'index.json': undefined};
  const {fetcher, requests} = server(files);
  const reader = createBundleReader({root, fetcher, decompress: gunzip, keep: 1});
  await assert.rejects(reader.tile(10, 544, 380), /404/);
  files['index.json'] = {zoom: 8, bundles: ['136/95', '137/95']};
  await assert.rejects(reader.tile(10, 544, 380), /404/);
  files['8/136/95.bundle.gz'] = gzipSync(encodeBundle([['10/544/380', bytes(1)]]));
  files['8/137/95.bundle.gz'] = gzipSync(encodeBundle([['10/548/380', bytes(2)]]));
  assert.deepEqual([...new Uint8Array(await reader.tile(10, 544, 380))], [1]);
  await reader.tile(10, 548, 380);
  await reader.tile(10, 544, 380);
  assert.deepEqual(requests.filter(r => r.startsWith('8/136')), ['8/136/95.bundle.gz', '8/136/95.bundle.gz', '8/136/95.bundle.gz'], 'retried after failing, then fetched again after eviction');
});

test('an earlier one-file-per-tile snapshot and the empty first-run index still read', async () => {
  const {fetcher, requests} = server({'index.json': {tiles: ['10/544/380']}, '10/544/380.pbf.gz': gzipSync(bytes(7, 7))});
  const legacy = createBundleReader({root, fetcher, decompress: gunzip});
  assert.deepEqual([...new Uint8Array(await legacy.tile(10, 544, 380))], [7, 7]);
  assert.equal(await legacy.tile(10, 545, 380), null);
  assert.deepEqual(requests, ['index.json', '10/544/380.pbf.gz']);
  const empty = createBundleReader({root, fetcher: server({'index.json': {tiles: []}}).fetcher, decompress: gunzip});
  assert.equal(await empty.tile(10, 544, 380), null);
});
