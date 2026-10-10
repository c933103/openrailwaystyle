import test from 'node:test';
import assert from 'node:assert/strict';
import {MAJOR_STATION_DENSITY,validateStationCountries,majorStationsGeoJSON,selectMajorStations,distanceKm,separationPixels,duplicatesMajorStation} from '../scripts/major-stations.mjs';
import {readFile} from 'node:fs/promises';
import {osmObject} from '../styles/map-model.mjs';
const entry=(id,lon,lat,extra={})=>({wikidata:`Q${id}`,osm:`node/${id}`,lon,lat,name:`Hub ${id}`,country:'X',metro:`City ${id}`,region:'Test',rank:id,minZoom:3,basis:'Curated passenger hub; https://www.wikidata.org/wiki/Q'+id,...extra});
test('station selection spreads hubs globally and postpones a second station in one metropolis',()=>{
 const entries=[entry(1,139.767,35.681,{metro:'Tokyo'}),entry(2,139.7,35.69,{metro:'Tokyo',minZoom:5}),entry(3,-87.64,41.88,{metro:'Chicago'}),entry(4,-73.994,40.75,{metro:'New York'}),entry(5,-73.54,41.05,{metro:'Stamford',minZoom:6})];
 const picked=selectMajorStations(entries);
 assert.equal(picked[0].tier,3);assert.equal(picked[1].tier,7);assert.equal(picked[2].tier,3);assert.equal(picked[3].tier,3);assert.ok(picked[4].tier>picked[3].tier);
 for(const {zoom:z,spacing} of MAJOR_STATION_DENSITY){const visible=picked.filter(e=>e.tier<=z);for(let i=0;i<visible.length;i++)for(let j=0;j<i;j++){if(z===3)assert.ok(distanceKm(visible[i],visible[j])>=550);else assert.ok(separationPixels(visible[i],visible[j],z)>=spacing);}}
});
test('spacing wraps the date line and stays finite at polar latitudes',()=>{
 assert.ok(distanceKm(entry(1,179.9,0),entry(2,-179.9,0))<23);
 assert.ok(separationPixels(entry(1,179.9,0),entry(2,-179.9,0),4)<5);
 assert.ok(Number.isFinite(separationPixels(entry(1,0,89.9),entry(2,90,89.9),4)));
 assert.equal(selectMajorStations([entry(1,179.9,0),entry(2,-179.9,0)])[1].tier,7);
});
test('overview density admits closer stations at each zoom without removing earlier hubs',async()=>{
 const adjacent=selectMajorStations([entry(1,0,0),entry(2,64*360/(512*2**6),0,{minZoom:6})]);
 assert.equal(adjacent[1].tier,6,'64 px is accepted at zoom 6 instead of the old 78 px threshold');
 const regional=selectMajorStations([entry(1,0,0),entry(2,72*360/(512*2**4),0,{minZoom:4})]);
 assert.equal(regional[1].tier,5,'72 px is too close at zoom 4 but can enter zoom 5');
 const entries=JSON.parse(await readFile(new URL('../styles/data-src/major-stations.json',import.meta.url))),picked=selectMajorStations(entries);
 let previous=0;
 for(const {zoom:z,spacing,padding} of MAJOR_STATION_DENSITY){
  const visible=picked.filter(e=>e.tier<=z);assert.ok(visible.length>previous,`more curated candidates at zoom ${z}`);previous=visible.length;
  for(let i=0;i<visible.length;i++)for(let j=0;j<i;j++)assert.ok(z===3?distanceKm(visible[i],visible[j])>=550:separationPixels(visible[i],visible[j],z)>=spacing);
  if(z>4){const prior=MAJOR_STATION_DENSITY[z-4];assert.ok(spacing<prior.spacing&&padding<prior.padding);}
 }
});
test('curated GeoJSON retains identity but cannot supply a display name',()=>{
 const e=entry(1,139,35,{name:'Readable source note','name:en':'Do not render this','name:ja':'表示しない'}),data=majorStationsGeoJSON([e]),f=data.features[0];
 assert.deepEqual(osmObject({...f,source:'stationMajor'}),{type:'node',id:'1'});
 assert.equal(Object.keys(f.properties).some(k=>k==='name'||k.startsWith('name:')),false,'curated metadata has no rendering name fields');
 assert.equal(e.name,'Readable source note','the source note remains readable to maintainers');
 assert.ok(duplicatesMajorStation({osm_type:'node',osm_id:1},[e]));assert.ok(duplicatesMajorStation({osm_id:'node-1'},[e]));assert.ok(duplicatesMajorStation({id:'node-1-train-station'},[e]));assert.equal(duplicatesMajorStation({osm_type:'way',osm_id:1},[e]),false);
 assert.throws(()=>majorStationsGeoJSON([e,e]));
});
test('every curated list entry has a verifiable identity, source and plausible coordinates',async()=>{
 const entries=JSON.parse(await readFile(new URL('../styles/data-src/major-stations.json',import.meta.url)));
 const data=majorStationsGeoJSON(entries);assert.ok(entries.length>100);assert.ok(data.features.length>80);
 for(const e of entries)assert.match(e.basis,/https:\/\//);
});

test('reviewed worldwide candidates retain principal hubs and postpone adjacent terminals',async()=>{
 const entries=JSON.parse(await readFile(new URL('../styles/data-src/major-stations.json',import.meta.url))),picked=selectMajorStations(entries),byId=new Map(picked.map(e=>[e.wikidata,e]));
 assert.equal(byId.get('Q1155989').tier,3,'Chicago Union');assert.equal(byId.get('Q54451').tier,3,'New York Penn');assert.equal(byId.get('Q283196').tier,3,'Tokyo');
 assert.equal(byId.get('Q801447').tier,7,'Shinjuku waits for space');assert.equal(byId.get('Q11290').tier,7,'Grand Central waits for space');
 assert.equal(new Set(entries.map(e=>e.region)).size,10);
 for(let z=3;z<=4;z++){const places=picked.filter(e=>e.tier<=z).map(e=>e.country+':'+e.metro);assert.equal(new Set(places).size,places.length);}
});

test('station country evidence rejects homonymous foreign stations and keeps Lagos in Nigeria',async()=>{
 const entries=JSON.parse(await readFile(new URL('../styles/data-src/major-stations.json',import.meta.url)));validateStationCountries(entries);
 const lagos=entries.find(e=>e.metro==='Lagos');assert.equal(lagos.osm,'node/12260658320');assert.equal(lagos.country,'NG');assert.ok(lagos.lon>3&&lagos.lon<4&&lagos.lat>6&&lagos.lat<7);
 assert.equal(entries.some(e=>e.wikidata==='Q17087683'||e.wikidata==='Q8780001'),false);assert.throws(()=>validateStationCountries([{name:'Lagos',country:'NG',countryEvidence:['PT']}]));
});

test('provider fill remains available across regional overview zooms beneath curated priorities',async()=>{
 const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
 const fill=style.layers.filter(l=>l.source==='stationLow'&&l.type==='symbol');assert.ok(fill.length);
 for(const layer of fill){assert.equal(layer.minzoom,4);assert.equal(layer.maxzoom,7);assert.ok(style.layers.indexOf(layer)<style.layers.findIndex(l=>l.id==='station-major-6-names'));}
 const baseline=JSON.parse(await readFile(new URL('./fixtures/stations-before-density.json',import.meta.url)));
 const data=majorStationsGeoJSON(JSON.parse(await readFile(new URL('../styles/data-src/major-stations.json',import.meta.url))));
 for(const f of data.features)if(baseline[f.id])assert.ok(f.properties.tier<=baseline[f.id],`${f.id} must not be deferred`);
 for(const id of Object.keys(baseline))assert.ok(data.features.some(f=>f.id===id),`${id} must retain overview coverage`);
});

test('provider station names stay eligible even when the same identity is curated',async()=>{
 const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
 const provider=style.layers.filter(l=>l.source==='stationLow'||l.source==='stationMed');
 assert.ok(provider.length);
 for(const layer of provider){const filter=JSON.stringify(layer.filter);assert.equal(filter.includes('Q54451'),false,layer.id);assert.equal(filter.includes('node-895371274'),false,layer.id);}
});
