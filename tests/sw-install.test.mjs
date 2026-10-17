import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto, createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {backportMapLibre524} from '../styles/map-controls.mjs';
import {BROWSER_LIBRARIES} from '../scripts/browser-libraries.mjs';
import * as cachedStationCompatibility from './fixtures/cached-station-compatibility.mjs';

const source = readFileSync(new URL('../styles/sw.js', import.meta.url), 'utf8');
const scope = 'https://atlas.test/openrailwaystyle/';
const generation = Number(source.match(/CACHE = `\$\{PREFIX\}(\d+)`/)[1]);
const keyOf = input => input.url ?? String(input);
const bytes = value => typeof value==='string'?new TextEncoder().encode(value):value;
const legacyDistributions=new Map(BROWSER_LIBRARIES.map(library=>[
  `https://cdn.jsdelivr.net/npm/${library.package}@${library.version}/${library.source}`,
  {body:readFileSync(new URL(`../node_modules/${library.package}/${library.source}`,import.meta.url)),type:library.target.endsWith('.css')?'text/css':'application/javascript'},
]));

const patchedMapLibre=Buffer.from(await backportMapLibre524(
  legacyDistributions.get('https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js').body,webcrypto.subtle));

// Installing workers have a small network concurrency budget. A fetch resolves
// at headers, but its slot is only released when the response body is consumed.
// highWaterMark:0 makes this distinction explicit instead of eagerly buffering
// every mock response (which would hide the installation deadlock).
function startWorker({version = 'new', fail = '', stores = new Map(), code = source, rejectExternal = false, noLegacyCrypto = false, assetBodies = new Map()} = {}) {
  const handlers = new Map(), queue = [], writes = [], requests = [];
  const counts = {active: 0, peak: 0, started: 0, finished: 0};
  let offline = false, skipped = false, claimed = false;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return {
        async match(key) { return data.get(keyOf(key))?.clone(); },
        async put(key, response) {
          writes.push({key: keyOf(key), active: counts.active});
          // Keep the response's status and headers as well as its complete body.
          data.set(keyOf(key), new Response(await response.arrayBuffer(), {
            status: response.status, statusText: response.statusText, headers: response.headers
          }));
        },
        async keys() { return [...data.keys()].map(key => new Request(key)); },
        async delete(key) { return data.delete(keyOf(key)); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  const release = () => {
    counts.active--; counts.finished++;
    // Transfer the freed slot before waking a queued fetch, so a new fetch
    // cannot steal it between promise continuations.
    const next = queue.shift();
    if (next) { counts.active++; next(); }
  };
  const fetch = async input => {
    const url = keyOf(input), page = url === scope;
    requests.push(url);
    if (rejectExternal && new URL(url).origin !== new URL(scope).origin) throw new TypeError('blocked third-party request');
    if (offline) throw new TypeError('offline');
    if (counts.active >= 3) await new Promise(resolve => queue.push(resolve));
    else counts.active++;
    counts.started++; counts.peak = Math.max(counts.peak, counts.active);
    const legacy=new URL(url).pathname.endsWith('/vendor/maplibre-gl-5.24.0-atlas.1.js')
      ? {body:patchedMapLibre,type:'application/javascript'} : legacyDistributions.get(url) ?? (new URL(url).pathname.endsWith('/vendor/maplibre-gl-5.24.0.js')
      ? legacyDistributions.get('https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js') : null);
    const body = page ? `<script type="module" src="app.mjs?v=${version}"></script>` : assetBodies.get(new URL(url).pathname)??legacy?.body??`${version}: ${url}`;
    let consumed = false;
    return new Response(new ReadableStream({
      pull(controller) {
        if (consumed) return;
        consumed = true;
        if (fail && url.includes(fail)) controller.error(new TypeError('truncated response'));
        else { controller.enqueue(bytes(body)); controller.close(); }
        release();
      }
    }, {highWaterMark: 0}), {
      status: page||legacy ? 200 : 203,
      headers: {'content-type': page ? 'text/html' : legacy?.type??'application/octet-stream', 'x-fixture-url': url}
    });
  };
  vm.runInNewContext(code, {
    URL, Response, Request, fetch, caches, location: {origin: new URL(scope).origin},
    self: {
      crypto: noLegacyCrypto ? undefined : webcrypto,
      registration: {scope}, addEventListener: (name, fn) => handlers.set(name, fn),
      skipWaiting: async () => { skipped = true; }, clients: {claim: async () => { claimed = true; }}
    }
  });
  const lifecycle = name => {
    let result;
    handlers.get(name)({waitUntil(promise) { result = promise; }});
    assert.ok(result, `${name} must retain its asynchronous work`);
    return result;
  };
  const request = (path, navigate = false) => {
    let result;
    handlers.get('fetch')({
      request: {method: 'GET', url: new URL(path, scope).href, mode: navigate ? 'navigate' : 'cors'},
      respondWith(promise) { result = promise; }
    });
    assert.ok(result, `${path} must be handled by the worker`);
    return result;
  };
  return {stores, counts, writes, requests, lifecycle, request, setOffline() { offline = true; },
    get skipped() { return skipped; }, get claimed() { return claimed; }};
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('installation stalled on unread response bodies')), 1500);
    })]);
  } finally { clearTimeout(timer); }
}

test('installation drains response bodies without exhausting its three network slots', async () => {
  const worker = startWorker();
  await bounded(worker.lifecycle('install'));
  assert.equal(worker.counts.active, 0);
  assert.equal(worker.counts.started, worker.counts.finished);
  assert.ok(worker.counts.started > 30);
  assert.ok(worker.counts.peak <= 3);
  assert.ok(worker.writes.length > 60);
  assert.ok(worker.writes.every(write => write.active === 0), 'no partial shell published before downloads finish');
  assert.equal(worker.skipped, true);
  const app = worker.stores.get(`atlas-shell-${generation}`).get(`${scope}app.mjs?v=new`);
  assert.equal(app.status, 203);
  assert.equal(app.headers.get('x-fixture-url'), `${scope}app.mjs?v=new`);
  assert.equal(await app.clone().text(), `new: ${scope}app.mjs?v=new`);
});

for (const fail of ['map-model.mjs', 'maplibre-gl-5.24.0-atlas.1.js', 'maplibre-gl-5.24.0.css', 'pmtiles-4.2.1.js']) {
  test(`a truncated ${fail} response cannot publish or activate an incomplete shell`, async () => {
    const worker = startWorker({fail});
    await assert.rejects(bounded(worker.lifecycle('install')), /truncated response/);
    assert.deepEqual(worker.writes, []);
    assert.equal(worker.skipped, false);
    assert.equal(worker.claimed, false);
  });
}

test('a complete replacement keeps the previous version and revised icons available offline', async () => {
  const oldCode = source.replace(/CACHE = `\$\{PREFIX\}\d+`/, () => `CACHE = \`\${PREFIX}${generation - 1}\``);
  const old = startWorker({version: 'old', code: oldCode});
  await bounded(old.lifecycle('install'));
  await old.lifecycle('activate');
  old.stores.set('unrelated-app', new Map([['keep', new Response('untouched')]]));
  const next = startWorker({version: 'new', stores: old.stores});
  await bounded(next.lifecycle('install'));
  await next.lifecycle('activate');
  assert.equal(next.claimed, true);
  assert.equal(next.stores.has(`atlas-shell-${generation - 1}`), false);
  assert.equal(await next.stores.get('unrelated-app').get('keep').clone().text(), 'untouched');
  next.setOffline();
  assert.match(await (await next.request('./', true)).text(), /app.mjs\?v=new/);
  assert.equal(await (await next.request('app.mjs?v=old')).text(), `old: ${scope}app.mjs?v=old`);
  assert.equal(await (await next.request('app.mjs?v=new')).text(), `new: ${scope}app.mjs?v=new`);
  assert.match(await (await next.request('atlas-icon-512.png?rev=changed')).text(), /^new:/);
  const versions = await next.stores.get(`atlas-shell-${generation}`).get(`${scope}__versions`).clone().json();
  assert.deepEqual(versions, ['new', 'old']);
});

for (const previousVersion of ['20261011-power-legend-1', '20261011-departure-availability-1', '20261012-search-availability-1', '20261016-crossfeed-cancellation-1', '20261017-source-trip-identity-1', '20261017-elevation-pending-cache-1']) for (const file of ['app.mjs', 'departures.mjs', 'elevation.mjs', 'platform-length.mjs']) test(`the current application release refreshes ${file} from ${previousVersion} while previous tabs retain their version`, async () => {
  const page = readFileSync(new URL('../styles/index.html', import.meta.url), 'utf8');
  const currentVersion = page.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(currentVersion, 'the actual page declares its asset version');
  assert.notEqual(currentVersion, previousVersion, 'the correction needs a fresh cache-first asset version');
  const path = new URL(file, scope).pathname;
  const previousBytes = 'export const departureRelease = "before-correction";';
  const currentBytes = readFileSync(new URL(`../styles/${file}`, import.meta.url), 'utf8');
  const old = startWorker({version: previousVersion, assetBodies: new Map([[path, previousBytes]])});
  await bounded(old.lifecycle('install'));
  await old.lifecycle('activate');
  assert.equal(await (await old.request(`${file}?v=${previousVersion}`)).text(), previousBytes);

  // The worker source and cache generation stay unchanged. Only the deployed
  // page and assets change, as on a normal visit after this release.
  const next = startWorker({version: currentVersion, stores: old.stores,
    assetBodies: new Map([[path, currentBytes]])});
  await bounded(next.request('./', true));
  assert.ok(await (await next.request(`${file}?v=${currentVersion}`)).text() === currentBytes,
    'the current page must receive the corrected module bytes, not the previous saved version');
  assert.equal(next.requests.filter(url => new URL(url).pathname === path).length, 1,
    'the new complete shell fetches this module once');
  next.setOffline();
  assert.equal(await (await next.request(`${file}?v=${previousVersion}`)).text(), previousBytes,
    'an older tab keeps its own module after the new shell is saved');
  assert.ok(await (await next.request(`${file}?v=${currentVersion}`)).text() === currentBytes,
    'the corrected module remains available offline');
});

for (const file of ['app.mjs', 'map-model.mjs']) test(`numeric station search refreshes exact ${file} bytes from the immediate predecessor`, async () => {
  // Exact files from main 79162dff before the numeric-name correction. Keeping
  // these compressed makes this an upgrade regression, not a synthetic version
  // label test; no GitHub or provider access is needed at test time.
  const previous = JSON.parse(gunzipSync(readFileSync(new URL('fixtures/search-numeric-predecessor.json.gz', import.meta.url))));
  assert.equal(previous.commit, '79162dff6808b18461e4c8e33e177ca39effb146');
  assert.equal(previous.version, '20261011-departure-availability-2');
  const previousBytes = previous.files[file].text;
  assert.equal(createHash('sha256').update(previousBytes).digest('hex'), previous.files[file].sha256);
  const currentBytes = readFileSync(new URL(`../styles/${file}`, import.meta.url), 'utf8');
  const page = readFileSync(new URL('../styles/index.html', import.meta.url), 'utf8');
  const currentVersion = page.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(currentVersion);
  assert.notEqual(currentVersion, previous.version);
  const path = new URL(file, scope).pathname;
  const old = startWorker({version: previous.version, assetBodies: new Map([[path, previousBytes]])});
  await bounded(old.lifecycle('install'));
  await old.lifecycle('activate');
  const next = startWorker({version: currentVersion, stores: old.stores, assetBodies: new Map([[path, currentBytes]])});
  await bounded(next.request('./', true));
  assert.equal(await (await next.request(`${file}?v=${currentVersion}`)).text(), currentBytes);
  next.setOffline();
  assert.equal(await (await next.request(`${file}?v=${previous.version}`)).text(), previousBytes);
  assert.equal(await (await next.request(`${file}?v=${currentVersion}`)).text(), currentBytes);
});

for (const file of ['app.mjs', 'departures.mjs']) test(`unmatched timetable reporting refreshes exact ${file} bytes from the immediate predecessor`, async () => {
  // Exact files from main c35d21dc before the unmatched-stop correction. Keeping
  // these compressed makes this an upgrade regression, not a synthetic version
  // label test; no GitHub or provider access is needed at test time.
  const previous = JSON.parse(gunzipSync(readFileSync(new URL('fixtures/departure-unmatched-predecessor.json.gz', import.meta.url))));
  assert.equal(previous.commit, 'c35d21dcf3dabe7499cd11ebd3d4f04127806b23');
  assert.equal(previous.version, '20261011-search-numeric-1');
  const previousBytes = previous.files[file].text;
  assert.equal(createHash('sha256').update(previousBytes).digest('hex'), previous.files[file].sha256);
  const currentBytes = readFileSync(new URL(`../styles/${file}`, import.meta.url), 'utf8');
  const page = readFileSync(new URL('../styles/index.html', import.meta.url), 'utf8');
  const currentVersion = page.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(currentVersion);
  assert.notEqual(currentVersion, previous.version);
  const path = new URL(file, scope).pathname;
  const old = startWorker({version: previous.version, assetBodies: new Map([[path, previousBytes]])});
  await bounded(old.lifecycle('install'));
  await old.lifecycle('activate');
  const next = startWorker({version: currentVersion, stores: old.stores, assetBodies: new Map([[path, currentBytes]])});
  await bounded(next.request('./', true));
  assert.equal(await (await next.request(`${file}?v=${currentVersion}`)).text(), currentBytes);
  next.setOffline();
  assert.equal(await (await next.request(`${file}?v=${previous.version}`)).text(), previousBytes);
  assert.equal(await (await next.request(`${file}?v=${currentVersion}`)).text(), currentBytes);
});

for (const file of ['app.mjs', 'departures.mjs']) test(`malformed departure-board handling refreshes exact ${file} bytes from the immediate predecessor`, async () => {
  // Exact files from main f9bd326 before the board-envelope correction. Keeping
  // these compressed makes this an upgrade regression, not a synthetic version
  // label test; no GitHub or provider access is needed at test time.
  const previous = JSON.parse(gunzipSync(readFileSync(new URL('fixtures/departure-envelope-predecessor.json.gz', import.meta.url))));
  assert.equal(previous.commit, 'f9bd326c6a2a3738daafd36a58a16f9a2251c5a8');
  assert.equal(previous.version, '20261011-departure-match-1');
  const previousBytes = previous.files[file].text;
  assert.equal(createHash('sha256').update(previousBytes).digest('hex'), previous.files[file].sha256);
  const currentBytes = readFileSync(new URL(`../styles/${file}`, import.meta.url), 'utf8');
  const page = readFileSync(new URL('../styles/index.html', import.meta.url), 'utf8');
  const currentVersion = page.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(currentVersion);
  assert.notEqual(currentVersion, previous.version);
  const path = new URL(file, scope).pathname;
  const old = startWorker({version: previous.version, assetBodies: new Map([[path, previousBytes]])});
  await bounded(old.lifecycle('install'));
  await old.lifecycle('activate');
  const next = startWorker({version: currentVersion, stores: old.stores, assetBodies: new Map([[path, currentBytes]])});
  await bounded(next.request('./', true));
  assert.equal(await (await next.request(`${file}?v=${currentVersion}`)).text(), currentBytes);
  next.setOffline();
  assert.equal(await (await next.request(`${file}?v=${previous.version}`)).text(), previousBytes);
  assert.equal(await (await next.request(`${file}?v=${currentVersion}`)).text(), currentBytes);
});

// A small compatibility model, not an archived provider parser. Its only
// contract is the old failure mode: malformed rows are read after boards load.
const cachedUnisolatedDepartureParser = `
export async function stationDepartures(station, {fetch: get}) {
  const stops = await (await get('https://api.transitous.org/api/v1/reverse-geocode')).json();
  const boards = await Promise.all(stops.map(async stop =>
    (await get('https://api.transitous.org/api/v1/stoptimes?stopId=' + stop.id)).json()));
  return {stops, rows: boards.flatMap(board => board.stopTimes).filter(row => row.mode === 'REGIONAL_RAIL')};
}`;
async function cachedDepartureBoard(parserBytes, badFirst = false) {
  const {stationDepartures} = await import('data:text/javascript;base64,' + Buffer.from(parserBytes).toString('base64'));
  const ids = badFirst ? ['bad', 'good'] : ['good', 'bad'], calls = [];
  const departure = new Date(Date.now() + 600000).toISOString();
  const get = async address => {
    const url = new URL(address);
    assert.equal(url.origin, 'https://api.transitous.org');
    if (url.pathname === '/api/v1/reverse-geocode') {
      calls.push('lookup');
      return {ok: true, json: async () => ids.map(id => ({id, type: 'STOP', name: 'Central', lat: 0, lon: 0, modes: ['REGIONAL_RAIL']}))};
    }
    assert.equal(url.pathname, '/api/v1/stoptimes');
    const id = url.searchParams.get('stopId');
    assert.ok(ids.includes(id));calls.push(id);
    return {ok: true, json: async () => ({stopTimes: id === 'bad' ? [null] : [{mode: 'REGIONAL_RAIL', displayName: 'R',
      headsign: 'Terminus', tripId: 'healthy', place: {departure, scheduledDeparture: departure}}]})};
  };
  try {
    const board = await stationDepartures({lat: 0, lon: 0, names: ['Central']}, {fetch: get});
    return {trips: board.rows.map(row => row.tripId), results: board.stopResults};
  } finally {
    assert.deepEqual(calls, ['lookup', ...ids], 'the cached parser uses one lookup and two fixture boards');
  }
}

test('row-isolation release upgrades executable parser offline while old tabs retain their cached behavior', async () => {
  const previousVersion = '20261016-cached-station-failures-1';
  const currentBytes = readFileSync(new URL('../styles/departures.mjs', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../styles/index.html', import.meta.url), 'utf8');
  const currentVersion = page.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(currentVersion);assert.notEqual(currentVersion, previousVersion);
  const path = new URL('departures.mjs', scope).pathname;
  const old = startWorker({version: previousVersion, assetBodies: new Map([[path, cachedUnisolatedDepartureParser]]), rejectExternal: true});
  await bounded(old.lifecycle('install'));await old.lifecycle('activate');
  const get = async (worker, version) => await (await worker.request('departures.mjs?v=' + version)).text();
  const unchanged = startWorker({version: previousVersion, stores: old.stores, assetBodies: new Map([[path, currentBytes]]), rejectExternal: true});
  await bounded(unchanged.request('./', true));
  assert.equal(await get(unchanged, previousVersion), cachedUnisolatedDepartureParser);
  await assert.rejects(cachedDepartureBoard(await get(unchanged, previousVersion)), TypeError,
    'an unchanged release token must expose the old cached failure, not execute network bytes');
  const next = startWorker({version: currentVersion, stores: old.stores, assetBodies: new Map([[path, currentBytes]]), rejectExternal: true});
  await bounded(next.request('./', true));next.setOffline();
  assert.equal(await get(next, currentVersion), currentBytes);
  for (const badFirst of [false, true]) {
    const ids = badFirst ? ['bad', 'good'] : ['good', 'bad'];
    assert.deepEqual(await cachedDepartureBoard(await get(next, currentVersion), badFirst), {
      trips: ['healthy'], results: ids.map(stopId => ({stopId, status: stopId === 'bad' ? 'rejected' : 'fulfilled'}))
    });
  }
  assert.equal(await get(next, previousVersion), cachedUnisolatedDepartureParser);
  await assert.rejects(cachedDepartureBoard(await get(next, previousVersion)), TypeError);
  assert.equal(next.requests.filter(url => url === scope + 'departures.mjs?v=' + currentVersion).length, 1);
  assert.ok(next.requests.every(url => new URL(url).origin === new URL(scope).origin));
});

for (const file of ['app.mjs', 'departures.mjs']) test(`exact departure instants refreshes exact ${file} bytes from the immediate predecessor`, async () => {
  // Exact files from main f9bd326c before the exact-instant correction. Keeping
  // these compressed makes this an upgrade regression, not a synthetic version
  // label test; no GitHub or provider access is needed at test time.
  const previous = JSON.parse(gunzipSync(readFileSync(new URL('fixtures/departure-instant-predecessor.json.gz', import.meta.url))));
  assert.equal(previous.commit, 'f9bd326c6a2a3738daafd36a58a16f9a2251c5a8');
  assert.equal(previous.version, '20261011-departure-match-1');
  const previousBytes = previous.files[file].text;
  assert.equal(createHash('sha256').update(previousBytes).digest('hex'), previous.files[file].sha256);
  const currentBytes = readFileSync(new URL(`../styles/${file}`, import.meta.url), 'utf8');
  const page = readFileSync(new URL('../styles/index.html', import.meta.url), 'utf8');
  const currentVersion = page.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(currentVersion);
  assert.notEqual(currentVersion, previous.version);
  const path = new URL(file, scope).pathname;
  const old = startWorker({version: previous.version, assetBodies: new Map([[path, previousBytes]])});
  await bounded(old.lifecycle('install'));
  await old.lifecycle('activate');
  const next = startWorker({version: currentVersion, stores: old.stores, assetBodies: new Map([[path, currentBytes]])});
  await bounded(next.request('./', true));
  assert.equal(await (await next.request(`${file}?v=${currentVersion}`)).text(), currentBytes);
  next.setOffline();
  assert.equal(await (await next.request(`${file}?v=${previous.version}`)).text(), previousBytes);
  assert.equal(await (await next.request(`${file}?v=${currentVersion}`)).text(), currentBytes);
});

for (const file of ['app.mjs', 'departures.mjs']) test(`integrated departure instants refreshes exact ${file} bytes from the immediate predecessor`, async () => {
  // Exact files from main 370bcfb1 after the board-envelope correction. Keeping
  // these compressed makes this an upgrade regression, not a synthetic version
  // label test; no GitHub or provider access is needed at test time.
  const previous = JSON.parse(gunzipSync(readFileSync(new URL('fixtures/departure-instant-envelope-predecessor.json.gz', import.meta.url))));
  assert.equal(previous.commit, '370bcfb1db684d80520ea43430e1cbb5bdb360dd');
  assert.equal(previous.version, '20261011-departure-envelope-1');
  const previousBytes = previous.files[file].text;
  assert.equal(createHash('sha256').update(previousBytes).digest('hex'), previous.files[file].sha256);
  const currentBytes = readFileSync(new URL(`../styles/${file}`, import.meta.url), 'utf8');
  const page = readFileSync(new URL('../styles/index.html', import.meta.url), 'utf8');
  const currentVersion = page.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(currentVersion);
  assert.notEqual(currentVersion, previous.version);
  const path = new URL(file, scope).pathname;
  const old = startWorker({version: previous.version, assetBodies: new Map([[path, previousBytes]])});
  await bounded(old.lifecycle('install'));
  await old.lifecycle('activate');
  const next = startWorker({version: currentVersion, stores: old.stores, assetBodies: new Map([[path, currentBytes]])});
  await bounded(next.request('./', true));
  assert.equal(await (await next.request(`${file}?v=${currentVersion}`)).text(), currentBytes);
  next.setOffline();
  assert.equal(await (await next.request(`${file}?v=${previous.version}`)).text(), previousBytes);
  assert.equal(await (await next.request(`${file}?v=${currentVersion}`)).text(), currentBytes);
});
for (const file of ['app.mjs']) test(`search availability wording refreshes exact ${file} bytes from the immediate predecessor`, async () => {
  // Exact files from main dea9f68e before the search availability correction. Keeping
  // these compressed makes this an upgrade regression, not a synthetic version
  // label test; no GitHub or provider access is needed at test time.
  const previous = JSON.parse(gunzipSync(readFileSync(new URL('fixtures/search-availability-predecessor.json.gz', import.meta.url))));
  assert.equal(previous.commit, 'dea9f68e9d4c585c29ff225c4c052e689dac849b');
  assert.equal(previous.version, '20261012-departure-instant-2');
  const previousBytes = previous.files[file].text;
  assert.equal(createHash('sha256').update(previousBytes).digest('hex'), previous.files[file].sha256);
  const currentBytes = readFileSync(new URL(`../styles/${file}`, import.meta.url), 'utf8');
  const page = readFileSync(new URL('../styles/index.html', import.meta.url), 'utf8');
  const currentVersion = page.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(currentVersion);
  assert.notEqual(currentVersion, previous.version);
  const path = new URL(file, scope).pathname;
  const old = startWorker({version: previous.version, assetBodies: new Map([[path, previousBytes]])});
  await bounded(old.lifecycle('install'));
  await old.lifecycle('activate');
  const next = startWorker({version: currentVersion, stores: old.stores, assetBodies: new Map([[path, currentBytes]])});
  await bounded(next.request('./', true));
  assert.equal(await (await next.request(`${file}?v=${currentVersion}`)).text(), currentBytes);
  next.setOffline();
  assert.equal(await (await next.request(`${file}?v=${previous.version}`)).text(), previousBytes);
  assert.equal(await (await next.request(`${file}?v=${currentVersion}`)).text(), currentBytes);
});

test('first-party libraries install together and remain available offline with every external origin blocked', async () => {
  const worker = startWorker({rejectExternal: true});
  await bounded(worker.lifecycle('install'));
  await worker.lifecycle('activate');
  assert.ok(worker.requests.every(url => new URL(url).origin === new URL(scope).origin));
  worker.setOffline();
  for (const path of ['vendor/maplibre-gl-5.24.0-atlas.1.js', 'vendor/maplibre-gl-5.24.0.css', 'vendor/pmtiles-4.2.1.js']) {
    const expected=path.endsWith('-atlas.1.js')?patchedMapLibre.toString('utf8'):`new: ${scope}${path}?v=new`;
    assert.equal(await (await worker.request(path)).text(), expected);
    assert.equal(await (await worker.request(path+'?v=new')).text(), expected);
  }
});

test('actual CDN-era worker copies remain usable after first-party migration without new CDN requests', async () => {
  const oldCode = readFileSync(new URL('fixtures/sw-before-first-party-libraries.js', import.meta.url), 'utf8');
  const oldGeneration = Number(oldCode.match(/CACHE = `\$\{PREFIX\}(\d+)`/)[1]);
  const old = startWorker({version: 'old', code: oldCode});
  await bounded(old.lifecycle('install'));
  await old.lifecycle('activate');
  const oldLibraries = old.requests.filter(url => new URL(url).origin !== new URL(scope).origin);
  assert.equal(oldLibraries.length, 3, 'fixture really uses the three old CDN assets');
  const next = startWorker({version: 'new', stores: old.stores, rejectExternal: true});
  await bounded(next.lifecycle('install'));
  await next.lifecycle('activate');
  assert.equal(next.stores.has(`atlas-shell-${oldGeneration}`), false);
  next.setOffline();
  assert.equal(await (await next.request('app.mjs?v=old')).text(), `old: ${scope}app.mjs?v=old`);
  for (const url of oldLibraries) {
    const expected=url.includes('/maplibre-gl@')&&url.endsWith('.js')?patchedMapLibre:legacyDistributions.get(url).body;
    assert.deepEqual(Buffer.from(await (await next.request(url)).arrayBuffer()),expected);
  }
  assert.ok(next.requests.every(url => new URL(url).origin === new URL(scope).origin));
});

test('an old CDN JS URL receives the fixed library even without a legacy cache entry', async () => {
  const worker = startWorker({rejectExternal: true});
  await bounded(worker.lifecycle('install'));
  const before = worker.requests.length;
  const response = await worker.request('https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),patchedMapLibre);
  assert.equal(worker.requests.length, before);
});

for(const mode of ['tampered-bytes','crypto-unavailable'])test(`legacy cache migration and serving reject ${mode} with otherwise valid responses`,async()=>{
  const oldCode=readFileSync(new URL('fixtures/sw-before-first-party-libraries.js',import.meta.url),'utf8');
  const old=startWorker({version:'old',code:oldCode});
  await bounded(old.lifecycle('install'));
  const oldGeneration=Number(oldCode.match(/CACHE = `\$\{PREFIX\}(\d+)`/)[1]);
  const copies=[...legacyDistributions].map(([url,{body,type}])=>[url,new Response(
    mode==='tampered-bytes'?Buffer.concat([body,Buffer.from('\n/* changed bytes */')]):body,
    {status:200,headers:{'content-type':type}},
  )]);
  for(const [url,response] of copies)old.stores.get(`atlas-shell-${oldGeneration}`).set(url,response.clone());
  const next=startWorker({stores:old.stores,rejectExternal:true,noLegacyCrypto:mode==='crypto-unavailable'});
  await bounded(next.lifecycle('install'));
  const current=next.stores.get(`atlas-shell-${generation}`);
  for(const [url,response] of copies){
    assert.equal(current.has(url),false,'unverified legacy bytes must not migrate into the new cache');
    // Also cover a previously poisoned entry already in the active cache.
    current.set(url,response.clone());
    const servedResponse=await next.request(url);
    if(url.includes('/maplibre-gl@')&&url.endsWith('.js')&&mode!=='crypto-unavailable')
      assert.deepEqual(Buffer.from(await servedResponse.arrayBuffer()),patchedMapLibre,'original JS cache poison is ignored in favour of the installed fixed library');
    else assert.equal(servedResponse.type,'error','serving must validate again before exposing the response');
  }
  next.setOffline();
  assert.deepEqual(Buffer.from(await(await next.request('vendor/maplibre-gl-5.24.0-atlas.1.js')).arrayBuffer()),patchedMapLibre,'first-party installation remains independent of legacy recovery');
  assert.ok(next.requests.every(url=>new URL(url).origin===new URL(scope).origin));
});


test('actual first-party worker migration serves fixed bytes to delayed old tabs',async()=>{
  const oldCode=readFileSync(new URL('fixtures/sw-before-maplibre-backport.js',import.meta.url),'utf8');
  const old=startWorker({version:'old',code:oldCode});
  await bounded(old.lifecycle('install')); await old.lifecycle('activate');
  const next=startWorker({version:'new',stores:old.stores,rejectExternal:true});
  await bounded(next.lifecycle('install')); await next.lifecycle('activate');
  assert.equal(next.stores.has('atlas-shell-23'),false);
  next.setOffline();
  for(const path of ['vendor/maplibre-gl-5.24.0.js','vendor/maplibre-gl-5.24.0.js?v=old','vendor/maplibre-gl-5.24.0-atlas.1.js'])
    assert.deepEqual(Buffer.from(await (await next.request(path)).arrayBuffer()),patchedMapLibre);
  assert.equal(await (await next.request('app.mjs?v=old')).text(),`old: ${scope}app.mjs?v=old`);
  assert.ok(next.requests.every(url=>new URL(url).origin===new URL(scope).origin));
  const cache=next.stores.get(`atlas-shell-${generation}`);
  assert.ok(![...cache.keys()].some(url=>url.startsWith(scope+'vendor/maplibre-gl-5.24.0.js')),'original executable JS is not migrated');
  cache.set(scope+'vendor/maplibre-gl-5.24.0-atlas.1.js',new Response(Buffer.concat([patchedMapLibre,Buffer.from(' ')]),{headers:{'content-type':'text/javascript'}}));
  assert.equal((await next.request('vendor/maplibre-gl-5.24.0.js')).type,'error','modified legacy first-party bytes must not execute');
});

test('legend overflow release replaces cached CSS while keeping the preceding page coherent',async()=>{
  const previous='20261016-departure-destination-2';
  const html=readFileSync(new URL('../styles/index.html',import.meta.url),'utf8');
  const version=html.match(/src="app\.mjs\?v=([\w.-]+)"/)[1];
  assert.notEqual(version,previous,'changed layout requires a fresh cache-first asset version');
  const path=new URL('app.css',scope).pathname;
  const css=readFileSync(new URL('../styles/app.css',import.meta.url),'utf8');
  const oldCss='/* synthetic preceding cached layout */';
  const old=startWorker({version:previous,assetBodies:new Map([[path,oldCss]]),rejectExternal:true});
  await bounded(old.lifecycle('install'));await old.lifecycle('activate');
  const unchanged=startWorker({version:previous,stores:old.stores,assetBodies:new Map([[path,css]]),rejectExternal:true});
  await bounded(unchanged.request('./',true));
  assert.equal(await(await unchanged.request(`app.css?v=${previous}`)).text(),oldCss,'reusing the old token really retains the preceding CSS');
  const next=startWorker({version,stores:old.stores,assetBodies:new Map([[path,css]]),rejectExternal:true});
  await bounded(next.request('./',true));next.setOffline();
  assert.equal(await(await next.request(`app.css?v=${version}`)).text(),css);
  assert.equal(await(await next.request(`app.css?v=${previous}`)).text(),oldCss,'older open pages keep their own CSS');
  assert.ok(next.requests.includes(`${scope}app.css?v=${version}`));
});

// The preceding release already cached app/CSS/module bytes under this token.
// New point samples must reach installed users without reusing those line keys.
test('Power legend release upgrades the cached app, CSS and facility metadata together',async()=>{
  const previous='20261011-departure-labels-1';
  const html=readFileSync(new URL('../styles/index.html',import.meta.url),'utf8');
  const version=html.match(/src="app\.mjs\?v=([\w.-]+)"/)[1];
  assert.notEqual(version,previous,'changed legend bytes require a new release token');
  const paths=['app.mjs','app.css','power-facilities.mjs'];
  const assetBodies=new Map(paths.map(path=>[new URL(path,scope).pathname,readFileSync(new URL(`../styles/${path}`,import.meta.url),'utf8')]));
  const old=startWorker({version:previous,assetBodies:new Map(paths.map(path=>[new URL(path,scope).pathname,`previous line-swatch ${path}`]))});
  await bounded(old.lifecycle('install'));await old.lifecycle('activate');
  const next=startWorker({version,stores:old.stores,assetBodies,rejectExternal:true});
  // sw.js is unchanged: an already installed worker learns the new shell
  // through navigation/saveVersion, without a replacement-worker install.
  await bounded(next.request('./',true));next.setOffline();
  for (const path of paths) {
    assert.equal(await(await next.request(`${path}?v=${version}`)).text(),assetBodies.get(new URL(path,scope).pathname));
    assert.equal(await(await next.request(`${path}?v=${previous}`)).text(),`previous line-swatch ${path}`,'old tabs retain coherent old bytes');
    assert.ok(next.requests.includes(`${scope}${path}?v=${version}`),'the new version actually fetched replacement bytes');
  }
  assert.match(await(await next.request('./',true)).text(),new RegExp(version));
});

test('station crossing release replaces cached style bytes while previous tabs stay coherent',async()=>{
  const previous='20261015-service-status-1';
  const html=readFileSync(new URL('../styles/index.html',import.meta.url),'utf8');
  const version=html.match(/src="app\.mjs\?v=([\w.-]+)"/)[1];
  assert.notEqual(version,previous,'the changed style needs a fresh cache-first asset version');
  const paths=['app.mjs','world.style.json'];
  const current=new Map(paths.map(path=>[new URL(path,scope).pathname,
    readFileSync(new URL('../styles/'+path,import.meta.url),'utf8')]));
  const style=JSON.parse(current.get(new URL('world.style.json',scope).pathname));
  for(const id of ['place_label_city','place_label_other','state_label'])
    assert.ok(style.layers.some(layer=>layer.id===id+'-placement'),'the new cached style contains the placement fix');
  // Compact cache payloads model the previous token; they are not archived
  // production source. The new app/style payloads above are exact built inputs.
  const oldBodies=new Map(paths.map(path=>[new URL(path,scope).pathname,'previous cached '+path]));
  const old=startWorker({version:previous,assetBodies:oldBodies,rejectExternal:true});
  await bounded(old.lifecycle('install'));await old.lifecycle('activate');

  // Negative control: deploying new bytes under the old token really leaves
  // the cached style unchanged, reproducing the reviewed delivery defect.
  const unchanged=startWorker({version:previous,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(unchanged.request('./',true));
  for(const path of paths)
    assert.equal(await(await unchanged.request(path+'?v='+previous)).text(),oldBodies.get(new URL(path,scope).pathname));

  // Same actual worker/cache generation, normal navigation, no cache purge.
  const next=startWorker({version,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(next.request('./',true));next.setOffline();
  for(const path of paths){
    assert.equal(await(await next.request(path+'?v='+version)).text(),current.get(new URL(path,scope).pathname));
    assert.equal(await(await next.request(path+'?v='+previous)).text(),oldBodies.get(new URL(path,scope).pathname));
    assert.equal(next.requests.filter(url=>url===scope+path+'?v='+version).length,1);
  }
  assert.match(await(await next.request('./',true)).text(),new RegExp(version));
  assert.ok(next.requests.every(url=>new URL(url).origin===new URL(scope).origin));
});

test('hidden-mask release refreshes the app and executable guard through the existing worker',async()=>{
  const previous='20261015-station-mask-lifecycle-1';
  const version=readFileSync(new URL('../styles/index.html',import.meta.url),'utf8').match(/src="app\.mjs\?v=([\w.-]+)"/)[1];
  assert.notEqual(version,previous);
  const paths=['app.mjs','map-controls.mjs'];
  const current=new Map(paths.map(path=>[new URL(path,scope).pathname,readFileSync(new URL('../styles/'+path,import.meta.url),'utf8')]));
  const oldBodies=new Map(paths.map(path=>[new URL(path,scope).pathname,'previous cached '+path]));
  const old=startWorker({version:previous,assetBodies:oldBodies,rejectExternal:true});
  await bounded(old.lifecycle('install'));await old.lifecycle('activate');
  const unchanged=startWorker({version:previous,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(unchanged.request('./',true));
  assert.equal(await(await unchanged.request('map-controls.mjs?v='+previous)).text(),oldBodies.get(new URL('map-controls.mjs',scope).pathname),'unchanged-token sensitivity control retains the old guard module');
  const next=startWorker({version,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(next.request('./',true));next.setOffline();
  for(const path of paths){
    assert.equal(await(await next.request(path+'?v='+version)).text(),current.get(new URL(path,scope).pathname));
    assert.equal(await(await next.request(path+'?v='+previous)).text(),oldBodies.get(new URL(path,scope).pathname));
  }
  const cached=await(await next.request('map-controls.mjs?v='+version)).text();
  const {installHiddenTileMaskGuard}=await import('data:text/javascript;base64,'+Buffer.from(cached).toString('base64'));
  let calls=0;const map={painter:{transform:{zoom:9},_renderTileClippingMasks(){calls++;}}};
  installHiddenTileMaskGuard(map);map.painter._renderTileClippingMasks({isHidden:()=>true});assert.equal(calls,0);
  map.painter._renderTileClippingMasks({isHidden:()=>false});assert.equal(calls,1);
});

test('Power presentation upgrades a compact old module graph without mixing cached releases',async()=>{
  // These are deliberately synthetic compatibility responses, not archived
  // application sources. Exact historical bytes remain in immutable Git refs.
  const previous='20261016-departure-row-isolation-2';
  const paths=['app.mjs','cjk-font.mjs','departures-ui.mjs','departures.mjs','elevation.mjs','layer-semantics.mjs','map-model.mjs','power-facilities.mjs'];
  const oldBodies=new Map(paths.map(file=>[new URL(file,scope).pathname,`export const previousModule=${JSON.stringify(file)};`]));
  oldBodies.set(new URL('app.mjs',scope).pathname,`export {powerFacilityName} from './power-facilities.mjs?v=${previous}'; export {previousModule} from './departures.mjs?v=${previous}';`);
  oldBodies.set(new URL('power-facilities.mjs',scope).pathname,'export function powerFacilityName(){return "Steam locomotive water tank";}');
  assert.ok([...oldBodies.values()].join('').length<1024,'keep the old compatibility graph focused');
  const html=readFileSync(new URL('../styles/index.html',import.meta.url),'utf8');
  const version=html.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(version);assert.notEqual(version,previous,'changed Power bytes need a fresh cache-first version');
  const current=new Map(paths.map(file=>[new URL(file,scope).pathname,readFileSync(new URL('../styles/'+file,import.meta.url),'utf8')]));
  let references=0;
  for(const file of ['index.html','data-check.html','data-check.mjs',...paths]){
    const body=readFileSync(new URL('../styles/'+file,import.meta.url),'utf8');
    for(const match of body.matchAll(/(?:\.mjs|\.css)\?v=([\w.-]+)/g)){
      assert.equal(match[1],version,`${file}: entrypoint and transitive modules share one release`);references++;
    }
  }
  assert.ok(references>=30,'covers the current versioned module graph');
  const old=startWorker({version:previous,assetBodies:oldBodies,rejectExternal:true});
  await bounded(old.lifecycle('install'));await old.lifecycle('activate');
  const cacheNames=[...old.stores.keys()];
  const unchanged=startWorker({version:previous,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(unchanged.request('./',true));
  for(const [path,body] of oldBodies){
    assert.equal(await(await unchanged.request(path+'?v='+previous)).text(),body);
    assert.equal(unchanged.requests.filter(url=>new URL(url).pathname===path).length,0,'reusing a version retains stale cached bytes');
  }
  const evaluate=async code=>{const module=new vm.SourceTextModule(code);await module.link(()=>{throw new Error('unexpected module dependency');});await module.evaluate();return module.namespace;};
  const storage={power_kind:'water_tank',man_made:'storage_tank',content:'water',usage:'railway'};
  const stale=await evaluate(await(await unchanged.request('power-facilities.mjs?v='+previous)).text());
  assert.equal(stale.powerFacilityName(storage),'Steam locomotive water tank');
  assert.equal(stale.powerFacilityEnergyRows,undefined);
  const next=startWorker({version,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(next.request('./',true));next.setOffline();
  for(const [path,body] of current){
    assert.equal(await(await next.request(path+'?v='+version)).text(),body,'new tabs receive exact current bytes offline');
    assert.equal(await(await next.request(path+'?v='+previous)).text(),oldBodies.get(path),'older tabs retain their own saved modules');
    assert.equal(next.requests.filter(url=>url===new URL(path,scope).href+'?v='+version).length,1);
  }
  // Execute the old entrypoint and its transitive imports after the upgrade.
  const modules=new Map();
  const oldModule=async url=>{
    const parsed=new URL(url,scope);assert.equal(parsed.searchParams.get('v'),previous);
    assert.ok(oldBodies.has(parsed.pathname),'the old entrypoint cannot import an unrelated module');
    if(!modules.has(parsed.href))modules.set(parsed.href,new vm.SourceTextModule(await(await next.request(parsed.href)).text(),{identifier:parsed.href}));
    return modules.get(parsed.href);
  };
  const oldApp=await oldModule('app.mjs?v='+previous);
  await oldApp.link((specifier,referrer)=>oldModule(new URL(specifier,referrer.identifier).href));await oldApp.evaluate();
  assert.equal(oldApp.namespace.powerFacilityName(storage),'Steam locomotive water tank');
  assert.equal(oldApp.namespace.previousModule,'departures.mjs');
  const fixed=await evaluate(await(await next.request('power-facilities.mjs?v='+version)).text());
  assert.equal(fixed.powerFacilityName(storage),'Railway water tank');
  assert.deepEqual(Object.fromEntries(fixed.powerFacilityEnergyRows({'fuel:adblue':'yes','plant:source':'solar'})),{'Recorded supplies':'adblue','Fuel tags':'fuel:adblue=yes','Plant energy source':'solar'});
  // Exercise the actual cached parser with a malformed sibling, not a dated
  // source hash: future compatible parser improvements must remain allowed.
  const departures=await evaluate(await(await next.request('departures.mjs?v='+version)).text());
  const observation={mode:'REGIONAL_RAIL',displayName:'R7',headsign:'Harbour',place:{departure:'2099-01-01T12:00:00Z'}};
  const board=await departures.stationDepartures({lat:0,lon:0,names:['Central']},{fetch:async url=>({ok:true,json:async()=>url.includes('/reverse-geocode')
    ? ['a','b'].map(id=>({type:'STOP',id,name:'Central',lat:0,lon:0,modes:['REGIONAL_RAIL']}))
    : {stopTimes:new URL(url).searchParams.get('stopId')==='a'?[observation]:[null]}})});
  assert.deepEqual(Object.fromEntries(board.stopResults.map(result=>[result.stopId,result.status])),{a:'fulfilled',b:'rejected'});
  assert.equal(board.rows.length,1);assert.equal(board.rows[0].line,'R7');
  assert.deepEqual([...next.stores.keys()],cacheNames,'no cache purge or generation change');
  assert.deepEqual(await next.stores.get(`atlas-shell-${generation}`).get(scope+'__versions').clone().json(),[version,previous]);
  assert.ok(next.requests.every(url=>new URL(url).origin===new URL(scope).origin));
});

test('world-copy recovery release coordinates entrypoint and transitive module versions',()=>{
  const root=new URL('../styles/',import.meta.url),html=readFileSync(new URL('index.html',root),'utf8');
  const version=html.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(version);assert.notEqual(version,'20261015-service-relations-1');
  let references=0;
  for(const file of readdirSync(root).filter(file=>/\.(mjs|html)$/.test(file))){
    const code=readFileSync(new URL(file,root),'utf8');
    for(const match of code.matchAll(/\?v=([0-9][\w.-]*)/g)){
      assert.equal(match[1],version,`${file}: cached imports must use the page's complete shell`);references++;
    }
  }
  assert.ok(references>=30,'covers direct and transitive versioned entrypoints');
  const app=readFileSync(new URL('app.mjs',root),'utf8');
  assert.equal(app.match(/const assetVersion[^\n]+\|\| '([^']+)'/)?.[1],version,'lazy modules, styles and worker URLs inherit this version');
  assert.ok(app.includes(`./rail-provider-recovery.mjs?v=${version}`));
  assert.match(source,/'rail-provider-recovery\.mjs'/,'the actual worker saves recovery with the complete shell');
});

async function cachedWorldCopyRecovery(moduleBytes){
  // Execute the bytes actually returned by Cache Storage, without a provider
  // or renderer request. The original bug erased the unresolved first copy.
  const {createRailProviderRecovery}=await import('data:text/javascript;base64,'+Buffer.from(moduleBytes).toString('base64'));
  const timers=new Map(),reloads=[],source={url:'https://openrailwaymap.app/railway_line_high'};let sequence=0;
  const recovery=createRailProviderRecovery({getSource:()=>source,refreshTiles:(id,tiles)=>reloads.push({id,tiles})},{
    active:()=>true,setTimer:(fn,delay)=>{timers.set(++sequence,{fn,delay});return sequence;},clearTimer:id=>timers.delete(id),
  });
  try{
    const copies=[0,1].map(wrap=>({state:'errored',tileID:{wrap,canonical:{z:7,x:1,y:2}}}));
    for(const tile of copies)recovery.noteError({sourceId:'railway',tile,error:{status:520}});
    copies[1].state='loaded';recovery.noteSourceData({sourceId:'railway',tile:copies[1]});
    const pendingAfterSiblingSuccess=recovery.hasFailures();
    if(timers.size){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();}
    copies[0].state='loaded';recovery.noteSourceData({sourceId:'railway',tile:copies[0]});
    assert.equal(recovery.hasFailures(),false);assert.equal(timers.size,0);
    return {pendingAfterSiblingSuccess,reloads};
  }finally{recovery.dispose();}
}

test('world-copy recovery release upgrades cached app and exact recovery bytes on online navigation',async()=>{
  const previous=JSON.parse(gunzipSync(readFileSync(new URL('fixtures/world-copy-recovery-predecessor.json.gz',import.meta.url))));
  assert.equal(previous.commit,'4d44db85a61d956d81d51549ffb5310085f2265c');
  assert.equal(previous.version,'20261015-service-relations-1');
  const html=readFileSync(new URL('../styles/index.html',import.meta.url),'utf8');
  const version=html.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(version);assert.notEqual(version,previous.version,'changed recovery bytes require a fresh cache-first version');
  const paths=['app.mjs','rail-provider-recovery.mjs'],oldBodies=new Map(),current=new Map();
  for(const path of paths){
    const old=previous.files[path];
    if(old)assert.equal(createHash('sha256').update(old.text).digest('hex'),old.sha256);
    // Only recovery needs an exact historical payload for execution below.
    // The old app entry is a compact synthetic cache marker, not an archive.
    const previousBytes=old?.text??'export const previousApp = "20261015-service-relations-1";';
    oldBodies.set(new URL(path,scope).pathname,previousBytes);
    current.set(new URL(path,scope).pathname,readFileSync(new URL('../styles/'+path,import.meta.url),'utf8'));
    assert.notEqual(current.get(new URL(path,scope).pathname),previousBytes,'current bytes differ from the previous cache entry');
  }
  const old=startWorker({version:previous.version,assetBodies:oldBodies,rejectExternal:true});
  await bounded(old.lifecycle('install'));await old.lifecycle('activate');
  const originalCaches=[...old.stores.keys()];

  // Negative control: new deployment bytes under the previous token continue
  // to serve the cached predecessor, including its broken recovery behavior.
  const unchanged=startWorker({version:previous.version,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(unchanged.request('./',true));
  for(const path of paths){
    assert.equal(await(await unchanged.request(path+'?v='+previous.version)).text(),oldBodies.get(new URL(path,scope).pathname));
    assert.equal(unchanged.requests.filter(url=>new URL(url).pathname===new URL(path,scope).pathname).length,0);
  }
  const stale=await(await unchanged.request('rail-provider-recovery.mjs?v='+previous.version)).text();
  assert.deepEqual(await cachedWorldCopyRecovery(stale),{pendingAfterSiblingSuccess:false,reloads:[]});

  // The existing worker learns the complete new shell during navigation. No
  // worker replacement, cache purge or generation bump is needed.
  const next=startWorker({version,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(next.request('./',true));next.setOffline();
  for(const path of paths){
    assert.equal(await(await next.request(path+'?v='+version)).text(),current.get(new URL(path,scope).pathname));
    assert.equal(await(await next.request(path+'?v='+previous.version)).text(),oldBodies.get(new URL(path,scope).pathname),'previous tabs retain their saved version offline');
    assert.equal(next.requests.filter(url=>url===scope+path+'?v='+version).length,1);
  }
  const served=await(await next.request('rail-provider-recovery.mjs?v='+version)).text();
  assert.deepEqual(await cachedWorldCopyRecovery(served),{pendingAfterSiblingSuccess:true,reloads:[{id:'railway',tiles:[{z:7,x:1,y:2}]}]});
  assert.deepEqual([...next.stores.keys()],originalCaches,'same worker cache generation');
  const versions=await next.stores.get(`atlas-shell-${generation}`).get(scope+'__versions').clone().json();
  assert.deepEqual(versions,[version,previous.version]);
  assert.match(await(await next.request('./',true)).text(),new RegExp(version));
  assert.ok(next.requests.every(url=>new URL(url).origin===new URL(scope).origin));
});

async function cachedStationReturn(fallbackBytes,recoveryBytes){
  const load=bytes=>import('data:text/javascript;base64,'+Buffer.from(bytes).toString('base64'));
  const [{createStationFallbackState},{createRailProviderRecovery}]=await Promise.all([load(fallbackBytes),load(recoveryBytes)]);
  const source={url:'atlasstation://en/https://openrailwaymap.app/standard_railway_text_stations',maxzoom:16};
  const tile={state:'errored',tileID:{wrap:0,canonical:{z:10,x:518,y:352}}};let tiles=[tile];
  const map={getSource:()=>source,getZoom:()=>10,style:{tileManagers:{stations:{getSource:()=>source,getIds:()=>tiles.map((_,i)=>i),getTileByID:i=>tiles[i]}}}};
  const state=createStationFallbackState(map),timers=new Set();
  const recovery=createRailProviderRecovery(map,{setTimer:fn=>{timers.add(fn);return fn;},clearTimer:fn=>timers.delete(fn)});
  try{
    const event={sourceId:'stations',tile,error:{status:503}};state.noteError(event);recovery.noteError(event);
    assert.ok(state.area(10));assert.equal(recovery.hasFailures(),true);
    tiles=[];assert.equal(state.area(10),null);recovery.wake();assert.equal(recovery.hasFailures(),false);
    tiles=[tile];recovery.wake();
    return {fallback:Boolean(state.area(10)),retry:recovery.hasFailures(),timer:timers.size};
  }finally{recovery.dispose();}
}

test('cached station release upgrades executable fallback and retry bytes while preserving old tabs',async()=>{
  // A minimal executable old-shell model tests the cache compatibility contract;
  // tests/station-fallback-cache.test.mjs exercises the actual pinned renderer
  // and current modules. No historical application bundle is shipped here.
  const previous=cachedStationCompatibility;
  const version=readFileSync(new URL('../styles/index.html',import.meta.url),'utf8').match(/src="app\.mjs\?v=([\w.-]+)"/)[1];
  assert.notEqual(version,previous.version);
  const paths=['app.mjs','station-fallback.mjs','rail-provider-recovery.mjs'],oldBodies=new Map(),current=new Map();
  for(const path of paths){
    oldBodies.set(new URL(path,scope).pathname,previous.files[path]);
    current.set(new URL(path,scope).pathname,readFileSync(new URL('../styles/'+path,import.meta.url),'utf8'));
  }
  const old=startWorker({version:previous.version,assetBodies:oldBodies,rejectExternal:true});
  await bounded(old.lifecycle('install'));await old.lifecycle('activate');
  const originalCaches=[...old.stores.keys()];
  const unchanged=startWorker({version:previous.version,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(unchanged.request('./',true));
  const get=async(worker,path,token)=>await(await worker.request(path+'?v='+token)).text();
  for(const path of paths){
    assert.equal(await get(unchanged,path,previous.version),oldBodies.get(new URL(path,scope).pathname));
    assert.equal(unchanged.requests.filter(url=>new URL(url).pathname===new URL(path,scope).pathname).length,0);
  }
  assert.deepEqual(await cachedStationReturn(await get(unchanged,'station-fallback.mjs',previous.version),
    await get(unchanged,'rail-provider-recovery.mjs',previous.version)),{fallback:false,retry:false,timer:0},'unchanged-token control executes the old-shell compatibility model');
  const next=startWorker({version,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(next.request('./',true));next.setOffline();
  for(const path of paths){
    assert.equal(await get(next,path,version),current.get(new URL(path,scope).pathname));
    assert.equal(await get(next,path,previous.version),oldBodies.get(new URL(path,scope).pathname));
    assert.equal(next.requests.filter(url=>url===scope+path+'?v='+version).length,1);
  }
  assert.deepEqual(await cachedStationReturn(await get(next,'station-fallback.mjs',version),
    await get(next,'rail-provider-recovery.mjs',version)),{fallback:true,retry:true,timer:1});
  assert.deepEqual([...next.stores.keys()],originalCaches,'upgrade retains the worker cache generation');
  const versions=await next.stores.get(`atlas-shell-${generation}`).get(scope+'__versions').clone().json();
  assert.deepEqual(versions,[version,previous.version]);
  assert.ok(next.requests.every(url=>new URL(url).origin===new URL(scope).origin));
});

test('destination identity upgrades a compact old module graph and keeps current row ownership offline',async()=>{
  // Synthetic compatibility responses model the old token's cached graph;
  // they are not archived production source or historical-behavior evidence.
  const previous='20261016-power-meaning-3';
  const paths=['app.mjs','cjk-font.mjs','departures-ui.mjs','departures.mjs','elevation.mjs','layer-semantics.mjs','map-model.mjs','power-facilities.mjs'];
  const oldBodies=new Map(paths.map(file=>[new URL(file,scope).pathname,`export const previousModule=${JSON.stringify(file)};`]));
  oldBodies.set(new URL('app.mjs',scope).pathname,`export {previousModule as departures} from './departures.mjs?v=${previous}'; export {previousModule as power} from './power-facilities.mjs?v=${previous}';`);
  assert.ok([...oldBodies.values()].join('').length<1024,'keep the synthetic compatibility graph focused');
  const html=readFileSync(new URL('../styles/index.html',import.meta.url),'utf8');
  const version=html.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(version);assert.notEqual(version,previous,'changed destination bytes require a new cache-first release');
  const current=new Map(paths.map(file=>[new URL(file,scope).pathname,readFileSync(new URL('../styles/'+file,import.meta.url),'utf8')]));
  let references=0;
  for(const file of ['index.html','data-check.html','data-check.mjs',...paths]){
    const body=readFileSync(new URL('../styles/'+file,import.meta.url),'utf8');
    for(const match of body.matchAll(/(?:\.mjs|\.css)\?v=([\w.-]+)/g)){
      assert.equal(match[1],version,`${file}: entrypoint and transitive imports use the current release`);references++;
    }
  }
  assert.ok(references>=30,'covers the current versioned module graph');
  const old=startWorker({version:previous,assetBodies:oldBodies,rejectExternal:true});
  await bounded(old.lifecycle('install'));await old.lifecycle('activate');
  const cacheNames=[...old.stores.keys()];
  const unchanged=startWorker({version:previous,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(unchanged.request('./',true));
  for(const [path,body] of oldBodies){
    assert.equal(await(await unchanged.request(path+'?v='+previous)).text(),body);
    assert.equal(unchanged.requests.filter(url=>new URL(url).pathname===path).length,0,'token reuse retains stale cached responses');
  }
  const next=startWorker({version,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(next.request('./',true));next.setOffline();
  for(const [path,body] of current){
    assert.equal(await(await next.request(path+'?v='+version)).text(),body,'new tabs receive exact current bytes offline');
    assert.equal(await(await next.request(path+'?v='+previous)).text(),oldBodies.get(path),'older tabs retain their own saved module graph');
    assert.equal(next.requests.filter(url=>url===new URL(path,scope).href+'?v='+version).length,1);
  }
  const modules=new Map();
  const oldModule=async url=>{
    const parsed=new URL(url,scope);assert.equal(parsed.searchParams.get('v'),previous);
    assert.ok(oldBodies.has(parsed.pathname),'old entrypoint dependencies must stay within its saved graph');
    if(!modules.has(parsed.href))modules.set(parsed.href,new vm.SourceTextModule(await(await next.request(parsed.href)).text(),{identifier:parsed.href}));
    return modules.get(parsed.href);
  };
  const oldApp=await oldModule('app.mjs?v='+previous);
  await oldApp.link((specifier,referrer)=>oldModule(new URL(specifier,referrer.identifier).href));await oldApp.evaluate();
  assert.equal(oldApp.namespace.departures,'departures.mjs');assert.equal(oldApp.namespace.power,'power-facilities.mjs');
  const evaluate=async code=>{const module=new vm.SourceTextModule(code);await module.link(()=>{throw new Error('unexpected module dependency');});await module.evaluate();return module.namespace;};
  // Execute actual current code returned by the worker. The destination pair
  // must retain independent trip, stop, platform and cancellation ownership.
  const fixed=await evaluate(await(await next.request('departures.mjs?v='+version)).text());
  const at='2099-01-01T12:00:00Z';
  const lists=['Central','Central Park'].map((headsign,i)=>[{mode:'REGIONAL_RAIL',displayName:'R7',
    tripId:`trip-${i}`,headsign,cancelled:i===1,place:{departure:at,scheduledDeparture:at,stopId:`stop-${i}`,track:String(i+2)}}]);
  const rows=fixed.departureRows(lists,{now:0});assert.equal(rows.length,2);
  assert.deepEqual(Array.from(rows,row=>[row.tripId,row.stopId,row.track,row.cancelled]),[['trip-0','stop-0','2',false],['trip-1','stop-1','3',true]]);
  const fetch=async value=>{const url=new URL(value);return {ok:true,json:async()=>url.pathname.endsWith('/reverse-geocode')?['a','b'].map(id=>({
    type:'STOP',id,name:'Central',lat:0,lon:0,modes:['REGIONAL_RAIL']})):{stopTimes:url.searchParams.get('stopId')==='a'?[{...lists[0][0],headsign:{invalid:true}}]:lists[1]}};};
  const board=await fixed.stationDepartures({lat:0,lon:0,names:['Central']},{fetch});
  assert.equal(board.rows.length,1);assert.equal(board.rows[0].tripId,'trip-1');
  assert.deepEqual(Object.fromEntries(board.stopResults.map(result=>[result.stopId,result.status])),{a:'rejected',b:'fulfilled'});
  const power=await evaluate(await(await next.request('power-facilities.mjs?v='+version)).text());
  assert.equal(power.powerFacilityName({power_kind:'water_tank',man_made:'storage_tank',content:'water',usage:'railway'}),'Railway water tank');
  assert.deepEqual(Object.fromEntries(power.powerFacilityEnergyRows({'fuel:adblue':'yes','plant:source':'solar'})),{'Recorded supplies':'adblue','Fuel tags':'fuel:adblue=yes','Plant energy source':'solar'});
  assert.deepEqual([...next.stores.keys()],cacheNames,'no cache generation change or purge');
  assert.deepEqual(await next.stores.get(`atlas-shell-${generation}`).get(scope+'__versions').clone().json(),[version,previous]);
  assert.ok(next.requests.every(url=>new URL(url).origin===new URL(scope).origin));
});

test('search row-isolation release updates cached app/model together and retains old tabs',async()=>{
  const previous='20261017-platform-measure-zoom-1';
  const html=readFileSync(new URL('../styles/index.html',import.meta.url),'utf8');
  const version=html.match(/src="app\.mjs\?v=([\w.-]+)"/)[1];
  assert.notEqual(version,previous,'the changed search parser requires a fresh release token');
  const paths=['app.mjs','map-model.mjs','platform-length.mjs','railway-visibility.mjs','axle-load.mjs'];
  const current=new Map(paths.map(path=>[new URL(path,scope).pathname,readFileSync(new URL('../styles/'+path,import.meta.url),'utf8')]));
  // Compact preceding-cache payloads exercise version isolation, not historical
  // source reconstruction. New module bytes are exact current build inputs.
  const oldBodies=new Map(paths.map(path=>[new URL(path,scope).pathname,'previous cached '+path]));
  const old=startWorker({version:previous,assetBodies:oldBodies,rejectExternal:true});
  await bounded(old.lifecycle('install'));await old.lifecycle('activate');
  const caches=[...old.stores.keys()];
  const unchanged=startWorker({version:previous,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(unchanged.request('./',true));
  assert.equal(await(await unchanged.request('map-model.mjs?v='+previous)).text(),oldBodies.get(new URL('map-model.mjs',scope).pathname),'unchanged token retains the stale parser');
  const next=startWorker({version,stores:old.stores,assetBodies:current,rejectExternal:true});
  await bounded(next.request('./',true));next.setOffline();
  for(const path of paths){
    assert.equal(await(await next.request(path+'?v='+version)).text(),current.get(new URL(path,scope).pathname));
    assert.equal(await(await next.request(path+'?v='+previous)).text(),oldBodies.get(new URL(path,scope).pathname));
  }
  const modules=new Map();
  async function load(url){
    const parsed=new URL(url,scope);assert.equal(parsed.origin,new URL(scope).origin);
    if(!modules.has(parsed.href))modules.set(parsed.href,new vm.SourceTextModule(await(await next.request(parsed.href)).text(),{identifier:parsed.href}));
    return modules.get(parsed.href);
  }
  const model=await load('map-model.mjs?v='+version);
  await model.link((path,parent)=>load(new URL(path,parent.identifier).href));await model.evaluate();
  const {searchResponse,searchResults}=model.namespace;
  const station={name:'Synthetic station',latitude:51.5,longitude:-.1};
  assert.equal(searchResponse([null,station],'facility').invalid,1);
  assert.equal(searchResults([null,station],[{name:'Unknown location',lat:null,lon:''}]).rail.length,1);
  assert.equal(searchResults([],[{name:'Unknown location',lat:null,lon:''}]).places.length,0);
  assert.deepEqual([...next.stores.keys()],caches,'normal navigation updates within the same cache generation');
  assert.ok(next.requests.every(url=>new URL(url).origin===new URL(scope).origin));
});
