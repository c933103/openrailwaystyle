import test from 'node:test';
import assert from 'node:assert/strict';
import {crossingResponseText, crossingFailureAction, crossingRetryDelay} from '../scripts/crossing-request.mjs';

function streamed(chunks, {failure, cancel} = {}) {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(Buffer.from(chunks[index++]));
      else if (failure) controller.error(failure);
      else controller.close();
    },
    cancel,
  }, {highWaterMark: 0}));
}

test('stream cap cancels both success and error bodies before buffering the remainder', async () => {
  for (const status of [200, 503]) {
    let cancelled = 0;
    const source = streamed(['abc', 'def', 'never read'], {cancel: () => cancelled++});
    const response = new Response(source.body, {status}), usage = {bytes: 1};
    await assert.rejects(crossingResponseText(response, usage, 5), /^Error: Download budget exceeded$/);
    assert.equal(usage.bytes, 7);
    assert.equal(cancelled, 1);
  }
});

test('partial read errors keep their consumed-byte count for the next response', async () => {
  const usage = {bytes: 0};
  await assert.rejects(crossingResponseText(streamed(['abc'], {failure: new Error('socket reset')}), usage, 5), /socket reset/);
  assert.equal(usage.bytes, 3);
  await assert.rejects(crossingResponseText(streamed(['def']), usage, 5), /Download budget exceeded/);
  assert.equal(usage.bytes, 6);
});

test('budget remains primary if stream cancellation fails', async () => {
  const response = streamed(['oversized'], {cancel: () => { throw new Error('cancel failed'); }});
  await assert.rejects(crossingResponseText(response, {bytes: 0}, 1), /Download budget exceeded/);
});

test('UTF-8 split across chunks and exact byte boundary decode without data changes', async () => {
  const bytes = Buffer.from('α railway'), usage = {bytes: 0};
  const response = streamed([bytes.subarray(0, 1), bytes.subarray(1)]);
  assert.equal(await crossingResponseText(response, usage, bytes.length), 'α railway');
  assert.equal(usage.bytes, bytes.length);
});

test('permanent status wins over a misleading resource-error body', () => {
  assert.equal(crossingFailureAction({status: 403, detail: 'runtime error: Query timed out', error: new Error()}), 'stop');
  assert.equal(crossingFailureAction({status: 504, detail: 'Gateway Timeout', error: new Error()}), 'retry');
  assert.equal(crossingFailureAction({status: 200, detail: 'runtime error: Query run out of memory', error: new Error()}), 'split');
});

test('invalid or elapsed Retry-After keeps local backoff; excessive wait is never capped early', () => {
  assert.equal(crossingRetryDelay(0, 'invalid', 0), 60000);
  assert.equal(crossingRetryDelay(1, 'Thu, 01 Jan 1970 00:00:01 GMT', 60000), 120000);
  assert.equal(crossingRetryDelay(0, '900', 0), 900000);
  assert.equal(crossingRetryDelay(0, '901', 0), null);
  assert.equal(crossingRetryDelay(0, '9'.repeat(400), 0), null);
});

test('an unresponsive stream cancellation cannot postpone the download-budget error', async () => {
  let cancellations = 0, pulls = 0;
  const response = new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(Buffer.from('oversized')); },
    cancel() { cancellations++; return new Promise(() => {}); },
  }, {highWaterMark:0}));
  const usage = {bytes:0};
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve('still waiting for cancellation'), 100); });
  const outcome = await Promise.race([crossingResponseText(response, usage, 1).then(() => 'unexpected success', error => error.message), deadline]);
  clearTimeout(timer);
  assert.equal(outcome, 'Download budget exceeded');
  assert.equal(cancellations, 1, 'cancellation is still initiated');
  assert.equal(pulls, 1, 'no remainder is consumed');
  assert.equal(usage.bytes, 9, 'the oversized chunk is still metered');
  assert.equal(response.body.locked, false, 'the reader is released on failure');
});
