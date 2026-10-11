// One bounded, shared allowlist for reference evidence in any published outcome.
import {readFileSync} from 'node:fs';
import {isIP} from 'node:net';
const schema=JSON.parse(readFileSync(new URL('./frequency-reference-schema.json',import.meta.url),'utf8'));
export function referenceUrlValid(value){
  const grammar=schema.url_grammar;
  if(typeof value!=='string'||/[^\x00-\x7f]/.test(value)||value.length>grammar.max_length)return false;
  const match=new RegExp(`^(?:${grammar.pattern})$`,'iu').exec(value);
  if(!match||match[0]!==value||/%(?![a-fA-F0-9]{2})/.test(value))return false;
  const beforeFragment=value.split('#',1)[0],queryAt=beforeFragment.indexOf('?');
  if(queryAt>=0){
    const query=beforeFragment.slice(queryAt+1),pairs=query?query.split('&'):[];
    if(pairs.length>grammar.max_query_fields||queryAt+1+pairs.reduce((sum,pair)=>sum+Math.max(pair.split('=',1)[0].length,9)+15,0)>grammar.max_length)return false;
  }
  const [,host,port]=match;
  if(port!==undefined&&Number(port)>grammar.max_port)return false;
  if(host.startsWith('['))return isIP(host.slice(1,-1))===6;
  if(host.length>grammar.max_host_length)return false;
  const labels=host.replace(/\.$/,'').split('.');
  if(labels.some(label=>!new RegExp(`^(?:${grammar.label_pattern})$`,'u').test(label)))return false;
  if(new RegExp(`^(?:${grammar.numeric_label_pattern})$`,'u').test(labels.at(-1)))return isIP(host)===4;
  return true;
}
export function referenceDisplayUrl(value){
  const [,host,port]=new RegExp(`^(?:${schema.url_grammar.pattern})$`,'iu').exec(value);
  const split=value.indexOf('://'),scheme=value.slice(0,split).toLowerCase(),rest=value.slice(split+3);
  const boundary=rest.search(/[/?#]/),tail=(boundary<0?'':rest.slice(boundary)).split('#',1)[0],queryAt=tail.indexOf('?');
  const path=queryAt<0?tail:tail.slice(0,queryAt),query=queryAt<0?'':tail.slice(queryAt+1);
  const names=[...new URLSearchParams(query)].map(([name])=>(/^[A-Za-z0-9_.-]{1,80}$/.test(name)?name:'parameter')+'=%5Bredacted%5D');
  return scheme+'://'+host.toLowerCase()+(port===undefined?'':':'+port)+(path||'/')+(names.length?'?'+names.join('&'):'');
}
export const resourceNormalization='http-resource-syntax-v2';
const normalizeResourceComponent=value=>value.replace(/%([a-fA-F0-9]{2})/g,(_,hex)=>{
  const character=String.fromCharCode(parseInt(hex,16));
  return /^[A-Za-z0-9._~-]$/.test(character)?character:'%'+hex.toUpperCase();
});
function removeResourceDotSegments(path){
  const output=[];
  for(const segment of path.split('/')){
    if(segment==='.')continue;
    if(segment==='..'){if(output.length>1)output.pop();}
    else output.push(segment);
  }
  if(path.endsWith('/.')||path.endsWith('/..'))output.push('');
  return output.join('/')||'/';
}
export function referenceResourceKey(value){
  if(!referenceUrlValid(value))return null;
  const match=/^(https?):\/\/(\[[^\]]+\]|[^/:?#@]+)(?::([0-9]+))?([/?][^#]*)?(?:#.*)?$/i.exec(value);
  if(!match)return null;
  const [,rawScheme,rawHost,port,rawTail]=match,tail=rawTail??'',scheme=rawScheme.toLowerCase(),at=tail.indexOf('?');
  const query=at<0?'':tail.slice(at+1),number=Number(port??(scheme==='https'?443:80));
  if(number<1||number>65535)return null;
  let host=rawHost.toLowerCase().replace(/\.$/,''),path=(at<0?tail:tail.slice(0,at))||'/';
  // Parse only an already validated IPv6 literal; never rewrite request bytes.
  if(host.startsWith('['))host=new URL('http://'+host+'/').hostname.slice(1,-1);
  const semi=path.indexOf(';',path.lastIndexOf('/')+1);if(semi===path.length-1&&semi>=0)path=path.slice(0,-1);
  return [scheme,host,number,removeResourceDotSegments(normalizeResourceComponent(path)),normalizeResourceComponent(query)];
}
export function referenceMetadataValid(value,shape='root'){
  let nodes=schema.node_limit,characters=schema.character_limit;
  const check=(value,spec,depth=0)=>{
    if(--nodes<0||depth>schema.depth_limit)return false;
    if(spec.ref)spec=schema.shapes[spec.ref];
    if(value===null&&spec.nullable)return true;
    if(spec.kind==='string'){
      if(typeof value!=='string'||value.length<spec.min||value.length>spec.max||(characters-=value.length)<0)return false;
      if(spec.pattern&&!new RegExp(`^(?:${spec.pattern})$`,'u').test(value))return false;
      if((spec.format==='url'||spec.format==='url_or_empty'&&value!=='')&&!referenceUrlValid(value))return false;
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
  try{return !!check(value,schema.shapes[shape]);}catch{return false;}
}
function projectShape(value,shape='root'){
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
      if((spec.format==='url'||spec.format==='url_or_empty'&&value!=='')&&!referenceUrlValid(value))return missing;
      return value;
    }
    if(spec.kind==='boolean')return typeof value==='boolean'?value:missing;
    if(spec.kind==='integer')return Number.isInteger(value)&&value===spec.value?value:missing;
    return typeof value==='string'&&spec.values.includes(value)?value:missing;
  };
  let safe;try{safe=project(value,schema.shapes[shape]);}catch{safe=missing;}
  return safe===missing?null:safe;
}
function holdMetadata(safe){
  const hold=structuredClone(schema.invalid);
  if(safe&&typeof safe==='object'){
    for(const key of ['specs','declarations','ordinary_static_declarations'])delete hold[key];
    return {...safe,...hold};
  }
  return hold;
}

export function projectReferenceMetadata(value){
  return referenceMetadataValid(value)?value:holdMetadata(projectShape(value));
}
export function referenceLineageValid(row,item){
  if(!item||typeof item!=='object'||Array.isArray(item))return false;
  const kind=item.catalogue,shape=typeof kind==='string'&&Object.hasOwn(schema.lineage.shapes,kind)?schema.lineage.shapes[kind]:null;
  if(!shape||!referenceMetadataValid(item,shape))return false;
  if(kind==='transitous-licence')return item.id===row.filename&&item.id.endsWith('.gtfs.zip')&&!/[\\/]/.test(item.id)&&
    row.delivery==='transitous'&&item.url===row.catalogue_url&&new RegExp(`^(?:${schema.lineage.transitous_origin_pattern})$`,'u').test(item.url);
  if(kind==='mobility-database')return item.url===schema.lineage.mobility_origin;
  return true;
}
export function projectReferenceRow(row){
  if(!Object.hasOwn(row,'source_resolution'))return row;
  const metadata=projectReferenceMetadata(row.source_resolution),result={...row,source_resolution:metadata};
  if(!Object.hasOwn(row,'lineage'))return result;
  const lineage=row.lineage,maximum=schema.lineage.max_records,safe=[];
  let valid=Array.isArray(lineage)&&lineage.length<=maximum;
  if(Array.isArray(lineage))for(const item of lineage.slice(0,maximum)){
    if(referenceLineageValid(row,item))safe.push(item);
    else{valid=false;const record=projectShape(item,'lineage_safe');if(record&&Object.keys(record).length)safe.push(record);}
  }
  result.lineage=safe;
  if(!valid)result.source_resolution=holdMetadata(metadata);
  return result;
}
