import {readFile} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './mainline-coverage.mjs';
// Deployment accepts only data built and browser-checked with these inputs.
// Documentation-only and unrelated application edits can reuse that result.
export const REFERENCE_INPUTS=Object.freeze([
 '.github/workflows/mainline-reference.yml','package.json','package-lock.json',
 'scripts/acquire-mainline-extract.py','scripts/plan-mainline-acquisition.py',
 'scripts/build-mainline-snapshot.mjs','scripts/mainline-overview.mjs',
 'scripts/mainline-chains.mjs','scripts/mainline-coverage.mjs',
 'scripts/mainline-provenance.mjs','scripts/retain-mainline-generation.mjs',
 'scripts/record-mainline-acceptance.mjs',
 'scripts/find-mainline-checkpoints.mjs',
 'scripts/verify-mainline-snapshot.mjs','scripts/check-mainline-reference-browser.mjs',
 'scripts/browser-renderer-fixture.mjs','scripts/browser.mjs',
 'scripts/browser-libraries.mjs','scripts/build-browser.mjs','scripts/maplibre-backport.mjs',
 'scripts/browser-network-guard.mjs','scripts/browser-policy.mjs',
 'styles/map-controls.mjs','styles/vector-tile-validation.mjs','styles/pbf-utf8.mjs',
 'styles/mainline-reference.mjs','styles/world.style.json','styles/app.mjs','styles/index.html','styles/app.css',
]);
export async function referenceInputDigest(root=process.cwd()){
 const entries=new Map(),queue=[...REFERENCE_INPUTS];root=resolve(root);
 while(queue.length){
  const path=queue.pop();if(entries.has(path))continue;
  const bytes=await readFile(resolve(root,path));entries.set(path,sha256(bytes));
  if(/\.(?:mjs|js)$/.test(path))for(const match of bytes.toString().matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)){
   const dependency=relative(root,resolve(root,dirname(path),match[1].split('?')[0]));
   if(dependency.startsWith('..'))throw Error('Reference dependency escaped repository');
   queue.push(dependency);
  }
 }
 return sha256(JSON.stringify([...entries].sort(([a],[b])=>a.localeCompare(b))));
}
export function matchingReferenceInputs(manifest,digest){
 return manifest?.complete===true&&/^[a-f0-9]{64}$/.test(digest)&&manifest.inputSha256===digest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await referenceInputDigest());
