import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeFrequencyCredits} from '../scripts/frequency-credits.mjs';
import {createExpression} from '@maplibre/maplibre-gl-style-spec';
import {frequencyAvailability,frequencyBundle,serviceFrequencyPaint} from '../styles/service-frequency.mjs';
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
  assert.match(html,/No current timetable sections matched this OSM snapshot\./);
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('assembled timetable credits describe the profiles and applied sources',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'atlas-credits-'));
 try{
  const file=join(temp,'credits.html');
  const source={attribution:'Fixture railway',license:'Fixture terms',terms_url:'https://example.org/terms',url:'https://example.org/feed',feed_info:{}};
  await writeFrequencyCredits([{name:'Fixture timetable',mappedRoutes:2,routesWithProfiles:1,source}],[],{source:{name:'Operator headways'}},file);
  const html=await readFile(file,'utf8');
  assert.match(html,/dated weekday schedule\/reference profiles/);
  assert.match(html,/2 mapped routes; 1 with available profiles at assembly/);
  assert.match(html,/href="data\/service-routes\/frequency-manifest\.json"/);
  assert.doesNotMatch(html,/No current timetable sections matched|Timetable feeds are not applied|not yet matched/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('checked-in fallback explains the matching mechanism without claiming an assembled result',async()=>{
 const html=await readFile(new URL('../styles/frequency-credits.html',import.meta.url),'utf8');
 assert.match(html,/Coverage is partial\./);
 assert.match(html,/current timetable counts matched to OpenStreetMap service sections/);
 assert.match(html,/audited whole-route headways where available/);
 assert.match(html,/not live departures or a guarantee of service/);
 assert.match(html,/Sections without a current matched frequency profile are subdued/);
 assert.match(html,/independently available departure board/);
 assert.match(html,/fallback page has not been regenerated from an assembled frequency snapshot/);
 assert.match(html,/Applied timetable sources, current profile availability and coverage are unknown here/);
 assert.match(html,/This is not evidence of no matching timetable or no service/);
 assert.doesNotMatch(html,/Timetable feeds are not applied|not yet matched|so none is applied|No current timetable sections matched this OSM snapshot/);
 // Preserve the audited reference source and its date, without asserting it is current.
 assert.match(html,/https:\/\/www\.mtr\.com\.hk\/en\/customer\/services\/train_service_index\.html/);
 assert.match(html,/checked 2026-10-03/);
 assert.match(html,/Seventeen audited whole-route profiles on OSM geometry/);
});
test('fallback and documentation distinguish subdued measured zero from missing frequency evidence',async()=>{
 const now=Date.parse('2026-10-16T00:00:00Z');
 const paint=serviceFrequencyPaint({serviceWidth:'frequency',frequencyPeriod:'peak',peakPhase:'am'},now);
 const evaluate=(expression,properties)=>{
  const result=createExpression(expression);
  assert.equal(result.result,'success');
  return result.value.evaluate({zoom:12},{type:2,properties});
 };
 for(const [rate,expiry,status,width,opacity] of [[0,1,'available',1.5,.35],[6,1,'available',3,1],[null,1,'unknown',3.5,.45],[0,-1,'expired',3.5,.45]]){
  const timetable={properties:{frequency_until:now/1000+expiry},profiles:rate===null?{}:{am:{rate,quality:'scheduled'}}};
  const properties=frequencyBundle([{ref:'fixture',kind:'subway'}],[[[0,0],[1,1]]],null,[timetable],now)[0];
  const availability=frequencyAvailability(properties,'am',now);
  assert.equal(availability.status,status);
  assert.equal(evaluate(paint.width,properties),width);
  assert.equal(evaluate(paint.opacity,properties),opacity);
  if(rate===0&&expiry>0)assert.match(availability.text,/^0\/h\/direction/);
 }
 for(const path of ['styles/frequency-credits.html','docs/service-frequency.md']){
  const text=(await readFile(new URL('../'+path,import.meta.url),'utf8')).replace(/\s+/g,' ');
  assert.match(text,/Sections without a current matched frequency profile are subdued/);
  assert.match(text,/A measured zero remains an available profile and is drawn as a thin, subdued line; unknown is not zero/);
  assert.doesNotMatch(text,/A subdued line (?:has|means)/);
 }
});
