// The custom globe caps sample the SAME paint declarations as the ordinary
// Atlas basemap, instead of maintaining a second (eventually stale) palette.
// This deliberately supports only the feature-independent paint expressions
// used by these layers. Unknown expressions fall back to reviewed defaults.
const DEFAULTS = {
  land: '#f2f1e9', water: '#bfd8e0', iceShelf: 'hsl(47, 26%, 88%)',
  contourLand: '#927b5a', contourSeabed: '#467d9a',
  building: '#a8aca4', buildingOutline: '#879187',
  waterway: 'rgba(168, 190, 207, 0.54)',
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
      if (s > 1 || l > 1) return null;
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
  if (Array.isArray(expression)) {
    const [op, ...args] = expression;
    const read = value => samplePaint(value, zoom, properties);
    if (op === 'zoom') return zoom;
    if (op === 'get') return Object.hasOwn(properties, args[0]) ? properties[args[0]] : undefined;
    if (op === 'literal') return args[0];
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
        args[0]?.[0] === 'linear' && args[1]?.[0] === 'zoom') {
      const stops = [];
      for (let i = 2; i < args.length; i += 2) stops.push([args[i], read(args[i + 1])]);
      return interpolate(stops, zoom);
    }
    return undefined;
  }
  if (expression && typeof expression === 'object') {
    if (Array.isArray(expression.stops)) return interpolate(expression.stops, zoom, expression.base || 1);
    return undefined;
  }
  return expression;
}

export function polarStylePaint(map, zoom) {
  const value = (id, property, fallback, properties) => {
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
  const contour = (id, fallbackOpacity) => ({
    opacity: number(id, 'line-opacity', fallbackOpacity),
    minorWidth: number(id, 'line-width', 0.4, {level: 0, ele: id.includes('seabed') ? -100 : 100}),
    majorWidth: number(id, 'line-width', 0.8, {level: 1, ele: id.includes('seabed') ? -100 : 100}),
  });
  return {
    colours: {
      land: colour('background', 'background-color', DEFAULTS.land),
      water: colour('water', 'fill-color', DEFAULTS.water),
      iceShelf: colour('landcover-ice-shelf', 'fill-color', DEFAULTS.iceShelf),
      contourLand: colour('terrain-contours', 'line-color', DEFAULTS.contourLand, {ele:100}),
      contourSeabed: colour('terrain-seabed-contours', 'line-color', DEFAULTS.contourSeabed, {ele:-100}),
      building: colour('building-footprints', 'fill-color', DEFAULTS.building),
      buildingOutline: colour('building-outlines', 'line-color', DEFAULTS.buildingOutline),
      waterway: colour('waterway', 'line-color', DEFAULTS.waterway),
    },
    iceShelfOpacity: number('landcover-ice-shelf', 'fill-opacity', 0.8),
    buildingOpacity: number('building-footprints', 'fill-opacity', 0.24),
    buildingOutlineOpacity: number('building-outlines', 'line-opacity', 0.05),
    buildingOutlineWidth: number('building-outlines', 'line-width', 0.55),
    waterwayOpacity: number('waterway', 'line-opacity', 1),
    waterwayWidth: number('waterway', 'line-width', 1),
    landContour: contour('terrain-contours', zoom <= 7 ? 0.45 : zoom >= 12 ? 0.65 : 0.45 + (zoom - 7) * 0.04),
    seabedContour: contour(zoom >= 11 ? 'terrain-seabed-contours-close' : 'terrain-seabed-contours', zoom <= 5 ? 0.4 : zoom >= 12 ? 0.65 : 0.4 + (zoom - 5) * 0.25 / 7),
    relief: {
      exaggeration: number('terrain-relief', 'hillshade-exaggeration', 0.3),
      shadow: colour('terrain-relief', 'hillshade-shadow-color', DEFAULTS.reliefShadow),
      highlight: colour('terrain-relief', 'hillshade-highlight-color', DEFAULTS.reliefHighlight),
      accent: colour('terrain-relief', 'hillshade-accent-color', DEFAULTS.reliefAccent),
      direction: number('terrain-relief', 'hillshade-illumination-direction', 315),
    },
  };
}
