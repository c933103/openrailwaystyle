import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {tractionLineQuery,tractionLinesGeoJSON,mergeTractionLine} from '../scripts/traction-line-data.mjs';
import {buildTractionLines,validateTractionLinesSnapshot} from '../scripts/build-traction-lines.mjs';
import {powerFacilityQuery} from '../scripts/power-facility-data.mjs';
import {tractionLineLayers} from '../scripts/style/layers/traction-lines.mjs';
import {tractionLineRows,tractionLineName,POWER_FACILITY_EXPLANATION,TRACTION_LINE_NOTE} from '../styles/power-facilities.mjs';
import {featureFilter,validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {layerVisibility,annotateLayers} from '../styles/layer-semantics.mjs';
import {osmObject} from '../styles/map-model.mjs';

// A 20 m square traction substation at (9, 50) and its corner nodes 1-4.
const square=[[9,50],[9.0003,50],[9.0003,50.0002],[9,50.0002],[9,50]];
const geometry=points=>points.map(([lon,lat])=>({lon,lat}));
const traction={type:'way',id:100,nodes:[1,2,3,4,1],tags:{power:'substation',substation:'traction'},geometry:geometry(square)};
const line=(id,tags,points,nodes=points.map((_,i)=>id*10+i))=>({type:'way',id,nodes,tags,geometry:geometry(points)});
const classify=elements=>Object.fromEntries(tractionLinesGeoJSON({elements}).features.map(f=>[f.id,f.properties]));

test('the query reuses the reviewed facility selection and checks proximity once',()=>{
  const box=[50,8,51,9],query=tractionLineQuery(box);
  assert.ok(query.startsWith(powerFacilityQuery(box).slice(0,-';out body center qt;'.length)+'->.facilities;'));
  assert.equal(query.split('around.').length-1,1,'one proximity search');
  assert.ok(query.includes('way(50,8,51,9)["frequency"~"(^|;)[[:space:]]*(16\\\\.(7|67|66[67]?))[[:space:]]*(;|$)",i]->.frequencyHints;'));
  assert.ok(query.endsWith('(.lines;.facilities;);out body geom qt;'));
  for(const bad of [[0,0,0,0],[-91,0,0,1],[0,-181,1,0],[1,0,0,1],[0,0,1],'x'])assert.throws(()=>tractionLineQuery(bad),/Invalid traction-line bbox/);
});

test('lines are railway supply by recorded traction frequency or by reaching a railway facility',()=>{
  const lines=classify([traction,
    line(1,{power:'line',frequency:'16.7',voltage:'110000',operator:'Railway energy'},[[8,49],[8.1,49.1]]),
    line(2,{power:'line',frequency:'50',voltage:'110000'},[[8.99,49.99],[9.0001,50.0001]]),
    line(3,{power:'cable',frequency:'50'},[[8.99,50.0001],[9,50.0001]],[30,4]),
    line(4,{power:'line',frequency:'50;16.7'},[[7,48],[7.1,48.1]]),
    line(5,{'disused:power':'line',frequency:'16.67'},[[6,47],[6.1,47.1]]),
    line(6,{power:'minor_line',frequency:'16.666'},[[6,46],[6.1,46.1]]),
  ]);
  assert.deepEqual(Object.keys(lines).sort(),['way-1','way-2','way-3','way-4','way-5','way-6']);
  assert.equal(lines['way-1'].traction_basis,'frequency');
  assert.equal(lines['way-1'].traction_facilities,undefined);
  assert.equal(lines['way-2'].traction_basis,'facility','a vertex inside the substation area');
  assert.equal(lines['way-2'].traction_facilities,'way-100');
  assert.equal(lines['way-3'].traction_basis,'facility','a node shared with the substation outline');
  assert.equal(lines['way-3'].power_line_kind,'cable');
  assert.equal(lines['way-4'].traction_basis,'frequency','a line also carrying a traction circuit');
  assert.equal(lines['way-5'].power_state,'disused');
  assert.equal(lines['way-6'].power_line_kind,'minor_line');
  assert.equal(lines['way-1'].osm_type,'way');assert.equal(lines['way-1'].osm_id,'1');
});

test('proximity, ordinary substations, internal conductors and auxiliary supplies are not railway supply lines',()=>{
  const ordinary={...traction,id:101,tags:{power:'substation',substation:'distribution'},nodes:[5,6,7,8,5],geometry:geometry(square.map(([lon,lat])=>[lon+1,lat]))};
  const socket={type:'node',id:200,lon:9.5,lat:50,tags:{railway:'power_supply'}};
  const lines=classify([traction,ordinary,socket,
    line(10,{power:'line',frequency:'50'},[[8.99,50.0003],[9.01,50.0003]]),
    line(11,{power:'line',frequency:'50'},[[9.99,50.0001],[10,50.0001]],[110,5]),
    line(12,{power:'line',line:'busbar',frequency:'16.7'},[[9.0001,50.0001],[9.0002,50.0001]]),
    line(13,{power:'minor_line'},[[9.49,50],[9.5,50]],[130,200]),
    line(14,{power:'line',frequency:'50'},[[1,1],[1.1,1.1]]),
    line(15,{power:'line',frequency:'0;16.7x'},[[2,2],[2.1,2.1]]),
  ]);
  assert.deepEqual(lines,{},'passing 20 m away, reaching a non-railway substation or an auxiliary socket, and internal busbars do not qualify');
});

test('node-mapped facilities, multipolygon substations and traction feeding points are reached by connection',()=>{
  const node={type:'node',id:300,lon:10,lat:51,tags:{power:'substation',substation:'traction'}};
  const half=(lons,role='outer')=>({type:'way',role,geometry:geometry(lons)});
  const relation={type:'relation',id:400,tags:{type:'multipolygon',power:'substation',frequency:'16.7'},
    members:[half([[11,52],[11.001,52],[11.001,52.001]]),half([[11,52],[11,52.001],[11.001,52.001]]),half([[11.0004,52.0004],[11.0006,52.0004],[11.0006,52.0006],[11.0004,52.0004]],'inner')]};
  const feeder={type:'node',id:500,lon:12,lat:53,tags:{'railway:electricity':'power_supply'}};
  const lines=classify([node,relation,feeder,
    line(20,{power:'line',frequency:'50'},[[9.9,51],[10,51]],[201,300]),
    line(21,{power:'line',frequency:'50'},[[10,51.0001],[10.1,51.1]]),
    line(22,{power:'line',frequency:'60'},[[10.9,52.0005],[11.0005,52.0005]]),
    line(23,{power:'cable',frequency:'50'},[[11.9,53],[12,53]],[231,500]),
  ]);
  assert.equal(lines['way-20'].traction_facilities,'node-300');
  assert.equal(lines['way-21'],undefined,'near a node-mapped substation without a shared node');
  assert.equal(lines['way-22'].traction_facilities,'relation-400','joined outer ring of a multipolygon');
  assert.equal(lines['way-23'].traction_facilities,'node-500');
});

test('a line returned by two regions combines their evidence in any order',()=>{
  const points=[[8.99,49.99],[9.0001,50.0001]];
  const west=classify([line(2,{power:'line',frequency:'50;16.7'},points)])['way-2'];
  const east=classify([traction,line(2,{power:'line',frequency:'50;16.7'},points)])['way-2'];
  const other={...traction,id:99};
  const north=classify([other,line(2,{power:'line',frequency:'50;16.7'},points)])['way-2'];
  assert.equal(west.traction_basis,'frequency');assert.equal(east.traction_basis,'frequency;facility');
  const feature=properties=>({type:'Feature',id:'way-2',geometry:{type:'LineString',coordinates:points},properties});
  const a=mergeTractionLine(feature(west),feature(east)),b=mergeTractionLine(feature(east),feature(west));
  assert.deepEqual(a,b);assert.equal(a.properties.traction_basis,'frequency;facility');assert.equal(a.properties.traction_facilities,'way-100');
  assert.equal(mergeTractionLine(feature(east),feature(north)).properties.traction_facilities,'way-100;way-99');
  assert.equal(mergeTractionLine(feature(west),feature(west)).properties.traction_facilities,undefined);
});

test('incomplete responses and geometry are rejected rather than published',()=>{
  assert.throws(()=>tractionLinesGeoJSON({remark:'runtime error: Query timed out',elements:[]}),/timed out/);
  assert.throws(()=>tractionLinesGeoJSON({}),/Incomplete traction-line response/);
  assert.throws(()=>tractionLinesGeoJSON({elements:[{...line(9,{power:'line',frequency:'16.7'},[[1,1],[2,2]]),geometry:[{lon:1}]}]}),/Incomplete geometry for traction line way-9/);
});

test('layers draw present and former lines and cables only in Power view',()=>{
  const layers=annotateLayers(tractionLineLayers());
  assert.deepEqual(layers.map(l=>l.id),['electrification-traction-lines','electrification-traction-cables','electrification-former-traction-lines','electrification-former-traction-cables']);
  const settings={mode:'electrification',labels:true,inactive:true,background:'map'};
  for(const l of layers) {
    assert.equal(l.source,'electricLines');assert.equal(l.minzoom,10);
    assert.equal(layerVisibility(l,settings),true,l.id);
    assert.equal(layerVisibility(l,{...settings,mode:'control'}),false,l.id);
    assert.equal(layerVisibility(l,{...settings,inactive:false}),!l.id.includes('former-'),l.id);
  }
  const filter=id=>featureFilter(layers.find(l=>l.id===id).filter).filter;
  const at=(kind,state)=>({type:2,properties:{power_line_kind:kind,power_state:state}});
  assert.equal(filter('electrification-traction-lines')({zoom:12},at('line','present')),true);
  assert.equal(filter('electrification-traction-lines')({zoom:12},at('cable','present')),false);
  assert.equal(filter('electrification-traction-cables')({zoom:12},at('cable','present')),true);
  assert.equal(filter('electrification-former-traction-lines')({zoom:12},at('minor_line','disused')),true);
  assert.equal(filter('electrification-former-traction-lines')({zoom:12},at('line','present')),false);
  assert.deepEqual(validateStyleMin({version:8,sources:{electricLines:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},layers}),[]);
  assert.deepEqual(osmObject({source:'electricLines',properties:{osm_type:'way',osm_id:'77'}}),{type:'way',id:'77'});
});

test('details state the selection basis and the help explains it',()=>{
  assert.deepEqual(tractionLineRows({power_line_kind:'cable',power_state:'present',traction_basis:'frequency;facility',voltage:'110000',frequency:'16.7',operator:'Railway energy'}),[
    ['Type','Railway traction power cable'],['Status','present'],
    ['Railway supply basis','Recorded traction frequency; Reaches a mapped railway electricity facility'],
    ['Operator','Railway energy'],['Voltage','110000'],['Frequency','16.7 Hz']]);
  assert.equal(tractionLineName({power_line_kind:'minor_line'}),'Railway traction power line (minor)');
  assert.ok(POWER_FACILITY_EXPLANATION.includes(TRACTION_LINE_NOTE));
  assert.match(TRACTION_LINE_NOTE,/merely passing near one is not included/);
});

test('the staged builder publishes a complete, validated world snapshot',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'atlas-traction-lines-'));
  try {
    const element=line(1,{power:'line',frequency:'16.7'},[[9,50],[9.01,50.01]]);
    const options={cache:join(dir,'cache'),output:join(dir,'out'),sleep:async()=>{},log:()=>{}};
    let calls=0;
    const {manifest}=await buildTractionLines({...options,fetcher:async()=>{calls++;return new Response(JSON.stringify({osm3s:{timestamp_osm_base:'2026-10-26T00:00:00Z'},elements:[element]}));}});
    assert.equal(calls,8,'one request per world region');
    const data=JSON.parse(await readFile(join(options.output,'traction-lines.geojson'),'utf8'));
    assert.equal(data.features.length,1);assert.equal(manifest.features,1);
    validateTractionLinesSnapshot(data,manifest);
    assert.throws(()=>validateTractionLinesSnapshot(data,{...manifest,sha256:'bad'}),/Traction-line snapshot digest mismatch/);
    assert.throws(()=>validateTractionLinesSnapshot(data,{...manifest,coverage:manifest.coverage.slice(1)}),/Incomplete worldwide traction-line coverage/);
    // Two regions return the same line; one also returns the facility it reaches.
    const crossing=line(2,{power:'line',frequency:'50;16.7'},[[8.99,49.99],[9.0001,50.0001]]);
    const merged=await buildTractionLines({...options,refresh:true,fetcher:async(url,init)=>{
      const region=init.body.get('data').match(/\(([-\d.]+,[-\d.]+,[-\d.]+,[-\d.]+)\)/)[1];
      const elements=region==='0,-90,90,0'?[crossing,traction]:region==='0,0,90,90'?[crossing]:[];
      return new Response(JSON.stringify({osm3s:{},elements}));
    }});
    assert.equal(merged.data.features.length,1);
    assert.equal(merged.data.features[0].properties.traction_basis,'frequency;facility');
    assert.equal(merged.data.features[0].properties.traction_facilities,'way-100');
    await rm(options.output,{recursive:true});
    await assert.rejects(buildTractionLines({...options,refresh:true,fetcher:async()=>new Response(JSON.stringify({osm3s:{},elements:[]}))}),/Refusing to publish empty worldwide traction power line data/);
    await writeFile(join(dir,'marker'),'');
  } finally {await rm(dir,{recursive:true,force:true});}
});
