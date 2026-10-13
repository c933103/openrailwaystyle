import {readFile,readdir} from 'node:fs/promises';
import {resolve,dirname,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sha256} from './mainline-coverage.mjs';
// Deployment accepts only data built and browser-checked with these inputs.
// Documentation-only and unrelated orchestration edits can reuse that result.
const LEGACY_REFERENCE_INPUTS=Object.freeze([
 '.github/workflows/mainline-reference.yml','package.json','package-lock.json',
 'tests/fixtures/browser-glyphs/0-255.pbf',
 // The acceptance workflow also executes these drivers and reads station data.
 'scripts/serve.mjs','scripts/build-style.mjs','styles/data-src/major-stations.json',
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
export const REFERENCE_INPUTS=Object.freeze([...LEGACY_REFERENCE_INPUTS,
 'scripts/plan-mainline-reuse.mjs',
]);
// Dataset identity is separate from compatibility with the current app.
// The snapshot builder no longer imports application-acceptance code; every
// transform dependency is included normally, without ignored metadata edges.
export const DATA_INPUTS=Object.freeze([
 'package.json','package-lock.json','scripts/acquire-mainline-extract.py',
 'scripts/plan-mainline-acquisition.py','scripts/build-mainline-snapshot.mjs',
 'scripts/mainline-overview.mjs','scripts/mainline-chains.mjs','scripts/mainline-coverage.mjs',
]);
export function generationWorkflowInputs(workflow){
 const lines=workflow.split('\n');
 const global=[];
 for(const key of ['env','defaults']){
  const starts=lines.flatMap((line,i)=>line.startsWith(`${key}:`)?[i]:[]);
  if(starts.length>1)throw Error('Duplicate global generation configuration');
  if(starts.length){const start=starts[0],offset=lines.slice(start+1).findIndex(line=>/^\S/.test(line));
   global.push(...lines.slice(start,offset<0?lines.length:start+1+offset));}
 }
 const job=name=>{
  const starts=lines.flatMap((line,i)=>line===`  ${name}:`?[i]:[]);
  if(starts.length!==1)throw Error('Unrecognized generation workflow job');
  const start=starts[0],offset=lines.slice(start+1).findIndex(line=>/^  [\w-]+:$/.test(line));
  return lines.slice(start,offset<0?lines.length:start+1+offset);
 };
 const extract=job('extract').filter(line=>line!=="    if: needs.plan.outputs.reuse != 'true'");
 const assemble=job('assemble'),boundary=assemble.indexOf('      - name: Verify the exact generation and renderer before publication');
 if(boundary<0)throw Error('Unrecognized generation/renderer boundary');
 const prefix=assemble.slice(0,boundary).filter(line=>line!=="    if: ${{ !cancelled() && needs.plan.result == 'success' && (needs.plan.outputs.reuse == 'true' || needs.extract.result == 'success') }}");
 const steps=prefix.indexOf('    steps:');if(steps<0)throw Error('Missing generation steps');
 const blocks=[];let current;
 for(const line of prefix.slice(steps+1)){
  if(line.startsWith('      - ')){current=[];blocks.push(current);}
  if(!current)throw Error('Unrecognized generation step indentation');
  current.push(line);
 }
 // Only steps that can run in a fresh generation belong to its recipe. The
 // reuse-only hydration path is still bound by the full acceptance digest.
 const fresh=blocks.filter(block=>!block.includes("        if: needs.plan.outputs.reuse == 'true'"))
  .flatMap(block=>block.filter(line=>line!=="        if: needs.plan.outputs.reuse != 'true'"));
 if(!fresh.some(line=>line.includes('node scripts/build-mainline-snapshot.mjs mainline-input mainline-output')))
  throw Error('Missing generation invocation');
 const recipe=[...global,...extract,...prefix.slice(0,steps+1),...fresh].join('\n').trimEnd();
 // Resolving arbitrary YAML aliases would require a second workflow parser.
 // Refuse inherited/aliased execution configuration instead of missing a
 // definition elsewhere in the document. Trigger path aliases are unrelated.
 if(/(?:^|[\s:[,{])[*&][A-Za-z_][\w-]*/m.test(recipe))throw Error('YAML aliases/anchors are unsupported in generation configuration');
 return recipe;
}
function sourceReader(root,ref){
 if(ref&&!/^[a-f0-9]{40}$/.test(ref))throw Error('Expected immutable source commit');
 const git=args=>execFileSync('git',args,{cwd:root,maxBuffer:16*1024**2});
 return {read:path=>ref?git(['show',`${ref}:${path}`]):readFile(resolve(root,path)),
  native:()=>ref?git(['ls-tree','-r','--name-only',ref,'--','styles']).toString().split('\n')
   .filter(path=>!path.startsWith('styles/vendor/')&&!path.startsWith('styles/data/')&&/\.(?:mjs|js)$/.test(path))
   :nativeStyleInputs(root)};
}
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
async function inputDigest(root,reader,inputs,{legacyData=false}={}){
 const entries=new Map(),queue=[...inputs];
 while(queue.length){
  const path=queue.pop();if(entries.has(path))continue;
  let bytes=await reader.read(path);
  if(legacyData&&path==='scripts/build-mainline-snapshot.mjs'){
   // One-time legacy transition: remove only the former metadata import and
   // its manifest field. Every remaining byte must match the current builder.
   // The caller separately proves the complete old source acceptance digest.
   let source=bytes.toString();
   for(const metadata of ["import {referenceInputDigest} from './mainline-provenance.mjs';\n",',inputSha256:await referenceInputDigest()']){
    if(source.split(metadata).length!==2)throw Error('Unsupported legacy snapshot metadata layout');
    source=source.replace(metadata,'');
   }
   bytes=Buffer.from(source);
  }
  entries.set(path,sha256(bytes));
  if(/\.(?:mjs|js)$/.test(path))for(const match of bytes.toString().matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)){
   const dependency=relative(root,resolve(root,dirname(path),match[1].split('?')[0]));
   if(dependency.startsWith('..'))throw Error('Reference dependency escaped repository');
   if(dependency.startsWith('node_modules/')||dependency.startsWith('styles/vendor/')||dependency.startsWith('styles/data/'))continue;
   queue.push(dependency);
  }
 }
 return sha256(JSON.stringify([...entries].sort(([a],[b])=>a.localeCompare(b))));
}
export async function referenceDataInputDigest(root=process.cwd(),{ref,legacy=false}={}){
 root=resolve(root);
 const reader=sourceReader(root,ref),workflow=generationWorkflowInputs((await reader.read('.github/workflows/mainline-reference.yml')).toString());
 return sha256(JSON.stringify(['mainline-generator-v1',generationWorkflowInputs.toString(),workflow,
  await inputDigest(root,reader,DATA_INPUTS,{legacyData:legacy})]));
}
export async function referenceInputDigest(root=process.cwd(),{ref,legacy=false}={}){
 root=resolve(root);
 // Include authored browser entries even when a build driver or template
 // literal loads them without a static import (workers, labels, polar layer).
 const reader=sourceReader(root,ref);
 return inputDigest(root,reader,[...(legacy?LEGACY_REFERENCE_INPUTS:REFERENCE_INPUTS),...await reader.native()]);
}
export function matchingReferenceInputs(manifest,digest){
 return manifest?.complete===true&&/^[a-f0-9]{64}$/.test(digest)&&manifest.inputSha256===digest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await referenceInputDigest());
