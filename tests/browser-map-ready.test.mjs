import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForMapReady} from '../scripts/browser-map-ready.mjs';

test('map readiness keeps the real selector, attached state and 60 second gate', async () => {
  const calls = [];
  await waitForMapReady({waitForSelector: async (...args) => calls.push(args), locator: () => assert.fail('no diagnostic on success')}, [], {log: () => assert.fail('no diagnostic on success')});
  assert.deepEqual(calls, [['body[data-map-ready="true"]', {state: 'attached', timeout: 60000}]]);
});

test('startup timeout reports page errors and status but rethrows the original failure', async () => {
  const timeout = new Error('original readiness timeout'), errors = ['missing export'], messages = [];
  const page = {
    waitForSelector: async () => { throw timeout; },
    locator: selector => { assert.equal(selector, '#status'); return {textContent: async options => { assert.deepEqual(options, {timeout: 1000}); return 'Map libraries could not load.'; }}; },
  };
  await assert.rejects(waitForMapReady(page, errors, {log: (...args) => messages.push(args)}), error => error === timeout);
  assert.deepEqual(messages, [['MAP_STARTUP_DIAGNOSTIC', JSON.stringify({errors, status: 'Map libraries could not load.'})]]);
  assert.deepEqual(errors, ['missing export']);
});

test('unreadable page or failed logging cannot hide or replace a readiness failure', async () => {
  const timeout = new Error('original readiness timeout');
  await assert.rejects(waitForMapReady({
    waitForSelector: async () => { throw timeout; },
    locator: () => ({textContent: async () => { throw new Error('page closed'); }}),
  }, [], {log: () => { throw new Error('logging failed'); }}), error => error === timeout);
});
