import {retryAfterMs} from './retry-after.mjs';
// Transport policy only: no query, row-parser or checkpoint identity changes.
export const CROSSING_DOWNLOAD_LIMIT = 200_000_000;
const MAX_RETRY_WAIT = 15 * 60_000;

// Count decoded bytes as they arrive, including failed responses and streams.
// A success cannot bypass the cap, and an oversized body is never buffered whole.
export async function crossingResponseText(response, usage, limit = CROSSING_DOWNLOAD_LIMIT) {
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      usage.bytes += value.byteLength;
      if (usage.bytes > limit) {
        // Stop consumption immediately, but do not let an unresponsive
        // cleanup promise hold the budget failure and reader lock forever.
        try { reader.cancel().catch(() => {}); } catch { /* The budget error remains primary. */ }
        throw new Error('Download budget exceeded');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export function crossingFailureAction({status, detail, error}) {
  // Access denial and invalid requests are terminal, not provider outages.
  if (status >= 400 && status < 500 && ![406, 408, 429].includes(status)) return 'stop';
  if (/Dispatcher|too busy|rate_limited|at capacity|query workers (?:are )?busy|request queue (?:is )?full/i.test(detail) || [406, 429, 503].includes(status)) return 'retry';
  // A gateway/client timeout does not prove the query executed. Only an
  // explicit query resource error or the existing CSV truncation guard splits.
  if (/runtime error:\s*Query\b[^]*?(timed? ?out|out of memory)/i.test(detail) || /^Query timed out\b/i.test(detail) || /no end marker/i.test(error?.message || '')) return 'split';
  return 'retry';
}

// A provider's Retry-After is a minimum, never shortened to our local cap.
// If it asks longer than this job should wait, stop and retain the checkpoint.
export function crossingRetryDelay(attempt, retryAfter, now = Date.now()) {
  const asked = retryAfterMs(retryAfter, now);
  if (asked > MAX_RETRY_WAIT) return null;
  return Math.max(60_000 * (attempt + 1), asked);
}
