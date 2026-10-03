import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../styles/sw.js', import.meta.url), 'utf8');
const scope = 'https://atlas.test/openrailwaystyle/';
const generation = Number(source.match(/CACHE = `\$\{PREFIX\}(\d+)`/)[1]);
const keyOf = input => input.url ?? String(input);
const bytes = value => new TextEncoder().encode(value);

// Installing workers have a small network concurrency budget. A fetch resolves
// at headers, but its slot is only released when the response body is consumed.
// highWaterMark:0 makes this distinction explicit instead of eagerly buffering
// every mock response (which would hide the installation deadlock).
function startWorker({version = 'new', fail = '', stores = new Map(), code = source} = {}) {
  const handlers = new Map(), queue = [], writes = [];
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
    if (offline) throw new TypeError('offline');
    if (counts.active >= 3) await new Promise(resolve => queue.push(resolve));
    else counts.active++;
    counts.started++; counts.peak = Math.max(counts.peak, counts.active);
    const url = keyOf(input), page = url === scope;
    const body = page ? `<script type="module" src="app.mjs?v=${version}"></script>` : `${version}: ${url}`;
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
      status: page ? 200 : 203,
      headers: {'content-type': page ? 'text/html' : 'application/octet-stream', 'x-fixture-url': url}
    });
  };
  vm.runInNewContext(code, {
    URL, Response, Request, fetch, caches, location: {origin: new URL(scope).origin},
    self: {
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
  return {stores, counts, writes, lifecycle, request, setOffline() { offline = true; },
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

for (const fail of ['map-model.mjs', 'maplibre-gl.js']) {
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
