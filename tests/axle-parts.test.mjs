import test from 'node:test';
import assert from 'node:assert/strict';
import {createAxlePartCache} from '../scripts/axle-load-parts.mjs';
const complete='way\t123\t\t22.5\t\tD4\ncount\t0\t1\t\t\t\n';
test('an incomplete axle part is never cached; a validated part survives a later failed query and is reused',async()=>{
 let requests=0,saved;const parts={},query=async q=>{requests++;return q==='capacity'?complete:complete.split('count')[0];};
 const load=createAxlePartCache({parts,query,save:async p=>{saved=structuredClone(p);},now:()=>1000});
 const a=await load('capacity','capacity');assert.equal(a.rows.length,1);await assert.rejects(load('class','class'),/Incomplete/);assert.deepEqual(Object.keys(saved),['capacity']);
 const retry=createAxlePartCache({parts:saved,query,save:async()=>{},now:()=>2000});const b=await retry('capacity','capacity');assert.equal(requests,2);assert.equal(b.downloaded,0);assert.deepEqual(b.rows,a.rows);
});
test('expired axle parts refresh while fresh parts make no service request',async()=>{
 let requests=0;const updated=new Date(1000).toISOString(),parts={capacity:{updated,rows:[[1,'20','','']]}};
 const load=createAxlePartCache({parts,query:async()=>{requests++;return complete;},save:async()=>{},now:()=>3000,age:1000});
 const value=await load('capacity','capacity');assert.equal(requests,1);assert.equal(value.rows[0][0],123);assert.equal(value.updated,new Date(3000).toISOString());
});
