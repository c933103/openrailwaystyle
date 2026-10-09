import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BROWSER_LIBRARIES} from './browser-libraries.mjs';

// Inspect only requests the tested page already makes. Optional app/data
// failures are outside this contract, and no checkout bytes replace responses.
export function observeRequiredBrowserLibraries(page, base) {
  const required = new Map(BROWSER_LIBRARIES.map(library => {
    let finish;
    const done = new Promise(resolve => {finish = resolve;});
    return [new URL(library.target, base).href, {...library, requested: false, done, finish}];
  }));
  const settle = (entry, result) => {
    if (entry.result) return;
    entry.result = result;
    entry.finish();
  };
  const onRequest = request => {
    const entry = required.get(request.url());
    if (entry) entry.requested = true;
  };
  const onFailed = request => {
    const entry = required.get(request.url());
    if (entry) settle(entry, {error: `request failed: ${request.failure()?.errorText || 'unknown error'}`});
  };
  const onResponse = response => {
    const entry = required.get(response.url());
    if (!entry || entry.result) return;
    (async () => {
      const status = response.status();
      assert.equal(status, 200, `HTTP ${status}`);
      const type = (response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
      assert.match(type, entry.target.endsWith('.css') ? /^text\/css$/ : /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/,
        `unexpected Content-Type: ${type || '(missing)'}`);
      const failed = await response.finished();
      if (failed) throw new Error(`incomplete response: ${failed.message || failed}`);
      const body = await response.body();
      const sha256 = createHash('sha256').update(body).digest('hex');
      assert.equal(sha256, entry.sha256, 'response bytes differ from the pinned distribution');
      settle(entry, {status, type, bytes: body.length, sha256});
    })().catch(error => settle(entry, {error: error.message}));
  };
  page.on('request', onRequest);
  page.on('requestfailed', onFailed);
  page.on('response', onResponse);
  const dispose = () => {
    page.off('request', onRequest);
    page.off('requestfailed', onFailed);
    page.off('response', onResponse);
  };
  return {
    async assertReady({timeout = 10000} = {}) {
      let timer;
      try {
        await Promise.race([
          Promise.all([...required.values()].map(entry => entry.done)),
          new Promise(resolve => {timer = setTimeout(resolve, timeout);}),
        ]);
        const errors = [...required].flatMap(([url, entry]) => {
          const error = entry.result?.error || (!entry.result && (entry.requested ? 'response did not complete' : 'no request was observed'));
          return error ? [`${url}: ${error}`] : [];
        });
        assert.equal(errors.length, 0, 'Required first-party browser libraries failed:\n' + errors.join('\n'));
        return [...required].map(([url, entry]) => ({url, ...entry.result}));
      } finally {clearTimeout(timer); dispose();}
    },
    dispose,
  };
}
