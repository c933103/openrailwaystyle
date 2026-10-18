import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const repository=process.argv[2],base='7d80b87b9db0f1baa02e9e9f911b9d7554a2b0db';
const before=execFileSync('git',['show',base+':styles/draw.mjs'],{cwd:repository,encoding:'utf8'});
const after=await readFile(repository+'/styles/draw.mjs','utf8');
const load=source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const old=await load(before),fixed=await load(after),observations=[];
for(const units of ['metric','imperial'])for(const heights of [[100,112],[0,0],[-20,-10],[112,100]]){
 const run=async({Measure})=>{
  let status,data;
  const map={on(){},getSource:()=>({setData:value=>{data=value;}}),getCanvas:()=>({style:{}}),doubleClickZoom:{enable(){},disable(){}}};
  const measure=new Measure(map,{units:()=>units,heights:async()=>heights,status:value=>{status=value;}});
  measure.setMode('distance');measure.click({lng:0,lat:0});measure.click({lng:0.00899,lat:0});measure.end();
  for(let i=0;i<30;i++)await Promise.resolve();
  return {status,data};
 };
 const a=await run(old),b=await run(fixed);assert.deepEqual(b,a);observations.push({units,heights,exactEqual:true,status:b.status});
}
const result={base,head:'82495d1bdc2d113c8fef740e1346db123e8ff2c4',beforeSha256:createHash('sha256').update(before).digest('hex'),afterSha256:createHash('sha256').update(after).digest('hex'),observations};
console.log(JSON.stringify(result,null,2));
