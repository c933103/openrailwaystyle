import {latest, normalizePropertyExpression} from '@maplibre/maplibre-gl-style-spec';
import {drawFlatRasterLayer} from './flat-raster.mjs';
import {compileFlatGeometryStyle} from './flat-style.mjs';
import {drawFlatVectorLayer} from './flat-vector.mjs';
import {compileFlatTextLabel,drawFlatTextLabels,flatLabelCandidates} from './flat-labels.mjs';

function paintExpression(layer, name) {
  const spec = latest['paint_' + layer.type][name];
  return normalizePropertyExpression(layer.paint?.[name] ?? spec.default, spec);
}

// Prepare one ordered style for repeat frames. The application owns data
// loading, permissions, style mutations and the lifetime of decoded tiles.
// Recompile after style changes. Unsupported visible layers are surfaced,
// rather than treated as successfully rendered.
export function compileFlatFrame(layers) {
  const ordered = layers.map(layer => {
    const {id, type, source, minzoom = -Infinity, maxzoom = Infinity} = layer;
    const visible = layer.layout?.visibility !== 'none';
    const compiled = {id, type, source, visibleAt: zoom => visible && zoom >= minzoom && zoom < maxzoom};
    if (type === 'background') {
      if (layer.paint?.['background-pattern'] != null) return {...compiled, type:'unsupported'};
      compiled.color = paintExpression(layer,'background-color');
      compiled.opacity = paintExpression(layer,'background-opacity');
    } else if (type === 'raster') {
      compiled.opacity = paintExpression(layer,'raster-opacity');
    } else if (type === 'fill' || type === 'line' || type === 'circle') {
      if (layer['source-layer'] == null) return {...compiled, type:'unsupported'};
      if (layer.paint?.['fill-pattern'] != null || layer.paint?.['line-pattern'] != null)
        return {...compiled, type:'unsupported'};
      compiled.geometry = compileFlatGeometryStyle(layer);
    }
    if (type==='symbol') compiled.label=compileFlatTextLabel(layer);
    return compiled;
  });
  return function draw(context, camera, sources, {featureState = () => undefined} = {}) {
    const unsupported = [];
    const global = {zoom:camera.zoom};
    const layerDraws = new Map(), labels=[];
    // Shared within one frame so repeated layers reuse the MVT decoding
    // for each canonical source layer and all its wrapped copies.
    const decoded = new Map();
    context.save();
    try {
      context.clearRect(0,0,camera.width,camera.height);
      for (const layer of ordered) {
        if (!layer.visibleAt(camera.zoom)) continue;
        const {id,type,source,geometry} = layer;
        const tiles = sources.get(source) ?? [];
        let draws = 0;
        if (type === 'background') {
          context.save();
          try {
            context.globalAlpha *= layer.opacity.evaluate(global);
            context.fillStyle = layer.color.evaluate(global).toString();
            context.fillRect(0,0,camera.width,camera.height);
          } finally { context.restore(); }
          draws = 1;
        } else if (type === 'raster') {
          draws = drawFlatRasterLayer(context,camera,tiles,{opacity:layer.opacity.evaluate(global)});
        } else if (layer.label) {
          const candidates=[];
          for (const {tile,vector} of tiles){
            if(!vector)continue;
            if(!decoded.has(vector))decoded.set(vector,new Map());
            const cached=decoded.get(vector),name=layer.label.sourceLayer;
            if(!cached.has(name))cached.set(name,vector.layer(name));
            for(const candidate of flatLabelCandidates(layer.label,cached.get(name),tile,camera,global,
              featureId=>featureState(source,name,featureId))) candidates.push(candidate);
          }
          labels.push({id,candidates});
          continue;
        } else if (geometry) {
          for (const {tile,vector} of tiles) {
            if (!vector) continue;
            const {z,x,y}=tile;
            const canonical={z,x,y};
            if (!decoded.has(vector)) decoded.set(vector,new Map());
            const cached = decoded.get(vector);
            const name = geometry.sourceLayer;
            if (!cached.has(name)) cached.set(name,vector.layer(name));
            for (const feature of cached.get(name)) {
              const paint = geometry.resolve(global,feature,featureState(source,name,feature.id) ?? {},canonical);
              if (paint) draws += drawFlatVectorLayer(context,camera,tile,[feature],paint);
            }
          }
        } else {
          unsupported.push(id);
          continue;
        }
        layerDraws.set(id,draws);
      }
      // Station labels get their places before basemap labels; otherwise
      // a dense city background can hide the railway names entirely.
      labels.sort((a,b)=>Number(b.id.startsWith('station-'))-Number(a.id.startsWith('station-')));
      if(labels.length)for(const [id,count] of drawFlatTextLabels(context,camera,labels))layerDraws.set(id,count);
    } finally { context.restore(); }
    return {layerDraws,unsupported};
  };
}
