// Drawing tool: points, lines and areas drawn on the map, kept in this
// browser and saved or opened as GeoJSON files.
const R = 6371.0088; // mean Earth radius, km
const rad = d => d * Math.PI / 180;
export function lengthKm(coordinates) {
  let km = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [a, b] = [coordinates[i-1], coordinates[i]];
    const h = Math.sin(rad(b[1]-a[1])/2)**2 + Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(rad(b[0]-a[0])/2)**2;
    km += 2*R*Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return km;
}
// Spherical excess of a ring (as in Chamberlain & Duquette), km².
export function areaKm2(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i+1) % ring.length]];
    // Shortest arc, so an edge from 179° to −179° spans 2°, not 358°.
    const dLon = ((b[0] - a[0]) % 360 + 540) % 360 - 180;
    sum += rad(dLon) * (2 + Math.sin(rad(a[1])) + Math.sin(rad(b[1])));
  }
  return Math.abs(sum * R * R / 2);
}
const round = (value, digits) => Number(value.toFixed(value < 10 ? digits : value < 100 ? 1 : 0)).toLocaleString('en');
export function formatLength(km, units = 'metric') {
  if (units === 'imperial') { const mi = km / 1.609344; return mi < 0.1 ? `${Math.round(mi*5280).toLocaleString('en')} ft` : `${round(mi, 2)} mi`; }
  return km < 1 ? `${Math.round(km*1000).toLocaleString('en')} m` : `${round(km, 2)} km`;
}
export function formatArea(km2, units = 'metric') {
  if (units === 'imperial') { const mi2 = km2 / 2.589988; return mi2 < 0.1 ? `${round(mi2*640, 1)} acres` : `${round(mi2, 2)} sq mi`; }
  return km2 < 1 ? `${round(km2*100, 1)} ha` : `${round(km2, 2)} km²`;
}
export function measure(geometry, units) {
  if (geometry.type === 'LineString') return formatLength(lengthKm(geometry.coordinates), units);
  if (geometry.type === 'Polygon') return formatArea(areaKm2(geometry.coordinates[0]), units);
  return '';
}
export function formatRadius(km, units = 'metric') {
  if (units === 'imperial') { const ft = km * 3280.84; return ft < 52800 ? `${Math.round(ft).toLocaleString('en')} ft` : `${round(ft/5280, 2)} mi`; }
  return km < 10 ? `${Math.round(km*1000).toLocaleString('en')} m` : `${round(km, 2)} km`;
}
// Local planar coordinates in km around an origin; fine for the few
// kilometres a curve or a sketch spans.
const toPlane = ([lng0, lat0]) => { const k = Math.cos(rad(lat0)); return ([lng, lat]) => [rad(((lng - lng0) % 360 + 540) % 360 - 180)*R*k, rad(lat - lat0)*R]; };
const fromPlane = ([lng0, lat0]) => { const k = Math.cos(rad(lat0)); return ([x, y]) => [lng0 + x/(R*k)*180/Math.PI, lat0 + y/R*180/Math.PI]; };
// Smooth curve through the given points (centripetal Catmull–Rom).
export function smoothCurve(points, steps = 12) {
  if (points.length < 3) return points.map(p => [...p]);
  const [to, from] = [toPlane(points[0]), fromPlane(points[0])];
  const q = points.map(to), out = [];
  const pts = [[2*q[0][0]-q[1][0], 2*q[0][1]-q[1][1]], ...q, [2*q.at(-1)[0]-q.at(-2)[0], 2*q.at(-1)[1]-q.at(-2)[1]]];
  const knot = (t, a, b) => t + Math.max(1e-9, Math.hypot(b[0]-a[0], b[1]-a[1])**0.5);
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i-1], pts[i], pts[i+1], pts[i+2]];
    const t0 = 0, t1 = knot(t0, p0, p1), t2 = knot(t1, p1, p2), t3 = knot(t2, p2, p3);
    for (let s = 0; s < steps; s++) {
      const t = t1 + (t2 - t1) * s / steps;
      const lerp = (a, b, ta, tb) => [0, 1].map(k => ((tb - t)*a[k] + (t - ta)*b[k]) / (tb - ta));
      const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
      out.push(from(lerp(b1, b2, t1, t2)));
    }
  }
  out.push([...points.at(-1)]);
  return out.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]);
}
// Least-squares circle through three or more points (Kåsa's method):
// {center, radiusKm}, or null when the points are (nearly) in a line.
export function fitCircle(points) {
  if (points.length < 3) return null;
  const [to, from] = [toPlane(points[0]), fromPlane(points[0])];
  const q = points.map(to);
  // Solve x² + y² + Dx + Ey + F = 0 by normal equations.
  let [sxx, sxy, sx, syy, sy, n, bx, by, b1] = [0,0,0,0,0,0,0,0,0];
  for (const [x, y] of q) { const z = x*x + y*y; sxx += x*x; sxy += x*y; sx += x; syy += y*y; sy += y; n++; bx -= z*x; by -= z*y; b1 -= z; }
  const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], v = [bx, by, b1];
  const det = a => a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1]) - a[0][1]*(a[1][0]*a[2][2]-a[1][2]*a[2][0]) + a[0][2]*(a[1][0]*a[2][1]-a[1][1]*a[2][0]);
  const d = det(m), scale = Math.max(...q.map(([x, y]) => Math.hypot(x - q[0][0], y - q[0][1])), 1e-9);
  if (Math.abs(d) < 1e-12 * scale**4 * n**2) return null;
  const col = k => m.map((row, i) => row.map((c, j) => j === k ? v[i] : c));
  const [D, E, F] = [0, 1, 2].map(k => det(col(k)) / d);
  const cx = -D/2, cy = -E/2, r2 = cx*cx + cy*cy - F;
  // A huge radius means the points are in a line.
  if (!(r2 > 0) || Math.sqrt(r2) > 1e4 * scale) return null;
  return {center: from([cx, cy]), radiusKm: Math.sqrt(r2), plane: {cx, cy, to, from}};
}
// The fitted arc from the first to the last point, on the side of the rest.
export function circleArc(fit, points, steps = 64) {
  const {cx, cy, to, from} = fit.plane, r = fit.radiusKm;
  const angle = p => { const [x, y] = to(p); return Math.atan2(y - cy, x - cx); };
  const a0 = angle(points[0]), a1 = angle(points.at(-1)), am = angle(points[Math.floor(points.length/2)]);
  const ccw = a => ((a - a0) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
  // Go the way round that passes the middle point.
  const sweep = ccw(am) < ccw(a1) ? ccw(a1) : ccw(a1) - 2*Math.PI;
  return Array.from({length: steps + 1}, (_, i) => { const a = a0 + sweep*i/steps; return from([cx + r*Math.cos(a), cy + r*Math.sin(a)]); });
}
const finite = p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite);
// Drawing style kept on each feature and in saved files.
const DASHES = ['solid', 'dashed', 'dotted'];
export function drawingStyle(properties = {}) {
  const style = {};
  if (/^#[0-9a-f]{6}$/i.test(properties.color || '')) style.color = properties.color.toLowerCase();
  if (DASHES.includes(properties.dash)) style.dash = properties.dash;
  if (Number.isFinite(properties.width) && properties.width >= 1 && properties.width <= 12) style.width = properties.width;
  return style;
}
// Accept drawings from a file: points, lines and areas only, split from
// multi-geometries. Anything else is skipped.
export function readDrawing(json) {
  const features = json?.type === 'FeatureCollection' ? json.features : json?.type === 'Feature' ? [json] : [];
  const out = [];
  for (const f of features || []) {
    const g = f?.geometry, name = typeof f?.properties?.name === 'string' ? f.properties.name : undefined;
    const properties = {...(name ? {name} : {}), ...drawingStyle(f?.properties || {})};
    const add = geometry => out.push({type:'Feature', properties:{...properties}, geometry});
    const line = c => (c || []).filter(finite).map(p => p.slice(0, 2));
    if (g?.type === 'Point' && finite(g.coordinates)) add({type:'Point', coordinates:g.coordinates.slice(0, 2)});
    else if (g?.type === 'MultiPoint') { for (const p of line(g.coordinates)) add({type:'Point', coordinates:p}); }
    else if (g?.type === 'LineString') { const c = line(g.coordinates); if (c.length >= 2) add({type:'LineString', coordinates:c}); }
    else if (g?.type === 'MultiLineString') { for (const l of g.coordinates || []) { const c = line(l); if (c.length >= 2) add({type:'LineString', coordinates:c}); } }
    else if (g?.type === 'Polygon') { const c = line(g.coordinates?.[0]); if (c.length >= 4) add({type:'Polygon', coordinates:[c]}); }
    else if (g?.type === 'MultiPolygon') { for (const poly of g.coordinates || []) { const c = line(poly?.[0]); if (c.length >= 4) add({type:'Polygon', coordinates:[c]}); } }
  }
  return out;
}

const STORE = 'openrailwayatlas-drawing';
const COLOR = '#c2185b';
const colour = ['coalesce', ['get','color'], COLOR];
const HINTS = {point:'Click to place points.', line:'Click to add points; double-click or Finish to end.', curve:'Click points along the curve; double-click or Finish to end.', area:'Click to add corners; double-click or Finish to close.', erase:'Click a drawing to delete it.'};
export class Drawing {
  constructor(map, {units = () => 'metric', status = () => {}, changed = () => {}} = {}) {
    Object.assign(this, {map, units, status, changed});
    this.features = []; this.draft = []; this.mode = null; this.cursor = null; this.next = 1;
    this.style = {color: COLOR, dash: 'solid', width: 3};
    try { this.add(readDrawing(JSON.parse(localStorage.getItem(STORE) || 'null')), false); } catch {}
  }
  get active() { return this.mode !== null; }
  get multiPoint() { return this.mode === 'line' || this.mode === 'curve' || this.mode === 'area'; }
  // Sources and layers are re-added after every style replacement.
  install() {
    const map = this.map;
    if (!map.getSource('atlas-drawing')) map.addSource('atlas-drawing', {type:'geojson', data:this.collection(true)});
    if (!map.getSource('atlas-drawing-draft')) map.addSource('atlas-drawing-draft', {type:'geojson', data:this.draftCollection()});
    const label = {'text-field':['get','measure'],'text-font':['Noto Sans Bold'],'text-size':12,'text-allow-overlap':true};
    const labelPaint = {'text-color':colour,'text-halo-color':'#fffef8','text-halo-width':2};
    // line-dasharray cannot vary by feature: one line layer per dash style.
    const line = (id, dash, dasharray) => ({id, type:'line', source:'atlas-drawing',
      filter:['all', ['!=',['geometry-type'],'Point'], ['==', ['coalesce',['get','dash'],'solid'], dash]],
      layout:{'line-join':'round','line-cap':'round'},
      paint:{'line-color':colour, 'line-width':['coalesce',['get','width'],3], ...(dasharray ? {'line-dasharray':dasharray} : {})}});
    this.layers = [
      {id:'drawing-fill', type:'fill', source:'atlas-drawing', filter:['==',['geometry-type'],'Polygon'], paint:{'fill-color':colour,'fill-opacity':0.14}},
      line('drawing-line', 'solid'), line('drawing-line-dashed', 'dashed', [2.5, 1.8]), line('drawing-line-dotted', 'dotted', [0.1, 2]),
      {id:'drawing-points', type:'circle', source:'atlas-drawing', filter:['==',['geometry-type'],'Point'], paint:{'circle-color':colour,'circle-radius':['+', 3, ['coalesce',['get','width'],3]],'circle-stroke-color':'#fffef8','circle-stroke-width':2}},
      // symbol-placement cannot vary by feature: one layer each.
      {id:'drawing-line-labels', type:'symbol', source:'atlas-drawing', filter:['==',['geometry-type'],'LineString'], layout:{...label, 'symbol-placement':'line-center'}, paint:labelPaint},
      {id:'drawing-area-labels', type:'symbol', source:'atlas-drawing', filter:['==',['geometry-type'],'Polygon'], layout:label, paint:labelPaint},
      {id:'drawing-draft-line', type:'line', source:'atlas-drawing-draft', filter:['!=',['geometry-type'],'Point'], paint:{'line-color':colour,'line-width':2,'line-dasharray':[2,1.5]}},
      {id:'drawing-draft-vertices', type:'circle', source:'atlas-drawing-draft', filter:['==',['geometry-type'],'Point'], paint:{'circle-color':'#fffef8','circle-radius':4,'circle-stroke-color':colour,'circle-stroke-width':2}},
    ];
    for (const layer of this.layers) if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
  collection(withMeasure = false) {
    const units = this.units();
    // Rendered copies carry an id for erasing and their measurement; saved
    // files carry neither.
    return {type:'FeatureCollection', features:this.features.map(({id, ...f}) => withMeasure ? {...f, properties:{...f.properties, drawing:id, measure:measure(f.geometry, units)}} : f)};
  }
  // The shape being drawn, including the pointer position.
  shape() {
    const points = this.cursor ? [...this.draft, this.cursor] : this.draft;
    return this.mode === 'curve' ? smoothCurve(points) : points;
  }
  draftCollection() {
    const points = this.shape();
    const properties = {color: this.style.color};
    const features = this.draft.map(coordinates => ({type:'Feature', properties, geometry:{type:'Point', coordinates}}));
    if (points.length >= 2) features.push({type:'Feature', properties, geometry: this.mode === 'area' && points.length >= 3
      ? {type:'Polygon', coordinates:[[...points, points[0]]]} : {type:'LineString', coordinates:points}});
    return {type:'FeatureCollection', features};
  }
  refresh() {
    this.map.getSource('atlas-drawing')?.setData(this.collection(true));
    this.map.getSource('atlas-drawing-draft')?.setData(this.draftCollection());
    const points = this.shape(), units = this.units();
    this.status((this.mode === 'line' || this.mode === 'curve') && points.length >= 2 ? formatLength(lengthKm(points), units)
      : this.mode === 'area' && points.length >= 3 ? formatArea(areaKm2(points), units)
      : HINTS[this.mode] || '');
  }
  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.collection())); } catch {}
    this.refresh(); this.changed();
  }
  setStyle(style) { this.style = {...this.style, ...drawingStyle({...this.style, ...style})}; this.refresh(); }
  setMode(mode) {
    this.finish();
    this.mode = this.mode === mode ? null : mode;
    // Double-click finishes a line, curve or area instead of zooming.
    if (this.multiPoint) this.map.doubleClickZoom.disable(); else this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = this.mode ? 'crosshair' : '';
    this.refresh(); this.changed();
  }
  newFeature(geometry) {
    const {color, dash, width} = this.style;
    return {type:'Feature', properties: geometry.type === 'Point' ? {color, width} : {color, dash, width}, geometry};
  }
  click(lngLat, point) {
    const p = [Number(lngLat.lng.toFixed(6)), Number(lngLat.lat.toFixed(6))];
    if (this.mode === 'point') this.add([this.newFeature({type:'Point', coordinates:p})]);
    else if (this.multiPoint) {
      // Clicking the first corner closes an area.
      if (this.mode === 'area' && this.draft.length >= 3) {
        const first = this.map.project(this.draft[0]);
        if (Math.hypot(first.x - point.x, first.y - point.y) < 10) { this.finish(); return; }
      }
      this.draft.push(p); this.refresh();
    } else if (this.mode === 'erase') {
      const hit = this.map.queryRenderedFeatures([[point.x-6, point.y-6], [point.x+6, point.y+6]], {layers:['drawing-points','drawing-line','drawing-line-dashed','drawing-line-dotted','drawing-fill']})[0];
      const index = hit ? this.features.findIndex(f => f.id === hit.properties.drawing) : -1;
      if (index >= 0) { this.features.splice(index, 1); this.save(); }
    }
  }
  move(lngLat) {
    if (!this.multiPoint) return;
    this.cursor = [lngLat.lng, lngLat.lat]; this.refresh();
  }
  finish() {
    // A double-click adds its point twice before finishing.
    this.draft = this.draft.filter((p, i, all) => !i || p[0] !== all[i-1][0] || p[1] !== all[i-1][1]);
    const n = this.draft.length;
    const geometry = this.mode === 'line' && n >= 2 ? {type:'LineString', coordinates:this.draft}
      : this.mode === 'curve' && n >= 2 ? {type:'LineString', coordinates:smoothCurve(this.draft)}
      : this.mode === 'area' && n >= 3 ? {type:'Polygon', coordinates:[[...this.draft, this.draft[0]]]} : null;
    this.draft = []; this.cursor = null;
    if (geometry) this.add([this.newFeature(geometry)]); else this.refresh();
  }
  cancel() { this.draft = []; this.cursor = null; this.refresh(); }
  undo() {
    if (this.draft.length) { this.draft.pop(); this.refresh(); }
    else if (this.features.length) { this.features.pop(); this.save(); }
  }
  clear() { this.features = []; this.draft = []; this.cursor = null; this.save(); }
  add(features, store = true) {
    this.features.push(...features.map(f => ({...f, id:this.next++})));
    if (store) this.save();
  }
  file() { return new Blob([JSON.stringify(this.collection(), null, 1)], {type:'application/geo+json'}); }
}

// Measuring: a multi-segment distance, or the radius of a curve fitted to
// three or more points on it. Measurements are not kept.
const INK = '#16414d';
export class Measure {
  constructor(map, {units = () => 'metric', status = () => {}, changed = () => {}} = {}) {
    Object.assign(this, {map, units, status, changed});
    this.mode = null; this.points = []; this.cursor = null; this.ended = false;
  }
  get active() { return this.mode !== null; }
  install() {
    const map = this.map;
    if (!map.getSource('atlas-measure')) map.addSource('atlas-measure', {type:'geojson', data:this.collection()});
    const text = {'text-font':['Noto Sans Bold'],'text-size':12,'text-allow-overlap':true,'text-ignore-placement':true};
    const halo = {'text-color':INK,'text-halo-color':'#fffef8','text-halo-width':2.5};
    const layers = [
      {id:'measure-line', type:'line', source:'atlas-measure', filter:['==',['get','kind'],'segment'], layout:{'line-cap':'round'}, paint:{'line-color':INK,'line-width':2.5,'line-dasharray':[3,1.5]}},
      {id:'measure-arc', type:'line', source:'atlas-measure', filter:['==',['get','kind'],'arc'], layout:{'line-cap':'round'}, paint:{'line-color':'#e0701b','line-width':3}},
      {id:'measure-points', type:'circle', source:'atlas-measure', filter:['==',['geometry-type'],'Point'], paint:{'circle-color':'#fffef8','circle-radius':4.5,'circle-stroke-color':INK,'circle-stroke-width':2}},
      {id:'measure-segment-labels', type:'symbol', source:'atlas-measure', filter:['all',['==',['get','kind'],'segment'],['has','label']], layout:{...text,'text-field':['get','label'],'symbol-placement':'line-center','text-size':11}, paint:halo},
      {id:'measure-labels', type:'symbol', source:'atlas-measure', filter:['all',['==',['geometry-type'],'Point'],['has','label']], layout:{...text,'text-field':['get','label'],'text-offset':[0,-1.3]}, paint:halo},
    ];
    for (const layer of layers) if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
  collection() {
    const units = this.units(), live = this.cursor && !this.ended && this.mode === 'distance' ? [...this.points, this.cursor] : this.points;
    const feature = (geometry, properties = {}) => ({type:'Feature', properties, geometry});
    const features = this.points.map(p => feature({type:'Point', coordinates:p}));
    if (this.mode === 'distance') {
      for (let i = 1; i < live.length; i++) features.push(feature({type:'LineString', coordinates:[live[i-1], live[i]]}, {kind:'segment', ...(live.length > 2 ? {label: formatLength(lengthKm([live[i-1], live[i]]), units)} : {})}));
      if (live.length >= 2) features.push(feature({type:'Point', coordinates:live.at(-1)}, {kind:'total', label: formatLength(lengthKm(live), units)}));
    } else if (this.mode === 'radius') {
      const fit = fitCircle(this.points);
      if (fit) {
        const arc = circleArc(fit, this.points);
        features.push(feature({type:'LineString', coordinates:arc}, {kind:'arc'}));
        features.push(feature({type:'Point', coordinates:arc[Math.floor(arc.length/2)]}, {kind:'radius', label:`R ≈ ${formatRadius(fit.radiusKm, units)}`}));
      }
    }
    return {type:'FeatureCollection', features};
  }
  refresh() {
    this.map.getSource('atlas-measure')?.setData(this.collection());
    const units = this.units();
    if (this.mode === 'distance') {
      const live = this.cursor && !this.ended ? [...this.points, this.cursor] : this.points;
      this.status(live.length >= 2 ? `Distance: ${formatLength(lengthKm(live), units)} over ${live.length - 1} segment${live.length > 2 ? 's' : ''}${this.ended ? '' : ' · double-click to end'}` : 'Click points to measure; double-click to end.');
    } else if (this.mode === 'radius') {
      const fit = fitCircle(this.points);
      this.status(fit ? `Curve radius ≈ ${formatRadius(fit.radiusKm, units)}, fitted to ${this.points.length} points. Add more points along the curve to refine it.`
        : this.points.length >= 3 ? 'These points are in a line; click points around the curve.' : `Click ${3 - this.points.length} more point${this.points.length === 2 ? '' : 's'} along the curve.`);
    } else this.status('');
  }
  setMode(mode) {
    this.mode = this.mode === mode ? null : mode;
    this.points = []; this.cursor = null; this.ended = false;
    if (this.mode === 'distance') this.map.doubleClickZoom.disable(); else this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = this.mode ? 'crosshair' : '';
    this.refresh(); this.changed();
  }
  click(lngLat) {
    if (!this.mode) return;
    // After a finished distance, the next click starts a new one.
    if (this.ended) { this.points = []; this.ended = false; }
    const p = [Number(lngLat.lng.toFixed(6)), Number(lngLat.lat.toFixed(6))];
    const last = this.points.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) this.points.push(p);
    this.refresh();
  }
  move(lngLat) { if (this.mode === 'distance' && !this.ended) { this.cursor = [lngLat.lng, lngLat.lat]; this.refresh(); } }
  end() { if (this.mode === 'distance' && this.points.length >= 2) { this.ended = true; this.cursor = null; this.refresh(); } }
  undo() { this.ended = false; this.points.pop(); this.refresh(); }
  clear() { this.points = []; this.cursor = null; this.ended = false; this.refresh(); }
}
