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
      const openStation = async (name = 'Suehirocho') => page.evaluate(async name=>{
        const {map}=await import(document.querySelector('script[type="module"]').src);
        const original=map.queryRenderedFeatures;
        map.queryRenderedFeatures=()=>[{source:'stationMajor',kind:'station',layer:{id:'station-major'},
          properties:{name,station:'subway',station_size:'small'},
          geometry:{type:'Point',coordinates:[139.77,35.7]}}];
        try{map.fire('click',{point:{x:500,y:500},lngLat:{lng:139.77,lat:35.7}});}
        finally{map.queryRenderedFeatures=original;}
      }, name);
      await openStation();
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
      // Partial board failures must survive the production cache and renderer.
      // All responses below are synthetic; the loopback transport guard remains.
      const boardRequests = [];
      let boardName, boardOrder = ['a', 'b'], boardTimes = [], boardFailed = ['b'];
      await context.route('https://api.transitous.org/api/v1/**', route => {
        const url = new URL(route.request().url()); boardRequests.push(url.pathname);
        if (url.pathname.endsWith('/reverse-geocode')) return route.fulfill({json: boardOrder.map(id =>
          ({type:'STOP', name:boardName, id, lat:35.7, lon:139.77, modes:['SUBWAY']}))});
        assert.equal(url.pathname, '/api/v1/stoptimes', 'board never prefetches schedules or retries');
        assert.equal(url.searchParams.get('n'), '30');
        return boardFailed.includes(url.searchParams.get('stopId'))
          ? route.fulfill({status:503, json:{error:'synthetic private provider response'}})
          : route.fulfill({json:{stopTimes:boardTimes}});
      });
      await page.evaluate(() => {
        window.__departureFixtureNow = Date.now();
        Date.now = () => window.__departureFixtureNow;
      });
      const waitBoard = () => page.waitForFunction(() =>
        document.querySelector('.departures') && !document.querySelector('.departures').textContent.includes('Loading departures…'));
      const row = {mode:'SUBWAY', displayName:'G', headsign:'Fixture terminus', tripId:'fixture-partial',
        realTime:false, place:stop('Central','a')};
      for (const order of [['a','b'], ['b','a']]) for (const withRows of [false, true]) {
        boardName = `Partial ${order.join('')} ${withRows ? 'rows' : 'empty'}`;
        boardOrder = order; boardTimes = withRows ? [row] : []; boardFailed = ['b'];
        const before = boardRequests.length;
        await openStation(boardName); await waitBoard();
        assert.equal(boardRequests.length - before, 3);
        assert.equal(await page.locator('.departure-warning').textContent(), 'Some departures could not load. The board may be incomplete.');
        assert.equal(await page.locator('.departure-list > li').count(), Number(withRows));
        assert.doesNotMatch(await page.locator('.departures').textContent(), /No rail departures|No published timetable|synthetic private/);
        assert.equal(await page.locator('.departures button').count(), 0, 'no board retry button');
        if (order[0] === 'a') await page.screenshot({path:`browser-review/departures-partial-${withRows ? 'rows' : 'empty'}-${engine}.png`});
        await page.locator('#details-close').click();
        boardFailed = [];
        await openStation(boardName); await waitBoard();
        assert.equal(await page.locator('.departure-warning').count(), 1, 'reopening keeps cached partial status');
        assert.equal(boardRequests.length - before, 3, 'reopening does not add provider requests');
        await page.locator('#language').selectOption(withRows ? 'ja' : 'en');
        await waitBoard();
        assert.equal(await page.locator('.departure-warning').count(), 1, 'settings redraw retains the warning');
        assert.equal(boardRequests.length - before, 3);
        await page.evaluate(() => {window.__departureFixtureNow += 60_001;});
        assert.equal(boardRequests.length - before, 3, 'expiry alone never triggers an automatic retry');
        await openStation(boardName); await waitBoard();
        assert.equal(boardRequests.length - before, 6);
        assert.equal(await page.locator('.departure-warning').count(), 0, 'normal expiry and opening establishes recovery');
        assert.equal(await page.locator('.departure-list > li').count(), Number(withRows));
        if (!withRows) assert.match(await page.locator('.departures').textContent(), /No rail departures in the published timetable soon/);
      }
      boardName = 'All boards unavailable'; boardFailed = ['a','b']; boardTimes = [];
      const beforeFailed = boardRequests.length;
      await openStation(boardName); await waitBoard();
      assert.match(await page.locator('.departures').textContent(), /Departures could not load. Try again later./);
      assert.equal(boardRequests.length - beforeFailed, 3);
      boardFailed = [];
      await openStation(boardName); await waitBoard();
      assert.equal(boardRequests.length - beforeFailed, 6, 'all-failed result is evicted for a normal reopening');
      assert.match(await page.locator('.departures').textContent(), /No rail departures in the published timetable soon/);
      boardName = 'No matching timetable'; boardOrder = [];
      await openStation(boardName); await waitBoard();
      assert.match(await page.locator('.departures').textContent(), /No published timetable covers this station/);
      assert.deepEqual(errors, []);
      console.log(`${engine}: partial-empty and partial-rows in both source orders, close/reopen, settings redraw, bounded cached requests, expiry recovery, all-failed eviction and unmatched passed; ${boardRequests.length} intercepted board fixture requests.`);
      for (const withRows of [false, true]) {
        let release, requested;
        const held = new Promise(resolve => {release = resolve;});
        const started = new Promise(resolve => {requested = resolve;});
        const closeRequests = [], name = `Close pending partial ${withRows ? 'rows' : 'empty'}`;
        await context.route('https://api.transitous.org/api/v1/**', async route => {
          const url = new URL(route.request().url()); closeRequests.push(url.pathname);
          if (url.pathname.endsWith('/reverse-geocode')) return route.fulfill({json:['a','b'].map(id =>
            ({type:'STOP', name, id, lat:35.7, lon:139.77, modes:['SUBWAY']}))});
          assert.equal(url.pathname, '/api/v1/stoptimes');
          if (url.searchParams.get('stopId') === 'b') {
            requested(); await held;
            return route.fulfill({status:503, json:{error:'synthetic private provider response'}});
          }
          return route.fulfill({json:{stopTimes:withRows ? [row] : []}});
        });
        await openStation(name); await started;
        assert.match(await page.locator('.departures').textContent(), /Loading departures/);
        await page.locator('#details-close').click();
        assert.equal(await page.locator('#details').isHidden(), true);
        release(); await waitBoard();
        assert.equal(await page.locator('#details').isHidden(), true, 'late partial results cannot reopen the closed panel');
        assert.equal(await page.locator('.departure-warning').textContent(), 'Some departures could not load. The board may be incomplete.');
        assert.equal(closeRequests.length, 3);
        await openStation(name); await waitBoard();
        assert.equal(await page.locator('#details').isVisible(), true);
        assert.equal(await page.locator('.departure-warning').count(), 1);
        assert.equal(await page.locator('.departure-list > li').count(), Number(withRows));
        assert.doesNotMatch(await page.locator('.departures').textContent(), /No rail departures|No published timetable|synthetic private/);
        assert.equal(closeRequests.length, 3, 'reopening after a pending Close retains the cached partial result');
      }
      assert.deepEqual(errors, []);
      console.log(`${engine}: Close during pending partial-empty and partial-rows, late settlement remaining hidden, and cached reopening passed; 6 intercepted fixture requests.`);
      await context.close();
    } finally {await browser.close();}
  }
} finally {await server.close();}
