#!/usr/bin/env node
// Offline synthetic matcher measurements. No provider acquisition or publication.
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {captureOsmServiceEvidence, matchTimetablePattern} from './timetable-matching.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const snapshot = '2026-10-05T00:00:00Z';
function inputFor(evidence) {
  const pattern = evidence.patterns[0], source = evidence.source;
  const stationIds = [...new Set(pattern.calls.map(call => call.station_id))];
  const stations = new Map(stationIds.map((id, i) => [id, `node:${i + 1}`]));
  const osm = captureOsmServiceEvidence({type: 'relation', id: 1, version: 1, timestamp: snapshot, tags: {route: 'train', ref: 'R'}, members: [...stationIds.map((_, i) => ({type: 'node', ref: i + 1, role: 'stop'})), {type: 'way', ref: 100, role: ''}]}, snapshot);
  const binding = {feed_id: source.feed_id, source_sha256: source.sha256, status: 'verified'};
  return {evidence, pattern_id: pattern.id, now: Date.parse(snapshot) / 1000,
    context: {feed_id: source.feed_id, source_sha256: source.sha256, service_date: source.service_date, osm_snapshot: snapshot, review_until: source.valid_until, candidate_inventory: 'complete'},
    crosswalk: stationIds.map(station_id => ({...binding, station_id, osm_station_id: stations.get(station_id), osm_snapshot: snapshot})),
    candidates: [{service_id: 'controlled', status: 'verified', eligibility: 'eligible', osm, route_bindings: [{...binding, route_id: pattern.source_route_id}], eligible_way_ids: [100], variants: [{id: 'controlled', status: 'verified', direction_id: pattern.direction_id, stations: pattern.calls.map(call => stations.get(call.station_id)), section_way_ids: [100]}]}]};
}
function child(path, mode) {
  if (statSync(path).size > 32 * 1024 * 1024) throw Error('Controlled sidecar exceeds input budget');
  const input = inputFor(JSON.parse(readFileSync(path, 'utf8')));
  if (mode === 'unbound') input.candidates.push({...structuredClone(input.candidates[0]), route_bindings: []});
  else if (mode === 'source-limit') {
    const call = {stop_id: 's'.repeat(1024), station_id: 'p'.repeat(1024), pickup_type: '0', drop_off_type: '0'};
    for (let i = 0; i < 17; i++) {
      const {id, ...definition} = {...input.evidence.patterns[0], shape_id: `limit${i}`, calls: Array(512).fill(call)};
      input.evidence.patterns.push({...definition, id: digest([input.evidence.source.feed_id, input.evidence.source.sha256, definition])});
    }
  } else if (mode === 'candidate-limit') {
    input.candidates = Array.from({length: 11}, () => ({...structuredClone(input.candidates[0]), eligible_way_ids: Array(10000).fill(100)}));
  } else if (mode !== 'verified') throw Error('Unknown controlled mode');
  const beforeRss = process.memoryUsage().rss, start = performance.now();
  const outcome = matchTimetablePattern(input), elapsed = performance.now() - start;
  const expected = mode === 'verified' ? ['verified', 'reviewed_identity_and_stops'] : mode === 'unbound' ? ['missing_evidence', 'missing_service_identity'] : ['missing_evidence', mode === 'source-limit' ? 'source_work_limit' : 'candidate_work_limit'];
  if (outcome.status !== expected[0] || outcome.reasons[0] !== expected[1] || outcome.frequency_status !== 'not_evaluated') throw Error(JSON.stringify(outcome));
  return {mode, milliseconds: +elapsed.toFixed(3), rss_before_bytes: beforeRss, rss_after_bytes: process.memoryUsage().rss, peak_process_rss_kib: process.resourceUsage().maxRSS, status: outcome.status, reason: outcome.reasons[0]};
}
if (process.argv[2] === '--child') {
  process.stdout.write(JSON.stringify(child(process.argv[3], process.argv[4])) + '\n');
} else {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-matcher-benchmark-'));
  try {
    const path = join(directory, 'evidence.json');
    const python = `import importlib.util,json,sys,hashlib\nfrom pathlib import Path\ndef load(name,path):\n s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m\nb=load('benchmark','scripts/benchmark-timetable-evidence.py')\nc=load('compiler','scripts/gtfs-frequency.py')\npath=Path(sys.argv[1]); archive=path.with_suffix('.zip')\nb.fixture(archive,10000,24,False)\nprofiles={f'h{h:02}':{'start':f'{h:02}:00:00','end':f'{h+1:02}:00:00'} for h in range(24)}\nprofiles.update({'am':{'start':'07:00:00','end':'09:00:00'},'pm':{'start':'16:00:00','end':'19:00:00'},'offpeak':{'start':'10:00:00','end':'16:00:00'},'overnight':{'start':'00:00:00','end':'06:00:00'}})\nresult=c.compile_feed(archive,{'source':{'id':'controlled-fixture'},'profiles':profiles},'2026-10-05',matching_evidence=True)\nevidence=result.pop('matching_evidence');assert evidence['status']=='captured'\npath.write_text(json.dumps(evidence,ensure_ascii=False,separators=(',',':')),encoding='utf-8')\nprint(json.dumps({'trips':10000,'stop_rows':240000,'profiles':len(result['profiles']),'patterns':len(evidence['patterns']),'observations':len(evidence['observations']),'sidecar_bytes':path.stat().st_size,'sidecar_sha256':hashlib.sha256(path.read_bytes()).hexdigest()}))\n`;
    const generated = spawnSync('python3', ['-c', python, path], {cwd: root, encoding: 'utf8', timeout: 300000});
    if (generated.status !== 0) throw Error(generated.stderr || 'Synthetic evidence generation failed');
    const results = [];
    for (let repeat = 0; repeat < 3; repeat++) for (const mode of ['verified', 'unbound', 'source-limit', 'candidate-limit']) {
      const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', path, mode], {cwd: root, encoding: 'utf8', timeout: 120000});
      if (run.status !== 0) throw Error(run.stderr || 'Controlled matcher child failed');
      results.push({repeat, ...JSON.parse(run.stdout)});
    }
    process.stdout.write(JSON.stringify({schema: 1, synthetic: true, node: process.version, fixture: JSON.parse(generated.stdout),
      measurement: 'Fresh serial processes; elapsed time covers matching only, after parsing and fixture mutation. Peak process RSS includes Node startup, input parsing and fixture preparation, not just matcher allocations. This is not production profiling.',
      source_sha256: Object.fromEntries(['scripts/timetable-matching.mjs', 'scripts/benchmark-timetable-matching.mjs'].map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])), results}, null, 2) + '\n');
  } finally { rmSync(directory, {recursive: true, force: true}); }
}
