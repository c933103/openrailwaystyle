// Land on a 0.1° grid, for judging what a Geofabrik region covers on land
// rather than by polygon area (#330, B1). Geofabrik's region polygons carry
// sea buffers of different widths, so their areas say little about the land
// they cover. A cell counts as land when its centre lies inside Natural Earth
// land; a region covers a cell when the cell's centre lies inside the region.
// Polygons are filled by scanline with the even-odd rule, so holes are left
// out. Coordinates must lie within -180…180, -90…90 (normalize() folds them).
export const RES = 0.1;
export const COLS = 3600, ROWS = 1800;
const EARTH_RADIUS_KM = 6371.0088;

// Calls fill(row, firstCol, endCol) for each run of cells whose centres lie
// inside the polygon (an array of rings).
function scan(polygon, fill) {
  const crossings = new Map();
  for (const ring of polygon) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      if (y1 === y2) continue;
      const low = Math.min(y1, y2), high = Math.max(y1, y2);
      // Rows whose centre y satisfies low <= y < high.
      const first = Math.max(0, Math.ceil((low + 90) / RES - 0.5)), last = Math.min(ROWS - 1, Math.ceil((high + 90) / RES - 0.5) - 1);
      for (let row = first; row <= last; row++) {
        const y = -90 + (row + 0.5) * RES;
        const x = x1 + (y - y1) * (x2 - x1) / (y2 - y1);
        let list = crossings.get(row);
        if (!list) crossings.set(row, list = []);
        list.push(x);
      }
    }
  }
  for (const [row, xs] of crossings) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const start = Math.max(0, Math.ceil((xs[k] + 180) / RES - 0.5)), end = Math.min(COLS, Math.ceil((xs[k + 1] + 180) / RES - 0.5));
      if (end > start) fill(row, start, end);
    }
  }
}

const polygonsOf = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];

// A bitmap of land cells from GeoJSON features (Polygon or MultiPolygon).
export function landRaster(features) {
  const land = new Uint8Array(COLS * ROWS);
  for (const feature of features) for (const polygon of polygonsOf(feature?.geometry)) {
    scan(polygon, (row, start, end) => land.fill(1, row * COLS + start, row * COLS + end));
  }
  return land;
}

// The land cells inside a multipolygon, as sorted cell indices.
export function landCells(multi, land) {
  const cells = new Set();
  for (const polygon of multi) scan(polygon, (row, start, end) => {
    for (let i = row * COLS + start, stop = row * COLS + end; i < stop; i++) if (land[i]) cells.add(i);
  });
  return Int32Array.from(cells).sort();
}

const rowKm2 = Float64Array.from({length: ROWS}, (_, row) => {
  const rad = degrees => degrees * Math.PI / 180;
  return EARTH_RADIUS_KM ** 2 * rad(RES) * (Math.sin(rad(-90 + (row + 1) * RES)) - Math.sin(rad(-90 + row * RES)));
});
export const cellKm2 = cell => rowKm2[Math.floor(cell / COLS)];
export const cellsKm2 = cells => { let total = 0; for (const cell of cells) total += cellKm2(cell); return total; };
// The south-west corner of a cell, in degrees.
export const cellCorner = cell => [-180 + (cell % COLS) * RES, -90 + Math.floor(cell / COLS) * RES];
