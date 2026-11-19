export function restrictedTileOrigin(input, href) {
  try {
    const url = new URL(input);
    if (url.origin !== input) return null;
    return url.protocol === 'https:' || (url.hostname === '127.0.0.1' && url.origin === new URL(href).origin)
      ? url.origin : null;
  } catch { return null; }
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
        report('This GitHub account does not have repository admin access.');
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
