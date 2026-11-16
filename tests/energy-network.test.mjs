import test from 'node:test';
import assert from 'node:assert/strict';
import {energyNetworkKind,energyNetworkGeoJSON,railRelationship} from '../scripts/energy-network-data.mjs';
const way=(id,points,tags)=>({type:'way',id,tags,geometry:points.map(([lon,lat])=>({lon,lat}))});
const area=way(1,[[0,0],[.001,0],[.001,.001],[0,.001],[0,0]],{industrial:'refinery'});
test('civil electricity and all supply domains are classified from their own tags',()=>{
  for(const [tags,domain,minzoom] of [[{power:'line',voltage:'400000'},'electricity',5],[{power:'minor_line'},'electricity',12],[{power:'generator','generator:source':'battery'},'battery',10],[{man_made:'pipeline',substance:'hydrogen'},'hydrogen',8],[{man_made:'pipeline',substance:'water'},'water',10],[{industrial:'refinery'},'fuel',8],[{resource:'coal'},'coal',9]]){
    const kind=energyNetworkKind(tags);assert.equal(kind.domain,domain);assert.equal(kind.minzoom,minzoom);
  }
  assert.equal(energyNetworkKind({name:'Railway hydrogen depot'}),null);
  assert.equal(energyNetworkKind({'disused:power':'plant'}).state,'disused');
});
test('rail intersection, 35m adjacency and civil absence remain distinct evidence',()=>{
  const crossing=[{id:'way-2',line:[[-.001,.0005],[.002,.0005]]}];
  assert.match(railRelationship(area,crossing).siding_evidence,/intersects/);
  const near=[{id:'way-3',line:[[.0012,0],[.0012,.001]]}];
  assert.match(railRelationship(area,near).siding_evidence,/connection unverified/);
  assert.equal(railRelationship(area,[{id:'way-4',line:[[.002,0],[.002,.001]]}]).supply_tier,'civil_network');
});
test('tracks within a multipolygon hole do not establish a rail-served site',()=>{
  const hole=way(9,[[.0002,.0002],[.0008,.0002],[.0008,.0008],[.0002,.0008],[.0002,.0002]],{});
  const relation={type:'relation',id:3,tags:{type:'multipolygon',industrial:'refinery'},members:[{type:'way',role:'outer',geometry:area.geometry},{type:'way',role:'inner',geometry:hole.geometry}]};
  assert.equal(railRelationship(relation,[{id:'way-8',line:[[.0003,.0003],[.0004,.0004]]}]).rail_served,false);
});
test('raw fuel tags survive and unknown fuel is never invented',()=>{
  const data=energyNetworkGeoJSON([{type:'node',id:6,lon:0,lat:0,tags:{railway:'fuel','fuel:diesel':'no','fuel:hydrogen':'yes'}},{type:'node',id:7,lon:1,lat:1,tags:{railway:'fuel'}}]);
  assert.equal(data.features[0].properties['fuel:diesel'],'no');
  assert.equal(data.features[0].properties['fuel:hydrogen'],'yes');
  assert.equal(data.features[1].properties['fuel:diesel'],undefined);
  assert.equal(data.features[0].properties.supply_tier,'trackside');
});
test('invalid energy geometry fails instead of certifying a partial feature',()=>{
  assert.throws(()=>energyNetworkGeoJSON([{type:'way',id:1,tags:{power:'line'},geometry:[{lon:0,lat:0}]}]),/Incomplete/);
});
test('complete-only extract builder checks filter provenance and emits readable bundles',async t=>{
  const {mkdtemp,readFile,writeFile,readdir,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {gunzipSync}=await import('node:zlib');
  const {buildExtractEnergyNetwork}=await import('../scripts/build-extract-energy-network.mjs');
  const {currentFilter}=await import('../scripts/extract-release.mjs');
  const {decodeBundle}=await import('../styles/tile-bundles.mjs');
  const dir=await mkdtemp(join(tmpdir(),'energy-network-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const report={schema:1,regions:2,oldestTimestamp:'2026-11-01T00:00:00Z',newestTimestamp:'2026-11-02T00:00:00Z',missingNodeRefs:0,missingRegions:[],selectionFilters:{region:currentFilter('region'),gap:currentFilter('gap/0')}};
  const read=async(pbf,{keep,onElement})=>{for(const e of [area,{type:'node',id:20,lon:.0005,lat:.0005,tags:{power:'transformer'}}])if(keep(e))onElement(e);return {withoutGeometry:0};};
  await assert.rejects(buildExtractEnergyNetwork('fixture',{...report,selectionFilters:{}},dir,{read}),/current selection filters/);
  assert.equal(await buildExtractEnergyNetwork('fixture',{...report,missingRegions:['gap']},dir,{read}),null);
  assert.deepEqual(await readdir(dir),[]);
  const output=join(dir,'snapshot');
  const manifest=await buildExtractEnergyNetwork('fixture',report,output,{read});
  await assert.rejects(buildExtractEnergyNetwork('fixture',report,output,{read}),/already exists/);
  const {validateEnergyNetwork}=await import('../scripts/validate-energy-network.mjs');
  assert.deepEqual(await validateEnergyNetwork(output),manifest);
  const {measureEnergyNetwork}=await import('../scripts/measure-energy-network.mjs');
  const budget=await measureEnergyNetwork(output);assert.equal(budget.withinBudget,true);assert.equal(budget.pitchedAndGlobeVerified,false);assert.equal(budget.rotatedViewsVerified,false);assert.equal(budget.viewport.bearing,0);assert.equal(budget.tiers.length,10);
  assert.equal(manifest.complete,true);assert.equal(manifest.features,2);assert.ok(manifest.largestBundleBytes<350000);
  assert.deepEqual(JSON.parse(await readFile(join(output,'overview/index.json'))).bundles,[], 'z8+ refinery is absent from coarse overview');
  const index=JSON.parse(await readFile(join(output,'detail/index.json')));
  const bytes=gunzipSync(await readFile(join(output,`detail/12/${index.bundles[0]}.bundle.gz`)));
  const tiles=decodeBundle(bytes);assert.ok(tiles.size>0);
  await writeFile(join(output,'manifest.json'),JSON.stringify({...manifest,bytes:manifest.bytes+1}));
  await assert.rejects(validateEnergyNetwork(output),/size mismatch/);

  const {VectorTile}=await import('@mapbox/vector-tile');const {default:Pbf}=await import('pbf');
  const records=[];for(const data of tiles.values()){const layer=new VectorTile(new Pbf(data)).layers.atlas_energy_network;for(let i=0;i<layer.length;i++)records.push(layer.feature(i));}
  assert.ok(records.some(f=>f.type===1&&f.properties.energy_kind==='transformer'&&f.properties.energy_minzoom===13),'detail retains high-zoom point threshold');
  assert.ok(records.some(f=>f.type===3&&f.properties.energy_kind==='refinery'),'detail retains area geometry');
});

test('closed line circuits remain lines, and detailed points stay out of overview',async()=>{
  for(const tags of [{power:'line'},{power:'cable'},{power:'minor_line'},{man_made:'pipeline',substance:'gas'}]){
    const feature=energyNetworkGeoJSON([way(900,[[0,0],[.001,0],[.001,.001],[0,0]],tags)]).features[0];
    assert.equal(feature.geometry.type,'LineString');
  }
});
test('oversized bundles refuse publication without dropping source features',async t=>{
 const {mkdtemp,readdir,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {randomBytes}=await import('node:crypto');
 const {buildExtractEnergyNetwork}=await import('../scripts/build-extract-energy-network.mjs');const {currentFilter}=await import('../scripts/extract-release.mjs');
 const dir=await mkdtemp(join(tmpdir(),'energy-limit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const report={schema:1,regions:1,oldestTimestamp:'2026-11-01T00:00:00Z',newestTimestamp:'2026-11-01T00:00:00Z',missingNodeRefs:0,missingRegions:[],selectionFilters:{region:currentFilter('region'),gap:currentFilter('gap/0')}};
 const element={...area,tags:{...area.tags,name:randomBytes(500000).toString('base64')}};
 const read=async(pbf,{onElement})=>{onElement(element);return {withoutGeometry:0};};
 await assert.rejects(buildExtractEnergyNetwork('fixture',report,join(dir,'snapshot'),{read}),/350 KB/);
 assert.deepEqual(await readdir(dir),[],'no incomplete output or stale manifest');
});

test('closed network circuits never establish site interiors',()=>{
 for(const tags of [{power:'line'},{power:'cable'},{man_made:'pipeline',substance:'gas'},{'disused:man_made':'pipeline',substance:'gas'}]){
  const circuit=way(101,[[0,0],[.01,0],[.01,.01],[0,.01],[0,0]],tags);
  const track=way(102,[[.004,.004],[.005,.005]],{railway:'rail'});
  const feature=energyNetworkGeoJSON([circuit,track]).features[0];
  assert.equal(feature.geometry.type,'LineString');assert.equal(feature.properties.rail_served,false);
  assert.equal(railRelationship(circuit,[{id:'way-102',line:[[.004,.004],[.005,.005]]}]).rail_served,false);
 }
});
test('lifecycle types retain shared descriptors with explicit prefixed precedence',()=>{
 assert.equal(energyNetworkKind({'disused:man_made':'pipeline',substance:'gas'}).domain,'fuel');
 assert.equal(energyNetworkKind({'disused:man_made':'storage_tank',content:'hydrogen'}).domain,'hydrogen');
 assert.equal(energyNetworkKind({'disused:man_made':'pipeline',substance:'gas','disused:substance':'water'}).domain,'water');
 assert.equal(energyNetworkKind({'disused:power':'line',voltage:'400000'}).minzoom,5);
 assert.equal(energyNetworkKind({man_made:'pipeline','disused:substance':'gas'}),null);
});

test('detail tile geometry preserves an eleven-metre site footprint',async()=>{
 const {networkTiles}=await import('../scripts/build-extract-energy-network.mjs');
 const {VectorTile}=await import('@mapbox/vector-tile');const {default:Pbf}=await import('pbf');
 const data=energyNetworkGeoJSON([way(200,[[.0001,.0001],[.0002,.0001],[.0002,.0002],[.0001,.0002],[.0001,.0001]],{man_made:'storage_tank',content:'hydrogen'})]);
 const tiles=networkTiles(data,{minZoom:12,maxZoom:14});
 const tile=tiles.get('14/8192/8191');assert.ok(tile);
 const feature=new VectorTile(new Pbf(tile)).layers.atlas_energy_network.feature(0).toGeoJSON(8192,8191,14);
 const points=feature.geometry.coordinates.flat();
 const width=(Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])))*111195;
 assert.ok(Math.abs(width-11.1195)<1,`eleven-metre footprint became ${width} metres`);
});

test('extra-high-voltage grid begins at the plan zoom five',async()=>{
 const {networkTiles}=await import('../scripts/build-extract-energy-network.mjs');
 const data=energyNetworkGeoJSON([way(300,[[0,0],[1,1]],{power:'line',voltage:'400000'})]);
 assert.equal(data.features[0].properties.energy_minzoom,5);
 const {ENERGY_TIERS}=await import('../scripts/energy-network-schema.mjs');
 assert.equal(ENERGY_TIERS.overview.minzoom,5);
 assert.ok([...networkTiles(data,{minZoom:5,maxZoom:7}).keys()].some(k=>k.startsWith('5/')));
});

test('named supply domains preserve explicit material and unknown pumping contents',()=>{
 for(const [tags,kind,domain,zoom] of [
 [{man_made:'goods_conveyor',resource:'coal'},'coal_conveyor','coal',12],
 [{man_made:'petroleum_well',substance:'gas'},'petroleum_well','fuel',12],
 [{man_made:'storage_tank',content:'coal'},'storage','coal',10],
 [{man_made:'pumping_station',substance:'gas'},'pumping_station','fuel',11],
 [{man_made:'pumping_station'},'pumping_station','unknown',11],
 [{man_made:'water_tank'},'water_tank','water',11],
 [{railway:'fuel','fuel:hydrogen':'yes'},'fuel','hydrogen',11],
 [{railway:'insulator'},'insulator','electricity',14],
 [{industrial:'oil_field'},'oil_field','fuel',9],
 [{industrial:'coal_washery'},'coal_washery','coal',10],
 ]){const actual=energyNetworkKind(tags);assert.equal(actual.kind,kind);assert.equal(actual.domain,domain);assert.equal(actual.minzoom,zoom);}
 assert.equal(energyNetworkKind({man_made:'goods_conveyor',resource:'gravel'}),null);
 const conveyor=energyNetworkGeoJSON([way(400,[[0,0],[.001,0],[.001,.001],[0,0]],{man_made:'goods_conveyor',resource:'coal'})]).features[0];assert.equal(conveyor.geometry.type,'LineString');assert.equal(conveyor.properties.energy_line_style,'coal');
});

test('material descriptors do not preempt lifecycle feature types',()=>{
 const conveyor={'disused:man_made':'goods_conveyor',resource:'coal'};
 assert.deepEqual(energyNetworkKind(conveyor),{kind:'coal_conveyor',domain:'coal',minzoom:12,state:'disused'});
 assert.equal(energyNetworkGeoJSON([way(912,[[0,0],[.001,0],[.001,.001],[0,0]],conveyor)]).features[0].geometry.type,'LineString');
 assert.deepEqual(energyNetworkKind({'proposed:man_made':'petroleum_well',resource:'oil'}),{kind:'petroleum_well',domain:'fuel',minzoom:12,state:'proposed'});
 assert.equal(energyNetworkKind({power:'plant','disused:man_made':'goods_conveyor',resource:'coal'}).kind,'plant');
 assert.equal(energyNetworkKind({'disused:resource':'coal'}).state,'disused');
 assert.equal(energyNetworkKind({resource:'coal',disused:'yes'}).state,'disused');
 assert.equal(energyNetworkKind({resource:'oil',proposed:'yes'}).state,'proposed');
});
