// Exercise the actual Playwright routing boundary without contacting providers.
// .invalid is reserved for these deliberately unfulfilled negative controls.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {launchBrowser} from './browser.mjs';

const hits=[];
const server=createServer((req,res)=>{
  hits.push(req.url);
  if(req.url==='/redirect'){res.writeHead(302,{location:'https://provider.invalid/redirect-target'}).end();return;}
  res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><title>Real first-party response</title>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`,browser=await launchBrowser();
let checked=false;
try {
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(base);
  assert.equal(await page.title(),'Real first-party response');assert.ok(hits.includes('/'));
  // Higher-precedence routes cannot accidentally escape the shared guard.
  await page.route('https://provider.invalid/page-continue',route=>route.continue());
  await context.route('https://provider.invalid/context-continue',route=>route.continue());
  await page.route('https://provider.invalid/fetch',async route=>{
    await assert.rejects(route.fetch({maxRedirects:10}),/non-fixture provider/);
    await route.abort();
  });
  await page.route(base+'rewrite',route=>route.fallback({url:'http://provider.invalid/fallback'}));
  await page.route('https://provider.invalid/fixture',route=>route.fulfill({body:'offline fixture'}));
  for(const path of ['default','page-continue','context-continue','fetch'])assert.equal(await page.evaluate(async path=>{
    try{await fetch('https://provider.invalid/'+path);return true;}catch{return false;}
  },path),false,path+' cannot leave the fixture boundary');
  assert.equal(await page.evaluate(async()=>await(await fetch('https://provider.invalid/fixture')).text()),'offline fixture');
  assert.equal(await page.evaluate(async()=>{try{await fetch('/redirect');return true;}catch{return false;}}),false);
  assert.equal(await page.evaluate(async()=>{try{await fetch('/rewrite');return true;}catch{return false;}}),false);
  assert.equal(hits.includes('/rewrite'),false,'rewritten fallback must not reach either server');
  assert.ok(hits.includes('/redirect'),'redirect control must reach the actual local server');
  const workerResult=await page.evaluate(()=>new Promise(resolve=>{
    const worker=new Worker(URL.createObjectURL(new Blob([`fetch('https://provider.invalid/worker').then(()=>postMessage(false),()=>postMessage(true));`],{type:'text/javascript'})));
    worker.onmessage=event=>{resolve(event.data);worker.terminate();};
  }));
  assert.equal(workerResult,true,'worker requests share the fail-closed context guard');
  checked=true;
} finally {
  const closed=browser.close();
  try {if(checked)await assert.rejects(closed,/Unmocked browser network requests were blocked:[\s\S]*provider\.invalid/);else await closed;}
  finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
console.log('PASS: first-party bytes are fetched; fixtures work; unmocked page, context, fetch, URL-rewriting fallback, redirect and worker requests are blocked before provider egress');
