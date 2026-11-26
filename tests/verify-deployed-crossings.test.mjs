import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {verifyDeployedCrossings} from '../scripts/verify-deployed-crossings.mjs';

const path = '9/163/324.pbf.gz';
const raw = Buffer.from('new level crossing vector bytes');
const content = {
  'source.json': Buffer.from(JSON.stringify({schema: 1, dataset: 'crossings', source: 'extract',
    complete: true, osmTimestamp: '2026-11-25T00:00:00Z', inputSha256: 'a'.repeat(64)})),
  'manifest.json': Buffer.from(JSON.stringify({complete: true, crossings: 3, tiles: 2})),
  'index.json': Buffer.from(JSON.stringify({tiles: ['5/1/3', '9/163/324']})),
  '5/1/3.pbf.gz': gzipSync(raw),
  [path]: gzipSync(raw),
};
const run = (fn, files = content) => verifyDeployedCrossings({
  baseUrl: 'https://map.example/project/', read: async name => {
    if (!files[name]) throw Object.assign(Error('Missing ' + name), {code: 'ENOENT'});
    return files[name];
  },
  fetcher: async (url, opts) => {
    assert.equal(url.origin, 'https://map.example');
    assert.ok(url.pathname.startsWith('/project/data/level-crossings/'));
    assert.equal(opts.redirect, 'error');
    return fn(url.pathname.split('level-crossings/')[1]);
  }, wait: async () => {}, warn: () => {},
});

test('binds the public marker, manifest, index and decoded sample bytes', async () => {
  const seen = [];
  const verified = await run(name => {
    seen.push(name);
    return new Response(name === path ? raw : content[name]);
  });
  assert.deepEqual(seen, ['source.json', 'manifest.json', 'index.json', path, '5/1/3.pbf.gz']);
  assert.equal(verified.inputSha256, 'a'.repeat(64));
  assert.equal(verified.tiles, 2);
});
test('accepts recovery from stale CDN metadata but rejects stale tile bytes and 404', async () => {
  let indexRequests = 0;
  await run(name => new Response(name === 'index.json' && ++indexRequests === 1 ? '{}' : content[name]));
  assert.equal(indexRequests, 2);
  let calls = 0;
  await assert.rejects(run(name => new Response(name === path && ++calls ? 'old payload' : content[name])), /9\/163\/324.*SHA-256 mismatch/);
  assert.equal(calls, 5);
  await assert.rejects(run(name => name === path ? new Response(null, {status: 404}) : new Response(content[name])), /HTTP 404/);
});
test('legacy fallback is not a positive result, and invalid markers fail before network', async () => {
  const unexpected = () => assert.fail('should not fetch');
  assert.equal(await run(unexpected, {}), null);
  await assert.rejects(run(unexpected, {'manifest.json': Buffer.from('{"extract":{}}')}), /no source marker/);
  await assert.rejects(run(unexpected, {...content, 'source.json': Buffer.from('{}')}), /Invalid staged/);
});
test('deployment checks crossings before running its later browser acceptance', async () => {
  const workflow = await readFile(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  const positions = ['Deploy to GitHub Pages', 'Verify deployed crossings extract', 'Verify deployed independent OSM geometry',
    'Retain verified extract generation'].map(label => workflow.indexOf(label));
  assert.ok(positions.every((n,i) => n >= 0 && (i === 0 || n > positions[i - 1])));
  assert.match(workflow, /verify-deployed-crossings\.mjs "\$PAGE_URL" styles\/data\/level-crossings/);
});
