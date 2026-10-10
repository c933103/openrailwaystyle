// Per-comparison replay for GET tile targets with no varying request headers.
// Callers supply a validated target key and their existing guarded transport;
// this cache never chooses a destination or performs a raw route.fetch().
// In-flight requests share one fetch; successful responses keep exactly the
// same bytes for every map. Failed responses are passed through, but never
// retained: the application's next attempt must reach the self-hosted server.
// Match the successful tile statuses accepted by browser.mjs's disk cache.
const CACHED_STATUS = new Set([200, 204, 206]);
const DROPPED_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie']);

export function createResponseCache() {
  const responses = new Map();
  return (target, fetchResponse) => {
    if (!responses.has(target)) {
      // Start after storing the promise, including when fetch throws before
      // returning one. Evict in this shared promise, not in each consumer's
      // catch: a late consumer must not delete a newer successful attempt.
      const pending = Promise.resolve().then(async () => {
        try {
          const response = await fetchResponse();
          const headers = Object.fromEntries(Object.entries(response.headers()).filter(([name]) => !DROPPED_HEADERS.has(name.toLowerCase())));
          const result = {status: response.status(), headers, body: await response.body()};
          if (!CACHED_STATUS.has(result.status)) responses.delete(target);
          return result;
        } catch (error) {
          responses.delete(target);
          throw error;
        }
      });
      responses.set(target, pending);
    }
    return responses.get(target);
  };
}
