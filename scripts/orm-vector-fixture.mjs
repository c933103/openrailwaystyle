import vtpbf from 'vt-pbf';

// Browser fixtures must support the provider's direct XYZ contract as well as
// their historical TileJSON-advertised local URLs. Metadata/API paths return
// null so each check retains its own fallback/API fixture behavior.
export function ormVectorFixture(path, indexes, onTile = () => {}) {
  const match = /^\/([^/]+)\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?$/.exec(path);
  if (!match) return null;
  const [, layer, z, x, y] = match;
  onTile({layer, z:Number(z), x:Number(x), y:Number(y)});
  const tile = indexes[layer]?.getTile(Number(z), Number(x), Number(y));
  // An encoded empty layer has nonempty bytes but no decoded source layer.
  // The real provider contract uses an empty successful body for empty tiles.
  return {contentType:'application/x-protobuf',
    body:tile?.features.length ? Buffer.from(vtpbf.fromGeojsonVt({[layer]:tile}, {version:2})) : Buffer.alloc(0)};
}
