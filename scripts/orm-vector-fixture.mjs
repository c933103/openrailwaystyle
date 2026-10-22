import vtpbf from 'vt-pbf';

// Browser fixtures must support the provider's direct XYZ contract as well as
// their historical TileJSON-advertised local URLs. Metadata/API paths return
// null so each check retains its own fallback/API fixture behavior.
export function ormVectorFixture(path, indexes, onTile = () => {}) {
  const match = /^\/([^/]+)\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?$/.exec(path);
  if (!match) return null;
  const [, group, z, x, y] = match, layers = {};
  for (const layer of group.split(',')) {
    onTile({layer, z:Number(z), x:Number(x), y:Number(y)});
    const tile = indexes[layer]?.getTile(Number(z), Number(x), Number(y));
    if (tile?.features.length) layers[layer] = tile;
  }
  // Model Martin's composite response: each available source layer gets its
  // own MVT layer, and a wholly empty tile is exactly zero bytes.
  return {contentType:'application/x-protobuf',
    body:Object.keys(layers).length ? Buffer.from(vtpbf.fromGeojsonVt(layers, {version:2})) : Buffer.alloc(0)};
}
