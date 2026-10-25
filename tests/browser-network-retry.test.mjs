import test from 'node:test';
import assert from 'node:assert/strict';
import {guardBrowserNetwork} from '../scripts/browser-network-guard.mjs';

// The real Route.fetch/TCP reset and redirect cases run in the required
// check-network-guard-browser.mjs check using public routing APIs. Keep these
// browserless cases for the full eligibility, error and redaction matrix.

const body = Buffer.from('real first-party fixture bytes');
const response = (status = 200, headers = {}) => ({
  status: () => status, headers: () => headers, body: async () => body,
});
const reset = () => new Error('route.fetch: socket hang up\nCall log:\n  - local request');
async function harness({url = 'http://127.0.0.1:4173/asset.mjs?private=query', method = 'GET', postData, fetch} = {}) {
  const handlers = [], warnings = [], blocked = [], calls = [], fulfilled = [], aborted = [];
  const context = {route: async (match, handler) => handlers.push(handler), unroute() {}, on() {}, pages: () => [], routeWebSocket() {}};
  await guardBrowserNetwork(context, {bases: ['https://deployed.example/atlas/'], blocked, warn: text => warnings.push(text)});
  const route = {
    request: () => ({url: () => url, method: () => method, postDataBuffer: () => postData}),
    fetch: async options => {calls.push(options); return fetch(options, calls.length);},
    fulfill: async options => fulfilled.push(options), abort: async reason => aborted.push(reason),
  };
  return {calls, warnings, blocked, fulfilled, aborted, run: async (operation = 'fetch', options = {}) => {
    await context.route('**/*', route => route[operation](options));
    return handlers.at(-1)(route);
  }};
}

test('one exact loopback reset retries GET/HEAD once and returns actual response bytes', async () => {
  for (const method of ['GET', 'HEAD']) for (const operation of ['fetch', 'continue']) {
    const h = await harness({method, fetch: async (options, attempt) => {if (attempt === 1) throw reset(); return response();}});
    const result = await h.run(operation, {maxRetries: 100, maxRedirects: 100});
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls[0], h.calls[1]);
    assert.equal(h.calls[0].maxRetries, 0); assert.equal(h.calls[0].maxRedirects, 0);
    assert.equal(h.calls[0].url, 'http://127.0.0.1:4173/asset.mjs?private=query');
    assert.deepEqual(operation === 'fetch' ? await result.body() : h.fulfilled[0].body, body);
    assert.equal(h.warnings.length, 2);
    assert.match(h.warnings[0], /attempt 1\/2; retrying 2\/2/);
    assert.match(h.warnings[1], /returned on attempt 2\/2/);
    assert.ok(h.warnings.every(text => !text.includes('private') && !text.includes('query')));
    assert.deepEqual(h.blocked, []); assert.deepEqual(h.aborted, []);
  }
});

test('a second reset exhausts the fixed budget and fails without fulfillment', async () => {
  const error = new Error('route.fetch: read ECONNRESET\nCall log:\n  - local request');
  const h = await harness({fetch: async () => {throw error;}});
  await assert.rejects(h.run('fetch', {maxRetries: 100}), value => value === error);
  assert.equal(h.calls.length, 2); assert.deepEqual(h.fulfilled, []);
  assert.match(h.warnings.at(-1), /exhausted 2\/2/);
});

test('non-idempotent methods, body-bearing reads and deployment URLs never retry', async () => {
  for (const setup of [
    {method: 'POST'}, {method: 'PUT'}, {method: 'DELETE'}, {postData: Buffer.from('body')},
    {url: 'https://deployed.example/atlas/asset.mjs'},
  ]) {
    const h = await harness({...setup, fetch: async () => {throw reset();}});
    await assert.rejects(h.run('fetch', {maxRetries: 100}), /socket hang up/);
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].maxRetries, 0); assert.deepEqual(h.warnings, []);
  }
  for (const options of [{method: 'POST'}, {postData: 'body'}, {url: 'https://deployed.example/atlas/asset.mjs'}]) {
    const h = await harness({fetch: async () => {throw reset();}});
    await assert.rejects(h.run('fetch', {...options, maxRetries: 100}), /socket hang up/);
    assert.equal(h.calls.length, 1); assert.deepEqual(h.warnings, []);
  }
});

test('timeouts, refused connections, teardown, body errors and reset text in a call log never retry', async () => {
  for (const message of [
    'route.fetch: connect ECONNREFUSED 127.0.0.1', 'route.fetch: Timeout 30000ms exceeded.',
    'route.fetch: Target page, context or browser has been closed', 'route.fetch: Request context disposed.',
    'route.fetch: aborted', 'route.fetch: failed to decompress gzip encoding: read ECONNRESET',
    'route.fetch: 503 Service Unavailable\nResponse text:\nread ECONNRESET',
    'route.fetch: failed\nCall log:\nroute.fetch: socket hang up',
  ]) {
    const error = new Error(message), h = await harness({fetch: async () => {throw error;}});
    await assert.rejects(h.run(), value => value === error);
    assert.equal(h.calls.length, 1); assert.deepEqual(h.warnings, []);
  }
});

test('HTTP errors keep their status and bytes without retry, including after one reset', async () => {
  for (const status of [404, 429, 500, 503]) for (const precedingReset of [false, true]) {
    const h = await harness({fetch: async (options, attempt) => {
      if (precedingReset && attempt === 1) throw reset();
      return response(status);
    }});
    await h.run('continue');
    assert.equal(h.calls.length, precedingReset ? 2 : 1);
    assert.equal(h.fulfilled[0].status, status); assert.deepEqual(h.fulfilled[0].body, body);
    assert.deepEqual(h.aborted, []);
  }
});

test('unsafe targets and rewrites never reach transport even when the caller requests retries', async () => {
  for (const url of ['https://provider.invalid/tile', 'http://192.0.2.1/asset', 'http://user:secret@127.0.0.1/asset', 'https://deployed.example/elsewhere']) {
    for (const rewrite of [false, true]) {
      const h = await harness({...(rewrite ? {} : {url}), fetch: async () => assert.fail('unsafe transport')});
      await assert.rejects(h.run('fetch', {...(rewrite ? {url} : {}), maxRetries: 100, maxRedirects: 100}), /non-fixture provider/);
      assert.equal(h.calls.length, 0); assert.deepEqual(h.warnings, []); assert.equal(h.blocked.length, 1);
      assert.ok(!h.blocked[0].includes('secret'));
    }
  }
});

test('redirects before or after a reset stay blocked, without another fetch or fulfillment', async () => {
  for (const status of [301, 302, 307, 308]) for (const precedingReset of [false, true]) {
    const h = await harness({fetch: async (options, attempt) => {
      assert.equal(options.maxRedirects, 0); assert.equal(options.maxRetries, 0);
      if (precedingReset && attempt === 1) throw reset();
      return response(status, {location: 'https://provider.invalid/never-fetch'});
    }});
    await assert.rejects(h.run('fetch', {maxRedirects: 100, maxRetries: 100}), /redirected/);
    assert.equal(h.calls.length, precedingReset ? 2 : 1); assert.deepEqual(h.fulfilled, []); assert.equal(h.blocked.length, 1);
  }
});
