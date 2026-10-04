import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {parseFrequencyFeed,readFrequencyFeed} from '../scripts/read-frequency-feed.mjs';

test('streamed national feeds preserve nested records, escapes and Unicode across chunk boundaries',async()=>{
  const feed={schema:1,source:{id:'日本',note:'quoted "text", braces } ] and slash \\',metadata:[{name:'Å'}]},agencies:[],segments:[{geometry:[[1,2],[3,4]],profiles:{am:{display_tph:0}},label:'駅'},null,3,'x,y'],unmapped_stops:[],trailing:true};
  const text=JSON.stringify(feed)+'\n';
  for(const size of [1,2,7,64,65536]){
    async function* chunks(){for(let i=0;i<text.length;i+=size)yield text.slice(i,i+size);}
    assert.deepEqual(await parseFrequencyFeed(chunks()),feed);
  }
});

test('gzip feed reader decodes array records without retaining one whole JSON string',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'atlas-stream-feed-'));
  try{
    const feed={source:{id:'global'},segments:Array.from({length:2000},(_,i)=>({route_id:String(i),geometry:[[i/1000,1],[i/1000,2]]})),profiles:{am:{start:'07:00:00'}}};
    const file=join(dir,'feed.json.gz');await writeFile(file,gzipSync(JSON.stringify(feed)));
    assert.deepEqual(await readFrequencyFeed(file),feed);
    await writeFile(file,Buffer.from('broken'));
    await assert.rejects(readFrequencyFeed(file));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('streamed reader rejects truncated feeds, duplicate fields and trailing content',async()=>{
  for(const text of ['{"segments":[{"x":1}','{"x":1,"x":2}','{"segments":[],"segments":[]}','{"segments":[1,,2]}','{"segments":[1,]}','{"segments":[],}','{,"x":1}','{}oops','[]']){
    await assert.rejects(parseFrequencyFeed([text]));
  }
});
