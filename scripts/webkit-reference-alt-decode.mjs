// Diagnostic-only alternative for a verified local archive. Not bundled in Atlas.
import {gunzipSync} from 'fflate';
export function decodeReferenceForDiagnostic(data,maxBytes){
 const input=new Uint8Array(data);
 if(input.byteLength<18)throw Error('Truncated diagnostic gzip member');
 const size=new DataView(data).getUint32(data.byteLength-4,true);
 if(size<1||size>maxBytes)throw Error('Invalid diagnostic gzip output length');
 const output=gunzipSync(input);
 if(output.byteLength!==size)throw Error('Unexpected diagnostic gzip output length');
 return output;
}
