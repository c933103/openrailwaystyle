import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EUROPE_STAGES, EUROPE_STAGE_NAMES, STAGES} from '../scripts/download-stages.mjs';
import {BRANCH_DATA_VERSION, branchStageOwner, migrateBranchDownloads, retireBranchEurope, partQuery as branchQuery, quarters} from '../scripts/branch-lines.mjs';
import {addResult, commitStage, migrateServiceDownloads, retireServiceEurope, partQuery as serviceQuery, routeView} from '../scripts/service-routes.mjs';

test('the seven European groups cover the requested countries in order, including every former Yugoslav successor', () => {
  const codes = stage => stage.parts.map(part => part.area.split('=')[1]);
  assert.deepEqual(EUROPE_STAGES.map(codes), [
    ['TR', 'CY', 'GE', 'AM', 'AZ', 'KZ'],
    ['ES', 'PT', 'AD', 'GB', 'IE'],
    ['IS', 'DK', 'NO', 'SE', 'FO', 'SJ'],
    ['FI', 'AX', 'EE', 'LV', 'LT', 'BY', 'UA', 'MD'],
    ['IT', 'SI', 'HR', 'BA', 'ME', 'RS', 'XK', 'MK', 'GR', 'BG', 'RO'],
    ['FR', 'BE', 'NL', 'LU'],
    ['DE', 'PL', 'CZ', 'SK', 'AT', 'CH', 'LI', 'HU', 'AL', 'MT', 'MC', 'SM', 'VA', 'GI', 'GG', 'JE', 'IM'],
  ]);
  const all = EUROPE_STAGES.flatMap(codes);
  assert.equal(new Set(all).size, all.length, 'no country appears in two European groups');
  assert.ok(EUROPE_STAGES.every(stage => stage.parts.every(part => part.area)), 'requests are country-sized, including the remaining group');
  const spain = EUROPE_STAGES[1].parts[0], portugal = EUROPE_STAGES[1].parts[1];
  assert.ok(spain.box[0] <= 27.6 && spain.box[1] <= -18, 'Canary Islands');
  assert.ok(portugal.box[1] <= -31.3, 'Azores');
});

test('both builders retain the Ural polygon and country filter when splitting European Kazakhstan', () => {
  const part = EUROPE_STAGES[0].parts.at(-1);
  // Point-in-polygon checks at Atyrau: a western bank and an eastern bank.
  const inside = ([lat, lon]) => {
    let hit = false;
    for (let i = 0, j = part.poly.length - 1; i < part.poly.length; j = i++) {
      const [ay, ax] = part.poly[i], [by, bx] = part.poly[j];
      if ((ay > lat) !== (by > lat) && lon < (bx - ax) * (lat - ay) / (by - ay) + ax) hit = !hit;
    }
    return hit;
  };
  assert.equal(inside([47.1, 51.85]), true);
  assert.equal(inside([47.1, 51.95]), false, 'Asian Kazakhstan stays outside the Europe request');
  assert.equal(inside([44.5, 50.5]), false, 'Mangystau on the Caspian eastern shore remains in Asia');
  for (const query of [branchQuery, serviceQuery]) for (const box of quarters(part.box)) {
    const text = query(part, box);
    assert.match(text, /area\["ISO3166-1"="KZ"\]->\.a0/);
    assert.match(text, /\(area\.a0\)\(poly:"/);
    assert.ok(text.includes(`)(${box.join(',')})`), 'subdivision bounds still apply');
  }
  for (const part of STAGES.find(stage => stage.name === 'asia').parts) for (const query of [branchQuery, serviceQuery]) {
    const text = query(part, part.box);
    for (const code of ['TR', 'CY', 'GE', 'AM', 'AZ', 'KZ']) assert.ok(text.includes(`"${code}"`), `${code} excluded after Europe A`);
    assert.ok(text.includes(' - ('), 'the European subset is subtracted');
    assert.match(text, /\(area\.a\d+\)\(poly:"/);
    assert.equal(part.exclude.includes('ISO3166-1=KZ'), false, 'do not exclude the whole country from Asia');
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
  assert.equal(branchStageOwner('europe-b', 'europe-c'), 'europe-b', 'a border way keeps its earlier group');
});

test('old branch coverage remains until the replacements finish, and an incomplete migration cannot mass-delete it', () => {
  const state = oldState(BRANCH_DATA_VERSION), table = new Map(Array.from({length: 200}, (_, id) => [id, {id, stage: 'europe'}]));
  migrateBranchDownloads(state, table);
  retireBranchEurope(state, table);
  assert.equal(table.size, 200, 'partial migration preserves all old lines');
  finishEurope(state);
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
  retireServiceEurope(state, table);
  assert.equal(table.routes.size, 25);
  assert.ok(state.legacyEurope);
});

test('both maintenance workflows trigger when the shared stage definitions change', async () => {
  for (const pipeline of ['branch-lines', 'service-routes']) {
    const workflow = await readFile(new URL(`../.github/workflows/${pipeline}.yml`, import.meta.url), 'utf8');
    for (const file of ['scripts/download-stages.mjs', 'scripts/european-kazakhstan.mjs']) assert.ok(workflow.includes(`'${file}'`));
  }
});
