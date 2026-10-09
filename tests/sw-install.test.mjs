import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {backportMapLibre524} from '../styles/map-controls.mjs';
import {BROWSER_LIBRARIES} from '../scripts/browser-libraries.mjs';

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

test('the current departure release refreshes cached code while previous tabs retain their version', async () => {
  const previousVersion = '20261009-ios-install-5';
  const page = readFileSync(new URL('../styles/index.html', import.meta.url), 'utf8');
  const currentVersion = page.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1];
  assert.ok(currentVersion, 'the actual page declares its asset version');
  const path = new URL('departures.mjs', scope).pathname;
  const previousBytes = 'export const departureRelease = "before-correction";';
  const currentBytes = readFileSync(new URL('../styles/departures.mjs', import.meta.url), 'utf8');
  const old = startWorker({version: previousVersion, assetBodies: new Map([[path, previousBytes]])});
  await bounded(old.lifecycle('install'));
  await old.lifecycle('activate');
  assert.equal(await (await old.request(`departures.mjs?v=${previousVersion}`)).text(), previousBytes);

  // The worker source and cache generation stay unchanged. Only the deployed
  // page and assets change, as on a normal visit after this release.
  const next = startWorker({version: currentVersion, stores: old.stores,
    assetBodies: new Map([[path, currentBytes]])});
  await bounded(next.request('./', true));
  assert.ok(await (await next.request(`departures.mjs?v=${currentVersion}`)).text() === currentBytes,
    'the current page must receive the corrected departure bytes, not the previous saved version');
  assert.equal(next.requests.filter(url => new URL(url).pathname === path).length, 1,
    'the new complete shell fetches departure code once');
  next.setOffline();
  assert.equal(await (await next.request(`departures.mjs?v=${previousVersion}`)).text(), previousBytes,
    'an older tab keeps its own module after the new shell is saved');
  assert.ok(await (await next.request(`departures.mjs?v=${currentVersion}`)).text() === currentBytes,
    'the corrected module remains available offline');
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
