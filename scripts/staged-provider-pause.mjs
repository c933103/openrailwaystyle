import {retryAfterMs} from './retry-after.mjs';
// Shared by staged branch/service fallbacks and the railway-ways collector;
// the builders that read the local store do not need a provider pause.
// A provider pause survives body failure and region subdivision. Use monotonic
// elapsed time so a wall-clock correction cannot shorten an observed pause.
export function createStagedProviderPause({budgetMs, requestMs = 300000,
  elapsed = () => performance.now(), now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const deadline = elapsed() + budgetMs;
  let notBefore = 0;
  return {
    observe(response) {
      const receivedAt = elapsed();
      const pause = retryAfterMs(response.headers.get('retry-after'), now());
      notBefore = Math.max(notBefore, receivedAt + pause);
    },
    async wait(backoffMs) {
      const earliest = Math.max(notBefore, elapsed() + backoffMs);
      // Always retain the existing initial zero-delay yield and quiet/retry
      // intervals, but defer without sleeping when the next request cannot fit.
      let first = true;
      while (true) {
        const current = elapsed(), remaining = Math.max(0, earliest - current);
        if (!Number.isFinite(remaining) || current + remaining + requestMs > deadline)
          throw new Error('Provider pause and full request exceed the acquisition time budget; region deferred');
        if (!first && !remaining) return;
        first = false;
        await sleep(remaining);
      }
    },
  };
}
