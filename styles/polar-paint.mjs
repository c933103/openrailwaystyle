// The custom globe caps sample the SAME paint declarations as the ordinary
// Atlas basemap, instead of maintaining a second (eventually stale) palette.
// This deliberately supports a bounded subset of paint expressions, including
// the feature-dependent contour weights. Unknown expressions use reviewed defaults.
const DEFAULTS = {
  land: '#f2f1e9', water: '#bfd8e0', iceShelf: 'hsl(47, 26%, 88%)',
  contourLand: '#927b5a', contourSeabed: '#467d9a',
  building: '#a8aca4', buildingOutline: '#879187',
  waterway: 'rgba(168, 190, 207, 0.54)',
  runway: '#8d95b0', taxiway: '#aab1c8', apron: '#929bc2',
  reliefShadow: '#667365', reliefHighlight: '#ffffff', reliefAccent: '#738978',
};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function cssRgba(value, opacity = 1) {
  if (typeof value !== 'string' || !finite(opacity)) return null;
  const css = value.trim().toLowerCase();
  let rgb, alpha = 1;
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(css);
  if (hex) {
    const h = hex[1], channels = h.length <= 4
      ? [...h].map(c => parseInt(c + c, 16))
      : (h.match(/../g) || []).map(c => parseInt(c, 16));
    rgb = channels.slice(0, 3);
    if (channels.length === 4) alpha = channels[3] / 255;
  } else {
    const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(css);
    const hslMatch = /^hsla?\(\s*([-\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*([\d.]+))?\s*\)$/.exec(css);
    if (rgbMatch) {
      rgb = rgbMatch.slice(1, 4).map(Number);
      if (rgbMatch[4] !== undefined) alpha = Number(rgbMatch[4]);
    } else if (hslMatch) {
      const h = ((Number(hslMatch[1]) % 360) + 360) % 360 / 60;
      const s = Number(hslMatch[2]) / 100, l = Number(hslMatch[3]) / 100;
      if (!finite(h) || !finite(s) || !finite(l) || s > 1 || l > 1) return null;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(h % 2 - 1)), m = l - c / 2;
      const sectors = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]];
      rgb = sectors[Math.floor(h)].map(v => (v + m) * 255);
      if (hslMatch[4] !== undefined) alpha = Number(hslMatch[4]);
    }
  }
  if (!rgb || rgb.some(v => !finite(v) || v < 0 || v > 255) || !finite(alpha) || alpha < 0 || alpha > 1) return null;
  return [...rgb.map(v => v / 255), alpha * clamp(opacity, 0, 1)];
}

function interpolate(stops, zoom, base = 1) {
  if (!stops?.length || !finite(zoom) || !finite(base) || base <= 0) return undefined;
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [z1, v1] = stops[i], [z0, v0] = stops[i - 1];
    if (!finite(z0) || !finite(z1) || z1 <= z0) return undefined;
    if (zoom <= z1) {
      if (!finite(v0) || !finite(v1)) return undefined;
      const dz = zoom - z0, span = z1 - z0;
      const t = base === 1 ? dz / span : (base ** dz - 1) / (base ** span - 1);
      return v0 + (v1 - v0) * t;
    }
  }
  return stops.at(-1)[1];
}

export function samplePaint(expression, zoom, properties = {}) {
  return evaluatePaint(expression, zoom, properties, {remaining: 2048}, 0);
}
function evaluatePaint(expression, zoom, properties, budget, depth) {
  if (--budget.remaining < 0 || depth > 64) return undefined;
  if (Array.isArray(expression)) {
    if (expression.length > budget.remaining) return undefined;
    const [op, ...args] = expression;
    const read = value => evaluatePaint(value, zoom, properties, budget, depth + 1);
    if (op === 'zoom') return zoom;
    if (op === 'get') return typeof args[0] === 'string' && Object.hasOwn(properties, args[0]) ? properties[args[0]] : undefined;
    if (op === 'literal') return args[0];
    if (op === 'all' || op === 'any') {
      let result = op === 'all';
      for (const arg of args) {
        const value = read(arg);
        if (typeof value !== 'boolean') return undefined;
        if (op === 'all' && !value) return false;
        if (op === 'any' && value) return true;
      }
      return result;
    }
    if (['+', '-', '*', '/', 'abs'].includes(op)) {
      if (!args.length || args.length > budget.remaining ||
          (op === 'abs' && args.length !== 1) ||
          (op === '-' && args.length > 2) || (op === '/' && args.length !== 2)) return undefined;
      const values = args.map(read);
      if (!values.every(finite)) return undefined;
      const result = op === 'abs' ? Math.abs(values[0])
        : op === '+' ? values.reduce((a,b) => a+b, 0)
        : op === '*' ? values.reduce((a,b) => a*b, 1)
        : op === '/' ? values[0]/values[1]
        : values.length === 1 ? -values[0] : values[0]-values[1];
      return finite(result) ? result : undefined;
    }
    if (['<', '>', '<=', '>=', '==', '!='].includes(op) && args.length === 2) {
      const a = read(args[0]), b = read(args[1]);
      if (a === undefined || b === undefined) return undefined;
      return {'<':()=>a<b, '>':()=>a>b, '<=':()=>a<=b, '>=':()=>a>=b, '==':()=>a===b, '!=':()=>a!==b}[op]();
    }
    if (op === 'case' && args.length >= 3 && args.length % 2 === 1) {
      for (let i = 0; i < args.length - 1; i += 2) {
        const condition = read(args[i]);
        if (condition === undefined) return undefined;
        if (condition) return read(args[i + 1]);
      }
      return read(args.at(-1));
    }
    if (op === 'interpolate' && args.length >= 6 && args.length % 2 === 0 &&
        ['linear', 'exponential'].includes(args[0]?.[0])) {
      const stops = [];
      for (let i = 2; i < args.length; i += 2) {
        if (!finite(args[i]) || (i > 2 && args[i] <= args[i - 2])) return undefined;
        stops.push([args[i], read(args[i + 1])]);
      }
      return interpolate(stops, read(args[1]), args[0][0] === 'linear' ? 1 : args[0][1]);
    }
    return undefined;
  }
  if (expression && typeof expression === 'object') {
    if (Array.isArray(expression.stops)) {
      const stops = expression.stops;
      // Legacy functions share the expression tree's budget: a stop pair
      // and its two scalar values each consume a node, before any scanning.
      if (stops.length > Math.floor(budget.remaining / 3)) return undefined;
      budget.remaining -= stops.length * 3;
      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];
        if (!Array.isArray(stop) || stop.length !== 2 || !stop.every(finite) ||
            (i > 0 && stop[0] <= stops[i - 1][0])) return undefined;
      }
      return interpolate(stops, zoom, expression.base ?? 1);
    }
    return undefined;
  }
  return expression;
}

export function polarStylePaint(map, zoom) {
  // Cache lookups only for this frame. null means a successful missing
  // lookup; undefined means the API/style is unavailable and allows fallback.
  const layers = new Map();
  const layerFor = id => {
    if (!layers.has(id)) {
      let layer;
      try { if (typeof map?.getLayer === 'function') layer = map.getLayer(id) || null; } catch { /* unavailable style */ }
      layers.set(id, layer);
    }
    return layers.get(id);
  };
  const visible = (id, min = 0, max = Infinity) => {
    try {
      const layer = layerFor(id);
      if (layer === null) return false;
      min = layer?.minzoom ?? min; max = layer?.maxzoom ?? max;
      return zoom >= min && zoom < max &&
        map?.getLayoutProperty?.(id, 'visibility') !== 'none';
    } catch { return zoom >= min && zoom < max; }
  };
  const matches = (id, properties) => {
    let filter;
    try { filter = map?.getFilter?.(id); } catch { return true; }
    if (filter === undefined || filter === null) return true;
    const sampled = samplePaint(filter, zoom, properties);
    // Unsupported valid filters retain the reviewed class/depth fallback;
    // only an evaluated boolean false suppresses a supported filter match.
    return sampled === undefined || sampled === true;
  };
  const value = (id, property, fallback, properties) => {
    if (layerFor(id) === null) return fallback; // Do not log missing-layer errors every frame.
    let expression;
    try { expression = map?.getPaintProperty?.(id, property); } catch { /* map style not loaded */ }
    const sampled = samplePaint(expression, zoom, properties);
    return sampled === undefined || sampled === null ? fallback : sampled;
  };
  const colour = (id, property, fallback, properties) => {
    const paint = value(id, property, fallback, properties);
    return cssRgba(paint) ? paint : fallback;
  };
  const number = (id, property, fallback, properties) => {
    const paint = value(id, property, fallback, properties);
    return finite(paint) && paint >= 0 ? paint : fallback;
  };
  const contour = (id, fallbackOpacity, min, max) => properties => ({
    id, visible: visible(id, min, max) && matches(id, properties),
    opacity: number(id, 'line-opacity', fallbackOpacity, properties),
    width: number(id, 'line-width', properties.level > 0 ? 0.8 : 0.4, properties),
    colour: colour(id, 'line-color', id.includes('seabed') ? DEFAULTS.contourSeabed : DEFAULTS.contourLand, properties),
  });
  const seabedOpacity = zoom <= 5 ? 0.4 : zoom >= 12 ? 0.65 : 0.4 + (zoom - 5) * 0.25 / 7;
  const seabed = [contour('terrain-seabed-contours', seabedOpacity, 5, 11),
    contour('terrain-seabed-contours-close', seabedOpacity, 11)];
  return {
    colours: {
      land: colour('background', 'background-color', DEFAULTS.land),
      water: colour('water', 'fill-color', DEFAULTS.water),
      iceShelf: colour('landcover-ice-shelf', 'fill-color', DEFAULTS.iceShelf),
      building: colour('building-footprints', 'fill-color', DEFAULTS.building),
      buildingOutline: colour('building-outlines', 'line-color', DEFAULTS.buildingOutline),
      waterway: colour('waterway', 'line-color', DEFAULTS.waterway),
      runway: colour('context-transport-airport-runways', 'line-color', DEFAULTS.runway, {class:'runway'}),
      taxiway: colour('context-transport-airport-runways', 'line-color', DEFAULTS.taxiway, {class:'taxiway'}),
      apron: colour('context-transport-airport-area', 'fill-color', DEFAULTS.apron, {class:'apron'}),
    },
    backgroundVisible: visible('background'),
    backgroundOpacity: number('background', 'background-opacity', 1),
    waterVisible: visible('water'),
    waterOpacity: number('water', 'fill-opacity', 1),
    iceShelfVisible: visible('landcover-ice-shelf'),
    reliefVisible: visible('terrain-relief'),
    iceShelfOpacity: number('landcover-ice-shelf', 'fill-opacity', 0.8),
    buildingOpacity: number('building-footprints', 'fill-opacity', 0.24),
    buildingOutlineOpacity: number('building-outlines', 'line-opacity', 0.05),
    buildingOutlineWidth: number('building-outlines', 'line-width', 0.55),
    waterwayOpacity: number('waterway', 'line-opacity', 1),
    waterwayWidth: number('waterway', 'line-width', 1),
    airportVisible: visible('context-transport-airport-runways', 10),
    apronVisible: visible('context-transport-airport-area', 10),
    buildingVisible: visible('building-footprints', 13),
    buildingOutlineVisible: visible('building-outlines', 15),
    waterwayVisible: visible('waterway', 5),
    apronOpacity: number('context-transport-airport-area', 'fill-opacity', 0.25, {class:'apron'}),
    runwayOpacity: number('context-transport-airport-runways', 'line-opacity', 0.85, {class:'runway'}),
    taxiwayOpacity: number('context-transport-airport-runways', 'line-opacity', 0.85, {class:'taxiway'}),
    runwayWidth: number('context-transport-airport-runways', 'line-width', 2.5, {class:'runway'}),
    taxiwayWidth: number('context-transport-airport-runways', 'line-width', 1, {class:'taxiway'}),
    landContour: contour('terrain-contours', zoom <= 7 ? 0.45 : zoom >= 12 ? 0.65 : 0.45 + (zoom - 7) * 0.04, 7),
    seabedContours: properties => seabed.map(sample => sample(properties)).filter(style => style.visible),
    relief: {
      exaggeration: number('terrain-relief', 'hillshade-exaggeration', 0.3),
      shadow: colour('terrain-relief', 'hillshade-shadow-color', DEFAULTS.reliefShadow),
      highlight: colour('terrain-relief', 'hillshade-highlight-color', DEFAULTS.reliefHighlight),
      accent: colour('terrain-relief', 'hillshade-accent-color', DEFAULTS.reliefAccent),
      direction: number('terrain-relief', 'hillshade-illumination-direction', 315),
    },
  };
}
