// Loopback WebKit diagnostics only. Keep the same native transform and bounded output consumer in each arm.
export const makeNativeDecoder=({decoder,logControl=()=>{}})=>async (data,maxBytes)=>{
 const fixed=decoder==='native-chunked', bytes=new Uint8Array(data);
 const observe=stage=>logControl(stage,bytes.byteLength);
 let offset=0;
 const input=fixed?new ReadableStream({
  pull(controller){
   if(offset===bytes.length){controller.close();return;}
   const end=Math.min(offset+65536,bytes.length);
   controller.enqueue(bytes.subarray(offset,end));offset=end;
  }
 }):new Blob([data]).stream();
 const streamReader=input.pipeThrough(new DecompressionStream('gzip')).getReader();
 const chunks=[];let size=0;
 try{
  while(true){
   const {done,value}=await streamReader.read();
   if(done){observe('NATIVE_OUTPUT_EOF');break;}
   if(chunks.length===0)observe('NATIVE_FIRST_OUTPUT');
   size+=value.byteLength;
   if(size>maxBytes){await streamReader.cancel();throw Error('Oversized decoded OSM reference tile');}
   chunks.push(value);
  }
 }finally{streamReader.releaseLock();}
 const result=new Uint8Array(size);
 let outputOffset=0;
 for(const c of chunks){result.set(c,outputOffset);outputOffset+=c.byteLength;}
 observe('NATIVE_OUTPUT_COMPLETE');
 return result.buffer;
};
