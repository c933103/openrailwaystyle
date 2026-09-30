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
// coaches and ferries that share the stop.
export const RAIL_MODES = new Set(['HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN', 'RAIL', 'METRO', 'SUBWAY', 'TRAM', 'FUNICULAR', 'CABLE_CAR', 'ODM_RAIL']);
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

// Board rows from departure lists (merged, earliest first, rail modes only,
// one row per train where two timetables list it). A row is live when the
// operator's real-time feed covers that trip; delay in whole minutes.
export function departureRows(lists, {now = Date.now(), count = 10} = {}) {
  const seen = new Set(), rows = [];
  for (const time of lists.flat()) {
    if (!RAIL_MODES.has(time.mode)) continue;
    const place = time.place || {}, departure = Date.parse(place.departure ?? place.arrival), scheduled = Date.parse(place.scheduledDeparture ?? place.scheduledArrival ?? place.departure);
    if (!Number.isFinite(departure) || departure < now - 60_000) continue;
    const line = time.displayName || time.routeShortName || time.tripShortName || time.routeLongName || '';
    const key = `${line}|${time.headsign}|${scheduled}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      departure, scheduled, tz: place.tz, line, headsign: time.headsign || time.tripTo?.name || '',
      color: /^[0-9a-f]{6}$/i.test(time.routeColor || '') ? `#${time.routeColor}` : null,
      textColor: /^[0-9a-f]{6}$/i.test(time.routeTextColor || '') ? `#${time.routeTextColor}` : null,
      track: place.track || place.scheduledTrack || '', live: time.realTime === true,
      delay: time.realTime === true && Number.isFinite(scheduled) ? Math.round((departure - scheduled) / 60000) : null,
      cancelled: time.cancelled === true || time.tripCancelled === true || place.cancelled === true, mode: time.mode,
    });
  }
  return rows.sort((a, b) => a.departure - b.departure).slice(0, count);
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
  const lists = await Promise.all(stops.map(s => json(`${TRANSITOUS_API}/stoptimes?stopId=${encodeURIComponent(s.id)}&n=30`).then(d => d.stopTimes || [])));
  return {stops, rows: departureRows(lists)};
}
