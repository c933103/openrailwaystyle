// What a data build downloads, per host: loaded before the builder
// (`node --import ./scripts/overpass-meter.mjs scripts/build-….mjs`, see the
// OSM update workflows), it counts the response bytes the builder reads
// through fetch and, when the process exits, prints one line
//   OVERPASS_USAGE {"script":…,"bytes":…,"requests":…,"unread":…,"unmeasured":…,"hosts":{host:{bytes,requests}}}
// and adds it to the step summary. So a run's download is in its log, to
// check against the providers' guidance (docs/data-maintenance.md) without
// a benchmark. Bytes are those read, after any content decoding, plus, for a
// body the builder did not read to its end (an error it rejected unread, a
// cancelled stream), the rest of its declared Content-Length: the server
// sent it whether or not it was read. `unread` counts those responses and
// `unmeasured` the ones among them without a declared length, whose bytes
// are only those read: a total with unmeasured responses is a lower bound.
// Nothing else changes: the builder sees the same responses.
import {appendFileSync, writeSync} from 'node:fs';
import {basename} from 'node:path';

const original = globalThis.fetch;
const hosts = new Map();
const bodies = new Set();
let requests = 0;
const entry = host => { if (!hosts.has(host)) hosts.set(host, {bytes: 0, requests: 0}); return hosts.get(host); };
const hostOf = input => { try { return new URL(input instanceof Request ? input.url : String(input)).host; } catch { return 'unknown'; } };

if (typeof original === 'function') {
  globalThis.fetch = async function meteredFetch(input, init) {
    const host = hostOf(input), counted = entry(host);
    counted.requests++; requests++;
    const response = await original(input, init);
    if (!response.body) return response;
    const header = response.headers.get('content-length'), length = /^\d+$/.test(header || '') ? Number(header) : NaN;
    const tracked = {host, read: 0, declared: Number.isSafeInteger(length) ? length : null, done: false};
    bodies.add(tracked);
    const body = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) { counted.bytes += chunk.byteLength; tracked.read += chunk.byteLength; controller.enqueue(chunk); },
      flush() { tracked.done = true; },
    }));
    const metered = new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
    for (const key of ['url', 'redirected', 'type']) Object.defineProperty(metered, key, {value: response[key]});
    return metered;
  };
}

export function overpassUsage() {
  const totals = new Map([...hosts].map(([host, {bytes, requests}]) => [host, {bytes, requests}]));
  let unread = 0, unmeasured = 0;
  for (const body of bodies) {
    if (body.done) continue;
    unread++;
    if (body.declared === null) unmeasured++;
    else totals.get(body.host).bytes += Math.max(0, body.declared - body.read);
  }
  const sorted = [...totals].sort(([a], [b]) => a.localeCompare(b));
  return {script: basename(process.argv[1] || ''), bytes: sorted.reduce((sum, [, t]) => sum + t.bytes, 0), requests,
    unread, unmeasured, hosts: Object.fromEntries(sorted)};
}

process.on('exit', () => {
  const line = `OVERPASS_USAGE ${JSON.stringify(overpassUsage())}\n`;
  try { writeSync(1, line); } catch { /* stdout closed: the summary still records it */ }
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`${line.trim()}\`\n`); } catch { /* no summary file */ }
  }
});
