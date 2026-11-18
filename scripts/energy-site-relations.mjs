import {readElements} from './extract-elements.mjs';
import {osmiumSubset} from './build-extract-station-points.mjs';
import {shapeRelations} from './build-extract-power-facilities.mjs';
// Preserve site-member geometry without inventing an enclosing polygon. getid's
// --add-referenced subset includes nested relations and their untagged members.
export async function shapeEnergyRelations(pbf,relations,{read=readElements,subset=osmiumSubset}={}) {
 const sites=relations.filter(e=>e.tags?.type==='site');
 const ordinary=await shapeRelations(pbf,relations.filter(e=>e.tags?.type!=='site'),{read,subset});
 if(!sites.length)return ordinary;
 const records=new Map(sites.map(e=>[`relation/${e.id}`,e]));
 const selected=await subset(pbf,sites.map(e=>`r${e.id}`));
 let counts;
 try {counts=await read(selected.file,{untaggedNodes:true,keep:()=>true,onElement:e=>records.set(`${e.type}/${e.id}`,e)});}
 finally {await selected.remove();}
 const resolve=(element,path=new Set())=>{
  if(element.type!=='relation')return element;
  const key=`relation/${element.id}`;
  if(path.has(key))throw new Error(`Cyclic energy site ${key}`);
  const next=new Set(path).add(key);
  const members=(element.members||[]).map(member=>{
   const target=records.get(`${member.type}/${member.ref}`);
   if(!target)throw new Error(`Missing energy site member ${member.type}/${member.ref}`);
   return {...resolve(target,next),ref:member.ref,role:member.role};
  });
  return {...element,members};
 };
 return {relations:[...ordinary.relations,...sites.map(e=>resolve(records.get(`relation/${e.id}`)))],counts:{...ordinary.counts,memberWaysWithoutGeometry:ordinary.counts.memberWaysWithoutGeometry+(counts.withoutGeometry||0)}};
}
