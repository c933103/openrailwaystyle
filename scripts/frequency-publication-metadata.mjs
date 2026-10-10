// Publication-only legacy lineage projection. Never an acquisition input.
import {readFileSync} from 'node:fs';
const schema=JSON.parse(readFileSync(new URL('./frequency-publication-lineage-schema.json',import.meta.url),'utf8'));
const strings=new Set(schema.string_fields),scalars=new Set(schema.scalar_fields);
const hashes=new Set([...strings,...scalars].map(key=>key+'_sha256'));
const hash=new RegExp(`^(?:${schema.hash_pattern})$`,'u'),marker=schema.alias_marker;
export function projectLegacyLineage(value,displayUrl,urlStart){
  if(!Array.isArray(value))throw new Error('invalid_publication_lineage_container');
  return value.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('invalid_publication_lineage_record');
    const record={};
    for(const [key,data] of Object.entries(item)){
      if(strings.has(key)){
        if(typeof data!=='string')throw new Error('invalid_publication_lineage_identity');
        if(schema.url_fields.includes(key)&&urlStart(data)&&displayUrl(data)==='[invalid source URL]')throw new Error('invalid_publication_lineage_url');
        record[key]=data;
      }else if(scalars.has(key)){
        if(!(data===null||['string','boolean'].includes(typeof data)||typeof data==='number'&&Number.isFinite(data)))throw new Error('invalid_publication_lineage_authority');
        record[key]=data;
      }else if(hashes.has(key)){
        if(typeof data!=='string'||!hash.test(data))throw new Error('invalid_publication_lineage_hash');
        record[key]=data;
      }
    }
    return record;
  });
}
export function projectLegacyMetadata(value,displayUrl,aliasCompatible,urlStart){
  const result={...value};
  if(Object.hasOwn(result,marker)){
    if(typeof result[marker]!=='boolean')throw new Error('invalid_publication_alias_marker');
    if(result[marker]===true)delete result[marker];
  }
  if((Object.hasOwn(value,'lineage')||value.delivery==='direct')&&!Object.hasOwn(value,'source_resolution')){
    if(Object.hasOwn(value,'lineage'))result.lineage=projectLegacyLineage(value.lineage,displayUrl,urlStart);
    if(value[marker]===false||!aliasCompatible(value))result[marker]=false;
  }
  if(Object.hasOwn(value,'catalogue_lineage'))result.catalogue_lineage=projectLegacyLineage(value.catalogue_lineage,displayUrl,urlStart);
  return result;
}
