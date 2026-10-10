// Fail-closed transport for browser checks. Fixture handlers may fulfill any
// URL, but can never send an unapproved provider request via continue/fetch.
// Only local HTTP and the explicitly selected first-party deployment are read.
import {isLoopbackHttp} from './browser-policy.mjs';
import {setTimeout as delay} from 'node:timers/promises';

// Playwright 1.56.1 serializes errors without Node's `code`. Match only its
// exact reset headline, never an HTTP response body or the appended call log.
const transportReset = error => error?.code === 'ECONNRESET' ||
  (error?.name === 'Error' && /^route\.fetch: (?:socket hang up|read ECONNRESET)$/.test(error.message?.split('\n', 1)[0]));

export function browserNetworkAllowed(value, bases = []) {
  let url;
  try { url = new URL(value?.href ?? value); } catch { return false; }
  if (url.username || url.password) return false;
  if (isLoopbackHttp(url)) return true;
  return url.protocol === 'https:' && bases.some(value => {
    const base = new URL(value.endsWith('/') ? value : value + '/');
    return !base.username && !base.password && url.origin === base.origin && url.pathname.startsWith(base.pathname);
  });
}

export function firstPartyBases(env = process.env) {
  return [env.MAP_BASE_URL, env.ATLAS_FIXTURE_BASE_URL, env.ATLAS_TEST_URL].filter(Boolean);
}

// Redirects are rejected, not followed by either Playwright or Chromium. A
// route is only consulted for a redirect chain's first URL; checking Location
// after an ordinary continue() would therefore already be too late.
export async function guardBrowserNetwork(context, {bases = firstPartyBases(), blocked = [], warn = console.warn} = {}) {
  const remember = value => {
    const url = new URL(value);
    blocked.push(url.origin + url.pathname); // Never log query strings/credentials.
  };
  const abort = async (route, value) => { remember(value); return route.abort('blockedbyclient'); };
  const responseSafe = async (response, target) => {
    if (response.status() >= 300 && response.status() < 400) {
      remember(target);
      await response.dispose?.();
      throw new Error('Browser test server redirected; refusing unguarded redirect egress');
    }
    return response;
  };
  const fetch = async (route, options, target) => {
    const request = route.request(), method = (options.method || request.method?.() || '').toUpperCase();
    // Only bodyless, idempotent local reads may be repeated. Pin the checked
    // URL and disable Playwright's own retries so callers cannot multiply this
    // two-attempt budget or retry a deployment/provider request.
    const retry = isLoopbackHttp(target) && ['GET', 'HEAD'].includes(method) &&
      options.postData === undefined && !request.postDataBuffer?.();
    const transport = {...options, url: target, maxRedirects: 0, maxRetries: 0};
    const label = method + ' ' + new URL(target).origin + new URL(target).pathname;
    for (let attempt = 1; ; attempt++) {
      if (!browserNetworkAllowed(target, bases)) throw new Error('Browser test attempted a non-fixture provider fetch');
      try {
        const response = await route.fetch(transport);
        if (attempt > 1) warn(`Loopback browser request returned on attempt ${attempt}/2: ${label}`);
        return response;
      } catch (error) {
        if (!retry || !transportReset(error)) throw error;
        if (attempt === 2) {
          warn(`Loopback browser request exhausted 2/2 attempts after ECONNRESET: ${label}`);
          throw error;
        }
        warn(`Loopback browser request ECONNRESET on attempt 1/2; retrying 2/2: ${label}`);
        await delay(250);
      }
    }
  };
  const protect = route => new Proxy(route, {get(original, property) {
    if (property === 'fallback') return async (options = {}) => {
      // Check explicit rewrites immediately rather than relying on a later
      // Playwright handler to expose its accumulated fallback overrides.
      if (options.url && !browserNetworkAllowed(options.url, bases)) return abort(original, options.url);
      return original.fallback(options);
    };
    if (property === 'fetch') return async (options = {}) => {
      const target = options.url || original.request().url();
      if (!browserNetworkAllowed(target, bases)) {
        remember(target);
        throw new Error('Browser test attempted a non-fixture provider fetch');
      }
      return responseSafe(await fetch(original, options, target), target);
    };
    if (property === 'continue') return async (options = {}) => {
      const target = options.url || original.request().url();
      if (!browserNetworkAllowed(target, bases)) return abort(original, target);
      try {
        const response = await responseSafe(await fetch(original, options, target), target);
        try {
          // APIResponse.body() is decoded. Replaying compression/length headers
          // would misdescribe the actual fetched bytes, especially on Pages.
          const headers = {...response.headers()};
          for (const name of Object.keys(headers)) if (/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(name)) delete headers[name];
          return await original.fulfill({status: response.status(), headers, body: await response.body()});
        } finally { await response.dispose?.(); }
      } catch (error) {
        await original.abort('failed').catch(() => {});
        // Request failures still reach the browser. Redirects are remembered
        // above and make browser.close() fail even if the app tolerates them.
        if (!blocked.length) console.warn('First-party test request failed:', error.message);
      }
    };
    if (property === 'fulfill') return async (options = {}) => {
      const status = options.status ?? options.response?.status() ?? 200;
      if (status >= 300 && status < 400) return abort(original, original.request().url());
      return original.fulfill(options);
    };
    const value = Reflect.get(original, property, original);
    return typeof value === 'function' ? value.bind(original) : value;
  }});
  const protectSocket = socket => new Proxy(socket, {get(original, property) {
    if (property === 'connectToServer') return () => {
      remember(original.url());original.close();
      throw new Error('Browser tests may not connect WebSockets to external servers');
    };
    const value = Reflect.get(original, property, original);
    return typeof value === 'function' ? value.bind(original) : value;
  }});
  const patched = new WeakSet();
  const wrapRoutes = owner => {
    if (patched.has(owner)) return;
    patched.add(owner);
    const register = owner.route.bind(owner), unregister = owner.unroute.bind(owner), handlers = new WeakMap();
    owner.route = async (match, handler, options) => {
      let wrapped = handlers.get(handler);
      if (!wrapped) { wrapped = (route, request) => handler(protect(route), request); handlers.set(handler, wrapped); }
      return register(match, wrapped, options);
    };
    owner.unroute = (match, handler) => unregister(match, handler ? handlers.get(handler) || handler : undefined);
    if (owner.routeWebSocket) {
      const registerSocket = owner.routeWebSocket.bind(owner);
      owner.routeWebSocket = (match, handler) => registerSocket(match, socket => handler(protectSocket(socket)));
    }
  };
  wrapRoutes(context);
  // Register before pages exist. Later fixtures take precedence but their
  // outbound methods have the exact same boundary as the final fallback.
  await context.route('**/*', route => route.continue());
  context.on('page', wrapRoutes);
  for (const page of context.pages()) wrapRoutes(page);
  // Atlas has no WebSocket fixtures. Block connection setup before egress.
  await context.routeWebSocket('**/*', socket => { remember(socket.url()); socket.close(); });
  return blocked;
}
