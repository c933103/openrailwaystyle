// The files a branch-line snapshot publishes, whichever source built its
// table (build-branch-lines.mjs from Overpass, build-extract-branch-lines.mjs
// from the Geofabrik extracts): the table (branch-lines.ndjson.gz), the
// tiles (<z>/<x>/<y>.pbf.gz) and their index (index.json).
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {buildTiles, writeTable} from './branch-lines.mjs';

const dirUrl = out => out instanceof URL ? out : pathToFileURL(String(out).replace(/\/?$/, '/'));

export async function writeBranchFiles(out, table) {
  const dir = dirUrl(out);
  await mkdir(dir, {recursive: true});
  await writeFile(new URL('branch-lines.ndjson.gz', dir), gzipSync(writeTable(table), {level: 9}));
  const index = [];
  let tileBytes = 0;
  for (const [key, data] of buildTiles(table)) {
    const [z, x] = key.split('/');
    await mkdir(new URL(`${z}/${x}/`, dir), {recursive: true});
    const gz = gzipSync(data, {level: 9});
    tileBytes += gz.length;
    await writeFile(new URL(`${key}.pbf.gz`, dir), gz);
    index.push(key);
  }
  await writeFile(new URL('index.json', dir), JSON.stringify({tiles: index.sort()}));
  return {tiles: index.length, tileBytes};
}
