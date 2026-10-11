import test from 'node:test';
import assert from 'node:assert/strict';
import {STAGES, selectDownloadStage} from '../scripts/download-stages.mjs';
import {describeOverpassError, workflowWarning} from '../scripts/overpass-errors.mjs';
import {maintainDataWorkflows, removedDiagnosticWorkflows} from '../scripts/maintain-data-workflows.mjs';

const at = '2026-10-11T00:00:00Z';
test('unfinished stages get turns without dropping the blocked Europe queue', () => {
  const state = {stages:Object.fromEntries(STAGES.map(s => [s.name,{completed:at}]))};
  for (const name of ['europe-g','india','asia','north-america','americas','world']) state.stages[name] = {completed:null};
  const pending = [{part:0,box:[43,-4.5,49.5,6.25],depth:3}];
  state.stages['europe-g'].pending = pending;
  for (const name of ['europe-g','india','asia','north-america','americas','world']) {
    const selected = selectDownloadStage(state);
    assert.equal(selected.name,name);
    state.stages[name].lastAttempt = {at,status:'deferred'};
  }
  assert.equal(selectDownloadStage(state).name,'europe-g');
  assert.deepEqual(state.stages['europe-g'].pending,pending);
  assert.equal(state.stages['europe-g'].completed,null);
});
test('scheduler preserves the due oldest-stage refresh and skips current stages', () => {
  const now = Date.parse(at), state = {stages:Object.fromEntries(STAGES.map(s => [s.name,{completed:at}]))};
  assert.equal(selectDownloadStage(state,{now}),null);
  state.stages.asia.completed = '2026-09-01T00:00:00Z';
  assert.equal(selectDownloadStage(state,{now}).name,'asia');
});
test('transport diagnostics expose nested codes and bound cyclic aggregate errors', () => {
  const cause = new AggregateError([Object.assign(new Error('sensitive URL'),{code:'ENETUNREACH'}),
    Object.assign(new Error('private headers'),{code:'ETIMEDOUT'})]);
  cause.cause = cause;
  const result = describeOverpassError(new TypeError('fetch failed',{cause}));
  assert.equal(result,'fetch failed [ENETUNREACH, ETIMEDOUT]');
  assert.equal(describeOverpassError(new Error('HTTP 503: too busy')),'HTTP 503: too busy');
  assert.equal(workflowWarning('busy%0A\r\n::other::'), '::warning::busy%250A%0D%0A::other::');
});
const workflows = [
  {id:1,path:'.github/workflows/pr71-rebuild.yml',state:'active'},
  {id:2,path:'.github/workflows/pr73-publish.yaml',state:'active'},
  {id:3,path:'.github/workflows/repair-pr73.yml',state:'active'},
  {id:4,path:'.github/workflows/audit-country-label.yml',state:'active'},
  {id:5,path:'.github/workflows/site.yml',state:'active'},
  {id:6,path:'.github/workflows/pr71-live.yml',state:'active'},
  {id:7,path:'.github/workflows/pr71-disabled.yml',state:'disabled_manually'},
  {id:8,path:'.github/workflows/pr710-keep.yml',state:'active'},
];
const trackedPaths = ['.github/workflows/site.yml','.github/workflows/pr71-live.yml'];
test('cleanup only disables allowlisted diagnostics removed from main', () => {
  assert.deepEqual(removedDiagnosticWorkflows(workflows,trackedPaths).map(w => w.id),[1,2,3,4]);
});
const upgraded = {schema:3,applied_profiles:{schema:1,file:'profiles.json.gz',sha256:'a'.repeat(64),osm_sha256:'b'.repeat(64),sections:0}};
const run = async (manifest, active = [], ref = 'refs/heads/main') => {
  const calls = [];
  const api = async (method,path,paginate,body) => {
    calls.push({method,path,body});
    if (path.includes('/actions/workflows?')) return [{workflows}];
    if (path.includes('/runs?')) return [{workflow_runs:active}];
    return null;
  };
  const result = await maintainDataWorkflows({repo:'example/atlas',ref,trackedPaths,api,readManifest:async () => manifest});
  return {calls,result};
};
test('old release dispatches one production refresh; upgraded release does not scan or dispatch',async () => {
  const old = await run({schema:3});
  assert.equal(old.result.frequency,'refresh-dispatched');
  assert.deepEqual(old.calls.filter(c => c.method === 'POST').map(c => c.body),[{ref:'main'}]);
  assert.equal(old.calls.filter(c => c.method === 'PUT').length,4);
  const current = await run(upgraded);
  assert.equal(current.result.frequency,'aggregate-present');
  assert.ok(current.calls.every(c => !c.path.includes('/runs?') && c.method !== 'POST'));
});
test('active main production refresh blocks a second dispatch, while PR checks do not',async () => {
  for (const event of ['schedule','workflow_dispatch']) {
    const current = await run({schema:3},[{event,head_branch:'main',status:'queued'}]);
    assert.equal(current.result.frequency,'already-running');
    assert.ok(current.calls.every(c => c.method !== 'POST'));
  }
  for (const entry of [{event:'pull_request',head_branch:'main',status:'in_progress'},
    {event:'push',head_branch:'main',status:'in_progress'},
    {event:'workflow_dispatch',head_branch:'feature',status:'in_progress'}]) {
    assert.equal((await run({schema:3},[entry])).result.frequency,'refresh-dispatched');
  }
});
test('non-main and malformed release metadata fail before any workflow mutation',async () => {
  await assert.rejects(run({schema:3},[],'refs/heads/feature'),/requires main/);
  const mutations = [];
  const api = async (method,path) => {
    if (method !== 'GET') mutations.push(path);
    return [{workflows}];
  };
  for (const manifest of [{schema:2},{schema:3,applied_profiles:{schema:1}}]) await assert.rejects(
    maintainDataWorkflows({repo:'example/atlas',ref:'refs/heads/main',trackedPaths,api,readManifest:async () => manifest}),/Invalid/);
  assert.deepEqual(mutations,[]);
});


test('every aggregate binding field is required before suppressing production repair',async () => {
  const changes = [
    m => delete m.applied_profiles.osm_sha256,
    m => m.applied_profiles.osm_sha256 = 'not-a-digest',
    m => delete m.applied_profiles.sections,
    ...[-1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1].map(value => m => m.applied_profiles.sections = value),
    m => m.applied_profiles = null,
  ];
  for (const change of changes) {
    const manifest = structuredClone(upgraded);change(manifest);
    await assert.rejects(run(manifest),/Invalid aggregate publication metadata/);
  }
});
