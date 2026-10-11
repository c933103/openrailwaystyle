import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base='https://c933103.github.io/openrailwaystyle/',version='20261011-departure-availability-2',commit='79162dff6808b18461e4c8e33e177ca39effb146';
const files=['index.html','app.mjs','app.css','departures.mjs','departures-ui.mjs','map-model.mjs','layer-semantics.mjs','elevation.mjs','cjk-font.mjs','power-facilities.mjs','sw.js'];
const results=[];
for(const file of files){
 const path=file==='index.html'?'':file+(file==='sw.js'?'':`?v=${version}`);
 const response=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,file);
 const bytes=Buffer.from(await response.arrayBuffer()),expected=await readFile('styles/'+file);
 assert.ok(bytes.equals(expected),`${file} must match reviewed source bytes`);
 results.push({path,status:response.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),matchesReviewedSource:true});
}
const response=await fetch(base+'vendor/tile-labels.js',{redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);
const bundle=await response.text();assert.ok(bundle.includes(commit),'bundle identifies merge commit');assert.ok(bundle.includes(version),'bundle identifies availability-2');
const report={observedAt:new Date().toISOString(),base,commit,version,assets:results,bundle:{bytes:Buffer.byteLength(bundle),sha256:createHash('sha256').update(bundle).digest('hex'),commitPresent:true,versionPresent:true}};
await writeFile('../postmerge/served-bytes.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
