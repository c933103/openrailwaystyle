// Read a national feed without converting its entire gzip payload into a
// JavaScript string. Top-level array records are decoded independently.
import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';

export async function parseFrequencyFeed(chunks) {
  const result={};
  let depth=0,quoted=false,escaped=false,started=false,ended=false;
  let parts=[],array=null,afterArray=false,itemRequired=false,fieldRequired=false;
  const value=()=>{const text=parts.join('').trim();parts=[];return text;};
  const item=()=>{const text=value();if(text)result[array].push(JSON.parse(text));return !!text;};
  const field=required=>{
    const text=value();
    if(afterArray){if(text)throw new Error('Unexpected text after feed array');afterArray=false;return;}
    if(!text){if(fieldRequired||required)throw new Error('Missing feed field');return;}
    const record=JSON.parse('{'+text+'}');
    if(Object.keys(record).length!==1)throw new Error('Invalid feed field');
    for(const [key,data] of Object.entries(record)){
      if(Object.hasOwn(result,key))throw new Error('Duplicate feed field');
      result[key]=data;
    }
  };
  for await(const chunk of chunks){
    let start=0;
    for(let i=0;i<chunk.length;i++){
      const c=chunk[i];
      if(ended){if(c.trim())throw new Error('Trailing feed data');start=i+1;continue;}
      if(!started){
        if(!c.trim()){start=i+1;continue;}
        if(c!=='{')throw new Error('Feed must be an object');
        started=true;depth=1;start=i+1;continue;
      }
      if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"'){quoted=true;continue;}
      if(c==='['&&depth===1){
        parts.push(chunk.slice(start,i));
        const prefix=value(),match=prefix.match(/^"([^"\\]+)"\s*:\s*$/);
        if(!match||Object.hasOwn(result,match[1]))throw new Error('Invalid feed array field');
        array=match[1];result[array]=[];itemRequired=false;fieldRequired=false;depth++;start=i+1;continue;
      }
      if(array&&depth===2&&(c===','||c===']')){
        parts.push(chunk.slice(start,i));const present=item();start=i+1;
        if(!present&&(c===','||itemRequired))throw new Error('Missing feed array item');
        itemRequired=c===',';
        if(c===']'){array=null;afterArray=true;depth--;}
        continue;
      }
      if(depth===1&&(c===','||c==='}')){
        parts.push(chunk.slice(start,i));field(c===',');start=i+1;
        if(c==='}'){depth--;ended=true;}else fieldRequired=true;
        continue;
      }
      if(c==='{'||c==='[')depth++;
      else if(c==='}'||c===']')depth--;
      if(depth<1)throw new Error('Invalid feed nesting');
    }
    parts.push(chunk.slice(start));
  }
  if(!ended||quoted||array||depth!==0)throw new Error('Truncated frequency feed');
  return result;
}

export async function readFrequencyFeed(file) {
  const input=createReadStream(file),decoded=input.pipe(createGunzip());
  input.on('error',error=>decoded.destroy(error));
  decoded.setEncoding('utf8');
  try{return await parseFrequencyFeed(decoded);}
  finally{input.destroy();decoded.destroy();}
}
