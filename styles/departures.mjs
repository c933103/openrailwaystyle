// Departures at a station and journey planning, from Transitous
// (https://transitous.org): a community service that combines published
// timetables (GTFS) with live updates (GTFS-RT) where operators provide them.
// Its API is free for open-source, non-commercial projects that link to its
// sources and stay light on its resources: one stop search and at most two
// departure boards per station opened, and one trip request when a train is
// expanded; nothing while panning.
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
const stationWords = /\b(station|bahnhof|hbf|gare|estación|stazione)\b|駅|站|역/g;
const simplify = name => name.replace(stationWords, '').replace(/[\s\-‐–—()（）.,'’]/g, '');

// Match complete names, not arbitrary substrings: Terminal 1 is not Terminal
// 10, and Central is not Central Park. Keep explicitly supplied aliases and
// the complete native and Latin parts of bilingual names such as 東京 Tōkyō.
// Native scripts stay together: 中央公園 and 中央 must not become aliases.
const nativeName = '(?:(?!\\p{Script=Latin})[\\p{Letter}\\p{Mark}\\p{Decimal_Number}\\s.\'’‐–—-])+';
const latinName = '[\\p{Script=Latin}\\p{Mark}\\p{Decimal_Number}\\s.\'’‐–—-]+';
const bilingualNames = [nativeName, latinName].map((part, i, parts) =>
  new RegExp(`^(${part})[\\s(/]+(${parts[1 - i]})\\)?$`, 'u'));
const nativeLetter = /(?!\p{Script=Latin})\p{Letter}/u;
function stopName(name) {
  const text = String(name ?? '').normalize('NFKC').toLowerCase().trim()
    // A labelled platform is metadata; an unlabelled number remains part of
    // the station name. Never strip arbitrary parenthesized station suffixes.
    .replace(/[\s,(/‐–—-]+(?:platform|track|gleis|quai|binario|andén)\s+[\p{Letter}\p{Decimal_Number}]+(?:\s*[/,‐–—-]\s*[\p{Letter}\p{Decimal_Number}]+)*\)?$/u, '')
    .replace(/[\s,(]+[\p{Decimal_Number}]+番線\)?$/u, '')
    .replace(stationWords, '').trim();
  const bilingual = bilingualNames.map(pattern => text.match(pattern)).find(match => match &&
    nativeLetter.test(match[0]) && /\p{Script=Latin}/u.test(match[0]));
  const parts = bilingual ? bilingual.slice(1) : [];
  const separated = text.match(/^([^/()]+)\s*\/\s*([^/()]+)$/u) || text.match(/^([^/()]+)\s*\(([^/()]+)\)$/u);
  return {names:[text, ...parts].map(simplify).filter(Boolean), native:parts.find(part => nativeLetter.test(part))?.trim(),
    aliases:separated ? separated.slice(1).map(simplify).filter(Boolean) : []};
}
function compatibleStopNames(a, b) {
  if (a.names[0] && a.names[0] === b.names[0]) return true;
  // A shared Latin component can also be an operator: JR 東京 and JR 神田
  // are not aliases. Keep native identity when both names supply it.
  if (a.native && b.native && simplify(a.native) !== simplify(b.native)) return false;
  return a.names.some(name => b.names.includes(name));
}

// The timetable stops that are this station: rail stops within 400 m, those
// named like the station first, then the nearest. Several timetables can
// cover one station (two operators), so up to two are kept.
export function pickStops(candidates, station, limit = 2) {
  const names = (station.names || []).map(stopName);
  // Same-script slash/parenthesized aliases need independent map evidence for
  // every component; otherwise Central (North) could become Central again.
  const suppliedAliases = new Set(names.map(name => name.names[0]).filter(Boolean));
  const scored = candidates
    .filter(c => c.type === 'STOP' && (c.modes || []).some(m => RAIL_MODES.has(m)) && Number.isFinite(c.lat) && Number.isFinite(c.lon))
    .map(c => {
      const own = stopName(c.name), named = names.some(name => compatibleStopNames(own, name)) ||
        (own.aliases.length > 1 && own.aliases.every(alias => suppliedAliases.has(alias)));
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
// Bare numeric labels are not line names without a meaningful long name.
// Apply this only to presentation: removing a label must not turn previously
// distinct numeric public routes into wildcard matches across feeds.
const numericName = name => /^\p{Decimal_Number}+$/u.test(name);
const labelText = value => String(value || '').trim();
// Rows of different families (main-line rail, metro, tram, funicular, cable
// car) are never one train. A feed that classifies a train differently from
// another leaves two rows rather than hiding a departure.
const MODE_FAMILY = {METRO: 'metro', SUBWAY: 'metro', TRAM: 'tram', FUNICULAR: 'funicular', CABLE_CAR: 'cable'};
const modeFamily = mode => MODE_FAMILY[mode] || 'rail';
const squash = text => String(text || '').replace(/[\s()（）]/g, '');
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Stable presentation ties must not depend on either feed or observation order.
const rowOrder = row => JSON.stringify([row.line, row.matchingLine, row.headsign, row.mode, row.tz ?? null,
  row.color, row.textColor, row.track, row.departure, row.scheduled, row.live, row.delay, row.cancelled,
  row.tripId, row.stopId, row.tripScheduled, row.tripEvent]);
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
  // Keep the ID and its own stop together. Prefer the named observation, but
  // a feed without a trip ID must not hide another feed's usable trip link.
  const trip = ordered.find(r => r.tripId);
  if (trip) Object.assign(merged, {tripId: trip.tripId, stopId: trip.stopId,tripScheduled:trip.tripScheduled??trip.scheduled,tripEvent:trip.tripEvent||'departure'});
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
// are candidates when they are of the same mode family, leave in the same
// scheduled minute, their
// destinations are non-empty and contain one another, and at least one has no
// matching label or both have the same one. Matching retains the original
// labels even when the numeric-only presentation guard hides them; this guard
// does not establish whether an unknown number is an internal ID or public ref.
// A compatible pair is merged only when
// each is the other's only compatible row in that list, and a merged group
// never holds two rows of one list; anything ambiguous stays separate, so the
// result does not depend on the order of the lists or rows. A candidate group
// merges only if every row has the same finite scheduled instant, including
// seconds. Keep the minute-level candidates for ambiguity checks: narrowing
// those first could remove a competing train and unlock a previously unsafe
// merge. The exact-instant guard can only reject an existing candidate group.
// A merged train has
// the named row's line and colours, real-time state from a live row, and is
// cancelled if any row is. A row is live when the operator's real-time feed
// covers that trip; delay in whole minutes.
export function departureRows(lists, {now = Date.now(), count = 10} = {}) {
  const rows = [], exact = new Map();
  for (const [list, times] of lists.entries()) for (const time of times) {
    if (!RAIL_MODES.has(time.mode)) continue;
    const place = time.place || {}, departure = Date.parse(place.departure ?? place.arrival), scheduled = Date.parse(place.scheduledDeparture ?? place.scheduledArrival ?? place.departure ?? place.arrival);
    if (!Number.isFinite(departure)) continue;
    const names = [time.displayName, time.routeShortName].filter(name => name && !opaqueName(name, time.routeId));
    const matchingLine = names[0] || time.tripShortName || time.routeLongName || '';
    const longName = labelText(time.routeLongName), hasLongName = longName && !numericName(longName);
    const line = [...names, time.tripShortName, time.routeLongName].map(labelText)
      .find(name => name && (hasLongName || !numericName(name))) || '';
    const headsign = time.headsign || time.tripTo?.name || '';
    // JSON tuples preserve field boundaries even when IDs/names contain '|'.
    // Missing IDs are equal only to missing IDs, never a wildcard. If the
    // schedule is invalid, differing actual times must remain distinguishable.
    const key = JSON.stringify([list, time.tripId ?? null, time.routeId ?? null,
      time.displayName || '', time.routeShortName || '', time.tripShortName || '', time.routeLongName || '',
      modeFamily(time.mode), headsign, Number.isFinite(scheduled) ? scheduled :
        [place.scheduledDeparture ?? null, place.scheduledArrival ?? null, departure]]);
    const row = {
      departure, scheduled, tz: place.tz, line, matchingLine, headsign,
      tripId: typeof time.tripId === 'string' ? time.tripId : '',
      stopId: typeof place.stopId === 'string' ? place.stopId : '',
      ...(typeof time.tripId==='string'&&time.tripId?{tripScheduled:scheduled,tripEvent:place.scheduledDeparture!=null?'departure':place.scheduledArrival!=null?'arrival':place.departure!=null?'departure':'arrival'}:{}),
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
    (a.to.includes(b.to) || b.to.includes(a.to)) && (!a.matchingLine || !b.matchingLine || a.matchingLine === b.matchingLine);
  const only = (a, list) => rows.filter(r => r.list === list && compatible(a, r)).length === 1;
  const parent = rows.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++)
    if (compatible(rows[i], rows[j]) && only(rows[i], rows[j].list) && only(rows[j], rows[i].list)) parent[find(j)] = find(i);
  const groups = new Map();
  rows.forEach((row, i) => { const g = find(i); groups.set(g, [...(groups.get(g) || []), row]); });
  const out = [];
  for (const group of groups.values()) {
    if (new Set(group.map(r => r.list)).size < group.length ||
        !Number.isFinite(group[0].scheduled) || !group.every(row => row.scheduled === group[0].scheduled)) {
      out.push(...group); continue;
    }
    out.push(mergeObservations(group));
  }
  return out.sort((a, b) => a.departure - b.departure || compareRows(a, b)).slice(0, count).map(({list, to, minute, liveTrack, matchingLine, ...row}) => row);
}

// Clock time at the station (its own time zone).
export function clock(ms, tz) {
  if (!Number.isFinite(ms)) return '—';
  try { return new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit', timeZone: tz || undefined}).format(ms); }
  catch { return new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit'}).format(ms); }
}

// Trip endpoint returns the complete itinerary: origin, every intermediate
// stop, terminus, and any stay-seated continuation. Never infer stops from
// another train's headsign or route ID. Preserve repeated stations on loops.
export function tripStops(itinerary) {
  if (!Array.isArray(itinerary?.legs) || !itinerary.legs.length) throw new Error('Missing trip legs');
  const stops = [];
  for (const [index, leg] of itinerary.legs.entries()) {
    if (!RAIL_MODES.has(leg.mode) || !leg.from || !leg.to ||
        (index && leg.interlineWithPreviousLeg !== true)) throw new Error('Invalid train itinerary');
    const places = [leg.from, ...(leg.intermediateStops || []), leg.to];
    for (const [i, place] of places.entries()) {
      const stop = {name: String(place.name || 'Unnamed stop'), stopId: place.stopId || '', tz: place.tz,
        arrival: Date.parse(place.arrival), departure: Date.parse(place.departure),
        scheduledArrival: Date.parse(place.scheduledArrival ?? place.arrival),
        scheduledDeparture: Date.parse(place.scheduledDeparture ?? place.departure),
        track: place.track || place.scheduledTrack || '',
        cancelled: leg.cancelled === true || place.cancelled === true,
        pickupType: place.pickupType, dropoffType: place.dropoffType, live: leg.realTime === true};
      // Only join the shared boundary of a stay-seated continuation. Its
      // arrival belongs to the preceding leg and departure to this one.
      const previous = stops.at(-1);
      if (index && i === 0 && previous?.stopId && previous.stopId === stop.stopId) {
        Object.assign(previous, {departure: stop.departure, scheduledDeparture: stop.scheduledDeparture,
          pickupType: stop.pickupType, track: stop.track || previous.track,
          cancelled: previous.cancelled || stop.cancelled, live: previous.live || stop.live});
      } else stops.push(stop);
    }
  }
  return stops;
}

export async function trainSchedule(tripId, {signal, fetch: get = fetch} = {}) {
  if (typeof tripId !== 'string' || !tripId) throw new Error('Missing trip ID');
  const url = new URL(`${TRANSITOUS_API}/trip`);
  url.searchParams.set('tripId', tripId);
  url.searchParams.set('withScheduledSkippedStops', 'true');
  const response = await get(url.href, {signal});
  if (!response.ok) throw new Error(`Transitous returned ${response.status}`);
  return tripStops(await response.json());
}

// A journey from or to this place in the Transitous planner.
export function plannerLink(direction, place, name) {
  const url = new URL(TRANSITOUS_PLANNER);
  url.searchParams.set(`${direction}Place`, place);
  if (name) url.searchParams.set(`${direction}Name`, name);
  return url.href;
}

// Fetch the selected stop boards for a station. Keep only safe per-stop
// outcomes: fulfilled means that request loaded, not complete area coverage.
// Empty rows alone do not establish that all selected boards loaded.
export async function stationDepartures(station, {signal, fetch: get = fetch} = {}) {
  const json = async url => { const r = await get(url, {signal}); if (!r.ok) throw new Error(`Transitous returned ${r.status}`); return r.json(); };
  const candidates = await json(`${TRANSITOUS_API}/reverse-geocode?place=${station.lat},${station.lon}&type=STOP`);
  // Only an array is a successful lookup. A malformed response cannot establish
  // that no nearby timetable stop matched the existing rail/distance filters.
  if (!Array.isArray(candidates)) throw new Error('Invalid Transitous stop lookup response');
  const stops = pickStops(candidates, station);
  if (!stops.length) return {stops, rows: [], stopResults: []};
  // Each stop's board on its own: one feed failing keeps the other's.
  const results = await Promise.allSettled(stops.map(s => json(`${TRANSITOUS_API}/stoptimes?stopId=${encodeURIComponent(s.id)}&n=30&mode=${[...RAIL_MODES].join(',')}`).then(d => {
    // Reject malformed envelopes inside this stop's promise so another board
    // can still load. Only an explicit array establishes a successful board.
    if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.stopTimes)) throw new Error('Invalid Transitous stop times response');
    return d.stopTimes;
  })));
  const lists = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (!lists.length) throw results[0].reason;
  const stopResults = results.map((result, i) => ({stopId: stops[i].id, status: result.status}));
  return {stops, rows: departureRows(lists), stopResults};
}
