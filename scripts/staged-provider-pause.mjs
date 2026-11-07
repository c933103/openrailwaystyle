import {retryAfterMs} from './retry-after.mjs';
// Shared by the staged branch/Service fallback, not their local-store path.
// A provider pause survives body failure and region subdivision. Use monotonic
// elapsed time so a wall-clock correction cannot shorten an observed pause.
export function createStagedProviderPause({budgetMs, requestMs = 300000}) {
  const deadline = performance.now() + budgetMs;
  let notBefore = 0;
  return {
    observe(response) {
      const receivedAt = performance.now();
      const pause = retryAfterMs(response.headers.get('retry-after'));
      notBefore = Math.max(notBefore, receivedAt + pause);
    },
    async wait(backoffMs) {
      const earliest = Math.max(notBefore, performance.now() + backoffMs);
      // Always retain the existing initial zero-delay yield and quiet/retry
      // intervals, but defer without sleeping when the next request cannot fit.
      let first = true;
      while (true) {
        const now = performance.now(), remaining = Math.max(0, earliest - now);
        if (!Number.isFinite(remaining) || now + remaining + requestMs > deadline)
          throw new Error('Provider pause and full request exceed the acquisition time budget; region deferred');
        if (!first && !remaining) return;
        first = false;
        await new Promise(resolve => setTimeout(resolve, remaining));
      }
    },
  };
}
