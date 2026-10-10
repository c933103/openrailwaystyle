// Departures at a station and journey planning, from Transitous
// (https://transitous.org): a community service that combines published
// timetables (GTFS) with live updates (GTFS-RT) where operators provide them.
// Its API is free for open-source, non-commercial projects that link to its
// sources and stay light on its resources: one stop search and at most two
// departure boards per station opened, nothing while panning.
export const TRANSITOUS_API = 'https://api.transitous.org/api/v1';
export const TRANSITOUS_PLANNER = 'https://api.transitous.org/';
export const TRANSITOUS_SOURCES = 'https://transitous.org/sources/';
// Rail and other guided modes: a railway station's board leaves out buses,
// coaches and ferries that share the stop. The service filters by mode, so
// buses do not use up the requested number of departures.
export const RAIL_MODES = new Set(['HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN', 'RAIL', 'METRO', 'SUBWAY', 'TRAM', 'FUNICULAR', 'CABLE_CAR']);
const RADIUS_M = 400;

const metres = (a, b) => {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371000;
};
const simplify = name => String(name ?? '').normalize('NFKC').toLowerCase().replace(/\b(station|bahnhof|hbf|gare|estación|stazione)\b|駅|站|역|[\s\-‐–—()（）.,'’]/g, '');

// The timetable stops that are this station: rail stops within 400 m, those
// named like the station first, then the nearest. Several timetables can
// cover one station (two operators), so up to two are kept.
export function pickStops(candidates, station, limit = 2) {
  const names = (station.names || []).map(simplify).filter(Boolean);
  const scored = candidates
    .filter(c => c.type === 'STOP' && (c.modes || []).some(m => RAIL_MODES.has(m)) && Number.isFinite(c.lat) && Number.isFinite(c.lon))
    .map(c => {
      const own = simplify(c.name), named = own && names.some(n => own.includes(n) || n.includes(own));
      return {stop: c, distance: metres(station, c), named};
    })
    .filter(c => c.distance <= RADIUS_M)
    .sort((a, b) => (b.named - a.named) || a.distance - b.distance);
  const picked = scored.some(c => c.named) ? scored.filter(c => c.named) : scored;
  return picked.slice(0, limit).map(c => c.stop);
}

// A route "name" that only repeats the numeric end of its route ID (some
// feeds give every trip pattern its own numbered route) is not a line name.
const opaqueName = (name, routeId) => /^\d{5,}$/.test(name || '') && String(routeId || '').endsWith(name);
// Rows of different families (main-line rail, metro, tram, funicular, cable
// car) are never one train. A feed that classifies a train differently from
// another leaves two rows rather than hiding a departure.
const MODE_FAMILY = {METRO: 'metro', SUBWAY: 'metro', TRAM: 'tram', FUNICULAR: 'funicular', CABLE_CAR: 'cable'};
const modeFamily = mode => MODE_FAMILY[mode] || 'rail';
const squash = text => String(text || '').replace(/[\s()（）]/g, '');
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Stable presentation ties must not depend on either feed or observation order.
const rowOrder = row => JSON.stringify([row.line, row.headsign, row.mode, row.tz ?? null,
  row.color, row.textColor, row.track, row.departure, row.scheduled, row.live, row.delay, row.cancelled]);
const compareRows = (a, b) => Number(!a.line) - Number(!b.line) || a.headsign.length - b.headsign.length || compareText(rowOrder(a), rowOrder(b));
const mergeObservations = group => {
  const ordered = [...group].sort(compareRows), keep = ordered[0];
  // There is no observation timestamp. Prefer live over scheduled data; if
  // live predictions conflict, keep the later prediction deterministically,
  // without claiming it is the newest update. Cancellation is never dropped.
  const live = ordered.filter(r => r.live).sort((a, b) => b.departure - a.departure || Number(!a.track) - Number(!b.track) || compareRows(a, b))[0];
  // A time-only update must not hide an explicit live platform. Carry the
  // platform's own prediction through both merge stages: borrowed scheduled
  // platforms are not live updates, and later time-only predictions must not
  // make an older platform observation appear newer. Ties are deterministic.
  const liveTrack = group.map(r => r.liveTrack).filter(Boolean)
    .sort((a, b) => b.departure - a.departure || compareText(a.track, b.track))[0] || null;
  const merged = {...keep, cancelled: group.some(r => r.cancelled), liveTrack,
    track: liveTrack?.track || live?.track || keep.track || ordered.find(r => r.track)?.track || ''};
  if (live) Object.assign(merged, {departure: live.departure, live: true, delay: live.delay});
  return merged;
};
// Board rows from departure lists (one list per stop; merged, earliest first,
// rail modes only, one row per train). Within one list only an exact repeat is
// the same train: trip/route identity, names, mode family, resolved destination
// and scheduled time must all agree. Live/cancelled observations of that exact
// train are combined, not discarded. Two services of one feed can leave together. Across lists,
// two feeds can describe one train with different names and destination texts
// ("桜木町" and "(普通 Local) 桜木町 Sakuragichō"). Rows from different lists
// are compatible when they are of the same mode family, leave in the same
// scheduled minute, their
// destinations are non-empty and contain one another, and at least one has no
// line name or both have the same one. A compatible pair is merged only when
// each is the other's only compatible row in that list, and a merged group
// never holds two rows of one list; anything ambiguous stays separate, so the
// result does not depend on the order of the lists or rows. A merged train has
// the named row's line and colours, real-time state from a live row, and is
// cancelled if any row is. A row is live when the operator's real-time feed
// covers that trip; delay in whole minutes.
export function departureRows(lists, {now = Date.now(), count = 10} = {}) {
  const rows = [], exact = new Map();
  for (const [list, times] of lists.entries()) for (const time of times) {
    if (!RAIL_MODES.has(time.mode)) continue;
    const place = time.place || {}, departure = Date.parse(place.departure ?? place.arrival), scheduled = Date.parse(place.scheduledDeparture ?? place.scheduledArrival ?? place.departure);
    if (!Number.isFinite(departure)) continue;
    const named = [time.displayName, time.routeShortName].find(name => name && !opaqueName(name, time.routeId));
    const line = named || time.tripShortName || time.routeLongName || '';
    const headsign = time.headsign || time.tripTo?.name || '';
    // JSON tuples preserve field boundaries even when IDs/names contain '|'.
    // Missing IDs are equal only to missing IDs, never a wildcard. If the
    // schedule is invalid, differing actual times must remain distinguishable.
    const key = JSON.stringify([list, time.tripId ?? null, time.routeId ?? null,
      time.displayName || '', time.routeShortName || '', time.tripShortName || '', time.routeLongName || '',
      modeFamily(time.mode), headsign, Number.isFinite(scheduled) ? scheduled :
        [place.scheduledDeparture ?? null, place.scheduledArrival ?? null, departure]]);
    const row = {
      departure, scheduled, tz: place.tz, line, headsign,
      color: /^[0-9a-f]{6}$/i.test(time.routeColor || '') ? `#${time.routeColor}` : null,
      textColor: /^[0-9a-f]{6}$/i.test(time.routeTextColor || '') ? `#${time.routeTextColor}` : null,
      track: place.track || place.scheduledTrack || '', live: time.realTime === true,
      liveTrack: time.realTime === true && place.track ? {track: place.track, departure} : null,
      delay: time.realTime === true && Number.isFinite(scheduled) ? Math.round((departure - scheduled) / 60000) : null,
      cancelled: time.cancelled === true || time.tripCancelled === true || place.cancelled === true, mode: time.mode,
      list, to: squash(headsign), minute: Math.floor(scheduled / 60000),
    };
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(row);
  }
  for (const group of exact.values()) {
    const row = mergeObservations(group);
    // A delayed live observation can still be upcoming when its scheduled
    // duplicate is old. Merge cancellation/state before filtering that train.
    if (row.departure >= now - 60_000) rows.push(row);
  }
  const compatible = (a, b) => a.list !== b.list && modeFamily(a.mode) === modeFamily(b.mode) && a.minute === b.minute && a.to && b.to &&
    (a.to.includes(b.to) || b.to.includes(a.to)) && (!a.line || !b.line || a.line === b.line);
  const only = (a, list) => rows.filter(r => r.list === list && compatible(a, r)).length === 1;
  const parent = rows.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++)
    if (compatible(rows[i], rows[j]) && only(rows[i], rows[j].list) && only(rows[j], rows[i].list)) parent[find(j)] = find(i);
  const groups = new Map();
  rows.forEach((row, i) => { const g = find(i); groups.set(g, [...(groups.get(g) || []), row]); });
  const out = [];
  for (const group of groups.values()) {
    if (new Set(group.map(r => r.list)).size < group.length) { out.push(...group); continue; }
    out.push(mergeObservations(group));
  }
  return out.sort((a, b) => a.departure - b.departure || compareRows(a, b)).slice(0, count).map(({list, to, minute, liveTrack, ...row}) => row);
}

// Clock time at the station (its own time zone).
export function clock(ms, tz) {
  try { return new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit', timeZone: tz || undefined}).format(ms); }
  catch { return new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit'}).format(ms); }
}

// A journey from or to this place in the Transitous planner.
export function plannerLink(direction, place, name) {
  const url = new URL(TRANSITOUS_PLANNER);
  url.searchParams.set(`${direction}Place`, place);
  if (name) url.searchParams.set(`${direction}Name`, name);
  return url.href;
}

// Fetch the board for a station: {stops, rows} (rows empty when no
// timetable covers it).
export async function stationDepartures(station, {signal, fetch: get = fetch} = {}) {
  const json = async url => { const r = await get(url, {signal}); if (!r.ok) throw new Error(`Transitous returned ${r.status}`); return r.json(); };
  const candidates = await json(`${TRANSITOUS_API}/reverse-geocode?place=${station.lat},${station.lon}&type=STOP`);
  const stops = pickStops(Array.isArray(candidates) ? candidates : [], station);
  if (!stops.length) return {stops, rows: []};
  // Each stop's board on its own: one feed failing keeps the other's.
  const results = await Promise.allSettled(stops.map(s => json(`${TRANSITOUS_API}/stoptimes?stopId=${encodeURIComponent(s.id)}&n=30&mode=${[...RAIL_MODES].join(',')}`).then(d => d.stopTimes || [])));
  const lists = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (!lists.length) throw results[0].reason;
  return {stops, rows: departureRows(lists)};
}
