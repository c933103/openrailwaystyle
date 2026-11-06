// The one region tree every worldwide Overpass dataset is fetched by: the
// eight 90-degree quadrants of the world, each split into quarters as far as
// a dataset needs. A dataset chooses how coarse to start in each quadrant
// (worldRegions): a small dataset can take a whole quadrant per request, a
// dense one starts at 45 degrees or finer; a region the server cannot answer
// is split into its quarters (quarters), and the datasets remember those
// splits. Every region of every dataset is a node of this tree, so their
// regions align and nothing falls between them.
export const WORLD_QUADRANTS = Object.freeze(Array.from({length: 8}, (_, i) =>
  Object.freeze([i < 4 ? -90 : 0, -180 + (i % 4) * 90, i < 4 ? 0 : 90, -90 + (i % 4) * 90])));

// A region's four quarters: south-west, south-east, north-west, north-east.
export const quarters = ([s, w, n, e]) => {
  const lat = (s + n) / 2, lon = (w + e) / 2;
  return [[s, w, lat, lon], [s, lon, lat, e], [lat, w, n, lon], [lat, lon, n, e]];
};

// The regions a dataset starts from, south to north and west to east.
// `size` is the side in degrees (90, 45, 22.5, …), the same everywhere or
// chosen per quadrant by a function of its box.
export function worldRegions(size = 90) {
  const sizeOf = typeof size === 'function' ? size : () => size;
  const levels = WORLD_QUADRANTS.map(quadrant => {
    const side = sizeOf(quadrant), depth = Math.log2(90 / side);
    if (!Number.isInteger(depth) || depth < 0) throw new Error(`Invalid region size ${side}`);
    let boxes = [quadrant];
    for (let i = 0; i < depth; i++) boxes = boxes.flatMap(quarters);
    return boxes;
  }).flat();
  return levels.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// How many times a region was split below a `side`-degree start region.
export const regionDepth = ([, west, , east], side = 45) => Math.max(0, Math.round(Math.log2(side / (east - west))));

export const validRegion = box => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite)
  && box[0] >= -90 && box[2] <= 90 && box[0] < box[2] && box[1] >= -180 && box[3] <= 180 && box[1] < box[3];
const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const area = ([s, w, n, e]) => (n - s) * (e - w);
// Whether regions tile the whole world: valid, none overlapping, and their
// areas adding up to the world's.
export function tilesWorld(boxes) {
  if (!Array.isArray(boxes) || !boxes.length || !boxes.every(validRegion)) return false;
  for (let i = 0; i < boxes.length; i++) for (let j = 0; j < i; j++) if (overlaps(boxes[i], boxes[j])) return false;
  return Math.abs(boxes.reduce((sum, box) => sum + area(box), 0) - 360 * 180) < 1e-7;
}
