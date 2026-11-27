import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createServerApp, issueAdminSession, verifyAdminSession } from '../server.ts';
import {
  GOOGLE_TILE_LAYER_ID,
  GOOGLE_TILE_SOURCE_ID,
  ROAD_DEEMPHASIZED_STYLES,
  createAdminController,
  googleVariantForSettings,
  installGoogleTileLayer,
} from '../styles/google-maps.mjs';
import { layerVisibility } from '../styles/layer-semantics.mjs';

const html = await readFile(new URL('../styles/index.html', import.meta.url), 'utf8');
const baseStyle = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url), 'utf8'));

async function withTestServer(options, run) {
  const app = createServerApp({ enableUpstreamDataFallback: false, ...options });
  const server = await new Promise(resolve => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await run({ baseUrl });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('admin session token signing and verification reject tampering and expiration', () => {
  const secret = Buffer.from('unit-test-secret-key-32-bytes-ok');
  const now = 1_700_000_000_000;
  const session = issueAdminSession('alice-admin', 'c933103/openrailwaystyle', secret, now, 60_000);
  const verified = verifyAdminSession(session.token, 'c933103/openrailwaystyle', secret, now + 1000);
  assert.ok(verified);
  assert.equal(verified.sub, 'alice-admin');
  assert.equal(verified.repo, 'c933103/openrailwaystyle');

  assert.equal(verifyAdminSession(`${session.token}tampered`, 'c933103/openrailwaystyle', secret, now + 1000), null);
  assert.equal(
    verifyAdminSession(session.token, 'c933103/openrailwaystyle', Buffer.from('wrong-secret-key-32-bytes-padding'), now + 1000),
    null,
  );
  assert.equal(verifyAdminSession(session.token, 'other-owner/other-repo', secret, now + 1000), null);

  assert.equal(verifyAdminSession(session.token, 'c933103/openrailwaystyle', secret, now + 61_000), null);
});

test('zero-env-var GitHub App Manifest flow bootstraps credentials and verifies repo admin access', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'atlas-manifest-test-'));
  const runtimeStorePath = path.join(tmpDir, 'github-oauth.json');

  const githubCalls = [];
  const githubFetch = async (input, init) => {
    const url = String(input);
    githubCalls.push({ url, method: init?.method || 'GET' });
    if (url.endsWith('/app-manifests/manifest-code-123/conversions')) {
      return new Response(
        JSON.stringify({
          id: 991,
          slug: 'railway-atlas-admin-sso',
          client_id: 'Iv1.manifestClientId',
          client_secret: 'manifest-client-secret-xyz',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url === 'https://github.com/login/oauth/access_token') {
      return new Response(
        JSON.stringify({ access_token: 'ghu_admin_token_123' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url === 'https://api.github.com/user') {
      return new Response(
        JSON.stringify({ login: 'repo-owner', id: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url === 'https://api.github.com/repos/c933103/openrailwaystyle') {
      return new Response(
        JSON.stringify({ owner:{id:1}, permissions: { admin: true, push: true, pull: true } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('Not found', { status: 404 });
  };

  const savedClientId = process.env.GITHUB_CLIENT_ID;
  const savedClientSecret = process.env.GITHUB_CLIENT_SECRET;
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;

  try {
    await withTestServer(
      {
        runtimeStorePath,
        getApiKey: () => 'test-gmaps-key',
        secret: Buffer.from('manifest-test-secret-32-bytes-ok'),
        fetcher: githubFetch,
      },
      async ({ baseUrl }) => {
        // 1. Without env vars, /api/auth/github/url returns 1-click Manifest bootstrap payload
        const urlRes = await fetch(`${baseUrl}/api/auth/github/url?origin=${encodeURIComponent(baseUrl)}`);
        assert.equal(urlRes.status, 200);
        const urlBody = await urlRes.json();
        assert.equal(urlBody.mode, 'manifest');
        assert.match(urlBody.actionUrl, /^https:\/\/github\.com\/settings\/apps\/new\?state=/);
        const manifestState = new URL(urlBody.actionUrl).searchParams.get('state');
        const manifest = JSON.parse(urlBody.manifest);
        assert.equal(manifest.redirect_url, `${baseUrl}/auth/manifest-callback`);
        assert.deepEqual(manifest.callback_urls, [`${baseUrl}/auth/callback`, 'https://10671435.xyz/auth/callback']);

        // 2. GitHub redirects to /auth/manifest-callback -> exchanges manifest code -> redirects to app install
        const manifestCb = await fetch(
          `${baseUrl}/auth/manifest-callback?code=manifest-code-123&state=${encodeURIComponent(manifestState)}`,
          { redirect: 'manual' },
        );
        assert.equal(manifestCb.status, 302);
        const installLocation = manifestCb.headers.get('location');
        assert.match(installLocation, /^https:\/\/github\.com\/apps\/railway-atlas-admin-sso\/installations\/new\?state=/);
        const oauthState = new URL(installLocation).searchParams.get('state');

        // 3. Subsequent /api/auth/github/url calls use the saved OAuth credentials directly
        const urlResAfter = await fetch(`${baseUrl}/api/auth/github/url?origin=${encodeURIComponent(baseUrl)}`);
        const urlBodyAfter = await urlResAfter.json();
        assert.equal(urlBodyAfter.mode, 'oauth');
        assert.match(urlBodyAfter.url, /client_id=Iv1\.manifestClientId/);

        // 4. Completing /auth/callback verifies repo admin permission and issues session
        const cbRes = await fetch(
          `${baseUrl}/auth/callback?code=oauth-code-456&state=${encodeURIComponent(oauthState)}`,
        );
        assert.equal(cbRes.status, 200);
        const cbHtml = await cbRes.text();
        assert.match(cbHtml, /OAUTH_AUTH_SUCCESS/);
        assert.match(cbHtml, /repo-owner/);
      },
    );
  } finally {
    if (savedClientId !== undefined) process.env.GITHUB_CLIENT_ID = savedClientId;
    if (savedClientSecret !== undefined) process.env.GITHUB_CLIENT_SECRET = savedClientSecret;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('GitHub OAuth callback rejects non-admin users and proxies 2D Google Map Tiles for verified admins', async () => {
  const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  let currentLogin = 'visitor-user';
  let isAdmin = false;
  const tileStatus = 200;

  const mockFetcher = async (input, init) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      const code=JSON.parse(init.body).code;
      if (code==='rejected-exchange') return Response.json({error:'bad_verification_code'},{status:401});
      if (code==='failed-transport') throw Error('fixture upstream disconnect');
      return new Response(JSON.stringify({ access_token: 'gho_test_token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === 'https://api.github.com/user') {
      return new Response(JSON.stringify({ login: currentLogin, id: currentLogin === 'maintainer-admin' ? 1 : 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === 'https://api.github.com/repos/c933103/openrailwaystyle') {
      return new Response(JSON.stringify({ owner:{id:1}, permissions: { admin: true, pull: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('https://api.github.com/repos/c933103/openrailwaystyle/collaborators/')) {
      return new Response(JSON.stringify({ permission: isAdmin ? 'admin' : 'read' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('https://tile.googleapis.com/v1/createSession')) {
      const body = JSON.parse(init?.body || '{}');
      return new Response(
        JSON.stringify({ session: `gmaps-session-${body.mapType}` }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.startsWith('https://tile.googleapis.com/v1/2dtiles/')) {
      if (tileStatus === 429) {
        return new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(pngBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }
    if (url.startsWith('https://tile.googleapis.com/tile/v1/viewport')) {
      return new Response(JSON.stringify({ copyright: 'Map data ©2026 Google, GeoBasis-DE/BKG' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Unexpected URL', { status: 500 });
  };

  await withTestServer(
    {
      runtimeStorePath: null,
      getGitHubConfig: () => ({
        clientId: 'gh-client-id',
        clientSecret: 'gh-client-secret',
        adminRepo: 'c933103/openrailwaystyle',
        scopes: 'read:user public_repo',
        appUrl: '',
      }),
      getApiKey: () => 'gmaps-server-key',
      secret: Buffer.from('sso-test-secret-32-bytes-padding'),
      fetcher: mockFetcher,
    },
    async ({ baseUrl }) => {
      // Unauthenticated tile/session requests fail closed with 401
      const unauthTile = await fetch(`${baseUrl}/api/gmaps/tiles/satellite/3/4/2`);
      assert.equal(unauthTile.status, 401);

      // Non-admin user is denied with 403 OAUTH_AUTH_ERROR
      const urlRes1 = await fetch(`${baseUrl}/api/auth/github/url?origin=${encodeURIComponent(baseUrl)}`);
      const { url: authUrl1 } = await urlRes1.json();
      const state1 = new URL(authUrl1).searchParams.get('state');
      const cancelUrl = `${baseUrl}/auth/callback?error=access_denied&state=`;
      const cancelRes = await fetch(cancelUrl+encodeURIComponent(state1));
      assert.equal(cancelRes.status,400);
      const cancelled = await cancelRes.text();
      assert.match(cancelled,/GitHub sign-in cancelled/);
      assert.ok(cancelled.includes(JSON.stringify(baseUrl)), 'signed state delivers the cancellation to the initiating frontend');
      const invalid = await (await fetch(cancelUrl+'invalid')).text();
      assert.ok(!invalid.includes(JSON.stringify(baseUrl)), 'invalid state must not supply a message target');

      for (const [code,status,message] of [['rejected-exchange',401,/bad_verification_code/],['failed-transport',502,/GitHub verification request failed/]]) {
        const rejected=await fetch(`${baseUrl}/auth/callback?code=${code}&state=${encodeURIComponent(state1)}`);
        assert.equal(rejected.status,status);
        const body=await rejected.text();
        assert.match(body,message);
        assert.ok(body.includes(JSON.stringify(baseUrl)), 'error is directed to the signed initiating frontend');
      }
      const deniedRes = await fetch(`${baseUrl}/auth/callback?code=code1&state=${encodeURIComponent(state1)}`);
      assert.equal(deniedRes.status, 403);
      const deniedHtml = await deniedRes.text();
      assert.match(deniedHtml, /OAUTH_AUTH_ERROR/);
      assert.match(deniedHtml, /does not own/);

      // Admin user receives signed bearer session and can fetch 2D tiles + viewport attribution
      currentLogin = 'maintainer-admin';
      isAdmin = true;
      const urlRes2 = await fetch(`${baseUrl}/api/auth/github/url?origin=${encodeURIComponent(baseUrl)}`);
      const { url: authUrl2 } = await urlRes2.json();
      const state2 = new URL(authUrl2).searchParams.get('state');
      const okRes = await fetch(`${baseUrl}/auth/callback?code=code2&state=${encodeURIComponent(state2)}`);
      assert.equal(okRes.status, 200);
      const okHtml = await okRes.text();
      const tokenMatch = /"token":"([^"]+)"/.exec(okHtml);
      assert.ok(tokenMatch?.[1], 'callback embeds signed admin token for postMessage');
      const token = tokenMatch[1];

      const sessionRes = await fetch(`${baseUrl}/api/gmaps/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ variant: 'roadmap', language: 'en' }),
      });
      assert.equal(sessionRes.status, 200);
      const sessionJson = await sessionRes.json();
      assert.deepEqual(sessionJson, {
        unlocked: true,
        mode: 'tiles',
        variant: 'roadmap',
        maxzoom: 22,
        tileUrl: '/api/gmaps/tiles/roadmap/{z}/{x}/{y}',
      });

      const tileRes = await fetch(`${baseUrl}/api/gmaps/tiles/roadmap/5/16/10?lang=en`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(tileRes.status, 200);
      assert.equal(tileRes.headers.get('cache-control'), 'no-store');
      assert.deepEqual(new Uint8Array(await tileRes.arrayBuffer()), pngBytes);

      const vpRes = await fetch(
        `${baseUrl}/api/gmaps/viewport?variant=roadmap&zoom=6&north=52&south=48&east=14&west=6&lang=en`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      assert.equal(vpRes.status, 200);
      assert.deepEqual(await vpRes.json(), { copyright: 'Map data ©2026 Google, GeoBasis-DE/BKG' });
    },
  );
});

test('Settings -> Admin keeps Standard vs Google switcher and preserves 3D terrain & globe with Google 2D tiles', async () => {
  const dom = new JSDOM(html, { url: 'https://ais-dev-test.run.app/' });
  const { window } = dom;
  const { document } = window;

  try {
    // Hidden in Settings -> Admin, absent from main view
    assert.equal(document.querySelector('#main-view #admin-settings'), null);
    const adminDetails = document.querySelector('#settings-view details#admin-settings');
    assert.ok(adminDetails, 'Admin section lives inside Settings');
    assert.equal(adminDetails.open, false, 'Admin section starts collapsed');

    const settings = { background: 'hybrid', language: 'en', mapSource: 'standard', googleTheme: 'roadmap', googleMode: null };
    const style = structuredClone(baseStyle);
    installGoogleTileLayer(style, { variant: 'satellite', language: 'en' });
    assert.ok(style.sources[GOOGLE_TILE_SOURCE_ID]);
    const googleLayer = style.layers.find(l => l.id === GOOGLE_TILE_LAYER_ID);
    assert.ok(googleLayer);

    const controller = createAdminController({
      window,
      document,
      fetcher: async url => {
        if (String(url).startsWith('/api/gmaps/session')) {
          return new Response(JSON.stringify({ unlocked: true, mode: 'tiles', variant: 'satellite' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (String(url).startsWith('/api/gmaps/viewport')) {
          return new Response(JSON.stringify({ copyright: 'Imagery ©2026 Google' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200 });
      },
      getSettings: () => settings,
      getViewportBounds: () => ({ zoom: 5, north: 50, south: 40, east: 20, west: 0 }),
      onStateChange: state => {
        settings.mapSource = state.mapSource;
        settings.googleTheme = state.googleTheme;
        settings.googleMode = state.googleMode;
      },
    });
    controller.bindDOM();

    assert.equal(document.getElementById('admin-controls').hidden, true);
    assert.equal(layerVisibility(googleLayer, settings), false, 'Google layer hidden in standard mode');

    // Simulate OAuth postMessage completion from popup
    window.dispatchEvent(
      new window.MessageEvent('message', {
        origin: 'https://ais-dev-test.run.app',
        data: {
          type: 'OAUTH_AUTH_SUCCESS',
          session: {
            token: 'signed-token-abc',
            login: 'c933103',
            repo: 'c933103/openrailwaystyle',
            expiresAt: Date.now() + 3600_000,
          },
        },
      }),
    );

    assert.equal(controller.isUnlocked, true);
    assert.equal(document.getElementById('admin-controls').hidden, false);
    assert.equal(controller.mapSource, 'standard', 'Unlocking keeps Standard source selected until switched');

    // Switch to Google Maps data source
    const sourceSelect = document.getElementById('admin-map-source');
    sourceSelect.value = 'google';
    sourceSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.equal(settings.mapSource, 'google');
    assert.equal(settings.googleMode, 'tiles', 'Uses 2D Map Tiles API so MapLibre 3D terrain & globe transform tiles');
    assert.equal(layerVisibility(googleLayer, settings), true, 'Google raster layer turns visible');
    const eoxLayer = style.layers.find(l => l.id === 'satellite');
    assert.equal(layerVisibility(eoxLayer, settings), false, 'EOX satellite layer hides while Google tiles render');
    assert.equal(document.getElementById('gmaps-attribution').hidden, false, 'Official Google attribution shown');

    // Road-deemphasized Roadmap & Terrain variants
    settings.background = 'map';
    assert.equal(googleVariantForSettings(settings), 'roadmap');
    const transitRule = ROAD_DEEMPHASIZED_STYLES.find(r => r.featureType === 'transit');
    assert.deepEqual(transitRule?.stylers, [{ visibility: 'off' }], 'Google transit hidden so Railway Atlas vectors stay crisp');

    // Switch back to Standard source while staying signed in as admin!
    sourceSelect.value = 'standard';
    sourceSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(controller.isUnlocked, true, 'Admin remains signed in');
    assert.equal(settings.mapSource, 'standard', 'Switched cleanly back to Standard data sources');
    assert.equal(layerVisibility(googleLayer, settings), false);
    assert.equal(document.getElementById('gmaps-attribution').hidden, true);

    // PR #251 Soviet topo is graduated as the visible 5th background button in main view
    const sovietBtn = document.querySelector('#main-view .background-picker [data-background="soviet"]');
    assert.ok(sovietBtn, '5th Soviet topo button rendered in background picker');
    assert.equal(sovietBtn.hidden, false);
    assert.equal(sovietBtn.disabled, false);
  } finally {
    dom.window.close();
  }
});

test('https://10671435.xyz production origin is supported via CORS on server.ts and via zero-backend static GitHub Pages mode', async () => {
  // Part A: server.ts allows https://10671435.xyz for CORS preflight, API headers, and OAuth origin
  await withTestServer(
    {
      runtimeStorePath: null,
      getGitHubConfig: () => ({
        clientId: 'gh-client-10671435',
        clientSecret: 'gh-secret-10671435',
        adminRepo: 'c933103/openrailwaystyle',
        scopes: 'read:user public_repo',
        appUrl: 'https://auth.10671435.xyz',
      }),
      getApiKey: () => 'gmaps-server-key',
      secret: Buffer.from('prod-10671435-secret-32-bytes-ok'),
    },
    async ({ baseUrl }) => {
      const preflight = await fetch(`${baseUrl}/api/gmaps/session`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://10671435.xyz' },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://10671435.xyz');

      const oauthUrlRes = await fetch(
        `${baseUrl}/api/auth/github/url?origin=${encodeURIComponent('https://10671435.xyz')}`,
        { headers: { Origin: 'https://10671435.xyz' } },
      );
      assert.equal(oauthUrlRes.status, 200);
      assert.equal(oauthUrlRes.headers.get('access-control-allow-origin'), 'https://10671435.xyz');
      const oauthBody = await oauthUrlRes.json();
      assert.equal(oauthBody.mode, 'oauth');
      assert.match(oauthBody.url, /redirect_uri=https%3A%2F%2Fauth\.10671435\.xyz%2Fauth%2Fcallback/);
    },
  );

  // Part B: Pure static GitHub Pages deployment at https://10671435.xyz/ (no /api/* server)
  const dom = new JSDOM(html, { url: 'https://10671435.xyz/' });
  const { window } = dom;
  const { document } = window;
  const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  let repoAdmin = false;

  try {
    const settings = { background: 'hybrid', language: 'en', mapSource: 'standard', googleTheme: 'roadmap', googleMode: null };
    const controller = createAdminController({
      window,
      document,
      fetcher: async (input, init) => {
        const url = String(input);
        // Simulate static GitHub Pages returning 404 HTML for /api/* routes
        if (url.startsWith('/api/')) {
          return new Response('<!doctype html><title>404</title>', {
            status: 404,
            headers: { 'Content-Type': 'text/html' },
          });
        }
        if (url === 'https://api.github.com/user') {
          return new Response(JSON.stringify({ login: repoAdmin ? 'c933103' : 'guest-reader', id: repoAdmin ? 1 : 2 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url === 'https://api.github.com/repos/c933103/openrailwaystyle') {
          return new Response(JSON.stringify({ owner:{id:1}, permissions: { admin: repoAdmin, pull: true } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.startsWith('https://api.github.com/repos/c933103/openrailwaystyle/collaborators/')) {
          return new Response(JSON.stringify({ permission: repoAdmin ? 'admin' : 'read' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.startsWith('https://tile.googleapis.com/v1/createSession')) {
          const body = JSON.parse(init?.body || '{}');
          return new Response(JSON.stringify({ session: `direct-session-${body.mapType}` }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.startsWith('https://tile.googleapis.com/v1/2dtiles/')) {
          return new Response(pngBytes, {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          });
        }
        if (url.startsWith('https://tile.googleapis.com/tile/v1/viewport')) {
          return new Response(JSON.stringify({ copyright: 'Imagery ©2026 Google' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Unexpected', { status: 500 });
      },
      getSettings: () => settings,
      getViewportBounds: () => ({ zoom: 6, north: 52, south: 48, east: 14, west: 6 }),
      onStateChange: state => {
        settings.mapSource = state.mapSource;
        settings.googleTheme = state.googleTheme;
        settings.googleMode = state.googleMode;
      },
    });
    controller.bindDOM();
    controller.setDeploymentConfig({
      googleMapsKey: 'AIzaSyStaticGitHubPagesKey123456789',
      adminRepo: 'c933103/openrailwaystyle',
    });

    // Non-admin GitHub token is rejected on static Pages
    const denied = await controller.verifyWithGitHubToken('ghp_non_admin_token');
    assert.equal(denied, false);
    assert.equal(controller.isUnlocked, false);

    // Repo-admin GitHub token unlocks Google Maps 2D tiles directly on https://10671435.xyz/
    repoAdmin = true;
    const ok = await controller.verifyWithGitHubToken('ghp_repo_admin_token');
    assert.equal(ok, true);
    assert.equal(controller.isUnlocked, true);

    const sourceSelect = document.getElementById('admin-map-source');
    sourceSelect.value = 'google';
    sourceSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal(settings.mapSource, 'google');
    assert.equal(settings.googleMode, 'tiles', 'Static 10671435.xyz uses 2D Map Tiles so 3D terrain & globe transform tiles');

    const tile = await controller.fetchTile(
      { url: 'atlasgmaps://satellite/6/33/21?lang=en' },
      new AbortController(),
    );
    assert.deepEqual(new Uint8Array(tile.data), pngBytes);
    assert.equal(document.getElementById('gmaps-copyright').textContent, 'Imagery ©2026 Google');
  } finally {
    dom.window.close();
  }
});


test('Without credentials the owner session cannot consume Google quota or pass a token in a URL', async () => {
  const secret = Buffer.from('missing-google-key-test-secret-32');
  let upstreamCalls = 0;
  await withTestServer({
    runtimeStorePath: null,
    getApiKey: () => '',
    getBrowserApiKey: () => '',
    secret,
    fetcher: async () => { upstreamCalls++; throw Error('Unexpected upstream request'); },
  }, async ({baseUrl}) => {
    const token = issueAdminSession('owner','c933103/openrailwaystyle',secret).token;
    const auth = {Authorization:'Bearer '+token,'Content-Type':'application/json'};
    const session = await fetch(baseUrl+'/api/gmaps/session',{method:'POST',headers:auth,body:'{}'});
    assert.equal(session.status,503);
    assert.match(await session.text(),/not configured/);
    assert.equal((await fetch(baseUrl+'/api/gmaps/tiles/roadmap/3/2/4',{headers:auth})).status,503);
    assert.equal((await fetch(baseUrl+'/api/gmaps/tiles/roadmap/3/2/4?token='+encodeURIComponent(token))).status,401);
    assert.equal(upstreamCalls,0);
  });
});

test('Server-held key is never returned by browser configuration or unavailable tile service', async () => {
  const secret = Buffer.from('private-google-key-test-secret-32');
  const privateKey = 'server-only-mock-google-key';
  await withTestServer({
    runtimeStorePath:null,
    getApiKey:()=>privateKey,
    getBrowserApiKey:()=>'',
    secret,
    fetcher:async()=>new Response(JSON.stringify({error:{status:'PERMISSION_DENIED',message:'API not enabled'}}),{status:403}),
  },async({baseUrl})=>{
    const token=issueAdminSession('owner','c933103/openrailwaystyle',secret).token;
    const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
    const config=await fetch(baseUrl+'/api/gmaps/config',{headers});
    assert.ok(!(await config.text()).includes(privateKey));
    const session=await fetch(baseUrl+'/api/gmaps/session',{method:'POST',headers,body:'{}'});
    assert.equal(session.ok,false);
    assert.ok(!(await session.text()).includes(privateKey));
  });
});
