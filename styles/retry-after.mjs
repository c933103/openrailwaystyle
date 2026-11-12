// Parse provider Retry-After without normalizing malformed calendar dates.
export function retryAfterMs(value, now = Date.now()) {
  const header = String(value ?? '').trim();
  if (/^\d+$/.test(header)) return Number(header) * 1000;
  const shortDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const longDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let match = /^([A-Za-z]{3}), (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(header);
  let days = shortDays, obsolete = false;
  if (!match) {
    match = /^([A-Za-z]+), (\d{2})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(header);
    if (match) { days = longDays; obsolete = true; }
  }
  if (!match) {
    const old = /^([A-Za-z]{3}) ([A-Za-z]{3}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(header);
    if (old) match = [old[0], old[1], old[3], old[2], old[7], old[4], old[5], old[6]];
  }
  if (!match) return 0;
  const [, weekday, dayText, monthText, yearText, hourText, minuteText, secondText] = match;
  const month = months.indexOf(monthText.toLowerCase()), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  let year = Number(yearText);
  if (obsolete) year += Math.floor((new Date(now).getUTCFullYear() + 50) / 100) * 100;
  const date = new Date(0);
  date.setUTCFullYear(year, month, day); date.setUTCHours(hour, minute, second, 0);
  if (obsolete) {
    const futureLimit = new Date(now); futureLimit.setUTCFullYear(futureLimit.getUTCFullYear() + 50);
    if (date > futureLimit) { year -= 100; date.setUTCFullYear(year, month, day); }
  }
  // Date constructors normalize invalid dates too. Reject every changed field
  // and unknown or inconsistent weekday before treating a header as a deadline.
  if (month < 0 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second
    || days.indexOf(weekday.toLowerCase()) !== date.getUTCDay()) return 0;
  return Math.max(0, date.getTime() - now);
}
