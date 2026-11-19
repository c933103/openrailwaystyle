import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {Readable} from 'node:stream';

const SOVIET = 'https://indianopenmaps.com/world/topo/russian/';
const GOOGLE = 'https://tile.googleapis.com/';
const SESSION_MS = 15 * 60_000;
const random = () => randomBytes(32).toString('base64url');
const empty = status => new Response(null, {status});

function tileCoordinates(path, maxZoom) {
  const match = /^(\d{1,2})\/(\d{1,8})\/(\d{1,8})$/.exec(path);
  if (!match) return null;
  const [z, x, y] = match.slice(1).map(Number);
  return z <= maxZoom && x < 2 ** z && y < 2 ** z ? [z, x, y] : null;
}

export function createRestrictedTileHandler({
  siteOrigin, brokerOrigin = siteOrigin, githubClientId, repository, sovietEnabled = false, sovietArchives, googleMapsKey,
  fetcher = fetch, now = Date.now, tilesPerMinute = 120, totalTilesPerMinute = 300,
}) {
  const addresses = [siteOrigin, brokerOrigin].map(value => new URL(value));
  const address = addresses[1];
  const local = siteOrigin === brokerOrigin && address.protocol === 'http:' && address.hostname === '127.0.0.1';
  if (addresses.some((url, index) => url.origin !== [siteOrigin, brokerOrigin][index] ||
      (!local && url.protocol !== 'https:')) || !githubClientId || !/^[-.\w]+\/[-.\w]+$/.test(repository))
    throw new Error('Configure HTTPS origins or a loopback preview, and a GitHub App client ID.');
  if (![tilesPerMinute, totalTilesPerMinute].every(limit => Number.isSafeInteger(limit) && limit > 0))
    throw new Error('Tile request limits must be positive integers.');
  const hasSoviet = Boolean(sovietEnabled || sovietArchives);
  const pending = new Map(), sessions = new Map(), quotas = new Map(), providerPauses = new Map();
  let startingLogins = 0;
  const upstream = (url, options = {}) => fetcher(url, {
    ...options, redirect: 'error', signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
  });
  const github = (path, bearer) => upstream('https://api.github.com/' + path, {
    headers: {Authorization: 'Bearer ' + bearer, Accept: 'application/vnd.github+json',
      'User-Agent': 'Railway-Atlas', 'X-GitHub-Api-Version': '2026-03-10'},
  });
  const postGitHub = (path, fields) => upstream('https://github.com/login/' + path, {
    method: 'POST', headers: {Accept: 'application/json'},
    body: new URLSearchParams({client_id: githubClientId, ...fields}),
  });

  async function startLogin() {
    if (!hasSoviet && !googleMapsKey) return empty(503);
    if (pending.size + startingLogins >= 8) return empty(429);
    startingLogins++;
    try {
      const response = await postGitHub('device/code', {});
      if (!response.ok) return empty(502);
      const info = await response.json();
      if (!/^[A-Za-z0-9_-]+$/.test(info.device_code ?? '') || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(info.user_code ?? '') ||
          info.verification_uri !== 'https://github.com/login/device' ||
          !Number.isSafeInteger(info.interval) || info.interval < 1 || !Number.isSafeInteger(info.expires_in) || info.expires_in < 1)
        return empty(502);
      const challenge = random(), interval = info.interval * 1000, expiresAt = now() + info.expires_in * 1000;
      pending.set(challenge, {deviceCode: info.device_code, expiresAt, interval, nextPoll: now() + interval});
      return Response.json({challenge, userCode: info.user_code, expiresAt}, {status: 201});
    } finally { startingLogins--; }
  }

  async function finishLogin(ticket) {
    const attempt = pending.get(ticket);
    if (!attempt) return empty(410);
    if (attempt.inFlight || now() < attempt.nextPoll) return empty(202);
    attempt.inFlight = true;
    try {
      const response = await postGitHub('oauth/access_token', {
        device_code: attempt.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
      if (!response.ok) return empty(502);
      const result = await response.json();
      if (result.error === 'slow_down') attempt.interval += 5000;
      if (result.error === 'authorization_pending' || result.error === 'slow_down') return empty(202);
      pending.delete(ticket);
      if (!result.access_token) return empty(403);
      const [identity, repo] = await Promise.all([github('user', result.access_token), github('repos/' + repository, result.access_token)]);
      if (!identity.ok || !repo.ok || (await repo.json()).permissions?.admin !== true) return empty(403);
      const {id} = await identity.json();
      if (!Number.isSafeInteger(id) || id < 1 || now() >= attempt.expiresAt) return empty(403);
      for (const [key, session] of sessions) if (session.id === id) sessions.delete(key);
      const token = random(), expiresAt = now() + SESSION_MS;
      sessions.set(token, {id, expiresAt});
      return Response.json({token, expiresAt, soviet: hasSoviet, google: Boolean(googleMapsKey)});
    } finally {
      attempt.inFlight = false;
      attempt.nextPoll = now() + attempt.interval;
    }
  }

  function reserve(session, source) {
    if (providerPauses.has(source)) {
      return new Response(null, {status: 503, headers: {'Retry-After': String(Math.ceil((providerPauses.get(source) - now()) / 1000))}});
    }
    const minute = Math.floor(now() / 60_000);
    const personal = `${minute}:${session.id}`, total = `${minute}:provider:${source}`;
    const used = quotas.get(personal) ?? 0, combined = quotas.get(total) ?? 0;
    if (used >= tilesPerMinute || combined >= totalTilesPerMinute)
      return new Response(null, {status: 429, headers: {'Retry-After': String(60 - Math.floor(now() / 1000) % 60)}});
    quotas.set(personal, used + 1);
    quotas.set(total, combined + 1);
  }

  async function forward(url, source, signal, options) {
    const result = await upstream(url, {...options, signal});
    if ([429, 503].includes(result.status)) {
      const retry = result.headers.get('Retry-After');
      const seconds = /^\d+$/.test(retry ?? '') ? Number(retry) : (Date.parse(retry) - now()) / 1000;
      const wait = Math.max(1, Number.isFinite(seconds) ? Math.ceil(seconds) : 30);
      providerPauses.set(source, Math.max(providerPauses.get(source) ?? 0, now() + wait * 1000));
      await result.body?.cancel();
      return new Response(null, {status: result.status, headers: {'Retry-After': String(wait)}});
    }
    if (!result.ok) {
      await result.body?.cancel();
      return empty(result.status === 404 ? 404 : 502);
    }
    return result;
  }

  async function soviet(path, session, signal) {
    const match = /^(1m|500k)\/(.*)$/.exec(path);
    if (!hasSoviet || !match) return empty(404);
    const [, series, resource] = match;
    const metadata = resource === 'tiles.json';
    const maximum = series === '1m' ? 10 : 11;
    const xyz = metadata ? null : tileCoordinates(resource, maximum);
    if (!metadata && !xyz) return empty(404);
    if (sovietArchives) return sovietArchives(series, xyz, signal);
    const limited = reserve(session, 'soviet');
    if (limited) return limited;
    const result = await forward(`${SOVIET}${series}/gs/${metadata ? resource : xyz.join('/') + '.webp'}`, 'soviet', signal);
    if (!result.ok) return result;
    if (metadata) {
      const {minzoom, maxzoom, tiles, scheme} = await result.json();
      if (tiles?.length !== 1 || tiles[0] !== `${SOVIET}${series}/gs/{z}/{x}/{y}.webp` ||
          (scheme && scheme !== 'xyz') || !Number.isInteger(minzoom) || !Number.isInteger(maxzoom) ||
          minzoom < 0 || maxzoom < minzoom || maxzoom > maximum) return empty(502);
      return Response.json({minzoom, maxzoom});
    }
    if (!/^image\/webp(?:;|$)/i.test(result.headers.get('Content-Type') ?? '')) {
      await result.body?.cancel();
      return empty(502);
    }
    return result;
  }

  // The Google key and the provider session stay in the preview process.
  async function google(path, url, session, signal) {
    if (!googleMapsKey) return empty(404);
    const viewport = path === 'viewport';
    const xyz = viewport ? null : tileCoordinates(path, 22);
    if (!viewport && !xyz) return empty(404);
    const target = new URL(viewport ? 'tile/v1/viewport' : `v1/2dtiles/${xyz.join('/')}`, GOOGLE);
    if (viewport) {
      for (const [name, low, high] of [['zoom',0,22], ['north',-90,90], ['south',-90,90], ['west',-180,180], ['east',-180,180]]) {
        const input = url.searchParams.get(name), value = Number(input);
        if (!input || !Number.isFinite(value) || value < low || value > high || (name === 'zoom' && !Number.isInteger(value)))
          return empty(400);
        target.searchParams.set(name, String(value));
      }
    }
    const limited = reserve(session, 'google');
    if (limited) return limited;
    if (!session.google || session.google.expiresAt <= now()) {
      session.googleRequest ??= (async () => {
        const setup = new URL('v1/createSession', GOOGLE);
        setup.searchParams.set('key', googleMapsKey);
        const created = await forward(setup, 'google', undefined, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({mapType:'satellite', language:'en-US', region:'US'}),
        });
        if (!created.ok) return created;
        const info = await created.json();
        if (!info.session || !Number.isFinite(Number(info.expiry)) || Number(info.expiry) * 1000 <= now()) return empty(502);
        session.google = {token: info.session, expiresAt: Number(info.expiry) * 1000};
      })().finally(() => {session.googleRequest = undefined;});
      const failure = await session.googleRequest;
      if (failure) return failure;
    }
    if (signal.aborted || session.expiresAt <= now()) return empty(401);
    target.searchParams.set('key', googleMapsKey);
    target.searchParams.set('session', session.google.token);
    const result = await forward(target, 'google', signal);
    if (!result.ok) return result;
    if (viewport) {
      const {copyright, maxZoomRects} = await result.json();
      return typeof copyright === 'string' && copyright.trim() && Array.isArray(maxZoomRects)
        ? Response.json({copyright, maxZoomRects}) : empty(502);
    }
    if (!/^image\/(?:jpeg|png|webp)(?:;|$)/i.test(result.headers.get('Content-Type') ?? '')) {
      await result.body?.cancel();
      return empty(502);
    }
    return result;
  }

  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Origin');
    if (req.headers.origin === siteOrigin && siteOrigin !== brokerOrigin) {
      res.setHeader('Access-Control-Allow-Origin', siteOrigin);
      res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
    }
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const abort = new AbortController();
    res.on('close', () => {if (!res.writableEnded) abort.abort();});
    try {
      const url = new URL(req.url, brokerOrigin);
      const path = url.pathname;
      for (const store of [pending, sessions]) {
        for (const [key, value] of store) if (value.expiresAt <= now()) store.delete(key);
      }
      for (const key of quotas.keys()) if (!key.startsWith(`${Math.floor(now() / 60_000)}:`)) quotas.delete(key);
      for (const [source, until] of providerPauses) if (until <= now()) providerPauses.delete(source);
      let result;
      if (req.headers.host !== address.host || url.origin !== brokerOrigin ||
          (req.headers.origin !== siteOrigin && !(siteOrigin === brokerOrigin && !req.headers.origin && req.method === 'GET'))) result = empty(403);
      else if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Headers', 'Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
        result = empty(204);
      }
      else if (path === '/restricted/auth/device' && req.method === 'POST') result = await startLogin();
      else if (path === '/restricted/auth/device' && req.method === 'GET') {
        const ticket = /^Device ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
        result = ticket ? await finishLogin(ticket) : empty(401);
      } else {
        const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
        const session = sessions.get(token);
        if (!session) result = empty(401);
        else if (req.method === 'DELETE' && path === '/restricted/auth/session') {
          sessions.delete(token);
          result = empty(204);
        } else if (req.method !== 'GET') result = empty(405);
        else if (path.startsWith('/restricted/soviet/')) result = await soviet(path.slice('/restricted/soviet/'.length), session, abort.signal);
        else if (path.startsWith('/restricted/google/')) result = await google(path.slice('/restricted/google/'.length), url, session, abort.signal);
        else result = empty(404);
        // Sign-out, replacement login, and expiry can happen mid-request.
        if (req.method === 'GET' && session && (sessions.get(token) !== session || session.expiresAt <= now())) {
          await result.body?.cancel();
          result = empty(401);
        }
      }
      res.statusCode = result.status;
      for (const name of ['content-type', 'retry-after']) {
        if (result.headers.has(name)) res.setHeader(name, result.headers.get(name));
      }
      if (result.body) Readable.fromWeb(result.body).on('error', () => res.destroy()).pipe(res);
      else res.end();
    } catch {
      if (res.destroyed) return;
      if (res.headersSent) res.destroy();
      else { res.statusCode = 502; res.end(); }
    }
  };
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  if (env.SOVIET_TOPO_TILE_SERVICE && env.SOVIET_TOPO_TILE_SERVICE !== 'indian-open-maps')
    throw new Error('Unknown Soviet topo tile service.');
  const handler = createRestrictedTileHandler({
    siteOrigin: env.ATLAS_SITE_ORIGIN, brokerOrigin: env.AUTH_BACKEND_ORIGIN,
    githubClientId: env.GITHUB_CLIENT_ID, repository: env.GITHUB_ADMIN_REPO || 'c933103/openrailwaystyle',
    sovietEnabled: env.SOVIET_TOPO_TILE_SERVICE === 'indian-open-maps', googleMapsKey: env.GOOGLE_MAPS_API_KEY,
    tilesPerMinute: env.TILES_PER_MINUTE ? Number(env.TILES_PER_MINUTE) : undefined,
    totalTilesPerMinute: env.TOTAL_TILES_PER_MINUTE ? Number(env.TOTAL_TILES_PER_MINUTE) : undefined,
  });
  createServer(handler).listen(Number(env.PORT ?? 8080), '127.0.0.1');
}
