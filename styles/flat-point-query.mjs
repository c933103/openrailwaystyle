import {compileFlatGeometryStyle} from './flat-style.mjs';

// Return the actual application features from the same current GeoJSON
// sources, including small-opacity pointer targets. Paint opacity is not
// clickability. Layer order mirrors the visible style from top to bottom.
// The consumer still owns semantic checks such as measurement generation.
export function compileFlatPointQuery(layers) {
  const order = layers.filter(layer => layer.type === 'circle' && layer['source-layer'] == null)
    .map(compileFlatGeometryStyle).reverse();
  return (camera, point, sources, {layers: layerIds, featureState = () => undefined} = {}) => {
    const [x,y] = point;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > camera.width || y < 0 || y > camera.height) return [];
    const [worldX,worldY] = camera.tileTransform({z:0,x:0,y:0});
    const square = worldX*worldX+worldY*worldY;
    if (!Number.isFinite(square) || square <= 0) return [];
    const hits = [];
    for (const layer of order) {
      if (!layer.visibleAt(camera.zoom) || layer.needGeometry ||
          (layerIds && !layerIds.includes(layer.id))) continue;
      const source = sources.get(layer.source);
      const features = source?.type === 'FeatureCollection' ? source.features : source?.type === 'Feature' ? [source] : [];
      for (let i=features.length-1;i>=0;i--) {
        const feature = features[i];
        const geometry = feature.geometry;
        const points = geometry?.type === 'Point' ? [geometry.coordinates]
          : geometry?.type === 'MultiPoint' ? geometry.coordinates : [];
        if (!points.length) continue;
        const paint = layer.resolve({zoom:camera.zoom},{type:1,id:feature.id,properties:feature.properties??{}},
          featureState(layer.source,feature.id)??{});
        if (!paint) continue;
        const radius = paint.radius + Math.max(0,paint.strokeWidth ?? 0);
        if (!Number.isFinite(radius) || radius <= 0) continue;
        const hit = points.some(coordinate => {
          if (!Array.isArray(coordinate) || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) return false;
          const [left,top] = camera.project(coordinate,{nearestWorld:false});
          // Select the world copy nearest this click (not the viewport's
          // centre); a wide or rotated map can expose several copies.
          const n = Math.round(((x-left)*worldX+(y-top)*worldY)/square);
          return Math.hypot(x-(left+n*worldX),y-(top+n*worldY)) <= radius;
        });
        if (hit) hits.push({type:'Feature',id:feature.id,properties:feature.properties??{},
          geometry,layer:{id:layer.id,type:'circle',source:layer.source},source:layer.source});
      }
    }
    return hits;
  };
}
