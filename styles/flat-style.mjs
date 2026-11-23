import {featureFilter, latest, normalizePropertyExpression} from '@maplibre/maplibre-gl-style-spec';

// Use the installed Style Specification evaluator rather than interpreting
// expression syntax separately in the CPU renderer. The caller decides when
// to recompile after paint/layout/filter changes and supplies its same state.
const propertyNames = {
  line: {color:'line-color',opacity:'line-opacity',width:'line-width',dash:'line-dasharray',
    offset:'line-offset',gapWidth:'line-gap-width',blur:'line-blur',lineCap:['layout','line-cap'],lineJoin:['layout','line-join']},
  fill: {color:'fill-color',opacity:'fill-opacity',antialias:'fill-antialias'},
  circle: {color:'circle-color',opacity:'circle-opacity',radius:'circle-radius',
    strokeColor:'circle-stroke-color',strokeWidth:'circle-stroke-width',strokeOpacity:'circle-stroke-opacity'},
};
export function compileFlatGeometryStyle(layer) {
  const {type} = layer;
  if (!Object.hasOwn(propertyNames,type)) throw new TypeError('Not a flat geometry layer');
  const compiled = Object.entries(propertyNames[type]).map(([key, property]) => {
    const [kind,name] = typeof property === 'string' ? ['paint',property] : property;
    const spec = latest[kind + '_' + type][name];
    return [key,normalizePropertyExpression(layer[kind]?.[name] ?? spec.default,spec)];
  });
  const {filter,needGeometry} = featureFilter(layer.filter);
  return {
    id: layer.id,
    source: layer.source,
    sourceLayer: layer['source-layer'],
    needGeometry,
    visibleAt(zoom) {
      return layer.layout?.visibility !== 'none' &&
        zoom >= (layer.minzoom ?? -Infinity) && zoom < (layer.maxzoom ?? Infinity);
    },
    resolve(global, feature, state = {}, canonical) {
      if (!filter(global,feature,canonical)) return null;
      const paint = {type};
      for (const [key, expression] of compiled) paint[key] = expression.evaluate(global,feature,state,canonical);
      for (const key of ['color','strokeColor']) {
        if (paint[key] != null) paint[key] = paint[key].toString();
      }
      if (paint.dash) paint.dashPixels = paint.dash.map(d => d * paint.width);
      delete paint.dash;
      return paint;
    },
  };
}
