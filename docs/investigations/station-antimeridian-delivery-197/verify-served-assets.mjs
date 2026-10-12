// Run after a clean archive of merge 85e7c7b is built with its GitHub build identity.
// Only bounded, first-party deployment reads; redirects are rejected.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.argv[2], output=process.argv[3];
assert.ok(root && output, 'usage: node verify.mjs CLEAN_BUILT_REPOSITORY EVIDENCE_DIRECTORY');
const base='https://c933103.github.io/openrailwaystyle/';
const merge='85e7c7bfcd8c561f21ee9b000572b559c4928641';
const version='20261012-station-antimeridian-1';
const paths=['index.html','app.mjs','cjk-font.mjs','departures-ui.mjs','departures.mjs','elevation.mjs','layer-semantics.mjs','map-model.mjs','app.css','sw.js','vendor/tile-labels.js'];
const sha256=b=>createHash('sha256').update(b).digest('hex');
const report={checkedAt:new Date().toISOString(),merge,version,base,bodyEncoding:'decoded application bytes',assets:[]};
await mkdir(output,{recursive:true});
try {
 for(const path of paths){
  const url=path==='index.html'?base:base+path+(path==='sw.js'?'':'?v='+version);
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,200,url);
  const actual=Buffer.from(await response.arrayBuffer());
  const expected=await readFile(join(root,'styles',path));
  const record={path,url,status:response.status,bytes:actual.length,sha256:sha256(actual),expectedSha256:sha256(expected),etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),matched:actual.equals(expected)};
  report.assets.push(record);
  console.log(JSON.stringify(record));
  assert.deepEqual(actual,expected,`${path}: delivered bytes must match clean merge build`);
  if(path==='vendor/tile-labels.js'){
   assert.ok(actual.includes(Buffer.from(merge)), 'bundle embeds merged source commit');
   assert.ok(actual.includes(Buffer.from(version)), 'bundle embeds current cache token');
  }
  // Replay the received bytes for focused tests and the guarded local browser fixture.
  await writeFile(join(root,'styles',path),actual);
 }
 const {buildInfo}=await import(pathToFileURL(join(root,'styles/vendor/tile-labels.js')).href);
 assert.deepEqual(buildInfo,{version,commit:merge,sourceUrl:'https://github.com/c933103/openrailwaystyle/commit/'+merge});
 report.buildInfo=buildInfo;
 const url=base+'data/mainline-reference/manifest.json';
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200,url);
 const bytes=Buffer.from(await response.arrayBuffer()), manifest=JSON.parse(bytes);
 report.reference={url,bytes:bytes.length,sha256:sha256(bytes),complete:manifest.complete,generation:manifest.generation,inputSha256:manifest.inputSha256,indexSha256:manifest.indexSha256,rendererAcceptance:manifest.rendererAcceptance,oldestSource:manifest.oldestSource,newestSource:manifest.newestSource};
 assert.equal(manifest.complete,true);
 assert.equal(manifest.inputSha256,'70b3cdb7166621badb3fa94e9d4406d467d860615c91c75cceb5e8be01dc5699');
 report.passed=true;
 console.log(JSON.stringify({reference:report.reference,passed:true}));
} finally {
 await writeFile(join(output,'served-assets.json'),JSON.stringify(report,null,2)+'\n');
}
