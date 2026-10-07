const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isPublicOrm(url) {
  try {
    const u = new URL(url?.href ?? url);
    return ['http:', 'https:'].includes(u.protocol) &&
      (u.hostname === 'openrailwaymap.app' || u.hostname.endsWith('.openrailwaymap.app'));
  } catch { return false; }
}

export function isLoopbackHttp(url) {
  try {
    const u = new URL(url?.href ?? url);
    return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname) && !u.username && !u.password;
  } catch { return false; }
}

export function localOrmTarget(original, mirror = process.env.ATLAS_TEST_ORM_URL) {
  if (!mirror) return null;
  const base = new URL(mirror.endsWith('/') ? mirror : mirror + '/');
  if (!isLoopbackHttp(base) || base.search || base.hash)
    throw new Error('ATLAS_TEST_ORM_URL must be a local HTTP OpenRailwayMap instance on loopback, not a public proxy');
  if (!isPublicOrm(original)) throw new Error('Only openrailwaymap.app URLs may be mirrored');
  const source = new URL(original);
  return new URL(source.pathname.replace(/^\//, '') + source.search, base).href;
}

// Geographic audits may encounter either public provider URLs that need to be
// rewritten to ATLAS_TEST_ORM_URL, or natural loopback URLs advertised by the
// local server itself. Nothing else is allowed through this boundary.
export function localOrmAuditTarget(original, mirror = process.env.ATLAS_TEST_ORM_URL) {
  if (isPublicOrm(original)) {
    const target = localOrmTarget(original, mirror);
    if (!target) throw new Error('ATLAS_TEST_ORM_URL is required for public OpenRailwayMap URLs in automated geographic checks');
    return target;
  }
  if (isLoopbackHttp(original)) return new URL(original).href;
  throw new Error('Automated geographic checks may fetch OpenRailwayMap data only from loopback HTTP URLs');
}

// route.fetch(maxRedirects: 0) returns a 3xx response rather than following it.
// Do not hand that response to Chromium: fulfilling it would let Chromium follow
// Location outside the local-only guard.
export async function fetchLoopbackNoRedirect(route, target) {
  if (!isLoopbackHttp(target)) throw new Error('Local OpenRailwayMap fetch target must be loopback HTTP');
  const response = await route.fetch({url: target, maxRedirects: 0});
  if (response.status() >= 300 && response.status() < 400)
    throw new Error('Local OpenRailwayMap test server redirected; refusing to expose redirect to Chromium');
  return response;
}
