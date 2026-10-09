// Regression for a content blocker rejecting public code CDNs. This exercises
// real MapLibre and PMTiles with synthetic providers; no public tiles are read.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {serveAtlasAppFixture} from './atlas-app-browser-fixture.mjs';
import {observeRequiredBrowserLibraries} from './required-browser-libraries.mjs';
import {BROWSER_LIBRARIES} from './browser-libraries.mjs';

const server=await serveAtlasAppFixture(),browser=await launchBrowser();
const report=[];
try {
  for(const path of ['/','/atlas-project/']){
    const base=server.origin+path,context=await browser.newContext({viewport:{width:1000,height:720}});
    const page=await context.newPage(),blocked=[],codeRequests=[],errors=[],firstPartyFailures=[];
    const requiredLibraries=observeRequiredBrowserLibraries(page,base);
    // Network mode never injects a renderer/client shim or replaces app files.
    await installEmptyMapProviders(context,base,{firstParty:'network'});
    await page.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      const code=['script','stylesheet'].includes(request.resourceType());
      if(code)codeRequests.push(url.href);
      if(/(^|\.)(jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)$/.test(url.hostname)
        ||(code&&url.origin!==server.origin)){
        blocked.push(url.href);return route.abort('blockedbyclient');
      }
      return route.fallback();
    });
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{
      if(response.url().startsWith(base)&&response.status()>=400)firstPartyFailures.push({url:response.url(),status:response.status()});
    });
    await page.goto(base+'?language=en&relief=0&inactive=0&transport=0&destinations=0&constraints=0#5/30/114',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('body[data-map-ready="true"]',{timeout:60000});
    const libraryAssets=await requiredLibraries.assertReady();
    const actual=await page.evaluate(async()=>{
      const {map}=await import(document.querySelector('script[type="module"]').src);
      const archive=new pmtiles.PMTiles('https://fixture.invalid/test.pmtiles');
      const header=await archive.getHeader();
      return {version:maplibregl.getVersion(),realMap:map instanceof maplibregl.Map,
        canvas:map.getCanvas().width>0,stylesheet:getComputedStyle(map.getCanvas()).position,
        archiveVersion:header.specVersion,archiveEntries:header.numTileEntries};
    });
    assert.deepEqual(actual,{version:'5.24.0',realMap:true,canvas:true,stylesheet:'absolute',archiveVersion:3,archiveEntries:1});
    for(const name of ['maplibre-gl-5.24.0.js','maplibre-gl-5.24.0.css','pmtiles-4.2.1.js']){
      assert.ok(codeRequests.some(url=>new URL(url).pathname===path+'vendor/'+name),name+' must load from the actual project path');
    }
    assert.deepEqual(blocked,[],'the app must make zero requests to code CDNs');
    assert.deepEqual(errors,[],'app startup must have no unhandled script error');
    assert.deepEqual(firstPartyFailures,[],'built app resources must exist');
    report.push({path,actual,libraryAssets,codeRequests,blocked,firstPartyFailures});
    await context.close();
  }
  // Exercise native Web Crypto and actual cached upstream scripts. Seed only
  // the old Cache Storage keys, without warming HTTP/stylesheet caches for
  // the new first-party URLs. Cache keys must not become network requests.
  for(const mode of ['exact-cache','tampered-cache','crypto-unavailable']){
    const base=server.origin+'/atlas-project/',context=await browser.newContext({viewport:{width:1000,height:720}});
    const page=await context.newPage(),cdnRequests=[],blocked=[];
    const assets=await Promise.all(BROWSER_LIBRARIES.map(async library=>({...library,
      body:(await readFile(new URL(`../styles/${library.target}`,import.meta.url))).toString('base64'),
      legacy:`https://cdn.jsdelivr.net/npm/${library.package}@${library.version}/${library.source}`})));
    const targets=new Set(assets.map(library=>new URL(library.target,base).href));
    await installEmptyMapProviders(context,base,{firstParty:'network'});
    await page.addInitScript(mode=>{
      window.__legacyDigests=[];window.__legacyPending=0;
      if(mode==='crypto-unavailable')Object.defineProperty(crypto,'subtle',{value:undefined});
      else {
        const digest=crypto.subtle.digest.bind(crypto.subtle);
        crypto.subtle.digest=async(...args)=>{
          window.__legacyPending++;
          try {
            const result=await digest(...args);
            window.__legacyDigests.push({algorithm:args[0],bytes:args[1].byteLength,
              sha256:[...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,'0')).join('')});
            return result;
          }finally{window.__legacyPending--;}
        };
      }
    },mode);
    await page.route(base+'__legacy-cache-check',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Legacy cache preparation</title>'}));
    await page.route('https://cdn.jsdelivr.net/**',route=>{cdnRequests.push(route.request().url());return route.abort('blockedbyclient');});
    await page.goto(base+'__legacy-cache-check');
    await page.evaluate(async({base,assets,mode})=>{
      const cache=await caches.open('atlas-shell-22');
      await cache.put(base,new Response('previous installed app',{headers:{'content-type':'text/html'}}));
      for(const asset of assets){
        let body=Uint8Array.from(atob(asset.body),character=>character.charCodeAt(0));
        if(mode==='tampered-cache'){
          const changed=new Uint8Array(body.byteLength+1);changed.set(body);changed[body.byteLength]=32;body=changed;
        }
        await cache.put(asset.legacy,new Response(body,{status:200,
          headers:{'content-type':asset.target.endsWith('.css')?'text/css':'application/javascript'}}));
      }
    },{base,assets,mode});
    await page.route(url=>targets.has(url.href),route=>{blocked.push(route.request().url());return route.abort('blockedbyclient');});
    await page.goto(base+'?language=en&relief=0&inactive=0&transport=0&destinations=0&constraints=0#5/30/114',{waitUntil:'domcontentloaded'});
    if(mode==='exact-cache')await page.waitForSelector('body[data-map-ready="true"]',{timeout:60000});
    else await page.waitForFunction(()=>document.getElementById('map-status').textContent.includes('Map libraries could not load'),null,{timeout:10000});
    await page.waitForFunction(()=>window.__legacyPending===0);
    const actual=await page.evaluate(()=>{
      const link=document.getElementById('maplibre-css'),fallback=link.nextElementSibling;
      return {ready:document.body.dataset.mapReady==='true',version:window.maplibregl?.getVersion(),
        pmtiles:typeof window.pmtiles?.PMTiles,blobScripts:[...document.scripts].filter(script=>script.src.startsWith('blob:')).length,
        recoveredCss:fallback.tagName==='STYLE',cssBeforeApp:fallback.nextElementSibling?.href?.includes('app.css')||false,
        linkHasSheet:Boolean(link.sheet),adjacentTag:fallback.tagName,
        digests:window.__legacyDigests};
    });
    assert.equal(blocked.length,3,'all new library paths fail in this upgrade scenario');
    assert.deepEqual(cdnRequests,[],'legacy cache recovery must never download from the CDN');
    if(mode==='exact-cache'){
      assert.equal(actual.ready,true);assert.equal(actual.version,'5.24.0');assert.equal(actual.pmtiles,'function');
      assert.equal(actual.blobScripts,2);assert.equal(actual.recoveredCss,true,JSON.stringify(actual));assert.equal(actual.cssBeforeApp,true);
      assert.deepEqual(actual.digests.map(row=>row.sha256).sort(),assets.map(row=>row.sha256).sort());
    }else{
      assert.equal(actual.ready,false);assert.equal(actual.blobScripts,0);assert.equal(actual.recoveredCss,false);
      assert.equal(actual.digests.length,mode==='tampered-cache'?3:0);
      assert.ok(actual.digests.every(row=>!assets.some(asset=>asset.sha256===row.sha256)));
    }
    report.push({mode,actual,blocked,cdnRequests});
    await context.close();
  }
  await mkdir('browser-review',{recursive:true});
  await writeFile('browser-review/first-party-assets.json',JSON.stringify(report,null,2)+'\n');
  console.log('PASS: real MapLibre, stylesheet and PMTiles load from root/project URLs with public code CDNs blocked; zero CDN requests');
  console.log('PASS: native Web Crypto accepts exact cached upstream JS/CSS and rejects correct-MIME tampering or unavailable crypto without a CDN request');
}finally{await browser.close();await server.close();}
