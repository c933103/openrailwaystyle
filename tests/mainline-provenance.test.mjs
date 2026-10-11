import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,mkdir,rm,cp,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {REFERENCE_INPUTS,referenceInputDigest} from '../scripts/mainline-provenance.mjs';

test('every native browser bundle entry and its imports affect accepted reference inputs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'atlas-reference-provenance-'));
 try{
  for(const path of ['scripts','styles','.github','package.json','package-lock.json'])await cp(path,join(root,path),{recursive:true});
  const build=await readFile('scripts/build-browser.mjs','utf8');
  const entries=[...build.matchAll(/entryPoints:\s*\[\s*['"]([^'"]+)['"]\s*\]/g)].map(match=>match[1]);
  assert.equal(entries.length,5,'cover every current esbuild entry');
  entries.sort((a,b)=>Number(b.endsWith('/tile-labels.mjs'))-Number(a.endsWith('/tile-labels.mjs')));
  assert.ok(REFERENCE_INPUTS.includes('package-lock.json'));
  const dem=await readFile(join(root,'styles/dem-worker.mjs'),'utf8');
  for(const entry of ['actor.ts','worker-dispatch.ts','local-dem-manager.ts'])assert.ok(dem.includes(`../node_modules/maplibre-contour/src/${entry}`));
  await assert.rejects(access(join(root,'node_modules')),error=>error.code==='ENOENT');
  const baseline=await referenceInputDigest(root);
  assert.equal(baseline,await referenceInputDigest(),'install state does not change accepted inputs');
  for(const entry of entries){
   const path=join(root,entry),original=await readFile(path);
   await writeFile(path,Buffer.concat([original,Buffer.from('\n// changed browser entry\n')]));
   assert.notEqual(await referenceInputDigest(root),baseline,entry);
   await writeFile(path,original);
   const dependency=join(dirname(path),'reference-provenance-fixture.mjs');
   await writeFile(dependency,'export const marker=1;\n');
   await writeFile(path,Buffer.concat([original,Buffer.from('\nimport "./reference-provenance-fixture.mjs";\n')]));
   const first=await referenceInputDigest(root);
   await writeFile(dependency,'export const marker=2;\n');
   assert.notEqual(await referenceInputDigest(root),first,`${entry} import closure`);
   await writeFile(path,original);await rm(dependency);
  }
  const lock=join(root,'package-lock.json'),originalLock=await readFile(lock);
  await writeFile(lock,Buffer.concat([originalLock,Buffer.from('\n')]));
  assert.notEqual(await referenceInputDigest(root),baseline,'package sources are covered by the lockfile without node_modules');
  await writeFile(lock,originalLock);
  await mkdir(join(root,'docs'),{recursive:true});await writeFile(join(root,'docs/note.md'),'Documentation only.\n');
  assert.equal(await referenceInputDigest(root),baseline,'documentation can reuse accepted inputs');
 }finally{await rm(root,{recursive:true,force:true})}
});
