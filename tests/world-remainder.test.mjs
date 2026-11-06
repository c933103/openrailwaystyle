import test from 'node:test';
import assert from 'node:assert/strict';
import {STAGES, partSelection, remainderSelection, startStagePass, finishStagePass, dropStalePass} from '../scripts/download-stages.mjs';
import {railwayWaysQuery} from '../scripts/railway-ways.mjs';

// Which parts select a place, worked out from each part's selection plan as
// Overpass would apply it: a filter `(area.aN)(s,w,n,e)` takes what lies in
// the box and in one of the areas of set aN; a plan takes its main filter
// minus each of its `minus` entries. A place is given by its position and the
// boundaries (`ISO3166-1=..`, `wikidata=..`) it lies in.
const filterOf = text => text;
// A part's selection, as a test of a place.
function tester(selection) {
  const sets = new Map();
  for (const [, body, name] of selection.areas.matchAll(/(\(?(?:area\["[^"]+"="[^"]+"\];?)+\)?)->\.(a\d+);/g))
    sets.set(name, [...body.matchAll(/area\["([^"]+)"="([^"]+)"\]/g)].map(([, k, v]) => `${k}=${v}`));
  const compile = text => {
    const [, set, box] = /^(?:\(area\.(a\d+)\))?\(([-\d.,]+)\)$/.exec(text);
    const [s, w, n, e] = box.split(',').map(Number), list = set && sets.get(set);
    assert.ok(!set || list, `area set ${set} is defined`);
    return ([lat, lon], within) => lat >= s && lat <= n && lon >= w && lon <= e && (!list || list.some(area => within.includes(area)));
  };
  const entry = item => {
    if (typeof item === 'string') return compile(item);
    const filter = compile(item.filter), minus = item.minus.map(entry);
    return (point, within) => filter(point, within) && !minus.some(test => test(point, within));
  };
  const main = compile(selection.plan.main), minus = selection.plan.minus.map(entry);
  return (point, within) => main(point, within) && !minus.some(test => test(point, within));
}
const parts = STAGES.flatMap(stage => stage.parts.map(part => ({stage: stage.name, test: tester(partSelection(part, part.box, filterOf))})));
const coveredBy = (point, within) => parts.filter(({test}) => test(point, within)).map(({stage}) => stage);
const country = code => `ISO3166-1=${code}`;

test('places outside every stage box, in no country, or at sea are in the rest of the world', () => {
  for (const [name, point, within] of [
    ['Mauritius', [-20.2, 57.55], [country('MU')]],
    ['Réunion as its own boundary', [-21.1, 55.5], [country('RE')]],
    ['Réunion inside the boundary of France', [-21.1, 55.5], [country('FR')]],
    ['Cape Verde', [15.0, -23.6], [country('CV')]],
    ['Seychelles', [-4.6, 55.45], [country('SC')]],
    ['Tahiti', [-17.6, -149.5], [country('PF')]],
    ['Greenland', [72, -40], [country('GL')]],
    ['Antarctica, in no country', [-77.8, 166.7], []],
    ['Kerguelen, in no country', [-49.3, 69.5], []],
    ['the open Atlantic', [40, -40], []],
    ['a territory inside the Europe box no stage names', [47, 29.5], []],
    ['Hawaii, a US state beyond nothing but the US box', [21.3, -157.8], [country('US')]],
    ['Guam, US territory outside the US box', [13.4, 144.8], [country('US')]],
    ['Egypt, which Rest of Asia leaves out', [30, 31], [country('EG')]],
    ['Australia', [-33.9, 151.2], [country('AU')]],
  ]) assert.ok(coveredBy(point, within).length, name);
});

test('a place another stage selects is not fetched again by the rest of the world', () => {
  for (const [name, point, within, stage] of [
    ['Paris', [48.85, 2.35], [country('FR')], 'europe-f'],
    ['Guangzhou', [23.1, 113.3], [country('CN'), 'ISO3166-2=CN-GD'], 'east-asia'],
    ['Almaty region', [48, 68], [country('KZ')], 'asia'],
    ['Tokyo', [35.7, 139.7], [country('JP')], 'japan'],
    ['Delhi', [28.6, 77.2], [country('IN')], 'india'],
    ['São Paulo', [-23.5, -46.6], [country('BR')], 'americas'],
    ['Chicago', [41.9, -87.6], [country('US')], 'north-america'],
  ]) assert.deepEqual(coveredBy(point, within), [stage], name);
});

test('every place on a world grid is covered, in any boundary the stages use or none', () => {
  const areas = [...new Set(STAGES.flatMap(stage => stage.parts.flatMap(part => [part.area, ...(part.exclude || [])]).filter(Boolean)))];
  const gaps = [];
  for (let lat = -89.5; lat < 90 && gaps.length < 20; lat += 3) for (let lon = -179.5; lon < 180 && gaps.length < 20; lon += 3)
    for (const within of [[], ...areas.map(area => [area])]) if (!coveredBy([lat, lon], within).length) gaps.push(`${lat},${lon} ${within}`);
  assert.deepEqual(gaps, [], 'the first places in no part');
});

test('the rest of the world is eight tiles of the globe, and a quarter of a tile subtracts only what reaches it', () => {
  const world = STAGES.find(stage => stage.name === 'world');
  assert.equal(world.parts.length, 8);
  assert.ok(world.parts.every(part => part.remainder));
  assert.equal(world.parts.reduce((sum, {box: [s, w, n, e]}) => sum + (n - s) * (e - w), 0), 180 * 360);
  // Mauritius's quarter overlaps only the Rest of Asia box: one subtraction.
  const quarter = remainderSelection([-45, 45, 0, 90], filterOf);
  assert.equal(quarter.plan.minus.length, 1);
  assert.deepEqual(quarter.plan.minus[0].filter, '(-11,60,0,90)');
  // Where no other stage reaches, nothing is subtracted.
  const pacific = remainderSelection([-90, -180, -60, -150], filterOf);
  assert.deepEqual(pacific.plan.minus, []);
  assert.equal(pacific.areas, '');
  // The parts of one box share one area set.
  const europe = remainderSelection([45, 0, 90, 45], filterOf);
  const sets = europe.areas.match(/->\.a\d+;/g);
  assert.ok(europe.areas.includes('area["ISO3166-1"="FR"];') && europe.areas.includes('area["ISO3166-1"="DE"];'));
  assert.ok(sets.length < 10, `${sets.length} area sets`);
});

test('a rest-of-the-world query is well formed and subtracts the power selection too', () => {
  const part = STAGES.find(stage => stage.name === 'world').parts[6];
  const query = railwayWaysQuery(part, [45, 0, 67.5, 22.5]);
  let depth = 0;
  for (const c of query) { depth += c === '(' ? 1 : c === ')' ? -1 : 0; assert.ok(depth >= 0); }
  assert.equal(depth, 0);
  assert.match(query, /\(\.pm; - \(\.px0;[^)]*\);\)->\.p;/);
  assert.match(query, /\.r out meta;\(way\(r\.r\)\[railway~"[^"]+"\];\.b;\.p;\);out meta geom qt;$/);
});

test('a part with exclusions of its own is subtracted as a named difference, never a difference inside a union', async () => {
  const {partQuery} = await import('../scripts/branch-lines.mjs');
  const world = STAGES.find(stage => stage.name === 'world');
  const part = world.parts.find(({box: [s, w]}) => s === 0 && w === 0);
  const query = partQuery(part, [29.5, 32.5, 30, 33]);
  const [, name] = /\)->\.(d[0-9a-f]{12});/.exec(query);
  assert.ok(query.includes(`(.${name};);)`), 'the union holds the named set');
  // Each dataset's selection names its differences apart.
  const {partQuery: serviceQuery} = await import('../scripts/service-routes.mjs');
  assert.ok(!serviceQuery(part, [29.5, 32.5, 30, 33]).includes(name));
  // Every difference is a statement of its own: its minus sign is one
  // bracket deep, never inside a union or another difference.
  for (const text of [query, railwayWaysQuery(part, [29.5, 32.5, 30, 33]), railwayWaysQuery(part, [45, 0, 67.5, 22.5])]) {
    let depth = 0, differences = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      else if (text.startsWith(' - (', i)) { assert.equal(depth, 1, text.slice(Math.max(0, i - 80), i + 20)); differences++; }
    }
    assert.ok(differences > 1);
  }
});

test('a pass begun under an earlier layout is dropped; one of the current layout is kept', () => {
  const world = STAGES.find(stage => stage.name === 'world');
  // Begun before passes recorded their layout: judged by its queue.
  const old = {pending: [{part: 1, box: [-50, 110, -11, 180]}], fetched: [{part: 0, box: [-35, -20, 37.5, 52]}]};
  assert.equal(dropStalePass(old, world), true);
  assert.deepEqual([old.pending, old.fetched], [null, null]);
  const quarter = {pending: [{part: 2, box: [-90, 0, -45, 45], depth: 1}]};
  assert.equal(dropStalePass(quarter, world), false, 'a quarter of a current tile');
  assert.equal(dropStalePass({pending: [{part: 9, box: [0, 0, 1, 1]}]}, world), true, 'a part the stage no longer has');
  // Begun with a recorded layout: kept only while it is the stage's.
  const current = {};
  startStagePass(current, world);
  assert.equal(dropStalePass(current, world), false);
  assert.equal(dropStalePass(current, {...world, parts: world.parts.slice(1)}), true);
  // Its regions are recorded under the layout it began with.
  const pass = {};
  startStagePass(pass, world);
  pass.fetched = [{part: 0, box: world.parts[0].box}];
  finishStagePass(pass, {...world, parts: []});
  assert.equal(pass.leaves.key, JSON.stringify(world.parts));
  assert.equal(dropStalePass({pending: []}, world), false);
});

test('the branch-line and service-route builders drop a stale pass before resuming one', async () => {
  const {readFileSync} = await import('node:fs');
  for (const file of ['build-branch-lines.mjs', 'build-service-routes.mjs']) {
    const source = readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8');
    const drop = source.indexOf('if (dropStalePass(current, stage))'), start = source.indexOf('if (!current.pending?.length) { startStagePass(current, stage);');
    assert.ok(drop > 0 && start > drop, file);
  }
});
