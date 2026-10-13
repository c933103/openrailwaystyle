import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launchBrowser} from '../../scripts/browser.mjs';
import {installEmptyMapProviders,emptyReferenceFixture} from '../../scripts/browser-renderer-fixture.mjs';
import {waitUntil,setDefaultTimeout} from '../../scripts/wait-until.mjs';

// Live first-party code and methods data; external providers are explicitly
// empty fixtures. This check certifies this snapshot's render integration only.
const root=process.argv[2],base=(process.env.MAP_BASE_URL||'https://c933103.github.io/openrailwaystyle/').replace(/\/?$/,'/');
const manifest=JSON.parse(await readFile(`${root}/methods-manifest.json`));
const receipt=JSON.parse(await readFile(`${root}-verification.json`));
assert.equal(receipt.sha256,manifest.sha256,'Samples must come from the validated snapshot');
let samples=[];
for(const method of ['rail','4th_rail','ground-level_power_supply']) {
  const f=receipt.samples[method];
  if(f&&f.tags.power_state==='present')samples.push({category:method,id:f.id,center:f.geometry.coordinates[Math.floor(f.geometry.coordinates.length/2)],layer:'electrification-conductor-rails'});
}
const charger=receipt.samples.charging_station;
if(charger&&charger.tags.power_state==='present')samples.push({category:'charging_station',id:charger.id,center:charger.geometry.coordinates,layer:'electrification-charging-points'});
if(process.env.POWER_CHECK_CATEGORIES){const categories=process.env.POWER_CHECK_CATEGORIES.split(',');assert.ok(categories.every(c=>['rail','4th_rail','ground-level_power_supply','charging_station'].includes(c)));samples=samples.filter(s=>categories.includes(s.category));assert.equal(samples.length,categories.length);}
assert.ok(samples.length,'Snapshot has no present method/charger sample');
if(process.env.POWER_CHECK_VIEWPORT)assert.ok(['desktop','mobile'].includes(process.env.POWER_CHECK_VIEWPORT),'Unknown viewport');
const proxyValue=process.env.HTTPS_PROXY||process.env.HTTP_PROXY||process.env.ALL_PROXY;
const proxyUrl=proxyValue?new URL(proxyValue):null;
const proxy=proxyUrl?{server:proxyUrl.origin,...(proxyUrl.username?{username:decodeURIComponent(proxyUrl.username),password:decodeURIComponent(proxyUrl.password)}:{})}:undefined;
const browser=await launchBrowser({headless:true,...(!base.startsWith('http://127.0.0.1')&&proxy?{proxy}:{})});
const deadline=setTimeout(()=>{console.error('Published Power geometry check exceeded five minutes');process.exit(1);},300000);deadline.unref();
try {
  for(const [kind,width,height] of [['desktop',1365,900],['mobile',412,915]].filter(p=>!process.env.POWER_CHECK_VIEWPORT||p[0]===process.env.POWER_CHECK_VIEWPORT)) {
    const page=await browser.newPage({viewport:{width,height},hasTouch:kind==='mobile',deviceScaleFactor:2,serviceWorkers:'block'});
    setDefaultTimeout(page,60000);
    await installEmptyMapProviders(page.context(),base,{firstParty:'network'});
    let deliveredHash;
    await page.route('**/data/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path.endsWith('/power-methods.geojson')) {
        // Node-side HTTP capture avoids Chromium's inspector body-cache limit
        // for this 66 MB file. Fulfill only the real, unchanged response bytes.
        const response=await route.fetch({maxRedirects:0});
        assert.equal(response.status(),200,'Real methods HTTP status');
        const body=await response.body();
        deliveredHash=createHash('sha256').update(body).digest('hex');
        assert.equal(deliveredHash,manifest.sha256,'Actual HTTP snapshot bytes');
        const headers=Object.fromEntries(Object.entries(response.headers()).filter(([k])=>!['content-encoding','content-length','transfer-encoding','connection','set-cookie'].includes(k.toLowerCase())));
        await route.fulfill({status:response.status(),headers,body});
        await response.dispose();
        return;
      }
      if(path.endsWith('/power-facilities.geojson'))return route.fallback();
      const reference=emptyReferenceFixture(path);
      return route.fulfill(reference||{json:{tiles:[],features:[],countries:{}}});
    });
    const first=samples[0];
    await page.goto(`${base}?mode=electrification&language=en&autoGlobe=0&relief=0&stations=0&names=0&inactive=0&trackCounts=0&transport=0&destinations=0&constraints=0#16/${first.center[1]}/${first.center[0]}`,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('body[data-map-ready="true"]',{state:'attached'});
    await page.evaluate(async()=>{window.powerReviewMap=(await import(document.querySelector('script[type="module"]').src)).map;});
    for(const sample of samples) {
      await page.evaluate(center=>window.powerReviewMap.jumpTo({center,zoom:16}),sample.center);
      await waitUntil(page,({id,layer})=>window.powerReviewMap.queryRenderedFeatures({layers:[layer]}).some(f=>`${f.properties.osm_type}-${f.properties.osm_id}`===id),sample,{timeout:45000});
      console.log(JSON.stringify({kind,...sample,result:'rendered actual published OSM geometry'}));
    }
    assert.equal(deliveredHash,manifest.sha256,'Browser must receive the validated published snapshot bytes');
    await page.close();
  }
}finally {clearTimeout(deadline);await browser.close();}
