import {readFile,readdir} from 'node:fs/promises';
import {resolve,dirname,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './mainline-coverage.mjs';
// Deployment accepts only data built and browser-checked with these inputs.
// Documentation-only and unrelated orchestration edits can reuse that result.
export const REFERENCE_INPUTS=Object.freeze([
 '.github/workflows/mainline-reference.yml','package.json','package-lock.json',
 'tests/fixtures/browser-glyphs/0-255.pbf',
 // The acceptance workflow also executes these drivers and reads station data.
 'scripts/serve.mjs','scripts/build-style.mjs','styles/data-src/major-stations.json',
 'scripts/acquire-mainline-extract.py','scripts/plan-mainline-acquisition.py',
 'scripts/build-mainline-snapshot.mjs','scripts/mainline-overview.mjs',
 'scripts/mainline-chains.mjs','scripts/mainline-coverage.mjs',
 'scripts/mainline-provenance.mjs','scripts/retain-mainline-generation.mjs',
 'scripts/record-mainline-acceptance.mjs','scripts/plan-mainline-reuse.mjs',
 'scripts/find-mainline-checkpoints.mjs',
 'scripts/verify-mainline-snapshot.mjs','scripts/check-mainline-reference-browser.mjs',
 'scripts/browser-renderer-fixture.mjs','scripts/browser.mjs',
 'scripts/browser-libraries.mjs','scripts/build-browser.mjs','scripts/maplibre-backport.mjs',
 'scripts/browser-network-guard.mjs','scripts/browser-policy.mjs',
 'styles/map-controls.mjs','styles/vector-tile-validation.mjs','styles/pbf-utf8.mjs',
 'styles/mainline-reference.mjs','styles/world.style.json','styles/app.mjs','styles/index.html','styles/app.css',
]);
// Keep generation provenance deliberately conservative: the entire workflow and
// package lock are inputs. This binds plan commands, inherited configuration and
// all YAML semantics without a second workflow parser or migration equivalence.
export const DATA_INPUTS=Object.freeze([
 '.github/workflows/mainline-reference.yml','package.json','package-lock.json',
 'scripts/acquire-mainline-extract.py','scripts/plan-mainline-acquisition.py',
 'scripts/build-mainline-snapshot.mjs','scripts/mainline-overview.mjs',
 'scripts/mainline-chains.mjs','scripts/mainline-coverage.mjs',
]);
async function nativeStyleInputs(root,dir='styles'){
 const files=[];
 for(const entry of await readdir(resolve(root,dir),{withFileTypes:true})){
  const path=join(dir,entry.name);
  // These contain generated bundles and published snapshots, rather than
  // authored inputs. Build commit metadata must not change data provenance.
  if(path==='styles/vendor'||path==='styles/data')continue;
  if(entry.isDirectory())files.push(...await nativeStyleInputs(root,path));
  else if(entry.isFile()&&/\.(?:mjs|js)$/.test(entry.name))files.push(path);
 }
 return files;
}
async function inputDigest(root,inputs){
 const entries=new Map(),queue=[...inputs];
 while(queue.length){
  const path=queue.pop();if(entries.has(path))continue;
  const bytes=await readFile(resolve(root,path));entries.set(path,sha256(bytes));
  if(/\.(?:mjs|js)$/.test(path))for(const match of bytes.toString().matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)){
   const dependency=relative(root,resolve(root,dirname(path),match[1].split('?')[0]));
   if(dependency.startsWith('..'))throw Error('Reference dependency escaped repository');
   // Installed dependencies are bound by package-lock and immutable library
   // pins; generated outputs are bound by their authored build inputs. The
   // readiness job intentionally computes this digest without npm install.
   if(dependency.startsWith('node_modules/')||dependency.startsWith('styles/vendor/')||dependency.startsWith('styles/data/'))continue;
   queue.push(dependency);
  }
 }
 return sha256(JSON.stringify([...entries].sort(([a],[b])=>a.localeCompare(b))));
}
export async function referenceDataInputDigest(root=process.cwd()){
 root=resolve(root);
 return inputDigest(root,DATA_INPUTS);
}
export async function referenceInputDigest(root=process.cwd()){
 root=resolve(root);
 // Include authored browser entries loaded outside static import syntax too.
 return inputDigest(root,[...REFERENCE_INPUTS,...await nativeStyleInputs(root)]);
}
export function matchingReferenceInputs(manifest,digest){
 return manifest?.complete===true&&/^[a-f0-9]{64}$/.test(digest)&&manifest.inputSha256===digest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await referenceInputDigest());
