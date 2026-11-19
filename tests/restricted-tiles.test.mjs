import assert from 'node:assert/strict';
import {once} from 'node:events';
import {test} from 'node:test';
import {createServer, request as httpRequest} from 'node:http';
import {createRestrictedTileHandler} from '../scripts/restricted-tile-server.mjs';
import {restrictedPreviewPage} from '../scripts/configure-restricted-tiles.mjs';
import {googleViewport} from '../styles/restricted-tiles.mjs';

const atlas = 'https://atlas.example';
const broker = 'https://tiles.example';
const repository = 'c933103/openrailwaystyle';
const historical = 'https://indianopenmaps.com/world/topo/russian/1m/gs/';
const fixtureTile = () => new Response('fixture tile', {headers:{'content-type':'image/webp', 'set-cookie':'upstream=secret', 'cache-control':'public'}});
const sovietPath = '/soviet/1m/3/4/2';
const googlePath = '/google/3/4/2';
const viewport = '/google/viewport?zoom=3&north=50&south=40&west=0&east=10';

async function runServer(t, overrides = {}) {
  let admin = true, time = Date.now(), rateLimited = false;
  const calls = [];
  const handler = createRestrictedTileHandler({
    siteOrigin: atlas, brokerOrigin: broker, githubClientId:'fixture-client-id',
    repository, sovietEnabled:true, googleMapsKey:'fixture-key', now:() => time, ...overrides,
    fetcher: async (url, options) => {
      const address = new URL(url);
      calls.push(address.href);
      assert.equal(options.redirect, 'error');
      if (address.href === 'https://github.com/login/device/code') {
        assert.equal(options.body.get('client_id'), 'fixture-client-id');
        return Response.json({device_code:'fixture-device-ticket', user_code:'TEST-2345',
          verification_uri:'https://github.com/login/device', interval:5, expires_in:300});
      }
      if (address.href === 'https://github.com/login/oauth/access_token') {
        assert.equal(options.body.get('device_code'), 'fixture-device-ticket');
        assert.equal(options.body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
        return Response.json({access_token:'fixture-github-token'});
      }
      if (address.origin === 'https://api.github.com') {
        assert.equal(options.headers.Authorization, 'Bearer fixture-github-token');
        if (address.pathname === '/user') return Response.json({id:42});
        assert.equal(address.pathname, '/repos/' + repository);
        return Response.json({permissions:{admin}});
      }
      if (address.href === historical + 'tiles.json')
        return Response.json({tiles:[historical+'{z}/{x}/{y}.webp'],scheme:'xyz',minzoom:3,maxzoom:10});
      if (address.href === historical + '3/4/2.webp')
        return rateLimited ? new Response(null, {status:503, headers:{'Retry-After':'45'}}) : fixtureTile();
      if (address.origin === 'https://tile.googleapis.com') {
        assert.equal(address.searchParams.get('key'), 'fixture-key');
        if (address.pathname === '/v1/createSession') {
          assert.equal(JSON.parse(options.body).mapType, 'satellite');
          return Response.json({session:'private-google-session',expiry:String(Math.floor(time/1000)+300)});
        }
        assert.equal(address.searchParams.get('session'), 'private-google-session');
        if (address.pathname === '/tile/v1/viewport')
          return Response.json({copyright:'Fixture attribution',maxZoomRects:[]});
        assert.equal(address.pathname, '/v1/2dtiles/3/4/2');
        return fixtureTile();
      }
      assert.fail('Unexpected provider URL ' + address);
    },
  });
  const server = createServer(handler);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => server.close());
  const send = (path, {headers, method = 'GET'} = {}) => new Promise((resolve,reject) => {
    const url = `http://127.0.0.1:${server.address().port}/restricted${path}`;
    const outgoing = httpRequest(url, {method, headers:{Host:'tiles.example', ...headers}}, async incoming => {
      try {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const body = chunks.length ? Buffer.concat(chunks) : null;
        resolve(new Response(body,{status:incoming.statusCode,headers:incoming.headers}));
      } catch (error) {reject(error);}
    });
    outgoing.on('error',reject);
    outgoing.end();
  });
  const request = (path, {token, origin = atlas, method = 'GET'} = {}) => send(path, {
    method, headers:{Origin:origin, 'X-Atlas-Preview':'1', ...(token ? {Authorization:'Bearer '+token} : {})},
  });
  async function login() {
    const start = await request('/auth/device',{method:'POST'});
    assert.equal(start.status,201);
    assert.match(start.headers.get('Cache-Control'),/no-store/);
    const ticket = await start.json();
    assert.equal(ticket.userCode,'TEST-2345');
    assert.equal(ticket.deviceCode,undefined);
    const headers = {Origin:atlas, Authorization:'Device ' + ticket.challenge};
    const before = calls.length;
    assert.equal((await send('/auth/device',{headers})).status,202);
    assert.equal(calls.length,before);
    time += 5000;
    const result = await send('/auth/device',{headers});
    const body = await result.text();
    assert.doesNotMatch(body,/fixture-github-token|fixture-device-ticket|fixture-key/);
    assert.equal((await send('/auth/device',{headers})).status,410);
    return body ? JSON.parse(body).token : undefined;
  }
  return {calls, login, request, nonAdmin:() => {admin = false;}, jump:ms => {time += ms;}, pauseSoviet:() => {rateLimited = true;}};
}

test('both providers require the same live GitHub repository-admin session for metadata and pixels', async t => {
  const {calls, login, request, nonAdmin} = await runServer(t);
  for (const path of [sovietPath, googlePath, '/soviet/1m/tiles.json', viewport]) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, {token:'a'.repeat(43)})).status, 401);
  }
  assert.equal(calls.length, 0);
  const token = await login();
  assert.ok(token);
  assert.equal((await request(sovietPath, {token,origin:'https://elsewhere.example'})).status,403);
  assert.equal((await request('/soviet/1m/12/4/2', {token})).status,404);
  assert.deepEqual(await (await request('/soviet/1m/tiles.json',{token})).json(),{minzoom:3,maxzoom:10});
  assert.deepEqual(await (await request(viewport,{token})).json(),{copyright:'Fixture attribution',maxZoomRects:[]});
  for (const path of [sovietPath,googlePath]) {
    const tile = await request(path,{token});
    assert.equal(tile.status,200);
    assert.equal(tile.headers.get('access-control-allow-origin'),atlas);
    assert.equal(tile.headers.get('cache-control'),'private, no-store');
    assert.equal(tile.headers.has('set-cookie'),false);
    assert.equal(await tile.text(),'fixture tile');
  }
  assert.equal(calls.filter(url => url.includes('/createSession')).length,1);
  assert.equal((await request('/auth/session',{token,method:'DELETE'})).status,204);
  assert.equal((await request(sovietPath,{token})).status,401);
  assert.equal((await request(googlePath,{token})).status,401);
  nonAdmin();
  assert.equal(await login(),undefined);
});

test('provider enablement, quota, provider backoff, and expiry fail closed', async t => {
  const {calls, login, request, jump, pauseSoviet} = await runServer(t,{tilesPerMinute:2});
  const token = await login();
  assert.equal((await request(sovietPath,{token})).status,200);
  assert.equal((await request(googlePath,{token})).status,200);
  const beforeLimit = calls.length;
  assert.equal((await request(sovietPath,{token})).status,429);
  assert.equal(calls.length,beforeLimit);
  jump(60_000);
  pauseSoviet();
  assert.equal((await request(sovietPath,{token})).headers.get('retry-after'),'45');
  assert.equal(calls.length,beforeLimit+1);
  assert.equal((await request(sovietPath,{token})).headers.get('retry-after'),'45');
  assert.equal(calls.length,beforeLimit+1);
  jump(15*60_000);
  assert.equal((await request(sovietPath,{token})).status,401);
  const disabled = await runServer(t,{sovietEnabled:false});
  const active = await disabled.login();
  assert.equal((await disabled.request(sovietPath,{token:active})).status,404);
  assert.equal(disabled.calls.filter(url => url.startsWith(historical)).length,0);
});

test('only the generated test page receives the gateway origin', () => {
  const standard = '<meta name="atlas-restricted-tile-origin" content="">';
  const preview = restrictedPreviewPage(standard, broker);
  assert.match(preview, /https:\/\/tiles\.example/);
  assert.doesNotMatch(standard, /tiles\.example/);
  assert.throws(() => restrictedPreviewPage(standard, 'https://tiles.example/other'), /Invalid/);
});

test('a Google viewport crossing the antimeridian includes attribution from both sides', async () => {
  const calls = [];
  const bounds = {getSouth:() => -20, getNorth:() => 40, getWest:() => 170, getEast:() => -165};
  const map = {getBounds:() => bounds, getZoom:() => 6};
  const credit = await googleViewport(map, async path => {
    const q = new URL(path,'https://atlas.example/').searchParams;
    calls.push([q.get('west'),q.get('east'),q.get('zoom')]);
    return Response.json({copyright:'Fixture ' + q.get('west')});
  });
  assert.deepEqual(calls,[['170','180','7'],['-180','-165','7']]);
  assert.equal(credit,'Fixture 170 · Fixture -180');
});
