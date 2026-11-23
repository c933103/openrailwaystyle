import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';

// Keep native source-layer geometry and properties. Rendering filters and
// query identity must work on the same feature rather than a second data set.
export function flatVectorTile(data) {
  const tile = data.byteLength ? new VectorTile(new Pbf(new Uint8Array(data))) : null;
  return {
    layer(name) {
      const layer = Object.hasOwn(tile?.layers ?? {}, name) ? tile.layers[name] : null;
      if (!layer) return [];
      return Array.from({length: layer.length}, (_, index) => {
        const feature = layer.feature(index);
        return {id: feature.id, type: feature.type, properties: feature.properties,
          extent: feature.extent, paths: feature.loadGeometry()};
      });
    },
  };
}

// Paint values here are resolved CSS-pixel values. Evaluating the style,
// ordering tiles/layers, labels and interactive queries belong to the caller.
export function drawFlatVectorLayer(context, camera, tile, features, {
  type, color, opacity = 1, width = 1, radius = 3, lineCap = 'butt',
  lineJoin = 'miter', dashPixels = [],
} = {}) {
  if (opacity === 0) return 0;
  const [a, b, c, d, tx, ty] = camera.tileTransform(tile);
  const px = (x, y) => [a * x + c * y + tx, b * x + d * y + ty];
  const expected = {circle: 1, line: 2, fill: 3}[type];
  if (!Number.isInteger(expected)) throw new Error('Unsupported flat vector layer type');
  if (type === 'line' && width <= 0 || type === 'circle' && radius <= 0) return 0;
  let drawn = 0;
  context.save();
  try {
    context.globalAlpha *= opacity;
    // MVT geometries may extend into a buffer past their tile. Clip the
    // rendered output to avoid painting copies from adjacent tiles twice.
    context.beginPath();
    context.moveTo(...px(0, 0));
    for (const [x, y] of [[1, 0], [1, 1], [0, 1]]) context.lineTo(...px(x, y));
    context.closePath();
    context.clip();
    if (type === 'line') {
      context.strokeStyle = color;
      context.lineWidth = width;
      context.lineCap = lineCap;
      context.lineJoin = lineJoin;
      context.setLineDash(dashPixels);
    } else context.fillStyle = color;

    for (const feature of features) {
      if (feature.type !== expected && !(type === 'line' && feature.type === 3)) continue;
      const {extent, paths} = feature;
      if (!paths.length) continue;
      context.beginPath();
      for (const path of paths) {
        if (!path.length) continue;
        if (type === 'circle') {
          for (const point of path) {
            const [x, y] = px(point.x / extent, point.y / extent);
            context.moveTo(x + radius, y);
            context.arc(x, y, radius, 0, 2 * Math.PI);
          }
        } else {
          context.moveTo(...px(path[0].x / extent, path[0].y / extent));
          for (let i = 1; i < path.length; i++) context.lineTo(...px(path[i].x / extent, path[i].y / extent));
          if (feature.type === 3) context.closePath();
        }
      }
      if (type === 'line') context.stroke();
      else if (type === 'fill') context.fill('evenodd');
      else context.fill();
      drawn++;
    }
  } finally {
    context.restore();
  }
  return drawn;
}
