import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {summarizeServiceAcquisition,serviceCoverageMessages} from '../styles/service-status.mjs';
import {serviceAcquisitionForBuild} from '../scripts/service-status-manifest.mjs';
import {frequencyAvailability,frequencyBundle} from '../styles/service-frequency.mjs';
const fixture=JSON.parse(await readFile(new URL('fixtures/service-status.json',import.meta.url)));
const sha='a'.repeat(64),now=Date.parse('2026-10-15T12:00:00Z');

test('stage acquisition and source eligibility remain independent, including accepted-empty and legacy evidence',()=>{
 const acquisition=summarizeServiceAcquisition(fixture,sha);
 assert.deepEqual(acquisition.stages.map(s=>[s.acquisition,s.eligibility]),[
  ['partial','unknown'],['deferred','unknown'],['acquired','unresolved'],['acquired','complete'],['acquired','unknown'],['failed','unknown']]);
 const messages=serviceCoverageMessages({state:'loaded',manifest:{schema:3,osmSnapshotSha256:sha,acquisition}}).join('\n');
 assert.match(messages,/visible area or a particular route/);
 assert.match(messages,/Partial fixture: Acquisition partial/);
 assert.match(messages,/Deferred fixture: Latest acquisition deferred.*earlier completed snapshot is retained/);
 assert.match(messages,/Unresolved fixture: Acquisition completed; source eligibility\/geometry unresolved/);
 assert.match(messages,/Empty fixture:.*contains no route records; this does not establish that there are no trains/);
 assert.match(messages,/Legacy fixture:.*source eligibility\/geometry unknown/);
 assert.match(messages,/Failed fixture: Latest acquisition failed/);
 assert.equal(messages.match(/contains no route records/g).length,1);
});

test('missing, malformed, failed and mismatched status never claim area coverage',()=>{
 assert.match(serviceCoverageMessages({state:'failed'}).join(' '),/could not be loaded; coverage is unknown/);
 assert.match(serviceCoverageMessages({state:'loading'}).join(' '),/loading/);
 for(const manifest of [null,{}, {schema:3}, {schema:3,osmSnapshotSha256:'b'.repeat(64),acquisition:summarizeServiceAcquisition(fixture,sha)}])
  assert.match(serviceCoverageMessages({state:'loaded',manifest}).join(' '),/unknown/);
 const acquisition=summarizeServiceAcquisition({stages:[]},sha);
 assert.match(serviceCoverageMessages({state:'loaded',manifest:{schema:3,osmSnapshotSha256:sha,acquisition}}).join(' '),/No stage outcomes.*unknown/);
});

test('a published status is compact and bound to the exact OSM input read by assembly',async()=>{
 const root=await mkdtemp(join(tmpdir(),'service-status-'));
 try{
  const raw=Buffer.from('synthetic exact OSM bytes'),expected=createHash('sha256').update(raw).digest('hex');
  const missing=await serviceAcquisitionForBuild(root,raw);assert.equal(missing.acquisition.status,'unknown');
  await writeFile(join(root,'manifest.json'),JSON.stringify({...fixture,source:'https://secret.invalid/?token=secret',geometry:{details:Array(10000).fill('large')}}));
  const result=await serviceAcquisitionForBuild(root,raw);
  assert.equal(result.osmSnapshotSha256,expected);assert.equal(result.acquisition.snapshotSha256,expected);
  assert.equal(result.acquisition.generated,fixture.generated);assert.equal(result.acquisition.stages.length,6);
  assert.doesNotMatch(JSON.stringify(result),/secret|large|token/);
  assert.notEqual((await serviceAcquisitionForBuild(root,Buffer.from('other input'))).osmSnapshotSha256,expected);
  await writeFile(join(root,'manifest.json'),'{');await assert.rejects(serviceAcquisitionForBuild(root,raw),SyntaxError);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('stage summaries are bounded without presenting omitted stages as complete',()=>{
 const acquisition=summarizeServiceAcquisition({...fixture,stages:Array(65).fill(fixture.stages[0])},sha);
 assert.equal(acquisition.stages.length,64);assert.equal(acquisition.truncated,true);
 assert.match(serviceCoverageMessages({state:'loaded',manifest:{schema:3,osmSnapshotSha256:sha,acquisition}}).at(-1),/omitted/);
});

test('available zero, expiry, explicit no-match and unknown reasons have distinct detail text',()=>{
 const fresh={frequency_am:0,frequency_high_am:0,frequency_until:now/1000+1,frequency_quality_am:'scheduled'};
 assert.equal(frequencyAvailability(fresh,'am',now).status,'available');
 assert.match(frequencyAvailability(fresh,'am',now).text,/^0\/h\/direction/);
 assert.equal(frequencyAvailability(fresh,'pm',now).status,'unknown');
 assert.equal(frequencyAvailability(fresh,'am',now+2000).status,'expired');
 assert.equal(frequencyAvailability({frequency_status:'expired'},'am',now).status,'expired');
 assert.equal(frequencyAvailability({frequency_status:'unmatched'},'am',now).status,'unmatched');
 for(const bad of [{},{frequency_am:1},{...fresh,frequency_until:0},{...fresh,frequency_am:''},{...fresh,frequency_am:false},{...fresh,frequency_am:-1}])
  assert.equal(frequencyAvailability(bad,'am',now).status,'unknown');
});

test('assembly preserves unmatched versus expired input without inventing frequency values',()=>{
 const route={ref:'synthetic',kind:'subway'},lines=[[[0,0],[1,1]]];
 const missing=frequencyBundle([route],lines,null,[],now)[0];
 const expired=frequencyBundle([route],lines,null,[{properties:{frequency_until:now/1000-1},profiles:{am:{rate:4}}}],now)[0];
 const unmatched=frequencyBundle([route],lines,null,[{properties:{frequency_status:'unmatched'},profiles:{}}],now)[0];
 assert.equal(unmatched.frequency_status,'unmatched');
 const incomplete=frequencyBundle([route],lines,null,[{properties:{frequency_until:now/1000+1},profiles:{}}],now)[0];
 assert.equal(missing.frequency_status,'unknown');assert.equal(expired.frequency_status,'expired');assert.equal(incomplete.frequency_status,'unknown');
 for(const properties of [missing,expired,incomplete])assert.equal(properties.frequency_am,undefined);
});
