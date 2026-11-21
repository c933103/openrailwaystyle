export function restrictedTileOrigin(input, href) {
  try {
    const url = new URL(input);
    if (url.origin !== input) return null;
    return url.protocol === 'https:' || (url.hostname === '127.0.0.1' && url.origin === new URL(href).origin)
      ? url.origin : null;
  } catch { return null; }
}

const SOVIET_ROOT = 'https://indianopenmaps.com/world/topo/russian/';
const GOOGLE_ROOT = 'https://tile.googleapis.com/';
const SESSION_MS = 15 * 60_000;

export async function verifiedRepositoryOwner(github, repository) {
  const [account, repo] = await Promise.all([github('user'), github('repos/' + repository)]);
  if (!account.ok || !repo.ok) return null;
  const [user, details] = await Promise.all([account.json(), repo.json()]);
  const id = user?.id, owner = details?.owner;
  return Number.isSafeInteger(id) && id > 0 && owner?.type === 'User' && id === owner.id ? id : null;
}

export function parseStaticTileSettings(value) {
  const [repository, googleKey, historical, ...extra] = (value ?? '').split('|');
  if (extra.length || !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
      (googleKey && !/^[A-Za-z0-9_-]{20,}$/.test(googleKey)) ||
      !['', 'indian-open-maps'].includes(historical) || (!googleKey && !historical)) return null;
  return {repository, googleKey, soviet: Boolean(historical)};
}

export function createStaticRestrictedTiles({settings, window, fetcher, changed, report, now = Date.now}) {
  let active, verification, expire;
  const minute = 60_000, limit = 120;
  let budgetStart = now(), used = 0;
  const request = (url, options = {}) => fetcher(url, {
    ...options, cache:'no-store', credentials:'omit', redirect:'error',
  });
  function clear(message) {
    active?.controller.abort();
    verification?.abort();
    active = verification = undefined;
    window.clearTimeout(expire);
    changed(null);
    report(message);
  }
  async function google(requestPath, session, signal) {
    const tile = /^(\d{1,2})\/(\d{1,8})\/(\d{1,8})$/.exec(requestPath);
    const viewport = requestPath.startsWith('viewport?');
    if (!viewport) {
      if (!tile) return new Response(null, {status:400});
      const [z,x,y] = tile.slice(1).map(Number);
      if (z > 22 || x >= 2 ** z || y >= 2 ** z) return new Response(null, {status:400});
    }
    const target = new URL(viewport ? 'tile/v1/viewport' : 'v1/2dtiles/' + requestPath, GOOGLE_ROOT);
    if (viewport) {
      const parameters = new URLSearchParams(requestPath.slice('viewport?'.length));
      for (const name of ['zoom','south','north','west','east']) target.searchParams.set(name, parameters.get(name) ?? '');
    }
    if (!session.google || session.google.expiresAt <= now()) {
      session.googleRequest ??= (async () => {
        const endpoint = new URL('v1/createSession', GOOGLE_ROOT);
        endpoint.searchParams.set('key', settings.googleKey);
        const result = await request(endpoint, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({mapType:'satellite', language:'en-US', region:'US'}),
          signal:AbortSignal.any([session.controller.signal, AbortSignal.timeout(8000)]),
        });
        if (!result.ok) {
          await result.body?.cancel();
          return {error:result.status};
        }
        const info = await result.json(), expiresAt = Number(info.expiry) * 1000;
        if (typeof info.session !== 'string' || !info.session || !Number.isFinite(expiresAt) || expiresAt <= now()) return {error:502};
        return {token:info.session, expiresAt};
      })().finally(() => {session.googleRequest = undefined;});
      const opened = await session.googleRequest;
      if (opened.error) return new Response(null,{status:opened.error});
      session.google = opened;
    }
    signal.throwIfAborted();
    target.searchParams.set('key', settings.googleKey);
    target.searchParams.set('session', session.google.token);
    return request(target, {signal});
  }
  async function soviet(path, signal) {
    const match = /^(1m|500k)\/(tiles\.json|\d+\/\d+\/\d+)$/.exec(path);
    if (!match) return new Response(null,{status:400});
    const [, series, resource] = match;
    const root = `${SOVIET_ROOT}${series}/gs/`;
    const metadata = resource === 'tiles.json';
    const result = await request(root + resource + (metadata ? '' : '.webp'), {signal});
    if (!metadata || !result.ok) return result;
    const {tiles, minzoom, maxzoom, scheme} = await result.json();
    if (tiles?.length !== 1 || tiles[0] !== root + '{z}/{x}/{y}.webp' || (scheme && scheme !== 'xyz'))
      return new Response(null,{status:502});
    return Response.json({minzoom, maxzoom});
  }
  return {
    async signIn(value) {
      if (active || verification) return;
      if (!/^github_pat_[A-Za-z0-9_]+$/.test(value ?? '')) {
        report('Enter a fine-grained GitHub token.');
        return;
      }
      const controller = verification = new AbortController();
      try {
        report('Checking the repository owner with GitHub…');
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
        const owner = await verifiedRepositoryOwner(path => request('https://api.github.com/' + path, {
          signal, headers:{Authorization:'Bearer ' + value, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2026-03-10'},
        }), settings.repository);
        if (!owner) {
          if (!controller.signal.aborted) report('GitHub did not confirm repository ownership.');
          return;
        }
        if (controller.signal.aborted) return;
        active = {controller:new AbortController(), expiresAt:now() + SESSION_MS, pausedUntil:0};
        expire = window.setTimeout(() => clear('Session expired. Verify your GitHub token again.'), SESSION_MS);
        report('Repository owner verified. Select a test background.');
        changed({soviet:settings.soviet, google:Boolean(settings.googleKey)});
      } catch {
        if (!controller.signal.aborted) report('GitHub verification could not complete. Try again.');
      } finally {
        if (verification === controller) verification = undefined;
      }
    },
    signOut() {clear('Signed out.');},
    async fetch(path, options = {}) {
      const session = active;
      if (!session || session.expiresAt <= now()) {
        if (session) clear('Session expired. Verify your GitHub token again.');
        throw new Error('Repository owner verification required');
      }
      const separator = path.indexOf('/');
      const source = path.slice(0, separator), resource = path.slice(separator + 1);
      if ((source !== 'soviet' || !settings.soviet) && (source !== 'google' || !settings.googleKey))
        throw new Error('Test background is disabled');
      if (now() - budgetStart >= minute) { budgetStart = now(); used = 0; }
      const wait = Math.max(session.pausedUntil, used >= limit ? budgetStart + minute : 0) - now();
      if (wait > 0) return new Response(null,{status:429,headers:{'Retry-After':String(Math.ceil(wait / 1000))}});
      used++;
      const signal = AbortSignal.any([session.controller.signal, ...(options.signal ? [options.signal] : [])]);
      const result = source === 'google' ? await google(resource, session, signal) : await soviet(resource, signal);
      if (result.status === 429) session.pausedUntil = now() + 30_000;
      return result;
    },
  };
}

export function createRestrictedTiles({origin, window, fetcher, changed, report, showCode}) {
  let session, lifetime, expiry, challenge;
  const key = /^[A-Za-z0-9_-]{43}$/;
  const request = (path, {signal, method = 'GET', authorization} = {}) => fetcher(`${origin}/restricted/${path}`, {
    method, signal, redirect: 'error', cache: 'no-store', credentials: 'omit',
    headers: {...(method !== 'GET' && {'X-Atlas-Preview':'1'}), ...(authorization && {Authorization:authorization})},
  });
  function clear(message) {
    const previous = session;
    session = undefined;
    lifetime?.abort();
    window.clearTimeout(expiry);
    changed(null);
    if (message) report(message);
    return previous;
  }
  async function poll(ticket) {
    while (Date.now() < ticket.expiresAt) {
      await new Promise(resolve => window.setTimeout(resolve, 1100));
      const response = await request('auth/device', {
        authorization: 'Device ' + ticket.challenge, signal: AbortSignal.timeout(10000),
      });
      if (response.status === 202) continue;
      if (response.status === 403) {
        report('Only the repository owner can use these backgrounds.');
        return;
      }
      if (response.status === 410) break;
      if (!response.ok) throw new Error('GitHub sign-in unavailable');
      const next = await response.json();
      if (!key.test(next?.token ?? '') || !Number.isFinite(next.expiresAt) || next.expiresAt <= Date.now() ||
          !(next.soviet === true || next.google === true)) throw new Error('Invalid admin preview session');
      session = next;
      lifetime = new AbortController();
      expiry = window.setTimeout(() => clear('Session expired. Sign in again.'), Math.min(next.expiresAt - Date.now(), 15 * 60_000));
      report('Signed in. Select a test background.');
      changed({soviet: next.soviet === true, google: next.google === true});
      return;
    }
    report('Sign-in code expired. Try again.');
  }
  return {
    async signIn() {
      if (session || challenge) return;
      challenge = true;
      try {
        report('Getting a GitHub sign-in code…');
        const response = await request('auth/device', {method:'POST', signal:AbortSignal.timeout(10000)});
        if (!response.ok) throw new Error('GitHub sign-in unavailable');
        const ticket = await response.json();
        if (!key.test(ticket?.challenge ?? '') || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(ticket.userCode ?? '') ||
            !Number.isFinite(ticket.expiresAt) || ticket.expiresAt <= Date.now()) throw new Error('Invalid GitHub sign-in code');
        report('Waiting for GitHub approval…');
        showCode(ticket.userCode);
        await poll(ticket);
      } catch {
        report('Sign-in could not complete. Try again.');
      } finally {
        challenge = false;
        showCode(null);
      }
    },
    signOut() {
      const previous = clear('Signed out.');
      if (previous) void request('auth/session', {
        method: 'DELETE', authorization:'Bearer ' + previous.token, signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    },
    async fetch(path, options = {}) {
      const active = session;
      if (!active || active.expiresAt <= Date.now()) {
        if (active) clear('Session expired. Sign in again.');
        throw new Error('Restricted tile sign-in required');
      }
      if (!/^(?:soviet\/(?:1m|500k)\/(?:tiles\.json|\d+\/\d+\/\d+)|google\/(?:\d+\/\d+\/\d+|viewport\?[\w%.=+&-]+))$/.test(path))
        throw new Error('Unknown restricted tile route');
      const signal = AbortSignal.any([lifetime.signal, ...(options.signal ? [options.signal] : [])]);
      const response = await request(path, {signal, authorization: 'Bearer ' + active.token});
      if (active === session && response.status === 401) clear('Session expired. Sign in again.');
      return response;
    },
  };
}

export const GOOGLE_PREVIEW = 'google-satellite-preview';

export function installGooglePreviewProtocol(maplibre, restrictedFetch) {
  maplibre.addProtocol('atlasgoogletest', async ({url}, {signal}) => {
    const path = url.split('://')[1];
    const response = await restrictedFetch('google/' + path, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(9000)]),
    });
    if (!response.ok) throw new Error(`Google preview tile returned HTTP ${response.status}`);
    return {data: await response.arrayBuffer()};
  });
}

export async function googleViewport(map, restrictedFetch, signal) {
  const area = map.getBounds();
  const zoom = Math.max(0, Math.min(22, Math.round(map.getZoom() + 1)));
  const south = Math.max(-90, area.getSouth()), north = Math.min(90, area.getNorth());
  const rawWest = area.getWest(), rawEast = area.getEast();
  const west = ((rawWest + 180) % 360 + 360) % 360 - 180;
  const width = ((rawEast - rawWest) % 360 + 360) % 360;
  const east = west + width;
  const ranges = Math.abs(rawEast - rawWest) >= 360 ? [[-180, 180]]
    : east > 180 ? [[west, 180], [-180, east - 360]] : [[west, east]];
  const credits = await Promise.all(ranges.map(async ([west, east]) => {
    const viewport = new URLSearchParams({zoom, south, north, west, east});
    const result = await restrictedFetch('google/viewport?' + viewport, {signal});
    if (!result.ok) throw new Error('Google preview attribution unavailable');
    const {copyright} = await result.json();
    if (typeof copyright !== 'string' || !copyright.trim()) throw new Error('Missing Google Maps attribution');
    return copyright;
  }));
  return [...new Set(credits)].join(' · ');
}

export function addGooglePreviewLayer(map) {
  map.addSource(GOOGLE_PREVIEW, {
    type:'raster', tiles:['atlasgoogletest://{z}/{x}/{y}'], tileSize:256, maxzoom:22,
  });
  map.addLayer({
    id:GOOGLE_PREVIEW, source:GOOGLE_PREVIEW, type:'raster', layout:{visibility:'none'},
    metadata:{'atlas:semantics-version':1, 'atlas:background':'google'},
    paint:{'raster-fade-duration':0},
  }, 'energy-overview-areas');
}
