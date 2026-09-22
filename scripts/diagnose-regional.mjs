import {mkdir,writeFile} from 'node:fs/promises';
import {toGeoJSON} from '../styles/inactive.mjs';
const box = [33.06115,126.29708,35.38088,132.19293];
const states = ['proposed','construction','disused','abandoned','razed','demolished','removed'];
const tracks = 'rail|narrow_gauge|light_rail|subway|tram|monorail|funicular';
const query = '[out:json][timeout:60][maxsize:268435456];('+
  'way[railway~"^('+states.join('|')+')$"]('+box.join(',')+');'+
  states.map(state=>'way["'+state+':railway"~"^('+tracks+')$"]('+box.join(',')+');').join('')+
  ');out tags geom('+box.join(',')+');';
await mkdir('regional-diagnostics',{recursive:true});
for (const [name,url] of [
  ['private-coffee','https://overpass.private.coffee/api/interpreter'],
  ['fossgis','https://overpass-api.de/api/interpreter'],
]) {
  const start = Date.now();
  try {
    console.log(name+' exact screenshot view, explicit lifecycle keys');
    const response = await fetch(url,{method:'POST',body:new URLSearchParams({data:query}),
      headers:{Origin:'https://c933103.github.io','User-Agent':'OpenRailwayAtlas-diagnosis/1.0 (+https://github.com/c933103/openrailwaystyle)'},
      signal:AbortSignal.timeout(85000)});
    console.log(name+' HTTP '+response.status+' in '+(Date.now()-start)+' ms; CORS '+response.headers.get('access-control-allow-origin'));
    if(!response.ok) {console.log((await response.text()).slice(0,500));continue;}
    const json = await response.json();
    if(json.remark) {console.log(name+' remark '+json.remark);continue;}
    const geo = toGeoJSON(json);
    await writeFile('regional-diagnostics/'+name+'.geojson',JSON.stringify(geo));
    await writeFile('regional-diagnostics/'+name+'-raw.json',JSON.stringify(json));
    console.log(name+' ways '+geo.features.length+' state counts '+JSON.stringify(geo.features.reduce((out,f)=>{out[f.properties.state]=(out[f.properties.state]||0)+1;return out;},{})));
    console.log(name+' planned ways '+JSON.stringify(geo.features.filter(f=>f.properties.state==='proposed').map(f=>({id:f.id,name:f.properties.name,ref:f.properties.ref}))).slice(0,8000));
  } catch(error) {console.log(name+' ERROR after '+(Date.now()-start)+' ms: '+error);}
}
