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
  await mkdir(join(root,'tests/fixtures'),{recursive:true});
  await cp('tests/fixtures/browser-glyphs',join(root,'tests/fixtures/browser-glyphs'),{recursive:true});
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
  const glyph=join(root,'tests/fixtures/browser-glyphs/0-255.pbf'),originalGlyph=await readFile(glyph);
  await writeFile(glyph,Buffer.concat([originalGlyph,Buffer.from([0])]));
  assert.notEqual(await referenceInputDigest(root),baseline,'renderer glyph bytes invalidate acceptance');
  await writeFile(glyph,originalGlyph);
  assert.ok((await readFile('.github/workflows/mainline-reference.yml','utf8')).includes('tests/fixtures/browser-glyphs/0-255.pbf'),'glyph changes trigger real-source acceptance');
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


test('source acceptance commands, build drivers and direct station input affect provenance',async()=>{
 const workflow=await readFile('.github/workflows/mainline-reference.yml','utf8');
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 const commands=[...workflow.matchAll(/\bnode (scripts\/[\w/-]+\.mjs)/g),...pkg.scripts.build.matchAll(/\bnode (scripts\/[\w/-]+\.mjs)/g)].map(match=>match[1]);
 for(const path of new Set(commands))assert.ok(REFERENCE_INPUTS.includes(path),`explicit acceptance driver ${path}`);
 const root=await mkdtemp(join(tmpdir(),'atlas-reference-drivers-'));
 try{
  for(const path of ['scripts','styles','.github','tests/fixtures/browser-glyphs','package.json','package-lock.json'])await cp(path,join(root,path),{recursive:true});
  const baseline=await referenceInputDigest(root);
  for(const path of ['scripts/serve.mjs','scripts/build-style.mjs','styles/data-src/major-stations.json']){
   const file=join(root,path),bytes=await readFile(file);
   await writeFile(file,Buffer.concat([bytes,Buffer.from('\n')]));
   assert.notEqual(await referenceInputDigest(root),baseline,path);
   await writeFile(file,bytes);
  }
  assert.equal(await referenceInputDigest(root),baseline);
 }finally{await rm(root,{recursive:true,force:true})}
 assert.match(workflow,/paths: &reference_paths .*'styles\/data-src\/major-stations\.json'/);
});


test('glyph and direct station data changes trigger both acceptance workflows',async()=>{
 for(const workflow of ['mainline-reference.yml','mainline-tests.yml']){
  const text=await readFile('.github/workflows/'+workflow,'utf8');
  const paths=text.split('\n').filter(line=>line.includes('paths:')&&!line.includes('paths: *reference_paths'));
  assert.ok(paths.length>0);
  for(const line of paths)for(const fixture of ['tests/fixtures/browser-glyphs/0-255.pbf','styles/data-src/major-stations.json'])assert.ok(line.includes(fixture),workflow+' '+fixture);
 }
});
