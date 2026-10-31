import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {conveyingRetryDelay, conveyingRequestFits, conveyingHttpError, CONVEYING_ACQUISITION_MS, CONVEYING_REQUEST_MS} from '../scripts/conveying-data.mjs';

test('only proven admission failures increase the second wait', async () => {
  const busy=await conveyingHttpError(new Response('All query workers are busy and the request queue is full.',{status:502}),Date.now());
  assert.equal(busy.kind,'admission');
  assert.deepEqual([0,1].map(n=>conveyingRetryDelay(busy,n)),[120000,240000]);
  const gateway=await conveyingHttpError(new Response('Bad Gateway',{status:502}),Date.now());
  assert.equal(gateway.kind,'gateway-or-server');
  for(const error of [gateway,new Error('fetch failed'),{kind:'execution-limit'},{kind:'incomplete-diagnostic'}])
    assert.deepEqual([0,1].map(n=>conveyingRetryDelay(error,n)),[120000,120000]);
});

test('Retry-After is retained and honoured without shortening a long delay', async () => {
  const error=await conveyingHttpError(new Response('request queue is full',{status:502,headers:{'Retry-After':'420'}}),Date.now());
  assert.equal(error.retryAfter,'420');
  assert.equal(conveyingRetryDelay(error,0),420000);
  assert.equal(conveyingRetryDelay({...error,retryAfter:'86400'},1),86400000);
  assert.equal(conveyingRequestFits(CONVEYING_ACQUISITION_MS,86400000,0),false);
  assert.equal(conveyingRetryDelay({...error,retryAfter:'30'},1),240000);
  const now=Date.parse('2026-10-30T10:00:00Z');
  for(const header of ['Fri, 30 Oct 2026 10:08:00 GMT','Friday, 30-Oct-26 10:08:00 GMT','Fri Oct 30 10:08:00 2026'])
    assert.equal(conveyingRetryDelay({retryAfter:header},0,now),480000,header);
  for(const header of ['Fri, 30 Oct 2026 09:00:00 GMT','-5','soon','0','',null,undefined])
    assert.equal(conveyingRetryDelay({retryAfter:header},0,now),120000,String(header));
  const huge=conveyingRetryDelay({retryAfter:'9'.repeat(400)},0,now);
  assert.equal(conveyingRequestFits(CONVEYING_ACQUISITION_MS,huge,0),false);
});

test('the original 52-minute acquisition ceiling includes every wait and full timeout', () => {
  const minute=60000,deadline=CONVEYING_ACQUISITION_MS;
  assert.equal(deadline,52*minute);
  assert.equal(CONVEYING_REQUEST_MS,16*minute);
  assert.equal(conveyingRequestFits(deadline,2*minute,34*minute),true,'old worst sequence still fits exactly');
  assert.equal(conveyingRequestFits(deadline,4*minute,34*minute),false,'do not start a third slow request after increased wait');
  assert.equal(conveyingRequestFits(deadline,4*minute,3*minute),true,'fast admission rejection leaves room');
  assert.equal(conveyingRequestFits(deadline,0,36*minute),true);
  assert.equal(conveyingRequestFits(deadline,0,36*minute+1),false,'overslept timer must defer');
});

test('builder keeps three attempts and checks deadline before sleep and before requests', () => {
  const source=readFileSync(new URL('../scripts/build-conveying.mjs',import.meta.url),'utf8');
  assert.match(source,/attempt<3/);
  assert.match(source,/if\(attempt===2\) throw error/);
  assert.ok(source.indexOf('conveyingRequestFits(deadline, 0)')<source.indexOf('await fetch('));
  assert.ok(source.indexOf('conveyingRequestFits(deadline, wait)')<source.indexOf('setTimeout(r,wait)'));
  assert.match(source,/AbortSignal\.timeout\(CONVEYING_REQUEST_MS\)/);
  assert.doesNotMatch(source,/OVERPASS_BUDGET_MINUTES|OVERPASS_RETRY_MINUTES/);
});
