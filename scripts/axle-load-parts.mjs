import {axleRows} from './axle-load-csv.mjs';
export function createAxlePartCache({parts={},query,save,now=Date.now,age=28*86400000}){
 return async(key,text,fields=3)=>{
  const previous=parts[key];
  if(previous&&now()-Date.parse(previous.updated)<age)return {...previous,downloaded:0};
  const body=await query(text),rows=axleRows(body,fields);
  // Cache only after the trailing count validates the complete response.
  const value={rows,updated:new Date(now()).toISOString()};parts[key]=value;
  await save(parts);return {...value,downloaded:Buffer.byteLength(body)};
 };
}
