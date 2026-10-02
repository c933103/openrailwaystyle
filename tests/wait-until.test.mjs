import test from 'node:test';
import assert from 'node:assert/strict';
import {waitUntil} from '../scripts/wait-until.mjs';

test('browser checks wait for an async condition to hold', async () => {
  let calls = 0;
  const page = {evaluate: async (fn, arg) => { calls++; return fn(arg); }};
  const ready = Date.now() + 250;
  assert.equal(await waitUntil(page, async () => Date.now() > ready && 'done', undefined, {timeout: 2000, polling: 10}), 'done');
  assert.ok(Date.now() >= ready && calls > 1, 'polled until the condition held');
  await assert.rejects(waitUntil(page, async () => false, undefined, {timeout: 100, polling: 10}), /Timed out after 100 ms/);
  // A replaced page is tried again; other errors stop the wait.
  let first = true;
  const navigating = {evaluate: async () => { if (first) { first = false; throw new Error('Execution context was destroyed'); } return true; }};
  assert.equal(await waitUntil(navigating, async () => true, undefined, {timeout: 1000, polling: 10}), true);
  await assert.rejects(waitUntil({evaluate: async () => { throw new Error('boom'); }}, async () => true), /boom/);
});
