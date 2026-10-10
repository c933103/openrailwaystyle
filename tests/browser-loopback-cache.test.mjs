import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cacheOtherOrigins} from '../scripts/browser.mjs';

test('generic browser cache excludes every supported loopback host, including IPv6', async () => {
  const context = {route: async (match, handler) => { context.match = match; context.handler = handler; }};
  const directory = await mkdtemp(join(tmpdir(), 'loopback-cache-'));
  await cacheOtherOrigins(context, directory);

  for (const url of [
    'http://localhost:4174/railway_line_high/14/1/2',
    'http://127.0.0.1:4174/railway_line_high/14/1/2',
    'http://[::1]:4174/railway_line_high/14/1/2',
  ]) assert.equal(context.match(new URL(url)), false, `${url} must always come from the live local server`);

  assert.equal(context.match(new URL('https://tiles.example/14/1/2')), true,
    'unrelated remote providers remain eligible for the generic cache');
});
