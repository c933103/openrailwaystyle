import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatePublicOrm} from '../scripts/browser.mjs';

function fakeContext() {
  const context={route:async(match,handler)=>{context.match=match;context.handler=handler;}};
  return context;
}

test('configured local ORM guard rejects redirects from advertised loopback tile URLs',async()=>{
  const context=fakeContext(),warnings=[];
  await isolatePublicOrm(context,{mirror:'http://127.0.0.1:4174/root/',warn:text=>warnings.push(text)});
  const tile='http://localhost:4175/tiles/14/1/2.pbf';
  assert.equal(context.match(new URL(tile)),true,'advertised loopback tiles must enter the guard');
  assert.equal(context.match(new URL('https://tiles.example/14/1/2.pbf')),false);

  let navigationFallback=false,navigationFetches=0;
  await context.handler({
    request:()=>({url:()=> 'http://127.0.0.1:4173/',isNavigationRequest:()=>true}),
    fallback:async()=>{navigationFallback=true;},
    fetch:async()=>{navigationFetches++;throw Error('navigation must not be refetched');},
  });
  assert.equal(navigationFallback,true,'first-party navigation remains untouched');
  assert.equal(navigationFetches,0);

  let fetched,fulfilled=false,aborted;
  await context.handler({
    request:()=>({url:()=>tile,isNavigationRequest:()=>false}),
    fetch:async options=>(fetched=options,{status:()=>302}),
    fulfill:async()=>{fulfilled=true;},
    abort:async reason=>{aborted=reason;},
  });
  assert.deepEqual(fetched,{url:tile,maxRedirects:0});
  assert.equal(fulfilled,false,'a redirect must never be exposed to Chromium');
  assert.equal(aborted,'failed');
  assert.match(warnings.at(-1),/redirected/i);
});
