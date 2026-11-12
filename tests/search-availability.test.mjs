import test from 'node:test';
import assert from 'node:assert/strict';
import {searchHarness,flush,station,place,response} from './helpers/search-ui-harness.mjs';

const facility=url=>url.pathname.endsWith('/facility');
const noMatches='No matching facility or place found. Try a local name or railway code.';
const unavailable='Search is unavailable. Try again, or browse by panning and zooming.';
const local={type:'Feature',geometry:{type:'Point',coordinates:[-.1,51.5]},properties:{id:'node-9003',name:'Synthetic local station',feature:'station'}};
const aborted=signal=>new Promise((_,reject)=>{if(signal.aborted)reject(new Error('aborted'));else signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});

for(const failed of ['station','place'])for(const kind of ['HTTP','transport','JSON','envelope'])test(`search partial-empty stays incomplete after ${failed} ${kind} failure`,async()=>{
 const h=searchHarness({fetcher:async url=>{
  if(facility(url)!==(failed==='station'))return response();
  if(kind==='HTTP')return response([],503);
  if(kind==='transport')throw new TypeError('synthetic network failure');
  if(kind==='JSON')return {ok:true,status:200,json:async()=>{throw new SyntaxError('synthetic JSON failure');}};
  return response({results:[]});
 }});
 try{await h.submit();assert.match(h.status(),/Search incomplete/);assert.match(h.status(),new RegExp(`${failed} search unavailable`));assert.match(h.status(),/No matches from the available sources/);assert.doesNotMatch(h.status(),/No matching facility or place found/);assert.equal(h.results().hidden,true);assert.equal(h.calls.length,2);}finally{h.close();}
});
for(const failed of ['station','place'])test(`search keeps healthy rows and their incomplete status after ${failed} failure`,async()=>{
 const h=searchHarness({fetcher:async url=>facility(url)===(failed==='station')?response([],503):response(facility(url)?[station]:[place])});
 try{await h.submit();assert.equal(h.results().hidden,false);assert.match(h.results().textContent,/Synthetic/);assert.match(h.status(),/Search incomplete/);assert.match(h.status(),new RegExp(`${failed} search unavailable`));assert.match(h.status(),failed==='station'?/0 railway results, 1 place/:/1 railway result, 0 places/);}finally{h.close();}
});
test('search keeps complete-empty distinct from all-failed and from complete results',async()=>{
 for(const [fetcher,status,hidden] of [[async()=>response(),noMatches,true],[async()=>response([],503),unavailable,true],[async url=>response(facility(url)?[station]:[place]),'1 railway result, 1 place',false]]){
  const h=searchHarness({fetcher});try{await h.submit();assert.equal(h.status(),status);assert.equal(h.results().hidden,hidden);assert.equal(h.calls.length,2);}finally{h.close();}
 }
});
test('search retains drawn station fallback and marks both remote sources unavailable',async()=>{
 const h=searchHarness({local:[local],fetcher:async()=>response([],503)});
 try{await h.submit();assert.equal(h.results().hidden,false);assert.match(h.results().textContent,/Synthetic local station/);assert.match(h.status(),/1 railway result, 0 places/);assert.match(h.status(),/Search incomplete: station search and place search unavailable/);}finally{h.close();}
});
test('search source timeout is incomplete while both timed-out sources are unavailable',async()=>{
 for(const both of [false,true]){
  const h=searchHarness({fetcher:async(url,{signal})=>both||facility(url)?aborted(signal):response()});
  try{const result=h.submit();await flush();await h.advance(both?8000:5000);await result;assert.match(h.status(),both?/^Search is unavailable/:/Search incomplete: station search unavailable/);}finally{h.close();}
 }
});
test('search rate-limit cooldown is incomplete, bounded and resumes after ten minutes',async()=>{
 let rateLimited=true;
 const h=searchHarness({fetcher:async url=>response([],facility(url)&&rateLimited?429:200)});
 try{await h.submit();assert.match(h.status(),/Search incomplete/);rateLimited=false;await h.submit();assert.match(h.status(),/Search incomplete: station search unavailable/);assert.equal(h.calls.filter(c=>facility(c.url)).length,1);assert.equal(h.calls.filter(c=>!facility(c.url)).length,1,'valid empty place response is cached');await h.advance(600_000);await h.submit();assert.equal(h.status(),noMatches);assert.equal(h.calls.filter(c=>facility(c.url)).length,2);}finally{h.close();}
});
test('search caches only successful place responses with the language in the key',async()=>{
 let failPlaces=true;
 const h=searchHarness({language:'en',fetcher:async url=>response(facility(url)?[]:[{...place,name:url.searchParams.get('accept-language')||'local'}],!facility(url)&&failPlaces?503:200)});
 try{await h.submit();assert.match(h.status(),/Search incomplete/);failPlaces=false;await h.advance(1000);await h.submit();assert.equal(h.status(),'0 railway results, 1 place');assert.match(h.results().textContent,/en/);await h.submit();assert.equal(h.calls.filter(c=>!facility(c.url)).length,2,'failure is not cached; healthy repetition is');h.settings.language='fr';await h.advance(1000);await h.submit();assert.match(h.results().textContent,/fr/);h.settings.language='en';await h.submit();assert.match(h.results().textContent,/en/);assert.deepEqual(h.calls.filter(c=>!facility(c.url)).map(c=>c.url.searchParams.get('accept-language')),['en','en','fr']);assert.equal(h.calls.filter(c=>facility(c.url)).length,5,'facility behavior remains on-demand');}finally{h.close();}
});
test('search replacement suppresses late old results and status even when fetch ignores abort',async()=>{
 let release;
 const pending=new Promise(resolve=>{release=resolve;});
 const h=searchHarness({fetcher:async url=>url.searchParams.get('q')==='Older'?pending:response(facility(url)?[station]:[])});
 try{const old=h.submit('Older');await flush();const latest=h.submit('Latest');await h.advance(1000);await latest;assert.equal(h.status(),'1 railway result, 0 places');release(response([],503));await old;assert.equal(h.status(),'1 railway result, 0 places');assert.match(h.results().textContent,/Synthetic station/);assert.ok(h.calls.filter(c=>c.url.searchParams.get('q')==='Older').every(c=>c.options.signal.aborted));}finally{h.close();}
});
test('search replaced while queued does not consume a geocoder request or overwrite the latest status',async()=>{
 const h=searchHarness();
 try{await h.submit('First');const old=h.submit('Queued');await flush();const latest=h.submit('Latest');await h.advance(1000);await Promise.all([old,latest]);assert.equal(h.status(),noMatches);assert.deepEqual(h.calls.filter(c=>!facility(c.url)).map(c=>c.url.searchParams.get('q')),['First','Latest']);}finally{h.close();}
});
