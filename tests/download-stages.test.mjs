import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EUROPE_STAGES, EUROPE_STAGE_NAMES, STAGES} from '../scripts/download-stages.mjs';
import {BRANCH_DATA_VERSION, branchStageOwner, migrateBranchDownloads, retireBranchEurope, partQuery as branchQuery, quarters} from '../scripts/branch-lines.mjs';
import {addResult, commitStage, migrateServiceDownloads, retireServiceEurope, partQuery as serviceQuery, routeView} from '../scripts/service-routes.mjs';

test('the seven European groups cover the requested countries in order, including every former Yugoslav successor', () => {
  const codes = stage => stage.parts.map(part => part.area.split('=')[1]);
  assert.deepEqual(EUROPE_STAGES.map(codes), [
    ['TR', 'CY', 'Q23681', 'Q37362', 'GE', 'AM', 'AZ'],
    ['ES', 'PT', 'AD', 'GB', 'IE', 'GI', 'GG', 'JE', 'IM'],
    ['IS', 'DK', 'NO', 'SE', 'FO', 'SJ'],
    ['FI', 'AX', 'EE', 'LV', 'LT', 'BY', 'UA', 'MD'],
    ['IT', 'SM', 'VA', 'MT', 'SI', 'HR', 'BA', 'ME', 'RS', 'XK', 'MK', 'GR', 'BG', 'RO'],
    ['FR', 'MC', 'BE', 'NL', 'LU'],
    ['DE', 'PL', 'CZ', 'SK', 'AT', 'CH', 'LI', 'HU', 'AL'],
  ]);
  const all = EUROPE_STAGES.flatMap(codes);
  assert.equal(new Set(all).size, all.length, 'no country appears in two European groups');
  assert.ok(EUROPE_STAGES.every(stage => stage.parts.every(part => part.area)), 'requests are country-sized, including the remaining group');
  const spain = EUROPE_STAGES[1].parts[0], portugal = EUROPE_STAGES[1].parts[1];
  assert.ok(spain.box[0] <= 27.6 && spain.box[1] <= -18, 'Canary Islands');
  assert.ok(portugal.box[1] <= -31.3, 'Azores');
});

test('Kazakhstan is wholly in Asia and Cyprus territories keep their filters under subdivision', () => {
  assert.ok(EUROPE_STAGES.every(stage => stage.parts.every(part => part.area !== 'ISO3166-1=KZ')));
  const asia = STAGES.find(stage => stage.name === 'asia');
  const kazakhstan = asia.parts.filter(part => part.area === 'ISO3166-1=KZ');
  assert.equal(kazakhstan.length, 1, 'one country request covers all of Kazakhstan');
  for (const point of [[47.1, 51.85], [47.1, 51.95], [44.5, 50.5], [53, 87], [55.45, 68.97]]) {
    const [s, w, n, e] = kazakhstan[0].box;
    assert.ok(point[0] >= s && point[0] <= n && point[1] >= w && point[1] <= e);
  }
  for (const stage of [asia, STAGES.find(stage => stage.name === 'world')]) for (const part of stage.parts) for (const query of [branchQuery, serviceQuery]) {
    const text = query(part, part.box);
    assert.equal(text.includes('(poly:'), false, 'no Ural partition');
    if (part.area === 'ISO3166-1=KZ') assert.equal(text.includes(' - ('), false, 'the Kazakhstan request has no European exclusion');
    if (stage.name === 'asia' && part.exclude) assert.ok(part.exclude.includes('ISO3166-1=KZ'), 'other Asia requests do not duplicate Kazakhstan');
    if (part.exclude) for (const spec of ['wikidata=Q23681', 'wikidata=Q37362']) assert.ok(part.exclude.includes(spec), 'Cyprus territories stay with Europe A');
  }
  for (const part of EUROPE_STAGES[0].parts.filter(part => part.area.startsWith('wikidata='))) {
    for (const query of [branchQuery, serviceQuery]) for (const box of quarters(part.box)) {
      const text = query(part, box);
      assert.ok(text.includes(`area["wikidata"="${part.area.split('=')[1]}"]->.a0`));
      assert.ok(text.includes(`(area.a0)(${box.join(',')})`), 'subdivision bounds still apply');
    }
  }
});

const completed = '2026-10-03T00:00:00Z';
function oldState(version) {
  return {version, stages: {
    japan: {completed, pending: null, seen: []},
    europe: {completed: null, previousCompleted: completed, pending: [{part: 1, box: [40.5, 26.5, 72, 45]}], seen: [1]},
    india: {completed: null, pending: [{part: 0, box: [6, 68, 36, 98]}], seen: [2]},
  }, runs: [{at: completed, bytes: 220_000_000}]};
}
const finishEurope = state => { for (const name of EUROPE_STAGE_NAMES) state.stages[name].completed = completed; };
const finishWorld = state => { for (const name of ['asia', 'world']) state.stages[name] = {started: state.legacyEurope.migrated, completed: state.legacyEurope.migrated}; };

test('branch layout migration preserves non-European progress, schema version, geometry and daily budgets across restarts', () => {
  const state = oldState(BRANCH_DATA_VERSION), before = structuredClone(state);
  const table = new Map([[1, {id: 1, stage: 'europe', geometry: {type: 'LineString', coordinates: [[0, 0], [1, 1]]}}]]);
  const geometry = structuredClone(table);
  migrateBranchDownloads(state, table);
  assert.deepEqual(table, geometry);
  assert.equal(state.version, before.version, 'a region split does not force a worldwide schema refresh');
  for (const name of ['japan', 'india']) assert.deepEqual(state.stages[name], before.stages[name]);
  assert.deepEqual(state.runs, before.runs);
  assert.equal(state.stages.europe, undefined, 'the large pending box is retired');
  assert.equal(state.legacyEurope.lines, 1);
  assert.equal(state.legacyEurope.completed, completed);
  state.stages['europe-a'].pending = [{part: 0, box: [30, -26, 56, 17]}];
  state.stages['europe-a'].seen = [1];
  const progress = structuredClone(state);
  migrateBranchDownloads(state, table);
  assert.deepEqual(state, progress, 'the new smaller queue resumes without resetting');
  assert.equal(branchStageOwner('europe', 'europe-b'), 'europe-b');
  assert.equal(branchStageOwner('asia', 'europe-a'), 'europe-a', 'Turkey and the Caucasus move ahead of Asia');
  assert.equal(branchStageOwner('europe', 'world'), 'world', 'northern African lines move to their world stage');
  assert.equal(branchStageOwner('europe-b', 'europe-c'), 'europe-b', 'a border way keeps its earlier group');
});

test('old branch coverage remains until the replacements finish, and an incomplete migration cannot mass-delete it', () => {
  const state = oldState(BRANCH_DATA_VERSION), table = new Map(Array.from({length: 200}, (_, id) => [id, {id, stage: 'europe'}]));
  migrateBranchDownloads(state, table);
  retireBranchEurope(state, table);
  assert.equal(table.size, 200, 'partial migration preserves all old lines');
  finishEurope(state);
  retireBranchEurope(state, table);
  assert.equal(table.size, 200, 'old coverage stays until the rest of the world is checked too');
  finishWorld(state);
  for (let id = 0; id < 150; id++) table.get(id).stage = 'europe-b';
  retireBranchEurope(state, table);
  assert.equal(table.size, 200, '25% missing remains protected');
  assert.ok(state.legacyEurope);
  for (let id = 150; id < 180; id++) table.get(id).stage = 'europe-g';
  retireBranchEurope(state, table);
  assert.equal(table.size, 180, 'small stale remainder can be removed once coverage is confirmed');
  assert.equal(state.legacyEurope, undefined);
});

test('service migration retains old committed and partial memberships until successful replacement, including shared ways', () => {
  const state = oldState(1), table = {routes: new Map(), ways: new Map()};
  const route = key => ({key, relation: Number(key.slice(1)), kind: 'subway', label: key, names: {}});
  const lines = [[[0, 0], [1, 1]]];
  addResult(table, {routes: [route('r1')], ways: [{id: 1, routes: ['r1'], lines}]}, 'europe');
  commitStage(table, 'europe');
  addResult(table, {routes: [route('r2')], ways: [{id: 1, routes: ['r2'], lines}, {id: 2, routes: ['r2'], lines}]}, 'europe');
  migrateServiceDownloads(state, table);
  assert.deepEqual(table.ways.get(1).routes.europe, ['r1', 'r2'], 'committed and partial memberships survive');
  assert.equal(routeView(table.routes.get('r2')).label, 'r2', 'an old partial-only route remains drawable');
  assert.deepEqual(table.ways.get(2).lines, lines, 'partial-only geometry remains drawable');
  assert.deepEqual(table.routes.get('r2').next, {});
  const progress = structuredClone({state, table});
  migrateServiceDownloads(state, table);
  assert.deepEqual({state, table}, progress, 'idempotent after restart');
  retireServiceEurope(state, table);
  assert.equal(table.routes.size, 2, 'do not delete anything after only one group');
  addResult(table, {routes: [route('r1')], ways: [{id: 1, routes: ['r1'], lines}]}, 'europe-b');
  commitStage(table, 'europe-b');
  addResult(table, {routes: [route('r2')], ways: [{id: 2, routes: ['r2'], lines}]}, 'europe-f');
  // The cross-border/shared way is found in both smaller groups.
  addResult(table, {routes: [route('r2')], ways: [{id: 1, routes: ['r2'], lines}]}, 'europe-f');
  commitStage(table, 'europe-f');
  finishEurope(state);
  finishWorld(state);
  retireServiceEurope(state, table);
  assert.equal(table.routes.size, 2);
  assert.equal(table.ways.size, 2);
  assert.deepEqual(table.ways.get(1).routes, {'europe-b': ['r1'], 'europe-f': ['r2']});
  assert.equal(state.legacyEurope, undefined);
});

test('service retirement retains legacy coverage when the new groups missed too many old routes', () => {
  const state = oldState(1), table = {routes: new Map(), ways: new Map()};
  addResult(table, {routes: Array.from({length: 25}, (_, id) => ({key: `r${id}`, relation: id, label: 'Old route'})), ways: []}, 'europe');
  migrateServiceDownloads(state, table);
  finishEurope(state);
  finishWorld(state);
  retireServiceEurope(state, table);
  assert.equal(table.routes.size, 25);
  assert.ok(state.legacyEurope);
});

test('legacy retirement waits for a world pass started after migration and preserves its adopted African data', () => {
  const state = oldState(BRANCH_DATA_VERSION), branch = new Map([[1, {id: 1, stage: 'europe'}]]);
  migrateBranchDownloads(state, branch);
  finishEurope(state);
  state.stages.world = {started: completed, completed: state.legacyEurope.migrated};
  retireBranchEurope(state, branch);
  assert.equal(branch.size, 1, 'a world pass started before migration is insufficient');
  branch.get(1).stage = branchStageOwner('europe', 'world');
  finishWorld(state);
  retireBranchEurope(state, branch);
  assert.equal(branch.get(1).stage, 'world');

  const services = {routes: new Map(), ways: new Map()}, serviceState = oldState(1);
  const result = {routes: [{key: 'r1', relation: 1, label: 'African metro'}], ways: [{id: 1, routes: ['r1'], lines: [[[3, 36.7], [3.01, 36.71]]]}]};
  addResult(services, result, 'europe');
  migrateServiceDownloads(serviceState, services);
  finishEurope(serviceState);
  addResult(services, result, 'world');
  commitStage(services, 'world');
  finishWorld(serviceState);
  retireServiceEurope(serviceState, services);
  assert.deepEqual(Object.keys(services.routes.get('r1').stages), ['world']);
  assert.deepEqual(services.ways.get(1).routes, {world: ['r1']});
});

test('both maintenance workflows trigger when the shared stage definitions change', async () => {
  for (const pipeline of ['branch-lines', 'service-routes']) {
    const workflow = await readFile(new URL(`../.github/workflows/${pipeline}.yml`, import.meta.url), 'utf8');
    assert.ok(workflow.includes("'scripts/download-stages.mjs'"));
    assert.equal(workflow.includes('scripts/european-kazakhstan.mjs'), false);
  }
});

function layoutTwoState() {
  return {version: BRANCH_DATA_VERSION, downloadStages: 2, stages: Object.fromEntries(STAGES.map(stage => [stage.name, {
    completed, pending: [{part: 5, box: [45, 45, 56, 60]}], seen: [1], started: completed,
  }])), runs: [{at: completed, bytes: 123456}]};
}

test('layout two branch data is adopted by Asia and neighbouring groups without stale part indexes or a worldwide reset', () => {
  const state = layoutTwoState(), before = structuredClone(state);
  const table = new Map([[1, {id: 1, stage: 'europe-a'}], [2, {id: 2, stage: 'europe-g'}], [3, {id: 3, stage: 'europe-c'}]]);
  migrateBranchDownloads(state, table);
  assert.equal(state.downloadStages, 3);
  assert.equal(table.get(1).stage, 'europe');
  assert.equal(table.get(2).stage, 'europe');
  assert.equal(table.get(3).stage, 'europe-c');
  for (const name of ['europe-a', 'europe-b', 'europe-e', 'europe-f', 'europe-g', 'asia', 'world']) {
    assert.equal(state.stages[name].pending, null, 'obsolete part indices cannot resume');
    assert.equal(state.stages[name].completed, null);
    assert.equal(state.stages[name].previousCompleted, completed);
    assert.deepEqual(state.stages[name].seen, []);
  }
  for (const name of ['japan', 'europe-c', 'europe-d', 'india', 'north-america']) assert.deepEqual(state.stages[name], before.stages[name]);
  assert.deepEqual(state.runs, before.runs);
  assert.equal(state.version, before.version);
  table.get(1).stage = branchStageOwner(table.get(1).stage, 'asia');
  table.get(2).stage = branchStageOwner(table.get(2).stage, 'europe-f');
  assert.equal(table.get(1).stage, 'asia', 'Kazakhstan can move to a later stage');
  assert.equal(table.get(2).stage, 'europe-f', 'Monaco can move to France');
  const progress = structuredClone({state, table});
  migrateBranchDownloads(state, table);
  assert.deepEqual({state, table}, progress);
});

test('layout two service migration retains committed and partial data and waits for Kazakhstan coverage', () => {
  const state = layoutTwoState(), table = {routes: new Map(), ways: new Map()};
  const lines = [[[51.8, 47.1], [51.81, 47.11]]];
  const result = (id, label) => ({routes: [{key: `r${id}`, relation: id, label}], ways: [{id: 1, routes: [`r${id}`], lines}]});
  addResult(table, result(1, 'Kazakhstan'), 'europe-a');
  commitStage(table, 'europe-a');
  addResult(table, result(2, 'Vatican'), 'europe-g');
  addResult(table, result(3, 'Norway'), 'europe-c');
  migrateServiceDownloads(state, table);
  assert.deepEqual(table.ways.get(1).routes.europe, ['r1', 'r2']);
  assert.deepEqual(table.ways.get(1).next['europe-c'], ['r3'], 'unchanged partial passes resume');
  assert.equal(routeView(table.routes.get('r2')).label, 'Vatican');
  assert.deepEqual(table.ways.get(1).lines, lines);
  const progress = structuredClone({state, table});
  migrateServiceDownloads(state, table);
  assert.deepEqual({state, table}, progress);
  finishEurope(state);
  state.stages.world = {started: state.legacyEurope.migrated, completed: state.legacyEurope.migrated};
  retireServiceEurope(state, table);
  assert.ok(state.legacyEurope, 'fresh Asia is required even after Europe and world finish');
  addResult(table, result(1, 'Kazakhstan'), 'asia');
  commitStage(table, 'asia');
  addResult(table, result(2, 'Vatican'), 'europe-e');
  commitStage(table, 'europe-e');
  finishWorld(state);
  retireServiceEurope(state, table);
  assert.equal(state.legacyEurope, undefined);
  assert.deepEqual(table.ways.get(1).routes, {asia: ['r1'], 'europe-e': ['r2']});
});
