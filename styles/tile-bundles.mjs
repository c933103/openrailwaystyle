// Snapshot tiles packed into bundles, one per tile at the bundle zoom (all
// finer tiles under it). Tens of thousands of tiles become a few thousand
// files, which keeps the published branch, its checkout and the site deploy
// small, and gzip compresses neighbouring tiles together. A bundle is fetched
// whole, so no HTTP range request is needed (Pages applies ranges to its
// gzip-encoded responses).
//
// Files are <bundle zoom>/<x>/<y>.bundle.gz, listed by x/y in index.json.
// Container, gzip-compressed as a file: "ATB1", the header's byte length
// (uint32, little-endian), a JSON header {"tiles": [[z, x, y, offset, length],
// ...]} and the tile bytes. Identical tiles share their bytes.
export const BUNDLE_FORMAT = 'atlas-tile-bundle-1';
const MAGIC = [0x41, 0x54, 0x42, 0x31];

export const bundleKey = (z, x, y, zoom) => z < zoom ? null : `${x >> (z - zoom)}/${y >> (z - zoom)}`;

export function encodeBundle(tiles) {
  const parts = [], offsets = new Map(), header = [];
  let offset = 0;
  for (const [key, data] of tiles) {
    const [z, x, y] = key.split('/').map(Number), bytes = new Uint8Array(data);
    const content = String.fromCharCode(...bytes.subarray(0, 64)) + bytes.length;
    let shared = offsets.get(content)?.find(entry => entry.bytes.length === bytes.length && entry.bytes.every((b, i) => b === bytes[i]));
    if (!shared) {
      shared = {bytes, offset};
      offsets.set(content, [...(offsets.get(content) || []), shared]);
      parts.push(bytes);
      offset += bytes.length;
    }
    header.push([z, x, y, shared.offset, bytes.length]);
  }
  const json = new TextEncoder().encode(JSON.stringify({tiles: header}));
  const out = new Uint8Array(8 + json.length + offset), view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  view.setUint32(4, json.length, true);
  out.set(json, 8);
  let at = 8 + json.length;
  for (const bytes of parts) { out.set(bytes, at); at += bytes.length; }
  return out;
}

export function decodeBundle(data) {
  const bytes = new Uint8Array(data);
  if (bytes.length < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('Not a tile bundle');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (8 + length > bytes.length) throw new Error('Truncated tile bundle');
  const {tiles} = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
  const body = 8 + length, result = new Map();
  for (const [z, x, y, offset, size] of tiles) {
    if (body + offset + size > bytes.length) throw new Error('Truncated tile bundle');
    result.set(`${z}/${x}/${y}`, bytes.subarray(body + offset, body + offset + size));
  }
  return result;
}

const gunzip = async data => {
  const bytes = new Uint8Array(data);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return data;
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
};

// tile(z, x, y, signal) resolves with a copy of the tile's bytes (MapLibre
// detaches what it receives), or null where the snapshot has none. The index
// says which bundles exist; an index without `bundles` (the per-tile layout
// of earlier snapshots, or the empty index of a site deployed before the
// first build) is read tile by tile. Bundles are shared by all tiles under
// them, so a bundle request is not cancelled with one tile's request; the
// last `keep` bundles stay decoded. A failed index or bundle is fetched
// again by the next tile that needs it.
export function createBundleReader({root, fetcher = fetch, keep = 24, decompress = gunzip}) {
  let index;
  const bundles = new Map();
  const url = path => new URL(path, root).href;
  const readIndex = () => index ||= fetcher(url('index.json')).then(async response => {
    if (!response.ok) throw new Error(`Tile index returned ${response.status}`);
    const data = await response.json();
    return Array.isArray(data.bundles)
      ? {zoom: data.zoom, bundles: new Set(data.bundles)}
      : {tiles: new Set(Array.isArray(data.tiles) ? data.tiles : [])};
  }).catch(error => { index = undefined; throw error; });
  const readBundle = key => {
    if (bundles.has(key)) {
      const pending = bundles.get(key);
      bundles.delete(key); bundles.set(key, pending);
      return pending;
    }
    const pending = fetcher(url(`${key}.bundle.gz`)).then(async response => {
      if (!response.ok) throw new Error(`Tile bundle returned ${response.status}`);
      return decodeBundle(await decompress(await response.arrayBuffer()));
    });
    pending.catch(() => { if (bundles.get(key) === pending) bundles.delete(key); });
    bundles.set(key, pending);
    while (bundles.size > keep) bundles.delete(bundles.keys().next().value);
    return pending;
  };
  async function tile(z, x, y, signal) {
    const known = await readIndex();
    signal?.throwIfAborted();
    const key = `${z}/${x}/${y}`;
    if (known.tiles) {
      if (!known.tiles.has(key)) return null;
      const response = await fetcher(url(`${key}.pbf.gz`), {signal});
      if (!response.ok) throw new Error(`Tile returned ${response.status}`);
      return decompress(await response.arrayBuffer());
    }
    const bundle = bundleKey(z, x, y, known.zoom);
    if (!bundle || !known.bundles.has(bundle)) return null;
    const tiles = await readBundle(`${known.zoom}/${bundle}`);
    signal?.throwIfAborted();
    const bytes = tiles.get(key);
    return bytes ? bytes.slice().buffer : null;
  }
  return {tile};
}
