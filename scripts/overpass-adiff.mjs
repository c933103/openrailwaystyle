// Changes between two OSM database times from an Overpass augmented diff
// ([adiff:"<since>"], answered in XML only). A dataset kept as features, one
// per OSM element, is brought up to date with them instead of being
// downloaded again.
//
// What Overpass documents (wiki.openstreetmap.org/wiki/Overpass_API/Augmented_Diffs):
// - "modify": the element matches the query at both times and differs; a way
//   also counts as changed when one of its nodes moved, and ways come with
//   their geometry;
// - "delete": the element no longer matches the query at the end time; its
//   <new> is an empty element, visible="false" when deleted from OSM and
//   visible="true" when it only stopped matching (a tag removed).
// Anything this parser cannot read in full throws, so a caller falls back to
// its full download rather than publishing a guess.

import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

// What an extraction makes of OSM data: its query and the source of the
// modules that convert the response (`entries`, with every local module
// they import). A snapshot is brought up to date by changes only while this
// stays the same: changes are converted by the current code, so a snapshot
// made by other code or another query would mix two interpretations.
export function extractionVersion(query, ...entries) {
  const files = new Map();
  const visit = url => {
    if (files.has(url.href)) return;
    const text = readFileSync(url, 'utf8');
    files.set(url.href, text);
    for (const [, spec] of text.matchAll(/(?:from|import)\s+'(\.{1,2}\/[^']+\.mjs)'/g)) visit(new URL(spec, url));
  };
  entries.forEach(visit);
  const hash = createHash('sha256').update(query);
  // Paths from the repository's scripts/ or styles/ folder, so the version
  // does not depend on where the checkout is.
  for (const href of [...files.keys()].sort()) hash.update(`\n${href.replace(/^.*?\/(scripts|styles)\//, '$1/')}\n`).update(files.get(href));
  return hash.digest('hex');
}

// The augmented diff of a JSON selection query ([out:json]...;...;out ...;),
// from `since` to now: the same selection, in XML. Every output asks for
// `meta`: XML prints a way's nodes (and so its geometry) only in modes with
// members, which `out tags` lacks, and Overpass documents augmented diffs as
// meaningful only with `out meta` (or `out geom meta`): without the meta data
// they are no better than a plain diff
// (dev.overpass-api.de/overpass-doc/en/analysis/museum.html).
export function adiffQuery(query, since) {
  if (!TIME.test(since || '')) throw new Error('Invalid change start');
  const settings = /^\[out:json\]((?:\[[^\]]+\])*);/.exec(query || '');
  if (!settings) throw new Error('A change query needs an [out:json] selection query');
  if (/\[(?:adiff|diff|date):/.test(settings[1])) throw new Error('The selection query already sets a date');
  return `[out:xml]${settings[1]}[adiff:"${since}"];${query.slice(settings[0].length).replace(/\bout( (?:ids|skel|tags|body|meta))?\b/g, 'out meta')}`;
}

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
const unescape = text => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code) =>
  code[0] !== '#' ? ENTITIES[code.toLowerCase()] : String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))));
const attributes = text => Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, unescape(value)]));
const ELEMENT = /<(node|way|relation)\s([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/;

// One element as Overpass JSON would give it: tags, a node's position, a
// way's node ids and geometry, a relation's members.
function element(text) {
  const match = ELEMENT.exec(text || '');
  if (!match) return null;
  const [, type, attrText, body = ''] = match, attrs = attributes(attrText), id = Number(attrs.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Change without a valid ${type} id`);
  const result = {type, id};
  for (const key of ['version', 'changeset']) if (attrs[key] !== undefined) result[key] = Number(attrs[key]);
  for (const key of ['timestamp', 'user']) if (attrs[key] !== undefined) result[key] = attrs[key];
  if (attrs.visible !== undefined) result.visible = attrs.visible === 'true';
  const tags = {};
  for (const [, tag] of body.matchAll(/<tag\s([^>]*?)\/>/g)) { const {k, v} = attributes(tag); if (k !== undefined) tags[k] = v ?? ''; }
  if (Object.keys(tags).length) result.tags = tags;
  if (type === 'node' && (attrs.lat !== undefined || attrs.lon !== undefined)) {
    result.lat = Number(attrs.lat); result.lon = Number(attrs.lon);
    if (!Number.isFinite(result.lat) || !Number.isFinite(result.lon)) throw new Error(`Change node ${id} with invalid coordinates`);
  }
  if (type === 'way') {
    const nds = [...body.matchAll(/<nd\s([^>]*?)\/>/g)].map(([, nd]) => attributes(nd));
    if (nds.length) {
      result.nodes = nds.map(nd => Number(nd.ref));
      // Every point or none: a way with a partial geometry is not usable.
      if (nds.every(nd => nd.lat !== undefined && nd.lon !== undefined)) result.geometry = nds.map(nd => ({lat: Number(nd.lat), lon: Number(nd.lon)}));
      else if (nds.some(nd => nd.lat !== undefined)) throw new Error(`Change way ${id} with a partial geometry`);
    }
  }
  // `out center`: a way's or relation's centre, as Overpass JSON gives it.
  const center = type !== 'node' && /<center\s([^>]*?)\/>/.exec(body);
  if (center) {
    const {lat, lon} = attributes(center[1]);
    result.center = {lat: Number(lat), lon: Number(lon)};
    if (!Number.isFinite(result.center.lat) || !Number.isFinite(result.center.lon)) throw new Error(`Change ${type} ${id} with an invalid centre`);
  }
  if (type === 'relation') {
    // With `out geom`, a node member carries its position and a way member
    // its points (<nd lat lon/> inside the member), as Overpass JSON gives
    // them in `lat`/`lon` and `geometry`.
    const members = [...body.matchAll(/<member\s([^>]*?)(?:\/>|>([\s\S]*?)<\/member>)/g)].map(([, m, inner = '']) => {
      const attrs = attributes(m), member = {type: attrs.type, ref: Number(attrs.ref), role: attrs.role ?? ''};
      if (attrs.lat !== undefined) { member.lat = Number(attrs.lat); member.lon = Number(attrs.lon); }
      const points = [...inner.matchAll(/<nd\s([^>]*?)\/>/g)].map(([, nd]) => attributes(nd));
      if (points.length) member.geometry = points.map(p => ({lat: Number(p.lat), lon: Number(p.lon)}));
      return member;
    });
    if (members.length) result.members = members;
  }
  return result;
}

// {timestamp, upserts, deletes}: the new state of every element created or
// changed, and the `type/id` keys of elements deleted or no longer matching.
// A response that did not run to completion, or that the server cut short
// with a remark, throws.
export function parseAdiff(xml) {
  if (typeof xml !== 'string' || !/<\/osm>\s*$/.test(xml)) throw new Error('Incomplete change response');
  const remark = /<remark>([\s\S]*?)<\/remark>/.exec(xml);
  if (remark) throw new Error(unescape(remark[1].trim()));
  const timestamp = /<meta\s[^>]*osm_base="([^"]+)"/.exec(xml)?.[1];
  if (!TIME.test(timestamp || '')) throw new Error('Change response without a database timestamp');
  const upserts = [], deletes = [];
  for (const [, type, body] of xml.matchAll(/<action type="([^"]*)">([\s\S]*?)<\/action>/g)) {
    if (type === 'create') { const created = element(body); if (!created) throw new Error('Empty create action'); upserts.push(created); continue; }
    if (type !== 'modify' && type !== 'delete') throw new Error(`Unknown change action ${type}`);
    const next = element(/<new>([\s\S]*?)<\/new>/.exec(body)?.[1]);
    if (!next) throw new Error(`A ${type} action without its new state`);
    if (type === 'delete') deletes.push(`${next.type}/${next.id}`);
    else upserts.push(next);
  }
  return {timestamp, upserts, deletes};
}

// A feature collection with features keyed by OSM element (`keyOf`, by
// default the way id the feature carries), brought up to date: each changed
// element's features are replaced by what `toFeatures` makes of its new
// state (none, if it no longer qualifies), and deleted elements' features go.
export function applyFeatureChanges(features, {upserts, deletes}, toFeatures, {keyOf = feature => `way/${feature.id}`} = {}) {
  const byKey = new Map();
  for (const feature of features) {
    const key = keyOf(feature);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(feature);
  }
  for (const key of deletes) byKey.delete(key);
  for (const element of upserts) byKey.delete(`${element.type}/${element.id}`);
  const added = toFeatures(upserts);
  for (const feature of added) {
    const key = keyOf(feature);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(feature);
  }
  return [...byKey.values()].flat();
}

// A published snapshot (`features`, as of the database time `since`) brought
// up to date with one change request, or null when it cannot be: no
// snapshot, one made by another extraction (`previousVersion` is not
// `version`, see extractionVersion), no database time, a failed or unreadable request, or a result
// that would lose more than `maxDrop` of the features. The caller then
// downloads in full. The snapshot's age is no reason: the changes since its
// time make it exact however old it is.
// `failed` receives the error of a change request that was made and failed,
// so the caller can honour a delay the server asked for before its fallback.
export async function updateFromChanges({features, since, query, toFeatures, fetchText, version, previousVersion, maxDrop = 0.05, warn = console.warn, failed = () => {}}) {
  if (!Array.isArray(features) || !features.length) return null;
  // Made by another query or other conversion code: download in full.
  if (version !== previousVersion) { warn('The published snapshot was made by another extraction: downloading in full'); return null; }
  if (!TIME.test(since || '')) { warn('No database time for the published snapshot: downloading in full'); return null; }
  try {
    const changes = parseAdiff(await fetchText(adiffQuery(query, since)));
    const next = applyFeatureChanges(features, changes, toFeatures).sort((a, b) => a.id - b.id);
    if (next.length < features.length * (1 - maxDrop)) throw new Error(`The changes would drop the features from ${features.length} to ${next.length}`);
    return {features: next, osmBase: changes.timestamp, since, upserts: changes.upserts.length, deletes: changes.deletes.length};
  } catch (error) {
    warn('Changes unavailable, downloading in full:', error.message);
    failed(error);
    return null;
  }
}

// Stored Overpass elements (one region's response) brought up to date by
// element: deleted ones go, changed and new ones take their new state.
export function applyElementChanges(elements, {upserts, deletes}) {
  const byKey = new Map(elements.map(element => [`${element.type}/${element.id}`, element]));
  for (const key of deletes) byKey.delete(key);
  for (const element of upserts) byKey.set(`${element.type}/${element.id}`, element);
  return [...byKey.values()];
}

// A query with `out geom` gives every way and relation its geometry; a
// change whose way, or a relation's way member, came without it cannot be
// drawn as mapped and throws rather than silently becoming a point.
export function requireGeometry(upserts) {
  for (const element of upserts) {
    if (element.type === 'way' && !(element.geometry?.length >= 2)) throw new Error(`Change way ${element.id} without geometry`);
    if (element.type === 'relation' && (element.members || []).some(m => m.type === 'way' && !(m.geometry?.length >= 2)))
      throw new Error(`Change relation ${element.id} with a way member without geometry`);
  }
  return upserts;
}
