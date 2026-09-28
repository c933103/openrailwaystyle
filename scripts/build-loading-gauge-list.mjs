// Maintenance build only: way ID → loading gauge for every railway track
// with one, from Overpass as CSV (about 4 MB). The map colours its zoom 0–6
// overview with it (styles/loading-gauge-list.mjs). If Overpass fails, the
// previous list in .snapshot-cache is kept.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {encodeLoadingGauges, parseCsv} from '../styles/loading-gauge-list.mjs';
const api = 'https://overpass-api.de/api/interpreter';
const cache = '.snapshot-cache/loading-gauge.csv';
const query = '[out:csv(::id,loading_gauge;false)][timeout:240];way[railway~"^(rail|narrow_gauge|light_rail|subway|monorail|funicular)$"][loading_gauge];out;';
await mkdir('.snapshot-cache', {recursive: true});
await mkdir('snapshot', {recursive: true});
let text;
for (let attempt = 0; attempt < 3 && !text; attempt++) {
  await new Promise(r => setTimeout(r, attempt ? 60000 : 5000));
  try {
    const response = await fetch(api, {method: 'POST', body: new URLSearchParams({data: query}),
      headers: {'User-Agent': 'OpenRailwayAtlas-snapshot/1.0 (+https://github.com/c933103/openrailwaystyle)'}, signal: AbortSignal.timeout(300000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    // A failed CSV query returns an HTML or XML error page, not rows.
    if (!/^\d+\t/.test(body)) throw new Error(`Unexpected response: ${body.slice(0, 200)}`);
    text = body; await writeFile(cache, body);
    console.log('Loading gauge list downloaded:', Buffer.byteLength(body), 'bytes');
  } catch (error) { console.warn('Loading gauge list:', error.message); }
}
if (!text) {
  try { text = await readFile(cache, 'utf8'); console.log('Using the previous loading gauge list'); }
  catch { console.log('No loading gauge list available'); process.exit(0); }
}
const rows = parseCsv(text);
await writeFile('snapshot/loading-gauge.json', JSON.stringify(encodeLoadingGauges(rows)));
console.log('Loading gauges for', rows.length, 'ways');
