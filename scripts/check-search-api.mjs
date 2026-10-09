// One small public API request; never download or prefetch map tiles in CI.
import { SEARCH_API } from '../styles/map-model.mjs';
const base = new URL(process.env.MAP_BASE_URL || 'https://10671435.xyz/');
if (!['http:', 'https:'].includes(base.protocol)) throw new Error('MAP_BASE_URL must use HTTP or HTTPS');
const expectedOrigin = base.origin;
const url = new URL(SEARCH_API);
url.searchParams.set('q', 'London');
url.searchParams.set('limit', '1');
const response = await fetch(url, {
  headers: {'User-Agent':'OpenRailwayStyle deployment check (https://github.com/c933103/openrailwaystyle)', Origin:expectedOrigin},
  signal:AbortSignal.timeout(20000),
});
if (!response.ok) throw new Error(`Station API HTTP ${response.status}`);
const origin = response.headers.get('access-control-allow-origin');
if (origin !== '*' && origin !== expectedOrigin) throw new Error(`Station API does not allow ${expectedOrigin}: Access-Control-Allow-Origin ${origin}`);
const rows = await response.json();
if (!Array.isArray(rows) || !rows.length) throw new Error('Station API returned no search result');
if (!Number.isFinite(rows[0].latitude) || !Number.isFinite(rows[0].longitude)) throw new Error('Station API returned invalid coordinates');
console.log(`Public station search OK from ${expectedOrigin}; CORS ${origin}; result: ${rows[0].name}`);
