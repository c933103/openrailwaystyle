// Maintenance build only: way ID → loading gauge for every railway track
// with one, from Overpass as CSV (about 4 MB). The map colours its zoom 0–6
// overview with it (styles/loading-gauge-list.mjs). If Overpass fails, the
// previous list in .snapshot-cache is kept.
import {retryAfterMs} from './retry-after.mjs';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {encodeLoadingGauges, parseCsv} from '../styles/loading-gauge-list.mjs';
const api = 'https://overpass-api.de/api/interpreter';
const cache = '.snapshot-cache/loading-gauge.csv';
const query = '[out:csv(::id,loading_gauge;false)][timeout:240];way[railway~"^(rail|narrow_gauge|light_rail|subway|monorail|funicular)$"][loading_gauge];out;';
await mkdir('.snapshot-cache', {recursive: true});
await mkdir('snapshot', {recursive: true});
let text, retryNotBefore = 0;
const MAX_PROVIDER_WAIT_MS = 15 * 60_000;
for (let attempt = 0; attempt < 3 && !text; attempt++) {
  // Provider and baseline waits use elapsed time after the header is observed.
  const earliest = Math.max(performance.now() + (attempt ? 60000 : 5000), retryNotBefore);
  do { await new Promise(r => setTimeout(r, Math.max(0, earliest - performance.now()))); }
  while (performance.now() < earliest);
  let terminal = false, pauseTooLong = false;
  try {
    const response = await fetch(api, {method: 'POST', body: new URLSearchParams({data: query}),
      headers: {'User-Agent': 'OpenRailwayAtlas-snapshot/1.0 (+https://github.com/c933103/openrailwaystyle)'}, signal: AbortSignal.timeout(300000)});
    // Capture the pause before reading the body, which can fail independently.
    const receivedAt = performance.now(), pause = retryAfterMs(response.headers.get('retry-after'), Date.now());
    pauseTooLong = pause > MAX_PROVIDER_WAIT_MS;
    if (pause > 0) retryNotBefore = Math.max(retryNotBefore, receivedAt + pause);
    terminal = response.status >= 400 && response.status < 500 && ![406, 408, 429].includes(response.status);
    if (!response.ok) {
      try { response.body?.cancel().catch(() => {}); } catch {}
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.text();
    // A failed CSV query returns an HTML or XML error page, not rows.
    if (!/^\d+\t/.test(body)) throw new Error(`Unexpected response: ${body.slice(0, 200)}`);
    text = body; await writeFile(cache, body);
    console.log('Loading gauge list downloaded:', Buffer.byteLength(body), 'bytes');
  } catch (error) {
    console.warn('Loading gauge list:', error.message);
    if (pauseTooLong) console.warn('Loading gauge list: Retry-After exceeds the 15-minute wait limit; previous data retained');
    if (terminal || pauseTooLong) break;
  }
}
if (!text) {
  try { text = await readFile(cache, 'utf8'); console.log('Using the previous loading gauge list'); }
  catch { console.log('No loading gauge list available'); process.exit(0); }
}
const rows = parseCsv(text);
await writeFile('snapshot/loading-gauge.json', JSON.stringify(encodeLoadingGauges(rows)));
console.log('Loading gauges for', rows.length, 'ways');
