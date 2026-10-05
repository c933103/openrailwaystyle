// The browser for the check-*-browser.mjs scripts.
//
// With BROWSER_WS_ENDPOINT (scripts/run-browser-checks.mjs) a check joins a
// browser that the checks before it in the same slot already started;
// closing it only disconnects. A check with options a shared browser cannot
// take (a proxy, another executable) starts its own.
//
// With BROWSER_TILE_CACHE, GET responses from other origins (map tiles,
// glyphs, provider APIs) are kept in that directory and served from it for
// TILE_CACHE_DAYS (7): checks wait for the network far less. The site under test is never cached, and the
// deploy job checks the published site without a cache. Routes a check sets
// itself take precedence; this one only sees what they pass on.
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const BROWSER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
export const TILE_CACHE_DAYS = 7;
// Responses worth replaying: success, partial content (PMTiles ranges) and
// the no-content answer providers give for empty tiles. A 404 can be a
// provider's passing fault, and replaying it for a week would hide its
// recovery, so it is always fetched again.
const CACHED_STATUS = new Set([200, 204, 206]);
// Set by the browser per response; replaying them would misdescribe the
// decoded body Playwright hands over.
const DROPPED_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie']);

export async function launchBrowser(options = {}) {
  const shared = process.env.BROWSER_WS_ENDPOINT;
  const browser = shared && !options.proxy && !options.executablePath
    ? await chromium.connect(shared)
    : await chromium.launch({headless: true, ...options, args: [...new Set([...BROWSER_ARGS, ...(options.args || [])])]});
  const cache = process.env.BROWSER_TILE_CACHE;
  if (cache) {
    const newContext = browser.newContext.bind(browser);
    // browser.newPage() creates its context through this method as well.
    browser.newContext = async (...args) => {
      const context = await newContext(...args);
      await cacheOtherOrigins(context, cache);
      return context;
    };
  }
  return browser;
}

const local = url => {
  const {protocol, hostname} = new URL(url);
  return !/^https?:$/.test(protocol) || hostname === '127.0.0.1' || hostname === 'localhost';
};
// One entry per URL and byte range.
export const cacheKey = (url, range = '') => createHash('sha256').update(`${url}\n${range}`).digest('hex');

export async function cacheOtherOrigins(context, directory, {now = Date.now, maxAge = TILE_CACHE_DAYS * 86400000} = {}) {
  await mkdir(directory, {recursive: true});
  // A check may close its page or context while a request is still on its
  // way; the route then fails quietly instead of crashing the check, and an
  // answer that cannot be kept is simply not kept.
  await context.route(url => !local(url.href ?? url), route => serve(route, directory, {now, maxAge}).catch(() => route.abort().catch(() => {})));
}
async function serve(route, directory, {now, maxAge}) {
  const request = route.request();
  if (request.method() !== 'GET') return route.fallback();
  const range = (await request.allHeaders()).range || '';
  const key = cacheKey(request.url(), range), file = join(directory, key);
  try {
    const entry = JSON.parse(await readFile(`${file}.json`, 'utf8'));
    if (now() - entry.saved < maxAge) {
      const body = entry.size ? await readFile(`${file}.body`) : Buffer.alloc(0);
      return await route.fulfill({status: entry.status, headers: entry.headers, body});
    }
  } catch {}
  // A miss goes out from the browser itself, as it would without the cache:
  // fetching it through Playwright instead made a run with an empty cache
  // far slower than one without any. The answer is kept once it arrives.
  await route.continue();
  const response = await request.response();
  if (!response || !CACHED_STATUS.has(response.status())) return;
  const body = await response.body(), headers = {};
  for (const [name, value] of Object.entries(await response.allHeaders())) if (!DROPPED_HEADERS.has(name.toLowerCase())) headers[name] = value;
  // Written under a temporary name and renamed, so a concurrent check never
  // reads half an entry.
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  await writeFile(`${temporary}.body`, body);
  await rename(`${temporary}.body`, `${file}.body`);
  await writeFile(`${temporary}.json`, JSON.stringify({url: request.url(), range, status: response.status(), headers, size: body.length, saved: now()}));
  await rename(`${temporary}.json`, `${file}.json`);
  await writeFile(join(directory, '.changed'), '');
}

// Drops expired entries and the marker, before a cache is saved:
//   node scripts/browser.mjs prune <directory>
export async function pruneTileCache(directory, {now = Date.now, maxAge = TILE_CACHE_DAYS * 86400000} = {}) {
  const {readdir, rm} = await import('node:fs/promises');
  let kept = 0, dropped = 0;
  for (const name of await readdir(directory).catch(() => [])) {
    if (!name.endsWith('.json')) continue;
    const key = name.slice(0, -5);
    let saved = 0;
    try { saved = JSON.parse(await readFile(join(directory, name), 'utf8')).saved; } catch {}
    if (now() - saved < maxAge) { kept++; continue; }
    await rm(join(directory, name), {force: true});await rm(join(directory, `${key}.body`), {force: true});dropped++;
  }
  return {kept, dropped};
}
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'prune') {
  console.log('Tile cache:', await pruneTileCache(process.argv[3]));
}
