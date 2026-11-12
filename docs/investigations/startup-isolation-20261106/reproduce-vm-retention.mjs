import vm from 'node:vm';
import v8 from 'node:v8';
import {JSDOM} from 'jsdom';
if (!globalThis.gc) throw new Error('Run with --expose-gc for this manual diagnostic');
const mode=process.argv[2];
if (!['dom','module','dynamic'].includes(mode)) throw new Error('Choose dom, module, or dynamic');
async function one(i){
 const dom=new JSDOM('<!doctype html><p>synthetic</p>',{runScripts:'outside-only'});
 if(mode!=='dom'){
  const context=dom.getInternalVMContext();
  const options={context};
  if(mode==='dynamic')options.importModuleDynamically=async()=>{throw Error('not used');};
  const module=new vm.SourceTextModule('export const x=1;',options);
  await module.link(()=>{throw Error('not used');});await module.evaluate();
 }
 dom.window.close();
}
const sample=i=>{const h=v8.getHeapStatistics();console.log(JSON.stringify({mode,i,...process.memoryUsage(),contexts:h.number_of_native_contexts,detached:h.number_of_detached_contexts}));};
global.gc();sample(0);
for(let i=1;i<=120;i++){await one(i);await new Promise(r=>setImmediate(r));global.gc();if(i%30===0)sample(i);}
