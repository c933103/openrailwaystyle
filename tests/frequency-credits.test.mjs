import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeFrequencyCredits} from '../scripts/frequency-credits.mjs';
test('source credit links allow HTTP(S) and render unsafe URL labels as text',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'atlas-credits-'));
 try{
  for(const url of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','file:///tmp/feed','/relative','HTTPS://example.org/feed?q="&x=1']){
   const source={terms_url:url,url,processed_url:url,license:'Credit <name>',feed_info:{},geometry_audit:{}};
   const file=join(temp,'credits.html');
   await writeFrequencyCredits([{id:'safe',name:'Rail',source}],[],{source:{url}},file);
   const html=await readFile(file,'utf8');
   assert.doesNotMatch(html,/href="(?:javascript:|data:|file:|\/relative)/i);
   assert.match(html,/Credit &lt;name&gt;/);
   if(url.startsWith('HTTPS:'))assert.match(html,/href="https:\/\/example.org\/feed\?q=%22&amp;x=1"/);
  }
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('with no timetable applied, the credits describe published headways, not timetables',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'atlas-credits-'));
 try{
  const file=join(temp,'credits.html');
  await writeFrequencyCredits([],[],{source:{url:'https://example.org/headways',name:'Operator headways'},routes:[]},file);
  const html=await readFile(file,'utf8');
  assert.match(html,/published headways/);assert.doesNotMatch(html,/schedule\/reference profiles/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
