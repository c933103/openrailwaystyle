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
const squash = text => String(text || '').replace(/[\s()（）]/g, '');
// Board rows from departure lists (merged, earliest first, rail modes only,
// one row per train where two timetables list it). Two feeds can list one
// train with different names and destination texts ("桜木町" and
// "(普通 Local) 桜木町 Sakuragichō"): rows at the same scheduled minute
// whose destinations contain one another are the same train when at least
// one has no line name or both have the same one: the named row is kept,
// with real-time state from whichever row has it. Rows without a
// destination are never merged.
// A row is live when the operator's real-time feed covers that trip; delay in
// whole minutes.
export function departureRows(lists, {now = Date.now(), count = 10} = {}) {
  const rows = [];
  for (const [list, times] of lists.entries()) for (const time of times) {
    if (!RAIL_MODES.has(time.mode)) continue;
    const place = time.place || {}, departure = Date.parse(place.departure ?? place.arrival), scheduled = Date.parse(place.scheduledDeparture ?? place.scheduledArrival ?? place.departure);
    if (!Number.isFinite(departure) || departure < now - 60_000) continue;
    const named = [time.displayName, time.routeShortName].find(name => name && !opaqueName(name, time.routeId));
    const line = named || time.tripShortName || time.routeLongName || '';
    const row = {
      departure, scheduled, tz: place.tz, line, headsign: time.headsign || time.tripTo?.name || '',
      color: /^[0-9a-f]{6}$/i.test(time.routeColor || '') ? `#${time.routeColor}` : null,
      textColor: /^[0-9a-f]{6}$/i.test(time.routeTextColor || '') ? `#${time.routeTextColor}` : null,
      track: place.track || place.scheduledTrack || '', live: time.realTime === true,
      delay: time.realTime === true && Number.isFinite(scheduled) ? Math.round((departure - scheduled) / 60000) : null,
      cancelled: time.cancelled === true || time.tripCancelled === true || place.cancelled === true, mode: time.mode,
      list, key: `${time.displayName || time.routeShortName || line}|${time.headsign}|${scheduled}`,
    };
    const minute = Math.floor(scheduled / 60000), to = squash(row.headsign);
    // Within one list only an exact repeat is the same train; two services
    // of one feed can leave together. Across lists the texts may differ.
    const same = rows.findIndex(other => {
      if (other.list === list) return other.key === row.key;
      const theirs = squash(other.headsign);
      return to && theirs && Math.floor(other.scheduled / 60000) === minute && (theirs.includes(to) || to.includes(theirs)) &&
        (!other.line || !row.line || other.line === row.line);
    });
    if (same < 0) { rows.push(row); continue; }
    // One train: the line name and colours of the named row, and real-time
    // state (live time, delay, cancellation, platform) from whichever row has it.
    const held = rows[same], keep = !held.line && row.line ? row : held, other = keep === row ? held : row;
        const merged = {...keep};
    if (other.live && !keep.live) Object.assign(merged, {departure: other.departure, live: true, delay: other.delay, track: other.track || keep.track});
    else if (!merged.track) merged.track = other.track;
    merged.cancelled = keep.cancelled || other.cancelled;
    rows[same] = merged;
  }
  return rows.sort((a, b) => a.departure - b.departure).slice(0, count).map(({list, key, ...row}) => row);
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
