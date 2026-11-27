import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.gz': 'application/gzip',
  '.pmtiles': 'application/octet-stream',
};

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ADMIN_COOKIE_NAME = 'atlas_admin_session';
const OAUTH_STATE_COOKIE = 'atlas_oauth_state';
const DEFAULT_ADMIN_REPO = 'c933103/openrailwaystyle';
const UPSTREAM_DATA_ORIGIN = 'https://10671435.xyz';
const RUNTIME_GITHUB_CONFIG_PATH = resolve('.aistudio', 'github-oauth.json');

// Road-deemphasized Google Maps style for 2D Map Tiles sessions:
// hides Google's built-in transit lines & commercial POIs and mutes roads into
// subdued warm neutrals beneath Railway Atlas's vector tracks & stations.
const ROAD_DEEMPHASIZED_TILE_STYLES = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ visibility: 'on' }, { color: '#e5ece1' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry.fill', stylers: [{ color: '#f3f2ea' }] },
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#bfd8e0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5c7c88' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#dfdace' }] },
  { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#e7e4dc' }] },
  { featureType: 'road.local', elementType: 'geometry.fill', stylers: [{ color: '#efede6' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#8a867c' }] },
  { featureType: 'road.highway', elementType: 'labels.text.stroke', stylers: [{ color: '#f4f3ec' }, { weight: 2 }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#949086' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.stroke', stylers: [{ color: '#f4f3ec' }, { weight: 2 }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#616d69' }] },
];

export interface AdminSessionClaims {
  sub: string;
  repo: string;
  admin: true;
  exp: number;
  n: string;
}

interface SignedStateClaims {
  redirectUri: string;
  frontendOrigin: string;
  exp: number;
  n: string;
}

function signPayload(data: object, secret: Buffer): string {
  const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
  return `${payload}.${signature}`;
}

function verifySignedPayload<T extends { exp?: unknown }>(
  token: string | undefined,
  secret: Buffer,
  now = Date.now(),
): T | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest();
  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (actualSig.length !== expectedSig.length || !crypto.timingSafeEqual(actualSig, expectedSig)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
    if (typeof decoded.exp !== 'number' || !Number.isFinite(decoded.exp) || decoded.exp <= now) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function issueAdminSession(
  login: string,
  repo: string,
  secret: Buffer,
  now = Date.now(),
  ttlMs = SESSION_TTL_MS,
): { token: string; login: string; repo: string; expiresAt: number } {
  const expiresAt = now + ttlMs;
  const claims: AdminSessionClaims = {
    sub: login,
    repo,
    admin: true,
    exp: expiresAt,
    n: crypto.randomBytes(12).toString('base64url'),
  };
  return {
    token: signPayload(claims, secret),
    login,
    repo,
    expiresAt,
  };
}

export function verifyAdminSession(
  token: string | undefined,
  expectedRepo: string,
  secret: Buffer,
  now = Date.now(),
): AdminSessionClaims | null {
  const claims = verifySignedPayload<AdminSessionClaims>(token, secret, now);
  if (!claims || claims.admin !== true || typeof claims.sub !== 'string' || !claims.sub) return null;
  if (claims.repo.toLowerCase() !== expectedRepo.toLowerCase()) return null;
  return claims;
}

function parseCookieHeader(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function isAllowedOrigin(candidate: string, configuredAppUrl: string): boolean {
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      // Normalize to pure origin check below
    }
    const host = url.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return true;
    if (url.protocol === 'https:' && (host === '10671435.xyz' || host === 'c933103.github.io')) return true;
    if (configuredAppUrl) {
      try {
        if (new URL(configuredAppUrl).origin === url.origin) return true;
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
}

function resolveRequestOrigin(req: Request, configuredAppUrl: string): string | null {
  const rawOrigin = typeof req.query.origin === 'string' ? req.query.origin.trim() : '';
  if (rawOrigin) {
    try {
      const parsed = new URL(rawOrigin);
      if (isAllowedOrigin(parsed.origin, configuredAppUrl)) return parsed.origin;
    } catch {}
    return null;
  }
  if (configuredAppUrl) {
    try {
      return new URL(configuredAppUrl).origin;
    } catch {}
  }
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader?.split(',')[0])?.trim() || req.protocol || 'http';
  const fwdHostHeader = req.headers['x-forwarded-host'];
  const fwdHost = (Array.isArray(fwdHostHeader) ? fwdHostHeader[0] : fwdHostHeader?.split(',')[0])?.trim();
  const host = fwdHost || req.headers.host;
  if (!host) return null;
  const derived = `${proto}://${host}`;
  return isAllowedOrigin(derived, configuredAppUrl) ? derived : null;
}

function renderPopupPostMessageHtml(payload: Record<string, unknown>, heading: string, detail: string, targetOrigin?: string): string {
  const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(heading)} · Railway Atlas</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #fffef9; color: #173e47; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
    .card { max-width: 380px; border: 1px solid #d7dfd9; border-radius: 12px; padding: 22px; background: #f6f8f3; }
    h1 { font-size: 17px; margin: 0 0 8px; }
    p { font-size: 13px; color: #52665d; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(detail)}</p>
  </div>
  <script>
    (function() {
      var message = ${safeJson};
      var targetOrigin = ${JSON.stringify(targetOrigin || '').replace(/</g,'\\u003c')};
      try {
        if (targetOrigin && window.opener && !window.opener.closed) {
          window.opener.postMessage(message, targetOrigin);
        }
      } catch (e) {}
      setTimeout(function() { window.close(); }, 250);
    })();
  </script>
</body>
</html>`;
}

export type GoogleTileVariant = 'satellite' | 'roadmap' | 'terrain';

interface CachedTileSession {
  session: string;
  expiresAtMs: number;
}

export interface RuntimeGitHubAppStore {
  clientId?: string;
  clientSecret?: string;
  slug?: string;
  isGitHubApp?: boolean;
  sessionSecretHex?: string;
}

function loadRuntimeStore(filePath: string): RuntimeGitHubAppStore {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    return raw && typeof raw === 'object' ? (raw as RuntimeGitHubAppStore) : {};
  } catch {
    return {};
  }
}

async function saveRuntimeStore(filePath: string, store: RuntimeGitHubAppStore): Promise<void> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(store, null, 2), { mode: 0o600 });
  } catch {}
}

function pairedRunAppCallbackUrls(origin: string): string[] {
  const urls = [`${origin}/auth/callback`, 'https://10671435.xyz/auth/callback'];
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && u.hostname.endsWith('.run.app')) {
      if (u.hostname.startsWith('ais-dev-')) {
        urls.push(`https://${u.hostname.replace(/^ais-dev-/, 'ais-pre-')}/auth/callback`);
      } else if (u.hostname.startsWith('ais-pre-')) {
        urls.push(`https://${u.hostname.replace(/^ais-pre-/, 'ais-dev-')}/auth/callback`);
      }
    }
  } catch {}
  return [...new Set(urls)];
}

export interface ServerOptions {
  root?: string;
  runtimeStorePath?: string | null;
  getApiKey?: () => string;
  getBrowserApiKey?: () => string;
  getGitHubConfig?: () => {
    clientId: string;
    clientSecret: string;
    adminRepo: string;
    scopes: string;
    appUrl: string;
    isGitHubApp?: boolean;
  };
  secret?: Buffer;
  fetcher?: typeof fetch;
  enableUpstreamDataFallback?: boolean;
}

export function createServerApp(options: ServerOptions = {}) {
  const root = resolve(options.root ?? 'styles');
  const runtimeStorePath =
    options.runtimeStorePath === undefined
      ? (process.env.ATLAS_ALLOW_GITHUB_APP_BOOTSTRAP === '1' ? RUNTIME_GITHUB_CONFIG_PATH : null)
      : options.runtimeStorePath;
  let runtimeStore: RuntimeGitHubAppStore = runtimeStorePath ? loadRuntimeStore(runtimeStorePath) : {};

  const envSecret = (process.env.SESSION_SECRET || '').trim();
  const sessionSecret = (() => {
    if (options.secret) return options.secret;
    if (envSecret) return crypto.createHash('sha256').update(envSecret, 'utf8').digest();
    if (runtimeStore.sessionSecretHex && /^[0-9a-f]{64}$/i.test(runtimeStore.sessionSecretHex)) {
      return Buffer.from(runtimeStore.sessionSecretHex, 'hex');
    }
    const generated = crypto.randomBytes(32);
    if (runtimeStorePath) {
      runtimeStore = { ...runtimeStore, sessionSecretHex: generated.toString('hex') };
      void saveRuntimeStore(runtimeStorePath, runtimeStore);
    }
    return generated;
  })();

  const getApiKey =
    options.getApiKey ??
    (() =>
      (
        process.env.GOOGLE_MAPS_PLATFORM_API_KEY ||
        process.env.GOOGLE_MAPS_API_KEY ||
        ''
      ).trim());

  const getBrowserApiKey = options.getBrowserApiKey ?? (() => (process.env.GOOGLE_MAPS_BROWSER_API_KEY || '').trim());

  const getGitHubConfig =
    options.getGitHubConfig ??
    (() => {
      const envClientId = (process.env.GITHUB_CLIENT_ID || process.env.CLIENT_ID || '').trim();
      const envClientSecret = (process.env.GITHUB_CLIENT_SECRET || process.env.CLIENT_SECRET || '').trim();
      const useEnv = Boolean(envClientId && envClientSecret);
      return {
        clientId: useEnv ? envClientId : (runtimeStore.clientId || '').trim(),
        clientSecret: useEnv ? envClientSecret : (runtimeStore.clientSecret || '').trim(),
        adminRepo: (process.env.GITHUB_ADMIN_REPO || DEFAULT_ADMIN_REPO).trim(),
        scopes: (process.env.GITHUB_OAUTH_SCOPES || 'read:user public_repo').trim(),
        appUrl: (process.env.APP_URL || '').trim(),
        isGitHubApp: useEnv ? envClientId.startsWith('Iv') : Boolean(runtimeStore.isGitHubApp),
      };
    });

  const fetcher = options.fetcher ?? globalThis.fetch;
  const enableUpstreamDataFallback = options.enableUpstreamDataFallback ?? true;

  const googleTileSessions = new Map<string, CachedTileSession>();

  const extractAdminClaims = (req: Request): AdminSessionClaims | null => {
    const { adminRepo } = getGitHubConfig();
    const auth = req.headers.authorization || '';
    const bearer = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(auth)?.[1];
    const cookieToken = parseCookieHeader(req.headers.cookie, ADMIN_COOKIE_NAME);
    for (const candidate of [bearer, cookieToken]) {
      const verified = verifyAdminSession(candidate, adminRepo, sessionSecret);
      if (verified) return verified;
    }
    return null;
  };

  const isHttpsRequest = (req: Request): boolean => {
    const proto = req.headers['x-forwarded-proto'];
    const first = Array.isArray(proto) ? proto[0] : proto?.split(',')[0];
    return first?.trim() === 'https' || req.secure;
  };

  const setAdminCookie = (req: Request, res: Response, token: string): void => {
    const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
    const attrs = isHttpsRequest(req)
      ? `Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=None`
      : `Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax`;
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs}`);
  };

  const clearAdminCookie = (req: Request, res: Response): void => {
    const attrs = isHttpsRequest(req)
      ? 'Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None'
      : 'Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=; ${attrs}`);
  };

  async function ensureGoogleTileSession(
    variant: GoogleTileVariant,
    language = 'en-US',
  ): Promise<{ ok: true; session: string } | { ok: false; status: number; serviceDisabled?: boolean; error: string }> {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { ok: false, status: 503, error: 'Google Maps API key is not configured on this server.' };
    }
    const safeLang = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) ? language : 'en-US';
    const cacheKey = `${apiKey.slice(0, 8)}:${variant}:${safeLang}`;
    const existing = googleTileSessions.get(cacheKey);
    if (existing && existing.expiresAtMs - Date.now() > 5 * 60 * 1000) {
      return { ok: true, session: existing.session };
    }

    const createUrl = `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(apiKey)}`;
    const buildBody = (includeStyles: boolean): Record<string, unknown> => {
      if (variant === 'satellite') {
        return { mapType: 'satellite', language: safeLang, region: 'US' };
      }
      if (variant === 'terrain') {
        return {
          mapType: 'terrain',
          language: safeLang,
          region: 'US',
          layerTypes: ['layerRoadmap'],
          ...(includeStyles ? { styles: ROAD_DEEMPHASIZED_TILE_STYLES } : {}),
        };
      }
      return {
        mapType: 'roadmap',
        language: safeLang,
        region: 'US',
        styles: ROAD_DEEMPHASIZED_TILE_STYLES,
      };
    };

    let response = await fetcher(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(true)),
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 400 && variant === 'terrain') {
      response = await fetcher(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(false)),
        signal: AbortSignal.timeout(10000),
      });
    }

    const text = await response.text();
    if (!response.ok) {
      const serviceDisabled =
        response.status === 403 &&
        !/RESOURCE_EXHAUSTED|quota/i.test(text);
      return {
        ok: false,
        status: response.status,
        serviceDisabled,
        error: text.slice(0, 400) || `Map Tiles session returned ${response.status}`,
      };
    }

    const parsed = JSON.parse(text) as { session?: string; expiry?: string | number };
    if (!parsed.session) {
      return { ok: false, status: 502, error: 'Map Tiles session response lacked a session token.' };
    }
    const expirySeconds = Number(parsed.expiry);
    const expiresAtMs = Number.isFinite(expirySeconds) && expirySeconds > 0
      ? expirySeconds * 1000
      : Date.now() + 24 * 60 * 60 * 1000;
    googleTileSessions.set(cacheKey, { session: parsed.session, expiresAtMs });
    return { ok: true, session: parsed.session };
  }

  const app = express();
  app.disable('x-powered-by');

  app.use(['/api/auth', '/api/gmaps', '/auth/callback', '/auth/manifest-callback'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    const gh = getGitHubConfig();
    if (originHeader && isAllowedOrigin(originHeader, gh.appUrl)) {
      res.setHeader('Access-Control-Allow-Origin', originHeader);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/auth/session', (req: Request, res: Response) => {
    const gh = getGitHubConfig();
    const oauthConfigured = Boolean(gh.clientId && gh.clientSecret);
    const claims = extractAdminClaims(req);
    if (!claims) {
      res.status(200).json({
        authenticated: false,
        admin: false,
        repo: gh.adminRepo,
        oauthConfigured,
        manifestBootstrapAvailable: Boolean(runtimeStorePath),
      });
      return;
    }
    res.status(200).json({
      authenticated: true,
      admin: true,
      login: claims.sub,
      repo: claims.repo,
      expiresAt: claims.exp,
      oauthConfigured,
      manifestBootstrapAvailable: Boolean(runtimeStorePath),
    });
  });

  app.get('/api/auth/github/url', (req: Request, res: Response) => {
    const gh = getGitHubConfig();
    const origin = resolveRequestOrigin(req, gh.appUrl);
    if (!origin) {
      res.status(400).json({ error: 'Invalid or disallowed callback origin.' });
      return;
    }
    // APP_URL identifies the backend, not the Pages frontend. GitHub must
    // return the OAuth code to the server that can exchange it.
    let callbackOrigin = origin;
    if (gh.appUrl) {
      try { callbackOrigin = new URL(gh.appUrl).origin; }
      catch { res.status(503).json({error:'Invalid backend APP_URL.'}); return; }
    }
    const redirectUri = `${callbackOrigin}/auth/callback`;
    const stateClaims: SignedStateClaims = {
      redirectUri,
      frontendOrigin:origin,
      exp: Date.now() + OAUTH_STATE_TTL_MS,
      n: crypto.randomBytes(12).toString('base64url'),
    };
    const state = signPayload(stateClaims, sessionSecret);

    if (!gh.clientId || !gh.clientSecret) {
      if (!runtimeStorePath) {
        res.status(503).json({
          oauthConfigured: false,
          repo: gh.adminRepo,
          error: 'GitHub OAuth is not configured on this server.',
        });
        return;
      }
      const suffix = crypto.randomBytes(3).toString('hex');
      const manifest = {
        name: `Railway Atlas Admin ${suffix}`,
        url: origin,
        redirect_url: `${callbackOrigin}/auth/manifest-callback`,
        callback_urls: pairedRunAppCallbackUrls(callbackOrigin),
        public: false,
        request_oauth_on_install: true,
        default_permissions: {
          metadata: 'read',
          administration: 'read',
        },
        default_events: [],
      };
      const actionUrl = `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
      res.status(200).json({
        mode: 'manifest',
        actionUrl,
        manifest: JSON.stringify(manifest),
        repo: gh.adminRepo,
      });
      return;
    }

    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', gh.clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    if (!gh.isGitHubApp && gh.scopes) {
      authorizeUrl.searchParams.set('scope', gh.scopes);
    }
    authorizeUrl.searchParams.set('state', state);
    res.status(200).json({ mode: 'oauth', url: authorizeUrl.href, repo: gh.adminRepo });
  });

  app.get(['/auth/manifest-callback', '/auth/manifest-callback/'], async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    const stateClaims = verifySignedPayload<SignedStateClaims>(state, sessionSecret);
    if (!code || !stateClaims || !runtimeStorePath) {
      res
        .status(400)
        .type('html')
        .send(
          renderPopupPostMessageHtml(
            { type: 'OAUTH_AUTH_ERROR', error: 'Invalid or expired GitHub App registration state.' },
            'Setup failed',
            'Invalid or expired GitHub App setup state. Close this window and try again.',
          ),
        );
      return;
    }

    try {
      const convertRes = await fetcher(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Railway-Atlas-Admin-SSO',
        },
        signal: AbortSignal.timeout(10000),
      });
      const converted = (await convertRes.json()) as {
        client_id?: string;
        client_secret?: string;
        slug?: string;
        message?: string;
      };
      if (!convertRes.ok || !converted.client_id || !converted.client_secret || !converted.slug) {
        const msg = converted.message || 'Could not complete GitHub App registration.';
        res
          .status(502)
          .type('html')
          .send(renderPopupPostMessageHtml({ type: 'OAUTH_AUTH_ERROR', error: msg }, 'Setup failed', msg));
        return;
      }

      runtimeStore = {
        ...runtimeStore,
        clientId: converted.client_id,
        clientSecret: converted.client_secret,
        slug: converted.slug,
        isGitHubApp: true,
      };
      await saveRuntimeStore(runtimeStorePath, runtimeStore);

      const nextState = signPayload(
        {
          redirectUri: stateClaims.redirectUri,
          frontendOrigin:stateClaims.frontendOrigin,
          exp: Date.now() + OAUTH_STATE_TTL_MS,
          n: crypto.randomBytes(12).toString('base64url'),
        } satisfies SignedStateClaims,
        sessionSecret,
      );
      const cookieAttrs = isHttpsRequest(req)
        ? 'Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax'
        : 'Path=/; Max-Age=600; HttpOnly; SameSite=Lax';
      res.setHeader('Set-Cookie', `${OAUTH_STATE_COOKIE}=${encodeURIComponent(nextState)}; ${cookieAttrs}`);
      res.redirect(302, `https://github.com/apps/${encodeURIComponent(converted.slug)}/installations/new?state=${encodeURIComponent(nextState)}`);
    } catch {
      res
        .status(502)
        .type('html')
        .send(
          renderPopupPostMessageHtml(
            { type: 'OAUTH_AUTH_ERROR', error: 'Could not reach GitHub to complete app registration.' },
            'Connection error',
            'Could not reach GitHub to complete app registration.',
          ),
        );
    }
  });

  app.get(['/auth/callback', '/auth/callback/'], async (req: Request, res: Response) => {
    const gh = getGitHubConfig();
    const queryState = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    const cookieState = parseCookieHeader(req.headers.cookie, OAUTH_STATE_COOKIE) || '';
    const stateClaims =
      verifySignedPayload<SignedStateClaims>(queryState, sessionSecret) ||
      verifySignedPayload<SignedStateClaims>(cookieState, sessionSecret);
    const frontendOrigin = stateClaims && isAllowedOrigin(stateClaims.frontendOrigin,gh.appUrl) ? stateClaims.frontendOrigin : '';
    if (typeof req.query.error === 'string' && req.query.error) {
      const desc = typeof req.query.error_description === 'string' ? req.query.error_description : req.query.error;
      res
        .status(400)
        .type('html')
        .send(
          renderPopupPostMessageHtml(
            { type: 'OAUTH_AUTH_ERROR', error: `GitHub sign-in cancelled: ${desc}` },
            'Sign-in cancelled',
            desc,
            frontendOrigin,
          ),
        );
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    if (!code || !stateClaims || typeof stateClaims.redirectUri !== 'string' || !frontendOrigin) {
      res
        .status(400)
        .type('html')
        .send(
          renderPopupPostMessageHtml(
            { type: 'OAUTH_AUTH_ERROR', error: 'Invalid or expired OAuth state. Try signing in again.' },
            'Authentication failed',
            'Invalid or expired OAuth state. Close this window and try again.',
            frontendOrigin,
          ),
        );
      return;
    }

    if (!gh.clientId || !gh.clientSecret) {
      res
        .status(503)
        .type('html')
        .send(
          renderPopupPostMessageHtml(
            { type: 'OAUTH_AUTH_ERROR', error: 'GitHub OAuth credentials are missing on the server.' },
            'Configuration missing',
            'GitHub OAuth credentials are not configured.',
            frontendOrigin,
          ),
        );
      return;
    }

    try {
      const tokenResponse = await fetcher('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Railway-Atlas-Admin-SSO',
        },
        body: JSON.stringify({
          client_id: gh.clientId,
          client_secret: gh.clientSecret,
          code,
          redirect_uri: stateClaims.redirectUri,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const tokenJson = (await tokenResponse.json()) as { access_token?: string; error_description?: string; error?: string };
      if (!tokenResponse.ok || !tokenJson.access_token) {
        const msg = tokenJson.error_description || tokenJson.error || 'Could not exchange GitHub authorization code.';
        res
          .status(401)
          .type('html')
          .send(renderPopupPostMessageHtml({ type: 'OAUTH_AUTH_ERROR', error: msg }, 'Sign-in failed', msg, frontendOrigin));
        return;
      }

      const ghHeaders = {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Railway-Atlas-Admin-SSO',
      };

      const [userRes, repoRes] = await Promise.all([
        fetcher('https://api.github.com/user', { headers: ghHeaders, signal: AbortSignal.timeout(10000) }),
        fetcher(`https://api.github.com/repos/${gh.adminRepo}`, { headers: ghHeaders, signal: AbortSignal.timeout(10000) }),
      ]);

      if (!userRes.ok) {
        res
          .status(401)
          .type('html')
          .send(
            renderPopupPostMessageHtml(
              { type: 'OAUTH_AUTH_ERROR', error: 'Could not read GitHub user profile.' },
              'Sign-in failed',
              'Could not verify your GitHub account.',
            frontendOrigin,
            ),
          );
        return;
      }

      const userData = (await userRes.json()) as { login?: string; id?: number };
      const login = (userData.login || '').trim();
      if (!login) {
        res
          .status(401)
          .type('html')
          .send(
            renderPopupPostMessageHtml(
              { type: 'OAUTH_AUTH_ERROR', error: 'GitHub profile returned no username.' },
              'Sign-in failed',
              'GitHub profile returned no username.',
            frontendOrigin,
            ),
          );
        return;
      }

      const repoData: {owner?: {id?: number}} = repoRes.ok ? await repoRes.json() as {owner?: {id?: number}} : {};
      // The site owner, not every collaborator with repository admin rights.
      const isAdmin = Number.isSafeInteger(userData.id) && userData.id === repoData.owner?.id;

      if (!isAdmin) {
        clearAdminCookie(req, res);
        const deniedMsg = `@${login} does not own ${gh.adminRepo}; administrator access denied.`;
        res
          .status(403)
          .type('html')
          .send(renderPopupPostMessageHtml({ type: 'OAUTH_AUTH_ERROR', error: deniedMsg }, 'Admin access required', deniedMsg, frontendOrigin));
        return;
      }

      const session = issueAdminSession(login, gh.adminRepo, sessionSecret);
      setAdminCookie(req, res, session.token);
      res
        .status(200)
        .type('html')
        .send(
          renderPopupPostMessageHtml(
            { type: 'OAUTH_AUTH_SUCCESS', session },
            'Admin verified',
            `Signed in as @${login}. This window will close automatically.`,
            frontendOrigin,
          ),
        );
    } catch {
      res
        .status(502)
        .type('html')
        .send(
          renderPopupPostMessageHtml(
            { type: 'OAUTH_AUTH_ERROR', error: 'GitHub verification request failed. Try again.' },
            'Connection error',
            'Could not reach GitHub to verify repository permissions.',
            frontendOrigin,
          ),
        );
    }
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    clearAdminCookie(req, res);
    res.status(200).json({ authenticated: false });
  });

  app.post('/api/gmaps/session', express.json({ limit: '4kb' }), async (req: Request, res: Response) => {
    const claims = extractAdminClaims(req);
    if (!claims) {
      res.status(401).json({ locked: true, error: 'Repository admin sign-in required.' });
      return;
    }
    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(503).json({ error: 'Google Maps API key is not configured on this server.' });
      return;
    }
    const rawVariant = typeof req.body?.variant === 'string' ? req.body.variant : 'satellite';
    const variant: GoogleTileVariant =
      rawVariant === 'roadmap' || rawVariant === 'terrain' ? rawVariant : 'satellite';
    const language = typeof req.body?.language === 'string' && req.body.language !== 'local'
      ? req.body.language
      : 'en-US';

    try {
      const tileSession = await ensureGoogleTileSession(variant, language);
      if (tileSession.ok) {
        res.status(200).json({
          unlocked: true,
          mode: 'tiles',
          variant,
          maxzoom: 22,
          tileUrl: `/api/gmaps/tiles/${variant}/{z}/{x}/{y}`,
        });
        return;
      }
      if (tileSession.status === 429 || /RESOURCE_EXHAUSTED/i.test(tileSession.error)) {
        res.status(429).json({ error: 'RESOURCE_EXHAUSTED: Google Map Tiles quota exceeded.' });
        return;
      }
      const browserKey = getBrowserApiKey();
      if (tileSession.serviceDisabled && browserKey) {
        res.status(200).json({
          unlocked: true,
          mode: 'js-fallback',
          variant,
          apiKey:browserKey,
          note: 'Map Tiles API is not enabled on this API key; using Maps JavaScript API fallback in flat 2D view. Enable Map Tiles API in Google Cloud Console to drape Google tiles on 3D terrain and the 3D globe.',
        });
        return;
      }
      res.status(tileSession.status).json({ error: tileSession.error });
    } catch {
      res.status(502).json({ error: 'Could not initialize Google Map Tiles session.' });
    }
  });

  app.get('/api/gmaps/tiles/:variant/:z/:x/:y', async (req: Request, res: Response) => {
    const claims = extractAdminClaims(req);
    if (!claims) {
      res.status(401).json({ locked: true, error: 'Repository admin sign-in required.' });
      return;
    }
    const rawVariant = req.params.variant;
    const variant: GoogleTileVariant | null =
      rawVariant === 'satellite' || rawVariant === 'roadmap' || rawVariant === 'terrain' ? rawVariant : null;
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const maxCoord = Number.isInteger(z) && z >= 0 && z <= 22 ? 2 ** z : 0;
    if (!variant || !maxCoord || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= maxCoord || y < 0 || y >= maxCoord) {
      res.status(400).json({ error: 'Invalid tile coordinates.' });
      return;
    }
    const language = typeof req.query.lang === 'string' && req.query.lang !== 'local' ? req.query.lang : 'en-US';
    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(503).json({ error: 'Google Maps API key is not configured on this server.' });
      return;
    }

    try {
      const tileSession = await ensureGoogleTileSession(variant, language);
      if (!tileSession.ok) {
        res.status(tileSession.status).json({ error: tileSession.error });
        return;
      }
      const upstreamUrl = `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(tileSession.session)}&key=${encodeURIComponent(apiKey)}`;
      const upstream = await fetcher(upstreamUrl, { signal: AbortSignal.timeout(12000) });
      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-store');
      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.end(bytes);
    } catch {
      res.status(502).end();
    }
  });

  app.get('/api/gmaps/viewport', async (req: Request, res: Response) => {
    const claims = extractAdminClaims(req);
    if (!claims) {
      res.status(401).json({ locked: true, error: 'Repository admin sign-in required.' });
      return;
    }
    const rawVariant = typeof req.query.variant === 'string' ? req.query.variant : 'satellite';
    const variant: GoogleTileVariant =
      rawVariant === 'roadmap' || rawVariant === 'terrain' ? rawVariant : 'satellite';
    const zoom = Math.max(0, Math.min(22, Math.round(Number(req.query.zoom) || 0)));
    const coordinate = (value: unknown, fallback: number, limit: number) => {
      const parsed = typeof value === 'string' && value.trim() ? Number(value) : NaN;
      return Number.isFinite(parsed) ? Math.max(-limit, Math.min(limit, parsed)) : fallback;
    };
    const north = coordinate(req.query.north, 85, 89.9999);
    const south = coordinate(req.query.south, -85, 89.9999);
    const east = coordinate(req.query.east, 180, 180);
    const west = coordinate(req.query.west, -180, 180);
    const language = typeof req.query.lang === 'string' && req.query.lang !== 'local' ? req.query.lang : 'en-US';
    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(503).json({ error: 'Google Maps API key is not configured on this server.' });
      return;
    }

    try {
      const tileSession = await ensureGoogleTileSession(variant, language);
      if (!tileSession.ok) {
        res.status(tileSession.status).json({ error: tileSession.error });
        return;
      }
      const viewportUrl = new URL('https://tile.googleapis.com/tile/v1/viewport');
      viewportUrl.searchParams.set('session', tileSession.session);
      viewportUrl.searchParams.set('key', apiKey);
      viewportUrl.searchParams.set('zoom', String(zoom));
      viewportUrl.searchParams.set('north', String(Math.max(north, south)));
      viewportUrl.searchParams.set('south', String(Math.min(north, south)));
      viewportUrl.searchParams.set('east', String(east));
      viewportUrl.searchParams.set('west', String(west));
      const upstream = await fetcher(viewportUrl, { signal: AbortSignal.timeout(8000) });
      const text = await upstream.text();
      res.status(upstream.status).type('application/json').send(text);
    } catch {
      res.status(502).json({ error: 'Could not retrieve viewport attribution.' });
    }
  });

  app.get('/api/gmaps/config', (req: Request, res: Response) => {
    const claims = extractAdminClaims(req);
    if (!claims) {
      res.status(401).json({ locked: true, error: 'Repository admin sign-in required.' });
      return;
    }
    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(503).json({ error: 'Google Maps API key is not configured on this server.' });
      return;
    }
    // A separately configured, referrer-restricted browser key is public by design.
    // Never return the server-side Map Tiles API credential.
    const browserKey = getBrowserApiKey();
    res.status(200).json({ unlocked: true, ...(browserKey ? {apiKey:browserKey} : {}) });
  });

  app.use(async (req: Request, res: Response) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).end();
      return;
    }
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      const decodedPathname = decodeURIComponent(parsed.pathname);
      const relativeTarget = '.' + decodedPathname.replace(/\/$/, '/index.html');
      const filePath = resolve(root, relativeTarget);
      if (!filePath.startsWith(root + sep)) {
        res.status(403).end();
        return;
      }

      let localExists = false;
      try {
        localExists = (await stat(filePath)).isFile();
      } catch {
        localExists = false;
      }

      if (!localExists) {
        if (
          enableUpstreamDataFallback &&
          (/^\/data\/[\w./-]+$/.test(decodedPathname) || /^\/fonts\/[\w./-]+$/.test(decodedPathname)) &&
          !decodedPathname.includes('..')
        ) {
          const upstreamUrl = new URL(decodedPathname, UPSTREAM_DATA_ORIGIN);
          const headers: Record<string, string> = {};
          if (typeof req.headers.range === 'string') headers.Range = req.headers.range;
          const upstream = await fetcher(upstreamUrl, {
            method: req.method,
            headers,
            signal: AbortSignal.timeout(15000),
          });
          res.status(upstream.status);
          for (const headerName of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag']) {
            const val = upstream.headers.get(headerName);
            if (val) res.setHeader(headerName, val);
          }
          if (req.method === 'HEAD' || !upstream.body) {
            res.end();
            return;
          }
          const bodyBytes = Buffer.from(await upstream.arrayBuffer());
          res.end(bodyBytes);
          return;
        }
        res.status(404).end();
        return;
      }

      file = await open(filePath, 'r');
      const info = await file.stat();
      if (res.destroyed) return;
      if (!info.isFile()) {
        res.status(404).end();
        return;
      }
      const mime = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
      const rangeMatch = typeof req.headers.range === 'string' ? /^bytes=(\d+)-(\d*)$/.exec(req.headers.range) : null;
      const start = rangeMatch ? Number(rangeMatch[1]) : 0;
      const end = rangeMatch
        ? Math.min(rangeMatch[2] ? Number(rangeMatch[2]) : info.size - 1, info.size - 1)
        : info.size - 1;
      if (rangeMatch && (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end)) {
        res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
        return;
      }
      const length = Math.max(0, end - start + 1);
      res.writeHead(rangeMatch ? 206 : 200, {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Content-Length': length,
        ...(rangeMatch ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
      });
      if (req.method === 'HEAD' || length === 0) {
        res.end();
        return;
      }
      const stream = file.createReadStream({ start, end });
      await pipeline(stream, res, { end: false });
      if (stream.bytesRead !== length) res.destroy();
      else res.end();
    } catch {
      if (res.headersSent) res.destroy();
      else if (!res.destroyed) res.status(404).end();
    } finally {
      await file?.close().catch(() => {});
    }
  });

  return app;
}

function resolveListenPort(): number {
  const explicitAppPort = Number(process.env.APP_PORT) || Number(process.env.DEFAULT_APP_PORT);
  if (explicitAppPort > 0) return explicitAppPort;
  if (process.env.npm_lifecycle_event === 'dev' || existsSync('/app/control-plane-api')) {
    return 3000;
  }
  return Number(process.env.PORT) || 3000;
}

const isEntrypoint = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
);

export async function startServer() {
    if (
      !existsSync(resolve('styles', 'vendor', 'tile-labels.js')) ||
      !existsSync(resolve('styles', 'vendor', 'google-maps-loader.js'))
    ) {
      await import('../scripts/build-browser.mjs');
    }
    const host = '0.0.0.0';
    const initialPort = resolveListenPort();
    const app = createServerApp();

    const startListening = (port: number) => {
      const server = app.listen(port, host, () => {
        console.log(`Railway Atlas server listening on http://${host}:${port}`);
      });
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port !== 3000) {
          console.warn(`Port ${port} is already in use; falling back to port 3000.`);
          startListening(3000);
          return;
        }
        throw err;
      });
    };

    startListening(initialPort);
}

if (isEntrypoint) void startServer();
