import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Execute the actual checker with a supplied fetch. This context has no module
// loading or real fetch, so neither success nor failure cases contact a provider.
const source=(await readFile(new URL('../scripts/check-search-api.mjs',import.meta.url),'utf8'))
  .replace(/^import .*;$/m,'');
const checker=new vm.Script('(async()=>{'+source+'})()');
const station={latitude:51.5,longitude:-0.1,name:'Synthetic station'};
const run=async({status=200,origin='*',rows=[station],error}={})=>{
  const calls=[];
  const result=checker.runInNewContext({URL,AbortSignal,SEARCH_API:'https://station-fixture.invalid/v2/facility',
    console:{log(){}},fetch:async(url,options)=>{
      calls.push({url:new URL(url),options});
      assert.equal(options.redirect,'error','redirects must be rejected before following them');
      if(error)throw error;
      return new Response(JSON.stringify(rows),{status,headers:origin===null?{}:{'access-control-allow-origin':origin}});
    },
  });
  await result;
  assert.equal(calls.length,1);
  assert.equal(calls[0].url.origin,'https://station-fixture.invalid');
  assert.equal(calls[0].url.searchParams.get('q'),'London');
  assert.equal(calls[0].url.searchParams.get('limit'),'1');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  return calls;
};

test('actual station checker accepts wildcard and exact Pages-origin CORS fixtures',async()=>{
  for(const origin of ['*','https://c933103.github.io'])await run({origin});
});
test('actual station checker rejects HTTP failure and wrong or missing CORS',async()=>{
  await assert.rejects(run({status:503}),/Station API HTTP 503/);
  for(const origin of ['https://other.invalid',null])await assert.rejects(run({origin}),/does not allow the Pages origin/);
});
test('actual station checker rejects empty or malformed results and invalid coordinates',async()=>{
  for(const rows of [[],{},null])await assert.rejects(run({rows}),/returned no search result/);
  for(const rows of [[{...station,latitude:'51.5'}],[{...station,longitude:null}]]){
    await assert.rejects(run({rows}),/returned invalid coordinates/);
  }
});
test('actual station checker preserves transport and redirect failures',async()=>{
  for(const message of ['synthetic connection failure','synthetic redirect rejected']){
    await assert.rejects(run({error:new TypeError(message)}),new RegExp(message));
  }
});
