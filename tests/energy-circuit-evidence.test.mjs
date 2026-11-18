import test from 'node:test';
import assert from 'node:assert/strict';
import {electricalPairs,matchingElectricalPairs,tractionCircuitEvidence} from '../scripts/energy-circuit-evidence.mjs';
const line=(id,nodes,tags={})=>({type:'way',id,nodes,tags:{power:'line',voltage:'15000',frequency:'16.7',...tags}});
test('electrical matching preserves voltage/frequency pairing and requires both fields',()=>{
 assert.deepEqual(electricalPairs({voltage:'15000;25000',frequency:'16.7;50'}),['15000/16.7','25000/50']);
 assert.deepEqual(matchingElectricalPairs({voltage:'15000;25000',frequency:'16.7;50'},{voltage:'25000;15000',frequency:'16.7;50'}),[]);
 assert.deepEqual(electricalPairs({voltage:'15000;25000',frequency:'50'}),['15000/50','25000/50']);
 assert.deepEqual(electricalPairs({voltage:'15000'}),[]);
 for(const voltage of ['15000;;25000',';15000;25000','15000;25000;'])assert.deepEqual(electricalPairs({voltage,frequency:'16.7;50'}),[]);
 assert.deepEqual(electricalPairs({voltage:'15000;25000',frequency:'16.7;;50'}),[]);
 assert.deepEqual(electricalPairs({voltage:'1;2',frequency:'1;2;3'}),[]);
});
test('traction connectivity requires explicit seed and matching electrical pair through endpoints',()=>{
 const facility={type:'node',id:1,tags:{power:'substation',usage:'traction',voltage:'15000',frequency:'16.7'}};
 const features=[facility,line(1,[1,2,3]),line(2,[3,4]),line(3,[4,5],{frequency:'50'}),line(4,[6,2,7]),line(5,[4,8],{frequency:undefined})];
 const found=tractionCircuitEvidence(features);
 assert.deepEqual([...found.keys()],['way-1','way-2']);
 assert.equal(tractionCircuitEvidence([{...facility,tags:{...facility.tags,voltage:'25000'}},...features.slice(1)]).size,0);
 assert.equal(tractionCircuitEvidence(features.slice(1)).size,0);
 assert.equal(tractionCircuitEvidence([{...facility,tags:{...facility.tags,usage:undefined,substation:'traction'}},line(1,[1,2])]).size,1);
});
test('inactive facilities and shared interior tower nodes do not seed present circuits',()=>{
 const seed=line(1,[1,2,3],{usage:'traction'}),parallel=line(2,[4,2,5]);
 assert.deepEqual([...tractionCircuitEvidence([seed,parallel]).keys()],['way-1']);
 assert.equal(tractionCircuitEvidence([{type:'node',id:1,tags:{power:'substation',usage:'traction',voltage:'15000',frequency:'16.7',disused:'yes'}},line(2,[1,2])]).size,0);
});
