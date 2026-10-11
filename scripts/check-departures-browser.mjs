// Real Atlas and renderer with synthetic timetable responses. No provider
// requests leave the loopback-only browser transport guard.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {serveAtlasAppFixture} from './atlas-app-browser-fixture.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';

const server = await serveAtlasAppFixture();
await mkdir('browser-review', {recursive:true});
try {
  for (const engine of ['chromium','webkit']) {
    const browser = await launchBrowser({engine});
    try {
      const context = await browser.newContext({viewport:{width:1100,height:920},serviceWorkers:'block'});
      const page = await context.newPage(), base = server.origin + '/atlas-project/';
      const errors=[],requests=[];
      page.on('pageerror', error=>errors.push(error.message));
      // WebKit routes the renderer's Blob worker reads through Playwright.
      // Replay the real Blob bytes, not the empty provider's JSON fallback.
      await context.addInitScript(()=>{
        window.__atlasFixtureBlobs=new Map();
        const create=URL.createObjectURL.bind(URL);
        URL.createObjectURL=blob=>{
          const url=create(blob);window.__atlasFixtureBlobs.set(url,blob);return url;
        };
      });
      await installEmptyMapProviders(context, base, {firstParty:'network'});
      await context.route(`blob:${server.origin}/**`,async route=>{
        const body=await page.evaluate(async url=>window.__atlasFixtureBlobs.get(url)?.text()??null,route.request().url());
        assert.notEqual(body,null,'the renderer worker must be an actual recorded Blob');
        await route.fulfill({body,contentType:'text/javascript'});
      });
      const at = new Date(Date.now()+600_000).toISOString();
      const stop=(name,stopId,extra={})=>({name,stopId,lat:35.7,lon:139.77,tz:'Asia/Tokyo',arrival:at,departure:at,...extra});
      const timetable = {legs:[{mode:'SUBWAY',realTime:false,from:stop('渋谷 Shibuya','origin'),
        intermediateStops:[stop('上野 Ueno','before'),stop('末廣町 Suehirocho','selected',{track:'1'})],
        to:stop('浅草 Asakusa','terminus')}]};
      let fail=true;
      await context.route('https://api.transitous.org/api/v1/**',route=>{
        const url=new URL(route.request().url());requests.push(url.pathname);
        if(url.pathname.endsWith('/reverse-geocode'))return route.fulfill({json:[{type:'STOP',name:'Suehirocho',id:'selected',lat:35.7,lon:139.77,modes:['SUBWAY']}]});
        if(url.pathname.endsWith('/stoptimes'))return route.fulfill({json:{stopTimes:[
          {mode:'SUBWAY',displayName:'G',headsign:'浅草 Asakusa',tripId:'fixture_train&one',realTime:false,place:stop('Suehirocho','selected')},
          {mode:'SUBWAY',displayName:'G',headsign:'渋谷 Shibuya',tripId:'fixture_retry',realTime:false,place:stop('Suehirocho','selected')},
          {mode:'SUBWAY',displayName:'G',headsign:'Unknown ID',realTime:false,place:stop('Suehirocho','selected')},
        ]}});
        assert.equal(url.pathname,'/api/v1/trip');
        assert.equal(url.searchParams.get('withScheduledSkippedStops'),'true');
        assert.equal(url.searchParams.get('one'),null,'opaque trip IDs cannot inject query parameters');
        if(url.searchParams.get('tripId')==='fixture_retry'&&fail)return route.fulfill({status:503,json:{error:'fixture outage'}});
        return route.fulfill({json:timetable});
      });
      await page.goto(base+'?language=en&relief=0&inactive=0&transport=0&destinations=0&constraints=0#13/35.7/139.77',{waitUntil:'domcontentloaded'});
      await page.waitForSelector('body[data-map-ready="true"]',{timeout:60000});
      // Supply one mapped station to the actual production click handler.
      // All station-detail and departure rendering remains production code.
      await page.evaluate(async()=>{
        const {map}=await import(document.querySelector('script[type="module"]').src);
        const original=map.queryRenderedFeatures;
        map.queryRenderedFeatures=()=>[{source:'stationMajor',kind:'station',layer:{id:'station-major'},
          properties:{name:'Suehirocho',station:'subway',station_size:'small'},
          geometry:{type:'Point',coordinates:[139.77,35.7]}}];
        try{map.fire('click',{point:{x:500,y:500},lngLat:{lng:139.77,lat:35.7}});}
        finally{map.queryRenderedFeatures=original;}
      });
      await page.locator('.departure-trip').first().waitFor();
      assert.equal(await page.locator('.departure-trip').count(),3);
      assert.equal(requests.filter(p=>p.endsWith('/trip')).length,0,'board does not prefetch complete schedules');
      const summary=page.locator('.departure-summary').filter({hasText:'浅草 Asakusa'});
      await summary.scrollIntoViewIfNeeded();
      await page.evaluate(()=>getSelection().removeAllRanges());
      const text=summary.locator('.departure-headsign'),rect=await text.boundingBox();
      await page.mouse.move(rect.x+2,rect.y+rect.height/2);
      await page.mouse.down();await page.mouse.move(rect.x+rect.width-2,rect.y+rect.height/2,{steps:12});await page.mouse.up();
      assert.ok((await page.evaluate(()=>getSelection().toString())).includes('Asakusa'),'mouse selects timetable text');
      assert.equal(await summary.evaluate(n=>n.parentElement.open),false,'selection must not expand the train');
      assert.equal(requests.filter(p=>p.endsWith('/trip')).length,0);
      await page.evaluate(()=>getSelection().removeAllRanges());
      await summary.click();await page.locator('.trip-stops').waitFor();
      assert.deepEqual(await page.locator('.trip-stops tbody th').allTextContents(),['渋谷 Shibuya','上野 Ueno','末廣町 SuehirochoPlatform 1','浅草 Asakusa']);
      assert.equal(await page.locator('.trip-current-stop').count(),1);
      await page.screenshot({path:`browser-review/train-schedule-${engine}.png`});
      const scheduleText=page.locator('.trip-stops tbody th').first(),scheduleRect=await scheduleText.boundingBox();
      await page.mouse.move(scheduleRect.x+3,scheduleRect.y+8);await page.mouse.down();
      await page.mouse.move(scheduleRect.x+scheduleRect.width-3,scheduleRect.y+8,{steps:10});await page.mouse.up();
      assert.ok((await page.evaluate(()=>getSelection().toString())).includes('Shibuya'),'full schedule text is selectable too');
      await page.evaluate(()=>getSelection().removeAllRanges());
      await summary.click();await summary.focus();await summary.press('Enter');
      assert.equal(await summary.evaluate(n=>n.parentElement.open),true,'keyboard opens schedule');
      assert.equal(requests.filter(p=>p.endsWith('/trip')).length,1,'repeat expansion reuses schedule');
      await summary.click();
      const retrySummary=page.locator('.departure-summary').filter({hasText:'渋谷 Shibuya'});
      await retrySummary.click();await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
      fail=false;await page.getByRole('button',{name:'Retry',exact:true}).click();
      await page.locator('.departure-trip[open] .trip-stops').waitFor();
      assert.equal(requests.filter(p=>p.endsWith('/trip')).length,3,'retry reaches recovered provider');
      await retrySummary.click();
      await page.locator('.departure-summary').filter({hasText:'Unknown ID'}).click();
      await page.getByText('The source did not supply a trip ID, so its full schedule cannot be requested.').waitFor();
      assert.equal(requests.filter(p=>p.endsWith('/trip')).length,3);
      assert.deepEqual(errors,[]);
      await page.screenshot({path:`browser-review/departures-${engine}.png`});
      console.log(`${engine}: station board, mouse selection, full trip, keyboard, cache, retry, and missing identity passed; ${requests.length} fixture requests.`);
      await context.close();
    } finally {await browser.close();}
  }
} finally {await server.close();}
