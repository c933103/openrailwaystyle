// Synthetic directions, branch and shared track; no external source acquisition.
import {addResult, commitStage, toTable} from './service-routes.mjs';

export function serviceProvenanceFixture({reverse = false} = {}) {
  const relation = (id, name, members, ref = 'A', kind = 'subway') => ({type: 'relation', id,
    tags: {type: 'route', route: kind, name, ref, network: 'Fixture Metro', colour: '#126a94'},
    members: members.map(ref => ({type: 'way', ref, role: ''}))});
  const way = (id, coordinates) => ({type: 'way', id, tags: {railway: 'subway'},
    geometry: coordinates.map(([lon, lat]) => ({lon, lat}))});
  const elements = [
    relation(10, 'Fixture A (Northbound)', [1, 2]),
    relation(20, 'Fixture A (Southbound)', [2, 3]),
    relation(30, 'Fixture A: branch → terminal', [2, 4]),
    relation(40, 'Unrelated B', [2, 5], 'B'),
    relation(50, 'Distant A', [6]),
    relation(60, 'Unrelated tram', [2], 'A', 'tram'),
    way(1, [[.005, .04], [.025, .04]]),
    way(2, [[.025, .04], [.045, .04]]),
    way(3, [[.045, .04], [.065, .04]]),
    way(4, [[.045, .04], [.065, .06]]),
    way(5, [[.005, .065], [.025, .065]]),
    way(6, [[5.005, .04], [5.025, .04]]),
  ];
  const table = {routes: new Map(), ways: new Map()};
  for (const stage of reverse ? ['B', 'A'] : ['A', 'B']) {
    addResult(table, toTable({elements: reverse ? [...elements].reverse() : elements}), stage);
    commitStage(table, stage);
  }
  return table;
}
