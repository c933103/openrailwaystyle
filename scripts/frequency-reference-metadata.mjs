// One bounded, shared allowlist for reference evidence in any published outcome.
import {readFileSync} from 'node:fs';
const schema=JSON.parse(readFileSync(new URL('./frequency-reference-schema.json',import.meta.url),'utf8'));
export function referenceMetadataValid(value){
  let nodes=schema.node_limit,characters=schema.character_limit;
  const check=(value,spec,depth=0)=>{
    if(--nodes<0||depth>schema.depth_limit)return false;
    if(spec.ref)spec=schema.shapes[spec.ref];
    if(value===null&&spec.nullable)return true;
    if(spec.kind==='string'){
      if(typeof value!=='string'||value.length<spec.min||value.length>spec.max||(characters-=value.length)<0)return false;
      if(spec.pattern&&!new RegExp(`^(?:${spec.pattern})$`,'u').test(value))return false;
      if(spec.format==='url'){try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||!url.hostname)return false;}catch{return false;}}
      return true;
    }
    if(spec.kind==='boolean')return typeof value==='boolean';
    if(spec.kind==='integer')return Number.isInteger(value)&&value===spec.value;
    if(spec.kind==='enum')return typeof value==='string'&&spec.values.includes(value);
    if(spec.kind==='array')return Array.isArray(value)&&value.length<=spec.max&&Array.from({length:value.length},(_,i)=>i).every(i=>Object.hasOwn(value,i)&&check(value[i],spec.item,depth+1));
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    if(spec.required.some(key=>!Object.hasOwn(value,key)))return false;
    let keys=0;
    for(const key in value){
      if(!Object.hasOwn(value,key))continue;
      if(++keys>2*Object.keys(spec.fields).length)return false;
      const item=value[key];
      let field=Object.hasOwn(spec.fields,key)?spec.fields[key]:null;
      if(!field&&key.endsWith('_sha256')&&Object.hasOwn(spec.fields,key.slice(0,-7))&&spec.fields[key.slice(0,-7)].kind==='string')field={kind:'string',min:64,max:64,pattern:'[a-f0-9]{64}'};
      if(!field||!check(item,field,depth+1))return false;
    }
    return true;
  };
  try{return !!check(value,schema.shapes.root);}catch{return false;}
}
export function projectReferenceMetadata(value){
  if(referenceMetadataValid(value))return value;
  const missing=Symbol('missing');let nodes=schema.node_limit,characters=schema.character_limit;
  const project=(value,spec,depth=0)=>{
    if(--nodes<0||depth>schema.depth_limit)return missing;
    if(spec.ref)spec=schema.shapes[spec.ref];
    if(value===null&&spec.nullable)return null;
    if(spec.kind==='object'){
      if(!value||typeof value!=='object'||Array.isArray(value))return missing;
      const result={};
      for(const [key,field] of Object.entries(spec.fields)){
        if(Object.hasOwn(value,key)){const item=project(value[key],field,depth+1);if(item!==missing)result[key]=item;}
        const hashKey=key+'_sha256';
        if(field.kind==='string'&&!Object.hasOwn(spec.fields,hashKey)&&Object.hasOwn(value,hashKey)){
          const item=project(value[hashKey],{kind:'string',min:64,max:64,pattern:'[a-f0-9]{64}'},depth+1);if(item!==missing)result[hashKey]=item;
        }
      }
      return spec.required.every(key=>Object.hasOwn(result,key))?result:missing;
    }
    if(spec.kind==='array'){
      if(!Array.isArray(value))return missing;
      const result=[];
      for(let i=0;i<Math.min(value.length,spec.max);i++){if(!Object.hasOwn(value,i))continue;const item=project(value[i],spec.item,depth+1);if(item!==missing)result.push(item);}
      return result;
    }
    if(spec.kind==='string'){
      if(typeof value!=='string'||value.length<spec.min||value.length>spec.max||(characters-=value.length)<0)return missing;
      if(spec.pattern&&!new RegExp(`^(?:${spec.pattern})$`,'u').test(value))return missing;
      if(spec.format==='url'){try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||!url.hostname)return missing;}catch{return missing;}}
      return value;
    }
    if(spec.kind==='boolean')return typeof value==='boolean'?value:missing;
    if(spec.kind==='integer')return Number.isInteger(value)&&value===spec.value?value:missing;
    return typeof value==='string'&&spec.values.includes(value)?value:missing;
  };
  let safe;try{safe=project(value,schema.shapes.root);}catch{safe=missing;}
  const hold=structuredClone(schema.invalid);
  if(safe&&typeof safe==='object'&&safe!==missing){
    for(const key of ['specs','declarations','ordinary_static_declarations'])delete hold[key];
    return {...safe,...hold};
  }
  return hold;
}
