// One planned Geofabrik region, downloaded once and filtered once for every
// dataset (#330, B2). Run by `.github/workflows/osm-extract.yml`, one region
// per job:
//   node --import ./scripts/overpass-meter.mjs scripts/acquire-region-extract.mjs <region.json> <output directory>
// where region.json is one entry of the region plan ({id, url, bytes}) plus
// the plan's sourceDate. It writes <output>/filtered.osm.pbf and
// <output>/extract.json, and deletes the raw download.
//
// Requests, all to download.geofabrik.de over HTTPS, never redirected: one
// HEAD, the .md5 sidecar, the file. The download is refused unless its size
// is the planned size and fits the disk; it is stopped past that size or
// the time budget, and kept only when its MD5 matches. The file's own
// replication timestamp must fall within a day of the planned date.
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
export const DOWNLOAD_MS = 90 * 60_000;
export const MAX_SIDECAR = 4096;
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

export async function acquireRegion(input, out, {fetcher = fetch, run = promisify(execFile), freeBytes = async dir => { const s = await statfs(dir); return s.bavail * s.bsize; },
  now = () => performance.now(), downloadMs = DOWNLOAD_MS} = {}) {
  const region = checkRegion(input);
  await mkdir(out, {recursive: true});
  const started = now();
  const head = answered(await request(fetcher, region.url, {method: 'HEAD'}), region.url);
  const size = Number(head.headers.get('content-length'));
  if (size !== region.bytes) throw new Error(`${region.id}: size ${head.headers.get('content-length')} is not the planned ${region.bytes}`);
  const free = await freeBytes(out);
  if (free < size + DISK_MARGIN) throw new Error(`${region.id}: ${free} bytes free, need ${size + DISK_MARGIN}`);
  const sidecar = answered(await request(fetcher, `${region.url}.md5`), `${region.url}.md5`);
  const text = await sidecar.text();
  const md5Match = text.length <= MAX_SIDECAR && /^([0-9a-fA-F]{32})\s/.exec(text);
  if (!md5Match) throw new Error(`${region.id}: invalid .md5 sidecar`);
  const expected = md5Match[1].toLowerCase();

  const source = join(out, 'source.osm.pbf'), partial = `${source}.part`;
  const md5 = createHash('md5'), sha256 = createHash('sha256');
  let received = 0;
  try {
    const body = answered(await request(fetcher, region.url, {signal: AbortSignal.timeout(downloadMs)}), region.url);
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
    }, createWriteStream(partial));
    if (received !== size) throw new Error(`${region.id}: received ${received} of ${size} bytes`);
    if (md5.digest('hex') !== expected) throw new Error(`${region.id}: MD5 does not match the sidecar`);
    await rename(partial, source);
  } finally {
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
    const filteredBytes = (await stat(filtered)).size;
    const filteredSha256 = await fileSha256(filtered);
    const manifest = {schema: 1, region: region.id, sourceDate: region.sourceDate, url: region.url, sourceTimestamp,
      pbfBytes: size, sourceMd5: expected, pbfSha256: sha256.digest('hex'), filteredBytes, filteredSha256,
      counts: {nodes, ways, relations}, filter: createHash('sha256').update(expressionsFile()).digest('hex'),
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
  const manifest = await acquireRegion(JSON.parse(await readFile(regionFile, 'utf8')), out);
  console.log(JSON.stringify(manifest));
}
