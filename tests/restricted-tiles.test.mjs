import assert from 'node:assert/strict';
import {once} from 'node:events';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {createRestrictedTileServer} from '../scripts/restricted-tile-server.mjs';

const atlas = 'https://atlas.example';
const broker = 'https://tiles.example';
const repository = 'c933103/openrailwaystyle';
const historical = 'https://indianopenmaps.com/world/topo/russian/1m/gs/';
const fixtureTile = () => new Response('fixture tile', {headers:{'content-type':'image/webp', 'set-cookie':'upstream=secret', 'cache-control':'public'}});
const sovietPath = '/soviet/1m/3/4/2';
const googlePath = '/google/3/4/2';
const viewport = '/google/viewport?zoom=3&north=50&south=40&west=0&east=10';

async function runServer(t, overrides = {}) {
  let admin = true, time = Date.now(), loginRequest, rateLimited = false;
  const calls = [];
  const server = createRestrictedTileServer({
    siteOrigin: atlas, brokerOrigin: broker, githubClientId:'fixture-client-id', githubClientSecret:'fixture-secret',
    repository, sovietEnabled:true, googleMapsKey:'fixture-key', now:() => time, ...overrides,
    fetcher: async (url, options) => {
      const address = new URL(url);
      calls.push(address.href);
      assert.equal(options.redirect, 'error');
      if (address.href === 'https://github.com/login/oauth/access_token') {
        assert.equal(options.body.get('redirect_uri'), broker + '/restricted/auth/callback');
        assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), loginRequest.searchParams.get('code_challenge'));
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
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => server.close());
  const send = (path, options) => fetch(`http://127.0.0.1:${server.address().port}/restricted${path}`, options);
  const request = (path, {token, origin = atlas, method = 'GET'} = {}) => send(path, {
    method, headers:{Origin:origin, ...(token ? {Authorization:'Bearer '+token} : {})},
  });
  async function login() {
    const start = await send('/auth/login',{redirect:'manual'});
    assert.equal(start.status,302);
    loginRequest = new URL(start.headers.get('Location'));
    assert.equal(loginRequest.searchParams.get('code_challenge_method'),'S256');
    const cookie = start.headers.get('Set-Cookie');
    assert.match(cookie,/Secure; HttpOnly; SameSite=Lax/);
    const callback = '/auth/callback?code=fixture-code&state='+loginRequest.searchParams.get('state');
    const before = calls.length;
    assert.equal((await send(callback)).status,403);
    assert.equal(calls.length,before);
    const complete = await send(callback,{headers:{Cookie:cookie.split(';')[0]}});
    assert.equal(complete.status,200);
    assert.match(complete.headers.get('Cache-Control'),/no-store/);
    const body = await complete.text();
    assert.doesNotMatch(body,/fixture-github-token|fixture-secret|fixture-key/);
    assert.equal((await send(callback,{headers:{Cookie:cookie.split(';')[0]}})).status,403);
    return body.match(/"token":"([\w-]{43})"/)?.[1];
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
