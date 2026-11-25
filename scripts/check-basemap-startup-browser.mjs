// Same packaged Atlas app, pinned PMTiles and MapLibre, with only fixture
// transport. There is no provider speed target in this regression.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {launchBrowser} from './browser.mjs';
import {serveAtlasAppFixture} from './atlas-app-browser-fixture.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {pmtilesFixtureResponse} from './pmtiles-browser-fixture.mjs';

const server=await serveAtlasAppFixture();
const browser=await launchBrowser(process.env.STARTUP_TEST_BROWSER?{executablePath:process.env.STARTUP_TEST_BROWSER}:{});
try {
  for(const background of ['map','satellite']){
    const base=server.origin+'/atlas-project/';
    const ctx=await browser.newContext({viewport:{width:1000,height:700},serviceWorkers:'block'});
    let release;const held=new Promise(resolve=>{release=resolve;});
    const headerRequests=[],errors=[];
    let rendererAsked=false;
    try {
      await installEmptyMapProviders(ctx,base,{firstParty:'network'});
      await ctx.route(/\/vendor\/maplibre-gl-[\w.-]+\.js(?:\?|$)/,async route=>{
        rendererAsked=true;await held;await route.continue();
      });
      await ctx.route('**/planet.pmtiles',route=>{
        const range=route.request().headers().range;
        if(range==='bytes=0-16383')headerRequests.push({range,rendererAsked});
        return route.fulfill(pmtilesFixtureResponse(range));
      });
      const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+`?background=${background}&relief=0&inactive=0&stations=0&transport=0&destinations=0`,{waitUntil:'domcontentloaded'});
      if(background==='map'){
        const deadline=Date.now()+9000;
        while(!headerRequests.length&&Date.now()<deadline)await delay(50);
        assert.equal(headerRequests.length,1,"Map's initial header must start before the held renderer script is delivered");
        assert.equal(headerRequests[0].rendererAsked,true);
      } else {
        // The candidate gate must not make a speculative Map request when
        // the initial requested background is Satellite.
        const deadline=Date.now()+9000;
        while(!rendererAsked&&Date.now()<deadline)await delay(50);
        assert.ok(rendererAsked);
        await delay(250);
        assert.equal(headerRequests.length,0);
      }
      assert.equal(await page.locator('#map canvas.maplibregl-canvas').count(),0,'held initialization has not constructed the map');
      release();
      await page.waitForSelector('body[data-map-ready=true]',{state:'attached',timeout:30000});
      if(background==='map'){
        await page.waitForFunction(async()=>{
          const {map}=await import(document.querySelector('script[type=module]').src);
          return Boolean(map.style?.tileManagers?.openmaptiles?.getSource()?.loaded());
        },null,{timeout:15000});
        assert.equal(headerRequests.length,1,'the actual protocol must reuse the initial header request');
      }
      assert.deepEqual(errors,[]);
      console.log(`${background}: initial archive rules passed, ${headerRequests.length} header request(s)`);
    } finally {release();await ctx.close();}
  }
} finally {await browser.close();await server.close();}
