import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync,gunzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {mainlineChains} from '../scripts/mainline-chains.mjs';
import {mainlineRegion,mainlineTiles,MAINLINE_LAYER} from '../scripts/mainline-overview.mjs';
import {sha256,MAINLINE_REGIONS,MAINLINE_CONTROLS,validateMainlineSources,segmentInBox,auditMainlineCoverage} from '../scripts/mainline-coverage.mjs';
import {referenceTileKey,createReferenceReader,decompressReference} from '../styles/mainline-reference.mjs';
import {layerVisibility} from '../styles/layer-semantics.mjs';
import {referenceInputDigest,matchingReferenceInputs} from '../scripts/mainline-provenance.mjs';
import {retainMainlineGeneration} from '../scripts/retain-mainline-generation.mjs';
const way=(id,a,b,nodes,tags={railway:'rail',usage:'main'})=>({type:'way',id,version:2,nodes,tags,
 geometry:[a,b].map(([lon,lat])=>({lon,lat}))});
const source=r=>mainlineRegion({elements:r});
const sources=()=>MAINLINE_REGIONS.map(region=>({schema:1,complete:true,region,date:'2026-10-09',license:'ODbL-1.0',
 url:`https://download.geofabrik.de/${region}-261009.osm.pbf`,sourceTimestamp:'2026-10-09T20:00:00Z',
 pbfBytes:100,pbfSha256:'a'.repeat(64),exportBytes:100,exportSha256:'b'.repeat(64)}));
test('cached extracts reject changed dated PBF sizes and same-size checksum replacements',()=>{
 const result=spawnSync('python',['-c',`
import importlib.util, tempfile, json, hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('plan','scripts/plan-mainline-acquisition.py')
plan=importlib.util.module_from_spec(spec);spec.loader.exec_module(plan)
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);body=b'verified railway export';(root/'ways.geojsonseq.gz').write_bytes(body)
 source=dict(complete=True,region='asia',date='2026-10-09',pbfBytes=100,sourceMd5='a'*32,
  exportBytes=len(body),exportSha256=hashlib.sha256(body).hexdigest())
 (root/'source.json').write_text(json.dumps(source))
 assert plan.validate_checkpoint(root,'asia','2026-10-09',100,'a'*32)
 assert not plan.validate_checkpoint(root,'asia','2026-10-09',101,'a'*32)
 assert not plan.validate_checkpoint(root,'asia','2026-10-09',100,'b'*32)
 assert not plan.validate_checkpoint(root,'asia','2026-10-08',100,'a'*32)
 (root/'ways.geojsonseq.gz').write_bytes(b'corrupt railway export')
 assert not plan.validate_checkpoint(root,'asia','2026-10-09',100,'a'*32)
 (root/'source.json').write_text('{broken')
 assert not plan.validate_checkpoint(root,'asia','2026-10-09',100,'a'*32)
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
test('continent validation never certifies a missing, duplicated, changed-age or unpermitted source',()=>{
 const good=sources();assert.equal(validateMainlineSources(good),true);
 assert.throws(()=>validateMainlineSources(good.slice(1)),/Missing/);
 for(const patch of [{region:'africa'},{complete:false},{date:'2026-10-08'},
  {sourceTimestamp:'2026-10-07T00:00:00Z'},{url:'https://openrailwaymap.app/tiles'},
  {pbfBytes:49*1024**3},{exportSha256:'broken'}]){
  const changed=structuredClone(good);Object.assign(changed[1],patch);assert.throws(()=>validateMainlineSources(changed));
 }
 assert.throws(()=>auditMainlineCoverage([]),/Missing actual OSM/);
});
test('joins use actual OSM topology and preserve every way/version, including reversal and cycles',()=>{
 const rows=source([way(1,[0,0],[1,0],[10,11]),way(2,[2,0],[1,0],[12,11]),way(3,[2,0],[3,0],[12,13])]);
 const result=mainlineChains(rows);assert.equal(result.features.length,1);
 assert.deepEqual(result.features[0].geometry.coordinates,[[0,0],[1,0],[2,0],[3,0]]);
 assert.deepEqual(result.features[0].bbox,[0,0,3,0]);
 assert.deepEqual(result.membership[0].ways.map(w=>[w.id,w.version]),[['way-1',2],['way-2',2],['way-3',2]]);
 assert.deepEqual(mainlineChains([...rows].reverse()),result,'input order cannot change published IDs');
 const cycles=mainlineChains(source([way(1,[0,0],[1,0],[10,11]),way(2,[1,0],[0,0],[11,10])]));
 assert.equal(cycles.membership[0].ways.length,2);
 const separate=mainlineChains(source([way(1,[0,0],[1,0],[10,11]),way(2,[1,0],[2,0],[99,12])]));
 assert.equal(separate.features.length,2,'coincident points do not establish OSM node identity');
 const fork=mainlineChains(source([way(1,[0,0],[1,0],[10,11]),way(2,[1,0],[2,0],[11,12]),way(3,[1,0],[1,1],[11,13])]));
 assert.equal(fork.features.length,3,'do not guess a route through a junction');
 const different=mainlineChains(source([way(1,[0,0],[1,0],[10,11]),way(2,[1,0],[2,0],[11,12],{railway:'rail'})]));
 assert.equal(different.features.length,2,'unknown usage stays distinct from mapped mainline');
});
test('deployment rejects stale build inputs and refresh retains the previous immutable tile URL',async()=>{
 const digest=await referenceInputDigest();assert.match(digest,/^[a-f0-9]{64}$/);
 assert.equal(matchingReferenceInputs({complete:true,inputSha256:digest},digest),true);
 assert.equal(matchingReferenceInputs({complete:true,inputSha256:'b'.repeat(64)},digest),false);
 assert.equal(matchingReferenceInputs({complete:false,inputSha256:digest},digest),false);
 const dir=await mkdtemp(join(tmpdir(),'mainline-refresh-'));
 try{
  const previous=join(dir,'previous'),current=join(dir,'current'),generation='a'.repeat(24);
  const old=join(previous,'generations',generation,'0','0');await mkdir(old,{recursive:true});await mkdir(current);
  await writeFile(join(previous,'manifest.json'),JSON.stringify({complete:true,generation}));
  await writeFile(join(current,'manifest.json'),JSON.stringify({complete:true,generation:'b'.repeat(24)}));
  await writeFile(join(old,'0.pbf.gz'),'immutable tile bytes');
  await writeFile(join(previous,'generations',generation,'ways.ndjson.gz.part-0000'),'archive');
  await retainMainlineGeneration(previous,current);
  assert.equal(await readFile(join(current,'generations',generation,'0','0','0.pbf.gz'),'utf8'),'immutable tile bytes');
  await assert.rejects(readFile(join(current,'generations',generation,'ways.ndjson.gz.part-0000')),/ENOENT/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('real Tokyo light rail is not falsely promoted into the mainline reference',async()=>{
 const raw=JSON.parse(await readFile('tests/fixtures/service-geometry/overpass-meta-way-4853887.json'));
 assert.equal(raw.elements[0].id,4853887);assert.equal(raw.elements[0].version,38);
 assert.equal(raw.elements[0].tags.railway,'light_rail');assert.deepEqual(mainlineRegion(raw),[]);
});
test('clipping tests exact segments and buffered tile boundaries independently of whole-way bounds',()=>{
 assert.equal(segmentInBox([-2,2],[2,2],[-1,-1,1,1]),false);
 assert.equal(segmentInBox([-2,0],[2,0],[-1,-1,1,1]),true);
 const data=mainlineTiles(source([way(100,[-.5,1],[.5,1],[10,11])]));
 const ids=k=>{const layer=new VectorTile(new Pbf(gunzipSync(data.tiles.get(k)))).layers[MAINLINE_LAYER];
   return Array.from({length:layer.length},(_,i)=>layer.feature(i).properties.id)};
 assert.ok(ids('6/31/31').includes('way-100'));assert.ok(ids('6/32/31').includes('way-100'));
});
test('missing source geometry is identified separately for every geographically diverse control',()=>{
 const features=source(MAINLINE_CONTROLS.map((c,i)=>way(1000+i,
  [c.center[0]-.1,c.center[1]],[c.center[0]+.1,c.center[1]],[2000+i*2,2001+i*2])));
 assert.equal(auditMainlineCoverage(features).length,MAINLINE_CONTROLS.length);
 for(let i=0;i<features.length;i++)assert.throws(()=>auditMainlineCoverage(features.filter((_,n)=>n!==i)),
  error=>error.message.includes(MAINLINE_CONTROLS[i].name),MAINLINE_CONTROLS[i].name);
});
test('OSM identities survive adjacent tile boundaries near all global acceptance regions',()=>{
 const controls=MAINLINE_CONTROLS.map((c,i)=>{
  const x=Math.floor((c.center[0]+180)/360*64),edge=(x+1)/64*360-180;
  const lat=c.center[1]*Math.PI/180,y=Math.floor((1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*64);
  return {...c,x,y,id:3000+i,points:[[edge-.2,c.center[1]],[edge+.2,c.center[1]]]};
 });
 const data=mainlineTiles(source(controls.map(c=>way(c.id,...c.points,[c.id*2,c.id*2+1]))));
 for(const c of controls)for(const x of [c.x,c.x+1]){
  const key=`6/${x}/${c.y}`,layer=new VectorTile(new Pbf(gunzipSync(data.tiles.get(key)))).layers[MAINLINE_LAYER];
  assert.ok(Array.from({length:layer.length},(_,i)=>layer.feature(i).properties.id).includes(`way-${c.id}`),`${c.name} ${key}`);
 }
});
function fixture(){
 const generation='a'.repeat(24),tile=gzipSync(Buffer.from([26,0]));
 const index=JSON.stringify({schema:1,complete:true,generation,tiles:[{key:'0/0/0',bytes:tile.length,sha256:sha256(tile)}]});
 const manifest={schema:1,complete:true,generation,minzoom:0,maxzoom:6,wayCount:1,license:'ODbL-1.0',
  oldestSource:'2026-10-09T20:00:00Z',newestSource:'2026-10-09T20:00:00Z',sources:sources(),indexSha256:sha256(index)};
 const paths=new Map([['manifest.json',JSON.stringify(manifest)],[`generations/${generation}/index.json`,index],
  [`generations/${generation}/0/0/0.pbf.gz`,tile]]),requests=[];
 const fetcher=async url=>{const key=new URL(url).pathname.slice(1);requests.push(key);
  return paths.has(key)?new Response(paths.get(key)):new Response('',{status:404})};
 return {paths,requests,fetcher,generation};
}
test('complete-index empty tiles differ from upstream failures and corrupt payloads; requests are shared',async()=>{
 const f=fixture(),reader=createReferenceReader({root:'https://atlas.invalid/',fetcher:f.fetcher});
 const [a,b]=await Promise.all([reader.tile('0/0/0'),reader.tile('0/0/0')]);
 assert.deepEqual(new Uint8Array(a),new Uint8Array([26,0]));assert.notEqual(a,b);
 await reader.tile('0/0/0');assert.equal(f.requests.length,3,'metadata, index and one tile only');
 assert.equal(reader.statistics().assetRequests,3);assert.equal(reader.statistics().decodedTileBytes,2);
 assert.equal(reader.statistics().cachedTileBytes,2);assert.ok(reader.statistics().assetBytes>0);
 assert.equal((await reader.tile('6/31/30')).byteLength,0);
 assert.equal(f.requests.length,3,'known empty tile does not make any request');
 for(const state of ['missing','corrupt']){
  const broken=fixture(),path=`generations/${broken.generation}/0/0/0.pbf.gz`;
  if(state==='missing')broken.paths.delete(path);else broken.paths.set(path,Buffer.from('corrupt'));
  await assert.rejects(createReferenceReader({root:'https://atlas.invalid/',fetcher:broken.fetcher}).tile('0/0/0'),/unavailable|truncated/);
 }
 const missing=fixture();missing.paths.delete('manifest.json');
 await assert.rejects(createReferenceReader({root:'https://atlas.invalid/',fetcher:missing.fetcher}).tile('0/0/0'),/unavailable/);
 await assert.rejects(decompressReference(gzipSync(Buffer.alloc(10000)),100),/Oversized/);
 for(const key of ['-1/0/0','6/64/0','0/0/1','0/00/0','1/0/0?x=1','../../data'])assert.equal(referenceTileKey(key),null);
});
test('reference layers stay beneath each theme and through z6–7 without borrowing thematic fields',async()=>{
 const style=JSON.parse(await readFile('styles/world.style.json'));
 const layers=style.layers.filter(l=>l.source==='railReference');assert.equal(layers.length,3);
 assert.equal(style.sources.railReference.maxzoom,6);
 for(const layer of layers){
  assert.equal(layer.maxzoom,8);assert.ok(!layer.paint['line-color'].includes('maxspeed'));
  for(const mode of ['infrastructure','speed','electrification','control','gauge','loading','axle','owner','service']){
   assert.equal(layerVisibility(layer,{mode,background:'flat'}),true);
   assert.ok(style.layers.indexOf(layer)<style.layers.findIndex(l=>l.id===`${mode}-overview`));
  }
 }
 assert.equal(layers.find(l=>l.id==='rail-reference-main').minzoom,undefined,'negative zoom must not gate major corridors');
});
