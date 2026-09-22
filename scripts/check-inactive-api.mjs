import {readFile} from 'node:fs/promises';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {INACTIVE_API, GROUPS, inactiveQuery, toGeoJSON} from '../styles/inactive.mjs';
// Regression: the exact viewport reported as missing planned lines at zoom 7.83.
const bbox = [33.06115,126.29708,35.38088,132.19293];
const style = JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
const layer = style.layers.find(l=>l.id==='inactive-regional');
const filter = featureFilter(layer.filter).filter;
for (const [index,group] of GROUPS.entries()) {
  if (index) await new Promise(resolve=>setTimeout(resolve,5000));
  const start = Date.now();
  const response = await fetch(INACTIVE_API, {
    method:'POST',
    headers:{Origin:'https://c933103.github.io','User-Agent':'OpenRailwayAtlas-validation/1.0 (+https://github.com/c933103/openrailwaystyle)'},
    body:new URLSearchParams({data:inactiveQuery(bbox,group.states)}), signal:AbortSignal.timeout(65000),
  });
  if (!response.ok) throw new Error(`${group.id} HTTP ${response.status}`);
  const cors = response.headers.get('access-control-allow-origin');
  if (cors!=='*' && cors!=='https://c933103.github.io') throw new Error(`Missing browser CORS permission: ${cors}`);
  const data = toGeoJSON(await response.json());
  if (!data.features.length) throw new Error(`No ${group.id} geometry in reported viewport`);
  for (const zoom of [7,7.83]) {
    if (zoom<layer.minzoom || zoom>=layer.maxzoom) throw new Error(`Overlay missing at zoom ${zoom}`);
    for (const feature of data.features) {
      if (!filter({zoom},{type:2,properties:feature.properties})) throw new Error(`${feature.id} excluded at zoom ${zoom}`);
    }
  }
  const counts = data.features.reduce((out,f)=>{out[f.properties.state]=(out[f.properties.state]||0)+1;return out;},{});
  console.log(`Reported viewport ${group.id} OK: ${data.features.length} ways, ${Date.now()-start} ms, CORS ${cors}; states ${JSON.stringify(counts)}`);
  if(group.id==='planned') console.log('Mapped proposed lines: '+JSON.stringify(data.features.filter(f=>f.properties.state==='proposed').map(f=>({id:f.id,name:f.properties.name}))));
}
