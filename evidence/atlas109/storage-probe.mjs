import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=pathToFileURL(resolve(process.argv[2]||'.')+'/');
const {observeRelation,reconcileRelations}=await import(new URL('scripts/service-relations.mjs',root));
const {toTable,addResult,commitStage,writeTable}=await import(new URL('scripts/service-routes.mjs',root));
const raw=await readFile(new URL('tests/fixtures/service-geometry/overpass-meta-relation-10003040.json',root));
assert.equal(createHash('sha256').update(raw).digest('hex'),'75a13a5e7586a2f1f58ee11fd42ef7582cfdde0358d8188b5de8072f5f8215f5');
const json=JSON.parse(raw),first=toTable(json).routes[0].membership;
const source={endpoint:'https://overpass.invalid/local-replay',acquired:'2026-10-07T04:12:00Z',stage:'fixture',pass:'2026-10-07T04:12:00Z',query:'a'.repeat(64)};
let replay=null,eight,unchanged=first;
for(let i=0;i<1000;i++){
 const snapshot=new Date(Date.parse(json.osm3s.timestamp_osm_base)+i*1000).toISOString();
 const observed=observeRelation(json.elements[0],{...json,osm3s:{timestamp_osm_base:snapshot}},{...source,acquired:snapshot},first.view,new Set());
 replay=reconcileRelations(replay,observed);unchanged=reconcileRelations(unchanged,first);
 if(i===7)eight=structuredClone(replay.supplemental);
}
assert.deepEqual(unchanged.supplemental,first.supplemental);
assert.deepEqual(replay.supplemental,eight);
assert.equal(replay.supplemental.revisions[0].variants[0].sources.length,8);
const rowSize=result=>{const t={routes:new Map(),ways:new Map()};addResult(t,result,'fixture');commitStage(t,'fixture');const text=writeTable(t);return {rawBytes:Buffer.byteLength(text),gzip9Bytes:gzipSync(text,{level:9}).length};};
const rich=toTable(json),old=JSON.parse(JSON.stringify(rich,(key,value)=>key==='supplemental'?undefined:value));
const core=rowSize(old),supplemental=rowSize(rich);
const saturated=toTable(json);saturated.routes[0].membership=replay;const saturatedRows=rowSize(saturated);
console.log(JSON.stringify({source:'88bee49d4c20aa4fbebdd501b503587f2dba7e49',fixtureSha256:createHash('sha256').update(raw).digest('hex'),replayObservations:1000,unchangedDuplicateEnvelopeIdentical:true,changingSnapshotEnvelopeAfter8IdenticalToAfter1000:true,retainedSnapshotsPerVariant:8,counts:{maxRevisionIdentities:2,maxVariantsPerRevision:2,maxSourceReferencesPerVariant:8,maxReferencesPerEnvelope:32,allowlistedTags:23,maxValueUtf16CodeUnits:1024},fixtureSingleAcceptedStageRows:{oldCore:core,oneSupplementalObservation:supplemental,delta:{rawBytes:supplemental.rawBytes-core.rawBytes,gzip9Bytes:supplemental.gzip9Bytes-core.gzip9Bytes},eightSyntheticSourceSamples:saturatedRows},limits:'Measured only the unchanged authentic fixture, plus synthetic repeat-provenance. Not a global compression/growth estimate. Source-reference string lengths and number of route/stage rows are not globally byte-capped by this envelope.'},null,2));
