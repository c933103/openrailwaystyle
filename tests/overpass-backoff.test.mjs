import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {overpassRetryDelayMs,overpassBusy,OVERPASS_RETRY_MINUTES} from '../scripts/overpass-errors.mjs';

test('a busy Overpass server is retried after minutes, or its own longer Retry-After up to 15 minutes',()=>{
  assert.deepEqual(OVERPASS_RETRY_MINUTES,[2,5,10]);
  assert.deepEqual([0,1,2,3,9].map(retry=>overpassRetryDelayMs(retry)),[120000,300000,600000,600000,600000],'2, 5, then 10 minutes');
  assert.equal(overpassRetryDelayMs(0,'30'),120000,'a shorter Retry-After does not shorten the wait');
  assert.equal(overpassRetryDelayMs(0,'420'),420000,'a longer Retry-After in seconds is honoured');
  const now=Date.parse('2026-10-30T10:00:00Z');
  assert.equal(overpassRetryDelayMs(1,'Fri, 30 Oct 2026 10:08:00 GMT',now),480000,'an HTTP-date Retry-After is honoured');
  assert.equal(overpassRetryDelayMs(1,'Fri, 30 Oct 2026 09:00:00 GMT',now),300000,'a past date falls back to the schedule');
  assert.equal(overpassRetryDelayMs(2,'86400'),900000,'capped at 15 minutes');
  for(const junk of ['soon','-5','',null,undefined])assert.equal(overpassRetryDelayMs(0,junk),120000,String(junk));
});

test('only a busy or unreachable server counts as worth the long wait',()=>{
  for(const message of ['HTTP 429: Too Many Requests','HTTP 502: # 502 Gateway Timeout This Overpass API server is currently at capacity','HTTP 503','HTTP 504','fetch failed'])
    assert.equal(overpassBusy(new Error(message)),true,message);
  for(const message of ['HTTP 400: parse error','HTTP 404','runtime error: Query timed out in "query"','Energy facility download budget exceeded'])
    assert.equal(overpassBusy(new Error(message)),false,message);
});

test('the facility snapshot build uses the long busy-server wait',()=>{
  const facilities=readFileSync(new URL('../scripts/build-power-facilities.mjs',import.meta.url),'utf8');
  assert.match(facilities,/overpassBusy\(error\)\?overpassRetryDelayMs\(attempt,error\.retryAfter\)/);
  assert.match(facilities,/retryAfter:response\.headers\.get\('retry-after'\)/);
  assert.match(facilities,/const attempts=OVERPASS_RETRY_MINUTES\.length\+1/);
});

