// The crossing table and how Overpass rows become it: with the query, what
// makes the stored table of OSM data (crossingExtraction in crossing-data.mjs).
// Kept apart from the tiles, the tag labels and the regions, so that changing
// those rebuilds the tiles from the stored table instead of downloading every
// crossing again. No imports: the version reads this file alone.
export const KINDS = {level_crossing: 'road', crossing: 'foot'};
export const inBox = ([s, w, n, e], lat, lon) => lat >= s && lat < n && lon >= w && lon < e;

// Overpass CSV rows: id, lat, lon, railway, then the tag columns (`keys`), no
// header: the major crossings, the "minor" marker row, the minor crossings, then the end
// marker row. Overpass does not escape values, and OSM tag values may hold
// tabs and line breaks, so columns are separated by the unit separator
// (U+001F), which editors treat as invalid in tags: a line that does not
// start a row continues the previous value, line break included. A row with
// extra columns (a separator inside a value) keeps its position and kind,
// with its tags marked unreadable (null) rather than shifted.
export const SEP = '\u001f';
const ROW_START = new RegExp(`^\\d+${SEP}[-\\d.]+${SEP}[-\\d.]+${SEP}`), MARKER = new RegExp(`^\\d*${SEP}${SEP}${SEP}(minor|end)(${SEP}|$)`);
export function parseRows(text, keys) {
  if (/^\s*</.test(text)) throw new Error(`Overpass returned an error page: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
  const lines = [];
  for (const line of text.split('\n')) {
    // Starting a row consumes its preceding record delimiter. Only continuation
    // lines restore an LF, including trailing LFs in the final tag value.
    if (ROW_START.test(line) || MARKER.test(line)) lines.push(line);
    else if (lines.length && !MARKER.test(lines.at(-1))) lines[lines.length - 1] += `\n${line}`;
    else if (line.trim()) throw new Error(`Unexpected Overpass row: ${line.slice(0, 120)}`);
  }
  if (lines.pop()?.split(SEP)[3]?.trim() !== 'end') throw new Error('Incomplete Overpass response (no end marker)');
  const rows = [];
  let minor = false;
  for (const line of lines) {
    const [id, lat, lon, railway, ...values] = line.split(SEP);
    if (railway?.trim() === 'minor' && !minor) { minor = true; continue; }
    const kind = KINDS[railway?.trim()], position = [Number(id), Number(lat), Number(lon)];
    if (!kind || !position.every(Number.isFinite)) throw new Error(`Unexpected Overpass row: ${line.slice(0, 120)}`);
    let tags = null;
    if (values.length <= keys.length) {
      tags = {};
      keys.forEach((key, i) => { const value = values[i]; if (value) tags[key] = value; });
    }
    rows.push({id: position[0], lat: position[1], lon: position[2], kind, minor, tags});
  }
  if (!minor) throw new Error('Incomplete Overpass response (no minor marker)');
  return rows;
}

// The table: id → [lat, lon, kind, minor, tags (null: unreadable)]. A full
// region response replaces every crossing inside the region (so deleted and retagged nodes go); a change
// response only adds or moves crossings.
export function replaceRegion(table, box, rows) {
  for (const [id, [lat, lon]] of table) if (inBox(box, lat, lon)) table.delete(id);
  for (const row of rows) if (inBox(box, row.lat, row.lon)) table.set(row.id, [row.lat, row.lon, row.kind, row.minor, row.tags === undefined ? {} : row.tags]);
}

export function applyChanges(table, rows) {
  for (const row of rows) table.set(row.id, [row.lat, row.lon, row.kind, row.minor, row.tags === undefined ? {} : row.tags]);
}
export function writeTable(table) {
  const lines = [];
  // Tags as JSON, which escapes tabs and line breaks.
  for (const [id, [lat, lon, kind, minor, tags = {}]] of [...table].sort((a, b) => a[0] - b[0]))
    lines.push(`${id}\t${lat}\t${lon}\t${kind}\t${minor ? 'minor' : ''}${tags === null || Object.keys(tags).length ? `\t${JSON.stringify(tags)}` : ''}`);
  return lines.join('\n') + '\n';
}
export function readTable(text) {
  const table = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const [id, lat, lon, kind, minor, tags] = line.split('\t');
    table.set(Number(id), [Number(lat), Number(lon), kind, minor === 'minor', tags ? JSON.parse(tags) : {}]);
  }
  return table;
}
