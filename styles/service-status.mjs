// Snapshot-wide acquisition facts. Stage labels never establish viewport or
// individual-route coverage, and retained data do not establish source health.
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
const short=value=>typeof value==='string'?value.slice(0,100):'Unknown stage';
export function summarizeServiceAcquisition(manifest, snapshotSha256) {
  const stages=Array.isArray(manifest?.stages)?manifest.stages:null;
  if(!stages)return {schema:1,status:'unknown',snapshotSha256,stages:[]};
  return {schema:1,status:'available',snapshotSha256,generated:date(manifest.generated),
    truncated:stages.length>64,stages:stages.slice(0,64).map(stage=>{
      const completed=date(stage?.completed),attempt=stage?.lastAttempt?.status;
      const acquisition=attempt==='deferred'?'deferred':attempt==='failed'?'failed':stage?.inProgress===true?'partial':
        completed?'acquired':'unknown';
      const health=stage?.geometry,source=health?.sourceOutcome?.status??health?.sourceStatus;
      const unresolved=source==='incomplete'||health?.status==='incomplete';
      const eligibility=unresolved?'unresolved':source==='complete'&&health?.status==='complete'?'complete':'unknown';
      return {name:short(stage?.name),label:short(stage?.label||stage?.name),acquisition,eligibility,
        completed,lastAttempt:date(stage?.lastAttempt?.at),routes:count(stage?.routes),retainedRelations:count(stage?.retainedRelations)};
    })};
}
export function serviceCoverageMessages({state='unknown',manifest}={}) {
  const scope='Snapshot-wide acquisition stages; these do not establish coverage of the visible area or a particular route.';
  if(state==='loading')return ['Service data status is loading.',scope];
  if(state==='failed')return ['Service data status could not be loaded; coverage is unknown.',scope];
  const data=manifest?.acquisition;
  if(manifest?.schema!==3||data?.schema!==1||data.status!=='available'||!Array.isArray(data.stages)||
    !/^[a-f0-9]{64}$/.test(manifest.osmSnapshotSha256||'')||data.snapshotSha256!==manifest.osmSnapshotSha256)
    return ['Service acquisition status is unknown for this snapshot.',scope];
  const lines=[scope];
  if(date(data.generated))lines.push('OSM acquisition snapshot: '+data.generated);
  for(const stage of data.stages.slice(0,64)){
    const acquisition={partial:'Acquisition partial',deferred:'Latest acquisition deferred',failed:'Latest acquisition failed',
      acquired:'Acquisition completed',unknown:'Acquisition status unknown'}[stage?.acquisition]||'Acquisition status unknown';
    const health={unresolved:'source eligibility/geometry unresolved',complete:'recorded source checks complete',unknown:'source eligibility/geometry unknown'}[stage?.eligibility]||'source eligibility/geometry unknown';
    let text=short(stage?.label)+': '+acquisition+'; '+health+'.';
    if(stage?.acquisition==='acquired'&&stage?.eligibility==='complete'&&stage.routes===0&&stage.retainedRelations===0)
      text+=' The acquired stage snapshot contains no route records; this does not establish that there are no trains.';
    if(stage?.completed&&['partial','deferred','failed'].includes(stage.acquisition))text+=' An earlier completed snapshot is retained.';
    lines.push(text);
  }
  if(data.truncated||data.stages.length>64)lines.push('Additional stage details are omitted from this summary.');
  if(!data.stages.length)lines.push('No stage outcomes are recorded; coverage is unknown.');
  return lines;
}
