// One small public API request; never download or prefetch map tiles in CI.
import { SEARCH_API } from '../styles/map-model.mjs';
const url = new URL(SEARCH_API);
url.searchParams.set('q', 'London');
url.searchParams.set('limit', '1');
const response = await fetch(url, {
  headers: {'User-Agent':'OpenRailwayStyle deployment check (https://github.com/c933103/openrailwaystyle)'},
  signal:AbortSignal.timeout(20000),
});
if (!response.ok) throw new Error(`Station API HTTP ${response.status}`);
const origin = response.headers.get('access-control-allow-origin');
if (origin !== '*' && origin !== 'https://c933103.github.io') throw new Error(`Station API does not allow the Pages origin: ${origin}`);
const rows = await response.json();
if (!Array.isArray(rows) || !rows.length) throw new Error('Station API returned no search result');
if (!Number.isFinite(rows[0].latitude) || !Number.isFinite(rows[0].longitude)) throw new Error('Station API returned invalid coordinates');
console.log(`Public station search OK; CORS ${origin}; result: ${rows[0].name}`);
