import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createControlsCpuProfile, sanitizeCpuProfile} from '../scripts/controls-cpu-profile.mjs';
import {plan} from '../scripts/ci-plan.mjs';

const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
const flush = () => new Promise(resolve => setImmediate(resolve));
const rawProfile = () => ({startTime: 1000, endTime: 31000,
  nodes: [{id: 1, hitCount: 0, callFrame: {functionName: '(root)', scriptId: '0', url: '', lineNumber: -1, columnNumber: -1}, children: [2]},
    {id: 2, hitCount: 3, callFrame: {functionName: 'render', scriptId: '7', url: 'https://atlas.invalid/app.mjs?v=1', lineNumber: 10, columnNumber: 2}}],
  samples: [2, 2, 2], timeDeltas: [10000, 10000, 10000]});
function clock() {
  let time = 1000, id = 0; const timers = new Map();
  return {now: () => time, setTimer(fn, ms) {timers.set(++id, {fn, at: time + ms}); return id;},
    clearTimer(id) {timers.delete(id);}, size: () => timers.size,
    advance(ms) {time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) {timers.delete(id);timer.fn();}}};
}
function fixture({send, createSession} = {}) {
  const time = clock(), calls = []; let detached = 0, created = 0;
  const session = {async send(method, params) {
    calls.push({method, params});
    return send ? send(method, params) : method === 'Profiler.stop' ? {profile: rawProfile()} : {};
  }, async detach() {detached++;}};
  const api = createControlsCpuProfile(() => {created++; return createSession ? createSession(session) : session;}, time);
  return {api, time, calls, session, counts: () => ({detached, created})};
}

test('one passive sample window starts once and stops once, with no page or network commands', async () => {
  const f = fixture(); assert.equal(await f.api.start(), true); assert.equal(await f.api.start(), true);
  f.time.advance(25); const first = f.api.stop(); assert.equal(f.api.stop('check-ended'), first); await first; await flush();
  assert.deepEqual(f.calls.map(c => c.method), ['Profiler.enable', 'Profiler.setSamplingInterval', 'Profiler.start', 'Profiler.stop']);
  assert.deepEqual(f.calls[1].params, {interval: 10000});
  assert.deepEqual(f.counts(), {created: 1, detached: 1}); assert.equal(f.time.size(), 0);
  const result = f.api.snapshot(); assert.equal(result.stopReason, 'settlement-finished');
  assert.equal(result.startedAt, 1000); assert.equal(result.stoppedAt, 1025);
  assert.equal(result.captureLimitMs, 60000); assert.equal(result.operationTimeoutMs, 2000);
  assert.deepEqual(result.profile.samples, [2, 2, 2]);
});

test('a hung setup is bounded; a late session is detached without starting the profiler', async () => {
  const connection = deferred(), f = fixture({createSession: () => connection.promise});
  const started = f.api.start(); await flush(); f.time.advance(2000);
  assert.equal(await started, false); assert.equal(f.api.snapshot().reason, 'protocol-timeout');
  connection.resolve(f.session); await flush();
  assert.deepEqual(f.calls, []); assert.deepEqual(f.counts(), {created: 1, detached: 1}); assert.equal(f.time.size(), 0);
});

test('a late Profiler.start cannot restart a retired capture or leave a watchdog', async () => {
  const late = deferred(), f = fixture({send: method => method === 'Profiler.start' ? late.promise : {}});
  const started = f.api.start(); await flush(); f.time.advance(2000);
  assert.equal(await started, false); late.resolve({}); await flush();
  assert.equal(f.api.snapshot().reason, 'protocol-timeout'); assert.equal(f.api.snapshot().startedAt, undefined);
  assert.deepEqual(f.counts(), {created: 1, detached: 1}); assert.equal(f.time.size(), 0);
});

test('protocol rejection is diagnostic-only and does not retain exception text', async () => {
  const f = fixture({send: () => {throw Error('credential=private');}});
  assert.equal(await f.api.start(), false); await f.api.stop(); await flush();
  assert.equal(f.api.snapshot().reason, 'protocol-error'); assert.doesNotMatch(JSON.stringify(f.api.snapshot()), /credential|private/);
  assert.equal(f.counts().detached, 1); assert.equal(f.time.size(), 0);
});

test('capture watchdog stops sampling at 60 seconds independently of readiness', async () => {
  const f = fixture(); await f.api.start(); f.time.advance(59999); assert.equal(f.calls.length, 3);
  f.time.advance(1); await flush(); await f.api.stop();
  assert.equal(f.calls.filter(c => c.method === 'Profiler.stop').length, 1);
  assert.equal(f.api.snapshot().stopReason, 'capture-limit'); assert.equal(f.api.snapshot().stoppedAt, 61000);
  assert.equal(f.time.size(), 0);
});

test('hung collection is bounded, detaches, and never replaces the result when it completes late', async () => {
  const late = deferred(), f = fixture({send: method => method === 'Profiler.stop' ? late.promise : {}});
  await f.api.start(); const stopped = f.api.stop(); await flush(); f.time.advance(2000); await stopped; await flush();
  const before = f.api.snapshot(); assert.equal(before.reason, 'protocol-timeout');
  late.resolve({profile: rawProfile()}); await flush(); assert.deepEqual(f.api.snapshot(), before);
  assert.equal(f.counts().detached, 1); assert.equal(f.time.size(), 0);
});

test('stop failure remains diagnostic-only and never exposes protocol error text', async () => {
  const f = fixture({send: method => {if (method === 'Profiler.stop') throw Error('token=private'); return {};}});
  await f.api.start(); await f.api.stop(); await flush();
  assert.equal(f.api.snapshot().reason, 'protocol-error');
  assert.doesNotMatch(JSON.stringify(f.api.snapshot()), /token|private/);
  assert.equal(f.counts().detached, 1); assert.equal(f.time.size(), 0);
});

test('early exit before starting or during setup does not create a capture later', async () => {
  const none = fixture(); await none.api.stop(); assert.deepEqual(none.calls, []);
  assert.equal(none.api.snapshot().reason, 'not-started');
  const pending = deferred(), f = fixture({createSession: () => pending.promise});
  const started = f.api.start(); await flush(); await f.api.stop('check-ended'); pending.resolve(f.session);
  assert.equal(await started, false); await flush(); assert.equal(f.api.snapshot().reason, 'setup-interrupted');
  assert.deepEqual(f.calls, []); assert.equal(f.counts().detached, 1); assert.equal(f.time.size(), 0);
});

test('sanitization preserves sample stacks but excludes URL secrets and unapproved profile fields', () => {
  const raw = rawProfile(); raw.nodes[1].callFrame.url = 'https://user:password@atlas.invalid/app.mjs?token=secret#private';
  raw.nodes[1].bailoutReason = 'do not keep'; raw.nodes[1].callFrame.arguments = ['private argument']; raw.extra = 'private metadata';
  const result = sanitizeCpuProfile(raw); assert.equal(result.profile.nodes[1].callFrame.url, 'https://atlas.invalid/app.mjs');
  assert.deepEqual(result.profile.samples, raw.samples); assert.deepEqual(result.profile.timeDeltas, raw.timeDeltas);
  assert.doesNotMatch(JSON.stringify(result), /password|token|secret|private|arguments|bailout|extra/);
  for (const url of ['data:text/javascript,private', 'blob:https://atlas.invalid/private', 'file:///private/home/app.js']) {
    raw.nodes[1].callFrame.url = url;
    assert.doesNotMatch(JSON.stringify(sanitizeCpuProfile(raw)), /private|home/);
  }
});

test('malformed or excessive profiles are explicit unavailable results, never partial causal evidence', () => {
  for (const value of [undefined, {}, {...rawProfile(), timeDeltas: []}, {...rawProfile(), nodes: [null]}, {...rawProfile(), nodes: [{children: {}}]}])
    assert.equal(sanitizeCpuProfile(value).reason, 'invalid-profile');
  for (const value of [{...rawProfile(), nodes: Array.from({length: 4097}, () => ({}))},
    {...rawProfile(), samples: Array(12001).fill(1), timeDeltas: Array(12001).fill(1)},
    {...rawProfile(), nodes: [{children: Array(4097).fill(1)}]}]) {
    const result = sanitizeCpuProfile(value); assert.equal(result.reason, 'profile-limit'); assert.equal(result.profile, undefined);
  }
});

test('integration profiles exactly the first transition and keeps fixture and acceptance contracts', () => {
  const root = new URL('..', import.meta.url), read = path => existsSync(new URL(path, root)) ? readFileSync(new URL(path, root), 'utf8') : null;
  const source = read('scripts/check-map-controls-browser.mjs');
  assert.match(source, /if\(size.width===1365&&size.height===900&&expanded&&readout&&detail===1\)/);
  assert.match(source,/const cpuProfileEnabled=process.env.ATLAS_CONTROLS_CPU_PROFILE==='1'/);
  assert.match(source,/if\(cpuProfileEnabled\)\{await settlementTrace.observe\('cpu-profile-setup',\(\)=>cpuProfile.start\(\)\)/);
  assert.ok(source.indexOf('()=>cpuProfile.start()') < source.indexOf("()=>clickVisibleControl(page,'button.atlas-ctrl"));
  assert.match(source, /map.once\('idle',\(\)=>resolve\(\)\);map.triggerRepaint\(\)/);
  assert.match(source, /map.loaded\(\)&&map.areTilesLoaded\(\)&&!map.isMoving\(\)/);
  assert.match(source, /canvas.width===Math.floor\(container.clientWidth\*ratio\)&&canvas.height===Math.floor\(container.clientHeight\*ratio\)/);
  assert.match(source, /\},null,\{timeout:60000\}\)\)/);
  assert.match(source, /const ms=Date.now\(\)-start, pendingCount=pending.size;[\s\S]*?cpuProfile.stop\('settlement-finished'\)/);
  assert.match(source, /await readBrowserTiming\(page\)[\s\S]*?if\(profileRead\)await profileRead/);
  assert.match(source, /contentType:'application\/x-protobuf',body:Buffer.alloc\(0\)/);
  assert.match(source, /map-controls-cpu-profile.json/);
  assert.deepEqual(plan(['scripts/controls-cpu-profile.mjs'], read).groups.map(g => ({group: g.group, checks: g.checks})),
    [{group: 'controls', checks: ['check-map-controls-browser.mjs']}]);
});
