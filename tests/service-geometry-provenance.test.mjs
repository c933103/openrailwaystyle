// Regression contracts for source-aware reconciliation beyond PR #142.
import test from 'node:test';
import assert from 'node:assert/strict';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {toTable, addResult, commitStage, discardStage, readTable, writeTable, buildTiles, geometrySummary, LAYER} from '../scripts/service-routes.mjs';
const p = [[139.70,35.68],[139.71,35.69],[139.72,35.68],[139.73,35.69],[139.74,35.68]];
const oldBase = '2026-10-06T00:00:00Z', newBase = '2026-10-07T00:00:00Z';
const rel = id => ({type:'relation',id,version:1,timestamp:'2026-10-01T00:00:00Z',tags:{type:'route',route:'subway',ref:String(id),name:`Line ${id}`,network:'N'},members:[{type:'way',ref:101,role:''}]});
const observation = ({coords=p,nodes=[1,2,3,4,5],version=4,base=oldBase}={}) => toTable({osm3s:{timestamp_osm_base:base},elements:[rel(1),rel(2),{type:'way',id:101,version,timestamp:version===4?'2026-10-01T00:00:00Z':'2026-10-06T12:00:00Z',nodes,geometry:coords.map(v=>v&&{lon:v[0],lat:v[1]})}]});
const full = observation(), fragmented = observation({coords:[p[0],p[1],null,p[3],p[4]]});
const short = observation({coords:p.slice(0,2),nodes:[1,2],version:5,base:newBase});
const moved = observation({coords:p.map(([x,y])=>[x,y+0.02]),base:newBase});
const newerFragment = observation({coords:[p[0],p[1],null,p[3],p[4]],base:newBase});
const empty = () => ({routes:new Map(),ways:new Map()});
const restore = t => readTable(writeTable(t));
function tableOf(results, stage='A') { const t=empty(); for(const r of results) addResult(t,r,stage); commitStage(t,stage); return restore(t); }
function visible(t) { const out=[]; for(const [key,bytes] of buildTiles(t)) { if(!key.startsWith('12/')) continue; const [z,x,y]=key.split('/').map(Number), layer=new VectorTile(new Pbf(bytes)).layers[LAYER]; for(let i=0;i<layer.length;i++) { const f=layer.feature(i); out.push({key,id:f.properties.id,n:f.properties.n,coordinates:f.toGeoJSON(x,y,z).geometry.coordinates}); } } return out.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))); }
const expectedFull = visible(tableOf([full])), expectedShort=visible(tableOf([short])), expectedMoved=visible(tableOf([moved])), expectedFragment=visible(tableOf([newerFragment]));
test('same snapshot complete evidence survives a compatible fragmented repeat in both orders',()=>{for(const order of [[full,fragmented],[fragmented,full]])assert.deepEqual(visible(tableOf(order)),expectedFull);});
test('older complete topology cannot resurrect track removed by a newer complete version',()=>{for(const order of [[full,short],[short,full]])assert.deepEqual(visible(tableOf(order)),expectedShort);});
test('node-only movements are selected by source snapshot even when the way version is unchanged',()=>{for(const order of [[full,moved],[moved,full]])assert.deepEqual(visible(tableOf(order)),expectedMoved);});
test('a newer incomplete snapshot never silently borrows coordinates from an older snapshot',()=>{for(const order of [[full,newerFragment],[newerFragment,full]])assert.deepEqual(visible(tableOf(order)),expectedFragment);});
test('fresh pending geometry selection is independent of stage insertion order',()=>{for(const order of [[['A',full],['B',short]],[['B',short],['A',full]]]){const t=empty();for(const [stage,r]of order)addResult(t,r,stage);assert.deepEqual(visible(restore(t)),expectedShort);}});
test('committed source selection is independent of stage completion order',()=>{for(const order of [['A','B'],['B','A']]){const t=empty();addResult(t,full,'A');addResult(t,short,'B');for(const stage of order)commitStage(t,stage);assert.deepEqual(visible(restore(t)),expectedShort);}});
test('a fragmented way is diagnosed as partial geometry even when both services remain drawable',()=>{const t=tableOf([fragmented]);assert.deepEqual(geometrySummary(t).routeRelationsWithPartialGeometry,[1,2]);});
test('round trips preserve raw topology, source time and way revision evidence',()=>{const json=writeTable(tableOf([full]));assert.ok(json.includes(oldBase),'OSM source snapshot must survive');assert.ok(json.includes('2026-10-01T00:00:00Z'),'way timestamp must survive');assert.ok(json.includes('[1,2,3,4,5]'),'raw node sequence must survive before simplification');});
test('positive control: valid shared services remain drawn and fragment gaps are not bridged',()=>{assert.ok(expectedFull.length>0);assert.deepEqual([...new Set(expectedFragment.map(f=>`${f.id},n=${f.n}`))].sort(),['relation-1,n=2','relation-2,n=2']);assert.notDeepEqual(expectedFull,expectedFragment);});
test('positive control: discarding a pending newer stage leaves accepted committed geometry intact',()=>{const t=tableOf([full]);addResult(t,short,'B');discardStage(t,'B');assert.deepEqual(visible(restore(t)),expectedFull);});

for(const action of ['commit','discard'])test(`pending-only complete geometry stays diagnosed through resume until ${action}`,()=>{
  let table=empty();addResult(table,full,'A');
  const bytes=writeTable(table),tiles=[...buildTiles(table)],decoded=visible(table);
  assert.deepEqual(decoded,expectedFull,'pending fallback remains drawable');
  for(const current of [table,restore(table)]){
    const summary=geometrySummary(current);
    assert.deepEqual(summary.waysWithPendingEvidence,[101]);
    assert.equal(summary.details[0].way,101);
    assert.equal(summary.details[0].pending.status,'complete');
    assert.equal(summary.details[0].pending.snapshot,current.ways.get(101).nextGeometry.A.snapshot);
    assert.deepEqual([...buildTiles(current)],tiles,'diagnostics and NDJSON resume leave encoded tiles unchanged');
    assert.deepEqual(visible(current),decoded);
    assert.equal(writeTable(current),bytes,'diagnostics do not promote or mutate source evidence');
  }
  table=restore(table);
  if(action==='commit'){
    commitStage(table,'A');assert.deepEqual(visible(table),decoded);
    assert.deepEqual([...buildTiles(table)],tiles);
    assert.equal(table.ways.get(101).geometry.snapshot,oldBase);
  }else{discardStage(table,'A');assert.equal(table.ways.size,0);assert.deepEqual(visible(table),[]);}
  assert.deepEqual(geometrySummary(restore(table)).waysWithPendingEvidence,[]);
});
for(const action of ['commit','discard'])test(`identical accepted and pending geometry remains pending until ${action}`,()=>{
  let table=tableOf([full]);const tiles=[...buildTiles(table)],accepted=structuredClone(table.ways.get(101).geometry);
  addResult(table,full,'B');table=restore(table);
  assert.deepEqual(table.ways.get(101).nextGeometry.B,accepted,'the pending geometry can be byte-identical to accepted evidence');
  assert.deepEqual(geometrySummary(table).waysWithPendingEvidence,[101]);
  assert.equal(geometrySummary(table).details[0].pending.status,'complete');
  assert.deepEqual([...buildTiles(table)],tiles);assert.deepEqual(visible(table),expectedFull);
  (action==='commit'?commitStage:discardStage)(table,'B');
  assert.deepEqual(geometrySummary(restore(table)).waysWithPendingEvidence,[]);
  assert.deepEqual(table.ways.get(101).geometry,accepted);assert.deepEqual([...buildTiles(table)],tiles);
});
