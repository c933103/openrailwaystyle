import test from 'node:test';
import assert from 'node:assert/strict';
import {powerMethodQuery,powerMethodsGeoJSON} from '../scripts/power-method-data.mjs';
import {powerFacility,createPowerFacilityLoader} from '../styles/power-facilities.mjs';
import {powerMethodLayers} from '../scripts/style/layers/power-methods.mjs';
import {featureFilter,validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {layerVisibility,annotateLayers} from '../styles/layer-semantics.mjs';
import {osmObject} from '../styles/map-model.mjs';
const prefixes=['','construction:','proposed:','disused:','abandoned:','razed:','demolished:','removed:'];
const geometry=[{lon:135,lat:34},{lon:135.001,lat:34.001}];
const way=(tags,id=12)=>({type:'way',id,tags,geometry});
test('third/fourth/ground-level supply keeps OSM geometry and method without voltage inference',()=>{
  for(const method of ['rail','4th_rail','ground-level_power_supply','contact_line;rail',' rail ; 4th_rail ']) {
    const data=powerMethodsGeoJSON({elements:[way({railway:'subway',electrified:method,voltage:'750',frequency:'0','electrified:rail':'bottom'})]});
    assert.equal(data.features.length,1);const f=data.features[0];
    assert.equal(f.properties.voltage,750);assert.equal(f.properties.frequency,0);
    assert.deepEqual(f.geometry.coordinates,geometry.map(p=>[p.lon,p.lat]));
    assert.equal(f.properties['electrified:rail'],'bottom');
    assert.deepEqual(osmObject({source:'electricMethods',properties:f.properties}),{type:'way',id:'12'});
  }
  for(const tags of [{railway:'subway',voltage:'750',frequency:'0'},{railway:'rail',electrified:'contact_line'},{highway:'primary',electrified:'rail'}])assert.equal(powerMethodsGeoJSON({elements:[way(tags)]}).features.length,0);
  assert.throws(()=>powerMethodsGeoJSON({remark:'timed out',elements:[]}),/timed out/);
  assert.throws(()=>powerMethodsGeoJSON({elements:[{...way({railway:'subway',electrified:'rail'}),geometry:undefined}]}),/Incomplete geometry/);
  assert.throws(()=>powerMethodsGeoJSON({elements:[{...way({railway:'subway',electrified:'rail'}),geometry:[{lon:135,lat:34},{}]}]}),/Incomplete geometry/);
});
test('railway chargers are explicit: train/rail tags accepted, station car parks and ordinary supplies excluded',()=>{
  for(const prefix of prefixes) {
    for(const tags of [{[prefix+'railway']:'charging_station'}, {[prefix+'amenity']:'charging_station',train:'yes'}, {[prefix+'man_made']:'charge_point',tram:'designated'}]) {
      assert.equal(powerFacility(tags).kind,'charging_station');
      assert.equal(powerMethodsGeoJSON({elements:[{type:'node',id:1,lon:135,lat:34,tags}]}).features[0].properties.power_state,prefix.slice(0,-1)||'present');
    }
  }
  for(const tags of [{amenity:'charging_station'},{amenity:'charging_station',landuse:'railway',motorcar:'yes'}, {amenity:'charging_station',train:'no'}, {railway:'power_supply'}]) {
    assert.equal(powerMethodsGeoJSON({elements:[{type:'node',id:1,lon:135,lat:34,tags}]}).features.length,0);
  }
  assert.equal(powerFacility({railway:'disused',amenity:'charging_station',train:'yes'}).state,'disused');
  assert.equal(powerMethodsGeoJSON({elements:[way({railway:'construction',construction:'subway',electrified:'rail'})]}).features[0].properties.power_state,'construction');
  const polygon=way({amenity:'charging_station',train:'yes'});
  const f=powerMethodsGeoJSON({elements:[polygon]}).features[0];assert.equal(f.geometry.type,'Point');assert.deepEqual(f.geometry.coordinates,[135.0005,34.0005]);
});
test('supplement query uses literal, bounded lifecycle selectors and requests geometry',()=>{
  const query=powerMethodQuery([-90,-180,0,-90]);
  for(const prefix of prefixes)assert.ok(query.includes(JSON.stringify(prefix+'electrified')));
  assert.ok(query.includes('out body geom qt'));assert.ok(!query.includes('[~'));
  assert.ok(!query.includes('contact_line|'),'ordinary overhead network is already provided');
  for(const box of [null,[],[0,0,0,1],[0,0,91,1],[0,0,1,Infinity]])assert.throws(()=>powerMethodQuery(box),/Invalid/);
});
test('track and electrification lifecycle both keep conductor rails behind the former setting',()=>{
  for(const state of prefixes.slice(1)) {
    for(const tags of [{[state+'railway']:'subway',electrified:'rail'}, {railway:'subway',[state+'electrified']:'rail'}])assert.equal(powerMethodsGeoJSON({elements:[way(tags)]}).features[0].properties.power_state,state.slice(0,-1));
  }
  const layers=annotateLayers(powerMethodLayers()), settings={mode:'electrification',labels:true,inactive:true,background:'map'};
  for(const l of layers) {
    assert.equal(layerVisibility(l,settings),true,l.id);
    assert.equal(layerVisibility(l,{...settings,destinations:false}),true,l.id);
    assert.equal(layerVisibility(l,{...settings,mode:'control'}),false,l.id);
    assert.equal(layerVisibility(l,{...settings,inactive:false}),!l.id.includes('former-'),l.id);
  }
  const line=layers.find(l=>l.id==='electrification-conductor-rails'),filter=featureFilter(line.filter).filter;
  assert.equal(filter({zoom:14},{type:2,properties:{power_state:'present',method_rail:true}}),true);
  assert.equal(filter({zoom:14},{type:2,properties:{power_state:'present',method_rail:false}}),false,'a line without third rail is not drawn as one');
  assert.equal(filter({zoom:14},{type:1,properties:{power_state:'present',method_rail:true}}),false);
  assert.deepEqual(validateStyleMin({version:8,glyphs:'https://example.org/{fontstack}/{range}.pbf',sources:{electricMethods:{type:'geojson',data:{type:'FeatureCollection',features:[]}},electricCatenary:{type:'vector',tiles:['https://example.org/{z}/{x}/{y}.pbf']}},layers}),[]);
  assert.deepEqual(osmObject({source:'electricCatenary',properties:{id:'123-mast'}}),{type:'node',id:'123'});
  assert.deepEqual(osmObject({source:'electricCatenary',properties:{id:'124-portal'}}),{type:'way',id:'124'});
});
test('facility data is restored into a replaced style source without another download',async()=>{
  let calls=0,source,language='en';const shown=[];
  const next=()=>source={setData:data=>shown.push(data)};next();
  const refresh=createPowerFacilityLoader({getSource:()=>source},{url:'fixture',sourceId:'electricMethods',language:()=>language,fetcher:async()=>{calls++;return {ok:true,json:async()=>({type:'FeatureCollection',features:[]})};}});
  await refresh();await refresh();assert.equal(shown.length,1);next();await refresh();assert.equal(shown.length,2);assert.equal(calls,1);
  source=undefined;await refresh();next();await refresh();assert.equal(shown.length,3);language='ja';await refresh();assert.equal(shown.length,4);
});

test('maintenance builder publishes all eight regions, reuses exact caches and refuses failed/empty data',async()=>{
  const {mkdtemp,writeFile,readFile,access,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
  const script=new URL('../scripts/build-power-methods.mjs',import.meta.url).pathname;
  for(const outcome of ['success','empty','partial','budget']) {
    const dir=await mkdtemp(join(tmpdir(),'atlas-power-methods-'));
    try {
      const bootstrap=join(dir,'fixture.mjs');
      await writeFile(bootstrap,`globalThis.setTimeout=fn=>{queueMicrotask(fn);return 0;};\nglobalThis.fetch=async()=>{\nif(process.env.FIXTURE_CACHE_ONLY==='1')throw new Error('Unexpected network request');\nconst json=${JSON.stringify(outcome==='partial'?{remark:'timed out',elements:[]}:outcome==='empty'?{elements:[]}:{elements:[way({railway:'subway',electrified:'rail'})]})};\nreturn {ok:true,body:(async function*(){yield ${outcome==='budget'?'{length:100000001}':'Buffer.from(JSON.stringify(json))'};})()};\n};`);
      const env={...process.env,POWER_OUTPUT:join(dir,'power'),OVERPASS_URL:'http://127.0.0.1:1/fixture'};
      const run=spawnSync(process.execPath,['--import',bootstrap,script],{cwd:dir,env,encoding:'utf8',timeout:15000});
      assert.equal(run.error,undefined,run.stderr);
      if(outcome==='success') {
        assert.equal(run.status,0,run.stderr);const manifest=JSON.parse(await readFile(join(dir,'power/methods-manifest.json')));
        assert.equal(manifest.complete,true);assert.equal(manifest.coverage.length,8);assert.equal(manifest.requests,8);assert.equal(manifest.features,1);
        const reused=spawnSync(process.execPath,['--import',bootstrap,script],{cwd:dir,env:{...env,FIXTURE_CACHE_ONLY:'1'},encoding:'utf8',timeout:15000});
        assert.equal(reused.status,0,reused.stderr);assert.equal(JSON.parse(await readFile(join(dir,'power/methods-manifest.json'))).requests,0);
      } else {assert.notEqual(run.status,0);await assert.rejects(access(join(dir,'power/power-methods.geojson')));await assert.rejects(access(join(dir,'power/methods-manifest.json')));}
    }finally{await rm(dir,{recursive:true,force:true});}
  }
});

test('every means of delivery and traction is kept with exact per-method fields',()=>{
  const cases=[
    [{railway:'subway',electrified:'rail'},{method_rail:true,method_fourth_rail:false}],
    [{railway:'subway',electrified:'4th_rail'},{method_rail:false,method_fourth_rail:true}],
    [{railway:'tram',electrified:'ground-level_power_supply'},{method_ground:true}],
    [{railway:'tram',electrified:'inductive'},{method_inductive:true}],
    [{railway:'monorail',propulsion:'linear_motor',electrified:'contact_line'},{propulsion_linear_motor:true,method_rail:false}],
    [{railway:'narrow_gauge',traction:'rack',electrified:'no'},{traction_rack:true}],
    [{railway:'funicular',traction:'cable'},{traction_cable:true}],
    [{railway:'rail',electrified:'contact_line;rail'},{method_rail:true}],
  ];
  for(const [tags,expected] of cases) {
    const data=powerMethodsGeoJSON({elements:[way(tags)]});
    assert.equal(data.features.length,1,JSON.stringify(tags));
    for(const [key,value] of Object.entries(expected))assert.equal(data.features[0].properties[key],value,`${JSON.stringify(tags)} ${key}`);
  }
  assert.equal(powerMethodsGeoJSON({elements:[way({railway:'rail',traction:'adhesion',propulsion:'motor'})]}).features.length,0,'ordinary adhesion and motor propulsion are not separate means');
  assert.equal(powerMethodsGeoJSON({elements:[way({railway:'rail',electrified:'rail;contact_line',traction:'rack'})]}).features[0].properties.power_method_label,'Third rail + Rack railway');
  const query=powerMethodQuery([-90,-180,0,-90]);
  for(const key of ['propulsion','traction'])for(const prefix of prefixes)assert.ok(query.includes(JSON.stringify(prefix+key)),prefix+key);
  assert.ok(query.includes('inductive'));
});

test('each means has its own stroke, a fourth-rail track is dashed on both sides, and older snapshots still draw',async()=>{
  const {POWER_METHOD_STROKES}=await import('../styles/power-facilities.mjs');
  const layers=powerMethodLayers();
  for(const {id} of POWER_METHOD_STROKES)for(const suffix of ['','former-'])assert.ok(layers.some(l=>l.id===`electrification-${suffix}${id}`),id);
  const filter=id=>featureFilter(layers.find(l=>l.id===id).filter).filter;
  const at=properties=>({type:2,properties:{power_state:'present',...properties}});
  assert.equal(filter('electrification-conductor-rails')({zoom:12},at({method_rail:false,method_fourth_rail:true})),true,'fourth-rail tracks draw both sides');
  assert.equal(filter('electrification-fourth-rails')({zoom:12},at({method_rail:true,method_fourth_rail:false})),false,'third rail is not mistaken for fourth');
  assert.equal(filter('electrification-linear-motors')({zoom:12},at({propulsion_linear_motor:true})),true);
  assert.equal(filter('electrification-rack-traction')({zoom:12},at({traction_rack:false})),false);
  // Published before the per-method fields: only power_method is recorded.
  assert.equal(filter('electrification-conductor-rails')({zoom:12},at({power_method:'rail'})),true);
  assert.equal(filter('electrification-fourth-rails')({zoom:12},at({power_method:'rail'})),false);
  assert.equal(filter('electrification-fourth-rails')({zoom:12},at({power_method:'4th_rail'})),true);
  assert.equal(filter('electrification-ground-supply')({zoom:12},at({power_method:'ground-level_power_supply'})),true);
  assert.equal(filter('electrification-former-conductor-rails')({zoom:12},at({method_rail:true})),false,'present tracks stay out of former layers');
});
