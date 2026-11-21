import vtpbf from 'vt-pbf';

// geojson-vt rounds coordinates after clipping and simplification. Distinct
// input vertices can therefore coincide, or a clipped part can contain one
// vertex. MVT v2 requires a nonempty LineTo and prohibits (0, 0) line deltas.
export function encodeLifecycleTile(tile) {
  const features=[];
  for (const feature of tile.features) {
    if (feature.type!==2) throw new Error('Expected a line in the lifecycle tile');
    const geometry=[];
    for (const path of feature.geometry) {
      const distinct=[];
      for (const point of path) {
        const previous=distinct.at(-1);
        if (!previous || point[0]!==previous[0] || point[1]!==previous[1]) distinct.push(point);
      }
      if (distinct.length>=2) geometry.push(distinct);
    }
    if (geometry.length) features.push({...feature,geometry});
  }
  return features.length ? vtpbf.fromGeojsonVt({lifecycle:{features}},{version:2,extent:4096}) : null;
}
