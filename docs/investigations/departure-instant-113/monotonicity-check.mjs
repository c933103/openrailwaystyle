import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
// Run from the repository root. Optional argument selects a rejected source snapshot.
const fixture=JSON.parse(gunzipSync(readFileSync('tests/fixtures/departure-instant-predecessor.json.gz')));
assert.equal(fixture.commit,'f9bd326c6a2a3738daafd36a58a16f9a2251c5a8');
const baselineSource=fixture.files['departures.mjs'].text;
assert.equal(createHash('sha256').update(baselineSource).digest('hex'),fixture.files['departures.mjs'].sha256);
async function instrument(code) {
 const hashes={sourceSha256:createHash('sha256').update(code).digest('hex')};
 assert.equal(code.split('const row = {').length,2);
 code=code.replace('const row = {','const row = {reviewLineage:[time.reviewId],');
 assert.equal(code.split('const merged = {...keep, cancelled:').length,2);
 code=code.replace('const merged = {...keep, cancelled:','const merged = {...keep, reviewLineage:group.flatMap(r=>r.reviewLineage), cancelled:');
 return {...hashes,...await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))};
}
const old=await instrument(baselineSource), next=await instrument(readFileSync(resolve(process.argv[2]||'styles/departures.mjs'),'utf8'));
const at=Date.parse('2099-01-01T12:00:00Z'),iso=x=>new Date(at+x).toISOString();
let seed=113;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
const pick=items=>items[Math.floor(random()*items.length)];
const groupKey=row=>[...row.reviewLineage].sort().join('|');
const trials=12000,failures=[];let mergedGroups=0,oldMergedGroups=0;
for(let trial=0;trial<trials;trial++) {
 let id=0;
 const lists=Array.from({length:pick([2,2,2,3,4])},()=>Array.from({length:pick([1,2,3])},()=>{
  const reviewId=String(id++),scheduled=pick([0,0,0,1,30000,59999,60000,90000]);
  return {reviewId,tripId:'trip-'+reviewId,routeId:pick(['r','s']),mode:pick(['TRAM','TRAM','REGIONAL_RAIL']),
   displayName:pick(['T','T','', 'U']),headsign:pick(['Central','Central','(Local) Central','Central West','West']),cancelled:random()<.25,
   place:{departure:iso(scheduled),scheduledDeparture:iso(scheduled),stopId:pick(['s1','s2'])}};
 }));
 const before=old.departureRows(lists,{now:at-60000,count:100}), after=next.departureRows(lists,{now:at-60000,count:100});
 const oldGroups=new Set(before.map(groupKey));
 oldMergedGroups+=before.filter(r=>r.reviewLineage.length>1).length;
 for(const row of after)if(row.reviewLineage.length>1){
  mergedGroups++;
  if(!oldGroups.has(groupKey(row)) && failures.length<3) failures.push({trial,lists,before:before.map(r=>({ids:r.reviewLineage,scheduled:r.scheduled,cancelled:r.cancelled})),after:after.map(r=>({ids:r.reviewLineage,scheduled:r.scheduled,cancelled:r.cancelled}))});
 }
 assert.deepEqual(after.flatMap(r=>r.reviewLineage).sort(),before.flatMap(r=>r.reviewLineage).sort(),'must not lose or invent observations');
}
console.log(JSON.stringify({node:process.version,baselineSha256:old.sourceSha256,candidateSha256:next.sourceSha256,trials,oldMergedGroups,candidateMergedGroups:mergedGroups,newlyFormedGroupExamples:failures},null,2));
assert.equal(failures.length,0,'candidate must not form a group absent from original final outputs');
