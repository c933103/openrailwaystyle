import {createServer} from 'node:http';
import {open, readFile, realpath} from 'node:fs/promises';
import {resolve, join, dirname, posix} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PMTiles} from 'pmtiles';
import {createPreviewServer} from './serve.mjs';
import {restrictedPreviewPage} from './configure-restricted-tiles.mjs';
import {createRestrictedTileHandler} from './restricted-tile-server.mjs';

const GITHUB_DEVICE = 'https://github.com/login/device';
const raster = {
  'image/webp': Buffer.from('UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+ByKi/wEA', 'base64'),
  'image/png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'),
};

// All fixture authentication and map traffic terminate here. The application
// still uses the real broker routes, including its quota and authorization.
export function restrictedFixtures({admin = true, record = () => {}} = {}) {
  return async input => {
    const url = new URL(input);
    record(url);
    if (url.href === GITHUB_DEVICE + '/code') return Response.json({
      device_code:'fixture-device', user_code:'ATLS-TEST', verification_uri:GITHUB_DEVICE, interval:1, expires_in:300,
    });
    if (url.href === 'https://github.com/login/oauth/access_token') return Response.json({access_token:'fixture-token'});
    if (url.href === 'https://api.github.com/user') return Response.json({id:1});
    if (/^\/repos\/[^/]+\/[^/]+$/.test(url.pathname) && url.origin === 'https://api.github.com') return Response.json({permissions:{admin}});
    if (url.origin === 'https://tile.googleapis.com') {
      if (url.pathname === '/v1/createSession') return Response.json({session:'fixture-google-session', expiry:String(Math.floor(Date.now()/1000) + 600)});
      if (url.pathname === '/tile/v1/viewport') return Response.json({copyright:'Synthetic satellite tile', maxZoomRects:[]});
      if (url.pathname.startsWith('/v1/2dtiles/')) return new Response(raster['image/png'], {headers:{'Content-Type':'image/png'}});
    }
    if (url.origin === 'https://indianopenmaps.com') {
      const match = /^\/world\/topo\/russian\/(1m|500k)\/gs\/(.*)$/.exec(url.pathname);
      if (match?.[2] === 'tiles.json') return Response.json({
        minzoom:3, maxzoom:match[1] === '1m' ? 10 : 11, scheme:'xyz',
        tiles:[url.href.replace('tiles.json', '{z}/{x}/{y}.webp')],
      });
      if (match?.[2].endsWith('.webp')) return new Response(raster['image/webp'], {headers:{'Content-Type':'image/webp'}});
    }
    throw new Error('Unexpected network request in tile fixture preview');
  };
}

export async function openHistoricalPreviewArchives(directory) {
  const root = await realpath(directory);
  const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8'));
  if (index.version !== 2 || !Array.isArray(index.groups)) throw new Error('Expected the prepared two-scale archive catalogue.');
  const series = new Map();
  for (const [key, scale] of [['1m',1000000], ['500k',500000]]) {
    const group = index.groups.find(group => group.sheets?.length && group.sheets.every(sheet => sheet.scale === scale));
    if (!Array.isArray(group?.archives) || !group.archives.length) throw new Error(`Missing the ${key} historical archive group.`);
    const archives = await Promise.all(group.archives.map(async name => {
      if (!/^[a-f0-9]{64}\.pmtiles$/.test(name)) throw new Error('Unexpected historical archive name.');
      const path = await realpath(join(root, name));
      if (dirname(path) !== root) throw new Error('Keep the archive files in the catalogue directory.');
      const archive = new PMTiles({
        getKey: () => path,
        async getBytes(offset, length, signal) {
          signal?.throwIfAborted();
          const handle = await open(path);
          try {
            const size = (await handle.stat()).size;
            const buffer = new ArrayBuffer(Math.max(0, Math.min(length, size - offset)));
            const {bytesRead} = await handle.read(new Uint8Array(buffer), 0, buffer.byteLength, offset);
            signal?.throwIfAborted();
            if (bytesRead !== buffer.byteLength) throw new Error('Short read from historical archive.');
            return {data:buffer};
          } finally {await handle.close();}
        },
      });
      const header = await archive.getHeader();
      const type = new Map([[2,'image/png'],[4,'image/webp']]).get(header.tileType);
      if (!type || header.maxZoom > (key === '1m' ? 10 : 11)) throw new Error('Unexpected historical archive format or zoom.');
      return {archive, type, minzoom:header.minZoom, maxzoom:header.maxZoom};
    }));
    series.set(key, archives);
  }
  return async (key, xyz, signal) => {
    const archives = series.get(key);
    if (!xyz) return Response.json({
      minzoom:Math.min(...archives.map(item => item.minzoom)), maxzoom:Math.max(...archives.map(item => item.maxzoom)),
    });
    for (const item of archives) {
      if (xyz[0] < item.minzoom || xyz[0] > item.maxzoom) continue;
      const tile = await item.archive.getZxy(...xyz, signal);
      if (tile) return new Response(tile.data, {headers:{'Content-Type':item.type}});
    }
    return new Response(null,{status:404});
  };
}

export async function createRestrictedPreview({
  origin, fixture = true, root = resolve('styles'), repository = 'c933103/openrailwaystyle',
  githubClientId, googleMapsKey, sovietArchives, sovietEnabled = false, fetcher,
}) {
  const address = new URL(origin);
  if (address.hostname !== '127.0.0.1' || address.protocol !== 'http:' || address.origin !== origin)
    throw new Error('The local preview must use a 127.0.0.1 HTTP origin.');
  if (!fixture && !googleMapsKey && !sovietArchives && !sovietEnabled) throw new Error('Configure one preview tile source.');
  const page = restrictedPreviewPage(await readFile(join(root,'index.html'),'utf8'), origin, fixture);
  const assets = createPreviewServer({root}).listeners('request')[0];
  const tile = createRestrictedTileHandler({
    siteOrigin:origin, repository, sovietEnabled:fixture || sovietEnabled, sovietArchives,
    githubClientId:fixture ? 'fixture-client' : githubClientId,
    googleMapsKey:fixture ? 'fixture-key' : googleMapsKey,
    fetcher:fixture ? (fetcher ?? restrictedFixtures()) : fetcher,
  });
  const server = createServer((req, res) => {
    let url, path;
    try {
      url = new URL(req.url, origin);
      path = posix.normalize(decodeURIComponent(url.pathname));
    } catch {return res.writeHead(400).end();}
    if (req.headers.host !== address.host || url.origin !== origin) return res.writeHead(403).end();
    if (path.startsWith('/restricted/')) return tile(req, res);
    if (path.startsWith('/data/soviet-topo/') || path === '/sw.js') return res.writeHead(404).end();
    if (path === '/admin-preview.html') return res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'}).end(page);
    return assets(req, res);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env, args = process.argv.slice(2);
  if (args.some(arg => arg !== '--github')) throw new Error('Usage: npm run preview:restricted -- [--github]');
  const fixture = !args.includes('--github'), port = Number(env.ATLAS_PREVIEW_PORT || 4180);
  const origin = `http://127.0.0.1:${port}`;
  const server = await createRestrictedPreview({
    origin, fixture, githubClientId:env.GITHUB_CLIENT_ID, repository:env.GITHUB_ADMIN_REPO,
    googleMapsKey:env.GOOGLE_MAPS_API_KEY, sovietEnabled:env.SOVIET_TOPO_TILE_SERVICE === 'indian-open-maps',
    sovietArchives:env.ATLAS_SOVIET_ARCHIVES && await openHistoricalPreviewArchives(env.ATLAS_SOVIET_ARCHIVES),
  });
  server.listen(port,'127.0.0.1', () => {
    console.log(`${fixture ? 'Fixture' : 'GitHub admin'} preview: ${origin}/admin-preview.html#6/47.241/8.557`);
  });
}
