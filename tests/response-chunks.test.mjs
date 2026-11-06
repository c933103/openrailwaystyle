import test from 'node:test';
import assert from 'node:assert/strict';
import {responseChunks} from '../scripts/response-chunks.mjs';

// Synthetic transport only: no provider requests or captured data.
function response({cancelMode = 'resolved', failure} = {}) {
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3])];
  const seen = {reads: 0, cancels: 0, releases: 0};
  return {seen, chunks, body: {getReader: () => ({
    async read() {
      seen.reads++;
      if (failure) throw failure;
      return seen.reads <= chunks.length ? {done: false, value: chunks[seen.reads - 1]} : {done: true};
    },
    cancel() {
      seen.cancels++;
      if (cancelMode === 'throws') throw new Error('Synthetic cleanup throw');
      if (cancelMode === 'rejects') return Promise.reject(new Error('Synthetic cleanup rejection'));
      if (cancelMode === 'pending') return new Promise(() => {});
      return Promise.resolve();
    },
    releaseLock() { seen.releases++; },
  })}};
}

test('a fully consumed response preserves every chunk, releases once and needs no cancellation', async () => {
  const input = response(), chunks = [];
  for await (const chunk of responseChunks(input)) chunks.push(chunk);
  assert.deepEqual(chunks, input.chunks);
  assert.equal(chunks[0], input.chunks[0]);
  assert.deepEqual(input.seen, {reads: 3, cancels: 0, releases: 1});
});

for (const cancelMode of ['resolved', 'pending', 'rejects', 'throws']) {
  test(`an early stop does not read another chunk or await ${cancelMode} cancellation`, async () => {
    const input = response({cancelMode});
    for await (const chunk of responseChunks(input)) { assert.equal(chunk, input.chunks[0]); break; }
    assert.deepEqual(input.seen, {reads: 1, cancels: 1, releases: 1});
  });
  test(`a consumer error remains primary with ${cancelMode} cancellation`, async () => {
    const input = response({cancelMode}), failure = new Error('Original byte-budget error');
    await assert.rejects(async () => { for await (const chunk of responseChunks(input)) { void chunk; throw failure; } }, error => error === failure);
    assert.deepEqual(input.seen, {reads: 1, cancels: 1, releases: 1});
  });
  test(`a read failure remains primary with ${cancelMode} cancellation`, async () => {
    const failure = new Error('Original body-read failure'), input = response({cancelMode, failure});
    await assert.rejects(async () => { for await (const chunk of responseChunks(input)) assert.fail(`Unexpected ${chunk}`); }, error => error === failure);
    assert.deepEqual(input.seen, {reads: 1, cancels: 1, releases: 1});
  });
}

test('a real errored response releases its lock and retains the read failure', async () => {
  const failure = new Error('Synthetic interrupted transport');
  const body = new ReadableStream({start(controller) { controller.error(failure); }});
  await assert.rejects(async () => { for await (const chunk of responseChunks(new Response(body))) assert.fail(`Unexpected ${chunk}`); }, error => error === failure);
  assert.equal(body.locked, false);
});
