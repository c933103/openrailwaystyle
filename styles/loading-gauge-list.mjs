// Loading gauge by OSM way ID, for colouring the zoom 0–6 overview tiles,
// which carry way IDs but no loading gauge. Built from an Overpass CSV list
// (scripts/build-loading-gauge-list.mjs); stored as the distinct values plus,
// for each, its sorted way IDs as base-128 varint gaps, in base64.
export function encodeLoadingGauges(rows) {
  const byValue = new Map();
  for (const [id, value] of rows) {
    if (!Number.isSafeInteger(id) || id <= 0 || !value) continue;
    if (!byValue.has(value)) byValue.set(value, []);
    byValue.get(value).push(id);
  }
  const values = [...byValue.keys()].sort(), bytes = [];
  for (const value of values) {
    let previous = 0;
    for (const id of [...new Set(byValue.get(value))].sort((a, b) => a - b)) {
      let gap = id - previous; previous = id;
      while (gap >= 128) { bytes.push(gap % 128 + 128); gap = Math.floor(gap / 128); }
      bytes.push(gap);
    }
    bytes.push(0); // gaps are never 0: ends this value's list
  }
  return {values, ids: Buffer.from(bytes).toString('base64')};
}
export function decodeLoadingGauges({values, ids}, transform = value => value) {
  // Transform each distinct value once, rather than creating an object for
  // every way or holding a second array/Map of the complete lookup.
  const decodedValues = values.map(transform);
  const bytes = typeof atob === 'function' ? Uint8Array.from(atob(ids), c => c.charCodeAt(0)) : Buffer.from(ids, 'base64');
  const lookup = new Map();
  let value = 0, id = 0, gap = 0, scale = 1;
  for (const byte of bytes) {
    gap += (byte % 128) * scale;
    if (byte >= 128) { scale *= 128; continue; }
    if (gap === 0) { value++; id = 0; } else { id += gap; lookup.set(id, decodedValues[value]); }
    gap = 0; scale = 1;
  }
  return lookup;
}
// Overview tile feature IDs are "<way id>-<part>".
export const wayId = id => Number(String(id ?? '').split('-')[0]) || 0;
// Overpass CSV rows: tab-separated; values containing commas are quoted.
export const parseCsv = text => text.split('\n').filter(Boolean).map(line => {
  const [id, value = ''] = line.split('\t');
  return [Number(id), value.replace(/^"(.*)"$/, '$1').replace(/""/g, '"').trim()];
});
