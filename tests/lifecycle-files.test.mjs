import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {gunzipSync, gzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import vtpbf from 'vt-pbf';
import {writeLifecycleSnapshot} from '../scripts/lifecycle-files.mjs';

test('the lifecycle snapshot emits MVT v2 and retains line data', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-lifecycle-mvt-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const data = {type:'FeatureCollection', features:[{
    type:'Feature', id:123,
    properties:{name:'Lifecycle fixture', state:'construction'},
    geometry:{type:'LineString', coordinates:[[100, 10], [100.15, 10.2]]},
  }]};
  const written = await writeLifecycleSnapshot(dir, data, {});
  assert.ok(written > 0);
  const rows = (await readFile(join(dir,'tiles.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(rows.length, written);
  for (const [, , , encoded] of rows) {
    const tile = new VectorTile(new Pbf(gunzipSync(Buffer.from(encoded,'base64'))));
    const layer = tile.layers.lifecycle;
    assert.equal(layer.version, 2);
    assert.equal(layer.extent, 4096);
    assert.ok(layer.length > 0);
    const feature = layer.feature(0);
    assert.equal(feature.type, 2);
    assert.equal(feature.properties.name, 'Lifecycle fixture');
    assert.equal(feature.properties.state, 'construction');
    assert.ok(feature.loadGeometry()[0].length >= 2);
  }
});

test('site overview writes MVT v2 from real z5 snapshot tiles and keeps regional tiles', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-lifecycle-overview-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const features=[
    {type:'Feature', properties:{name:'Long construction fixture', state:'construction'},
      geometry:{type:'LineString', coordinates:[[100, 10], [102, 12]]}},
    {type:'Feature', properties:{name:'Planned fixture', state:'proposed'},
      geometry:{type:'LineString', coordinates:[[99, 11], [101, 13]]}},
  ];
  await writeLifecycleSnapshot(dir, {type:'FeatureCollection',features}, {});
  const rows = (await readFile(join(dir,'tiles.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const regional = new Map();
  for (const [z,x,y,encoded] of rows.filter(row=>row[0]===5)) {
    const key=`${z}/${x}/${y}`;
    const filename=join(dir,`${key}.pbf.gz`);
    const bytes=Buffer.from(encoded,'base64');
    await mkdir(dirname(filename),{recursive:true});
    await writeFile(filename,bytes);
    regional.set(key,bytes);
  }
  assert.ok(regional.size);
  await writeFile(join(dir,'index.json'),JSON.stringify({fixtureMarker:'keep',tiles:[...regional.keys()]}));
  const cli=fileURLToPath(new URL('../scripts/build-overview-tiles.mjs',import.meta.url));
  execFileSync(process.execPath,[cli,dir],{stdio:'pipe'});
  const {tiles,fixtureMarker}=JSON.parse(await readFile(join(dir,'index.json'),'utf8'));
  assert.equal(fixtureMarker,'keep');
  const overview=tiles.filter(key=>Number(key.split('/')[0])<5);
  assert.deepEqual([...new Set(overview.map(key=>Number(key.split('/')[0])))].sort(),[0,1,2,3,4]);
  assert.deepEqual(tiles.filter(key=>Number(key.split('/')[0])>=5),[...regional.keys()]);
  for (const key of overview) {
    const bytes=await readFile(join(dir,`${key}.pbf.gz`));
    const layer=new VectorTile(new Pbf(gunzipSync(bytes))).layers.lifecycle;
    assert.equal(layer.version,2);
    assert.equal(layer.extent,4096);
    assert.ok(layer.length);
    for(let i=0;i<layer.length;i++){
      const feature=layer.feature(i);
      assert.equal(feature.type,2);
      assert.equal(feature.properties.name,'Long construction fixture');
      assert.equal(feature.properties.state,'construction');
      assert.ok(feature.loadGeometry()[0].length>=2);
    }
  }
  for (const [key,bytes] of regional)
    assert.deepEqual(await readFile(join(dir,`${key}.pbf.gz`)),bytes);
});

const strictMvt = fileURLToPath(new URL('../scripts',import.meta.url));
function strictV2(bytes){
  execFileSync('python',['-c',
    'import sys; sys.path.insert(0, sys.argv[1]); from lifecycle_mvt import normalize; raw=sys.stdin.buffer.read(); assert normalize(raw)==(raw,(0,0,0,0,0))',
    strictMvt],{input:bytes,stdio:['pipe','pipe','pipe']});
}
const namedConstruction = (name, geometry) => ({type:'Feature', id:123,
  properties:{name,state:'construction', osm_id:123},geometry});
function tileFeatures(bytes){
  const layer = new VectorTile(new Pbf(gunzipSync(bytes))).layers.lifecycle;
  return [...Array(layer.length)].map((_, i)=>layer.feature(i));
}

test('regional writer removes collapsed parts and duplicate adjacent quantized vertices', async t=>{
  const dir = await mkdtemp(join(tmpdir(), 'atlas-regional-collapse-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const tiny=[[0.1,0.1],[0.100001,0.1]], kept=[...tiny,[0.11,0.1]];
  const features = [
    namedConstruction('retained',{type:'MultiLineString', coordinates:[tiny,kept]}),
    namedConstruction('collapsed',{type:'LineString', coordinates:tiny}),
    namedConstruction('primer',{type:'LineString',coordinates:[[-5,0.2],[5,0.2]]}),
  ];
  await writeLifecycleSnapshot(dir,{type:'FeatureCollection',features},{fixture:'keep'});
  const rows=(await readFile(join(dir,'tiles.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const bytes=Buffer.from(rows.find(([z,x,y])=>z===10 && x===512 && y===511)[3],'base64');
  strictV2(bytes);
  const [feature,...rest]=tileFeatures(bytes).filter(f=>f.properties.name!=='primer');
  assert.equal(rest.length,0);
  assert.deepEqual(feature.properties,{name:'retained',state:'construction',osm_id:123});
  assert.equal(feature.id,123);
  assert.deepEqual(feature.loadGeometry().map(path=>path.map(({x,y})=>[x,y])),[[[1165,2931],[1282,2931]]]);
  assert.equal(JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')).fixture,'keep');
});

test('overview writer removes new collapses when valid z5 paths are requantized', async t=>{
  const dir=await mkdtemp(join(tmpdir(),'atlas-overview-collapse-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const key='5/16/15', target=join(dir,key+'.pbf.gz');
  const tiny=[[33,3000],[34,3000]], kept=[...tiny,[44,3000]];
  const properties=name=>({name,state:'construction',osm_id:123});
  const bytes=gzipSync(vtpbf.fromGeojsonVt({lifecycle:{features:[
    {type:2,id:123,tags:properties('retained'),geometry:[tiny,kept]},
    {type:2,id:124,tags:properties('collapsed'),geometry:[tiny]},
  ]}},{version:2,extent:4096}));
  strictV2(bytes);
  await mkdir(dirname(target),{recursive:true});
  await writeFile(target,bytes);
  await writeFile(join(dir,'index.json'),JSON.stringify({fixture:'keep',tiles:[key]}));
  execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/build-overview-tiles.mjs',import.meta.url)),dir]);
  const result=await readFile(join(dir,'4/8/7.pbf.gz'));
  strictV2(result);
  const [feature,...rest]=tileFeatures(result);
  assert.equal(rest.length,0);
  assert.deepEqual(feature.properties,properties('retained'));
  assert.equal(feature.id,123);
  assert.deepEqual(feature.loadGeometry().map(path=>path.map(({x,y})=>[x,y])),[[[17,3548],[22,3548]]]);
  assert.deepEqual(await readFile(target),bytes);
  assert.equal(JSON.parse(await readFile(join(dir,'index.json'),'utf8')).fixture,'keep');
});
