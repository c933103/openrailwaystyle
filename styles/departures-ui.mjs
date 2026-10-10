import {clock, trainSchedule} from './departures.mjs?v=20261010-matched-frequency-1';

const node = (document, tag, text = '', className = '') => {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
};

// Share in-flight requests and keep only a small, short-lived cache. Failed
// requests are evicted so the Retry action can reach a recovered provider.
export function scheduleLoader({load = trainSchedule, now = Date.now} = {}) {
  const cache = new Map();
  return tripId => {
    const found = cache.get(tripId);
    if (found && now() - found.at < 60_000) return found.promise;
    const entry = {at: now()};
    entry.promise = Promise.resolve().then(() => load(tripId, {signal: AbortSignal.timeout(15000)}));
    cache.delete(tripId);
    cache.set(tripId, entry);
    while (cache.size > 64) cache.delete(cache.keys().next().value);
    entry.promise.catch(() => { if (cache.get(tripId) === entry) cache.delete(tripId); });
    return entry.promise;
  };
}
const loadSchedule = scheduleLoader();

function localDate(ms, tz) {
  if (!Number.isFinite(ms)) return '';
  try { return new Intl.DateTimeFormat('en-GB', {day:'2-digit', month:'short', year:'numeric', timeZone:tz}).format(ms); }
  catch { return new Intl.DateTimeFormat('en-GB', {day:'2-digit', month:'short', year:'numeric'}).format(ms); }
}

function appendTime(document, cell, actual, scheduled, stop) {
  const time = stop.cancelled ? scheduled : actual;
  const value = Number.isFinite(time) ? time : scheduled;
  cell.append(node(document, 'span', clock(value, stop.tz), stop.cancelled ? 'cancelled' : ''));
  if (Number.isFinite(value)) cell.append(node(document, 'small', localDate(value, stop.tz), 'trip-date'));
  if (stop.live && !stop.cancelled && Number.isFinite(actual) && Number.isFinite(scheduled) && actual !== scheduled) {
    cell.append(node(document, 'small', `Scheduled ${clock(scheduled, stop.tz)} · ${localDate(scheduled, stop.tz)}`, 'trip-date'));
  }
}

export function renderSchedule(container, stops, row) {
  const document = container.ownerDocument;
  container.replaceChildren(node(document, 'h4', 'Full train schedule'));
  container.append(node(document, 'p', 'Times are local to each stop. Arrival and departure include dwell time.', 'small'));
  const table = document.createElement('table'); table.className = 'trip-stops';
  const caption = node(document, 'caption', `${row.line || 'Train'} → ${row.headsign}`); table.append(caption);
  const head = document.createElement('thead'), headings = document.createElement('tr');
  for (const label of ['Stop', 'Arr.', 'Dep.']) {
    const th = node(document, 'th', label); th.scope = 'col'; headings.append(th);
  }
  head.append(headings); table.append(head);
  const body = document.createElement('tbody');
  for (const stop of stops) {
    const tr = document.createElement('tr');
    if (row.stopId && stop.stopId === row.stopId && stop[row.tripEvent==='arrival'?'scheduledArrival':'scheduledDeparture'] === (row.tripScheduled??row.scheduled)) tr.className = 'trip-current-stop';
    const name = node(document, 'th', stop.name); name.scope = 'row';
    if (stop.track) name.append(node(document, 'small', `Platform ${stop.track}`, 'trip-date'));
    if (stop.cancelled) name.append(node(document, 'small', 'Cancelled / stop skipped', 'trip-date'));
    else {
      if (stop.pickupType === 'NOT_ALLOWED') name.append(node(document, 'small', 'No boarding', 'trip-date'));
      if (stop.dropoffType === 'NOT_ALLOWED') name.append(node(document, 'small', 'No alighting', 'trip-date'));
    }
    tr.append(name);
    for (const field of ['arrival', 'departure']) {
      const cell = document.createElement('td');
      appendTime(document, cell, stop[field], stop[field === 'arrival' ? 'scheduledArrival' : 'scheduledDeparture'], stop);
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(body); container.append(table);
}

export function departureItem(document, row, {load = loadSchedule} = {}) {
  const item = document.createElement('li');
  const details = document.createElement('details'); details.className = 'departure-trip';
  const summary = document.createElement('summary'); summary.className = 'departure-summary';
  const time = node(document, 'span', clock(row.cancelled ? row.scheduled : row.departure, row.tz), 'departure-time');
  if (row.cancelled) time.classList.add('cancelled');
  const line = node(document, 'span', row.line || row.mode.toLowerCase().replace(/_/g, ' '), 'departure-line');
  if (row.color) { line.style.background = row.color; line.style.color = row.textColor || '#fff'; }
  summary.append(time, line, node(document, 'span', row.headsign, 'departure-headsign'));
  if (row.track) summary.append(node(document, 'span', /^\w{1,4}$/.test(row.track) ? `Pl. ${row.track}` : row.track, 'departure-track'));
  const status = row.cancelled ? 'Cancelled' : row.live ? (row.delay > 0 ? `+${row.delay} min` : row.delay < 0 ? `${row.delay} min` : 'On time') : '';
  if (status) summary.append(node(document, 'span', status, `departure-status${row.cancelled || row.delay > 0 ? ' late' : ''}`));
  const expand = node(document, 'span', '⌄', 'departure-expand');
  expand.setAttribute('aria-hidden', 'true'); summary.append(expand);
  summary.title = 'Open full train schedule';
  // A mouse drag is text selection, including when an old selection existed
  // before the press. Do not toggle or request a trip on its release.
  let press;
  summary.addEventListener('pointerdown', event => { press = {x:event.clientX, y:event.clientY}; });
  summary.addEventListener('click', event => {
    if (event.detail && press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3) event.preventDefault();
    press = undefined;
  });
  const content = document.createElement('div'); content.className = 'trip-schedule';
  content.setAttribute('aria-live', 'polite');
  let loading = false, loaded = false;
  async function open() {
    if (loaded || loading || !details.open) return;
    if (!row.tripId) {
      content.replaceChildren(node(document, 'p', 'The source did not supply a trip ID, so its full schedule cannot be requested.', 'small'));
      loaded = true; return;
    }
    loading = true; content.setAttribute('aria-busy', 'true');
    content.replaceChildren(node(document, 'p', 'Loading full train schedule…', 'small'));
    try {
      const stops = await load(row.tripId);
      renderSchedule(content, stops, row); loaded = true;
    } catch {
      const retry = node(document, 'button', 'Retry'); retry.type = 'button';
      retry.addEventListener('click', open);
      content.replaceChildren(node(document, 'p', 'The full schedule could not load.', 'small'), retry);
    } finally { loading = false; content.removeAttribute('aria-busy'); }
  }
  details.addEventListener('toggle', open);
  details.append(summary, content); item.append(details);
  return item;
}
