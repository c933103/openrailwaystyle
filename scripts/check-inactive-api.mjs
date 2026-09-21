import {INACTIVE_API, inactiveQuery, toGeoJSON} from '../styles/inactive.mjs';
// One small London viewport checks the actual query, lifecycle geometry and CORS.
console.log(`Checking regional railway provider: ${INACTIVE_API}`);
const started = Date.now();
const response = await fetch(INACTIVE_API, {
  method:'POST',
  headers:{Origin:'https://c933103.github.io', 'User-Agent':'OpenRailwayAtlas-validation/1.0 (+https://github.com/c933103/openrailwaystyle)'},
  body:new URLSearchParams({data:inactiveQuery([51.45,-0.3,51.6,0.05])}),
  signal:AbortSignal.timeout(40000),
});
console.log(`Regional API responded HTTP ${response.status} in ${Date.now()-started} ms`);
if (!response.ok) throw new Error(`Regional railway API HTTP ${response.status}`);
const cors = response.headers.get('access-control-allow-origin');
if (cors !== '*' && cors !== 'https://c933103.github.io') throw new Error(`Missing browser CORS permission: ${cors}`);
const data = toGeoJSON(await response.json());
if (!data.features.length) throw new Error('No former or planned railway geometry in sample viewport');
console.log(`Regional railway API OK; CORS ${cors}; ${data.features.length} ways; states: ${[...new Set(data.features.map(f=>f.properties.state))].join(', ')}`);
