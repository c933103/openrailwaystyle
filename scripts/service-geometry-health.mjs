// Both zero-line and drawable partial/conflicting ways need reacquisition.
// This bounded state is a repair record, not a new scheduler or eligibility
// source. The existing region query supplies the next eligible observation.
import {drawnGeometry} from './service-routes.mjs';
import {drawnRelation, relationCoverage, relationStatus} from './service-relations.mjs';
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
  const relationCounts = {complete: 0, partial: 0, conflict: 0, unknown: 0}, affectedRelations = [], unavailableRelations = [];
  for (const route of [...table.routes.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    if (!(stage in route.stages) && !(stage in route.next)) continue;
    if (pending && !route.next[stage]) continue;
    const evidence = pending ? route.next[stage].membership : drawnRelation(route), status = relationStatus(evidence);
    const coverage = relationCoverage(evidence, route.key, table.ways, pending ? stage : undefined);
    const classification = pending && evidence?.ignoredUnverified?.length ? 'unknown' : status.status;
    relationCounts[classification]++;
    if (coverage.unavailableMemberships.length && unavailableRelations.length < 100) unavailableRelations.push(evidence.view.relation);
    if (classification === 'complete' && !coverage.unavailableMemberships.length) continue;
    if (affectedRelations.length < 100) affectedRelations.push(evidence?.view.relation ?? route.next[stage]?.relation ?? route.stages[stage]?.relation);
    for (const reason of coverage.reasons) reasons[reason] = (reasons[reason] || 0) + 1;
  }
  const sourceStatus = counts.partial + counts.conflict + counts.unknown + relationCounts.partial + relationCounts.conflict + relationCounts.unknown ? 'incomplete' : 'complete';
  return {status: sourceStatus === 'incomplete' || unavailableRelations.length ? 'incomplete' : 'complete', sourceStatus, counts, affectedWays, relationCounts, affectedRelations: affectedRelations.sort((a, b) => a - b), unavailableRelations: unavailableRelations.sort((a, b) => a - b),
    reasons: Object.fromEntries(Object.entries(reasons).sort(([a], [b]) => a.localeCompare(b)))};
}

// A different stage can remove a shared row needed by a retained frontier.
// Update only affected stage health (and previously marked dependencies),
// preserving each stage's observed refresh outcome and attempt count.
export function refreshRelationDependencyHealth(state, table, checked) {
  const affected = new Set(Object.entries(state.stages || {}).filter(([, info]) => info.geometry?.dependencyGap).map(([name]) => name));
  for (const route of table.routes.values()) if (relationCoverage(drawnRelation(route), route.key, table.ways).unavailableMemberships.length)
    for (const stage of Object.keys(route.stages)) if (state.stages?.[stage]) affected.add(stage);
  for (const stage of affected) {
    const info = state.stages[stage], old = info.geometry || {}, health = stageGeometryHealth(table, stage);
    const previous = old.sourceOutcome || old.dependencyGap?.previous || {status: old.status || 'complete', lastFailure: old.lastFailure || null, retry: old.retry || null};
    if (health.unavailableRelations.length) info.geometry = {...old, ...health, status: 'incomplete', lastFailure: 'retained-relation-membership-unavailable', retry: 'next-stage-refresh',
      dependencyGap: {checked, relations: health.unavailableRelations, previous}};
    else {
      const relationProblem = health.relationCounts.partial + health.relationCounts.conflict + health.relationCounts.unknown;
      const outcome = health.status === 'complete' ? previous : {status: 'incomplete', retry: 'next-stage-refresh',
        lastFailure: previous.status === 'incomplete' && previous.lastFailure ? previous.lastFailure : relationProblem ? 'unresolved-source-relations' : 'unresolved-source-geometry'};
      info.geometry = {...old, ...health, ...outcome};
      delete info.geometry.dependencyGap;
    }
  }
}
