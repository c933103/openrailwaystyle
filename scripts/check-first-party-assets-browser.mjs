// Regression for a content blocker rejecting public code CDNs. This exercises
// real MapLibre and PMTiles with synthetic providers; no public tiles are read.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {serveAtlasAppFixture} from './atlas-app-browser-fixture.mjs';
import {observeRequiredBrowserLibraries} from './required-browser-libraries.mjs';

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
  await mkdir('browser-review',{recursive:true});
  await writeFile('browser-review/first-party-assets.json',JSON.stringify(report,null,2)+'\n');
  console.log('PASS: real MapLibre, stylesheet and PMTiles load from root/project URLs with public code CDNs blocked; zero CDN requests');
}finally{await browser.close();await server.close();}
