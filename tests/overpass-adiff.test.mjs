import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adiffQuery, parseAdiff, applyFeatureChanges, updateFromChanges, extractionVersion, selectionParts, selectionChangeQueries, updateElements} from '../scripts/overpass-adiff.mjs';
import {AERIALWAY_QUERY} from '../scripts/conveying-data.mjs';
import {CONVEYING_QUERY, conveyingGeoJSON} from '../scripts/conveying-data.mjs';

// Synthetic augmented diffs in the documented form; no captured provider data.
const osm = (base, actions) => `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="Overpass API">\n<note>test</note>\n<meta osm_base="${base}" areas="${base}"/>\n${actions}\n</osm>\n`;
const nd = (ref, lat, lon) => `<nd ref="${ref}" lat="${lat}" lon="${lon}"/>`;
const way = (id, tags, points, extra = '') => `<way id="${id}" version="3" timestamp="2026-10-30T00:00:00Z"${extra}><bounds minlat="0" minlon="0" maxlat="1" maxlon="1"/>${points.map(([ref, lat, lon]) => nd(ref, lat, lon)).join('')}${Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('')}</way>`;
const BASE = '2026-11-01T06:00:00Z';

test('a JSON selection query becomes its augmented diff, in XML, from a database time', () => {
  assert.equal(adiffQuery(CONVEYING_QUERY, '2026-10-30T12:22:36Z'),
    '[out:xml][timeout:900][maxsize:1073741824][adiff:"2026-10-30T12:22:36Z"];(way[conveying][conveying!=no];way[highway=elevator];);out meta geom qt;',
    'way nodes need members, and an augmented diff needs meta: every output asks for out meta');
  assert.equal(adiffQuery('[out:json];way[a];out tags geom;node[b];out;rel[c];out body;way[d];out ids;', '2026-10-30T12:22:36Z'),
    '[out:xml][adiff:"2026-10-30T12:22:36Z"];way[a];out meta geom;node[b];out meta;rel[c];out meta;way[d];out meta;');
  assert.throws(() => adiffQuery(CONVEYING_QUERY, '2026-10-30'), /Invalid change start/);
  assert.throws(() => adiffQuery('[out:xml];way;out;', '2026-10-30T12:22:36Z'), /\[out:json\]/);
  assert.throws(() => adiffQuery('[out:json][date:"2026-01-01T00:00:00Z"];way;out;', '2026-10-30T12:22:36Z'), /already sets a date/);
});

test('created, modified and deleted elements, with way geometry and escaped text', () => {
  const xml = osm(BASE, [
    `<action type="create">${way(1, {conveying: 'forward', name: 'A &amp; B'}, [[10, 35.1, 139.1], [11, 35.2, 139.2]])}</action>`,
    // A way whose node moved: same version, new geometry.
    `<action type="modify"><old>${way(2, {highway: 'elevator'}, [[20, 1, 1], [21, 2, 2]])}</old><new>${way(2, {highway: 'elevator'}, [[20, 1, 1], [21, 2.5, 2]])}</new></action>`,
    // Deleted from OSM, and no longer matching (a tag removed).
    `<action type="delete"><old>${way(3, {conveying: 'yes'}, [[30, 0, 0], [31, 1, 1]])}</old><new><way id="3" visible="false" version="4" timestamp="2026-10-31T00:00:00Z"/></new></action>`,
    `<action type="delete"><old>${way(4, {conveying: 'yes'}, [[40, 0, 0], [41, 1, 1]])}</old><new><way id="4" visible="true" version="5" timestamp="2026-10-31T00:00:00Z"/></new></action>`,
    `<action type="create"><node id="9" lat="1.5" lon="2.5" version="1"><tag k="railway" v="signal"/></node></action>`,
  ].join('\n'));
  const {timestamp, upserts, deletes} = parseAdiff(xml);
  assert.equal(timestamp, BASE);
  assert.deepEqual(upserts.map(e => `${e.type}/${e.id}`), ['way/1', 'way/2', 'node/9']);
  assert.deepEqual(upserts[0].tags, {conveying: 'forward', name: 'A & B'});
  assert.deepEqual(upserts[0].nodes, [10, 11]);
  assert.deepEqual(upserts[1].geometry, [{lat: 1, lon: 1}, {lat: 2.5, lon: 2}], 'the new geometry, not the old');
  assert.deepEqual([upserts[2].lat, upserts[2].lon], [1.5, 2.5]);
  assert.deepEqual(deletes, ['way/3', 'way/4']);
});

test('a response that did not finish, was cut short, or cannot be read in full throws', () => {
  const ok = osm(BASE, '');
  assert.deepEqual(parseAdiff(ok), {timestamp: BASE, upserts: [], deletes: []});
  assert.throws(() => parseAdiff(ok.replace('</osm>\n', '')), /Incomplete/);
  assert.throws(() => parseAdiff(osm(BASE, '<remark> runtime error: Query timed out in "query" at line 1 after 901 seconds. </remark>')), /timed out/);
  assert.throws(() => parseAdiff(ok.replace(/<meta[^>]*\/>/, '')), /database timestamp/);
  assert.throws(() => parseAdiff(osm(BASE, `<action type="modify"><old>${way(2, {}, [[1, 0, 0], [2, 1, 1]])}</old></action>`)), /without its new state/);
  assert.throws(() => parseAdiff(osm(BASE, `<action type="create"><way id="5"><nd ref="1" lat="0" lon="0"/><nd ref="2"/></way></action>`)), /partial geometry/);
  assert.throws(() => parseAdiff(osm(BASE, '<action type="rename"><way id="5"/></action>')), /Unknown change action/);
});

const sample = (id, tags, coords) => ({type: 'way', id, tags, geometry: coords.map(([lat, lon]) => ({lat, lon}))});
const previous = conveyingGeoJSON({elements: [
  sample(1, {conveying: 'forward'}, [[0, 0], [0, 1]]),
  sample(2, {highway: 'elevator'}, [[1, 1], [1, 2]]),
  sample(3, {conveying: 'yes'}, [[2, 2], [2, 3]]),
  ...Array.from({length: 40}, (_, i) => sample(100 + i, {conveying: 'forward'}, [[3, i], [3, i + 0.5]])),
]}).features;
const toFeatures = elements => conveyingGeoJSON({elements}).features;

test('changes replace, add and remove features by OSM way, as a full download would give them', () => {
  const changes = {upserts: [sample(1, {conveying: 'backward'}, [[0, 0], [0, 1]]), sample(2, {highway: 'elevator', 'conveying': 'no'}, [[1, 1], [1, 2]]),
    sample(4, {conveying: 'reversible'}, [[5, 5], [5, 6]])], deletes: ['way/3']};
  const next = applyFeatureChanges(previous, changes, toFeatures).sort((a, b) => a.id - b.id);
  const full = conveyingGeoJSON({elements: [
    sample(1, {conveying: 'backward'}, [[0, 0], [0, 1]]), sample(2, {highway: 'elevator', conveying: 'no'}, [[1, 1], [1, 2]]),
    sample(4, {conveying: 'reversible'}, [[5, 5], [5, 6]]),
    ...Array.from({length: 40}, (_, i) => sample(100 + i, {conveying: 'forward'}, [[3, i], [3, i + 0.5]])),
  ]}).features;
  assert.deepEqual(next, full);
  assert.deepEqual(next[0].geometry.coordinates, [[1, 0], [0, 0]], 'a backward escalator is reversed, as in a full download');
});

test('the snapshot is updated from its database time, and any doubt falls back to the full download', async () => {
  const now = Date.parse('2026-11-01T07:00:00Z'), warnings = [], asked = [];
  const fetchText = async query => { asked.push(query); return osm(BASE, `<action type="create">${way(4, {conveying: 'forward'}, [[1, 5, 5], [2, 5, 6]])}</action>`); };
  const base = {features: previous, since: '2026-10-30T12:22:36Z', query: CONVEYING_QUERY, toFeatures, now, version: 'v1', previousVersion: 'v1', warn: (...m) => warnings.push(m.join(' '))};
  const result = await updateFromChanges({...base, fetchText});
  assert.equal(asked[0], adiffQuery(CONVEYING_QUERY, '2026-10-30T12:22:36Z'));
  assert.equal(result.osmBase, BASE, 'the next update starts from the new database time');
  assert.equal(result.features.length, previous.length + 1);
  assert.deepEqual([result.upserts, result.deletes], [1, 0]);
  // However old the snapshot, its changes make it exact: no age limit.
  const old = await updateFromChanges({...base, since: '2025-06-01T00:00:00Z', fetchText: async query => { asked.push(query); return osm(BASE, ''); }});
  assert.equal(old.osmBase, BASE);
  assert.equal(asked.at(-1), adiffQuery(CONVEYING_QUERY, '2025-06-01T00:00:00Z'));
  // No time, a failed request, an unreadable response, or a large drop:
  // null, so the caller downloads in full.
  assert.equal(await updateFromChanges({...base, since: undefined, fetchText}), null);
  assert.equal(await updateFromChanges({...base, fetchText: async () => { throw new Error('Overpass HTTP 502'); }}), null);
  assert.equal(await updateFromChanges({...base, fetchText: async () => osm(BASE, '').replace('</osm>\n', '')}), null);
  assert.equal(await updateFromChanges({...base, fetchText: async () => osm(BASE, previous.slice(0, 10).map(f =>
    `<action type="delete"><old/><new><way id="${f.id}" visible="false"/></new></action>`).join(''))}), null, 'losing over 5% is not trusted');
  assert.equal(await updateFromChanges({...base, features: [], fetchText}), null);
  assert.ok(warnings.some(w => /502/.test(w)) && warnings.some(w => /drop/.test(w)));
  assert.ok(!warnings.some(w => /days/.test(w)));
  // The failure of a request that was made is passed on, for its Retry-After.
  const refused = Object.assign(new Error('Overpass HTTP 429'), {status: 429, retryAfter: '300'}), seen = [];
  assert.equal(await updateFromChanges({...base, fetchText: async () => { throw refused; }, failed: e => seen.push(e)}), null);
  assert.deepEqual(seen, [refused]);
  await updateFromChanges({...base, since: undefined, fetchText, failed: e => seen.push(e)});
  assert.equal(seen.length, 1, 'no request, nothing to wait for');
});

test('the conveying build updates from changes and keeps the full download as its fallback', () => {
  const source = readFileSync(new URL('../scripts/build-conveying.mjs', import.meta.url), 'utf8');
  assert.match(source, /if\(update\) console\.log[^\n]*\nelse for\(let attempt=0;attempt<3;attempt\+\+\)/);
  assert.match(source, /if \(!conveyingRequestFits\(deadline, 0\)\) throw new Error\('No request fits/);
  // A refused change request's wait (Retry-After) comes before the full download, within the budget.
  const wait = source.indexOf('const wait = conveyingRetryDelay(changeError, 0);');
  assert.ok(wait > 0 && wait < source.indexOf('else for(let attempt=0;attempt<3;attempt++)'));
  assert.ok(source.indexOf('conveyingRequestFits(deadline, wait)', wait) < source.indexOf('await new Promise(r=>setTimeout(r,wait));', wait));
  const workflow = readFileSync(new URL('../.github/workflows/conveying.yml', import.meta.url), 'utf8');
  assert.ok(workflow.indexOf('PREVIOUS_DATA=/tmp/previous-conveying') < workflow.indexOf('node scripts/build-conveying.mjs'));
});

test('a snapshot made by another query or conversion code is downloaded in full, never patched', async () => {
  const asked = [];
  const result = await updateFromChanges({features: previous, since: '2026-10-30T12:22:36Z', query: CONVEYING_QUERY, toFeatures, warn: () => {},
    version: 'new', previousVersion: undefined, fetchText: async q => { asked.push(q); return osm(BASE, ''); }});
  assert.equal(result, null);
  assert.deepEqual(asked, [], 'no change request');
  // The version covers the query and every local module the converter imports.
  const {mkdtemp, writeFile, mkdir, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {pathToFileURL} = await import('node:url');
  const root = await mkdtemp(join(tmpdir(), 'extraction-'));
  try {
    await mkdir(join(root, 'scripts')); await mkdir(join(root, 'styles'));
    await writeFile(join(root, 'scripts', 'convert.mjs'), "import {rule} from '../styles/rule.mjs';\nexport const convert = x => rule(x);\n");
    await writeFile(join(root, 'styles', 'rule.mjs'), 'export const rule = x => x;\n');
    const entry = pathToFileURL(join(root, 'scripts', 'convert.mjs')), v1 = extractionVersion('q', entry);
    assert.equal(extractionVersion('q', entry), v1, 'stable');
    assert.notEqual(extractionVersion('q2', entry), v1, 'the query counts');
    await writeFile(join(root, 'styles', 'rule.mjs'), 'export const rule = x => !x;\n');
    assert.notEqual(extractionVersion('q', entry), v1, 'an imported module counts');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('a selection query in a comparable form: one statement or one union, then one output', () => {
  assert.deepEqual(selectionParts(CONVEYING_QUERY), {settings: '[timeout:900][maxsize:1073741824]',
    union: '(way[conveying][conveying!=no];way[highway=elevator];)', out: 'out tags geom qt'});
  assert.equal(selectionParts(AERIALWAY_QUERY).union, `(${AERIALWAY_QUERY.slice(AERIALWAY_QUERY.indexOf(';') + 1, AERIALWAY_QUERY.indexOf(';out'))};)`);
  assert.equal(selectionParts('[out:json];(way[a](1,2,3,4););out geom;').union, '(way[a](1,2,3,4);)');
  // A sequence's result is not the union of its statements; several outputs
  // or unions, another format or a date cannot be compared.
  for (const q of ['[out:json];rel[x];way(r);out;', '[out:json];(way[a];);(way[b];);out;', '[out:json];way[a];out;node[b];out;',
    '[out:xml];way[a];out;', '[out:json][date:"2026-01-01T00:00:00Z"];way[a];out;', '[out:json];(way[a];out;'])
    assert.equal(selectionParts(q), null, q);
});

test('a changed selection is fetched as its difference at one database time', () => {
  const at = '2026-11-01T06:00:00Z', wider = CONVEYING_QUERY.replace('way[highway=elevator];', 'way[highway=elevator];way[railway=funicular];');
  const {added, dropped} = selectionChangeQueries(CONVEYING_QUERY, wider, at);
  const sets = '[out:json][timeout:900][maxsize:1073741824][date:"2026-11-01T06:00:00Z"];(way[conveying][conveying!=no];way[highway=elevator];)->.previous;(way[conveying][conveying!=no];way[highway=elevator];way[railway=funicular];)->.current;';
  assert.equal(added, `${sets}(.current; - .previous;);out tags geom qt;`);
  assert.equal(dropped, `${sets}(.previous; - .current;);out ids;`);
  assert.deepEqual(selectionChangeQueries(CONVEYING_QUERY, CONVEYING_QUERY.replace('[timeout:900]', '[timeout:600]'), at), {}, 'settings alone select nothing new');
  assert.equal(selectionChangeQueries(CONVEYING_QUERY, CONVEYING_QUERY.replace('out tags geom qt', 'out body geom qt'), at), null, 'another output form: in full');
  assert.equal(selectionChangeQueries('[out:json];rel[x];way(r);out;', CONVEYING_QUERY, at), null);
});

test('stored elements follow changes and a changed query without a full download', async () => {
  const pick = ({type, id, tags, geometry}) => ({type, id, tags, geometry});
  const stored = [sample(1, {conveying: 'forward'}, [[0, 0], [0, 1]]), sample(2, {highway: 'elevator'}, [[1, 1], [1, 2]]),
    ...Array.from({length: 40}, (_, i) => sample(100 + i, {conveying: 'forward'}, [[3, i], [3, i + 0.5]]))];
  const since = '2026-10-30T12:22:36Z', asked = [], warnings = [];
  const json = elements => JSON.stringify({osm3s: {timestamp_osm_base: BASE}, elements});
  const base = {elements: stored, since, previousQuery: CONVEYING_QUERY, warn: (...m) => warnings.push(m.join(' '))};
  const diff = osm(BASE, `<action type="modify"><old>${way(1, {conveying: 'forward'}, [[1, 0, 0], [2, 0, 1]])}</old><new>${way(1, {conveying: 'backward'}, [[1, 0, 0], [2, 0, 1]])}</new></action>`);
  // Same query: one change request.
  const same = await updateElements({...base, query: CONVEYING_QUERY, pick, fetchText: async q => { asked.push(q); return diff; }});
  assert.deepEqual(asked, [adiffQuery(CONVEYING_QUERY, since)]);
  assert.equal(same.osmBase, BASE);
  assert.deepEqual(same.elements.find(e => e.id === 1), sample(1, {conveying: 'backward'}, [[0, 0], [0, 1]]), 'the new state, as the full download gives it');
  assert.equal(same.elements.length, stored.length);
  // Changed query: the changes of the old one, then only the difference, at the database time of those changes.
  const narrower = CONVEYING_QUERY.replace('way[highway=elevator];', ''), wider = CONVEYING_QUERY.replace('way[highway=elevator];', 'way[highway=elevator];way[railway=funicular];');
  asked.length = 0;
  const funicular = {...sample(7, {railway: 'funicular', conveying: 'yes'}, [[4, 4], [4, 5]]), bounds: {}};
  const grown = await updateElements({...base, query: wider, pick, fetchText: async q => {
    asked.push(q);
    return q.includes('[adiff:') ? diff : q.endsWith('out ids;') ? json([]) : json([funicular]);
  }});
  const {added, dropped} = selectionChangeQueries(CONVEYING_QUERY, wider, BASE);
  assert.deepEqual(asked, [adiffQuery(CONVEYING_QUERY, since), dropped, added]);
  assert.deepEqual(grown.elements.find(e => e.id === 7), pick(funicular), 'kept as the conversion reads it');
  assert.deepEqual([grown.added, grown.dropped, grown.elements.length], [1, 0, stored.length + 1]);
  const shrunk = await updateElements({...base, query: narrower, pick, fetchText: async q =>
    q.includes('[adiff:') ? osm(BASE, '') : q.endsWith('out ids;') ? json([{type: 'way', id: 2}]) : json([])});
  assert.ok(!shrunk.elements.some(e => e.id === 2), 'an element the query no longer selects goes, however many');
  assert.equal(shrunk.dropped, 1);
  // The conversion is applied to every stored element on each run, so it never needs a download.
  assert.deepEqual(conveyingGeoJSON({elements: grown.elements}).features.map(f => f.id), [1, 2, 7, ...stored.slice(2).map(e => e.id)]);
  // Anything doubtful: null, and the caller downloads in full.
  const fail = async () => { throw Object.assign(new Error('Overpass HTTP 429'), {status: 429}); }, seen = [];
  assert.equal(await updateElements({...base, query: CONVEYING_QUERY, fetchText: fail, failed: e => seen.push(e)}), null);
  assert.equal(seen.length, 1, 'a refused request is passed on, for its Retry-After');
  assert.equal(await updateElements({...base, previousQuery: undefined, query: CONVEYING_QUERY, fetchText: async () => diff}), null);
  assert.equal(await updateElements({...base, since: undefined, query: CONVEYING_QUERY, fetchText: async () => diff}), null);
  assert.equal(await updateElements({...base, query: CONVEYING_QUERY.replace('out tags geom qt', 'out body geom qt'), fetchText: async () => diff}), null);
  assert.equal(await updateElements({...base, query: wider, fetchText: async q => q.includes('[adiff:') ? diff : JSON.stringify({remark: 'runtime error: Query timed out'})}), null);
  assert.equal(await updateElements({...base, query: CONVEYING_QUERY, fetchText: async () => osm(BASE, stored.slice(0, 10).map(e =>
    `<action type="delete"><old/><new><way id="${e.id}" visible="false"/></new></action>`).join(''))}), null, 'changes losing over 5% are not trusted');
  assert.ok(warnings.some(w => /output or form/.test(w)) && warnings.some(w => /timed out/.test(w)));
});

test('the conveying build keeps its elements and converts all of them on every run', () => {
  const source = readFileSync(new URL('../scripts/build-conveying.mjs', import.meta.url), 'utf8');
  assert.match(source, /elements:JSON\.parse\(gunzipSync\(await readFile\(join\(process\.env\.PREVIOUS_DATA,'elements\.json\.gz'\)\)\)\),\n\s*since:manifest\.osmBase,previousQuery:manifest\.query/);
  assert.match(source, /const elements=\(update\?update\.elements:data\.elements\.map\(pick\)\)/);
  assert.match(source, /const \{features\}=conveyingGeoJSON\(\{elements\}\);/);
  assert.match(source, /writeFile\(new URL\('elements\.json\.gz',root\)/);
  assert.match(source, /query,license:/, 'the manifest records the query the next run compares with');
  const workflow = readFileSync(new URL('../.github/workflows/conveying.yml', import.meta.url), 'utf8');
  assert.match(workflow, /checkout FETCH_HEAD -- elements\.json\.gz manifest\.json/);
  const site = readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  assert.match(site, /tar -x -C styles\/data\/conveying --exclude=elements\.json\.gz/, 'the stored elements are not deployed');
});
