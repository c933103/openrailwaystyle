// Branch lines built from the stored railway-ways regions
// (build-railway-ways.mjs) instead of their own Overpass requests.
//
// Each stage whose pass is complete in the store replaces the lines it owns.
// A line belongs to the first stage, in the stages' order, whose regions
// return it (a region also returns lines beyond it, as members of routes
// that reach into it), as branchStageOwner gives for the stage-by-stage
// download. Lines of stages not yet in the store stay as they were. As for a
// downloaded refresh, a stage that would lose over a fifth of its lines
// keeps them (an incomplete response is likelier than such a loss).
import {STAGES} from './download-stages.mjs';
import {branchStageOwner, toFeatures} from './branch-lines.mjs';
import {branchView} from './railway-ways.mjs';

const order = new Map(STAGES.map((stage, index) => [stage.name, index]));

// regions: the stored regions, an (async) iterable of
// {stage, response}; completed: stage name → completion time in the store.
export async function branchTableFromStore(previous, regions, completed, {warn = console.warn} = {}) {
  const found = new Map();
  for await (const region of regions) {
    if (!completed[region.stage]) continue;
    for (const feature of toFeatures(branchView(region.response))) {
      const seen = found.get(feature.id);
      if (!seen || order.get(region.stage) < order.get(seen.stage)) found.set(feature.id, {feature, stage: region.stage});
    }
  }
  const stored = new Set(Object.keys(completed).filter(name => completed[name] && order.has(name)));
  const table = new Map(previous);
  const stale = new Map([...stored].map(name => [name, []])), before = new Map([...stored].map(name => [name, 0]));
  for (const line of previous.values()) if (stored.has(line.stage)) {
    before.set(line.stage, before.get(line.stage) + 1);
    if (!found.has(line.id)) stale.get(line.stage).push(line.id);
  }
  const applied = [];
  for (const name of stored) {
    const lost = stale.get(name), total = before.get(name);
    const suspicious = total > 100 && lost.length > total * 0.2;
    if (suspicious) warn(`Stored regions of ${name} would remove ${lost.length} of ${total} lines; keeping them`);
    else for (const id of lost) table.delete(id);
    applied.push({stage: name, completed: completed[name], removed: suspicious ? 0 : lost.length, kept: suspicious ? lost.length : 0});
  }
  for (const [id, {feature, stage}] of found) {
    // A line held by a stage the store does not have yet (or a retired
    // Europe fallback) moves only to an earlier stage, as when downloaded.
    const held = table.get(id)?.stage;
    const owner = held && !stored.has(held) ? branchStageOwner(held, stage) : stage;
    table.set(id, {...feature, stage: owner});
  }
  for (const item of applied) item.lines = [...table.values()].filter(line => line.stage === item.stage).length;
  return {table, applied};
}
