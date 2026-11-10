// The files a service-route snapshot publishes, whichever source built its
// table (build-service-routes.mjs from Overpass or the railway-ways store,
// build-extract-service-routes.mjs from the Geofabrik extracts): the table
// (service-routes.ndjson.gz), the tiles (<z>/<x>/<y>.pbf.gz) and their
// index (index.json).
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {buildTiles, writeTable} from './service-routes.mjs';

const dirUrl = out => out instanceof URL ? out : pathToFileURL(String(out).replace(/\/?$/, '/'));

export async function writeServiceFiles(out, table) {
  const dir = dirUrl(out);
  await mkdir(dir, {recursive: true});
  await writeFile(new URL('service-routes.ndjson.gz', dir), gzipSync(writeTable(table), {level: 9}));
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
