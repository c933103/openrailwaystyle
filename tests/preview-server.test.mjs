import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp, mkdir, writeFile, chmod, rm, stat, open, unlink, rename, truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPreviewServer} from '../scripts/serve.mjs';

const closeCompletions = new WeakMap();
const asset = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-preview-'));
  const root = join(directory, 'styles');
  await mkdir(join(root, 'nested'), {recursive: true});
  await writeFile(join(root, 'index.html'), '<h1>Preview</h1>');
  await writeFile(join(root, 'nested', 'index.html'), 'nested index');
  await writeFile(join(root, 'asset.pmtiles'), asset);
  await writeFile(join(root, 'empty.json'), '');
  await writeFile(join(root, 'code.mjs'), 'export const ready = true;');
  await writeFile(join(directory, 'outside.txt'), 'outside root');
  const openFile = options.openFile || open;
  const server = createPreviewServer({root, ...options, openFile: async (...args) => {
    const file = await openFile(...args), close = file.close.bind(file);
    let didClose;
    closeCompletions.set(file, new Promise(resolve => {didClose = resolve;}));
    file.close = () => close().then(result => {didClose(); return result;});
    return file;
  }});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
  });
  return {root, server, port: server.address().port};
}
function request(port, path = '/', {headers, method = 'GET', onData} = {}) {
  return new Promise(resolve => {
    const req = http.request({hostname: '127.0.0.1', port, path, headers, method, agent: false}, res => {
      const chunks = [];
      const finish = error => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), complete: res.complete, error});
      res.on('data', chunk => {chunks.push(chunk); onData?.(res, chunk);});
      res.once('end', () => finish());
      res.once('error', finish);
      res.once('close', () => {if (!res.complete) finish(new Error('response closed early'));});
    });
    req.setTimeout(5000, () => req.destroy(new Error('request timed out')));
    req.once('error', error => resolve({error}));
    req.end();
  });
}
async function healthy(port) {
  const res = await request(port);
  assert.equal(res.status, 200);
  assert.equal(res.body.toString(), '<h1>Preview</h1>');
  assert.equal(res.complete, true);
}
async function closed(handle) {
  // Descriptor close runs in the request handler's finally, after the client
  // can receive its response. Wait for that actual close, not a fixed sleep.
  await closeCompletions.get(handle);
  assert.equal(handle.fd, -1);
}

test('preview serves ordinary, index, encoded, empty and HEAD assets on loopback', async t => {
  const {port, root, server} = await fixture(t);
  assert.equal(server.address().address, '127.0.0.1');
  await healthy(port);
  assert.equal((await request(port, '/nested/')).body.toString(), 'nested index');
  await writeFile(join(root, 'space name.json'), '{"ok":true}');
  assert.equal((await request(port, '/space%20name.json?ignored=yes')).body.toString(), '{"ok":true}');
  const code = await request(port, '/code.mjs');
  assert.equal(code.headers['content-type'], 'text/javascript');
  const full = await request(port, '/asset.pmtiles');
  assert.equal(full.status, 200);
  assert.equal(full.headers['accept-ranges'], 'bytes');
  assert.equal(full.headers['content-length'], String(asset.length));
  assert.deepEqual(full.body, asset);
  const empty = await request(port, '/empty.json');
  assert.equal(empty.status, 200);
  assert.equal(empty.headers['content-length'], '0');
  assert.equal(empty.complete, true);
  const head = await request(port, '/asset.pmtiles', {method: 'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], String(asset.length));
  assert.equal(head.body.length, 0);
});

test('preview retains bounded and open-ended ranges, malformed-range fallback and 416 handling', async t => {
  const {port} = await fixture(t);
  for (const [range, start, end] of [['bytes=0-0', 0, 0], ['bytes=4-9', 4, 9], ['bytes=10-', 10, 35], ['bytes=30-999', 30, 35]]) {
    const res = await request(port, '/asset.pmtiles', {headers: {range}});
    assert.equal(res.status, 206, range);
    assert.equal(res.headers['content-range'], `bytes ${start}-${end}/${asset.length}`);
    assert.deepEqual(res.body, asset.subarray(start, end + 1));
    assert.equal(res.complete, true);
  }
  for (const range of ['not-a-range', 'bytes=-3', 'bytes=0-1,4-5']) {
    const res = await request(port, '/asset.pmtiles', {headers: {range}});
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, asset);
  }
  for (const range of ['bytes=36-', 'bytes=10-4', 'bytes=999999999999999999999-']) {
    const res = await request(port, '/asset.pmtiles', {headers: {range}});
    assert.equal(res.status, 416);
    assert.equal(res.headers['content-range'], `bytes */${asset.length}`);
  }
  assert.equal((await request(port, '/empty.json', {headers: {range: 'bytes=0-'}})).status, 416);
  await healthy(port);
});

test('missing, malformed, directory and outside-root requests leave the server healthy', async t => {
  const {port} = await fixture(t);
  for (const path of ['/missing', '/nested', '/%ZZ', '/%00']) {
    assert.equal((await request(port, path)).status, 404, path);
    await healthy(port);
  }
  for (const path of ['/%2e%2e%2foutside.txt', '/%2e%2e%2fstyles-other%2ffile']) {
    assert.equal((await request(port, path)).status, 403, path);
    await healthy(port);
  }
});

test('unreadable regular files return 404 without killing the process', {skip: process.platform === 'win32' || process.getuid?.() === 0}, async t => {
  const {root, port} = await fixture(t);
  await chmod(join(root, 'asset.pmtiles'), 0);
  assert.equal((await request(port, '/asset.pmtiles')).status, 404);
  await healthy(port);
});

test('file removal after stat is handled as an ordinary missing-file response', async t => {
  const {port} = await fixture(t, {statFile: async path => {
    const info = await stat(path);
    if (path.endsWith('asset.pmtiles')) await unlink(path);
    return info;
  }});
  assert.equal((await request(port, '/asset.pmtiles')).status, 404);
  await healthy(port);
});

test('replacement after open uses the opened descriptor for both size and bytes', async t => {
  let handle;
  const {port} = await fixture(t, {openFile: async (...args) => {
    const file = await open(...args);
    if (args[0].endsWith('asset.pmtiles')) {
      handle = file;
      await rename(args[0], args[0] + '.old');
      await writeFile(args[0], 'replacement with a different size');
    }
    return file;
  }});
  const res = await request(port, '/asset.pmtiles');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-length'], String(asset.length));
  assert.deepEqual(res.body, asset);
  await closed(handle);
  await healthy(port);
});

test('directory replacement after stat is rejected on the opened descriptor', async t => {
  let handle;
  const {port} = await fixture(t, {openFile: async (...args) => {
    if (args[0].endsWith('asset.pmtiles')) {await unlink(args[0]); await mkdir(args[0]);}
    const file = await open(...args);
    if (args[0].endsWith('asset.pmtiles')) handle = file;
    return file;
  }});
  assert.equal((await request(port, '/asset.pmtiles')).status, 404);
  if (handle) await closed(handle);
  await healthy(port);
});

for (const when of ['before-body', 'during-body', 'truncated']) test(`read failure ${when} closes only that response and descriptor`, async t => {
  let handle;
  const {port} = await fixture(t, {openFile: async (...args) => {
    const file = await open(...args);
    if (!args[0].endsWith('asset.pmtiles')) return file;
    handle = file;
    const create = file.createReadStream.bind(file);
    file.createReadStream = options => {
      const stream = create({...options, highWaterMark: 1});
      if (when === 'before-body') stream.destroy(Object.assign(new Error('controlled read failure'), {code: 'EIO'}));
      else if (when === 'during-body') stream.once('data', () => setImmediate(() => stream.destroy(Object.assign(new Error('controlled read failure'), {code: 'EIO'}))));
      else stream.once('data', () => {stream.pause(); truncate(args[0], 1).then(() => stream.resume());});
      return stream;
    };
    return file;
  }});
  const res = await request(port, '/asset.pmtiles');
  assert.ok(res.error, 'incomplete response terminates instead of hanging or succeeding');
  assert.notEqual(res.complete, true);
  await closed(handle);
  await healthy(port);
});

test('disconnect during a transfer closes the reader and allows the next request', async t => {
  let handle;
  const {root, port} = await fixture(t, {openFile: async (...args) => {
    const file = await open(...args);
    if (args[0].endsWith('asset.pmtiles')) handle = file;
    return file;
  }});
  await writeFile(join(root, 'asset.pmtiles'), Buffer.alloc(4 * 1024 * 1024));
  const res = await request(port, '/asset.pmtiles', {onData: response => response.destroy()});
  assert.notEqual(res.complete, true);
  await closed(handle);
  await healthy(port);
});

test('disconnect while a file opens still closes the eventual descriptor', async t => {
  let release, opened, handle;
  const gate = new Promise(resolve => {release = resolve;});
  const waiting = new Promise(resolve => {opened = resolve;});
  const {port} = await fixture(t, {openFile: async (...args) => {
    const file = await open(...args);
    if (args[0].endsWith('asset.pmtiles')) {handle = file; opened(); await gate;}
    return file;
  }});
  const req = http.get({hostname: '127.0.0.1', port, path: '/asset.pmtiles', agent: false});
  req.on('error', () => {});
  await waiting;
  req.destroy();
  await new Promise(resolve => req.once('close', resolve));
  release();
  await new Promise(setImmediate);
  await closed(handle);
  await healthy(port);
});
