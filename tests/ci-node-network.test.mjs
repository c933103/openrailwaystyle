import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('the separate live station-search probe rejects redirects before following them',async()=>{
  const source=(await readFile(new URL('../scripts/check-search-api.mjs',import.meta.url),'utf8')).replace(/^import .*;$/m,'');
  const calls=[];
  const run=new vm.Script('(async()=>{'+source+'})()');
  await run.runInNewContext({URL,AbortSignal,SEARCH_API:'https://search.invalid/v2/facility',console:{log(){}},
    fetch:async(url,options)=>{
      calls.push({url:new URL(url),options});
      assert.equal(options.redirect,'error');
      return {ok:true,headers:new Map([['access-control-allow-origin','*']]),json:async()=>[{latitude:51,longitude:0,name:'Synthetic station'}]};
    },
  });
  assert.equal(calls.length,1);assert.equal(calls[0].url.searchParams.get('q'),'London');
  assert.equal(calls[0].url.searchParams.get('limit'),'1');
});
test('deployed tile-byte verification retains real first-party fetch and rejects redirects',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/site.yml',import.meta.url),'utf8');
  const check=workflow.split('- name: Verify deployed vector tile bytes')[1].split('- uses: actions/checkout@v4')[0];
  assert.match(check,/process\.env\.PAGE_URL/);
  assert.match(check,/fetch\(base\+key\+'\.pbf\.gz',\{redirect:'error',headers:/);
  assert.match(check,/assert\.equal\(response\.status,200\)/);
  assert.match(check,/assert\.deepEqual\(decode\(Buffer\.from\(await response\.arrayBuffer\(\)\)\),expected\)/);
});
