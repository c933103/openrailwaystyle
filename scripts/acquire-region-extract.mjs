// One planned Geofabrik region, downloaded once and filtered once for every
// dataset (#330, B2). Run by `.github/workflows/osm-extract.yml`, one region
// per job:
//   node --import ./scripts/overpass-meter.mjs scripts/acquire-region-extract.mjs <region.json> <output directory>
// where region.json is one entry of the region plan ({id, url, bytes}) plus
// the plan's sourceDate, and `previous`, the region's working copy, when it
// has one. It writes <output>/filtered.osm.pbf and <output>/extract.json, and
// deletes the raw download; or only extract.json with `unchanged: true` when
// the source file is the one the working copy was made from; or
// <output>/failed.json with the reason.
//
// Requests, all to download.geofabrik.de over HTTPS, never redirected: one
// HEAD, the .md5 sidecar, the file. The download is refused unless its size
// is the planned size and fits the disk; it is stopped past that size or
// the time budget, and kept only when its MD5 matches. The file's own
// replication timestamp must fall within a day of the planned date.
import {responseChunks} from './response-chunks.mjs';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, readFile, rename, rm, stat, statfs, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {expressionsFile} from './extract-filter.mjs';

export const HOST = 'download.geofabrik.de';
export const USER_AGENT = 'RailwayAtlas-extract/1 (+https://github.com/c933103/openrailwaystyle/issues/330)';
export const DISK_MARGIN = 4 * 1024 ** 3;
// The time this script may take, set by the workflow from its job limit
// (REGION_TIME_BUDGET_MINUTES). The download must stop early enough for the
// checks, the filter and the record to finish, so the failure, the meter
// line and the artifact are written. The largest region (8 GiB, the plan's
// cap) at 0.55 MB/s, a little under the slowest speed measured (ukraine,
// 0.82 GiB in 1,549 s, about 0.57 MB/s, 2026-11-04), needs about 260 minutes; GitHub-hosted jobs run at most 6 hours.
export const TIME_BUDGET_MINUTES = 340;
// After the download: canada's 6.5 GB took about 4 minutes on 2026-11-09.
// Osmium's time grows with the objects, not only the bytes, so 4 times that.
export const FILTER_RESERVE_MS = 20 * 60_000;
export const MAX_SIDECAR = 4096;
// The filter a working copy was made with; a copy made with another filter
// is never taken as current.
export const FILTER_HASH = createHash('sha256').update(expressionsFile()).digest('hex');
// A refreshed region with more than this share fewer objects than its
// working copy is rejected; that region keeps its working copy.
export const MAX_DROP = 0.05;
const total = counts => counts.nodes + counts.ways + counts.relations;
const DATED = /^https:\/\/download\.geofabrik\.de\/(?:[a-z0-9-]+\/)*[a-z0-9-]+-(\d{2})(\d{2})(\d{2})\.osm\.pbf$/;

// A planned region: an id, a dated Geofabrik URL whose date is the plan's,
// and a positive size.
export function checkRegion(region) {
  const {id, url, bytes, sourceDate} = region || {};
  if (typeof id !== 'string' || !/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(id)) throw new Error(`Invalid region id ${JSON.stringify(id)}`);
  const match = DATED.exec(typeof url === 'string' ? url : '');
  if (!match) throw new Error(`${id}: not a dated Geofabrik PBF URL: ${url}`);
  if (typeof sourceDate !== 'string' || `${match[1]}${match[2]}${match[3]}` !== sourceDate.replaceAll('-', '').slice(2)) throw new Error(`${id}: URL date does not match the plan date ${sourceDate}`);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`${id}: invalid planned size ${bytes}`);
  return {id, url, bytes, sourceDate};
}

async function fileSha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

const request = (fetcher, url, init = {}) => fetcher(url, {...init, headers: {'User-Agent': USER_AGENT}, redirect: 'manual'});
function answered(response, url) {
  if (response.status >= 300 && response.status < 400) throw new Error(`${url}: unexpected redirect (HTTP ${response.status}); only ${HOST} is asked`);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

async function checksumText(response, id) {
  const chunks = [];
  let received = 0;
  // Do not buffer an entire response before enforcing this small limit.
  // Count bytes before decoding: a filename can contain multibyte UTF-8.
  // Early exit initiates cancellation and releases the reader without waiting
  // for cleanup; the byte-limit failure must remain bounded.
  for await (const chunk of response.body ? responseChunks(response) : []) {
    received += chunk.byteLength;
    if (received > MAX_SIDECAR) throw new Error(`${id}: .md5 sidecar exceeds ${MAX_SIDECAR} bytes`);
    chunks.push(chunk);
  }
  // Match Response.text()'s UTF-8 decoding, including an optional BOM.
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function acquireRegion(input, out, {fetcher = fetch, run = promisify(execFile), freeBytes = async dir => { const s = await statfs(dir); return s.bavail * s.bsize; },
  now = () => performance.now(), timeBudgetMs = TIME_BUDGET_MINUTES * 60_000, timeoutSignal = ms => AbortSignal.timeout(ms)} = {}) {
  const region = checkRegion(input), previous = input.previous || null;
  await mkdir(out, {recursive: true});
  const started = now();
  const head = answered(await request(fetcher, region.url, {method: 'HEAD'}), region.url);
  const size = Number(head.headers.get('content-length'));
  if (size !== region.bytes) throw new Error(`${region.id}: size ${head.headers.get('content-length')} is not the planned ${region.bytes}`);
  const free = await freeBytes(out);
  if (free < size + DISK_MARGIN) throw new Error(`${region.id}: ${free} bytes free, need ${size + DISK_MARGIN}`);
  const sidecar = answered(await request(fetcher, `${region.url}.md5`), `${region.url}.md5`);
  const text = await checksumText(sidecar, region.id);
  const md5Match = /^([0-9a-fA-F]{32})\s/.exec(text);
  if (!md5Match) throw new Error(`${region.id}: invalid .md5 sidecar`);
  const expected = md5Match[1].toLowerCase();
  // The same file filtered the same way as the working copy: nothing to
  // download (the size and MD5 check of validate_checkpoint in
  // scripts/plan-mainline-acquisition.py).
  if (previous && previous.sourceMd5 === expected && previous.pbfBytes === size && previous.filter === FILTER_HASH) {
    const manifest = {schema: 1, region: region.id, unchanged: true, sourceDate: region.sourceDate, url: region.url,
      pbfBytes: size, sourceMd5: expected, filter: FILTER_HASH};
    await writeFile(join(out, 'extract.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  }

  const source = join(out, 'source.osm.pbf'), partial = `${source}.part`;
  const md5 = createHash('md5'), sha256 = createHash('sha256');
  let received = 0, file;
  // What is left of the budget once the checks and filter are set aside.
  const downloadMs = Math.floor(timeBudgetMs - FILTER_RESERVE_MS - (now() - started));
  if (!(downloadMs > 0)) throw new Error(`${region.id}: no time left to download within the ${timeBudgetMs / 60_000}-minute budget`);
  const signal = timeoutSignal(downloadMs);
  try {
    const body = answered(await request(fetcher, region.url, {signal}), region.url);
    if (Number(body.headers.get('content-length')) !== size) throw new Error(`${region.id}: size changed between HEAD and download`);
    // pipeline ends the file and passes on a write error (a full disk) as
    // this region's failure; the partial file is removed below.
    await pipeline(body.body, async function* count(source) {
      for await (const chunk of source) {
        received += chunk.byteLength;
        if (received > size) throw new Error(`${region.id}: more than the planned ${size} bytes`);
        md5.update(chunk); sha256.update(chunk);
        yield chunk;
      }
    }, file = createWriteStream(partial));
    if (received !== size) throw new Error(`${region.id}: received ${received} of ${size} bytes`);
    if (md5.digest('hex') !== expected) throw new Error(`${region.id}: MD5 does not match the sidecar`);
    await rename(partial, source);
  } catch (error) {
    if (signal.aborted) throw new Error(`${region.id}: download stopped after ${Math.round(downloadMs / 60_000)} minutes, the time budget less ${FILTER_RESERVE_MS / 60_000} for checking and filtering; ${received} of ${size} bytes received`);
    throw error;
  } finally {
    // An aborted pipeline can return before the file stream has finished
    // opening and closing; removing the file first would let it reappear.
    if (file && !file.closed) await new Promise(resolve => file.once('close', resolve));
    await rm(partial, {force: true});
  }
  const downloadSeconds = (now() - started) / 1000;

  const filtered = join(out, 'filtered.osm.pbf'), expressions = join(out, 'filter.txt');
  try {
    const {stdout: stampText} = await run('osmium', ['fileinfo', '-g', 'header.option.osmosis_replication_timestamp', source]);
    // The same day as the dated file, or one day either side (as the
    // continent acquisition in scripts/acquire-mainline-extract.py checks).
    const sourceTimestamp = stampText.trim(), stamp = Date.parse(sourceTimestamp);
    const days = Number.isFinite(stamp) ? Math.abs(Date.parse(new Date(stamp).toISOString().slice(0, 10)) - Date.parse(region.sourceDate)) / 86400_000 : Infinity;
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(sourceTimestamp) || days > 1) {
      throw new Error(`${region.id}: replication timestamp ${JSON.stringify(sourceTimestamp)} is not near ${region.sourceDate}`);
    }
    await writeFile(expressions, expressionsFile());
    const filtering = now();
    await run('osmium', ['tags-filter', source, '-e', expressions, '-o', filtered, '--overwrite'], {maxBuffer: 16 * 1024 ** 2});
    const filterSeconds = (now() - filtering) / 1000;
    await rm(source, {force: true});
    await run('osmium', ['check-refs', filtered], {maxBuffer: 16 * 1024 ** 2});
    const {stdout: info} = await run('osmium', ['fileinfo', '-e', '-j', filtered], {maxBuffer: 16 * 1024 ** 2});
    const {nodes, ways, relations} = JSON.parse(info).data.count;
    // Checks against the working copy before this region may replace it.
    if (previous) {
      if (previous.sourceTimestamp && Date.parse(sourceTimestamp) < Date.parse(previous.sourceTimestamp)) {
        await rm(filtered, {force: true});
        throw new Error(`${region.id}: data from ${sourceTimestamp} is older than the working copy's ${previous.sourceTimestamp}`);
      }
      const before = previous.counts ? total(previous.counts) : 0, after = nodes + ways + relations;
      if (previous.filter === FILTER_HASH && before && after < before * (1 - MAX_DROP)) {
        await rm(filtered, {force: true});
        throw new Error(`${region.id}: ${after} objects, ${((1 - after / before) * 100).toFixed(1)}% fewer than the working copy's ${before}`);
      }
    }
    const filteredBytes = (await stat(filtered)).size;
    const filteredSha256 = await fileSha256(filtered);
    const manifest = {schema: 1, region: region.id, sourceDate: region.sourceDate, url: region.url, sourceTimestamp,
      pbfBytes: size, sourceMd5: expected, pbfSha256: sha256.digest('hex'), filteredBytes, filteredSha256,
      counts: {nodes, ways, relations}, filter: FILTER_HASH,
      downloadSeconds, filterSeconds, freeBytesBefore: free, source: 'OpenStreetMap via Geofabrik', license: 'ODbL-1.0'};
    await writeFile(join(out, 'extract.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    await rm(source, {force: true});
    await rm(expressions, {force: true});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [regionFile, out] = process.argv.slice(2);
  if (!regionFile || !out) throw new Error('Usage: acquire-region-extract.mjs <region.json> <output directory>');
  const input = JSON.parse(await readFile(regionFile, 'utf8'));
  try {
    const minutes = process.env.REGION_TIME_BUDGET_MINUTES;
    if (minutes !== undefined && !(Number(minutes) * 60_000 > FILTER_RESERVE_MS)) throw new Error(`Invalid REGION_TIME_BUDGET_MINUTES ${minutes}: must be more than ${FILTER_RESERVE_MS / 60_000}`);
    console.log(JSON.stringify(await acquireRegion(input, out, minutes === undefined ? {} : {timeBudgetMs: Number(minutes) * 60_000})));
  } catch (error) {
    // The reason goes to the publish job's report; this region keeps its
    // working copy (scripts/extract-release.mjs).
    await mkdir(out, {recursive: true});
    await writeFile(join(out, 'failed.json'), `${JSON.stringify({region: input?.id, error: String(error.message || error)})}\n`);
    throw error;
  }
}
