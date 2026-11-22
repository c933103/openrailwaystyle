import assert from 'node:assert/strict';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';

const base='http://127.0.0.1:4173/';
const browser = await launchBrowser();
try {
  const context = await browser.newContext({serviceWorkers:'block'});
  await installEmptyMapProviders(context, base);
  const urls = [];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64');
  await context.route('https://indianopenmaps.com/**', route => {
    urls.push(route.request().url());
    return route.fulfill({contentType:'image/png',body:png});
  });
  const page = await context.newPage();
  await page.goto(base+'?background=map&autoGlobe=0#7/22.3/114.17');
  await page.waitForSelector('body[data-map-ready="true"]',{timeout:60000});
  const option = page.getByRole('button',{name:'Soviet topo',exact:true});
  assert.equal(await option.isVisible(), true);
  assert.equal(urls.length, 0);
  await Promise.all([page.waitForResponse(r=>r.url().startsWith('https://indianopenmaps.com/')), option.click()]);
  assert.equal(await option.getAttribute('aria-pressed'), 'true');
  await page.getByRole('button',{name:'Map',exact:true}).click();
  assert.equal(await option.getAttribute('aria-pressed'), 'false');
  assert.ok(urls.every(url => /^https:\/\/indianopenmaps\.com\/world\/topo\/russian\//.test(url)));
} finally { await browser.close(); }
