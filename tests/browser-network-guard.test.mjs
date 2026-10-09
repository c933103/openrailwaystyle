import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {browserNetworkAllowed, firstPartyBases, guardBrowserNetwork} from '../scripts/browser-network-guard.mjs';
import {GROUPS} from '../scripts/ci-plan.mjs';

function owner() {
  const routes=[];
  return {routes,route:async(match,handler)=>routes.push({match,handler}),unroute:async(match,handler)=>{
    const i=routes.findIndex(row=>row.match===match&&(!handler||row.handler===handler));if(i>=0)routes.splice(i,1);
  }};
}
async function harness() {
  const context=owner(),page=owner(),blocked=[];
  context.pages=()=>[];context.on=(event,handler)=>{context[event]=handler;};
  context.routeWebSocket=async(match,handler)=>{context.socket=handler;};
  await guardBrowserNetwork(context,{bases:['https://deployed.example/atlas/'],blocked});
  context.page(page);
  return {context,page,blocked};
}
function route(url,{status=200}={}) {
  const calls={fetch:[],continue:0,fulfill:[],abort:[],fallback:0};
  const response={status:()=>status,headers:()=>({'content-type':'text/javascript','content-encoding':'gzip','content-length':'999'}),body:async()=>Buffer.from('actual deployed bytes')};
  return {calls,response,value:{request:()=>({url:()=>url}),
    fetch:async options=>{calls.fetch.push(options);return response;},
    continue:async()=>{calls.continue++;},fulfill:async options=>{calls.fulfill.push(options);},
    abort:async reason=>{calls.abort.push(reason);},fallback:async()=>{calls.fallback++;},
  }};
}
test('only loopback and an exact first-party deployment path may reach the network',()=>{
  const bases=['https://deployed.example/atlas/'];
  for(const url of ['http://127.0.0.1:4173/app.mjs','http://localhost:4174/tiles','http://[::1]:4173/test','https://deployed.example/atlas/vendor/maplibre.js'])assert.ok(browserNetworkAllowed(url,bases),url);
  for(const url of ['https://openrailwaymap.app/tiles','https://tuiles.enliberte.fr/planet.pmtiles','https://deployed.example/atlas-evil/app.mjs','https://deployed.example/elsewhere','https://deployed.example.evil/atlas/app.mjs','https://user:secret@deployed.example/atlas/app.mjs','http://user:secret@127.0.0.1/x','file:///etc/passwd','data:text/plain,x','https://unknown.example/new-provider'])assert.equal(browserNetworkAllowed(url,bases),false,url);
  assert.deepEqual(firstPartyBases({MAP_BASE_URL:'https://a.test/',ATLAS_TEST_URL:'http://localhost:4173',BROWSER_TILE_CACHE:'/tmp/old'}),['https://a.test/','http://localhost:4173']);
});
test('default route aborts providers without fetch, continue or cache access',async()=>{
  const {context,blocked}=await harness(),request=route('https://provider.invalid/tile?token=private');
  await context.routes[0].handler(request.value);
  assert.deepEqual(request.calls,{fetch:[],continue:0,fulfill:[],abort:['blockedbyclient'],fallback:0});
  assert.deepEqual(blocked,['https://provider.invalid/tile']);
});
test('later page and context routes cannot bypass the guard via continue or fetch',async()=>{
  for(const scope of ['page','context'])for(const method of ['continue','fetch']){
    const h=await harness(),target=h[scope],request=route('https://provider.invalid/tile');
    await target.route('**/*',route=>route[method]({maxRedirects:20}));
    const call=target.routes.at(-1).handler(request.value);
    if(method==='fetch')await assert.rejects(call,/non-fixture provider/);else await call;
    assert.equal(request.calls.fetch.length,0);assert.equal(request.calls.continue,0);assert.equal(h.blocked.length,1);
  }
});
test('rewriting an allowed request to an external URL cannot send it out',async()=>{
  for(const method of ['continue','fetch']){
    const {page}=await harness(),request=route('http://localhost:4173/file');
    await page.route('**/*',route=>route[method]({url:'https://provider.invalid/tile'}));
    const call=page.routes[0].handler(request.value);
    if(method==='fetch')await assert.rejects(call,/non-fixture provider/);else await call;
    assert.equal(request.calls.fetch.length,0);assert.equal(request.calls.continue,0);
  }
});
test('first-party content remains fetched, with redirects disabled before transport',async()=>{
  const {context,blocked}=await harness(),request=route('https://deployed.example/atlas/vendor/library.js');
  await context.routes[0].handler(request.value);
  assert.deepEqual(request.calls.fetch,[{maxRedirects:0}]);
  assert.deepEqual(request.calls.fulfill[0],{status:200,headers:{'content-type':'text/javascript'},body:Buffer.from('actual deployed bytes')});
  assert.equal(request.calls.continue,0);assert.deepEqual(blocked,[]);
});
test('server and fixture redirects never reach Chromium; fetch overrides cannot enable following',async()=>{
  for(const method of ['continue','fetch','fulfill']){
    const {page,blocked}=await harness(),request=route('http://localhost:4173/redirect',{status:302});
    await page.route('**/*',route=>route[method](method==='fulfill'?{status:302,headers:{location:'https://provider.invalid/tile'}}:{maxRedirects:20}));
    const call=page.routes[0].handler(request.value);
    if(method==='fetch')await assert.rejects(call,/redirected/);else await call;
    assert.equal(request.calls.fulfill.length,0);assert.equal(request.calls.continue,0);
    assert.ok(request.calls.fetch.every(options=>options.maxRedirects===0));assert.equal(blocked.length,1);
  }
});
test('fixture fulfillment and fallback remain usable, and unroute removes the wrapped handler',async()=>{
  const {page,blocked}=await harness(),request=route('https://provider.invalid/tile');
  const fixture=route=>route.fulfill({body:'synthetic tile'});
  await page.route('**/*',fixture);await page.routes[0].handler(request.value);
  assert.deepEqual(request.calls.fulfill,[{body:'synthetic tile'}]);assert.deepEqual(blocked,[]);
  await page.unroute('**/*',fixture);assert.equal(page.routes.length,0);
  await page.route('**/*',route=>route.fallback());await page.routes[0].handler(request.value);
  assert.equal(request.calls.fallback,1);
});
test('WebSocket setup is closed without connecting to the server',async()=>{
  const {context,blocked}=await harness();let closed=0;
  context.socket({url:()=> 'wss://provider.invalid/socket?secret=x',close:()=>closed++,connectToServer:()=>assert.fail('must not connect')});
  assert.equal(closed,1);assert.deepEqual(blocked,['wss://provider.invalid/socket']);
});
test('every matrix browser launches through the shared guard (including WebKit)',async()=>{
  for(const check of GROUPS.flatMap(group=>group.checks)){
    const source=await readFile(new URL('../scripts/'+check,import.meta.url),'utf8');
    if(check==='check-deployed-fixture-browser.mjs')assert.match(source,/check-orm-fixture-browser/);
    else assert.match(source,/launchBrowser\(/,check);
    assert.doesNotMatch(source,/\b(?:chromium|webkit|firefox)\.launch\(/,check);
  }
  const browser=await readFile(new URL('../scripts/browser.mjs',import.meta.url),'utf8');
  assert.match(browser,/serviceWorkers: 'block'/);
  assert.ok(browser.indexOf('await guardBrowserNetwork(context')<browser.indexOf('await isolatePublicOrm(context'));
  assert.doesNotMatch(browser,/if \(cache\) await cacheOtherOrigins/);
});

test('a later WebSocket fixture cannot opt back into a server connection',async()=>{
  const {context,blocked}=await harness();let closed=0;
  await context.routeWebSocket('**/*',socket=>socket.connectToServer());
  assert.throws(()=>context.socket({url:()=> 'wss://provider.invalid/socket',close:()=>closed++,connectToServer:()=>assert.fail('must not connect')}),/may not connect WebSockets/);
  assert.equal(closed,1);assert.equal(blocked.length,1);
});
