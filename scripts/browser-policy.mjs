const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const TILE_TEMPLATE_TOKEN = /\{[^{}]+\}/g;
const TILE_BODY_PATH = /\/\d+\/\d+\/\d+(?:\.[^/]+)?$/;
const COPIED_BODY_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie']);

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

function localOrmBase(mirror) {
  if (!mirror) return null;
  const base = new URL(mirror.endsWith('/') ? mirror : mirror + '/');
  if (!isLoopbackHttp(base) || base.search || base.hash)
    throw new Error('ATLAS_TEST_ORM_URL must be a local HTTP OpenRailwayMap instance on loopback, not a public proxy');
  return base;
}

export function localOrmTarget(original, mirror = process.env.ATLAS_TEST_ORM_URL) {
  const base = localOrmBase(mirror);
  if (!base) return null;
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

function maskedTileTemplate(value) {
  const tokens = [];
  const masked = String(value).replace(TILE_TEMPLATE_TOKEN, token => {
    const marker = `__atlas_tile_token_${tokens.length}__`;
    tokens.push([marker, token]);
    return marker;
  });
  return {masked, restore: text => tokens.reduce((result, [marker, token]) => result.replaceAll(marker, token), text)};
}

// TileJSON returned by the local server still controls the browser's next
// network destination. Resolve relative URLs against that local response,
// rewrite public ORM templates to the configured mirror, and reject every
// other host before Chromium can observe it.
export function localOrmTileTemplate(template, metadataTarget, mirror = process.env.ATLAS_TEST_ORM_URL) {
  if (typeof template !== 'string' || !template)
    throw new Error('Local OpenRailwayMap TileJSON contains an invalid tile template');
  const {masked, restore} = maskedTileTemplate(template);
  let resolved;
  try { resolved = new URL(masked, metadataTarget); }
  catch { throw new Error('Local OpenRailwayMap TileJSON contains an invalid tile template'); }
  if (isLoopbackHttp(resolved)) return restore(resolved.href);
  if (isPublicOrm(resolved)) {
    const base = localOrmBase(mirror);
    if (!base) throw new Error('ATLAS_TEST_ORM_URL is required to rewrite public OpenRailwayMap tile templates');
    // Force the provider path to remain relative to the configured mirror. A
    // path such as /https://tiles.example/... must never be reinterpreted as
    // a new absolute URL by the URL constructor.
    const rewritten = new URL('./' + resolved.pathname.replace(/^\/+/, '') + resolved.search + resolved.hash, base);
    if (!isLoopbackHttp(rewritten))
      throw new Error('Local OpenRailwayMap TileJSON rewrite escaped the loopback mirror');
    return restore(rewritten.href);
  }
  throw new Error('Local OpenRailwayMap TileJSON advertised a non-loopback tile URL');
}

export function sanitizeLocalOrmTileJson(tileJson, metadataTarget, mirror = process.env.ATLAS_TEST_ORM_URL) {
  if (!tileJson || typeof tileJson !== 'object' || Array.isArray(tileJson)) return tileJson;
  const safe = {...tileJson};
  for (const field of ['tiles', 'grids']) {
    if (!(field in safe)) continue;
    if (!Array.isArray(safe[field])) throw new Error(`Local OpenRailwayMap TileJSON ${field} must be an array`);
    safe[field] = safe[field].map(template => localOrmTileTemplate(template, metadataTarget, mirror));
  }
  return safe;
}

// Copy a fetched local response into a route.fulfill()-safe shape. TileJSON is
// inspected even when a local server omits its JSON Content-Type. Decoded body
// headers are removed, matching Playwright's body() semantics.
export async function localOrmFulfillOptions(response, target, mirror = process.env.ATLAS_TEST_ORM_URL) {
  const sourceHeaders = response.headers(), headers = {};
  for (const [name, value] of Object.entries(sourceHeaders))
    if (!COPIED_BODY_HEADERS.has(name.toLowerCase())) headers[name] = value;
  const body = Buffer.from(await response.body());
  const contentType = Object.entries(sourceHeaders).find(([name]) => name.toLowerCase() === 'content-type')?.[1] || '';
  let output = body;
  if (/json/i.test(contentType) || !TILE_BODY_PATH.test(new URL(target).pathname)) {
    let parsed;
    // Fetch/Response JSON decoding strips a UTF-8 BOM before JSON.parse. Match
    // that behavior here so BOM-prefixed TileJSON cannot bypass URL checks and
    // then parse successfully inside Chromium.
    const text = body.toString('utf8').replace(/^\uFEFF/, '');
    try { parsed = JSON.parse(text); } catch {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && ('tiles' in parsed || 'grids' in parsed)) {
      output = Buffer.from(JSON.stringify(sanitizeLocalOrmTileJson(parsed, target, mirror)));
      if (!Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
    }
  }
  return {status: response.status(), headers, body: output};
}

// route.fetch(maxRedirects: 0) returns a 3xx response rather than following it.
// Do not hand that response to Chromium: fulfilling it would let Chromium follow
// Location outside the local-only guard.
export async function fetchLoopbackNoRedirect(route, target, mirror = process.env.ATLAS_TEST_ORM_URL) {
  if (!isLoopbackHttp(target)) throw new Error('Local OpenRailwayMap fetch target must be loopback HTTP');
  const response = await route.fetch({url: target, maxRedirects: 0});
  if (response.status() >= 300 && response.status() < 400)
    throw new Error('Local OpenRailwayMap test server redirected; refusing to expose redirect to Chromium');
  // Lightweight fakes used by focused tests may not expose body/header APIs.
  // Real Playwright responses are wrapped so every caller, including custom
  // station routes, sees the same sanitized TileJSON and copied body headers.
  if (typeof response.headers !== 'function' || typeof response.body !== 'function') return response;
  const options = await localOrmFulfillOptions(response, target, mirror);
  return new Proxy(response, {get(original, property) {
    if (property === 'status') return () => options.status;
    if (property === 'headers') return () => ({...options.headers});
    if (property === 'body') return async () => Buffer.from(options.body);
    if (property === 'routeFulfillOptions') return () => ({...options, headers: {...options.headers}, body: Buffer.from(options.body)});
    const value = Reflect.get(original, property, original);
    return typeof value === 'function' ? value.bind(original) : value;
  }});
}
