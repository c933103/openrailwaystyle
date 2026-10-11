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
