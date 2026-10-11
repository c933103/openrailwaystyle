import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
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
 'scripts/verify-mainline-snapshot.mjs','scripts/check-mainline-reference-browser.mjs',
 'scripts/browser-renderer-fixture.mjs','scripts/browser.mjs',
 'styles/mainline-reference.mjs','styles/world.style.json',
]);
export async function referenceInputDigest(root=process.cwd()){
 const entries=[];
 for(const path of REFERENCE_INPUTS)entries.push([path,sha256(await readFile(resolve(root,path)))]);
 return sha256(JSON.stringify(entries));
}
export function matchingReferenceInputs(manifest,digest){
 return manifest?.complete===true&&/^[a-f0-9]{64}$/.test(digest)&&manifest.inputSha256===digest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await referenceInputDigest());
