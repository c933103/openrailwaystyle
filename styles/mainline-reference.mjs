// This reader accepts only a verified Atlas generation. An absent index,
// unavailable tile or corrupt payload is an ERROR, never an empty railway.
const MAX_INDEX=5461,MAX_COMPRESSED=2*1024**2,MAX_DECODED=8*1024**2;
const generationRE=/^[a-f0-9]{24}$/;
const hashRE=/^[a-f0-9]{64}$/;
export function referenceTileKey(value){
 if(typeof value!=='string'||! /^(0|[1-6])\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/.test(value))return null;
 const [z,x,y]=value.split('/').map(Number);return x<2**z&&y<2**z?value:null;
}
export function validateReferenceManifest(m){
 if(!m||m.schema!==1||m.complete!==true||!generationRE.test(m.generation)||
   m.minzoom!==0||m.maxzoom!==6||m.license!=='ODbL-1.0'||
   !Number.isSafeInteger(m.wayCount)||m.wayCount<1||!hashRE.test(m.indexSha256)||
   !Number.isFinite(Date.parse(m.oldestSource))||!Number.isFinite(Date.parse(m.newestSource))||
   !Array.isArray(m.sources)||m.sources.length!==8)throw Error('OSM reference snapshot missing or incomplete');
 return m;
}
export function validateReferenceIndex(index,manifest){
 if(!index||index.schema!==1||index.complete!==true||index.generation!==manifest.generation||
   !Array.isArray(index.tiles)||index.tiles.length<1||index.tiles.length>MAX_INDEX)
   throw Error('OSM reference index missing or incomplete');
 const entries=new Map();
 for(const t of index.tiles){
  if(!t||!referenceTileKey(t.key)||entries.has(t.key)||!hashRE.test(t.sha256)||
    !Number.isSafeInteger(t.bytes)||t.bytes<1||t.bytes>MAX_COMPRESSED)throw Error('Invalid OSM reference tile index');
  entries.set(t.key,t);
 }
 if(!entries.has('0/0/0'))throw Error('OSM reference has no world tile');
 return entries;
}
async function digest(bytes){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function decompressReference(data,maxBytes=MAX_DECODED){
 const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
 const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>maxBytes){await reader.cancel();throw Error('Oversized decoded OSM reference tile')}chunks.push(value)}}
 finally{reader.releaseLock()}
 const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.byteLength}return result.buffer;
}
export function createReferenceReader({root,fetcher=fetch,decompress=decompressReference,timeout=15000,maxCacheBytes=16*1024**2}){
 if(typeof decompress!=='function')throw Error('Missing bounded reference decompressor');
 const base=new URL(root),cache=new Map(),pending=new Map();let metadata,cachedBytes=0;
 async function read(path,maxBytes){
  const response=await fetcher(new URL(path,base),{redirect:'error',signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw Error(`OSM reference asset unavailable (HTTP ${response.status})`);
  const declared=Number(response.headers.get('content-length'));
  if(declared>maxBytes)throw Error('Oversized OSM reference response');
  const chunks=[];let size=0;
  if(response.body){const reader=response.body.getReader();try{while(true){
   const {done,value:chunk}=await reader.read();if(done)break;
   size+=chunk.byteLength;if(size>maxBytes){await reader.cancel();throw Error('Oversized OSM reference response')}
   chunks.push(chunk);
  }}finally{reader.releaseLock()}}
  else{const bytes=new Uint8Array(await response.arrayBuffer());size=bytes.byteLength;chunks.push(bytes)}
  if(size>maxBytes)throw Error('Oversized OSM reference response');
  const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.byteLength}return result;
 }
 async function loadMetadata(){
  const m=validateReferenceManifest(JSON.parse(new TextDecoder().decode(await read('manifest.json',256*1024))));
  const bytes=await read(`generations/${m.generation}/index.json`,1024*1024);
  if(await digest(bytes)!==m.indexSha256)throw Error('Changed OSM reference index');
  return {manifest:m,index:validateReferenceIndex(JSON.parse(new TextDecoder().decode(bytes)),m)};
 }
 return {async tile(key,signal){
  if(!referenceTileKey(key))throw Error('Invalid OSM reference tile coordinate');
  signal?.throwIfAborted();
  metadata ||= loadMetadata().catch(error=>{metadata=undefined;throw error});
  const {manifest,index}=await metadata,entry=index.get(key);
  if(!entry)return new ArrayBuffer(0); // Verified absence in complete generation only.
  if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value.slice(0)}
  if(!pending.has(key))pending.set(key,(async()=>{
   const zipped=await read(`generations/${manifest.generation}/${key}.pbf.gz`,MAX_COMPRESSED);
   if(zipped.byteLength!==entry.bytes||await digest(zipped)!==entry.sha256)throw Error('Changed or truncated OSM reference tile');
   const raw=await decompress(zipped.buffer,MAX_DECODED);
   const data=raw instanceof ArrayBuffer?raw:raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
   if(data.byteLength>MAX_DECODED||!data.byteLength)throw Error('Invalid decoded OSM reference tile');
   cache.set(key,data);cachedBytes+=data.byteLength;
   while(cachedBytes>maxCacheBytes&&cache.size){const oldest=cache.keys().next().value;cachedBytes-=cache.get(oldest).byteLength;cache.delete(oldest)}
   return data;
  })().finally(()=>pending.delete(key)));
  const data=await pending.get(key);signal?.throwIfAborted();return data.slice(0);
 },async manifest(){metadata ||= loadMetadata().catch(error=>{metadata=undefined;throw error});return (await metadata).manifest}};
}
