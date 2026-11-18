// Readiness for automatic filter rollout; builders retain their own coverage gates.
import {readFile, appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {currentFilter} from './extract-release.mjs';
export function extractReadiness(index, {filter=currentFilter, runId=null}={}) {
 const reasons=[];
 if(!index||index.schema!==1||!index.regions||Array.isArray(index.regions))return {ready:false,reasons:['No valid working-copy index']};
 const entries=Object.entries(index.regions);
 if(!entries.length)reasons.push('No regional working copies');
 if(!Array.isArray(index.missing)||index.missing.length)reasons.push('Missing or unspecified planned inputs');
 for(const [id,e] of entries)if(!e||e.region!==id||e.filter!==filter(id))reasons.push(`Stale or invalid selection: ${id}`);
 if(runId!==null&&(!/^\d+$/.test(String(runId))||!new RegExp(`^\\d{8}T\\d{6}Z-${runId}$`).test(index.generation||'')))reasons.push('Index was not published by the completed refresh');
 return {ready:reasons.length===0,reasons};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const [mode,file]=process.argv.slice(2);
 if(!['refresh','assemble'].includes(mode)||!file)throw Error('Usage: extract-rollout.mjs refresh|assemble index.json');
 if(mode==='assemble'&&!/^\d+$/.test(process.env.EXTRACT_RUN_ID||''))throw Error('Completed extract run ID is required');
 let index;try{index=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const result=extractReadiness(index,{runId:mode==='assemble'?process.env.EXTRACT_RUN_ID:null});
 const required=mode==='refresh'?!result.ready:result.ready;
 console.log(JSON.stringify({mode,required,...result}));
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`required=${required}\n`);
}
