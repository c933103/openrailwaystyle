import {sha256} from './mainline-coverage.mjs';
// Join only degree-two OSM NODE identities with identical mapped categories.
// Coincident coordinates without shared node identity never imply connectivity.
// Tiles carry a stable chain ID; membership retains every original way/version.
export function mainlineChains(features){
 const groups=new Map(),membership=[],chains=[],ids=new Set();
 for(const f of features){
  const p=f.properties,key=JSON.stringify([p.feature,p.classification,p.highspeed_tag]);
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);
 }
 for(const rows of groups.values()){
  rows.sort((a,b)=>a.id-b.id);
  const nodes=new Map(),remaining=new Set(rows);
  const end=(f,i)=>f.properties[i?'end_node':'start_node'];
  const linked=f=>f.geometry.type==='LineString'&&
    /^[1-9]\d*$/.test(end(f,0))&&/^[1-9]\d*$/.test(end(f,1));
  for(const f of rows)if(linked(f))for(const node of [end(f,0),end(f,1)]){
   if(!nodes.has(node))nodes.set(node,[]);nodes.get(node).push(f);
  }
  const starts=rows.filter(f=>!linked(f)||[end(f,0),end(f,1)].some(n=>nodes.get(n)?.length!==2));
  for(const first of [...starts,...rows]){
   if(!remaining.has(first))continue;
   const members=[],points=[];
   let next=first,enter=linked(first)&&nodes.get(end(first,0))?.length===2&&
      nodes.get(end(first,1))?.length!==2?end(first,1):end(first,0);
   while(next&&remaining.has(next)){
    remaining.delete(next);members.push({id:next.properties.id,version:next.properties.osm_version});
    if(!linked(next)){points.push(...(next.geometry.type==='LineString'?next.geometry.coordinates:[]));break}
    const reverse=end(next,1)===enter,coords=reverse?[...next.geometry.coordinates].reverse():next.geometry.coordinates;
    if(points.length&&JSON.stringify(points.at(-1))!==JSON.stringify(coords[0]))
      throw Error('Connected OSM node has inconsistent coordinates');
    points.push(...coords.slice(points.length?1:0));
    const exit=end(next,reverse?0:1),choices=nodes.get(exit);
    next=choices?.length===2?choices.find(f=>remaining.has(f)):null;enter=exit;
   }
   const key='chain-'+sha256(JSON.stringify(members.map(m=>[m.id,m.version]).sort(([a],[b])=>a.localeCompare(b))));
   const id=parseInt(key.slice(6,19),16),reference='chain-'+key.slice(6,19);
   if(ids.has(id))throw Error('Reference chain numeric ID collision');ids.add(id);
   const p=first.properties;
   chains.push({type:'Feature',id,properties:{id:reference,feature:p.feature,
    classification:p.classification,highspeed_tag:p.highspeed_tag,rank:p.rank,osm_way_count:members.length},
    geometry:members.length===1?first.geometry:{type:'LineString',coordinates:points}});
   membership.push({id:reference,contentSha256:key.slice(6),ways:members});
  }
 }
 return {features:chains,membership};
}
