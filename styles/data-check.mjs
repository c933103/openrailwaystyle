import {SEARCH_API} from './map-model.mjs?v=20260922-1';
import {INACTIVE_API, GROUPS, inactiveQuery, toGeoJSON} from './inactive.mjs?v=20260922-1';
const button = document.getElementById('check');
button.addEventListener('click', async () => {
  button.disabled = true;
  const results = document.getElementById('results'); results.replaceChildren();
  const summary = document.getElementById('summary'); summary.textContent = 'Checking…';
  let passed = 0, failed = 0;
  const check = async (name, request) => {
    const tr = document.createElement('tr'), label = document.createElement('th'), detail = document.createElement('td');
    label.textContent = name; detail.textContent = 'Checking…'; tr.append(label,detail); results.append(tr);
    try { detail.textContent = await request(); detail.className = 'pass'; passed++; }
    catch(error) { detail.textContent = error.message; detail.className = 'fail'; failed++; }
  };
  const get = async (url, options={}) => {
    const r = await fetch(url, {...options,signal:AbortSignal.timeout(20000)});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };
  try {
    const style = await (await get('./world.style.json')).json();
    const vectorSources = Object.entries(style.sources).filter(([,s])=>s.type==='vector'&&!s.url.startsWith('pmtiles:'));
    await Promise.all(vectorSources.map(([name,source]) => check(name, async () => {
      const json = await (await get(source.url)).json();
      if (!Array.isArray(json.tiles)||!json.tiles.length) throw new Error('TileJSON contains no tile URLs');
      const needed = [...new Set(style.layers.filter(l=>l.source===name).map(l=>l['source-layer']))];
      const layers = (json.vector_layers||[]).map(l=>l.id);
      for(const layer of needed) if(!layers.includes(layer)) throw new Error(`Missing tile layer: ${layer}`);
      return `OK · ${needed.join(', ')} · zoom ${json.minzoom ?? '?'}–${json.maxzoom ?? '?'}`;
    })));
    await check('Base-map archive', async () => {
      const url = style.sources.openmaptiles.url.slice('pmtiles://'.length);
      const r = await get(url, {headers:{Range:'bytes=0-126'}});
      if(r.status!==206) {await r.body?.cancel();throw new Error('Server did not honor the archive range request');}
      const b = new Uint8Array(await r.arrayBuffer());
      if(new TextDecoder().decode(b.slice(0,7))!=='PMTiles') throw new Error('Unexpected archive header');
      return `OK · PMTiles version ${b[7]}`;
    });
    await check('Map label font', async () => {
      const url = style.glyphs.replace('{fontstack}',encodeURIComponent('Noto Sans Bold')).replace('{range}','0-255');
      const r = await get(url); const b = await r.arrayBuffer();
      if(!b.byteLength) throw new Error('Empty glyph response');
      return 'OK · bold label glyphs available';
    });
    for (const group of GROUPS) {
      await check(`Regional ${group.label} railways (reported Japan–Korea view)`, async () => {
        const response = await fetch(INACTIVE_API, {method:'POST',body:new URLSearchParams({data:inactiveQuery([33.06115,126.29708,35.38088,132.19293], group.states)}),signal:AbortSignal.timeout(65000)});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = toGeoJSON(await response.json());
        if (!data.features.length) throw new Error('No sample railway geometry');
        return `OK · ${data.features.length} railway ways`;
      });
      await new Promise(resolve=>setTimeout(resolve,5000));
    }
    await check('Station search', async () => {
      const json = await (await get(`${SEARCH_API}?q=London&limit=1`)).json();
      if(!Array.isArray(json)||!json.length) throw new Error('No station result');
      return `OK · ${json[0].name} · ${json[0].latitude}, ${json[0].longitude}`;
    });
  } catch (error) {failed++;summary.textContent=error.message;}
  summary.textContent = `${passed} passed; ${failed} failed.`;
  button.disabled = false;
});
