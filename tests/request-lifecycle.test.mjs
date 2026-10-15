import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestLifecycle} from '../scripts/request-lifecycle.mjs';

test('fixture fulfillment is distinct from browser headers and completed body', () => {
  let now = 100;
  const trace = createRequestLifecycle({now: () => now});
  const request = {url: () => 'https://user:secret@fixture.invalid/tiles/9/1/2?token=secret#secret'};
  trace.start(request); now += 5; trace.fulfilled(request);
  let state = trace.snapshot();
  assert.equal(state.pendingCount, 1);
  assert.deepEqual(state.pending[0], {id: 1, url: 'https://fixture.invalid/tiles/9/1/2', started: 0, fulfilled: 5});
  assert.equal(state.counts.finished, 0);
  now += 4; trace.responded({request: () => request, status: () => 200});
  assert.equal(trace.snapshot().pending[0].responded, 9);
  now += 2; trace.finished(request); state = trace.snapshot();
  assert.equal(state.pendingCount, 0);
  assert.deepEqual(state.counts, {started: 1, fulfilled: 1, responded: 1, finished: 1, failed: 0});
  assert.equal(state.recent[0].finished, 11);
  assert.doesNotMatch(JSON.stringify(state), /secret|token|user:/);
});

test('duplicate URLs retain independent request identities and failures', () => {
  const trace = createRequestLifecycle();
  const a = {url: () => 'https://fixture.invalid/tile'}, b = {url: a.url};
  trace.start(a); trace.start(b); trace.fulfilled(a); trace.failed(b);
  const state = trace.snapshot();
  assert.equal(state.pendingCount, 1); assert.equal(state.pending[0].id, 1);
  assert.equal(state.recent[0].id, 2); assert.ok('failed' in state.recent[0]);
  assert.equal(state.counts.finished, 0); assert.equal(state.counts.failed, 1);
});

test('bounded snapshots retain exact counts and do not expose live records', () => {
  const trace = createRequestLifecycle({limit: 2});
  for (let i = 0; i < 5; i++) trace.finished({url: () => 'invalid URL'});
  for (let i = 0; i < 3; i++) trace.start({url: () => 'https://fixture.invalid/pending'});
  const state = trace.snapshot();
  assert.equal(state.counts.started, 8); assert.equal(state.counts.finished, 5);
  assert.equal(state.recent.length, 2); assert.equal(state.recent[0].id, 4);
  assert.equal(state.pendingCount, 3); assert.equal(state.pending.length, 2); assert.equal(state.pendingTruncated, true);
  state.pending[0].url = 'changed'; state.counts.started = 0;
  assert.equal(trace.snapshot().counts.started, 8);
  assert.equal(trace.snapshot().pending[0].url, 'https://fixture.invalid/pending');
});

test('a repeated observation does not double-count the same lifecycle event', () => {
  const trace = createRequestLifecycle();
  const request = {url: () => 'https://fixture.invalid/tile'};
  trace.fulfilled(request); trace.fulfilled(request);
  trace.finished(request); trace.finished(request);
  assert.equal(trace.snapshot().counts.fulfilled, 1);
  assert.equal(trace.snapshot().counts.finished, 1);
  assert.equal(trace.snapshot().recent.length, 1);
});
