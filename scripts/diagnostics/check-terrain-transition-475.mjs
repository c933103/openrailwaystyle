import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {launchBrowser} from '../browser.mjs';
import {installEmptyMapProviders} from '../browser-renderer-fixture.mjs';
import {serveAtlasAppFixture} from '../atlas-app-browser-fixture.mjs';

const fixture = await serveAtlasAppFixture();
const base = fixture.origin + '/';
const traces = [];
const deadline = 55_000;
const browser = await launchBrowser({headless: true});
const near = (a, b) => Math.abs(a - b) < 0.04;
try {
  for (const arm of ['activation-only','camera-only','combined']) {
    const row = {arm, errors: [], requests: {completed: 0, failed: 0}};
    traces.push(row);
    const context = await browser.newContext({viewport: {width: 1365, height: 900}, reducedMotion: 'no-preference'});
    try {
      await installEmptyMapProviders(context, base);
      const page = await context.newPage();
      page.on('pageerror', error => row.errors.push(error.message));
      page.on('requestfinished', () => row.requests.completed++);
      page.on('requestfailed', () => row.requests.failed++);
      await page.goto(base + '?mode=infrastructure&relief=1&inactive=0&detail=0#10.2/35/135',
                      {waitUntil: 'domcontentloaded'});
      await page.waitForSelector('body[data-map-ready="true"]', {timeout: deadline});
      const button = page.getByRole('button', {name: /Inspect 3D terrain and seabed/});
      await button.waitFor({state: 'visible'});
      await page.evaluate(async () => {
        const {map} = await import(document.querySelector('script[type="module"]').src);
        if (!map.loaded() || !map.areTilesLoaded() || map.isMoving())
          await new Promise(resolve => map.once('idle', resolve));
      });
      assert.equal(await button.getAttribute('aria-pressed'), 'false', 'begin without mesh');
      row.start = await page.evaluate(async arm => {
        const src = document.querySelector('script[type="module"]').src;
        const {map} = await import(src);
        const terrainUrl = new URL('./terrain-3d.mjs', src);
        terrainUrl.search = new URL(src).search;
        const {terrain3DViewTarget} = await import(terrainUrl.href);
        const point = () => ({zoom: map.getZoom(), pitch: map.getPitch(),
          mesh: map.getTerrain()?.source ?? null, moving: map.isMoving(), loaded:map.areTilesLoaded()});
        const perf = {events: [], held: {mesh:0, camera:0}, start:null, last:null,
                      maxFrameGap:0, frames:0, idle:null, done:false};
        const mark = (name, data = {}) => {
          if (perf.events.length < 160)
            perf.events.push({event:name, ms:Math.round(performance.now()-perf.start), ...point(), ...data});
        };
        const standardTerrain = map.setTerrain.bind(map);
        const standardEase = map.easeTo.bind(map);
        if (arm === 'camera-only') map.setTerrain = data => {
          if (data?.source !== 'terrain3d') return standardTerrain(data);
          perf.held.mesh++;
          return map;
        };
        if (arm === 'activation-only') map.easeTo = options => {
          if (options.pitch === 60 && options.zoom === 12.3 && !perf.held.camera) {
            perf.held.camera++;
            mark('hold-click-camera');
            return map;
          }
          return standardEase(options);
        };
        const frame = t => {
          if (perf.done) return;
          if (perf.start !== null) {
            perf.maxFrameGap = Math.max(perf.maxFrameGap, t - (perf.last ?? perf.start));
            perf.last = t;
            perf.frames++;
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        for (const event of ['movestart','moveend','zoomstart','zoomend','pitchstart','pitchend','terrain','webglcontextlost'])
          map.on(event, () => { if (perf.start !== null && !perf.done) mark(event); });
        map.on('idle', () => {
          if (perf.start !== null && !perf.done && !map.isMoving() ) {
            const p = point();
            const target = arm === 'activation-only' ? p.mesh === 'terrain3d' :
              Math.abs(p.zoom - 12.3) < .04 && Math.abs(p.pitch - 60) < .04;
            if (target) {
              mark('idle');
              perf.idle = Math.round(performance.now() - perf.start);
              perf.done = true;
            }
          }
        });
        const start = () => { perf.start = performance.now(); mark('start'); };
        if (arm !== 'camera-only') document.querySelector('.maplibregl-ctrl-top-right button[aria-label^="Inspect 3D terrain"]')
          .addEventListener('click',start,{capture:true,once:true});
        window.terrain475 = {perf, point, runCamera() {
          start();
          const {lat} = map.getCenter();
          const view = terrain3DViewTarget({zoom:map.getZoom(),detail:0,active:false,
            globe:map.getProjection()?.type === 'globe',latitude:lat});
          map.easeTo({...view,duration:750});
        }};
        return point();
      }, arm);
      assert.ok(near(row.start.zoom,10.2) && near(row.start.pitch,0) && !row.start.mesh,
                'baseline camera, pitch, and mesh must match across arms');
      if (arm === 'camera-only') await page.evaluate(() => window.terrain475.runCamera());
      else await button.click({timeout: deadline});
      await page.waitForFunction(() => window.terrain475.perf.done, null, {timeout: deadline})
        .catch(error => {row.problem=error.message;});
      Object.assign(row, await page.evaluate(() => {
        const {perf, point} = window.terrain475;
        const settled = perf.done;
        perf.done = true;
        return {settled, ...perf, finish:point()};
      }));
      assert.ok(row.settled, `${arm}: no qualifying idle by the diagnostic deadline`);
      assert.equal(row.errors.length,0, `${arm}: page errors`);
      assert.equal(row.finish.mesh, arm === 'camera-only' ? null : 'terrain3d');
      assert.ok(near(row.finish.zoom, arm === 'activation-only' ? 10.2 : 12.3));
      assert.ok(near(row.finish.pitch, arm === 'activation-only' ? 0 : 60));
      if (arm === 'activation-only') assert.equal(row.held.camera, 1, 'only intended click motion intercepted');
      if (arm === 'camera-only') assert.ok(row.held.mesh > 0, 'stock pitch attempted to activate terrain');
      if (arm === 'combined') assert.deepEqual(row.held,{mesh:0,camera:0});
      console.log(JSON.stringify({arm, idleMs:row.idle, frameGapMs:row.maxFrameGap, finish:row.finish}));
    } catch (error) {
      row.failure = error.message;
    } finally { await context.close(); }
  }
} finally {
  await mkdir('browser-review',{recursive:true});
  await writeFile('browser-review/terrain-transition-475.json',JSON.stringify({build:process.env.GITHUB_SHA??null, synthetic:true,traces},null,2));
  await browser.close();
  await fixture.close();
}
assert.equal(traces.length,3);
assert.deepEqual(traces.filter(row=>row.failure).map(({arm,failure})=>({arm,failure})),[]);
