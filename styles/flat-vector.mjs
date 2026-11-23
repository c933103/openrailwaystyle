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

// Screen y increases downward, so rotating the forward unit tangent by
// +90 degrees reaches the line's right side. Average adjacent segment
// normals for a shared join and bound extreme miters at reversals.
export function offsetFlatPath(points, offset, closed = false, miterLimit = 2) {
  if (!offset || points.length < 2) return points;
  const unique = points.filter(([x,y],i) => !i || points[i-1][0] !== x || points[i-1][1] !== y);
  const first = unique[0], last = unique.at(-1);
  if (closed && unique.length > 1 && first[0] === last[0] && first[1] === last[1]) unique.pop();
  if (unique.length < 2) return unique;
  const normal = ([x1,y1],[x2,y2]) => {
    const dx=x2-x1, dy=y2-y1, length=Math.hypot(dx,dy);
    return [-dy/length,dx/length];
  };
  return unique.map(([x,y],i) => {
    const prev=closed ? unique[(i+unique.length-1)%unique.length] : unique[i-1];
    const next=closed ? unique[(i+1)%unique.length] : unique[i+1];
    const a=prev ? normal(prev,[x,y]) : normal([x,y],next);
    const b=next ? normal([x,y],next) : a;
    const nx=a[0]+b[0], ny=a[1]+b[1], length=Math.hypot(nx,ny);
    if (length < 1e-8) return [x+b[0]*offset,y+b[1]*offset];
    const miter=offset*Math.min(miterLimit,2/length);
    return [x+nx/length*miter,y+ny/length*miter];
  });
}

// Paint values here are resolved CSS-pixel values. Evaluating the style,
// ordering tiles/layers, labels and interactive queries belong to the caller.
export function drawFlatVectorLayer(context, camera, tile, features, {
  type, color, opacity = 1, width = 1, radius = 3, lineCap = 'butt',
  lineJoin = 'miter', dashPixels = [], offset = 0, gapWidth = 0,
  strokeColor, strokeWidth = 0, strokeOpacity = 1,
} = {}) {
  if (opacity === 0 && !(type === 'circle' && strokeWidth > 0 && strokeOpacity > 0)) return 0;
  const [a, b, c, d, tx, ty] = camera.tileTransform(tile);
  const px = (x, y) => [a * x + c * y + tx, b * x + d * y + ty];
  const expected = {circle: 1, line: 2, fill: 3}[type];
  if (!Number.isInteger(expected)) throw new Error('Unsupported flat vector layer type');
  if (type === 'line' && width <= 0 || type === 'circle' && radius <= 0) return 0;
  let drawn = 0;
  context.save();
  try {
    const alpha = context.globalAlpha;
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
      const points=paths.filter(path=>path.length).map(path=>path.map(p=>px(p.x/extent,p.y/extent)));
      if (!points.length) continue;
      if (type === 'circle') {
        const arcs = r => {
          context.beginPath();
          for (const path of points) for (const [x,y] of path) {
            context.moveTo(x+r,y);context.arc(x,y,r,0,2*Math.PI);
          }
        };
        if (opacity > 0) {
          context.globalAlpha=alpha*opacity;
          arcs(radius);
          context.fill();
        }
        if (strokeWidth > 0 && strokeOpacity > 0) {
          context.globalAlpha=alpha*strokeOpacity;
          context.strokeStyle=strokeColor;
          context.lineWidth=strokeWidth;
          arcs(radius+strokeWidth/2);
          context.stroke();
        }
      } else {
        context.globalAlpha=alpha*opacity;
        const trace = distance => {
          const closed=feature.type===3;
          for (const path of points) {
            const shifted=offsetFlatPath(path,distance,closed);
            context.moveTo(...shifted[0]);
            for (let i=1;i<shifted.length;i++) context.lineTo(...shifted[i]);
            if (closed) context.closePath();
          }
        };
        context.beginPath();
        if (type === 'fill') {
          trace(0);context.fill('evenodd');
        } else {
          if (gapWidth > 0) {
            const side=(gapWidth+width)/2;
            trace(offset-side);trace(offset+side);
          } else trace(offset);
          context.stroke();
        }
      }
      drawn++;
    }
  } finally {
    context.restore();
  }
  return drawn;
}
