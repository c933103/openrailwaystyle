import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {energySiteQuery,energySitesGeoJSON,mergeEnergySite} from '../scripts/energy-site-data.mjs';
import {buildEnergySites,validateEnergySitesSnapshot} from '../scripts/build-energy-sites.mjs';
import {energySiteLayers,energySiteNameLayers} from '../scripts/style/layers/energy-sites.mjs';
import {energySiteRows,energySiteName,POWER_FACILITY_EXPLANATION,ENERGY_SITE_NOTE} from '../styles/power-facilities.mjs';
import {lineMeetsRing,outerRings} from '../scripts/osm-geometry.mjs';
import {featureFilter,validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {layerVisibility,annotateLayers} from '../styles/layer-semantics.mjs';

// A 0.01° square site at (10, 50) and helpers for ways, sidings and storage.
const square=(x=10,y=50,d=0.01)=>[[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]];
const geometry=points=>points.map(([lon,lat])=>({lon,lat}));
const site=(id,tags,points=square())=>({type:'way',id,tags,geometry:geometry(points)});
const siding=(id,points,tags={railway:'rail',service:'siding'})=>({type:'way',id,tags,geometry:geometry(points)});
const store=(id,lon,lat,tags)=>({type:'way',id,center:{lon,lat},tags:{man_made:'storage_tank',...tags}});
const entering=siding(900,[[9.99,50.005],[10.004,50.005]]);
const classify=elements=>Object.fromEntries(energySitesGeoJSON({elements}).features.map(f=>[f.id,f.properties]));

test('the query finds energy storage holders and keeps only candidates a siding meets',()=>{
  const query=energySiteQuery([50,9,51,10]);
  for(const part of ['->.sidings;','.storePoints is_in->.storeAreas;','area.storeAreas["landuse"="industrial"]->.holding;','nwr.candidates(around.sidings:0)->.sites;','way.sidings(around.sites:0)->.entering;','(.sites;.entering;);out body geom qt;.stores out tags center qt;'])assert.ok(query.includes(part),part);
  assert.ok(query.includes('["disused:railway"~"(^|;)[[:space:]]*(rail|narrow_gauge|light_rail)[[:space:]]*(;|$)",i]'));
  for(const bad of [[0,0,0,0],[-91,0,0,1],[0,0,1],null])assert.throws(()=>energySiteQuery(bad),/Invalid energy-site bbox/);
});

test('a site needs an energy role and a siding entering its area',()=>{
  const sites=classify([
    site(1,{landuse:'industrial',industrial:'refinery',name:'Refinery'}),
    site(2,{landuse:'industrial'},square(11)),store(20,11.005,50.005,{content:'diesel;adblue'}),store(21,11.002,50.002,{content:'water'}),
    site(3,{landuse:'quarry',resource:'coal'},square(12)),
    site(4,{landuse:'industrial'},square(13)),store(40,13.005,50.005,{content:'grain'}),
    site(5,{landuse:'industrial',industrial:'oil'},square(14)),
    site(6,{landuse:'industrial'},square(15)),store(60,15.005,50.005,{content:'coal'}),
    entering,
    siding(901,[[10.99,50.005],[11.002,50.005]]),
    siding(902,[[11.99,50.005],[12.001,50.005]],{railway:'narrow_gauge',usage:'industrial'}),
    siding(903,[[12.99,50.005],[13.004,50.005]]),
    siding(904,[[13.99,50.02],[14.02,50.02]]),
    siding(905,[[14.99,50.005],[15.003,50.005]],{'disused:railway':'rail',service:'spur'}),
  ]);
  assert.deepEqual(Object.keys(sites).sort(),['way-1','way-2','way-3','way-6']);
  assert.equal(sites['way-1'].energy_kind,'fuel_site');assert.equal(sites['way-1'].energy_evidence,'industrial=refinery');
  assert.equal(sites['way-1'].rail_sidings,'way-900');assert.equal(sites['way-1'].power_state,'present');
  assert.equal(sites['way-2'].energy_evidence,'storage contents');assert.equal(sites['way-2'].stored_contents,'diesel','water and AdBlue are not fuel');
  assert.equal(sites['way-3'].energy_kind,'coal_site');assert.equal(sites['way-3'].energy_group,'coal');
  assert.equal(sites['way-6'].power_state,'disused','only a disused spur enters');
  assert.equal(sites['way-1'].osm_type,'way');assert.equal(sites['way-1'].osm_id,'1');
});

test('proximity, main lines, points and unclosed ways are not rail-served sites',()=>{
  const sites=classify([
    site(1,{landuse:'industrial',industrial:'fuel_depot'}),
    siding(910,[[9.99,49.999],[10.02,49.999]]),
    siding(911,[[9.99,50.005],[10.02,50.005]],{railway:'rail',usage:'main'}),
    {type:'node',id:2,lon:10.5,lat:50.5,tags:{industrial:'fuel_depot'}},
    siding(912,[[10.49,50.5],[10.51,50.5]]),
    site(3,{industrial:'refinery'},[[11,50],[11.01,50],[11.01,50.01]]),
    siding(913,[[10.99,50.005],[11.02,50.005]]),
  ]);
  assert.deepEqual(sites,{},'a siding 100 m away, a main line crossing, a point site and an unclosed outline do not qualify');
});

test('multipolygon sites, segment crossings and storage on the boundary region are handled',()=>{
  const half=(points,role='outer')=>({type:'way',role,geometry:geometry(points)});
  const relation={type:'relation',id:7,tags:{type:'multipolygon',landuse:'industrial',industrial:'gas'},
    members:[half([[20,50],[20.01,50],[20.01,50.01]]),half([[20,50],[20,50.01],[20.01,50.01]])]};
  // A siding crossing the corner without a vertex inside still enters.
  const crossing=siding(920,[[19.998,50.003],[20.003,49.998]]);
  const sites=classify([relation,crossing]);
  assert.equal(sites['relation-7'].rail_sidings,'way-920');
  assert.equal(outerRings(relation.members).length,1);
  assert.equal(lineMeetsRing([[19.9,49.9],[19.95,49.95]],square(20)),false);
  const geometryType=energySitesGeoJSON({elements:[relation,crossing]}).features[0].geometry.type;
  assert.equal(geometryType,'Polygon');
});

test('a site returned by two regions combines evidence in any order',()=>{
  const west=classify([site(1,{landuse:'industrial'}),store(10,10.002,50.002,{content:'oil'}),entering])['way-1'];
  const east=classify([site(1,{landuse:'industrial'}),store(11,10.008,50.008,{content:'coal'}),siding(930,[[10.011,50.005],[10.008,50.005]],{'abandoned:railway':'rail',service:'siding'})])['way-1'];
  const feature=properties=>({type:'Feature',id:'way-1',geometry:{type:'Polygon',coordinates:[square()]},properties});
  const a=mergeEnergySite(feature(west),feature(east)),b=mergeEnergySite(feature(east),feature(west));
  assert.deepEqual(a,b);
  assert.equal(a.properties.energy_kind,'fuel_site');assert.equal(a.properties.stored_contents,'coal;oil');
  assert.equal(a.properties.rail_sidings,'way-900;way-930');assert.equal(a.properties.power_state,'present');
});

test('incomplete responses and siding geometry are rejected',()=>{
  assert.throws(()=>energySitesGeoJSON({remark:'runtime error: Query timed out',elements:[]}),/timed out/);
  assert.throws(()=>energySitesGeoJSON({}),/Incomplete energy-site response/);
  assert.throws(()=>energySitesGeoJSON({elements:[{...entering,geometry:[{lon:1}]}]}),/Incomplete geometry for siding way-900/);
});

test('areas draw in Power view beneath tracks with names following Labels',()=>{
  const layers=annotateLayers([...energySiteLayers(),...energySiteNameLayers()]);
  assert.deepEqual(layers.map(l=>l.id),['electrification-energy-site-areas','electrification-energy-site-edges','electrification-former-energy-site-areas','electrification-former-energy-site-edges','electrification-energy-site-names']);
  const settings={mode:'electrification',labels:true,inactive:true,background:'map'};
  for(const l of layers) {
    assert.equal(layerVisibility(l,settings),true,l.id);
    assert.equal(layerVisibility(l,{...settings,mode:'speed'}),false,l.id);
    assert.equal(layerVisibility(l,{...settings,inactive:false}),!l.id.includes('former-'),l.id);
  }
  assert.equal(layerVisibility(layers.at(-1),{...settings,labels:false}),false);
  const filter=featureFilter(layers[0].filter).filter;
  assert.equal(filter({zoom:12},{type:3,properties:{power_state:'present'}}),true);
  assert.equal(filter({zoom:12},{type:3,properties:{power_state:'disused'}}),false);
  assert.deepEqual(validateStyleMin({version:8,glyphs:'https://example.org/{fontstack}/{range}.pbf',sources:{energySites:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},layers}),[]);
});

test('details state both kinds of evidence and the help explains what a served site is not',()=>{
  assert.deepEqual(energySiteRows({energy_kind:'fuel_site',power_state:'present',energy_evidence:'industrial=refinery;storage contents',stored_contents:'diesel;oil',rail_sidings:'way-1;way-2',operator:'Refiner'}),[
    ['Type','Rail-served fuel site'],['Status','present'],
    ['Energy evidence','Tagged industrial=refinery; Storage inside the site records energy contents'],
    ['Stored contents','diesel, oil'],['Rail connection','2 sidings enter the mapped site'],['Operator','Refiner']]);
  assert.equal(energySiteRows({energy_kind:'coal_site',power_state:'disused',rail_sidings:'way-1'}).find(r=>r[0]==='Status')[1],'disused rail connection');
  assert.equal(energySiteName({energy_kind:'coal_site'}),'Rail-served coal site');
  assert.ok(POWER_FACILITY_EXPLANATION.includes(ENERGY_SITE_NOTE));
  assert.match(ENERGY_SITE_NOTE,/not a train refuelling point/);
});

test('the staged builder publishes a complete, validated world snapshot',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'atlas-energy-sites-'));
  try {
    const options={cache:join(dir,'cache'),output:join(dir,'out'),sleep:async()=>{},log:()=>{}};
    const {manifest}=await buildEnergySites({...options,fetcher:async()=>new Response(JSON.stringify({osm3s:{},elements:[site(1,{industrial:'refinery'}),entering]}))});
    const data=JSON.parse(await readFile(join(options.output,'energy-sites.geojson'),'utf8'));
    assert.equal(data.features.length,1);validateEnergySitesSnapshot(data,manifest);
    assert.throws(()=>validateEnergySitesSnapshot(data,{...manifest,sha256:'bad'}),/Energy-site snapshot digest mismatch/);
    await assert.rejects(buildEnergySites({...options,refresh:true,fetcher:async()=>new Response(JSON.stringify({osm3s:{},elements:[]}))}),/Refusing to publish empty worldwide rail-served energy site data/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
