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
export function targetedRefresh(index, request, filter=currentFilter) {
 const ids=['south-america','australia-oceania'];
 const sourceDate='2026-11-24';
 if(request?.schema!==1||request.reason!==531||request.sourceDate!==sourceDate||
    JSON.stringify(request.regionIds)!==JSON.stringify(ids))throw Error('Not the reviewed two-region request for #531');
 const readiness=extractReadiness(index,{filter});
 if(!readiness.ready)throw Error('Targeted refresh requires the complete current filter: '+readiness.reasons.join('; '));
 // Both inputs are already working copies, and a completed refresh to the
 // declared date makes replay of the one-off request unnecessary.
 const stamps=ids.map(id=>index.regions[id]?.sourceTimestamp);
 if(stamps.some(stamp=>typeof stamp!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(stamp)||!Number.isFinite(Date.parse(stamp))))
   throw Error('Missing or invalid two-region working-copy timestamps');
 return {required:stamps.some(stamp=>stamp.slice(0,10)<sourceDate),regionIds:ids,sourceDate};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const [mode,file,requestFile]=process.argv.slice(2);
 if(!['refresh','assemble','targeted'].includes(mode)||!file||(mode==='targeted'&&!requestFile))throw Error('Usage: extract-rollout.mjs refresh|assemble index.json | targeted index.json request.json');
 if(mode==='assemble'&&!/^\d+$/.test(process.env.EXTRACT_RUN_ID||''))throw Error('Completed extract run ID is required');
 let index;try{index=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(mode==='targeted'){
   const result=targetedRefresh(index,JSON.parse(await readFile(requestFile,'utf8')));
   console.log(JSON.stringify({mode,...result}));
   if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`required=${result.required}\nregion_ids=${result.regionIds.join(',')}\nsource_date=${result.sourceDate}\n`);
 }else{
 const result=extractReadiness(index,{runId:mode==='assemble'?process.env.EXTRACT_RUN_ID:null});
 const required=mode==='refresh'?!result.ready:result.ready;
 console.log(JSON.stringify({mode,required,...result}));
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`required=${required}\n`);
 }
}
