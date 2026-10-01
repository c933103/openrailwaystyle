// Maintenance build only: way ID → owner (OSM owner=*) for every railway track
// with one, from Overpass as CSV (about 3 MB). The Owner view colours its zoom 0–6
// overview with it (same encoding as styles/loading-gauge-list.mjs). If Overpass fails, the
// previous list in .snapshot-cache is kept.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {encodeLoadingGauges, parseCsv} from '../styles/loading-gauge-list.mjs';
const api = 'https://overpass-api.de/api/interpreter';
const cache = '.snapshot-cache/owner.csv';
const query = '[out:csv(::id,owner;false)][timeout:240];way[railway~"^(rail|narrow_gauge|light_rail|subway|monorail|funicular)$"][owner];out;';
await mkdir('.snapshot-cache', {recursive: true});
await mkdir('snapshot', {recursive: true});
// Owners change seldom: the list is fetched again only every four weeks,
// keeping each snapshot run within the Overpass guidance for regular use.
const dated = '.snapshot-cache/owner.date', MAX_AGE = 28 * 86400000;
const fetchedAt = Number(await readFile(dated, 'utf8').catch(() => 0));
let text = Date.now() - fetchedAt < MAX_AGE ? await readFile(cache, 'utf8').catch(() => undefined) : undefined;
if (text) console.log('Owner list is recent; reused');
for (let attempt = 0; attempt < 3 && !text; attempt++) {
  await new Promise(r => setTimeout(r, attempt ? 60000 : 5000));
  try {
    const response = await fetch(api, {method: 'POST', body: new URLSearchParams({data: query}),
      headers: {'User-Agent': 'OpenRailwayAtlas-snapshot/1.0 (+https://github.com/c933103/openrailwaystyle)'}, signal: AbortSignal.timeout(300000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    // A failed CSV query returns an HTML or XML error page, not rows.
    if (!/^\d+\t/.test(body)) throw new Error(`Unexpected response: ${body.slice(0, 200)}`);
    text = body; await writeFile(cache, body); await writeFile(dated, String(Date.now()));
    console.log('Owner list downloaded:', Buffer.byteLength(body), 'bytes');
  } catch (error) { console.warn('Owner list:', error.message); }
}
if (!text) {
  try { text = await readFile(cache, 'utf8'); console.log('Using the previous owner list'); }
  catch { console.log('No owner list available'); process.exit(0); }
}
const rows = parseCsv(text);
await writeFile('snapshot/owner.json', JSON.stringify(encodeLoadingGauges(rows)));
console.log('Owners for', rows.length, 'ways');
