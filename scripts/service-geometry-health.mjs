// Both zero-line and drawable partial/conflicting ways need reacquisition.
// This bounded state is a repair record, not a new scheduler or eligibility
// source. The existing region query supplies the next eligible observation.
import {drawnGeometry} from './service-routes.mjs';
import {drawnRelation, relationStatus} from './service-relations.mjs';
import {geometryStatus} from './service-geometry.mjs';
export function stageGeometryHealth(table, stage, {pending = false} = {}) {
  const counts = {complete: 0, partial: 0, conflict: 0, unknown: 0}, affectedWays = [], reasons = {};
  for (const way of [...table.ways.values()].sort((a, b) => a.id - b.id)) {
    if (!(stage in way.routes) && !(stage in way.next)) continue;
    if (pending && !way.nextGeometry?.[stage]) continue;
    const status = geometryStatus(pending ? way.nextGeometry[stage] : drawnGeometry(way));
    const classification = pending && status.ignoredUnverified?.length ? 'unknown' : status.status;
    counts[classification]++;
    if (classification === 'complete') continue;
    if (affectedWays.length < 100) affectedWays.push(way.id);
    for (const reason of status.reasons) reasons[reason] = (reasons[reason] || 0) + 1;
  }
  const relationCounts = {complete: 0, partial: 0, conflict: 0, unknown: 0}, affectedRelations = [];
  for (const route of [...table.routes.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    if (!(stage in route.stages) && !(stage in route.next)) continue;
    if (pending && !route.next[stage]) continue;
    const evidence = pending ? route.next[stage].membership : drawnRelation(route), status = relationStatus(evidence);
    const classification = pending && evidence?.ignoredUnverified?.length ? 'unknown' : status.status;
    relationCounts[classification]++;
    if (classification === 'complete') continue;
    if (affectedRelations.length < 100) affectedRelations.push(evidence?.view.relation ?? route.next[stage]?.relation ?? route.stages[stage]?.relation);
    for (const reason of status.reasons) reasons[reason] = (reasons[reason] || 0) + 1;
  }
  return {status: counts.partial + counts.conflict + counts.unknown + relationCounts.partial + relationCounts.conflict + relationCounts.unknown ? 'incomplete' : 'complete', counts, affectedWays, relationCounts, affectedRelations: affectedRelations.sort((a, b) => a - b),
    reasons: Object.fromEntries(Object.entries(reasons).sort(([a], [b]) => a.localeCompare(b)))};
}
