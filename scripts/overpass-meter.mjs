// What a data build downloads, per host: loaded before the builder
// (`node --import ./scripts/overpass-meter.mjs scripts/build-….mjs`, see the
// OSM update workflows), it counts the response bytes the builder reads
// through fetch and, when the process exits, prints one line
//   OVERPASS_USAGE {"script":…,"bytes":…,"requests":…,"hosts":{host:{bytes,requests}}}
// and adds it to the step summary. So a run's download is in its log, to
// check against the providers' guidance (docs/external-services.md) without
// a benchmark. Bytes are as read, after any content decoding: at least what
// went over the wire for compressed responses. Nothing else changes: the
// builder sees the same responses.
import {appendFileSync, writeSync} from 'node:fs';
import {basename} from 'node:path';

const original = globalThis.fetch;
const hosts = new Map();
let requests = 0, bytes = 0;
const entry = host => { if (!hosts.has(host)) hosts.set(host, {bytes: 0, requests: 0}); return hosts.get(host); };
const hostOf = input => { try { return new URL(input instanceof Request ? input.url : String(input)).host; } catch { return 'unknown'; } };

if (typeof original === 'function') {
  globalThis.fetch = async function meteredFetch(input, init) {
    const host = hostOf(input), counted = entry(host);
    counted.requests++; requests++;
    const response = await original(input, init);
    if (!response.body) return response;
    const body = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) { counted.bytes += chunk.byteLength; bytes += chunk.byteLength; controller.enqueue(chunk); },
    }));
    const metered = new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
    for (const key of ['url', 'redirected', 'type']) Object.defineProperty(metered, key, {value: response[key]});
    return metered;
  };
}

export const overpassUsage = () => ({script: basename(process.argv[1] || ''), bytes, requests,
  hosts: Object.fromEntries([...hosts].sort(([a], [b]) => a.localeCompare(b)))});

process.on('exit', () => {
  const line = `OVERPASS_USAGE ${JSON.stringify(overpassUsage())}\n`;
  try { writeSync(1, line); } catch { /* stdout closed: the summary still records it */ }
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`${line.trim()}\`\n`); } catch { /* no summary file */ }
  }
});
