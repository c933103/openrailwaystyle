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
      const openStation = async (name = 'Suehirocho', properties = {}) => page.evaluate(async ({name, properties})=>{
        const {map}=await import(document.querySelector('script[type="module"]').src);
        const original=map.queryRenderedFeatures;
        map.queryRenderedFeatures=()=>[{source:'stationMajor',kind:'station',layer:{id:'station-major'},
          properties:{name,station:'subway',station_size:'small',...properties},
          geometry:{type:'Point',coordinates:[139.77,35.7]}}];
        try{map.fire('click',{point:{x:500,y:500},lngLat:{lng:139.77,lat:35.7}});}
        finally{map.queryRenderedFeatures=original;}
      }, {name, properties});
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
      const boardRequests = [], boardStopIds = [];
      let boardName, boardOrder = ['a', 'b'], boardTimes = [], boardFailed = ['b'], lookupResponse, boardBodies = {};
      await context.route('https://api.transitous.org/api/v1/**', route => {
        const url = new URL(route.request().url()); boardRequests.push(url.pathname);
        if (url.pathname.endsWith('/reverse-geocode')) return route.fulfill({json: lookupResponse === undefined ? boardOrder.map(id =>
          ({type:'STOP', name:boardName, id, lat:35.7, lon:139.77, modes:['SUBWAY']})) : lookupResponse});
        assert.equal(url.pathname, '/api/v1/stoptimes', 'board never prefetches schedules or retries');
        assert.equal(url.searchParams.get('n'), '30');
        const id = url.searchParams.get('stopId');
        boardStopIds.push(id);
        if (Object.hasOwn(boardBodies, id)) return route.fulfill({body:JSON.stringify(boardBodies[id]), contentType:'application/json'});
        return boardFailed.includes(id)
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
        realTime:false, place:stop('Central','a',{arrival:'2099-01-01T12:00:00Z',departure:'2099-01-01T12:00:00Z'})};
      // A nearer substring name cannot take a board slot or supply the journey
      // origin/destination. Exercise the production click, matching and renderer.
      const permutations = items => items.length < 2 ? [items] : items.flatMap((item, i) =>
        permutations(items.filter((_, j) => j !== i)).map(rest => [item, ...rest]));
      for (const [name, other] of [['Terminal 1','Terminal 10'], ['Central','Central Park'], ['中央','中央公園']]) {
        const candidates = [
          {type:'STOP',name,id:'a',lat:35.701,lon:139.77,modes:['SUBWAY']},
          {type:'STOP',name,id:'b',lat:35.7011,lon:139.77,modes:['SUBWAY']},
          {type:'STOP',name:other,id:'wrong',lat:35.7001,lon:139.77,modes:['SUBWAY']},
        ];
        boardBodies = Object.fromEntries(['a','b','wrong'].map(id => [id, {stopTimes:[
          {...row,displayName:id === 'wrong' ? 'WRONG' : `RIGHT-${id}`,tripId:id},
        ]}]));
        for (const order of permutations(candidates)) {
          lookupResponse = order;
          const before = boardRequests.length, beforeIds = boardStopIds.length;
          const properties = {id:`name-match-${name}-${order.map(c => c.id).join('-')}`};
          await openStation(name, properties); await waitBoard();
          assert.equal(boardRequests.length - before, 3);
          assert.deepEqual(boardStopIds.slice(beforeIds), ['a','b']);
          assert.equal(await page.locator('.departure-list > li').count(), 2);
          assert.doesNotMatch(await page.locator('.departures').textContent(), /WRONG/);
          for (const [i, direction] of ['from','to'].entries()) {
            const url = new URL(await page.locator('.departure-links a').nth(i).getAttribute('href'));
            assert.equal(url.searchParams.get(`${direction}Place`), 'a');
            assert.equal(url.searchParams.get(`${direction}Name`), name);
          }
          await page.locator('#details-close').click();
          await openStation(name, properties); await waitBoard();
          assert.equal(boardRequests.length - before, 3, 'reopening keeps the name-compatible board cached');
        }
      }
      for (const composite of ['München Hbf / Munich','München (Munich)']) for (const supplied of [true,false]) {
        const candidates = [
          {type:'STOP',name:'München Hbf',id:'a',lat:35.701,lon:139.77,modes:['SUBWAY']},
          {type:'STOP',name:composite,id:'b',lat:35.7011,lon:139.77,modes:['SUBWAY']},
          {type:'STOP',name:'Munich Park',id:'wrong',lat:35.7001,lon:139.77,modes:['SUBWAY']},
        ];
        for (const order of permutations(candidates)) {
          lookupResponse = order;
          const before = boardRequests.length, beforeIds = boardStopIds.length;
          const properties = {id:`same-script-${composite}-${supplied}-${order.map(c => c.id).join('-')}`,
            ...(supplied ? {'name:en':'Munich'} : {})};
          await openStation('München Hbf', properties); await waitBoard();
          assert.deepEqual(boardStopIds.slice(beforeIds), supplied ? ['a','b'] : ['a']);
          assert.equal(boardRequests.length - before, supplied ? 3 : 2);
          assert.equal(await page.locator('.departure-list > li').count(), supplied ? 2 : 1);
          assert.doesNotMatch(await page.locator('.departures').textContent(), /WRONG/);
          for (const [i, direction] of ['from','to'].entries()) {
            const url = new URL(await page.locator('.departure-links a').nth(i).getAttribute('href'));
            assert.equal(url.searchParams.get(`${direction}Place`), 'a');
            assert.equal(url.searchParams.get(`${direction}Name`), supplied ? 'Munich' : 'München Hbf');
          }
          await page.locator('#details-close').click();
          await openStation('München Hbf', properties); await waitBoard();
          assert.equal(boardRequests.length - before, supplied ? 3 : 2);
        }
      }
      lookupResponse = undefined; boardBodies = {};
      // Destination numbers identify different simultaneous trains. Exercise
      // the actual station handler, parser, renderer and cached reopening.
      for (const order of [['a','b'], ['b','a']]) for (const [a, b] of [
        ['Terminal 1','Terminal 10'], ['Central','Central 2'], ['中央1','中央10'],
      ]) {
        boardName = `Destinations ${order.join('')} ${a}`; boardOrder = order; boardFailed = [];
        boardBodies = {a:{stopTimes:[{...row, tripId:'trip-a', headsign:a}]},
          b:{stopTimes:[{...row, tripId:'trip-b', headsign:b, cancelled:true}]}};
        const before = boardRequests.length;
        for (let reopen = 0; reopen < 2; reopen++) {
          await openStation(boardName); await waitBoard();
          assert.deepEqual(new Set(await page.locator('.departure-headsign').allTextContents()), new Set([a,b]));
          assert.equal(await page.locator('.departure-status').count(), 1);
          assert.equal(await page.locator('.departure-list > li').filter({has:page.locator('.departure-status')}).locator('.departure-headsign').textContent(), b);
          assert.equal(await page.locator('.departure-warning').count(), 0);
          assert.equal(boardRequests.length - before, 3, 'cached reopening retains the two departures without extra requests');
          await page.locator('#details-close').click();
        }
      }
      boardBodies = {};
      console.log(`${engine}: distinct numbered destinations, isolated cancellations and cached reopening passed in both board orders.`);
      console.log(`${engine}: numeric, Latin and native-script substring collisions excluded in all 18 candidate orders, both journey links and cached reopening passed.`);
      console.log(`${engine}: same-script slash/parenthesized aliases, absent-alias negative controls, both journey links and cached reopening passed in all 24 candidate orders.`);
      for (const order of [['a','b'], ['b','a']]) for (const withRows of [false, true]) {
        boardName = `Partial ${order.join('')} ${withRows ? 'rows' : 'empty'}`;
        boardOrder = order; boardTimes = withRows ? [row] : []; boardFailed = ['b'];
        const translated = {id:`fixture-${boardName}`, 'name:en':`${boardName} English`, 'name:ja':`${boardName} 日本語`};
        const before = boardRequests.length;
        await openStation(boardName, translated); await waitBoard();
        assert.equal(boardRequests.length - before, 3);
        assert.equal(await page.locator('.departure-warning').textContent(), 'Some departures could not load. The board may be incomplete.');
        assert.equal(await page.locator('.departure-list > li').count(), Number(withRows));
        assert.doesNotMatch(await page.locator('.departures').textContent(), /No rail departures|No published timetable|No matching rail timetable stop|synthetic private/);
        assert.equal(await page.locator('.departures button').count(), 0, 'no board retry button');
        if (order[0] === 'a') await page.screenshot({path:`browser-review/departures-partial-${withRows ? 'rows' : 'empty'}-${engine}.png`});
        await page.locator('#details-close').click();
        boardFailed = [];
        await openStation(boardName, translated); await waitBoard();
        assert.equal(await page.locator('.departure-warning').count(), 1, 'reopening keeps cached partial status');
        assert.equal(boardRequests.length - before, 3, 'reopening does not add provider requests');
        const language = (await page.locator('#language').inputValue()) === 'ja' ? 'en' : 'ja';
        await page.locator('#language').selectOption(language);
        await page.waitForFunction(name => document.querySelector('#detail-content h2')?.textContent === name, translated[`name:${language}`]);
        await waitBoard();
        assert.equal(new URL(await page.locator('.departure-links a').first().getAttribute('href')).searchParams.get('fromName'), translated[`name:${language}`], 'journey labels still follow the selected language');
        assert.equal(await page.locator('.departure-warning').count(), 1, 'settings redraw retains the warning');
        assert.equal(boardRequests.length - before, 3);
        await page.evaluate(() => {window.__departureFixtureNow += 60_001;});
        assert.equal(boardRequests.length - before, 3, 'expiry alone never triggers an automatic retry');
        await openStation(boardName, translated); await waitBoard();
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
      const unmatchedMessage = 'No matching rail timetable stop was found within 400 m.';
      for (const [label, candidates] of [
        ['empty', []],
        ['filtered', [
          {type:'STOP', name:'Nearby bus', id:'bus', lat:35.7, lon:139.77, modes:['BUS']},
          {type:'STOP', name:'Distant rail', id:'far', lat:35.71, lon:139.77, modes:['SUBWAY']},
        ]],
      ]) {
        boardName = `No matched stop ${label}`; lookupResponse = candidates;
        const translated = {id:`fixture-unmatched-${label}`, 'name:en':`${boardName} English`, 'name:ja':`${boardName} 日本語`};
        const before = boardRequests.length;
        await openStation(boardName, translated); await waitBoard();
        assert.ok((await page.locator('.departures').textContent()).includes(unmatchedMessage));
        assert.doesNotMatch(await page.locator('.departures').textContent(), /No published timetable|No rail departures|could not load/);
        assert.equal(boardRequests.length - before, 1, 'unmatched lookup never starts a stop board');
        await page.screenshot({path:`browser-review/departures-unmatched-${label}-${engine}.png`});
        await page.locator('#details-close').click();
        lookupResponse = undefined; boardOrder = ['a', 'b']; boardFailed = []; boardTimes = [row];
        await openStation(boardName, translated); await waitBoard();
        assert.ok((await page.locator('.departures').textContent()).includes(unmatchedMessage));
        const language = (await page.locator('#language').inputValue()) === 'ja' ? 'en' : 'ja';
        await page.locator('#language').selectOption(language);
        await page.waitForFunction(name => document.querySelector('#detail-content h2')?.textContent === name, translated[`name:${language}`]);
        await waitBoard();
        assert.ok((await page.locator('.departures').textContent()).includes(unmatchedMessage));
        const link = new URL(await page.locator('.departure-links a').first().getAttribute('href'));
        assert.equal(link.searchParams.get('fromName'), translated[`name:${language}`]);
        assert.equal(link.searchParams.get('fromPlace'), '35.7,139.77');
        assert.equal(boardRequests.length - before, 1, 'empty lookup stays cached across reopening and a translated redraw');
        await page.evaluate(() => {window.__departureFixtureNow += 60_001;});
        assert.equal(boardRequests.length - before, 1, 'expiry alone never triggers a lookup');
        await openStation(boardName, translated); await waitBoard();
        assert.equal(boardRequests.length - before, 4);
        assert.equal(await page.locator('.departure-list > li').count(), 1);
        assert.ok(!(await page.locator('.departures').textContent()).includes(unmatchedMessage));
      }
      for (const [label, candidates] of [['null', null], ['object', {error:'synthetic private provider response'}], ['string', 'synthetic private provider response']]) {
        boardName = `Malformed stop lookup ${label}`; lookupResponse = candidates;
        const before = boardRequests.length;
        await openStation(boardName); await waitBoard();
        assert.equal(await page.locator('.departures').textContent(), 'DeparturesDepartures could not load. Try again later.');
        assert.equal(boardRequests.length - before, 1);
        if (label === 'object') await page.screenshot({path:`browser-review/departures-malformed-lookup-${engine}.png`});
        await page.locator('#details-close').click();
        lookupResponse = [];
        await openStation(boardName); await waitBoard();
        assert.ok((await page.locator('.departures').textContent()).includes(unmatchedMessage));
        assert.equal(boardRequests.length - before, 2, 'malformed lookup is evicted so normal reopening retries once');
        await openStation(boardName); await waitBoard();
        assert.equal(boardRequests.length - before, 2, 'successful recovery is cached normally');
      }
      assert.deepEqual(errors, []);
      console.log(`${engine}: partial-empty and partial-rows in both source orders, close/reopen, translated redraw, expiry, all-failed eviction, empty/filtered no-match cache and malformed lookup recovery passed; ${boardRequests.length} intercepted board fixture requests.`);
      // Invalid consumed envelopes fail per board, without discarding a healthy
      // sibling or making a malformed response look like a complete empty list.
      const malformedBodies = [
        ['null', null], ['array', []], ['scalar', 'synthetic private provider response'],
        ['missing-list', {}], ['false-list', {stopTimes:false}],
        ['string-list', {stopTimes:'synthetic private provider response'}], ['object-list', {stopTimes:{}}],
        ['null-row', {stopTimes:[null]}], ['scalar-row', {stopTimes:[false]}],
        ['headsign-object', {stopTimes:[{...row, headsign:{private:'synthetic private'}}]}],
        ['place-array', {stopTimes:[{...row, place:[]}]}],
        ['track-object', {stopTimes:[{...row, place:{...row.place, track:{private:'synthetic private'}}}]}],
        ['mixed-rows', {stopTimes:[row, null]}],
      ];
      lookupResponse = undefined; boardFailed = [];
      const beforeMalformed = boardRequests.length;
      for (const [label, body] of malformedBodies) for (const order of [['a','b'], ['b','a']]) for (const withRows of [false, true]) {
        boardName = `Malformed board ${label} ${order.join('')} ${withRows ? 'rows' : 'empty'}`;
        boardOrder = order; boardTimes = withRows ? [row] : []; boardBodies = {b:body};
        const before = boardRequests.length;
        await openStation(boardName); await waitBoard();
        assert.equal(boardRequests.length - before, 3);
        assert.equal(await page.locator('.departure-warning').textContent(), 'Some departures could not load. The board may be incomplete.');
        assert.equal(await page.locator('.departure-list > li').count(), Number(withRows));
        assert.doesNotMatch(await page.locator('.departures').textContent(), /No rail departures|No published timetable|No matching rail timetable stop|synthetic private/);
        assert.equal(await page.locator('.departures button').count(), 0);
        if (label === 'missing-list' && order[0] === 'a') await page.screenshot({path:`browser-review/departures-malformed-${withRows ? 'rows' : 'empty'}-${engine}.png`});
        await page.locator('#details-close').click(); boardBodies = {};
        await openStation(boardName); await waitBoard();
        assert.equal(await page.locator('.departure-warning').count(), 1, 'malformed partial outcome stays cached');
        assert.equal(boardRequests.length - before, 3);
        await page.evaluate(() => {window.__departureFixtureNow += 60_001;});
        assert.equal(boardRequests.length - before, 3, 'expiry cannot start an automatic retry');
        await openStation(boardName); await waitBoard();
        assert.equal(boardRequests.length - before, 6);
        assert.equal(await page.locator('.departure-warning').count(), 0);
        assert.equal(await page.locator('.departure-list > li').count(), Number(withRows));
        if (!withRows) assert.match(await page.locator('.departures').textContent(), /No rail departures in the published timetable soon/);
      }
      for (const malformedRows of [false, true]) for (const order of [['a','b'], ['b','a']]) {
        boardName = `All boards malformed ${malformedRows ? 'rows' : 'envelopes'} ${order.join('')}`; boardOrder = order;
        boardBodies = malformedRows ? {a:{stopTimes:[null]}, b:{stopTimes:[{...row, headsign:{private:'synthetic private'}}]}} :
          {a:{}, b:{stopTimes:{error:'synthetic private provider response'}}};
        const before = boardRequests.length;
        await openStation(boardName); await waitBoard();
        assert.equal(await page.locator('.departures').textContent(), 'DeparturesDepartures could not load. Try again later.');
        assert.equal(boardRequests.length - before, 3);
        if (order[0] === 'a') await page.screenshot({path:`browser-review/departures-all-malformed-${engine}.png`});
        boardBodies = {}; boardTimes = [row];
        await openStation(boardName); await waitBoard();
        assert.equal(boardRequests.length - before, 6, 'all-malformed rejection is evicted');
        assert.equal(await page.locator('.departure-list > li').count(), 1);
        assert.equal(await page.locator('.departure-warning').count(), 0);
        await openStation(boardName); await waitBoard();
        assert.equal(boardRequests.length - before, 6, 'successful normal reopening is cached');
      }
      assert.deepEqual(errors, []);
      console.log(`${engine}: malformed-board envelopes with healthy empty/populated siblings in both orders, cached partial status, expiry, and all-malformed eviction/recovery passed; ${boardRequests.length - beforeMalformed} intercepted board fixture requests.`);
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
        assert.doesNotMatch(await page.locator('.departures').textContent(), /No rail departures|No published timetable|No matching rail timetable stop|synthetic private/);
        assert.equal(closeRequests.length, 3, 'reopening after a pending Close retains the cached partial result');
      }
      assert.deepEqual(errors, []);
      console.log(`${engine}: Close during pending partial-empty and partial-rows, late settlement remaining hidden, and cached reopening passed; 6 intercepted fixture requests.`);
      await context.close();
    } finally {await browser.close();}
  }
} finally {await server.close();}
