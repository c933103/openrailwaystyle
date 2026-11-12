import {cp,readdir,readFile,stat,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './mainline-coverage.mjs';
// Keep one previous immutable renderer generation. Source archives stay in
// its earlier Git commit; only render assets need continued site availability.
export async function retainMainlineGeneration(previous,current){
 const old=JSON.parse(await readFile(join(previous,'manifest.json'))),now=JSON.parse(await readFile(join(current,'manifest.json')));
 if(!/^[a-f0-9]{24}$/.test(old.generation)||old.complete!==true)throw Error('Invalid previous reference generation');
 const source=join(previous,'generations',old.generation),target=join(current,'generations',old.generation);
 async function copy(dir,out){
  await mkdir(out,{recursive:true});
  for(const f of await readdir(dir,{withFileTypes:true})){
   if(f.isSymbolicLink())throw Error('Unexpected generation symlink');
   if(f.isDirectory())await copy(join(dir,f.name),join(out,f.name));
   else if(f.isFile()&&!/\.ndjson\.gz\.part-\d+$/.test(f.name)){
    const source=join(dir,f.name),target=join(out,f.name);
    let existing;try{existing=await readFile(target)}catch(error){if(error.code!=='ENOENT')throw error}
    if(existing){if(sha256(existing)!==sha256(await readFile(source)))throw Error('Immutable generation asset changed')}
    else await cp(source,target,{errorOnExist:true,force:false});
   }
  }
 }
 await copy(source,target);
 let total=0;
 async function size(dir){for(const f of await readdir(dir,{withFileTypes:true})){
  if(f.isDirectory())await size(join(dir,f.name));else total+=(await stat(join(dir,f.name))).size;
 }}
 await size(current);if(total>1024**3)throw Error('Two-generation reference publication exceeds 1 GiB budget');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await retainMainlineGeneration(...process.argv.slice(2));
