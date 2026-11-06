// One Overpass request per stage region (scripts/download-stages.mjs) for
// three datasets that were downloaded apart: operating branch lines
// (branch-lines.mjs), urban service routes (service-routes.mjs) and means of
// power delivery (power-method-data.mjs). Their selections overlap: about a
// fifth of the service routes' track ways are branch lines and nearly half
// of the power-method ways are in one of the other two. One response returns
// each element once; each dataset's view selects, element by element, what
// its own query selects. A region's view can also hold such elements from
// beyond the region (a route's member ways reach into other regions, which
// return them too), so across all regions each view is what its own queries
// returned together.
import {partSelection} from './download-stages.mjs';
import {branchSelect} from './branch-lines.mjs';
import {serviceSelect, SERVICE_TRACKS} from './service-routes.mjs';
import {powerMethodSelection} from './power-method-data.mjs';

// Element metadata (version, timestamp) as the service routes need, and as a
// later change (augmented diff) request needs for every element.
export function railwayWaysQuery(part, box) {
  const branch = partSelection(part, box, branchSelect), service = partSelection(part, box, serviceSelect);
  // The power selection is several statements, not one union, so what a
  // part subtracts is subtracted from it as named sets.
  const {main, minus} = branch.plan;
  const named = (filter, result) => powerMethodSelection(filter, {charging: `c${result}`, potential: `q${result}`, result});
  let power;
  if (!minus.length) power = powerMethodSelection(main, {charging: 'pc', potential: 'pp', result: 'p'});
  else if (minus.every(entry => typeof entry === 'string')) power = `${powerMethodSelection(main, {charging: 'pc', potential: 'pp', result: 'pm'})}${minus.map((filter, i) =>
      powerMethodSelection(filter, {charging: `pc${i}`, potential: `pp${i}`, result: `px${i}`})).join('')}(.pm; - (${minus.map((_, i) => `.px${i};`).join('')});)->.p;`;
  else power = `${named(main, 'pm')}${minus.map((entry, i) => typeof entry === 'string' ? named(entry, `px${i}`)
      : `${named(entry.filter, `py${i}`)}${entry.minus.map((filter, j) => named(filter, `pz${i}_${j}`)).join('')}(.py${i}; - (${entry.minus.map((_, j) => `.pz${i}_${j};`).join('')});)->.px${i};`).join('')}`
    + `(.pm; - (${minus.map((_, i) => `.px${i};`).join('')});)->.p;`;
  return `[out:json][timeout:180][maxsize:536870912];${branch.areas}${branch.set}->.b;${service.set}->.r;${power}`
    + `.r out meta;(way(r.r)[railway~"${SERVICE_TRACKS}"];.b;.p;);out meta geom qt;`;
}

// The same selection as two queries with one output each, the route
// relations and the ways, for change requests (augmented diffs): Overpass
// documents those for a single output, not for several.
// A stored query (any version of railwayWaysQuery) splits the same way;
// null when it has no relation output to split at.
export function railwayWaysQueries(query) {
  const split = query.lastIndexOf('.r out meta;');
  if (split < 0) return null;
  const prefix = query.slice(0, split), ways = query.slice(split + '.r out meta;'.length);
  // The relations as the default set's output, `(.r;);out meta;` (the same
  // elements as `.r out meta;`), so each part is a selection with one output.
  return {relations: `${prefix}(.r;);out meta;`, ways: `${prefix}${ways}`};
}

// A stored region's elements by the output that selected them: the route
// relations (the first output) and the rest, whose power selection can hold
// relations too (charging stations). A region the change pass wrote records
// the first output's length (`relations`). In a full download the first
// output is relations only and the second, sorted by quadtile, begins with
// its nodes and ways. If it has none, its relations follow the route
// relations, which all match the service-route selection; each element there
// appears once.
export function storedOutputs(region) {
  const elements = region.response.elements;
  let split = Number.isSafeInteger(region.relations) ? region.relations : elements.findIndex(e => e.type !== 'relation');
  if (split < 0) {
    const seen = new Set();
    split = elements.findIndex(e => !isServiceRoute(e) || seen.has(e.id) || !seen.add(e.id));
    if (split < 0) split = elements.length;
  }
  return {relations: elements.slice(0, split), ways: elements.slice(split)};
}

const tagsOf = element => element.tags || {};
// The branch-line selection (BRANCH_SELECTS), element by element.
export function isBranchWay(element) {
  const tags = tagsOf(element);
  return element.type === 'way' && !('service' in tags)
    && (/^(rail|narrow_gauge)$/.test(tags.railway ?? '') && tags.usage === 'branch' || tags.railway === 'subway');
}
// The service-route selection (SERVICE_SELECTS), element by element.
export function isServiceRoute(element) {
  const tags = tagsOf(element);
  return element.type === 'relation' && tags.type === 'route'
    && (/^(subway|light_rail|tram|monorail)$/.test(tags.route ?? '') || tags.route === 'train' && /^(commuter|urban)$/.test(tags.service ?? ''));
}
const serviceTrack = new RegExp(SERVICE_TRACKS);

function elementsOf(json) {
  if (json?.remark || !Array.isArray(json?.elements)) throw new Error(json?.remark ? `Overpass: ${json.remark}` : 'Incomplete Overpass response');
  return json.elements;
}
const view = (json, elements) => ({...json, elements});

// What the branch-line query returns: the branch and metro ways.
export const branchView = json => view(json, elementsOf(json).filter(isBranchWay));
// What the service-route query returns: the routes, then those of their
// member ways that are tracks.
export function serviceView(json) {
  const elements = elementsOf(json), routes = elements.filter(isServiceRoute);
  const members = new Set(routes.flatMap(route => (route.members || []).filter(m => m.type === 'way').map(m => m.ref)));
  return view(json, [...routes, ...elements.filter(e => e.type === 'way' && members.has(e.id) && serviceTrack.test(tagsOf(e).railway ?? ''))]);
}
// What the power-method query returns, for powerMethodsGeoJSON: it keeps only
// track ways with a means of power delivery, propulsion or traction and
// railway chargers, which the merged selection always includes. Route
// relations, which the power-method query never returns, are left out.
export const powerView = json => view(json, elementsOf(json).filter(element => !isServiceRoute(element)));
