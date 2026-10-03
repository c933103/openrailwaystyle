from pathlib import Path
import re

app=Path('styles/app.mjs')
text=app.read_text()
start=text.index('const OSM_API=')
end=text.index('function applySettings()',start)
text=text[:start]+Path('.github/pr73-names-runtime.txt').read_text()+text[end:]
assert "source === 'stationMajor' ? (majorStationSearchData?.features || [])" in text
assert 'function layerVisibility(' not in text
app.write_text(text)

startup=Path('tests/startup.test.mjs')
text=startup.read_text()
marker="test('curated OSM labels remain searchable when both remote searches fail'"
if marker not in text:
    text+=r'''

test('curated OSM labels remain searchable when both remote searches fail',async()=>{
 const nameRequests=[];
 const fetcher=async url=>{
  const u=new URL(String(url));
  if(u.hostname==='api.openstreetmap.org'){
   nameRequests.push(u.href);
   const plural=u.pathname.split('/').at(-1).replace(/\.json$/,''),type=plural.slice(0,-1);
   const ids=(u.searchParams.get(plural)||'').split(',').filter(Boolean);
   return{ok:true,status:200,json:async()=>({elements:ids.map(id=>({type,id:Number(id),tags:{name:`Mapped ${id}`,'name:en':`English Junction ${id}`,'name:de':`Deutscher Knoten ${id}`}}))})};
  }
  if(u.href.startsWith(model.SEARCH_API)||u.href.startsWith(model.PLACE_SEARCH_API))return{ok:false,status:503,json:async()=>[]};
  return{ok:true,status:200,json:async()=>structuredClone(style)};
 };
 const {dom,window,maps}=await start({search:'?language=en#3/35.681/125',fetcher});
 const wait=async condition=>{for(let i=0;i<100;i++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,0));}assert.ok(condition(),'condition settled');};
 try{
  const map=maps[0],d=window.document;
  map.getCenter=()=>({lng:0,lat:0,toArray:()=>[0,0]});
  map.handlers['style.load']();
  await wait(()=>map.sourceData?.stationMajor?.features.some(f=>f.properties.wikidata==='Q54451'));
  const query=async text=>{
   d.getElementById('search-input').value=text;
   d.getElementById('search-form').dispatchEvent(new window.Event('submit',{cancelable:true}));
   await wait(()=>!d.getElementById('search-status').textContent.includes('Searching'));
  };
  await query('Junction 8953');
  assert.match(d.getElementById('search-results').textContent,/English Junction 895371274/);
  assert.doesNotMatch(d.getElementById('search-status').textContent,/Search is unavailable/);
  const requests=nameRequests.length;
  const language=d.getElementById('language');language.value='de';language.dispatchEvent(new window.Event('change'));
  await wait(()=>map.sourceData?.stationMajor?.features.some(f=>f.properties.wikidata==='Q54451'&&f.properties.atlas_language==='de'));
  await query('Knoten 8953');
  assert.match(d.getElementById('search-results').textContent,/Deutscher Knoten 895371274/);
  assert.equal(nameRequests.length,requests,'switching language reuses OSM name tags');
  await query('New York Penn Station');
  assert.match(d.getElementById('search-status').textContent,/Search is unavailable/,'the maintenance note cannot satisfy local search');
 }finally{dom.window.close();}
});

test('late OSM names cannot populate a hidden curated source',async()=>{
 const pending=[];
 const fetcher=async url=>{
  const u=new URL(String(url));
  if(u.hostname!=='api.openstreetmap.org')return{ok:true,status:200,json:async()=>structuredClone(style)};
  const plural=u.pathname.split('/').at(-1).replace(/\.json$/,''),type=plural.slice(0,-1);
  const ids=(u.searchParams.get(plural)||'').split(',').filter(Boolean);
  return new Promise(resolve=>pending.push(()=>resolve({ok:true,status:200,json:async()=>({elements:ids.map(id=>({type,id:Number(id),tags:{name:`OSM ${id}`}}))})})));
 };
 const {dom,window,maps}=await start({search:'#3/35.681/125',fetcher});
 try{
  const map=maps[0];map.handlers['style.load']();
  for(let i=0;i<30&&!pending.length;i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(pending.length);
  const stations=window.document.getElementById('stations');stations.click();
  assert.equal(stations.checked,false);
  pending.splice(0).forEach(resolve=>resolve());
  for(let i=0;i<20;i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(map.sourceData?.stationMajor,undefined,'the hidden source receives no late data');
  stations.click();
  for(let i=0;i<30&&!map.sourceData?.stationMajor;i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(map.sourceData?.stationMajor?.features.length,'showing stations reuses valid OSM cache');
 }finally{pending.forEach(resolve=>resolve());dom.window.close();}
});
'''
startup.write_text(text)

for path in ['docs/data-maintenance.md','docs/labels.md']:
    p=Path(path)
    text=p.read_text()
    if 'Each successful OSM object has its own cache timestamp.' not in text:
        text+='\nEach successful OSM object has its own cache timestamp. Failed, omitted or malformed responses do not become seven-day empty name records. A refresh has an eight-second overall deadline and a bounded subdivision budget; successful object types survive failures in another type. Stale OSM-sourced names remain available offline without being marked fresh. Missing or expired objects can be retried on a later map interaction after a thirty-second backoff. Curated local search uses the same OSM-hydrated names as the labels, never maintenance notes.\n'
    p.write_text(text)

index=Path('styles/index.html')
text=index.read_text()
old='Curated priority never overrides a station name: the displayed name and recorded translations are read from that station’s OpenStreetMap object.'
new=old+' The fixed curated object IDs are requested from the OpenStreetMap API when the overview is used; their names are cached locally.'
if new not in text:
    assert old in text
    text=text.replace(old,new,1)
index.write_text(text)
print('Applied bounded per-object OSM names and regression tests.',flush=True)
