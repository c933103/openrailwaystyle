// Per-comparison replay for GET tile URLs with no varying request headers.
// In-flight requests share one fetch; successful responses keep exactly the
// same bytes for every map. Failed responses are passed through, but never
// retained: the application's next attempt must be able to reach the provider.
// Match the successful tile statuses accepted by browser.mjs's disk cache.
const CACHED_STATUS = new Set([200, 204, 206]);
const DROPPED_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie']);

export function createResponseCache() {
  const responses = new Map();
  return route => {
    const url = route.request().url();
    if (!responses.has(url)) {
      // Start after storing the promise, including when fetch throws before
      // returning one. Evict in this shared promise, not in each consumer's
      // catch: a late consumer must not delete a newer successful attempt.
      const pending = Promise.resolve().then(async () => {
        try {
          const response = await route.fetch();
          const headers = Object.fromEntries(Object.entries(response.headers()).filter(([name]) => !DROPPED_HEADERS.has(name.toLowerCase())));
          const result = {status: response.status(), headers, body: await response.body()};
          if (!CACHED_STATUS.has(result.status)) responses.delete(url);
          return result;
        } catch (error) {
          responses.delete(url);
          throw error;
        }
      });
      responses.set(url, pending);
    }
    return responses.get(url);
  };
}
