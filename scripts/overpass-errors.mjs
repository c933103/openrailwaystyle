// Node fetch wraps DNS/socket/TLS failures in the unhelpful "fetch failed".
// Log bounded system error codes (including AggregateError children), without
// traversing arbitrary objects or dumping request headers/credentials.
export function describeOverpassError(error) {
  const seen = new Set(), queue = [error], codes = new Set();
  for (let count = 0; queue.length && count < 16; count++) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (typeof item.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(item.code)) codes.add(item.code);
    if (item.cause) queue.push(item.cause);
    if (Array.isArray(item.errors)) queue.push(...item.errors.slice(0,8));
  }
  const message = String(error?.message || 'Unknown Overpass error').replace(/[\r\n]/g, ' ').slice(0,300);
  return message + (codes.size ? ` [${[...codes].sort().join(', ')}]` : '');
}

// Untrusted provider messages must stay data in Actions annotations.
export const workflowWarning = message => '::warning::' + String(message)
  .replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');

// A busy or refusing Overpass server needs minutes, not seconds: its slots
// stay taken by queries a client already abandoned, and it may stop taking
// connections for a while. Retry after 2, 5 and then 10 minutes, or the
// server's own Retry-After (up to 15 minutes) when it sends a longer one.
export const OVERPASS_RETRY_MINUTES = Object.freeze([2, 5, 10]);
const RETRY_AFTER_CAP_MS = 15 * 60_000;
export function overpassRetryDelayMs(retry, retryAfter, now = Date.now()) {
  const scheduled = OVERPASS_RETRY_MINUTES[Math.min(retry, OVERPASS_RETRY_MINUTES.length - 1)] * 60_000;
  let asked = 0;
  const value = String(retryAfter ?? '').trim();
  if (/^\d+$/.test(value)) asked = Number(value) * 1000;
  else if (value) { const date = Date.parse(value); if (Number.isFinite(date)) asked = date - now; }
  return Math.max(scheduled, Math.min(Math.max(asked, 0), RETRY_AFTER_CAP_MS));
}
// Server busy (429, 502–504) or no connection at all: worth waiting for.
export const overpassBusy = error => /^HTTP (429|502|503|504)\b/.test(String(error?.message)) || /fetch failed/i.test(String(error?.message));
// Whether one more wait and a full request still end before a job's own time
// budget, so a run fails with a clear reason instead of being cancelled.
export const overpassRetryFits = (deadline, waitMs, requestMs, now = Date.now()) => now + waitMs + requestMs <= deadline;
