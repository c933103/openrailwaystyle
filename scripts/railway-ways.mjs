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
  // The power selection is several statements, not one union, so a part's
  // excluded areas are subtracted from it as named sets.
  const [main, ...excluded] = branch.filters;
  const power = excluded.length
    ? `${powerMethodSelection(main, {charging: 'pc', potential: 'pp', result: 'pm'})}${excluded.map((filter, i) =>
      powerMethodSelection(filter, {charging: `pc${i}`, potential: `pp${i}`, result: `px${i}`})).join('')}(.pm; - (${excluded.map((_, i) => `.px${i};`).join('')}););->.p;`
    : powerMethodSelection(main, {charging: 'pc', potential: 'pp', result: 'p'});
  return `[out:json][timeout:180][maxsize:536870912];${branch.areas}${branch.set}->.b;${service.set}->.r;${power}`
    + `.r out meta;(way(r.r)[railway~"${SERVICE_TRACKS}"];.b;.p;);out meta geom qt;`;
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
