// Help panel "Data dates": how old each deployed dataset is (#330, B7). The
// site keeps working on old data when its sources are unavailable, so it says
// how old that data is. data/data-ages.json is written by
// scripts/data-ages.mjs when the site is built; the age is counted here, when
// the page is viewed, because a site that cannot be rebuilt keeps getting older.
const DAY_MS = 86400000;

export function dataAgeRows(ages, now = new Date()) {
  if (ages?.schema !== 1 || !Array.isArray(ages.datasets) || !Number.isFinite(ages.staleAfterDays)) throw new Error('Unknown data dates file');
  return ages.datasets.map(({label, date}) => {
    const time = typeof date === 'string' ? Date.parse(date) : NaN;
    if (!Number.isFinite(time)) return {label: String(label), date: null, days: null, stale: false, text: 'not published yet'};
    const days = Math.max(0, Math.floor((now - time) / DAY_MS));
    return {label: String(label), date: new Date(time).toISOString().slice(0, 10), days, stale: days > ages.staleAfterDays,
      text: `${new Date(time).toISOString().slice(0, 10)} (${days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`})`};
  });
}

export function staleNotice(rows, staleAfterDays) {
  const stale = rows.filter(row => row.stale);
  if (!stale.length) return '';
  return `${stale.length === 1 ? 'One dataset is' : `${stale.length} datasets are`} more than ${staleAfterDays} days old: ${stale.map(row => row.label).join(', ')}. ` +
    'Its sources may be unavailable. The map keeps showing the last data it checked rather than none, so features may have changed since.';
}
