// Compare actual public crossing artifacts with the staged Pages artifact.
// A generic Pages receipt or a successful unrelated tile is not evidence
// that a newly selected crossings source is public.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {checkMarker} from './data-source.mjs';
import {boundedBody} from './verify-deployed-reference.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isGzip = bytes => bytes[0] === 31 && bytes[1] === 139;
const changedAtCutover = '9/163/324';

export async function verifyDeployedCrossings({baseUrl, read, fetcher = fetch,
  wait = sleep, warn = console.warn} = {}) {
  const marker = await read('source.json').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (marker === null) {
    const legacy = await read('manifest.json').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (legacy && JSON.parse(legacy).extract) throw Error('Staged crossings extract has no source marker');
    return null; // Legacy Overpass fallback, not an extract acceptance.
  }
  const problem = checkMarker(marker, 'crossings');
  if (problem) throw Error('Invalid staged crossings marker: ' + problem);
  const index = await read('index.json'), manifest = await read('manifest.json');
  const {tiles} = JSON.parse(index);
  const receipts = JSON.parse(manifest);
  if (!Array.isArray(tiles) || !tiles.length || tiles.length !== receipts.tiles ||
    tiles.some(tile => typeof tile !== 'string' || !/^\d{1,2}\/\d{1,9}\/\d{1,9}$/.test(tile)) ||
    new Set(tiles).size !== tiles.length || receipts.complete !== true ||
    !Number.isSafeInteger(receipts.crossings) || receipts.crossings <= 0)
    throw Error('Invalid staged crossings manifest or index');
  const base = new URL(String(baseUrl).replace(/\/?$/, '/'));
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw Error('Invalid deployment URL');
  const directory = new URL('data/level-crossings/', base);
  const checks = [['source.json', marker, false], ['manifest.json', manifest, false], ['index.json', index, false]];
  const samples = [...new Set([...(tiles.includes(changedAtCutover) ? [changedAtCutover] : []), tiles[0], tiles.at(-1)])];
  for (const tile of samples) {
    const path = tile + '.pbf.gz';
    const staged = await read(path);
    if (!isGzip(staged)) throw Error('Expected staged gzip crossings tile: ' + path);
    const plain = gunzipSync(staged, {maxOutputLength: 16 * 1024 * 1024});
    if (!plain.length) throw Error('Empty staged crossings tile: ' + path);
    checks.push([path, plain, true, Math.max(staged.length, plain.length) + 1024]);
  }
  for (const [name, expected, tile, maxBytes = expected.length] of checks) {
    for (let attempt = 1; ; attempt++) {
      try {
        const signal = AbortSignal.timeout(12000);
        const response = await fetcher(new URL(name, directory), {
          redirect: 'error', signal, headers: {'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity'},
        });
        if (response.status !== 200) {
          response.body?.cancel().catch(() => {});
          throw Error('HTTP ' + response.status);
        }
        const bytes = await boundedBody(response, maxBytes, signal);
        const actual = tile && isGzip(bytes) ? gunzipSync(bytes, {maxOutputLength: expected.length}) : bytes;
        if (!actual.equals(expected)) throw Error('SHA-256 mismatch: expected ' + digest(expected) + ', got ' + digest(actual));
        break;
      } catch (error) {
        const failure = 'Public crossings ' + name + ': ' + error.message;
        if (attempt >= 5) throw Error(failure, {cause: error});
        warn(failure + '; retrying (' + attempt + '/5)');
        await wait(3000);
      }
    }
  }
  return {crossings: receipts.crossings, tiles: tiles.length, samples,
    inputSha256: JSON.parse(marker).inputSha256 ?? null, indexSha256: digest(index)};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [baseUrl, directory] = process.argv.slice(2);
  if (!baseUrl || !directory) throw Error('Usage: verify-deployed-crossings.mjs <site URL> <staged crossings directory>');
  const verified = await verifyDeployedCrossings({baseUrl, read: name => readFile(join(directory, name))});
  if (verified) console.log('PASS: exact deployed crossings extract', JSON.stringify(verified));
  else console.log('No staged extract marker: Overpass fallback is not a verified crossings extract');
}
