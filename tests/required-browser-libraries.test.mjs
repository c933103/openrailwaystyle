import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {backportMapLibre524} from '../styles/map-controls.mjs';
import {webcrypto} from 'node:crypto';
import {BROWSER_LIBRARIES} from '../scripts/browser-libraries.mjs';
import {observeRequiredBrowserLibraries,blockRequiredBrowserScripts} from '../scripts/required-browser-libraries.mjs';

const base='https://atlas.example/project/';
const bodies=new Map(await Promise.all(BROWSER_LIBRARIES.map(async library=>{
  const bytes=await readFile(new URL(`../node_modules/${library.package}/${library.source}`,import.meta.url));
  return [library.target,library.sourceSha256?Buffer.from(await backportMapLibre524(bytes,webcrypto.subtle)):bytes];
})));
const css=BROWSER_LIBRARIES.find(library=>library.target.endsWith('.css'));

test('failure probes block current manifest scripts at root and project paths without filename drift',async()=>{
  for(const root of ['https://atlas.example/','https://atlas.example/project/']){
    let handler;
    const blocked=await blockRequiredBrowserScripts({route:async(pattern,callback)=>{assert.equal(pattern,'**/*');handler=callback;}},root);
    const check=async(url,expected)=>{
      let result;
      await handler({request:()=>({url:()=>url}),abort:reason=>{result=reason;},fallback:()=>{result='fallback';}});
      assert.equal(result,expected,url);
    };
    for(const library of BROWSER_LIBRARIES){
      const url=new URL(library.target,root).href;
      await check(url,library.target.endsWith('.js')?'blockedbyclient':'fallback');
      if(library.target.endsWith('.js'))await check(url+'?v=current','blockedbyclient');
    }
    const renderer=BROWSER_LIBRARIES.find(library=>library.package==='maplibre-gl'&&library.target.endsWith('.js'));
    assert.ok(blocked.some(request=>request.url===new URL(renderer.target,root).href&&request.package==='maplibre-gl'));
    assert.equal(blocked.length,4,'both renderer and archive client are blocked, including version queries');
    for(const url of [new URL('vendor/maplibre-gl-5.24.0.js',root).href,
      'https://atlas.example/other/'+renderer.target,'https://other.example/'+renderer.target,new URL('app.mjs',root).href])await check(url,'fallback');
    assert.equal(blocked.length,4,'unrelated and historical URLs do not count as renderer failure');
  }
});

function respond(page,library,{url=new URL(library.target,base).href,status=200,type=library.target.endsWith('.css')?'text/css':'text/javascript',
  body=bodies.get(library.target),failure,incomplete}={}) {
  const request={url:()=>url,failure:()=>({errorText:failure})};
  page.emit('request',request);
  if(failure){page.emit('requestfailed',request);return;}
  page.emit('response',{url:()=>url,status:()=>status,headers:()=>({'content-type':type}),
    finished:async()=>incomplete,body:async()=>body});
}
function fixture(override) {
  const page=new EventEmitter(),observed=observeRequiredBrowserLibraries(page,base);
  for(const library of BROWSER_LIBRARIES)respond(page,library,library===css?override:undefined);
  return {page,observed};
}

test('required library validation checks the observed project responses and ignores optional failures',async()=>{
  const {page,observed}=fixture();
  respond(page,css,{url:base+'data/optional.json',status:404});
  respond(page,css,{url:base+'fonts/optional.woff2',failure:'net::ERR_FAILED'});
  respond(page,css,{url:'https://cdn.jsdelivr.net/optional.js',status:404});
  const assets=await observed.assertReady();
  assert.equal(assets.length,3);
  for(const library of BROWSER_LIBRARIES){
    const asset=assets.find(asset=>asset.url===new URL(library.target,base).href);
    assert.equal(asset.sha256,library.sha256);
    assert.equal(asset.bytes,bodies.get(library.target).length);
  }
  for(const name of ['request','response','requestfailed'])assert.equal(page.listenerCount(name),0);
});

for(const [name,override,reason] of [
  ['HTTP 404',{status:404},/HTTP 404/],
  ['network rejection',{failure:'net::ERR_BLOCKED_BY_CLIENT'},/request failed: net::ERR_BLOCKED_BY_CLIENT/],
  ['successful status with incorrect bytes',{body:Buffer.from('body { display: none; }')},/response bytes differ from the pinned distribution/],
  ['successful status with incorrect MIME',{type:'text/plain'},/unexpected Content-Type: text\/plain/],
  ['incomplete response body',{incomplete:new Error('connection closed')},/incomplete response: connection closed/],
])test(`required stylesheet ${name} fails despite successful JavaScript responses`,async()=>{
  const {observed}=fixture(override);
  await assert.rejects(observed.assertReady(),error=>{
    assert.match(error.message,/Required first-party browser libraries failed/);
    assert.ok(error.message.includes(new URL(css.target,base).href));
    assert.match(error.message,reason);
    return true;
  });
});

test('matching bytes under another project path cannot satisfy a missing required request',async()=>{
  const page=new EventEmitter(),observed=observeRequiredBrowserLibraries(page,base);
  for(const library of BROWSER_LIBRARIES)respond(page,library,library===css?{url:'https://atlas.example/other/'+library.target}:undefined);
  await assert.rejects(observed.assertReady({timeout:5}),/no request was observed/);
});

test('a requested library with no completed response fails within the bounded check',async()=>{
  const page=new EventEmitter(),observed=observeRequiredBrowserLibraries(page,base);
  for(const library of BROWSER_LIBRARIES)if(library!==css)respond(page,library);
  page.emit('request',{url:()=>new URL(css.target,base).href});
  await assert.rejects(observed.assertReady({timeout:5}),/response did not complete/);
});
