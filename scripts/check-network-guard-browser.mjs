// Exercise the actual Playwright routing boundary without contacting providers.
// .invalid is reserved for these deliberately unfulfilled negative controls.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {launchBrowser} from './browser.mjs';

// Real public Route objects retain Playwright's own transport/error
// serialization. No private constructor import or fabricated error prefix.
async function realTransportCase(browser, {reset = 'destroy', persistent = false, redirect = false} = {}) {
  const caseName = `reset=${reset}, persistent=${persistent}, redirect=${redirect}`;
  console.log('START real transport case:', caseName);
  const bytes = Buffer.from('real first-party fixture bytes'), warnings = [];
  let requests = 0, fetchCalls = 0, fulfillCalls = 0, error, fetched;
  const server = createServer((req, res) => {
    if (req.url !== '/asset.mjs') {
      res.writeHead(200, {'content-type': 'text/html'}).end('<!doctype html><title>Loopback transport</title>');
      return;
    }
    requests++;
    if (redirect) res.writeHead(302, {location: 'https://provider.invalid/never-fetch'}).end();
    else if (persistent || requests === 1) req.socket[reset]();
    else res.writeHead(200, {'content-type': 'application/octet-stream', 'cache-control': 'no-store'}).end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`, url = base + 'asset.mjs';
  let context;
  try {
    // The launch wrapper captures console.warn when installing the guard.
    // Capture this context's diagnostics, then immediately restore the console.
    const warn = console.warn;
    try {
      console.warn = (...args) => warnings.push(args.join(' '));
      context = await browser.newContext();
    } finally { console.warn = warn; }
    const page = await context.newPage();
    await page.goto(base, {timeout: 5000});
    await context.route(url, async route => {
      let response;
      try {
        fetchCalls++;
        // A caller cannot override the guard's zero native retries/redirects.
        response = await route.fetch({maxRetries: 100, maxRedirects: 100, timeout: 5000});
        fetched = await response.body();
        fulfillCalls++;
        await route.fulfill({response});
      } catch (cause) {
        error = cause;
        await route.abort('failed');
      } finally { await response?.dispose(); }
    });
    const delivered = await page.evaluate(async url => {
      try { return [...new Uint8Array(await (await fetch(url)).arrayBuffer())]; }
      catch { return null; }
    }, url);
    assert.equal(fetchCalls, 1, 'one intercepted browser request');
    if (redirect) {
      assert.match(error?.message || '', /redirected/);
      assert.equal(requests, 1); assert.equal(fulfillCalls, 0);
      assert.equal(delivered, null); assert.deepEqual(warnings, []);
    } else if (persistent) {
      // Current Playwright preserves the native reset code. Browserless
      // regressions separately cover older serialized errors without a code.
      assert.ok(error); assert.equal(error.code, 'ECONNRESET');
      assert.match(error.message, /^route\.fetch: socket hang up \(ECONNRESET\)\n/);
      assert.equal(requests, 2); assert.equal(fulfillCalls, 0);
      assert.equal(delivered, null); assert.equal(warnings.length, 2);
      assert.match(warnings[1], /exhausted 2\/2/);
    } else {
      assert.equal(error, undefined); assert.equal(requests, 2);
      assert.equal(fulfillCalls, 1); assert.deepEqual(fetched, bytes);
      assert.deepEqual(Buffer.from(delivered), bytes);
      assert.equal(warnings.length, 2);
      assert.match(warnings[0], /attempt 1\/2; retrying 2\/2/);
      assert.match(warnings[1], /returned on attempt 2\/2/);
    }
  } catch (cause) {
    throw new Error(`Real transport case failed (${caseName})`, {cause});
  } finally {
    try { await context?.close(); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}

const hits=[];
const server=createServer((req,res)=>{
  hits.push(req.url);
  if(req.url==='/redirect'){res.writeHead(302,{location:'https://provider.invalid/redirect-target'}).end();return;}
  res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><title>Real first-party response</title>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`,browser=await launchBrowser();
let checked=false, primaryError;
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
  for (const reset of ['destroy', 'resetAndDestroy']) await realTransportCase(browser, {reset});
  await realTransportCase(browser, {persistent: true});
  await realTransportCase(browser, {redirect: true});
  checked=true;
} catch (error) {
  primaryError=error;
  throw error;
} finally {
  const closed=browser.close();
  try {if(checked)await assert.rejects(closed,/Unmocked browser network requests were blocked:[\s\S]*provider\.invalid/);else await closed;}
  catch (cleanupError) {
    if(primaryError)throw new AggregateError([primaryError,cleanupError],'Network check failed; browser cleanup also reported blocked requests');
    throw cleanupError;
  }
  finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
console.log('PASS: first-party bytes are fetched; fixtures work; unmocked page, context, fetch, URL-rewriting fallback, redirect and worker requests are blocked before provider egress');
console.log('PASS: real Route.fetch handles both TCP reset variants with exact bytes, exhausts persistent resets at two requests, and blocks a real redirect after one request without following');
