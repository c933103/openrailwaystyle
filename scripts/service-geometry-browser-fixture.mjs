// Deterministic observations for real MapLibre service-geometry QA.
// These are synthetic fixtures, not live OSM or real timetable assertions.
import {toTable, addResult, commitStage, discardStage, readTable, writeTable, buildTiles, geometrySummary} from './service-routes.mjs';
import {FREQUENCY_PROFILES} from '../styles/service-frequency.mjs';

export function serviceGeometryBrowserFixtures() {
  const oldBase = '2026-10-06T00:00:00Z', newBase = '2026-10-07T00:00:00Z';
  const empty = () => ({routes: new Map(), ways: new Map()});
  const restore = table => readTable(writeTable(table));
  const fixtures = [];
  for (const zoom of [12, 16]) {
    // Same screen-space length at native tile zoom and at overscaled zoom.
    const step = zoom === 12 ? .0175 : .00109375;
    const points = Array.from({length: 5}, (_, i) => [114.15 + (i - 2) * step, 22.30]);
    const relation = id => ({
      type: 'relation', id, version: 1, timestamp: '2026-10-01T00:00:00Z',
      tags: {type: 'route', route: 'subway', ref: String(id), name: `Synthetic Line ${id}`,
        network: 'Geometry audit', colour: id === 1 ? '#ce233b' : '#1667cc'},
      members: [{type: 'way', ref: 101, role: ''}],
    });
    function observe({coords = points, nodes = [1, 2, 3, 4, 5], version = 4, base = oldBase, absent = false} = {}) {
      return toTable({osm3s: {timestamp_osm_base: base}, elements: [relation(1), relation(2), {
        type: 'way', id: 101, version, nodes,
        timestamp: version === 4 ? '2026-10-01T00:00:00Z' : '2026-10-06T12:00:00Z',
        ...(!absent ? {geometry: coords.map(value => value && {lon: value[0], lat: value[1]})} : {}),
      }]}, {query: 'synthetic-browser-audit'});
    }
    function accepted(observations) {
      const table = empty();
      for (const observation of observations) addResult(table, observation, 'A');
      commitStage(table, 'A');
      return restore(table);
    }
    const full = observe();
    const short = observe({coords: points.slice(0, 2), nodes: [1, 2], version: 5, base: newBase});
    const fragment = [points[0], points[1], null, points[3], points[4]];
    const gap = observe({coords: fragment, base: newBase});
    const unavailable = observe({absent: true, base: newBase});
    const pending = accepted([full]);
    addResult(pending, short, 'B');
    const discarded = restore(pending);
    discardStage(discarded, 'B');
    const conflictPoints = structuredClone(points);
    conflictPoints[2][1] += .001;
    const cases = [
      ['complete', 'Complete accepted source', accepted([full]), [1, 1, 1, 1]],
      ['shortened', 'Newest shortened; old arrives later', accepted([short, full]), [1, 0, 0, 0]],
      ['gapped', 'Newest has a missing middle node', accepted([gap, full]), [1, 0, 0, 1]],
      ['unavailable', 'Newest geometry wholly unavailable', accepted([unavailable, full]), [0, 0, 0, 0]],
      ['same-snapshot', 'Same-snapshot partial repeat', accepted([observe({coords: fragment}), full, observe({coords: fragment})]), [1, 1, 1, 1]],
      ['pending', 'Shorter refresh pending, old retained', restore(pending), [1, 1, 1, 1]],
      ['discarded', 'Shorter refresh discarded', discarded, [1, 1, 1, 1]],
      ['conflict', 'Same-newest coordinate conflict', accepted([observe({base: newBase}), observe({base: newBase, coords: conflictPoints})]), [1, 0, 0, 1]],
    ];
    // Use the production catalog matcher and profile bundler. The geographic
    // coordinates and source ID merely exercise its Hong Kong match contract.
    const headways = {
      schema: 1,
      source: {id: 'mtr-hk', name: 'SYNTHETIC headway audit, not live service data',
        url: 'https://example.invalid/synthetic', checked: '2026-10-07', review_after_days: 30,
        quality: 'headway_estimate', period_definition: 'Synthetic varied rates for every supported profile'},
      routes: [1, 2].map(id => ({id: `synthetic-${id}`, scope: 'whole_route',
        match: {ref: String(id), network: 'Geometry audit', kind: 'subway'},
        profiles: Object.fromEntries(FREQUENCY_PROFILES.map((profile, i) => {
          const rate = id === 1 ? 2 + i % 7 : 10 + i % 15;
          return [profile, {minutes: [60 / rate, 60 / rate], reported: String(60 / rate)}];
        })),
      })),
    };
    for (const [name, label, table, expected] of cases) {
      fixtures.push({id: `z${zoom}-${name}`, name, label, zoom, points, expected,
        summary: geometrySummary(table), tiles: buildTiles(table, {headways}), unknownTiles: buildTiles(table)});
    }
  }
  return fixtures;
}
